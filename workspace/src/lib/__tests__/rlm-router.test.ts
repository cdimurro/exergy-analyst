/**
 * Unit tests for rlm-router.ts — Deep DD premium-tier guardrails.
 *
 * Covers:
 *   - Role → model dispatch
 *   - Budget ceiling enforcement
 *   - Depth cap enforcement
 *   - Cost estimation math
 *   - Trajectory capture
 *   - Production backend fallback path (not exercised here; uses the
 *     injectable backend seam so tests are hermetic).
 */

import {
  BudgetExceededError,
  DepthExceededError,
  MODEL_PRICING,
  RLMRouter,
  computeCostUsd,
  estimateTokens,
  type BackendFn,
  type RLMRole,
} from "../rlm-router";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Backend stub that returns scripted text and records calls. */
function makeBackend(responder: (role: RLMRole, prompt: string) => string) {
  const calls: Array<{ role: RLMRole; promptChars: number }> = [];
  const backend: BackendFn = async (role, messages, _opts) => {
    const prompt = messages.map((m) => m.content).join("\n");
    calls.push({ role, promptChars: prompt.length });
    return responder(role, prompt);
  };
  return { backend, calls };
}

// ---------------------------------------------------------------------------
// Token + cost math
// ---------------------------------------------------------------------------

test("estimateTokens: 4-chars-per-token heuristic", () => {
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("a".repeat(40))).toBe(10);
  expect(estimateTokens("")).toBe(0);
});

test("computeCostUsd uses per-role pricing", () => {
  // Prices track MODEL_PRICING in rlm-router.ts. Leaf migrated to
  // deepseek-v4-flash (0.30 / 0.50 per million) in CC-BE-INFRA-0108.
  const leaf = computeCostUsd("leaf", 1_000_000, 1_000_000);
  expect(leaf).toBeCloseTo(0.30 + 0.50, 6);
  const synth = computeCostUsd("synth", 1_000_000, 1_000_000);
  expect(synth).toBeCloseTo(0.50 + 3.00, 6);
  const final = computeCostUsd("final", 1_000_000, 1_000_000);
  expect(final).toBeCloseTo(0.95 + 3.15, 6);
});

test("MODEL_PRICING has entries for all three roles", () => {
  const roles: RLMRole[] = ["leaf", "synth", "final"];
  for (const r of roles) {
    expect(MODEL_PRICING[r]).toBeDefined();
    expect(MODEL_PRICING[r].inputPerMillion).toBeGreaterThan(0);
    expect(MODEL_PRICING[r].outputPerMillion).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// Router dispatch
// ---------------------------------------------------------------------------

test("router dispatches to the requested role", async () => {
  const { backend, calls } = makeBackend((role) => `RESP_${role.toUpperCase()}`);
  const router = new RLMRouter({ backend, maxUsdBudget: 100 });

  const leaf = await router.complete("leaf", "sys", "hello");
  const synth = await router.complete("synth", "sys", "hi");
  const final = await router.complete("final", "sys", "ciao");

  expect(leaf.text).toBe("RESP_LEAF");
  expect(synth.text).toBe("RESP_SYNTH");
  expect(final.text).toBe("RESP_FINAL");
  expect(calls.map((c) => c.role)).toEqual(["leaf", "synth", "final"]);
});

test("router populates trajectory metadata on every call", async () => {
  const { backend } = makeBackend(() => "x".repeat(400));
  const router = new RLMRouter({ backend, maxUsdBudget: 100 });
  const result = await router.complete("leaf", "system prompt", "user prompt");
  expect(result.metadata.role).toBe("leaf");
  expect(result.metadata.modelName).toBe(MODEL_PRICING.leaf.modelName);
  expect(result.metadata.inputTokens).toBeGreaterThan(0);
  expect(result.metadata.outputTokens).toBeGreaterThan(0);
  expect(result.metadata.costUsd).toBeGreaterThan(0);
  expect(result.metadata.cumulativeCostUsd).toBeCloseTo(result.metadata.costUsd, 6);
  expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  expect(result.metadata.promptHash).toMatch(/^[a-f0-9]{16}$|^len\d+$/);
});

test("router accumulates cumulative cost across calls", async () => {
  const { backend } = makeBackend(() => "hello");
  const router = new RLMRouter({ backend, maxUsdBudget: 100 });
  await router.complete("leaf", "sys", "one");
  await router.complete("leaf", "sys", "two");
  await router.complete("leaf", "sys", "three");
  expect(router.totalCalls).toBe(3);
  expect(router.spentUsd).toBeGreaterThan(0);
  expect(router.fullTrajectory).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// Budget gate
// ---------------------------------------------------------------------------

test("BudgetExceededError thrown BEFORE the next call when limit would be exceeded", async () => {
  // Use a big prompt so estimated cost is non-trivial.
  const bigPrompt = "x".repeat(2_000_000);
  const { backend, calls } = makeBackend(() => "short");
  // Tiny budget — the first projected call will be over.
  const router = new RLMRouter({ backend, maxUsdBudget: 0.0000001 });

  await expect(
    router.complete("final", "system", bigPrompt, { maxTokens: 4000 }),
  ).rejects.toThrow(BudgetExceededError);
  // No calls should have been made against the backend.
  expect(calls).toHaveLength(0);
  expect(router.spentUsd).toBe(0);
});

test("budget error surfaces cumulative + projected cost in the message", async () => {
  const { backend } = makeBackend(() => "x");
  const router = new RLMRouter({ backend, maxUsdBudget: 0.0000001 });
  try {
    await router.complete("final", "sys", "prompt", { maxTokens: 10000 });
    fail("should have thrown BudgetExceededError");
  } catch (err) {
    expect(err).toBeInstanceOf(BudgetExceededError);
    const bErr = err as BudgetExceededError;
    expect(bErr.cumulativeCostUsd).toBe(0);
    expect(bErr.projectedCostUsd).toBeGreaterThan(0);
    expect(bErr.maxUsdBudget).toBe(0.0000001);
    expect(bErr.message).toMatch(/cumulative/);
    expect(bErr.message).toMatch(/projected/);
  }
});

test("budget gate blocks later calls but preserves earlier ones", async () => {
  const { backend, calls } = makeBackend(() => "x");
  // Budget only sufficient for one leaf call
  const oneCallBudget = computeCostUsd("leaf", estimateTokens("sys\nfirst prompt"), 3000) * 2.5;
  const router = new RLMRouter({ backend, maxUsdBudget: oneCallBudget });
  await router.complete("leaf", "sys", "first prompt");
  expect(calls).toHaveLength(1);
  await expect(
    router.complete("final", "sys", "big".repeat(100000)),
  ).rejects.toThrow(BudgetExceededError);
  // Successful call still recorded
  expect(router.totalCalls).toBe(1);
});

// ---------------------------------------------------------------------------
// Depth cap
// ---------------------------------------------------------------------------

test("DepthExceededError thrown when depth >= maxDepth", async () => {
  const { backend } = makeBackend(() => "ok");
  const router = new RLMRouter({ backend, maxUsdBudget: 100, maxDepth: 2 });

  // depth=0 fine
  await router.complete("leaf", "sys", "x", { depth: 0 });
  // depth=1 fine (0 and 1 both less than 2)
  await router.complete("leaf", "sys", "x", { depth: 1 });
  // depth=2 blocks
  await expect(
    router.complete("leaf", "sys", "x", { depth: 2 }),
  ).rejects.toThrow(DepthExceededError);
});

// ---------------------------------------------------------------------------
// Static cost estimator
// ---------------------------------------------------------------------------

test("router coerces NaN/Infinity options to safe defaults", () => {
  const { backend } = makeBackend(() => "x");
  const nanRouter = new RLMRouter({ backend, maxUsdBudget: Number.NaN, maxDepth: Number.NaN });
  expect(nanRouter.maxUsdBudget).toBe(0.25);
  expect(nanRouter.maxDepth).toBe(3);
  const infRouter = new RLMRouter({ backend, maxUsdBudget: Number.POSITIVE_INFINITY, maxDepth: Number.POSITIVE_INFINITY });
  expect(infRouter.maxUsdBudget).toBe(0.25);
  expect(infRouter.maxDepth).toBe(3);
  const negRouter = new RLMRouter({ backend, maxUsdBudget: -1, maxDepth: 0 });
  expect(negRouter.maxUsdBudget).toBe(0.25);
  expect(negRouter.maxDepth).toBe(3);
});

test("RLMRouter.estimateCost sums per-call costs", () => {
  const est = RLMRouter.estimateCost([
    { role: "leaf", promptChars: 4_000_000, maxOutputTokens: 1_000_000 },
    { role: "synth", promptChars: 4_000_000, maxOutputTokens: 1_000_000 },
  ]);
  // 1M input + 1M output leaf + 1M input + 1M output synth
  const expected =
    computeCostUsd("leaf", 1_000_000, 1_000_000) +
    computeCostUsd("synth", 1_000_000, 1_000_000);
  expect(est).toBeCloseTo(expected, 6);
});
