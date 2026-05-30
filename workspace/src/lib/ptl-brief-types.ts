/**
 * TypeScript types mirroring PtlDecisionBrief (Pydantic v2) in
 * breakthrough_engine/ptl/decision_brief.py.
 *
 * These types are the authority for how the workspace consumes PtL
 * brief data. They must match the Pydantic schema exactly. The
 * workspace renders these fields — it does not interpret, soften, or
 * amplify them.
 *
 * Bounded-framing invariant: PtL verdicts use only the screening_*
 * vocabulary. No "investment ready" or "decision grade" language is
 * rendered anywhere. The `investment_warning` field is always
 * displayed (see PtlBriefDetail component).
 */

export type PtlVerdict =
  | "screening_reject"
  | "screening_conditional"
  | "screening_ready_with_caveats"
  | "screening_deferred";

export type PtlFamily =
  | "ptl_soec_ft"
  | "ptl_rwgs_ft"
  | "ptl_methanol_to_fuels";

export type PtlProductType =
  | "saf_jet"
  | "e_diesel"
  | "e_gasoline"
  | "e_methanol"
  | "e_jet_via_mtj"
  | "wax"
  | "generic_crude";

export interface PtlScoreComponent {
  name: string;
  weight: number;
  raw_value: number;
  rationale: string;
  contribution: number;
}

export interface PtlLcofCostLine {
  label: string;
  usd_per_liter: number;
  fraction_of_lcof: number;
}

export interface PtlExergyStage {
  stage: string;
  destruction_fraction: number;
  destruction_share_overall: number;
  rationale: string;
}

export interface PtlSensitivityRow {
  label: string;
  low_value: number;
  high_value: number;
  low_lcof_usd_per_liter: number;
  high_lcof_usd_per_liter: number;
  lcof_swing_usd_per_liter: number;
  low_description?: string;
  high_description?: string;
}

export interface PtlEvidenceSource {
  source_id: string;
  title: string;
  authors: string;
  year: number;
  source_type: string;
  url?: string;
  doi?: string;
  data_quality: string;
  modules_supported: string[];
  key_findings: string[];
}

export interface PtlDecisionBrief {
  // Identity
  id: string;
  created_at: string;
  schema_version: string;

  // Headline
  title: string;
  headline: string;
  verdict: PtlVerdict;
  iris_grade: number;

  // Candidate
  candidate_id: string;
  candidate_family: PtlFamily | "";
  product_type: PtlProductType | "";
  jurisdiction: string;

  // Score
  composite_score: number;
  score_components: PtlScoreComponent[];

  // Physics snapshot
  soec_outlet_h2_co_ratio: number | null;
  soec_outlet_co2_slip_pct: number | null;
  soec_efficiency_hhv_pct: number | null;
  soec_degraded_efficiency_pct: number | null;
  soec_pressure_bar: number | null;
  soec_temperature_c: number | null;
  ft_oil_pct: number;
  ft_gas_pct: number;
  ft_char_pct: number;
  integrated_carbon_efficiency_pct: number;
  electricity_to_liquid_ratio: number;
  overall_efficiency: number;
  thermal_uplift_pct: number;

  // Economics
  economics_mode: string | null;
  electricity_price_usd_per_mwh: number | null;
  co2_source_type: string | null;
  co2_cost_usd_per_ton: number | null;
  green_h2_cost_per_kg: number | null;
  policy_credits_claimed: string[];

  // LCOF (Batch 13)
  lcof_usd_per_liter: number | null;
  lcof_before_credits_usd_per_liter: number | null;
  lcof_cost_stack: PtlLcofCostLine[];
  lcof_incumbent_price_usd_per_liter: number | null;
  lcof_gap_to_incumbent_usd_per_liter: number | null;
  lcof_in_unsubsidized_ptl_band: boolean;
  lcof_annual_output_liters: number | null;

  // Exergy (Batch 14)
  exergetic_efficiency: number | null;
  first_law_efficiency: number | null;
  quality_gap: number | null;
  exergy_improvement_potential_fraction: number | null;
  exergy_stages: PtlExergyStage[];
  exergy_hotspots: string[];

  // Sensitivity (Batch 17)
  sensitivity_base_lcof: number | null;
  sensitivity_rows: PtlSensitivityRow[];
  sensitivity_top_driver: string | null;

  // Fixture
  fixture_id: string | null;
  fixture_confidence_tier: string | null;
  fixture_all_ok: boolean;
  fixture_violations: string[];

  // Weaknesses
  n_caveats: number;
  n_conditionals: number;
  n_hard_fails: number;
  caveats: string[];
  conditional_blockers: string[];
  hard_fails: string[];

  // Actions
  recommended_next_actions: string[];
  calibration_gap_summary: string;

  // Bounded framing
  verdict_qualifier: string;
  investment_warning: string;

  // Provenance (Batch 24)
  source_refs: string[];
  evidence_sources: PtlEvidenceSource[];
  unresolved_source_refs: string[];
  research_report_cited: string;
  notes: string[];
}

/** Type guard — detect if a brief JSON is a PtL brief. */
export function isPtlBrief(brief: unknown): brief is PtlDecisionBrief {
  if (brief === null || typeof brief !== "object") return false;
  const b = brief as Record<string, unknown>;
  if (typeof b.schema_version === "string") {
    return b.schema_version.startsWith("ptl_decision_brief");
  }
  // Fallback — verdict starts with "screening_" and candidate_family is PtL
  const verdict = typeof b.verdict === "string" ? b.verdict : "";
  const family = typeof b.candidate_family === "string" ? b.candidate_family : "";
  return verdict.startsWith("screening_") && family.startsWith("ptl_");
}

/** Humanize verdict constants for display. */
export const PTL_VERDICT_HUMAN: Record<PtlVerdict, string> = {
  screening_reject:
    "Not ready — candidate does not clear hard-fail gates or minimum score.",
  screening_conditional:
    "Conditional — candidate clears plausibility but has unresolved weaknesses or a below-threshold composite.",
  screening_ready_with_caveats:
    "Ready for deeper diligence — candidate is suitable for early-stage analysis but requires calibrated operating data before advancing to a full TEA.",
  screening_deferred:
    "Deferred — physics for this pathway is not yet implemented; score cannot be produced.",
};

/** Humanize family name for display. */
export const PTL_FAMILY_HUMAN: Record<PtlFamily, string> = {
  ptl_soec_ft: "SOEC + FT synthesis",
  ptl_rwgs_ft: "RWGS + FT synthesis",
  ptl_methanol_to_fuels: "Methanol-to-Fuels (MTG / MTJ)",
};

/** Humanize product type. */
export const PTL_PRODUCT_HUMAN: Record<PtlProductType, string> = {
  saf_jet: "SAF (jet fuel)",
  e_diesel: "E-diesel",
  e_gasoline: "E-gasoline",
  e_methanol: "E-methanol",
  e_jet_via_mtj: "SAF via MTJ (ASTM D7566 A8)",
  wax: "FT wax",
  generic_crude: "Generic crude",
};

/** Map verdict → semantic color/variant token. */
export function verdictBadgeVariant(
  verdict: PtlVerdict,
): "success" | "warning" | "destructive" | "default" {
  switch (verdict) {
    case "screening_ready_with_caveats":
      return "success";
    case "screening_conditional":
      return "warning";
    case "screening_reject":
      return "destructive";
    case "screening_deferred":
    default:
      return "default";
  }
}

/** Format an optional numeric with a unit, returning '—' when null/undefined. */
export function formatOptional(
  value: number | null | undefined,
  unit = "",
  digits = 2,
): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}
