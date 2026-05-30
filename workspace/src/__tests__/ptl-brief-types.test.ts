/**
 * Tests for Batch 27 PtL brief TypeScript types + helpers.
 *
 * Covers:
 * - isPtlBrief type guard against PtL / non-PtL briefs
 * - verdictBadgeVariant mapping for every verdict
 * - formatOptional handles null / undefined / valid numbers
 * - Family / product / verdict humanizer maps are complete
 */

import {
  formatOptional,
  isPtlBrief,
  PTL_FAMILY_HUMAN,
  PTL_PRODUCT_HUMAN,
  PTL_VERDICT_HUMAN,
  verdictBadgeVariant,
  type PtlDecisionBrief,
  type PtlVerdict,
} from "@/lib/ptl-brief-types";

// ---------------------------------------------------------------------------
// isPtlBrief
// ---------------------------------------------------------------------------

describe("isPtlBrief", () => {
  it("detects a PtL brief by schema_version", () => {
    expect(isPtlBrief({ schema_version: "ptl_decision_brief_v1" })).toBe(true);
  });

  it("detects a PtL brief by verdict + family fallback", () => {
    expect(
      isPtlBrief({
        verdict: "screening_ready_with_caveats",
        candidate_family: "ptl_soec_ft",
      }),
    ).toBe(true);
  });

  it("rejects a battery (DeviceDecisionBrief) shape", () => {
    expect(
      isPtlBrief({
        schema_version: "device_decision_brief_v1.0",
        verdict: "deploy",
      }),
    ).toBe(false);
  });

  it("rejects null", () => {
    expect(isPtlBrief(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isPtlBrief(undefined)).toBe(false);
  });

  it("rejects plain string", () => {
    expect(isPtlBrief("not a brief")).toBe(false);
  });

  it("rejects a bare dict without schema markers", () => {
    expect(isPtlBrief({ foo: "bar" })).toBe(false);
  });

  it("rejects an object whose family is a non-PtL string", () => {
    expect(
      isPtlBrief({
        verdict: "screening_conditional",
        candidate_family: "battery_ecm",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verdictBadgeVariant
// ---------------------------------------------------------------------------

describe("verdictBadgeVariant", () => {
  it.each<[PtlVerdict, "success" | "warning" | "destructive" | "default"]>([
    ["screening_ready_with_caveats", "success"],
    ["screening_conditional", "warning"],
    ["screening_reject", "destructive"],
    ["screening_deferred", "default"],
  ])("maps %s → %s", (verdict, expected) => {
    expect(verdictBadgeVariant(verdict)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatOptional
// ---------------------------------------------------------------------------

describe("formatOptional", () => {
  it("returns em-dash for null", () => {
    expect(formatOptional(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatOptional(undefined)).toBe("—");
  });

  it("formats a number with no unit", () => {
    expect(formatOptional(42.56)).toBe("42.56");
  });

  it("formats with unit", () => {
    expect(formatOptional(800, "°C", 0)).toBe("800 °C");
  });

  it("formats with custom digits", () => {
    expect(formatOptional(0.123456, "", 4)).toBe("0.1235");
  });

  it("handles zero", () => {
    expect(formatOptional(0, "bar", 1)).toBe("0.0 bar");
  });
});

// ---------------------------------------------------------------------------
// Humanizer map completeness
// ---------------------------------------------------------------------------

describe("humanizer maps", () => {
  it("PTL_VERDICT_HUMAN has all verdicts", () => {
    const verdicts: PtlVerdict[] = [
      "screening_reject",
      "screening_conditional",
      "screening_ready_with_caveats",
      "screening_deferred",
    ];
    for (const v of verdicts) {
      expect(PTL_VERDICT_HUMAN[v]).toBeTruthy();
      expect(PTL_VERDICT_HUMAN[v].length).toBeGreaterThan(10);
    }
  });

  it("PTL_VERDICT_HUMAN never contains investment or decision-grade maturity claims", () => {
    // Bounded-framing invariant: PtL verdicts must not imply either
    const forbiddenPatterns = [/investment ready/i, /decision[-\s]?grade/i];
    for (const text of Object.values(PTL_VERDICT_HUMAN)) {
      for (const p of forbiddenPatterns) {
        expect(text).not.toMatch(p);
      }
    }
  });

  it("PTL_FAMILY_HUMAN covers all 3 PtL families", () => {
    expect(PTL_FAMILY_HUMAN.ptl_soec_ft).toContain("SOEC");
    expect(PTL_FAMILY_HUMAN.ptl_rwgs_ft).toContain("RWGS");
    expect(PTL_FAMILY_HUMAN.ptl_methanol_to_fuels).toContain("Methanol");
  });

  it("PTL_PRODUCT_HUMAN includes MTJ route (Batch 22)", () => {
    expect(PTL_PRODUCT_HUMAN.e_jet_via_mtj).toContain("MTJ");
    expect(PTL_PRODUCT_HUMAN.e_jet_via_mtj).toContain("D7566");
  });
});

// ---------------------------------------------------------------------------
// Minimum brief shape compiles and type-guards
// ---------------------------------------------------------------------------

describe("PtlDecisionBrief type compatibility", () => {
  it("minimal brief satisfies the interface", () => {
    const minimal: PtlDecisionBrief = {
      id: "ptl-test-123",
      created_at: new Date().toISOString(),
      schema_version: "ptl_decision_brief_v1",
      title: "Test",
      headline: "SOEC+FT: screening-ready with caveats (composite 72.5/100, IRIS 3/3)",
      verdict: "screening_ready_with_caveats",
      iris_grade: 3,
      candidate_id: "c1",
      candidate_family: "ptl_soec_ft",
      product_type: "saf_jet",
      jurisdiction: "US",
      composite_score: 72.5,
      score_components: [],
      soec_outlet_h2_co_ratio: 2.0,
      soec_outlet_co2_slip_pct: 15.0,
      soec_efficiency_hhv_pct: 85.0,
      soec_degraded_efficiency_pct: 78.0,
      soec_pressure_bar: 3.5,
      soec_temperature_c: 800.0,
      ft_oil_pct: 70.0,
      ft_gas_pct: 20.0,
      ft_char_pct: 0.0,
      integrated_carbon_efficiency_pct: 60.0,
      electricity_to_liquid_ratio: 0.50,
      overall_efficiency: 0.48,
      thermal_uplift_pct: 5.0,
      economics_mode: "integrated_stack",
      electricity_price_usd_per_mwh: 25.0,
      co2_source_type: "point_source_industrial",
      co2_cost_usd_per_ton: 120.0,
      green_h2_cost_per_kg: null,
      policy_credits_claimed: ["ira_45v_final_rule_2023"],
      lcof_usd_per_liter: 2.10,
      lcof_before_credits_usd_per_liter: 2.35,
      lcof_cost_stack: [],
      lcof_incumbent_price_usd_per_liter: 0.85,
      lcof_gap_to_incumbent_usd_per_liter: 1.25,
      lcof_in_unsubsidized_ptl_band: true,
      lcof_annual_output_liters: 500000,
      exergetic_efficiency: 0.45,
      first_law_efficiency: 0.48,
      quality_gap: 0.03,
      exergy_improvement_potential_fraction: 0.25,
      exergy_stages: [],
      exergy_hotspots: ["soec_stack"],
      sensitivity_base_lcof: 2.10,
      sensitivity_rows: [],
      sensitivity_top_driver: "electricity_price",
      fixture_id: "topsoe_herning_soec",
      fixture_confidence_tier: "C2",
      fixture_all_ok: true,
      fixture_violations: [],
      n_caveats: 1,
      n_conditionals: 0,
      n_hard_fails: 0,
      caveats: ["offtake not declared"],
      conditional_blockers: [],
      hard_fails: [],
      recommended_next_actions: ["Declare offtake contract"],
      calibration_gap_summary: "Integrated-plant fixture not registered",
      verdict_qualifier: "screening-ready with caveats",
      investment_warning: "Not an investment recommendation…",
      source_refs: ["topsoe_herning_2024_demo"],
      evidence_sources: [],
      unresolved_source_refs: [],
      research_report_cited: "docs/PTL_RESEARCH_REPORT_2026-04.md",
      notes: [],
    };
    // Type guard accepts it
    expect(isPtlBrief(minimal)).toBe(true);
    // Basic sanity fields
    expect(minimal.iris_grade).toBeLessThanOrEqual(3); // bounded-framing cap
  });
});
