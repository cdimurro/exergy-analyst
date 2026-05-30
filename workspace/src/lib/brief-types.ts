/**
 * TypeScript types mirroring DeviceDecisionBrief contract v1.0.
 *
 * These types are the authority for how the workspace consumes brief data.
 * They must match the Pydantic model in device_decision_brief.py exactly.
 * The workspace renders these fields — it does not interpret, soften,
 * or amplify them.
 */

export interface RecommendationCitation {
  authors: string;
  title: string;
  journal: string;
  year: string;
  url: string;
}

export interface RecommendationEntry {
  alternative_name: string;
  alternative_domain: string;
  technology_family: string;
  trigger: string;
  trigger_detail: string;
  rationale: string;
  key_advantages: string[];
  key_tradeoffs: string[];
  exergy_context: string;
  comparison_metric: string;
  evaluated_value: string;
  alternative_value: string;
  citations: RecommendationCitation[];
  evidence_confidence: "low" | "medium" | "high";
  suggested_next_step: string;
}

export interface BaselineComparison {
  parameter: string;
  your_value: number | string;
  baseline_value: number | string;
  baseline_source: string;
  position: string;        // "X% above/below baseline"
  assessment: string;      // "Strong" | "At baseline" | "Below baseline"
  module: string;
}

export interface RankedGapEntry {
  parameter: string;
  impact: "critical" | "important" | "nice-to-have";
  blocking: boolean;
  affects_modules: string[];
  estimated_score_impact: string;
  typical_range: string;
  evidence_type: string;
  why_it_matters: string;
}

export interface ModuleVerdictSummary {
  module_name: string;
  verdict: "pass" | "conditional" | "fail" | "blocked" | "not_evaluated";
  confidence: number;
  is_veto: boolean;
  key_detail: string;
  evidence_coverage?: string;  // e.g., "8/12 params"
}

/**
 * Provenance block for the cross-domain USD/kWh_exergy scalar
 * (CC-BE-EXRG-SURFACE-0044). Always emitted alongside the scalar —
 * when `produced` is false, `reason_absent` tells the reader why.
 * `exergy_kwh_per_output_unit_source` distinguishes a caller-supplied
 * conversion factor ("explicit") from the adapter default
 * ("adapter_default") or from a case where no factor is needed
 * because the primary metric is already energy-denominated
 * ("not_applicable").
 */
export interface DollarPerExergyProvenance {
  produced: boolean;
  primary_metric_units: string;
  exergy_kwh_per_output_unit: number | null;
  exergy_kwh_per_output_unit_source:
    | "explicit"
    | "adapter_default"
    | "not_applicable";
  exergy_basis: string;
  exergy_status: string | null;
  exergy_solver_tier: string | null;
  exergy_reference_env_id: string | null;
  exergy_useful_out_Wh: number | null;
  reason_absent?: string;
}

export interface DeviceDecisionBrief {
  // Contract
  contract_version: string;

  // Identity
  brief_id: string;
  created_at: string;
  device_id: string;
  commercial_name: string;
  manufacturer: string;
  domain: string;
  technology_family: string;

  // Readiness
  headline: string;
  readiness_tier: "deploy" | "strong" | "promising" | "early" | "insufficient" | "not_ready" | "conditional" | "caution";
  composite_score: number;
  hard_fail: boolean;
  hard_fail_reasons: string[];

  // Module verdicts
  module_summary: ModuleVerdictSummary[];
  modules_passing: number;
  modules_conditional: number;
  modules_failing: number;
  modules_blocked: number;

  // Veto
  veto_modules_clear: boolean;
  veto_concerns: string[];

  // Content
  key_strengths: string[];
  key_concerns: string[];
  economics_summary: string;
  economics_range: string;
  economics_sensitivity: string[];
  regulatory_summary: string;
  manufacturing_summary: string;

  // Evidence
  evidence_strength: string;
  literature_findings: number;
  literature_modules: string[];

  // Truth vector
  truth_agreement_pct: number | null;
  truth_mismatches: string[];

  // Guidance
  next_actions: string[];
  caveats: string[];
  calibration_tier: string;
  avg_module_confidence: number;

  // Assessment mode (Batch B)
  assessment_mode?: "full" | "screening";

  // Recommendations ("Consider Instead")
  recommendations?: RecommendationEntry[];

  // Methodology transparency
  methodology_note?: string;
  credibility_tier?: "C0" | "C1" | "C2" | "C3" | "";

  // Evidence level (from evaluation pipeline)
  evidence_level?: "minimal" | "partial" | "strong" | "unknown";
  module_unlock_guidance?: Record<string, Record<string, unknown>>;

  // Evidence-responsive output (V2)
  baseline_comparisons?: BaselineComparison[];
  ranked_gap_guidance?: RankedGapEntry[];
  evidence_coverage_summary?: Record<string, { coverage: number; params_matched: number; params_expected: number }>;

  // Comprehensive extraction context (enrichment)
  system_description?: string;
  trl_assessment?: string;
  information_gaps?: string[];
  performance_claims?: string[];
  competitive_context?: string;

  // Founder insights (CC-BE-11091)
  founder_insights?: {
    technology_identity: string;
    top_commercial_bottleneck: string;
    sellable_market: string;
    strongest_claim: string;
    weakest_claim: string;
    highest_value_next_action: string;
  };

  // Truth reconciliation (CC-BE-11090)
  truth_reconciliation?: {
    status: "clean" | "disagreements_found" | "invalid_run";
    disagreements: Array<{
      field: string;
      brief_value: unknown;
      canonical_value: unknown;
      severity: "critical" | "warning" | "info";
      message: string;
    }>;
    n_critical: number;
    n_warning: number;
    render_gate: "pass" | "warn" | "block";
    render_gate_reason: string;
  };

  // Resolved subject identity (CC-BE-11089)
  resolved_subject?: {
    company: string;
    technology: string;
    family: string;
    process_profile: string;
    feedstock: string;
    application: string;
    source_provenance: string;
    confidence: number;
    mismatches: Array<{
      field: string;
      expected: string;
      got: string;
      severity: string;
      message: string;
    }>;
    matched_reference: string;
    resolution_notes: string[];
  };

  // ── Multi-axis framework (Wave D) ────────────────────────────
  technical_feasibility?: StructuredAxis;
  commercial_viability?: StructuredAxis;
  spec_compliance_axis?: StructuredAxis;
  scale_readiness_axis?: StructuredAxis;
  thermodynamic_quality?: ThermodynamicAxis;

  combined_verdict?: string;
  combined_verdict_label?: string;
  verdict_modifiers?: string[];

  // Dual-LCOF / exergy-adjusted economics (Wave B)
  lcof_nominal_per_gge?: number | null;
  lcof_exergy_adjusted_per_gge?: number | null;
  quality_factor_applied?: number | null;
  lcof_divergence_pct?: number | null;
  lcof_exergy_adjustment_note?: string;
  lcof_is_divergent?: boolean;

  // Cross-domain exergy-normalized cost scalar (CC-BE-EXRG-SURFACE-0044).
  // Populated when an ExergyProfile (status == "computed") is attached
  // to the report AND the domain's primary cost metric is available.
  // Missing → renderer hides the row; provenance carries reason_absent.
  economics_dollar_per_exergy_kwh?: number | null;
  economics_dollar_per_exergy_kwh_provenance?: DollarPerExergyProvenance | null;

  // Thermodynamic Quality surface (Wave A)
  exergy_summary_plain?: string;
  second_law_efficiency?: number | null;
  exergy_ceiling?: number | null;
  exergy_headroom?: number | null;
  exergy_destruction_map?: Array<{
    mechanism: string;
    destruction_Wh: number;
    fraction_of_input: number;
  }>;
  exergy_carrier_type?: string;
  exergy_quality_factor?: number | null;

  // ── Rationalization + red-flag audit (catalog-driven) ────────
  // Optional, additive. Populated by the catalog policy layer in
  // workspace/src/lib/prompts/. Python mirror lives in
  // device_decision_brief.py (to be added when backend wiring lands).
  rationalization_checks?: RationalizationCheck[];
  red_flags_triggered?: TriggeredRedFlag[];
  unresolved_red_flag_count?: number;
  blocker_red_flag_count?: number;
}

/**
 * One entry in red_flags_triggered[]. Each triggered flag is a structured
 * audit record, not a string. The catalog key is authoritative; text in
 * trigger_basis and notes is for human review only.
 */
export interface TriggeredRedFlag {
  /** Stable catalog key from workspace/src/lib/prompts/red-flags.ts */
  key: string;
  /** Canonical module (matches ModuleOwner in prompts/types.ts) */
  module_owner: string;
  /** Diligence stage at which this flag was evaluated */
  stage: "discovery" | "pilot_diligence" | "deployment_diligence";
  /** Catalog-declared severity */
  severity: "caution" | "blocker";
  /** Pointers (IDs or short descriptors) to the evidence that triggered the flag */
  evidence_refs: string[];
  /** One or two sentences describing what in the evidence triggered this flag */
  trigger_basis: string;
  /** Confidence cap actually applied (may be tighter than catalog default) */
  confidence_cap_applied: number;
  /** Verdict ceiling actually applied (stage-aware resolution) */
  verdict_ceiling_applied: "none" | "conditional" | "blocked";
  /** Whether this flag has been cleared by subsequent evidence */
  status: "unresolved" | "cleared";
  /** Evidence refs that cleared this flag (empty when status == unresolved) */
  clearing_evidence_refs: string[];
  /** Free-text reviewer notes */
  notes: string;
}

/**
 * One entry in rationalization_checks[]. Records that the model explicitly
 * considered a known rationalization and what it concluded.
 */
export interface RationalizationCheck {
  /** Stable catalog key from workspace/src/lib/prompts/rationalizations.ts */
  key: string;
  /** Canonical module (matches ModuleOwner in prompts/types.ts) */
  module_owner: string;
  /** Diligence stage at which this check was performed */
  stage: "discovery" | "pilot_diligence" | "deployment_diligence";
  /** The rationalization pattern text (duplicated from catalog for audit) */
  pattern: string;
  /** Model's conclusion after running the disconfirming checks */
  status: "refuted" | "supported" | "inconclusive";
  /** Pointers to evidence consulted */
  evidence_refs: string[];
  /** One or two sentences: what in the evidence drove the status */
  trigger_basis: string;
  /** Which of required_disconfirming_checks[] were actually run */
  disconfirming_checks_run: string[];
  /** Free-text reviewer notes */
  notes: string;
}

/** Base structure for any of the 5 evaluation axes. */
export interface StructuredAxis {
  verdict: string;
  basis?: string;
  confidence?: number;
  evidence_tier?: string;
  gaps?: string[];
  delta_vs_benchmark?: string;
  [key: string]: unknown; // extras for domain-specific axes
}

/** Thermodynamic quality axis — extends StructuredAxis with second-law fields. */
export interface ThermodynamicAxis extends StructuredAxis {
  second_law_efficiency?: number | null;
  first_law_efficiency?: number | null;
  exergy_ceiling?: number | null;
  exergy_headroom?: number | null;
  quality_factor?: number | null;
  carrier_type?: string;
  destruction_map?: Array<{
    mechanism: string;
    destruction_Wh: number;
    fraction_of_input: number;
  }>;
}

/**
 * Required keys for contract v1.0 validation (matches Python BRIEF_REQUIRED_KEYS).
 */
export const BRIEF_REQUIRED_KEYS = [
  "brief_id", "device_id", "domain", "headline", "readiness_tier",
  "composite_score", "module_summary", "key_strengths", "key_concerns",
  "caveats", "next_actions", "calibration_tier", "contract_version",
] as const;

/**
 * Check if a payload looks like a valid DeviceDecisionBrief.
 */
export function isBriefPayload(data: unknown): data is DeviceDecisionBrief {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.headline === "string" &&
    typeof d.readiness_tier === "string" &&
    Array.isArray(d.module_summary) &&
    d.module_summary.length > 0 &&
    typeof d.contract_version === "string"
  );
}
