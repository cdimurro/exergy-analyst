/**
 * Tests for taxonomy translations (CC-BE-SCHEMA-0007).
 *
 * Hard contracts these tests enforce:
 *   1. NO raw "C0" / "C1" / "C2" / "IRIS-3" tokens leak into any
 *      user-facing string (headline, explanation, badgeLabel).
 *   2. Every tier produces a domain-specific explanation —
 *      "this technology" is acceptable as a fallback only when
 *      no domain is provided.
 *   3. Upgrade paths are ALWAYS actionable when surfaced (never
 *      "calibration_tier should be elevated to C2" — that's
 *      backend-speak).
 */
import {
  explainCalibrationTier,
  explainConfidence,
  explainHardFail,
  explainModuleVerdict,
  explainPeerMatch,
  explainBrief,
} from "../lib/taxonomy-translations";

// ---------------------------------------------------------------------------
// Hard rule: no raw taxonomy tokens leak to the user
// ---------------------------------------------------------------------------

const FORBIDDEN_RAW_TOKENS = [
  "C0-schema",
  "C1-provisional",
  "C2-benchmarked",
  "C2-concordance",
  "C3-validated",
  "C4-replicated",
  "C5-deployed",
  "IRIS-",
  "U0",
  "U1",
  "U2",
  "U3",
];

// CC-BE-SCHEMA-0008: user-facing prose must also stay silent about
// platform mechanics. These are infrastructure terms the user should
// never need to know about. Test fails if any leak into headline /
// explanation / upgradePath / badgeLabel.
const FORBIDDEN_INTERNAL_TERMS = [
  "reference device",       // internal data-structure name
  "curated peer",           // internal data-structure name
  "kernel prior",           // internal mechanic
  "kernel-level",           // internal mechanic
  "physics solver",         // internal architecture
  "physics-solver",
  "concordance fixture",    // internal fixture vocabulary
  "concordant fixture",
  "primary-source citation", // internal promotion criteria
  "operating basis",        // internal promotion criteria
  "calibration upgrade",    // internal promotion verb
  "schema maturity",        // internal taxonomy
  "fixture",                // internal vocabulary (catches "benchmark fixture" too)
];

function assertNoRawTokens(text: string, context: string) {
  for (const tok of FORBIDDEN_RAW_TOKENS) {
    expect(text).not.toContain(tok);
  }
  // The bare "C" + digit pattern shouldn't appear adjacent to "tier"
  // / "label" — catches "tier C0" leaks.
  expect(text.toLowerCase()).not.toMatch(/tier\s+c\d/);
}

function assertNoInternalMechanics(text: string, context: string) {
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_INTERNAL_TERMS) {
    expect(lower).not.toContain(term);
  }
}

describe("explainCalibrationTier — no raw tokens leak", () => {
  it.each([
    "C0-schema",
    "C0-minimal",
    "C1-provisional",
    "C2-benchmarked",
    "C2-concordance",
    "C3-validated",
    "C4-replicated",
    "C5-deployed",
  ])("tier %s produces no raw taxonomy tokens", (tier) => {
    const result = explainCalibrationTier({
      tier,
      domain: "heat_pump_systems",
      familyLabel: "cold-climate ASHP",
    });
    assertNoRawTokens(result.headline, `headline for ${tier}`);
    assertNoRawTokens(result.explanation, `explanation for ${tier}`);
    assertNoRawTokens(result.badgeLabel, `badge for ${tier}`);
    if (result.upgradePath) {
      assertNoRawTokens(result.upgradePath, `upgradePath for ${tier}`);
    }
  });
});

describe("explainCalibrationTier — no roadmap-implying phrases (CC-BE-SCHEMA-0009)", () => {
  // "haven't yet", "not yet", "we'll", "soon", "in the future" all
  // imply a platform commitment to fix the gap. Translation prose
  // should describe what we WEREN'T able to do for THIS assessment,
  // never imply we WILL fix it later.
  const FORBIDDEN_ROADMAP_PHRASES = [
    "haven't yet",
    "have not yet",
    "not yet",
    "don't yet",
    "do not yet",
    "we'll",
    " soon",
    "in the future",
    "going to",
    "will be",
  ];
  it.each([
    "C0-schema",
    "C1-provisional",
    "C2-benchmarked",
    "C3-validated",
  ])("tier %s does not imply a future-fix roadmap", (tier) => {
    const result = explainCalibrationTier({
      tier,
      peerCount: 1,
      nearestPeerName: "Test Peer",
      domain: "heat_pump_systems",
      familyLabel: "cold-climate ASHP",
    });
    const allText = [
      result.headline,
      result.explanation,
      result.badgeLabel,
      result.upgradePath || "",
    ].join(" | ").toLowerCase();
    for (const phrase of FORBIDDEN_ROADMAP_PHRASES) {
      expect(allText).not.toContain(phrase);
    }
  });
});

describe("explainCalibrationTier — positive-first ordering (CC-BE-SCHEMA-0009)", () => {
  // When the prose contains a "weren't able to" / limitation
  // statement, it must FOLLOW a positive grounding statement —
  // never lead with the limitation.
  it("C0 explanation leads with what we WERE able to do", () => {
    const r = explainCalibrationTier({
      tier: "C0-schema",
      domain: "carbon_capture_systems",
      familyLabel: "DAC solid sorbent",
    });
    const text = r.explanation;
    const positiveIdx = text.toLowerCase().indexOf("assessed against");
    const limitationIdx = text.toLowerCase().indexOf("weren't able");
    expect(positiveIdx).toBeGreaterThanOrEqual(0);
    expect(limitationIdx).toBeGreaterThanOrEqual(0);
    expect(positiveIdx).toBeLessThan(limitationIdx);
  });
});

describe("explainCalibrationTier — no internal mechanics leak (CC-BE-SCHEMA-0008)", () => {
  it.each([
    "C0-schema",
    "C0-minimal",
    "C1-provisional",
    "C2-benchmarked",
    "C2-concordance",
    "C3-validated",
    "C4-replicated",
    "C5-deployed",
    "Z99-mystery",
  ])("tier %s does not leak platform-internal terms", (tier) => {
    const result = explainCalibrationTier({
      tier,
      peerCount: 2,
      nearestPeerName: "Mitsubishi Hyper-Heat",
      domain: "heat_pump_systems",
      familyLabel: "cold-climate ASHP",
    });
    assertNoInternalMechanics(result.headline, `headline for ${tier}`);
    assertNoInternalMechanics(result.explanation, `explanation for ${tier}`);
    assertNoInternalMechanics(result.badgeLabel, `badge for ${tier}`);
    if (result.upgradePath) {
      assertNoInternalMechanics(result.upgradePath, `upgradePath for ${tier}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier-specific explanation contracts
// ---------------------------------------------------------------------------

describe("explainCalibrationTier — C0-schema", () => {
  it("is honest about being general-category, names the family", () => {
    const r = explainCalibrationTier({
      tier: "C0-schema",
      domain: "heat_pump_systems",
      familyLabel: "cold-climate ASHP",
    });
    expect(r.explanation.toLowerCase()).toContain("cold-climate ashp");
    expect(r.explanation.toLowerCase()).toContain("directional");
    expect(r.intent).toBe("low");
  });

  it("upgrade path is user-actionable (uploading data), not platform-action", () => {
    const r = explainCalibrationTier({
      tier: "C0-schema",
      domain: "carbon_capture_systems",
      familyLabel: "DAC solid sorbent",
    });
    expect(r.upgradePath).toBeTruthy();
    // User can take this action: upload data
    expect(r.upgradePath!.toLowerCase()).toMatch(
      /uploading|operating performance|test reports|certifications/,
    );
    // Must NOT instruct the platform team
    expect(r.upgradePath!.toLowerCase()).not.toContain("curate");
    expect(r.upgradePath!.toLowerCase()).not.toContain("reference device");
  });

  it("badge label is plain language", () => {
    const r = explainCalibrationTier({ tier: "C0-schema" });
    expect(r.badgeLabel).toBe("Directional");
  });
});

describe("explainCalibrationTier — C1-provisional", () => {
  it("names the specific product compared against (when known)", () => {
    const r = explainCalibrationTier({
      tier: "C1-provisional",
      peerCount: 1,
      nearestPeerName: "Mitsubishi Hyper-Heat MUZ-FH18NA",
      domain: "heat_pump_systems",
      familyLabel: "cold-climate ASHP",
    });
    expect(r.headline).toContain("Mitsubishi Hyper-Heat MUZ-FH18NA");
    expect(r.intent).toBe("moderate");
  });

  it("describes 'similar products' when peer name unavailable", () => {
    const r = explainCalibrationTier({
      tier: "C1-provisional",
      peerCount: 3,
      domain: "fuel_cell_systems",
      familyLabel: "PEM fuel cell",
    });
    // Plain language — NOT "3 curated peers"
    expect(r.headline.toLowerCase()).toContain("3 similar");
    expect(r.headline.toLowerCase()).not.toContain("curated");
    expect(r.headline.toLowerCase()).not.toContain("peer");
  });
});

describe("explainCalibrationTier — C2-benchmarked", () => {
  it("indicates high confidence + names the technology category", () => {
    const r = explainCalibrationTier({
      tier: "C2-benchmarked",
      peerCount: 2,
      domain: "small_modular_nuclear",
      familyLabel: "light-water SMR",
    });
    expect(r.intent).toBe("high");
    expect(r.headline.toLowerCase()).toContain("benchmarked");
    expect(r.explanation.toLowerCase()).toContain("light-water smr");
    // Must NOT leak platform mechanics
    expect(r.explanation.toLowerCase()).not.toContain("primary-source");
    expect(r.explanation.toLowerCase()).not.toContain("operating basis");
  });
});

describe("explainCalibrationTier — unknown tier", () => {
  it("falls back to a safe statement", () => {
    const r = explainCalibrationTier({ tier: "Z99-mystery" });
    expect(r.intent).toBe("low");
    expect(r.headline.toLowerCase()).toContain("not classified");
  });
});

// ---------------------------------------------------------------------------
// Module verdict translation
// ---------------------------------------------------------------------------

describe("explainModuleVerdict", () => {
  it("translates pass to 'Strong' (not raw 'pass')", () => {
    const r = explainModuleVerdict("pass", { moduleLabel: "Performance" });
    expect(r.label).toBe("Strong");
    expect(r.intent).toBe("good");
  });

  it("translates fail to 'Not ready'", () => {
    const r = explainModuleVerdict("fail", { moduleLabel: "Safety" });
    expect(r.label).toBe("Not ready");
    expect(r.intent).toBe("concern");
  });

  it("translates blocked to 'Insufficient data'", () => {
    const r = explainModuleVerdict("blocked", { moduleLabel: "Economics" });
    expect(r.label).toBe("Insufficient data");
    expect(r.intent).toBe("blocker");
  });

  it("treats deferred as not-applicable", () => {
    const r = explainModuleVerdict("deferred", { moduleLabel: "Manufacturing" });
    expect(r.label).toBe("Not applicable yet");
  });
});

// ---------------------------------------------------------------------------
// Confidence translation
// ---------------------------------------------------------------------------

describe("explainConfidence", () => {
  it("0.85 → high confidence", () => {
    const r = explainConfidence(0.85);
    expect(r.label).toBe("High confidence");
    expect(r.intent).toBe("high");
    expect(r.displayPct).toBe(85);
  });

  it("0.5 → moderate confidence", () => {
    const r = explainConfidence(0.5);
    expect(r.label).toBe("Moderate confidence");
    expect(r.intent).toBe("moderate");
  });

  it("0.2 → low confidence", () => {
    const r = explainConfidence(0.2);
    expect(r.label).toBe("Low confidence");
    expect(r.intent).toBe("low");
  });

  it("null/NaN → 'not measured' with null displayPct (never silently 0%)", () => {
    for (const missing of [null, undefined, NaN]) {
      const r = explainConfidence(missing as any);
      expect(r.intent).toBe("low");
      expect(r.label).toBe("Confidence not measured");
      // Critical: displayPct must be null, NOT 0. Showing "0%" would
      // misread as "we measured zero confidence" instead of "we don't
      // have a measurement to share". Reviewer caught this in 0007.
      expect(r.displayPct).toBeNull();
    }
  });

  it("explicit 0 confidence is distinct from not measured", () => {
    const r = explainConfidence(0);
    expect(r.label).toBe("Low confidence");
    expect(r.displayPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hard-fail translation
// ---------------------------------------------------------------------------

describe("explainHardFail", () => {
  it("null when no reasons", () => {
    expect(explainHardFail([])).toBeNull();
  });

  it("strips module: prefix from headline", () => {
    const r = explainHardFail([
      "physics: COP exceeds Carnot ceiling — 25.0 > 15.0",
    ]);
    expect(r!.headline).not.toContain("physics:");
    expect(r!.headline.toLowerCase()).toContain("cop");
  });

  it("counts multiple blockers in body", () => {
    const r = explainHardFail([
      "physics: a > b",
      "safety: c > d",
      "economics: e > f",
    ]);
    expect(r!.explanation).toContain("3 blockers");
  });
});

// ---------------------------------------------------------------------------
// Peer-match translation
// ---------------------------------------------------------------------------

describe("explainPeerMatch", () => {
  it("null when no peer_matching block", () => {
    expect(explainPeerMatch(null)).toBeNull();
    expect(explainPeerMatch(undefined)).toBeNull();
  });

  it("reports no-peer case in plain language (no internal terms)", () => {
    const r = explainPeerMatch({
      peer_count: 0,
      upgrade_guidance: "ignored — backend prose stripped from user surface",
    }, { domain: "carbon_capture_systems", familyLabel: "DAC solid sorbent" });
    expect(r!.headline.toLowerCase()).toContain("dac solid sorbent");
    // Explanation must NOT carry backend-speak even if upgrade_guidance
    // contains it — translator owns the user-facing wording.
    expect(r!.explanation.toLowerCase()).not.toContain("curated");
    expect(r!.explanation.toLowerCase()).not.toContain("reference device");
  });

  it("describes close-peer case with plain language", () => {
    const r = explainPeerMatch({
      peer_count: 1,
      nearest_peer: {
        commercial_name: "Mitsubishi Hyper-Heat",
        overall_distance_pct: 3.5,
        n_matched_kpis: 4,
      },
    }, { domain: "heat_pump_systems", familyLabel: "cold-climate ASHP" });
    expect(r!.headline).toContain("Very close to Mitsubishi Hyper-Heat");
    // Plain word "parameter" — not internal jargon "KPI"
    expect(r!.explanation).toContain("4 parameters");
    expect(r!.explanation.toLowerCase()).not.toContain("kpi");
  });

  it("describes far-peer case differently", () => {
    const r = explainPeerMatch({
      peer_count: 1,
      nearest_peer: {
        commercial_name: "Generic Peer",
        overall_distance_pct: 45,
        n_matched_kpis: 2,
      },
    });
    expect(r!.headline.toLowerCase()).toContain("noticeably different from");
  });

  it("negative distance uses absolute magnitude for proximity band", () => {
    // Candidate below peer (-5%) is just as close as candidate above peer (+5%)
    const r = explainPeerMatch({
      peer_count: 1,
      nearest_peer: {
        commercial_name: "Test Peer",
        overall_distance_pct: -5,
        n_matched_kpis: 3,
      },
    });
    expect(r!.headline.toLowerCase()).toContain("very close to");
  });

  it("extreme distance (>200%) flags as unreliable, not 'very close'", () => {
    const r = explainPeerMatch({
      peer_count: 1,
      nearest_peer: {
        commercial_name: "Mismatched Peer",
        overall_distance_pct: 999,
        n_matched_kpis: 2,
      },
    });
    expect(r!.headline.toLowerCase()).toContain("unreliable");
    expect(r!.explanation.toLowerCase()).toContain("unit mismatch");
  });

  it("non-finite distance (Infinity, NaN) treated as 'no numeric distance'", () => {
    for (const bad of [Infinity, -Infinity, NaN]) {
      const r = explainPeerMatch({
        peer_count: 1,
        nearest_peer: {
          commercial_name: "Edge Case Peer",
          overall_distance_pct: bad,
          n_matched_kpis: 2,
        },
      });
      // Must not leak 'Infinity' or 'NaN' into prose
      expect(r!.headline.toLowerCase()).not.toContain("infinity");
      expect(r!.explanation.toLowerCase()).not.toContain("infinity");
      expect(r!.explanation.toLowerCase()).not.toContain("nan");
      expect(r!.headline).toContain("Compared against");
    }
  });
});

// ---------------------------------------------------------------------------
// Bundle convenience
// ---------------------------------------------------------------------------

describe("explainBrief", () => {
  it("produces all four explanation blocks for a peer-backed brief", () => {
    const bundle = explainBrief({
      calibration_tier: "C1-provisional",
      avg_module_confidence: 0.6,
      hard_fail: false,
      domain: "heat_pump_systems",
      technology_family: "ashp_cold_climate",
      peer_matching: {
        peer_count: 1,
        nearest_peer: {
          commercial_name: "Mitsubishi Hyper-Heat MUZ-FH18NA",
          overall_distance_pct: 5.0,
          n_matched_kpis: 4,
        },
        upgrade_guidance: null,
      },
    });
    expect(bundle.calibration.intent).toBe("moderate");
    expect(bundle.confidence.intent).toBe("moderate");
    expect(bundle.hardFail).toBeNull();
    expect(bundle.peerMatch).not.toBeNull();
    expect(bundle.peerMatch!.headline).toContain("Mitsubishi");
    // No raw tokens anywhere
    const allText = [
      bundle.calibration.headline,
      bundle.calibration.explanation,
      bundle.calibration.badgeLabel,
      bundle.confidence.label,
      bundle.confidence.explanation,
      bundle.peerMatch!.headline,
      bundle.peerMatch!.explanation,
    ].join(" | ");
    assertNoRawTokens(allText, "bundle output");
  });

  it("includes hard-fail explanation when present", () => {
    const bundle = explainBrief({
      calibration_tier: "C0-schema",
      hard_fail: true,
      hard_fail_reasons: ["physics: COP exceeds Carnot — 25 > 15"],
      domain: "heat_pump_systems",
    });
    expect(bundle.hardFail).not.toBeNull();
    expect(bundle.hardFail!.headline.toLowerCase()).toContain("cop");
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: domain labels never leak the raw kernel_id
// ---------------------------------------------------------------------------

describe("domain labelling", () => {
  it("known domain renders friendly label", () => {
    const r = explainCalibrationTier({
      tier: "C0-schema",
      domain: "heat_pump_systems",
    });
    // 'heat_pump_systems' (raw) should NOT appear; 'heat pump' should
    expect(r.explanation).not.toContain("heat_pump_systems");
    expect(r.explanation.toLowerCase()).toContain("heat pump");
  });

  it("unknown domain humanizes the kernel_id", () => {
    const r = explainCalibrationTier({
      tier: "C0-schema",
      domain: "obscure_kernel_xyz",
    });
    // No underscores in user-facing text
    expect(r.explanation).not.toContain("obscure_kernel_xyz");
    expect(r.explanation).toContain("obscure kernel xyz");
  });
});
