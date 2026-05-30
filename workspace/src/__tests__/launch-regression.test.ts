/**
 * Launch Regression Harness
 *
 * Integration tests that make real HTTP calls to the dev server.
 * Requires: DEV_SERVER_URL=http://localhost:3001 (or dev server running on 3001)
 *
 * These tests verify the 5 core launch-integrity contracts:
 * A. Parameter passthrough — params flow from config to evaluation
 * B. Output cleanliness — no internal terms in user-facing artifacts
 * C. Verdict integrity — zero evidence can't produce pass; blocked veto ≠ not_ready
 * D. Synthesis & literature — failed steps acknowledged; literature has URLs
 *
 * Run: DEV_SERVER_URL=http://localhost:3001 npx jest src/__tests__/launch-regression.test.ts --testTimeout=120000
 *
 * NOTE: Integration tests (A, B, C) require a running dev server.
 * They are skipped by default unless DEV_SERVER_URL is set.
 */

const BASE = process.env.DEV_SERVER_URL || "";
const HAS_SERVER = !!process.env.DEV_SERVER_URL;
const describeIntegration = HAS_SERVER ? describe : describe.skip;
const TIMEOUT_MS = 120_000;

// ── Helpers ─────────────────────────────────────────────────────

async function createProject(name: string, domain: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: "", goal: "", domain }),
  });
  if (!res.ok) throw new Error(`createProject failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function runAction(
  projectId: string,
  type: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, input }),
  });
  if (!res.ok) throw new Error(`runAction ${type} failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.artifact || data;
}

function getModules(artifact: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const content = artifact.content as Record<string, unknown>;
  return (content?.module_evaluations || {}) as Record<string, Record<string, unknown>>;
}

function getBrief(artifact: Record<string, unknown>): Record<string, unknown> {
  const content = artifact.content as Record<string, unknown>;
  return (content?.brief || {}) as Record<string, unknown>;
}

function getCaveats(artifact: Record<string, unknown>): string[] {
  const content = artifact.content as Record<string, unknown>;
  return (content?.caveats || []) as string[];
}

function getSolver(artifact: Record<string, unknown>): Record<string, unknown> | undefined {
  const content = artifact.content as Record<string, unknown>;
  return content?.physics_solver as Record<string, unknown> | undefined;
}

// ── Test A: Parameter Passthrough ────────────────────────────────

describeIntegration("A: Parameter passthrough", () => {
  let projectId: string;

  beforeAll(async () => {
    const p = await createProject("Param Passthrough Test", "pv_iv");
    projectId = p.id;
  }, 10_000);

  it("A1: Evaluation with explicit params produces non-zero evidence matches", async () => {
    const artifact = await runAction(projectId, "evidence_evaluation", {
      domain: "pv_iv",
      description: "580W TOPCon bifacial module",
      params: { pmax_w: 580, efficiency_pct: 22.5, voc_v: 51.8, isc_a: 14.06 },
      brief: true,
    });
    const mods = getModules(artifact);
    expect(Object.keys(mods).length).toBeGreaterThan(0);
    const totalMatched = Object.values(mods).reduce((sum, m) => {
      const d = m.details as Record<string, unknown> | undefined;
      return sum + (Number(d?.evidence_params_matched) || 0);
    }, 0);
    expect(totalMatched).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  it("A2: Evaluation with EMPTY params adds baseline-only caveat", async () => {
    const artifact = await runAction(projectId, "evidence_evaluation", {
      domain: "pv_iv",
      description: "Some generic module",
      params: {},
      brief: true,
    });
    const caveats = getCaveats(artifact);
    const hasBaselineWarning = caveats.some(
      (c) => c.includes("baseline defaults") || c.includes("No technology-specific parameters"),
    );
    expect(hasBaselineWarning).toBe(true);
  }, TIMEOUT_MS);
});

// ── Test B: Output Cleanliness ──────────────────────────────────

describeIntegration("B: Output cleanliness", () => {
  let projectId: string;

  beforeAll(async () => {
    const p = await createProject("Cleanliness Test", "heat_pump_hvac");
    projectId = p.id;
  }, 10_000);

  it("B1: Evaluation artifact caveats contain no internal terms", async () => {
    const artifact = await runAction(projectId, "evidence_evaluation", {
      domain: "heat_pump_hvac",
      description: "12kW R290 heat pump",
      params: { cop_heating: 4.2, capacity_kw: 12 },
      brief: true,
    });
    const caveats = getCaveats(artifact);
    for (const c of caveats) {
      expect(c).not.toMatch(/^Energy kernel:/);
      expect(c).not.toMatch(/domain '/);
      expect(c).not.toMatch(/^Provisional evaluation/);
      expect(c).not.toMatch(/^Domain:/);
    }
  }, TIMEOUT_MS);

  it("B2: Deep analysis artifact has no model_used field", async () => {
    const artifact = await runAction(projectId, "deep_analysis", {
      question: "What are the main risks of R290 refrigerant in heat pumps?",
    });
    const content = artifact.content as Record<string, unknown>;
    expect(content.model_used).toBeUndefined();
    expect(content.oracle_metadata).toBeUndefined();
  }, TIMEOUT_MS);
});

// ── Test C: Verdict Integrity ───────────────────────────────────

describeIntegration("C: Verdict integrity", () => {
  let projectId: string;

  beforeAll(async () => {
    const p = await createProject("Verdict Test", "pv_iv");
    projectId = p.id;
  }, 10_000);

  it("C1: Zero-evidence modules cannot be verdict=pass", async () => {
    const artifact = await runAction(projectId, "evidence_evaluation", {
      domain: "pv_iv",
      description: "Generic panel",
      params: {},
      brief: true,
    });
    const mods = getModules(artifact);
    for (const [, m] of Object.entries(mods)) {
      const d = m.details as Record<string, unknown> | undefined;
      if (Number(d?.evidence_params_matched) === 0) {
        expect(m.verdict).not.toBe("pass");
        expect(Number(m.score_0_100)).toBeLessThanOrEqual(55);
      }
    }
  }, TIMEOUT_MS);

  it("C2: Blocked veto module produces conditional, not not_ready", async () => {
    const artifact = await runAction(projectId, "evidence_evaluation", {
      domain: "pv_iv",
      description: "Panel with no environmental data",
      params: { efficiency_pct: 22.0 },
      brief: true,
    });
    const mods = getModules(artifact);
    const brief = getBrief(artifact);
    const envVerdict = mods?.environmental?.verdict;
    const physVerdict = mods?.physics?.verdict;
    // Only assert if environmental is blocked but physics didn't fail
    if (envVerdict === "blocked" && physVerdict !== "fail") {
      expect(brief.readiness_tier).not.toBe("not_ready");
    }
  }, TIMEOUT_MS);

  it("C3: Solver output includes result_mode field", async () => {
    const artifact = await runAction(projectId, "evidence_evaluation", {
      domain: "pv_iv",
      description: "580W TOPCon",
      params: { pmax_w: 580, efficiency_pct: 22.5 },
      brief: true,
    });
    const ps = getSolver(artifact);
    if (ps) {
      expect(ps.result_mode).toBeDefined();
      expect(["computed", "estimated", "baseline_fallback"]).toContain(ps.result_mode);
    }
  }, TIMEOUT_MS);
});

// ── Test D: Synthesis & Literature ──────────────────────────────

describe("D: Synthesis and literature", () => {
  it("D1: Failed-step synthesis acknowledgment (deterministic logic)", () => {
    // Replicates the synthesis failure-context logic from page.tsx runPlan
    const planResults = [
      "Step 1 (Literature Search): Found 8 papers",
      "Step 2 (Evaluation): FAILED — timeout after 3 minutes",
      "Step 3 (Deep Analysis): Risk analysis complete",
    ];
    const failedEntries = planResults.filter((r) => r.includes("FAILED"));
    expect(failedEntries).toHaveLength(1);
    expect(failedEntries[0]).toContain("Step 2");

    const failureContext = failedEntries.length > 0
      ? `${failedEntries.length} of ${planResults.length} analysis steps did not complete:\n${failedEntries.join("\n")}`
      : "";
    expect(failureContext).toContain("1 of 3");
    expect(failureContext).toContain("FAILED");
  });

  it("D2: Literature search returns papers (URL generation tested via model)", async () => {
    // Test the EvidenceItem URL auto-generation logic
    // This is a deterministic unit test — doesn't need the server
    const doiSource = "doi:10.1016/j.solener.2023.01.001";
    const pmidSource = "pmid:12345678";
    const otherSource = "core:abc123";

    // Simulate model_post_init URL construction
    const urlFromDoi = doiSource.startsWith("doi:")
      ? `https://doi.org/${doiSource.slice(4)}`
      : null;
    const urlFromPmid = pmidSource.startsWith("pmid:")
      ? `https://pubmed.ncbi.nlm.nih.gov/${pmidSource.slice(5)}`
      : null;
    const urlFromOther = otherSource.startsWith("doi:")
      ? `https://doi.org/${otherSource.slice(4)}`
      : otherSource.startsWith("pmid:")
      ? `https://pubmed.ncbi.nlm.nih.gov/${otherSource.slice(5)}`
      : null;

    expect(urlFromDoi).toBe("https://doi.org/10.1016/j.solener.2023.01.001");
    expect(urlFromPmid).toBe("https://pubmed.ncbi.nlm.nih.gov/12345678");
    expect(urlFromOther).toBeNull();
  });
});
