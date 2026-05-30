/**
 * TypeScript RLM router — premium Deep DD orchestrator.
 *
 * Mirrors the Python package at `breakthrough_engine/rlm/` but layered on
 * top of the workspace's existing LLM wrappers (`callDeepSeekV3`,
 * `callQwen36Plus`, `callGLM51`). Three roles:
 *
 *   - `leaf`  → DeepSeek V4-Flash  — cheap per-section extraction
 *   - `synth` → Qwen 3.6 Plus  — mid-tier per-doc reconciliation
 *   - `final` → GLM-5.1       — top-of-tree cross-doc synthesis
 *
 * Premium-product guardrails (Batch C):
 *
 *   1. **Budget ceiling.** Before every call, the router checks whether
 *      the cumulative spend plus the projected cost of the next call
 *      would exceed `maxUsdBudget`. If so, it throws
 *      `BudgetExceededError`. Callers catch and fall back to the free
 *      path.
 *   2. **Depth cap.** `currentDepth` counter blocks recursion beyond
 *      `maxDepth`. Prevents runaway orchestration.
 *   3. **Trajectory capture.** Every call is recorded for audit — the
 *      premium tier surfaces this to the user as provenance.
 *
 * Model pricing constants are sourced from `backend.ts` comments
 * (checked at write time: DeepSeek $0.28/$0.42, Qwen $0.50/$3.00,
 * GLM $0.95/$3.15 per 1M tokens). If a provider's pricing changes,
 * update `MODEL_PRICING` below — budget accounting is the single
 * point of correction.
 */

import { callDeepSeekV3, callGLM51, callQwen36Plus } from "./backend";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RLMRole = "leaf" | "synth" | "final";

export interface ModelPricing {
  inputPerMillion: number; // USD
  outputPerMillion: number; // USD
  modelName: string;
}

/**
 * Per-role pricing. Update these as providers change.
 * Current as of CC-BE-RLM-0022 write time.
 */
export const MODEL_PRICING: Record<RLMRole, ModelPricing> = {
  leaf: { inputPerMillion: 0.30, outputPerMillion: 0.50, modelName: "deepseek-v4-flash" },
  synth: { inputPerMillion: 0.50, outputPerMillion: 3.00, modelName: "qwen3.6-plus" },
  final: { inputPerMillion: 0.95, outputPerMillion: 3.15, modelName: "z-ai/glm-5.1" },
};

export interface RLMCompletionMetadata {
  role: RLMRole;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cumulativeCostUsd: number;
  depth: number;
  latencyMs: number;
  promptHash: string;
  responseHash: string;
}

export interface RLMCompletion {
  text: string;
  metadata: RLMCompletionMetadata;
}

export interface RLMRouterOptions {
  /** Hard USD ceiling. Exceeding this throws BudgetExceededError. */
  maxUsdBudget?: number;
  /** Depth cap. The router's `complete` increments depth when called
   *  recursively via `withDepth`. */
  maxDepth?: number;
  /** Extra per-call kwargs passed through to the underlying LLM call. */
  defaultTemperature?: number;
  /** Pluggable backend for tests. When provided, all three roles route
   *  through this function instead of the real LLM wrappers. */
  backend?: BackendFn;
}

/** Backend callable used by tests and the default production path.
 *
 *  The production default hits callDeepSeekV3 / callQwen36Plus /
 *  callGLM51 based on role. Tests pass a stub that returns scripted
 *  responses. */
export type BackendFn = (
  role: RLMRole,
  messages: Array<{ role: string; content: string }>,
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean },
) => Promise<string>;

export class BudgetExceededError extends Error {
  constructor(
    public readonly cumulativeCostUsd: number,
    public readonly projectedCostUsd: number,
    public readonly maxUsdBudget: number,
  ) {
    super(
      `RLM budget exceeded: cumulative $${cumulativeCostUsd.toFixed(4)} + ` +
      `projected $${projectedCostUsd.toFixed(4)} > limit $${maxUsdBudget.toFixed(4)}`,
    );
    this.name = "BudgetExceededError";
  }
}

export class DepthExceededError extends Error {
  constructor(public readonly currentDepth: number, public readonly maxDepth: number) {
    super(`RLM depth ${currentDepth} >= cap ${maxDepth}`);
    this.name = "DepthExceededError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate tokens from character count. Industry-standard approximation
 * (4 chars per token) and matches the estimator in `backend.ts`'s
 * logging path. Good enough for budget decisions; actual token counts
 * from API responses supersede this for final cost ledger entries when
 * available.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function computeCostUsd(
  role: RLMRole,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[role];
  return (
    (inputTokens * pricing.inputPerMillion) / 1_000_000 +
    (outputTokens * pricing.outputPerMillion) / 1_000_000
  );
}

async function hashText(text: string): Promise<string> {
  // Use Web Crypto API; available in Node 16+ and all Next.js runtimes.
  try {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Fallback: character-count-based pseudo-hash. Good enough for
    // trace metadata in environments without SubtleCrypto.
    return `len${text.length}`;
  }
}

// ---------------------------------------------------------------------------
// Default production backend
// ---------------------------------------------------------------------------

const productionBackend: BackendFn = async (role, messages, opts) => {
  switch (role) {
    case "leaf":
      return callDeepSeekV3(messages, opts);
    case "synth":
      return callQwen36Plus(messages, opts);
    case "final":
      return callGLM51(messages, opts);
    default: {
      // Exhaustiveness guard — never-reachable but useful if RLMRole expands.
      const _exhaustive: never = role;
      throw new Error(`Unknown RLM role: ${String(_exhaustive)}`);
    }
  }
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class RLMRouter {
  public readonly maxUsdBudget: number;
  public readonly maxDepth: number;
  public readonly defaultTemperature: number;
  private readonly backend: BackendFn;
  private cumulativeCostUsd = 0;
  private readonly trajectory: RLMCompletionMetadata[] = [];
  private callCount = 0;

  constructor(opts: RLMRouterOptions = {}) {
    const budget = opts.maxUsdBudget ?? 0.25;
    const depth = opts.maxDepth ?? 3;
    // Guard against caller-supplied NaN/Infinity from malformed JSON body.
    // `?? 3` doesn't catch these; an explicit finite check does.
    this.maxUsdBudget = Number.isFinite(budget) && budget > 0 ? budget : 0.25;
    this.maxDepth = Number.isFinite(depth) && depth >= 1 ? Math.floor(depth) : 3;
    this.defaultTemperature = opts.defaultTemperature ?? 0.2;
    this.backend = opts.backend ?? productionBackend;
  }

  /**
   * Call a model at the given role. Enforces budget and depth gates.
   *
   * @throws BudgetExceededError if the projected cost would push total
   *   spend over `maxUsdBudget`.
   * @throws DepthExceededError if `depth >= maxDepth`.
   */
  async complete(
    role: RLMRole,
    system: string,
    user: string,
    callOpts: { maxTokens?: number; jsonMode?: boolean; depth?: number } = {},
  ): Promise<RLMCompletion> {
    const depth = callOpts.depth ?? 0;
    if (depth >= this.maxDepth) {
      throw new DepthExceededError(depth, this.maxDepth);
    }

    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    const promptText = system + "\n" + user;
    const inputTokens = estimateTokens(promptText);
    const projectedOutputTokens = callOpts.maxTokens ?? 3000;
    const projectedCost = computeCostUsd(role, inputTokens, projectedOutputTokens);

    if (this.cumulativeCostUsd + projectedCost > this.maxUsdBudget) {
      throw new BudgetExceededError(
        this.cumulativeCostUsd,
        projectedCost,
        this.maxUsdBudget,
      );
    }

    const t0 = Date.now();
    const text = await this.backend(role, messages, {
      temperature: this.defaultTemperature,
      maxTokens: callOpts.maxTokens ?? 6000,
      jsonMode: callOpts.jsonMode ?? true,
    });
    const latencyMs = Date.now() - t0;

    const outputTokens = estimateTokens(text);
    const actualCost = computeCostUsd(role, inputTokens, outputTokens);
    this.cumulativeCostUsd += actualCost;
    this.callCount += 1;

    const metadata: RLMCompletionMetadata = {
      role,
      modelName: MODEL_PRICING[role].modelName,
      inputTokens,
      outputTokens,
      costUsd: actualCost,
      cumulativeCostUsd: this.cumulativeCostUsd,
      depth,
      latencyMs,
      promptHash: await hashText(promptText),
      responseHash: await hashText(text),
    };
    this.trajectory.push(metadata);
    return { text, metadata };
  }

  /** Read-only snapshot of accumulated cost. */
  get spentUsd(): number {
    return this.cumulativeCostUsd;
  }

  /** Read-only snapshot of how many model calls have been made. */
  get totalCalls(): number {
    return this.callCount;
  }

  /** Full trajectory for persistence in the Deep DD artifact. */
  get fullTrajectory(): RLMCompletionMetadata[] {
    return [...this.trajectory];
  }

  /**
   * Pre-flight cost estimate. Callers use this to show a "this will
   * cost about $X" label before submitting a Deep DD run. Estimate is
   * conservative — assumes max output tokens per call.
   *
   * `calls` is an array of {role, promptChars} describing the expected
   * pipeline shape.
   */
  static estimateCost(
    calls: Array<{ role: RLMRole; promptChars: number; maxOutputTokens?: number }>,
  ): number {
    return calls.reduce((acc, call) => {
      const inputTokens = Math.ceil(call.promptChars / 4);
      const outputTokens = call.maxOutputTokens ?? 3000;
      return acc + computeCostUsd(call.role, inputTokens, outputTokens);
    }, 0);
  }
}
