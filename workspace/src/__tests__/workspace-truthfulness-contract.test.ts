/**
 * CC-BE-GOV-0111: workspace truthfulness contract.
 *
 * Consolidated regression lock sitting across the three preceding
 * Batch 3 contracts (0108 chat prompt, 0109 mock sidecar default,
 * 0110 solver status rendering). Each of those landed its own
 * focused tests; this suite adds the cross-file invariants that none
 * of them individually owns:
 *
 *   1. Overclaim bans apply to the ENTIRE workspace source tree, not
 *      just the chat route. If someone reintroduces the "every domain
 *      has a real physics solver" phrasing in a component, helper, or
 *      different route, this suite catches it.
 *   2. The CC-BE-GOV-0110 solver-status renderer never produces
 *      "calibrated simulation" on a non-"ran" status — the Codex-
 *      flagged regression is that a mock/unavailable/dispatch-error
 *      run inflates to calibrated. We test the full input cross-product.
 *   3. ``allowsPositiveReadinessLanguage`` suppresses readiness
 *      phrasing on every documented block signal, including combinations
 *      (mock + hard_fail, veto + dispatch_error, etc.).
 *   4. ``renderNoBackingCaveat`` always returns a visible string when
 *      the result is NOT solver-backed. An empty caveat is worse than
 *      a missing one — the user must see the mode.
 */

import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";

import {
  renderMethodology,
  renderNoBackingCaveat,
  allowsPositiveReadinessLanguage,
  type SolverStatus,
} from "@/lib/solver-status";

// ── Tree walker for static grep ──────────────────────────────────

const WORKSPACE_SRC = join(__dirname, "..");

/** Relative paths that are themselves the test scaffold for the old
 * strings — they intentionally contain the banned phrasing (as regex
 * patterns) and must be skipped. */
const SELF_REFERENTIAL_FILES: ReadonlySet<string> = new Set([
  "__tests__/chat-prompt-truthfulness.test.ts",
  "__tests__/workspace-truthfulness-contract.test.ts",
  "lib/__tests__/solver-status.test.ts",
  "__tests__/actions-mock-sidecar.test.ts",
  // CC-BE-CLEAN-0006: sibling taxonomy-translations test asserts its
  // own ban on tier-vocab leaks and legitimately mentions "tier C0" in
  // comments / test data. Excluded here so the cross-cutting overclaim
  // scan does not flag a sibling truthfulness test.
  "__tests__/taxonomy-translations.test.ts",
]);

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    // lstat (not stat) so a symlink cannot redirect the walker
    // outside WORKSPACE_SRC; symlinked files/directories are skipped
    // entirely. Keeps the contract test hermetic inside the source
    // tree even if the dev checkout happens to contain symlinks.
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walkTsFiles(p, out);
    } else if (st.isFile() && /\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
}

function collectNonTestSources(): string[] {
  const all: string[] = [];
  walkTsFiles(WORKSPACE_SRC, all);
  return all.filter((p) => {
    const rel = p.substring(WORKSPACE_SRC.length + 1);
    return !SELF_REFERENTIAL_FILES.has(rel);
  });
}

// ── (1) Workspace-wide overclaim ban ─────────────────────────────

describe("workspace-wide overclaim ban (CC-BE-GOV-0111)", () => {
  const sources = collectNonTestSources();

  it("no file claims 'every domain has a real (physics) solver'", () => {
    const offenders: string[] = [];
    const pattern = /every domain has a real (physics )?solver/i;
    for (const p of sources) {
      if (pattern.test(readFileSync(p, "utf-8"))) {
        offenders.push(p.substring(WORKSPACE_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no file says "use physics_simulation for ANY domain"', () => {
    const offenders: string[] = [];
    const pattern = /use physics_simulation for ANY domain/i;
    for (const p of sources) {
      if (pattern.test(readFileSync(p, "utf-8"))) {
        offenders.push(p.substring(WORKSPACE_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no file claims solver produces real computed metrics, not estimates', () => {
    const offenders: string[] = [];
    const pattern = /produces? real computed metrics\s*[—-]\s*not estimates/i;
    for (const p of sources) {
      if (pattern.test(readFileSync(p, "utf-8"))) {
        offenders.push(p.substring(WORKSPACE_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no file tells the assistant to reference the credibility tier externally', () => {
    const offenders: string[] = [];
    const pattern = /\breference the credibility tier\b/i;
    for (const p of sources) {
      if (pattern.test(readFileSync(p, "utf-8"))) {
        offenders.push(p.substring(WORKSPACE_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  // CC-BE-CLEAN-0006: the diligence backend prompt previously hard-coded a
  // solver footprint ("12 physics solver families covering 107 energy
  // domains") and instructed the model to cite internal credibility
  // tiers ("C2/C3") in user-facing text. Neither reflects real coverage
  // and both re-open the overclaim path. Ban both patterns so no prompt
  // can reintroduce them.
  it('no prompt claims a fixed solver family count or domain count', () => {
    const offenders: string[] = [];
    const pattern = /\d+\s+physics\s+solver\s+families/i;
    for (const p of sources) {
      if (pattern.test(readFileSync(p, "utf-8"))) {
        offenders.push(p.substring(WORKSPACE_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no prompt tells the assistant to cite "credibility tier C2/C3"', () => {
    const offenders: string[] = [];
    // Matches the exact Codex-flagged wording and common variants.
    const pattern = /credibility\s+tier\s+C[0-3](?:\s*\/\s*C[0-3])?/i;
    for (const p of sources) {
      if (pattern.test(readFileSync(p, "utf-8"))) {
        offenders.push(p.substring(WORKSPACE_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no prompt exposes C0/C1/C2/C3 credibility tiers as user-facing vocabulary', () => {
    // A standalone C2 / C3 token in prose is the internal-tier
    // vocabulary the public text must stay out of. The solver-status.ts
    // helper owns the one public mapping ("calibrated simulation" / etc.)
    // and prompt text should reference those labels, not tier codes.
    const offenders: string[] = [];
    // \bC[0-3]\b in prose only (allow it inside typescript enums /
    // identifiers which almost always appear with underscores or as
    // property keys — we only care about prose occurrences in prompt
    // strings). The pattern below matches a bare tier code surrounded
    // by words, as would appear in a backtick-quoted prompt.
    const pattern = /\btier\s+C[0-3]\b/i;
    for (const p of sources) {
      if (pattern.test(readFileSync(p, "utf-8"))) {
        offenders.push(p.substring(WORKSPACE_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── (2) Non-ran status never inflates to calibrated ──────────────

describe("non-ran solver status never renders calibrated (CC-BE-GOV-0111)", () => {
  // Every documented non-ran status should map to "not computed",
  // regardless of concordance / concordance_gate / mock state.
  const NON_RAN: SolverStatus[] = [
    "unavailable",
    "validation_failed",
    "dispatch_error",
    "not_registered",
    "not_run",
  ];

  it.each(NON_RAN)(
    "status=%s → not computed even with confirmed gate hint",
    (status) => {
      expect(renderMethodology({
        // concordance_gate is only meaningful when status === "ran",
        // but we inject a confirmed hint to catch any code path that
        // reads the gate before the status.
        physics_solver: { status, concordance_gate: "confirmed", concordance: 0.95 },
      })).toBe("not computed");
    },
  );

  it.each(NON_RAN)(
    "status=%s + mock_sidecar=true → not computed (mock does NOT rescue)",
    (status) => {
      expect(renderMethodology({
        mock_sidecar: true,
        physics_solver: { status },
      })).toBe("not computed");
    },
  );

  it("no combination of non-ran + any non-block field renders calibrated", () => {
    // Brute-force cross-product sanity.
    const statuses: SolverStatus[] = NON_RAN;
    const gates = ["confirmed", "caveat", undefined];
    const mocks = [true, false];
    const concordances = [0, 0.5, 0.95, 1.0];

    for (const status of statuses) {
      for (const gate of gates) {
        for (const mock of mocks) {
          for (const c of concordances) {
            const methodology = renderMethodology({
              mock_sidecar: mock,
              physics_solver: {
                status,
                concordance_gate: gate,
                concordance: c,
              },
            });
            expect(methodology).not.toBe("calibrated simulation");
          }
        }
      }
    }
  });
});

// ── (3) Block signals suppress readiness language ────────────────

describe("readiness-language suppression (CC-BE-GOV-0111)", () => {
  it("hard_fail + status=ran still suppresses readiness", () => {
    expect(allowsPositiveReadinessLanguage({
      hard_fail: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe(false);
    expect(renderMethodology({
      hard_fail: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe("blocked");
  });

  it("promotion_blocked + status=ran still suppresses readiness", () => {
    expect(allowsPositiveReadinessLanguage({
      promotion_blocked: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe(false);
    expect(renderMethodology({
      promotion_blocked: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe("blocked");
  });

  it("solver veto (gate=veto) + mock still suppresses readiness", () => {
    expect(allowsPositiveReadinessLanguage({
      mock_sidecar: true,
      physics_solver: { status: "ran", concordance_gate: "veto" },
    })).toBe(false);
    expect(renderMethodology({
      mock_sidecar: true,
      physics_solver: { status: "ran", concordance_gate: "veto" },
    })).toBe("blocked");
  });

  it("combination: hard_fail + dispatch_error + mock → blocked (not calibrated)", () => {
    expect(renderMethodology({
      hard_fail: true,
      mock_sidecar: true,
      physics_solver: { status: "dispatch_error" },
    })).toBe("blocked");
    expect(allowsPositiveReadinessLanguage({
      hard_fail: true,
      mock_sidecar: true,
      physics_solver: { status: "dispatch_error" },
    })).toBe(false);
  });
});

// ── (4) Non-solver-backed always gets a visible caveat ───────────

describe("non-solver-backed runs always caveated (CC-BE-GOV-0111)", () => {
  const NON_BACKED_CASES: Array<{ label: string; input: Parameters<typeof renderNoBackingCaveat>[0] }> = [
    { label: "hard_fail", input: { hard_fail: true } },
    { label: "promotion_blocked", input: { promotion_blocked: true } },
    { label: "solver_veto", input: { solver_veto_reason: "x" } },
    { label: "mock_sidecar", input: { mock_sidecar: true } },
    { label: "status=unavailable", input: { physics_solver: { status: "unavailable" } } },
    { label: "status=validation_failed", input: { physics_solver: { status: "validation_failed" } } },
    { label: "status=dispatch_error", input: { physics_solver: { status: "dispatch_error" } } },
    { label: "status=not_registered", input: { physics_solver: { status: "not_registered" } } },
    { label: "status=not_run", input: { physics_solver: { status: "not_run" } } },
    { label: "empty input", input: {} },
  ];

  it.each(NON_BACKED_CASES)("$label → non-empty caveat string", ({ input }) => {
    const caveat = renderNoBackingCaveat(input);
    expect(caveat).not.toBeNull();
    expect(typeof caveat).toBe("string");
    expect((caveat as string).length).toBeGreaterThan(0);
  });

  it("solver-backed (ran + confirmed) returns null — no caveat", () => {
    expect(renderNoBackingCaveat({
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBeNull();
  });
});
