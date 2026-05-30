/**
 * Universal physics rules for energy technology validation.
 *
 * These rules apply to ALL 101 domains. They encode physical law,
 * not engineering expectations. No domain-specific code.
 *
 * Only hard blocks. No soft warnings at this level.
 */

export type ValidationTier = "hard_block" | "pass";

export interface ValidationDecision {
  tier: ValidationTier;
  rule_id: string;
  field: string;
  value: unknown;
  message: string;
}

export interface HardRule {
  id: string;
  /** Returns true if value is valid, false if it should be hard-blocked */
  check: (v: number) => boolean;
  message: string;
}

// ── Hard Rules (physics law, not engineering judgment) ────────

export const HARD_RULES: Record<string, HardRule> = {
  finite_number: {
    id: "finite_number",
    check: (v) => Number.isFinite(v),
    message: "Non-finite value (NaN or Infinity)",
  },
  efficiency_cap: {
    id: "efficiency_cap",
    check: (v) => v <= 100,
    message: "Efficiency exceeds 100% — violates conservation of energy",
  },
  fraction_range: {
    id: "fraction_range",
    check: (v) => v >= 0 && v <= 1,
    message: "Fraction outside [0, 1]",
  },
  percentage_range: {
    id: "percentage_range",
    check: (v) => v >= 0 && v <= 100,
    message: "Percentage outside [0, 100]",
  },
  absolute_zero_celsius: {
    id: "absolute_zero_celsius",
    check: (v) => v >= -273.15,
    message: "Temperature below absolute zero (-273.15 C)",
  },
  absolute_zero_kelvin: {
    id: "absolute_zero_kelvin",
    check: (v) => v >= 0,
    message: "Temperature below 0 K",
  },
  positive_quantity: {
    id: "positive_quantity",
    check: (v) => v >= 0,
    message: "Negative value for inherently positive quantity",
  },
};

// ── Field Classification: Allowlist-First ─────────────────────

/** Step 1: Exact field name → rule mapping (highest priority) */
export const EXACT_FIELD_RULES: Record<string, string> = {
  // CC-BE-0113b: composite_score is now on 0-100 display scale at
  // the brief schema boundary (enforced by Pydantic Field(ge=0, le=100)
  // + the canonical score_canonical.py helper). Pre-0113 this field
  // was a 0-1 fraction; the rule changed from "fraction_range" to
  // "percentage_range" to match the new invariant.
  composite_score: "percentage_range",
  avg_module_confidence: "fraction_range",
  confidence_0_1: "fraction_range",
  fill_factor: "fraction_range",
  derating_factor: "fraction_range",
  truth_agreement_pct: "percentage_range",
  degradation_pct: "percentage_range",
  round_trip_efficiency: "efficiency_cap",
  system_efficiency: "efficiency_cap",
  electrical_efficiency: "efficiency_cap",
  thermal_efficiency: "efficiency_cap",
  module_efficiency: "efficiency_cap",
  peak_efficiency: "efficiency_cap",
  weighted_efficiency: "efficiency_cap",
};

/** Step 2: Exclusion list — these fields are NEVER matched by patterns */
export const EXCLUDED_FROM_PATTERNS: string[] = [
  "cop_heating", "cop_cooling", "cop", "coefficient_of_performance",
  "delta_temperature", "temperature_delta", "temp_diff", "dt", "dT",
  "net_present_value", "npv", "irr", "internal_rate_of_return",
  "credit", "subsidy", "offset", "rebate",
  "charge_rate", "discharge_rate", "c_rate",
  "q_factor", "gain", "amplification",
  "latitude", "longitude",
  "ph", "pH",
];

/** Step 3: Pattern-based rule matching (only for fields not in Step 1 or 2) */
export const PATTERN_RULES: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /efficiency/i, rule: "efficiency_cap" },
  { pattern: /_pct$|percent/i, rule: "percentage_range" },
  { pattern: /confidence|score.*0_1/i, rule: "fraction_range" },
  { pattern: /^temp_|temperature|_celsius|_[cC]$/i, rule: "absolute_zero_celsius" },
  { pattern: /_kelvin|_[kK]$/i, rule: "absolute_zero_kelvin" },
  { pattern: /^mass|^weight|^capacity_|^area_|^volume|^pressure_abs/i, rule: "positive_quantity" },
];

// ── Valid Enums ───────────────────────────────────────────────

export const VALID_VERDICTS = new Set([
  "pass", "conditional", "fail", "blocked", "not_evaluated", "deferred",
]);

// Canonical 8-tier ladder emitted by breakthrough_engine/device_decision_brief.py
// (see _validate_brief_dict valid_tiers). The TS validator must accept the full
// set so briefs from the richer ladder (deploy/strong/promising/early/
// insufficient) do not get stamped validation_valid=false purely on tier name.
// Synced 2026-04-15 (CC-BE-WTF-0002) — keep in lockstep with the Python literal.
export const VALID_READINESS_TIERS = new Set([
  "deploy", "strong", "promising", "early", "insufficient",
  "not_ready", "conditional", "caution",
]);

export const VALID_EVIDENCE_LEVELS = new Set([
  "minimal", "partial", "moderate", "strong", "comprehensive", "unknown",
]);
