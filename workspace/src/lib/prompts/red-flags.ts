/**
 * Red-flag catalog for energy-tech deployment readiness.
 *
 * Each entry is an observable signal in the evidence record that should
 * trigger a caveat, conditional, or veto depending on diligence stage.
 * Distinct from rationalizations: rationalizations are claims to
 * interrogate, red flags are observations to scan for.
 *
 * Catalog entries declare a severity ("caution" | "blocker"); the policy
 * layer in ./policy.ts maps (severity, stage) to a VerdictCeiling. Red
 * flags do not directly set verdicts — they surface evidence problems and
 * the stage-aware policy layer decides the consequence.
 *
 * Red flags also declare clearing_evidence: the specific evidence that
 * would retire the flag. This keeps the catalog actionable, not just
 * critical.
 */

import {
  briefTypeApplies,
  ceilingForStage,
  domainApplies,
  sortByPriorityThenKey,
  stageApplies,
  type SelectionContext,
} from "./policy";
import type {
  BriefType,
  CatalogDomain,
  ModuleOwner,
  Priority,
  RedFlagSeverity,
  Stage,
  VerdictCeiling,
} from "./types";

export type RedFlagCategory =
  | "evidence"
  | "economics"
  | "scale"
  | "durability"
  | "regulatory"
  | "environmental"
  | "manufacturing"
  | "supply_chain"
  | "bankability";

export interface RedFlag {
  /** Stable key used as the catalog ID and in red_flags_triggered[]. */
  key: string;
  category: RedFlagCategory;

  // Targeting
  domains: CatalogDomain[];
  module_owner: ModuleOwner;
  applies_from_stage: Stage;
  applies_to_brief_type: BriefType[];
  priority: Priority;

  // Prompt content
  /** The observable signal in the evidence record. */
  signal: string;
  /** Why this signal matters for deployment readiness. */
  why_it_matters: string;

  // Consequence fields (machine-readable)
  /** Catalog-declared worst-case severity. The policy layer maps this to a ceiling by stage. */
  severity: RedFlagSeverity;
  /** Stage-agnostic consequence when no stage context is available. */
  default_verdict_ceiling: VerdictCeiling;
  /** Upper bound on module confidence while this flag is active. Range 0-1. */
  default_confidence_cap: number;
  /** What the analyst or model must do next. */
  required_follow_up: string;
  /** Evidence that would retire this flag. */
  clearing_evidence: string;
  /** Specific artifacts/documents/data the evidence must take the form of. */
  evidence_artifacts_required: string[];
}

export const RED_FLAGS: RedFlag[] = [
  // ── Evidence quality ─────────────────────────────────────────
  {
    key: "evidence_only_from_affiliates",
    category: "evidence",
    domains: ["generic"],
    module_owner: "physics",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "high",
    signal:
      "All peer-reviewed performance data has the founder, company, or funded collaborators as authors.",
    why_it_matters:
      "Absence of truly independent replication is the single strongest predictor of overstated performance in emerging energy tech.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Search for independent replications and note whether any unaffiliated group has published on the same system.",
    clearing_evidence:
      "At least one peer-reviewed replication by an unaffiliated group with consistent results.",
    evidence_artifacts_required: [
      "independent_peer_reviewed_study",
      "authorship_conflict_of_interest_disclosure",
    ],
  },
  {
    key: "proprietary_blocks_verification",
    category: "evidence",
    domains: ["generic"],
    module_owner: "physics",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Key performance or cost claims are explicitly marked proprietary and not independently verifiable.",
    why_it_matters:
      "Bankability and diligence require independently reviewable evidence. Proprietary gating shifts risk entirely to the investor.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.5,
    required_follow_up:
      "Request NDA-gated review by an independent engineer or trusted third party. Note the scope of proprietary blocks explicitly.",
    clearing_evidence:
      "Independent engineer's report under NDA confirms proprietary claims, with scope documented.",
    evidence_artifacts_required: [
      "independent_engineer_report",
      "nda_review_access",
    ],
  },
  {
    key: "single_site_single_operator",
    category: "evidence",
    domains: ["generic"],
    module_owner: "scalability",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "All operational evidence comes from one site, one operator, and one feedstock/input profile.",
    why_it_matters:
      "Site-specific, operator-specific, and feedstock-specific performance does not generalize. Commercial deployments expose variability that single-site data cannot predict.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Note the single-site scope in caveats. If deployment diligence, require evidence from a second site or operator before clearing.",
    clearing_evidence:
      "Operational data from two or more sites, operators, or feedstock profiles showing consistent performance.",
    evidence_artifacts_required: [
      "multi_site_operational_data",
      "non_affiliated_operator_record",
    ],
  },
  {
    key: "commercial_design_not_same_as_test_article",
    category: "evidence",
    domains: ["generic"],
    module_owner: "physics",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "critical",
    signal:
      "Performance or durability data cited to support the commercial design was generated on a different generation of hardware (e.g., Gen 1 pilot used to support Gen 2 commercial claims).",
    why_it_matters:
      "Performance and durability do not transfer across hardware generations when materials, geometry, or control systems change. Gen-1 data used to support Gen-2 claims is a common failure pattern.",
    severity: "blocker",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.4,
    required_follow_up:
      "List every material, geometric, or control difference between the test article and commercial article. Quantify expected performance delta.",
    clearing_evidence:
      "Validation data from the commercial-design hardware, even at reduced scale, covering the claimed performance envelope.",
    evidence_artifacts_required: [
      "commercial_design_test_report",
      "design_change_log",
    ],
  },

  // ── Economics ────────────────────────────────────────────────
  {
    key: "capex_vendor_quote_only",
    category: "economics",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "CAPEX is from vendor quotes or internal estimates with no EPC contractor bid or independent engineer review.",
    why_it_matters:
      "Vendor-quoted CAPEX typically excludes integration, site work, contingency, and commissioning — commonly 30-100% underrepresentation of installed cost.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Request EPC-level cost estimate with contingency and commissioning broken out. Apply an installed-cost multiplier in the caveat.",
    clearing_evidence:
      "EPC lump-sum bid or independent engineer's cost validation within 15% of the company estimate.",
    evidence_artifacts_required: [
      "epc_lump_sum_bid",
      "independent_engineer_cost_review",
    ],
  },
  {
    key: "irr_policy_sensitivity_high",
    category: "economics",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "critical",
    signal:
      "Base-case IRR or NPV swings by more than 30% when a single policy credit is removed.",
    why_it_matters:
      "Policy-gated bankability creates binary outcomes on regulatory or administrative events. Most tier-1 lenders require a viable base case without credits.",
    severity: "blocker",
    default_verdict_ceiling: "blocked",
    default_confidence_cap: 0.4,
    required_follow_up:
      "Recompute IRR without each headline credit. If the unsupported base case is below lender hurdle, flag as veto concern at deployment stage.",
    clearing_evidence:
      "Base-case IRR meets lender hurdle (typically 10-12%) without policy credits, OR a binding credit transfer with an investment-grade counterparty.",
    evidence_artifacts_required: [
      "financial_model_with_credit_sensitivity",
      "binding_credit_transfer_agreement",
    ],
  },
  {
    key: "feedstock_price_static",
    category: "economics",
    domains: ["waste_to_fuels", "power_to_liquid"],
    module_owner: "economics",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Feedstock or electricity cost is locked at current or favorable prices with no volatility analysis.",
    why_it_matters:
      "Feedstock cost is typically the dominant operating expense and its volatility drives real bankability risk. Static assumptions hide this.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Run a Monte Carlo or scenario sensitivity on feedstock/electricity price using historical volatility.",
    clearing_evidence:
      "Hedging/PPA structure or a long-term fixed-price feedstock contract covering the investment horizon.",
    evidence_artifacts_required: [
      "feedstock_price_sensitivity_analysis",
      "hedging_or_ppa_contract",
    ],
  },
  {
    key: "wacc_missing_or_unrealistic",
    category: "economics",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "medium",
    signal:
      "No WACC disclosed, or WACC below 8% for an unproven technology.",
    why_it_matters:
      "WACC for first-of-a-kind energy tech is typically 10-15%; using utility-equivalent WACC (6-8%) flatters LCOE and is not lendable.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.7,
    required_follow_up:
      "Ask for the assumed WACC and benchmark against first-of-a-kind comparables.",
    clearing_evidence:
      "Disclosed WACC in the 10-15% range with debt/equity split reflecting first-of-a-kind risk, OR credit-enhanced structure justifying a lower WACC.",
    evidence_artifacts_required: [
      "wacc_disclosure",
      "debt_equity_structure",
    ],
  },
  {
    key: "replacement_cadence_omitted",
    category: "economics",
    domains: ["battery", "power_to_liquid", "waste_to_fuels", "inverter"],
    module_owner: "economics",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Replacement or major maintenance cadence (stack, catalyst, membrane, sorbent, filter, inverter block) is omitted from OPEX or lifecycle cost.",
    why_it_matters:
      "Stack/catalyst/membrane replacement is often the dominant recurring cost and drives real LCOE/LCOS. Omitting it underrepresents OPEX by 20-50%.",
    severity: "blocker",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.5,
    required_follow_up:
      "List every consumable or major-maintenance item, its expected replacement interval, and its unit cost. Recompute OPEX and LCOE.",
    clearing_evidence:
      "OPEX model includes replacement schedule for every consumable with durability data supporting the interval.",
    evidence_artifacts_required: [
      "opex_breakdown_with_replacement_schedule",
      "durability_data_by_component",
    ],
  },

  // ── Scale & manufacturing ────────────────────────────────────
  {
    key: "scale_jump_too_large",
    category: "scale",
    domains: ["generic"],
    module_owner: "scalability",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "critical",
    signal:
      "Gap of 10x or more between the largest operated unit and the next planned scale.",
    why_it_matters:
      "Process-industry heuristics recommend at most 3-10x per scale-up step. Jumps beyond that routinely fail on heat/mass transfer, mechanical, or control issues.",
    severity: "blocker",
    default_verdict_ceiling: "blocked",
    default_confidence_cap: 0.4,
    required_follow_up:
      "Require an intermediate demonstration at the 3-10x step before deployment-stage promotion.",
    clearing_evidence:
      "Intermediate-scale demonstration operating within the 3-10x envelope for at least 6 months.",
    evidence_artifacts_required: [
      "intermediate_scale_demonstration_record",
      "scale_up_risk_analysis",
    ],
  },
  {
    key: "scale_depends_on_nonexistent_capacity",
    category: "scale",
    domains: ["generic"],
    module_owner: "manufacturing",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "critical",
    signal:
      "Scaling plan requires a material, component, or manufacturing capacity that does not yet exist at the needed volume (e.g., iridium demand exceeds global annual supply).",
    why_it_matters:
      "Commercial deployment timelines are constrained by the slowest upstream bottleneck, which is often invisible in the company's own roadmap.",
    severity: "blocker",
    default_verdict_ceiling: "blocked",
    default_confidence_cap: 0.3,
    required_follow_up:
      "Quantify the upstream capacity gap and timeline to close it. Identify alternate materials/processes that relax the constraint.",
    clearing_evidence:
      "Upstream capacity plan with named suppliers and committed capacity, OR a qualified alternate chemistry with no capacity constraint.",
    evidence_artifacts_required: [
      "upstream_capacity_supply_plan",
      "alternate_chemistry_qualification",
    ],
  },
  {
    key: "manufacturing_yield_assumed_high",
    category: "manufacturing",
    domains: ["battery", "pv", "inverter", "power_to_liquid"],
    module_owner: "manufacturing",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Manufacturing yield is assumed above 95% in cost models without pilot-line evidence.",
    why_it_matters:
      "First-generation yields are commonly 60-85%. Yield assumptions flow directly into unit cost and are frequently the largest single source of cost overrun.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Request pilot-line yield data by stage. Rebuild unit-cost model with realistic ramp-curve yield.",
    clearing_evidence:
      "Pilot-line data across multiple production runs supporting the assumed yield, or a yield-ramp curve with documented basis.",
    evidence_artifacts_required: [
      "pilot_line_yield_data",
      "yield_ramp_model",
    ],
  },

  // ── Durability ───────────────────────────────────────────────
  {
    key: "degradation_from_short_test",
    category: "durability",
    domains: ["battery", "pv", "inverter", "waste_to_fuels", "power_to_liquid"],
    module_owner: "performance",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Lifetime or degradation claim extrapolated from under 1000 hours of operation, or under 500 cycles for batteries.",
    why_it_matters:
      "Short-duration tests miss slow degradation modes (fouling, sintering, SEI evolution, UV-driven polymer aging) that dominate years 5-20 of service life.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Identify the dominant degradation mechanism and confirm it is captured at the tested duration. Discount lifetime claims pending longer-duration data.",
    clearing_evidence:
      "Continuous operation data covering at least 10% of claimed service life, OR peer-reviewed mechanism-based extrapolation with uncertainty bounds.",
    evidence_artifacts_required: [
      "long_duration_test_record",
      "degradation_mechanism_analysis",
    ],
  },
  {
    key: "operating_envelope_narrower_than_service",
    category: "durability",
    domains: ["generic"],
    module_owner: "performance",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Tested operating envelope (temperature, pressure, load, cycling profile) is narrower than the service conditions claimed for commercial deployment.",
    why_it_matters:
      "Untested corners of the operating envelope are where safety, durability, and performance surprises cluster.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Overlay the test envelope and the service envelope. Require testing in each untested corner.",
    clearing_evidence:
      "Test data covering the full service envelope, including worst-case corners.",
    evidence_artifacts_required: [
      "envelope_coverage_map",
      "worst_case_corner_test_report",
    ],
  },

  // ── Regulatory ───────────────────────────────────────────────
  {
    key: "novel_permit_path_no_engagement",
    category: "regulatory",
    domains: ["generic"],
    module_owner: "regulatory",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "critical",
    signal:
      "Permitting plan assumes a novel pathway (new category, waiver, fast-track) with no documented pre-application engagement with the permitting authority.",
    why_it_matters:
      "Regulatory timelines for novel categories commonly exceed 3-5 years and can introduce fatal-flaw requirements discovered late.",
    severity: "blocker",
    default_verdict_ceiling: "blocked",
    default_confidence_cap: 0.4,
    required_follow_up:
      "Require documented pre-application engagement with the permitting authority. Map the complete permit list and agency touchpoints.",
    clearing_evidence:
      "Pre-application meeting records or issued determination letter from the permitting authority covering the novel pathway.",
    evidence_artifacts_required: [
      "pre_application_meeting_record",
      "agency_determination_letter",
      "permit_matrix",
    ],
  },
  {
    key: "no_fmea_or_hazop",
    category: "regulatory",
    domains: ["battery", "waste_to_fuels", "power_to_liquid", "inverter"],
    module_owner: "safety",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "No documented FMEA, HAZOP, or equivalent structured safety analysis for the commercial-scale design.",
    why_it_matters:
      "Absence of structured safety analysis is a standard lender and insurance disqualifier, and typically surfaces design-level issues late.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.5,
    required_follow_up:
      "Require a HAZOP or FMEA covering the commercial-scale design, led by a qualified independent facilitator.",
    clearing_evidence:
      "Completed HAZOP/FMEA with closed action items and sign-off by an independent safety authority.",
    evidence_artifacts_required: [
      "hazop_fmea_report",
      "safety_action_item_closure_log",
    ],
  },
  {
    key: "product_spec_or_certification_gap",
    category: "regulatory",
    domains: ["waste_to_fuels", "power_to_liquid", "inverter", "battery"],
    module_owner: "regulatory",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Product meets the claimed market spec only conditionally (e.g., blend wall limits, ASTM/IEC test coverage incomplete), or the certification path is not yet complete.",
    why_it_matters:
      "A fuel that only meets spec as a blend component, or hardware that lacks full IEC/UL/ASTM certification, cannot access the full claimed market. This constrains TAM and offtake pricing.",
    severity: "blocker",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.5,
    required_follow_up:
      "Enumerate every spec and certification required for the claimed market. Identify the specific gaps and cost/timeline to close them.",
    clearing_evidence:
      "Completed certification (ASTM D7566, IEC 62109, UL 1741, etc.) covering the commercial product as-sold, or a signed regulatory determination authorizing the use case.",
    evidence_artifacts_required: [
      "spec_compliance_matrix",
      "certification_status_report",
    ],
  },

  // ── Environmental ────────────────────────────────────────────
  {
    key: "environmental_permit_load_unmodeled",
    category: "environmental",
    domains: ["waste_to_fuels", "power_to_liquid", "pv", "battery"],
    module_owner: "environmental",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "critical",
    signal:
      "Environmental permitting load (water withdrawal, wastewater discharge, criteria pollutants, hazardous air pollutants, stormwater, noise) is not modeled or is only partially addressed.",
    why_it_matters:
      "Environmental permits are typically the long-pole item in project timelines and can be a fatal flaw. Missing air, water, and waste permits surface late and at high cost.",
    severity: "blocker",
    default_verdict_ceiling: "blocked",
    default_confidence_cap: 0.4,
    required_follow_up:
      "Compile the full environmental permit matrix (air, water, waste, noise) for the deployment jurisdiction. Estimate permitting timeline and agency interactions.",
    clearing_evidence:
      "Complete environmental permit matrix with agency touchpoints, jurisdictional requirements, and a credible schedule.",
    evidence_artifacts_required: [
      "environmental_permit_matrix",
      "air_water_waste_permit_applications",
      "env_impact_assessment",
    ],
  },
  {
    key: "decommissioning_or_end_of_life_cost_missing",
    category: "environmental",
    domains: ["battery", "pv", "inverter", "waste_to_fuels", "power_to_liquid"],
    module_owner: "environmental",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Decommissioning, disposal, recycling, or end-of-life cost is missing from the lifecycle model (electrolysis stacks, catalysts, membranes, specialty materials, asset retirement).",
    why_it_matters:
      "End-of-life cost is a material LCOE/LCOS input for hardware with high-value or hazardous components. Its absence understates true cost and is a common insurance/regulator blocker.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Add asset retirement obligation (ARO) and end-of-life cost to the lifecycle model. Identify recycling or disposal pathway for each specialty material.",
    clearing_evidence:
      "Lifecycle model including ARO, decommissioning, and recycling/disposal cost for each specialty material with jurisdictional basis.",
    evidence_artifacts_required: [
      "lifecycle_cost_model_with_aro",
      "recycling_disposal_pathway_map",
    ],
  },

  // ── Supply chain ─────────────────────────────────────────────
  {
    key: "single_source_critical_component",
    category: "supply_chain",
    domains: ["generic"],
    module_owner: "manufacturing",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "A critical component (membrane, catalyst, custom cell format, specialty alloy) has only one qualified supplier.",
    why_it_matters:
      "Single-source critical components create schedule, price, and continuity risk that is very difficult to resolve post-FID.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Identify a qualified second source or a substitution pathway. Require a 180-day inventory buffer until second source is qualified.",
    clearing_evidence:
      "Qualified second supplier with parts tested and approved in production, OR a substitution pathway demonstrated at scale.",
    evidence_artifacts_required: [
      "second_source_qualification_report",
      "substitution_test_data",
    ],
  },
  {
    key: "refining_concentration_hidden",
    category: "supply_chain",
    domains: ["generic"],
    module_owner: "manufacturing",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "medium",
    signal:
      "Raw-material sourcing map shows diversification at the mine but not at the refining/processing step.",
    why_it_matters:
      "For most critical minerals (Li, Ni, Co, REE, Ir), processing is geographically concentrated and is the true supply-chain bottleneck.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.7,
    required_follow_up:
      "Map refining concentration by geography for each critical material. Note the exposure explicitly in caveats.",
    clearing_evidence:
      "Refining supply map with two or more geographies covering each critical material.",
    evidence_artifacts_required: [
      "refining_supply_concentration_map",
    ],
  },

  // ── Bankability ──────────────────────────────────────────────
  {
    key: "no_independent_engineer_report",
    category: "bankability",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "deployment_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "critical",
    signal:
      "No independent engineer's report (IER) or equivalent third-party technical review has been commissioned.",
    why_it_matters:
      "Project finance lenders require an IER before financial close. Absence at late development stages indicates either early stage or reluctance to surface findings.",
    severity: "blocker",
    default_verdict_ceiling: "blocked",
    default_confidence_cap: 0.4,
    required_follow_up:
      "Commission an IER from a tier-1 engineering firm. Scope must cover performance, constructability, safety, and OPEX.",
    clearing_evidence:
      "Completed IER with no unresolved blockers, issued by a tier-1 firm.",
    evidence_artifacts_required: [
      "independent_engineer_report",
    ],
  },
  {
    key: "no_insurance_or_warranty_wrap",
    category: "bankability",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "deployment_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "No insurance product, OEM performance warranty of sufficient term, or equivalent wrap covers the technology's performance risk.",
    why_it_matters:
      "Without a performance wrap, technology risk sits with the lender and project sponsor. Most tier-1 capital will not proceed without it for first-of-a-kind assets.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Engage a technology risk insurer or negotiate an extended OEM warranty covering the bankability tenor.",
    clearing_evidence:
      "Bound insurance policy or OEM warranty of at least 10 years covering the performance envelope.",
    evidence_artifacts_required: [
      "insurance_binder",
      "oem_warranty_agreement",
    ],
  },
  {
    key: "offtake_is_loi_only",
    category: "bankability",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "deployment_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    signal:
      "Offtake is LOI or MoU only, with no binding take-or-pay from a creditworthy counterparty.",
    why_it_matters:
      "Non-binding offtake is not a revenue contract and does not support project finance. LOIs routinely do not convert at the prices assumed in the financial model.",
    severity: "caution",
    default_verdict_ceiling: "conditional",
    default_confidence_cap: 0.6,
    required_follow_up:
      "Convert LOI to binding take-or-pay with a creditworthy counterparty, OR demonstrate a regulated offtake obligation.",
    clearing_evidence:
      "Binding take-or-pay with an investment-grade counterparty covering greater than 50% of nameplate, OR regulated buyer with compliance obligation.",
    evidence_artifacts_required: [
      "binding_offtake_agreement",
      "counterparty_credit_rating",
    ],
  },
];

/** Filter catalog entries for a given selection context. */
export function selectRedFlags(ctx: SelectionContext): RedFlag[] {
  const filtered = RED_FLAGS.filter(
    (f) =>
      domainApplies(f.domains, ctx.domain) &&
      stageApplies(f.applies_from_stage, ctx.stage) &&
      briefTypeApplies(f.applies_to_brief_type, ctx.brief_type),
  );
  return sortByPriorityThenKey(filtered);
}

/** Resolve the stage-aware verdict ceiling for a specific flag. */
export function resolveCeiling(flag: RedFlag, stage: Stage): VerdictCeiling {
  return ceilingForStage(flag.severity, stage);
}

/** Format red flags into a prompt-ready markdown block grouped by category. */
export function formatRedFlagsForPrompt(entries: RedFlag[]): string {
  const byCategory = new Map<RedFlagCategory, RedFlag[]>();
  for (const f of entries) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }
  // Stable category ordering
  const categoryOrder: RedFlagCategory[] = [
    "evidence",
    "economics",
    "scale",
    "manufacturing",
    "durability",
    "regulatory",
    "environmental",
    "supply_chain",
    "bankability",
  ];
  const sections: string[] = [];
  for (const category of categoryOrder) {
    const flags = byCategory.get(category);
    if (!flags || flags.length === 0) continue;
    const header = `**${category.replace(/_/g, " ").toUpperCase()}**`;
    const lines = flags.map(
      (f) =>
        `  - [${f.severity}] ${f.signal} (key: \`${f.key}\`, module: ${f.module_owner}, priority: ${f.priority})\n    - Why: ${f.why_it_matters}\n    - Clearing evidence: ${f.clearing_evidence}\n    - Follow-up: ${f.required_follow_up}`,
    );
    sections.push(`${header}\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}

/** Lookup a red flag by key (stable ID). */
export function getRedFlag(key: string): RedFlag | undefined {
  return RED_FLAGS.find((f) => f.key === key);
}
