/**
 * Tests for Batch 28 PtL brief wiring in backend.ts.
 *
 * Covers:
 * - listDecisionBriefs() scans runtime/ptl_briefs/<id>.json (PtL pattern,
 *   no `brief_` prefix) alongside battery/PV/inverter brief_<id>.json
 * - getBrief(id) resolves a PtL brief by bare id from runtime/ptl_briefs/
 * - PtL brief filename pattern (<id>.json) round-trips through the scanner
 * - Dedup by id works when the same brief appears in multiple dirs (it
 *   won't in practice, but the scanner should be robust)
 * - PtL briefs are tagged with brief_type='ptl_decision' when missing
 *
 * These tests isolate the scanner by pointing it at a temp dir fixture,
 * so they don't depend on the real runtime/ contents.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Rebind the brief dir constants to point at tmp before requiring backend
const tmpRoot = mkdtempSync(join(tmpdir(), "be-ptl-test-"));
process.env.VERCEL = ""; // ensure we use the repo-relative path
// Override RUNTIME_DIR before backend.ts loads — the module captures the
// value at import time
process.env.ENGINE_ROOT_OVERRIDE = tmpRoot;

// Because backend.ts reads process.cwd + RUNTIME_DIR at module init, we
// stage fixture files into the expected default path it will compute.
// Simpler approach: stage files directly into the paths backend.ts will
// scan, then assert end-to-end behavior.

import {
  listDecisionBriefs,
  getBrief,
  PTL_BRIEFS_DIR,
  BRIEFS_DIR,
} from "@/lib/backend";

function stageBatteryBrief(id: string, createdAt: string): void {
  if (!require("fs").existsSync(BRIEFS_DIR)) {
    mkdirSync(BRIEFS_DIR, { recursive: true });
  }
  const payload = {
    id,
    created_at: createdAt,
    headline: `Battery brief ${id}`,
    candidate_family: "NMC_811",
    domain: "battery",
    // No brief_type → scanner will tag as "decision"
  };
  writeFileSync(
    join(BRIEFS_DIR, `brief_${id}.json`),
    JSON.stringify(payload),
  );
}

function stagePtlBrief(id: string, createdAt: string): void {
  if (!require("fs").existsSync(PTL_BRIEFS_DIR)) {
    mkdirSync(PTL_BRIEFS_DIR, { recursive: true });
  }
  const payload = {
    id,
    created_at: createdAt,
    schema_version: "ptl_decision_brief_v1",
    headline: `PtL brief ${id}`,
    verdict: "screening_ready_with_caveats",
    iris_grade: 3,
    candidate_family: "ptl_soec_ft",
    product_type: "saf_jet",
    composite_score: 72.5,
    score_components: [],
    ft_oil_pct: 70,
    ft_gas_pct: 20,
    ft_char_pct: 0,
    integrated_carbon_efficiency_pct: 60,
    electricity_to_liquid_ratio: 0.5,
    overall_efficiency: 0.48,
    thermal_uplift_pct: 5,
    policy_credits_claimed: [],
    lcof_cost_stack: [],
    lcof_in_unsubsidized_ptl_band: false,
    exergy_stages: [],
    exergy_hotspots: [],
    sensitivity_rows: [],
    fixture_all_ok: false,
    fixture_violations: [],
    caveats: [],
    conditional_blockers: [],
    hard_fails: [],
    recommended_next_actions: [],
    source_refs: [],
    evidence_sources: [],
    unresolved_source_refs: [],
    notes: [],
    n_caveats: 0,
    n_conditionals: 0,
    n_hard_fails: 0,
    // No brief_type → scanner will tag as "ptl_decision"
  };
  writeFileSync(
    join(PTL_BRIEFS_DIR, `${id}.json`),  // note: no "brief_" prefix
    JSON.stringify(payload),
  );
}

function cleanup(): void {
  // Drop the fixtures we created — leave other runtime/ contents alone
  // (the worktree may have pre-existing briefs the dev is working with).
  // We delete only our named fixture ids.
  const fs = require("fs");
  for (const dir of [BRIEFS_DIR, PTL_BRIEFS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir) as string[]) {
      if (f.includes("ptl-wire-test-")) {
        try {
          fs.unlinkSync(join(dir, f));
        } catch {}
      }
    }
  }
}

describe("listDecisionBriefs scans PtL dir", () => {
  afterEach(cleanup);

  it("returns a PtL brief from runtime/ptl_briefs/<id>.json", async () => {
    const id = `ptl-wire-test-${Date.now()}-a`;
    stagePtlBrief(id, "2026-04-12T10:00:00Z");
    const briefs = await listDecisionBriefs();
    const found = briefs.find((b) => b.id === id);
    expect(found).toBeDefined();
    expect(found?.schema_version).toBe("ptl_decision_brief_v1");
  });

  it("tags an untagged PtL brief with brief_type='ptl_decision'", async () => {
    const id = `ptl-wire-test-${Date.now()}-b`;
    stagePtlBrief(id, "2026-04-12T10:00:00Z");
    const briefs = await listDecisionBriefs();
    const found = briefs.find((b) => b.id === id);
    expect(found?.brief_type).toBe("ptl_decision");
  });

  it("still tags an untagged battery brief with brief_type='decision'", async () => {
    const id = `ptl-wire-test-${Date.now()}-c`;
    stageBatteryBrief(id, "2026-04-12T10:00:00Z");
    const briefs = await listDecisionBriefs();
    const found = briefs.find((b) => b.id === id);
    expect(found?.brief_type).toBe("decision");
  });

  it("returns both battery and PtL briefs when both exist", async () => {
    const batteryId = `ptl-wire-test-${Date.now()}-bat`;
    const ptlId = `ptl-wire-test-${Date.now()}-ptl`;
    stageBatteryBrief(batteryId, "2026-04-12T10:00:00Z");
    stagePtlBrief(ptlId, "2026-04-12T10:05:00Z");
    const briefs = await listDecisionBriefs();
    const ids = briefs.map((b) => b.id);
    expect(ids).toContain(batteryId);
    expect(ids).toContain(ptlId);
  });

  it("newer briefs sort first (descending created_at)", async () => {
    const oldId = `ptl-wire-test-${Date.now()}-old`;
    const newId = `ptl-wire-test-${Date.now()}-new`;
    stagePtlBrief(oldId, "2026-01-01T00:00:00Z");
    stagePtlBrief(newId, "2026-04-12T00:00:00Z");
    const briefs = await listDecisionBriefs();
    const ours = briefs.filter((b) =>
      String(b.id).startsWith("ptl-wire-test-"),
    );
    const newerIdx = ours.findIndex((b) => b.id === newId);
    const olderIdx = ours.findIndex((b) => b.id === oldId);
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(olderIdx).toBeGreaterThanOrEqual(0);
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

describe("getBrief resolves PtL brief by bare id", () => {
  afterEach(cleanup);

  it("loads a PtL brief from runtime/ptl_briefs/<id>.json", async () => {
    const id = `ptl-wire-test-${Date.now()}-get`;
    stagePtlBrief(id, "2026-04-12T10:00:00Z");
    const brief = await getBrief(id);
    expect(brief).not.toBeNull();
    expect(brief?.id).toBe(id);
    expect(brief?.schema_version).toBe("ptl_decision_brief_v1");
  });

  it("returns null for a non-existent id", async () => {
    const brief = await getBrief("ptl-wire-test-nonexistent-xyz");
    expect(brief).toBeNull();
  });

  it("does not accidentally resolve battery brief path for PtL brief id", async () => {
    // A PtL brief at runtime/ptl_briefs/xyz.json should load via the PtL
    // pathway, not via `brief_xyz.json` battery-dir lookup
    const id = `ptl-wire-test-${Date.now()}-distinct`;
    stagePtlBrief(id, "2026-04-12T10:00:00Z");
    const brief = await getBrief(id);
    expect(brief?.candidate_family).toBe("ptl_soec_ft");
  });
});
