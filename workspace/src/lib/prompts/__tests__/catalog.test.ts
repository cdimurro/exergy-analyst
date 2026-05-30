/**
 * Catalog integrity, selection, policy, and formatting tests.
 *
 * These catalogs are policy infrastructure: they must sort deterministically,
 * filter correctly by domain/stage/brief-type, and map (severity, stage) to
 * verdict ceilings without surprises. Prompt formatting is snapshot-tested so
 * any change to injected prompt text is visible in review.
 */

import {
  RATIONALIZATIONS,
  formatRationalizationsForPrompt,
  getRationalization,
  selectRationalizations,
} from "../rationalizations";
import {
  RED_FLAGS,
  formatRedFlagsForPrompt,
  getRedFlag,
  resolveCeiling,
  selectRedFlags,
} from "../red-flags";
import {
  LLM_ONLY_CONFIDENCE_CAP,
  LLM_ONLY_MODULES,
  applyModuleConfidenceCap,
  briefTypeApplies,
  ceilingForStage,
  countUnresolved,
  countUnresolvedBlockers,
  domainApplies,
  sortByPriorityThenKey,
  stageApplies,
} from "../policy";
import type { Stage } from "../types";

// ── Catalog integrity ───────────────────────────────────────────

describe("catalog integrity", () => {
  test("rationalization keys are unique", () => {
    const keys = RATIONALIZATIONS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("red-flag keys are unique", () => {
    const keys = RED_FLAGS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every rationalization declares a non-empty pattern and module owner", () => {
    for (const r of RATIONALIZATIONS) {
      expect(r.pattern.length).toBeGreaterThan(0);
      expect(r.module_owner).toBeTruthy();
      expect(r.applies_to_brief_type.length).toBeGreaterThan(0);
      expect(r.required_disconfirming_checks.length).toBeGreaterThan(0);
    }
  });

  test("every red flag declares a clearing evidence path", () => {
    for (const f of RED_FLAGS) {
      expect(f.clearing_evidence.length).toBeGreaterThan(0);
      expect(f.evidence_artifacts_required.length).toBeGreaterThan(0);
      expect(f.default_confidence_cap).toBeGreaterThanOrEqual(0);
      expect(f.default_confidence_cap).toBeLessThanOrEqual(1);
    }
  });

  test("lookup helpers return the entry by key", () => {
    const r = getRationalization("pilot_equals_commercial");
    expect(r?.pattern).toContain("pilot");
    const f = getRedFlag("scale_jump_too_large");
    expect(f?.severity).toBe("blocker");
  });

  test("lookup helpers return undefined for unknown keys", () => {
    expect(getRationalization("does_not_exist")).toBeUndefined();
    expect(getRedFlag("does_not_exist")).toBeUndefined();
  });
});

// ── Policy: stage → ceiling mapping ─────────────────────────────

describe("ceilingForStage", () => {
  test("discovery never escalates, regardless of severity", () => {
    expect(ceilingForStage("caution", "discovery")).toBe("none");
    expect(ceilingForStage("blocker", "discovery")).toBe("none");
  });

  test("pilot_diligence escalates blockers to conditional only", () => {
    expect(ceilingForStage("caution", "pilot_diligence")).toBe("none");
    expect(ceilingForStage("blocker", "pilot_diligence")).toBe("conditional");
  });

  test("deployment_diligence escalates blockers to blocked, cautions to conditional", () => {
    expect(ceilingForStage("caution", "deployment_diligence")).toBe("conditional");
    expect(ceilingForStage("blocker", "deployment_diligence")).toBe("blocked");
  });

  test("resolveCeiling uses the flag's severity", () => {
    const blocker = getRedFlag("scale_jump_too_large")!;
    expect(resolveCeiling(blocker, "discovery")).toBe("none");
    expect(resolveCeiling(blocker, "deployment_diligence")).toBe("blocked");

    const caution = getRedFlag("evidence_only_from_affiliates")!;
    expect(resolveCeiling(caution, "deployment_diligence")).toBe("conditional");
  });
});

// ── Filter helpers ──────────────────────────────────────────────

describe("filter helpers", () => {
  test("stageApplies accepts later or equal stages", () => {
    expect(stageApplies("discovery", "discovery")).toBe(true);
    expect(stageApplies("discovery", "deployment_diligence")).toBe(true);
    expect(stageApplies("pilot_diligence", "discovery")).toBe(false);
  });

  test("domainApplies accepts matching domain or generic", () => {
    expect(domainApplies(["battery"], "battery")).toBe(true);
    expect(domainApplies(["generic"], "power_to_liquid")).toBe(true);
    expect(domainApplies(["battery"], "power_to_liquid")).toBe(false);
  });

  test("briefTypeApplies is an exact-match membership check", () => {
    expect(briefTypeApplies(["diligence"], "diligence")).toBe(true);
    expect(briefTypeApplies(["research"], "diligence")).toBe(false);
  });
});

// ── Selection: context-aware filtering ──────────────────────────

describe("selection", () => {
  test("power_to_liquid + deployment + diligence loads PtL-relevant flags", () => {
    const flags = selectRedFlags({
      domain: "power_to_liquid",
      stage: "deployment_diligence",
      brief_type: "diligence",
    });
    const keys = flags.map((f) => f.key);
    // PtL-scoped flags
    expect(keys).toContain("feedstock_price_static");
    expect(keys).toContain("environmental_permit_load_unmodeled");
    expect(keys).toContain("replacement_cadence_omitted");
    // Generic flags
    expect(keys).toContain("scale_jump_too_large");
    expect(keys).toContain("no_independent_engineer_report");
  });

  test("battery + research + discovery loads only discovery-stage research-applicable entries", () => {
    const flags = selectRedFlags({
      domain: "battery",
      stage: "discovery",
      brief_type: "research",
    });
    // Deployment-only flags must not appear at discovery + research
    const keys = flags.map((f) => f.key);
    expect(keys).not.toContain("no_independent_engineer_report");
    expect(keys).not.toContain("offtake_is_loi_only");
  });

  test("diligence brief loads more entries than research at the same stage+domain", () => {
    const researchCount = selectRedFlags({
      domain: "power_to_liquid",
      stage: "deployment_diligence",
      brief_type: "research",
    }).length;
    const diligenceCount = selectRedFlags({
      domain: "power_to_liquid",
      stage: "deployment_diligence",
      brief_type: "diligence",
    }).length;
    expect(diligenceCount).toBeGreaterThan(researchCount);
  });

  test("selection results are sorted stably by priority then key", () => {
    const entries = selectRedFlags({
      domain: "power_to_liquid",
      stage: "deployment_diligence",
      brief_type: "diligence",
    });
    // Criticals come before highs
    const firstHighIdx = entries.findIndex((e) => e.priority === "high");
    const lastCriticalIdx = entries
      .map((e, i) => (e.priority === "critical" ? i : -1))
      .reduce((m, i) => Math.max(m, i), -1);
    if (firstHighIdx !== -1 && lastCriticalIdx !== -1) {
      expect(lastCriticalIdx).toBeLessThan(firstHighIdx);
    }
    // Within a priority, sorted alphabetically by key
    const criticals = entries.filter((e) => e.priority === "critical");
    const sortedKeys = [...criticals].map((e) => e.key).sort();
    expect(criticals.map((e) => e.key)).toEqual(sortedKeys);
  });

  test("rationalization selection respects stage gating", () => {
    const discoveryRs = selectRationalizations({
      domain: "power_to_liquid",
      stage: "discovery",
      brief_type: "research",
    });
    // pilot-stage-only entries should not appear at discovery
    const keys = discoveryRs.map((r) => r.key);
    expect(keys).not.toContain("offtake_is_secured");
    expect(keys).not.toContain("bop_is_standard_equipment");
  });
});

// ── sortByPriorityThenKey determinism ───────────────────────────

describe("sortByPriorityThenKey", () => {
  test("two runs produce identical output", () => {
    const input = [...RED_FLAGS];
    const a = sortByPriorityThenKey(input);
    const b = sortByPriorityThenKey(input);
    expect(a.map((x) => x.key)).toEqual(b.map((x) => x.key));
  });

  test("does not mutate input", () => {
    const input = [...RED_FLAGS];
    const inputKeysBefore = input.map((x) => x.key);
    sortByPriorityThenKey(input);
    expect(input.map((x) => x.key)).toEqual(inputKeysBefore);
  });
});

// ── Prompt formatting snapshots ─────────────────────────────────

describe("prompt formatting snapshots", () => {
  test("formatRationalizationsForPrompt — PtL diligence deployment", () => {
    const entries = selectRationalizations({
      domain: "power_to_liquid",
      stage: "deployment_diligence",
      brief_type: "diligence",
    });
    expect(formatRationalizationsForPrompt(entries)).toMatchSnapshot();
  });

  test("formatRedFlagsForPrompt — PtL diligence deployment", () => {
    const entries = selectRedFlags({
      domain: "power_to_liquid",
      stage: "deployment_diligence",
      brief_type: "diligence",
    });
    expect(formatRedFlagsForPrompt(entries)).toMatchSnapshot();
  });

  test("formatRedFlagsForPrompt — battery research discovery", () => {
    const entries = selectRedFlags({
      domain: "battery",
      stage: "discovery",
      brief_type: "research",
    });
    expect(formatRedFlagsForPrompt(entries)).toMatchSnapshot();
  });
});

// ── Module-level confidence cap ─────────────────────────────────

describe("applyModuleConfidenceCap", () => {
  test("LLM-only modules with no non-LLM evidence are capped at the ceiling", () => {
    for (const mod of LLM_ONLY_MODULES) {
      expect(applyModuleConfidenceCap(mod, 0.7, false)).toBe(LLM_ONLY_CONFIDENCE_CAP);
      expect(applyModuleConfidenceCap(mod, 0.9, false)).toBe(LLM_ONLY_CONFIDENCE_CAP);
    }
  });

  test("LLM-only modules with non-LLM evidence are not capped", () => {
    expect(applyModuleConfidenceCap("regulatory", 0.8, true)).toBe(0.8);
    expect(applyModuleConfidenceCap("manufacturing", 0.9, true)).toBe(0.9);
  });

  test("non-LLM-only modules are never capped by this rule", () => {
    expect(applyModuleConfidenceCap("physics", 0.9, false)).toBe(0.9);
    expect(applyModuleConfidenceCap("performance", 0.8, false)).toBe(0.8);
    expect(applyModuleConfidenceCap("economics", 0.7, false)).toBe(0.7);
  });

  test("values below the cap pass through unchanged", () => {
    expect(applyModuleConfidenceCap("regulatory", 0.4, false)).toBe(0.4);
  });
});

// ── Count helpers ───────────────────────────────────────────────

describe("count helpers", () => {
  const fixtures = [
    { key: "a", status: "unresolved" as const, severity: "blocker" as const },
    { key: "b", status: "unresolved" as const, severity: "caution" as const },
    { key: "c", status: "cleared" as const, severity: "blocker" as const },
    { key: "d", status: "unresolved" as const, severity: "blocker" as const },
  ];

  test("countUnresolved counts only unresolved", () => {
    expect(countUnresolved(fixtures)).toBe(3);
  });

  test("countUnresolvedBlockers counts unresolved + blocker", () => {
    expect(countUnresolvedBlockers(fixtures)).toBe(2);
  });

  test("empty array returns zero", () => {
    expect(countUnresolved([])).toBe(0);
    expect(countUnresolvedBlockers([])).toBe(0);
  });
});

// ── Blocker flags map to deterministic policy outputs ───────────

describe("blocker policy determinism", () => {
  test("every blocker flag escalates to blocked at deployment_diligence", () => {
    const blockers = RED_FLAGS.filter((f) => f.severity === "blocker");
    for (const f of blockers) {
      expect(resolveCeiling(f, "deployment_diligence")).toBe("blocked");
    }
    // Sanity: there should be at least a few blockers
    expect(blockers.length).toBeGreaterThanOrEqual(3);
  });

  test("no caution flag ever reaches 'blocked'", () => {
    const cautions = RED_FLAGS.filter((f) => f.severity === "caution");
    const stages: Stage[] = ["discovery", "pilot_diligence", "deployment_diligence"];
    for (const f of cautions) {
      for (const s of stages) {
        expect(resolveCeiling(f, s)).not.toBe("blocked");
      }
    }
  });
});
