/**
 * Rationalization catalog for energy-tech deployment readiness.
 *
 * Each entry is a claim commonly used to argue a technology is ready for
 * commercial deployment, paired with what evidence would refute or support
 * it. Entries are structured policy objects, not free prose: they carry
 * module ownership, stage gating, brief-type targeting, and disconfirming
 * checks so the downstream engine can route them deterministically.
 *
 * Keep entries specific and energy-grounded. Grow from real failure modes
 * surfaced in briefs, not speculation.
 */

import {
  briefTypeApplies,
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
  Stage,
} from "./types";

export interface Rationalization {
  /** Stable key used as the catalog ID and in rationalization_checks[].pattern. */
  key: string;

  // Targeting
  domains: CatalogDomain[];
  module_owner: ModuleOwner;
  applies_from_stage: Stage;
  applies_to_brief_type: BriefType[];
  priority: Priority;

  // Prompt content
  pattern: string;
  why_tempting: string;
  what_to_check: string;
  typical_evidence_gap: string;

  // Structured consequence fields (machine-readable for deterministic handling)
  /** Specific checks the analyst or model must run to disconfirm. */
  required_disconfirming_checks: string[];
  /** Concrete evidence examples that would constitute strong counterevidence. */
  strongest_counterevidence_examples: string[];
  /** When this rationalization is actually reasonable (avoid over-applying). */
  common_false_positive_pattern: string;
}

export const RATIONALIZATIONS: Rationalization[] = [
  {
    key: "pilot_equals_commercial",
    domains: ["generic"],
    module_owner: "scalability",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "critical",
    pattern: "The pilot demonstrated commercial viability.",
    why_tempting:
      "A working pilot feels like de-risked proof. Founders and press releases both reinforce this framing.",
    what_to_check:
      "Scale ratio between pilot and target plant, duration of continuous operation, feedstock/site variability exposure, and whether third-party operators have run the asset.",
    typical_evidence_gap:
      "Pilot was short-duration, single-feedstock, single-site, operated by the R&D team under ideal conditions. Commercial scale is 10-100x larger with different heat/mass transfer regimes.",
    required_disconfirming_checks: [
      "Compare pilot throughput to target commercial throughput (report the multiplier).",
      "Confirm pilot ran at least one year with representative seasonal/feedstock variability.",
      "Check that a non-R&D operator has run the plant at nameplate for at least one shift cycle.",
    ],
    strongest_counterevidence_examples: [
      "A first-of-a-kind commercial plant is already operating and has published performance data.",
      "An independent engineer's report confirms scale-up risk is bounded.",
      "A 5-10x intermediate-scale plant has operated for 12+ months.",
    ],
    common_false_positive_pattern:
      "Technologies where scale-up is genuinely modular (e.g., PV modules, Li-ion cells) where parallel replication is the deployment model. In those cases pilot is more representative.",
  },
  {
    key: "learning_curve_cost_down",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "high",
    pattern: "Costs will come down the learning curve as volumes scale.",
    why_tempting:
      "Historical precedents (PV modules, Li-ion cells) make it feel like a law rather than a conditional outcome.",
    what_to_check:
      "What specific cost driver is expected to decline, what volume unlocks it, and whether the learning rate is comparable to technologies that actually followed the curve. Distinguish BoM cost from installed cost from LCOE.",
    typical_evidence_gap:
      "Cost reduction depends on sustained volume that requires the technology to already be cheap. Learning rates for process-plant tech (gasification, electrolysis stacks) are far lower than cell-manufacturing tech.",
    required_disconfirming_checks: [
      "Name the specific cost driver expected to decline and the volume threshold.",
      "Cite a learning rate with its source, and compare it to a reference tech of similar architecture (not PV or Li-ion for process plants).",
      "Confirm whether installed cost (not just BoM/equipment) follows the same curve.",
    ],
    strongest_counterevidence_examples: [
      "Historical cost data from three or more operating plants at different scales that support the projected learning rate.",
      "Comparable process tech (e.g., SMR, FT) with published learning rates near the projection.",
    ],
    common_false_positive_pattern:
      "Mass-manufactured modular hardware (cells, modules, inverters) where learning rates are genuinely empirical and robust across chemistries.",
  },
  {
    key: "policy_tailwinds_make_it_work",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "critical",
    pattern: "Policy (IRA 45V/Q/Z, ITC, CBAM, ReFuelEU) makes the economics work.",
    why_tempting:
      "Headline credit values are large and current; models pencil out easily with them included.",
    what_to_check:
      "Credit eligibility timeline, monetization path, safe-harbor rules, creditworthy offtaker needed to realize the credit, and economics if credits sunset or are revoked. Bankability often requires the base case to work without the credit.",
    typical_evidence_gap:
      "Unmonetized credits, single-jurisdiction dependency, project timeline longer than credit horizon, IRR sensitivity to policy exceeds 30%.",
    required_disconfirming_checks: [
      "Report IRR with and without each headline credit, and name the delta.",
      "Confirm credit eligibility for the specific pathway (feedstock, carbon intensity, domestic content).",
      "Identify the monetization mechanism and any creditworthy counterparty required.",
    ],
    strongest_counterevidence_examples: [
      "Base-case economics work at a lender-acceptable IRR without policy credits.",
      "Binding credit transfer or tax-equity agreement with an investment-grade counterparty.",
    ],
    common_false_positive_pattern:
      "Mature technologies where policy is a tiebreaker against incumbents (not the sole driver). Example: wind/solar with ITC.",
  },
  {
    key: "durability_from_accelerated_test",
    domains: ["battery", "pv", "inverter", "waste_to_fuels", "power_to_liquid"],
    module_owner: "performance",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    pattern: "20-year service life from accelerated durability testing.",
    why_tempting:
      "Accelerated testing is industry-standard and the extrapolation math looks rigorous.",
    what_to_check:
      "Acceleration factor basis, whether degradation mechanism is the same at accelerated and real conditions, test duration, and whether multiple samples show consistent behavior. For batteries: cycle count, depth-of-discharge, and calendar aging separately.",
    typical_evidence_gap:
      "Acceleration factors assume a single Arrhenius-like mechanism, but fouling, catalyst sintering, mechanical fatigue, and secondary degradation rarely scale linearly. Tests under 3000 hours extrapolated to 20 years are structurally unreliable.",
    required_disconfirming_checks: [
      "Name the dominant degradation mechanism and confirm it is the same under accelerated and real conditions.",
      "Report test duration and translate to equivalent service hours; flag extrapolations over 10x.",
      "Check for multi-sample consistency (n >= 3) in degradation trajectory.",
    ],
    strongest_counterevidence_examples: [
      "Field-operated units with 5+ years of continuous duty data.",
      "Cross-validation of accelerated and real-time degradation curves in peer-reviewed literature.",
    ],
    common_false_positive_pattern:
      "Well-understood technologies (crystalline silicon PV) where accelerated protocols have decades of field validation.",
  },
  {
    key: "bop_is_standard_equipment",
    domains: ["waste_to_fuels", "power_to_liquid", "inverter"],
    module_owner: "system_integration",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    pattern: "Balance of plant is standard, off-the-shelf equipment.",
    why_tempting:
      "It shifts perceived technical risk to a commoditized category the reviewer discounts.",
    what_to_check:
      "What specifically is in the BoP scope (gas cleanup, heat integration, water treatment, compression), whether vendor quotes are binding, and whether the reactor's operating envelope imposes non-standard requirements on the BoP.",
    typical_evidence_gap:
      "Novel reactor chemistries often produce non-standard syngas/product streams that push BoP into custom territory where cost, schedule, and reliability risk actually lives.",
    required_disconfirming_checks: [
      "Itemize BoP scope and identify any custom equipment (material, size, duty).",
      "Confirm vendor quotes are binding and include integration scope.",
      "Check reactor effluent composition against standard BoP design envelopes.",
    ],
    strongest_counterevidence_examples: [
      "EPC-level quotes from two or more independent integrators that match the company's assumed BoP cost.",
      "Reference plants with similar feedstock/effluent using the same BoP vendors.",
    ],
    common_false_positive_pattern:
      "Genuinely modular tech where BoP (inverters, transformers, switchgear) is a mature commodity category with strong reference plants.",
  },
  {
    key: "adjacent_validation_transfers",
    domains: ["generic"],
    module_owner: "physics",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "critical",
    pattern:
      "Validation in an adjacent configuration proves this configuration.",
    why_tempting:
      "Adjacent evidence feels close enough to count and bridges gaps in the primary dataset. It is easy for reviewers to accept by analogy.",
    what_to_check:
      "Whether the validated configuration differs from the commercial configuration in any of: feedstock composition, operating mode (e.g., H2 vs co-electrolysis), catalyst formulation, steady-state vs load-following duty, integrated vs standalone operation, or scale regime. Any material difference invalidates direct transfer.",
    typical_evidence_gap:
      "Pilot tested one feedstock; commercial assumes another. Lab catalyst performance cited; integrated plant catalyst not tested. Steady-state test data cited for a load-following commercial duty. Single-mode electrolyzer data cited for co-electrolysis commercial mode.",
    required_disconfirming_checks: [
      "List every dimension where test article and commercial article differ (feedstock, mode, duty, integration, scale).",
      "For each dimension, quantify the expected performance delta with a citation.",
      "Confirm the validated configuration is not a cherry-picked best-case representative.",
    ],
    strongest_counterevidence_examples: [
      "Direct validation of the exact commercial configuration, even at small scale.",
      "Sensitivity analysis showing the commercial configuration lies within the validated envelope.",
    ],
    common_false_positive_pattern:
      "Small-scale validation of a truly equivalent configuration (same chemistry, same duty, same catalyst) where only throughput differs.",
  },
  {
    key: "offtake_is_secured",
    domains: ["generic"],
    module_owner: "economics",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    pattern: "We have offtake agreements covering multi-year demand.",
    why_tempting:
      "Named counterparties in a deck feel like demand validation.",
    what_to_check:
      "Whether the agreement is binding (take-or-pay vs LOI vs MoU), counterparty creditworthiness, pricing mechanism (fixed, indexed, contingent), volume commitments, and termination clauses.",
    typical_evidence_gap:
      "'Offtake' is frequently a non-binding LOI at a price that assumes the producer hits optimistic cost targets. Binding take-or-pay with investment-grade counterparties is rare at pre-FID stage.",
    required_disconfirming_checks: [
      "Classify each offtake as LOI / MoU / binding contract / take-or-pay.",
      "Identify counterparty credit rating and whether it is investment-grade.",
      "Check the pricing mechanism and any conditions precedent.",
    ],
    strongest_counterevidence_examples: [
      "Binding take-or-pay with investment-grade counterparties covering greater than 50% of nameplate.",
      "Regulated utility offtake with cost-of-service pass-through.",
    ],
    common_false_positive_pattern:
      "Regulated markets with compliance obligations (RFS, LCFS, CBAM) where the buyer universe is effectively committed by law.",
  },
  {
    key: "supply_chain_is_diversified",
    domains: ["generic"],
    module_owner: "manufacturing",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    pattern: "Our supply chain is domestic and diversified.",
    why_tempting:
      "Current geopolitical framing makes this answer socially expected.",
    what_to_check:
      "Specific named suppliers and their share for each critical material (iridium, platinum, nickel, rare earths, specific membranes/catalysts), geographic concentration at the refining step (not just mining), and qualified second-source status.",
    typical_evidence_gap:
      "Mining origin may be diversified but refining is concentrated (typically in one geography for most critical minerals). Qualified second-source often means 'identified' not 'tested and approved.'",
    required_disconfirming_checks: [
      "For each critical material, identify mining and refining shares by country.",
      "Confirm whether second sources are qualified (tested and approved) vs merely identified.",
      "Report single-source critical components explicitly.",
    ],
    strongest_counterevidence_examples: [
      "Two or more qualified suppliers across mining and refining for each critical material.",
      "Inventory buffer of at least 180 days for single-source items.",
    ],
    common_false_positive_pattern:
      "Commodity inputs (steel, concrete, common metals) where diversification is a true property of the market.",
  },
  {
    key: "trl_implies_readiness",
    domains: ["generic"],
    module_owner: "scalability",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "medium",
    pattern: "We are at TRL 7/8, so deployment risk is low.",
    why_tempting:
      "TRL is a widely recognized framework and high numbers imply maturity.",
    what_to_check:
      "TRL is self-reported and covers technology only. Independently assess MRL (manufacturing readiness), CRL (commercial readiness), and IRL (integration readiness). Check for third-party TRL assessment (e.g., DOE, NASA, EC methodology).",
    typical_evidence_gap:
      "High TRL claims often rely on a single successful prototype, not repeated operation. MRL/CRL typically lag TRL by 2-3 levels.",
    required_disconfirming_checks: [
      "Ask for MRL and CRL ratings separately from TRL.",
      "Confirm TRL was assessed by an independent body, not self-declared.",
      "Check whether 'TRL 8' rests on one prototype or repeated operation.",
    ],
    strongest_counterevidence_examples: [
      "Independent TRL/MRL/CRL assessment by DOE, NASA, EC, or equivalent.",
      "Repeated operation history across multiple units and operators.",
    ],
    common_false_positive_pattern:
      "Technologies with formal, audited readiness assessments (defense, space) where TRL ratings are externally verified.",
  },
  {
    key: "third_party_validation_completed",
    domains: ["generic"],
    module_owner: "regulatory",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    pattern: "Third-party validation has been completed.",
    why_tempting:
      "'Third-party' sounds independent and rigorous.",
    what_to_check:
      "Who the validator is (engineering firm vs notified body vs academic), exactly what was validated (performance vs safety vs LCA vs manufacturability), test scope and duration, and whether the report is public or available under NDA.",
    typical_evidence_gap:
      "DNV/TUV/UL performance verification is often confused with certification, LCA, or bankability review. Scope is frequently narrow and the reviewer relies on company-supplied data.",
    required_disconfirming_checks: [
      "Name the validator and their role (engineering firm, notified body, academic lab).",
      "Describe exactly what was validated and bound the scope.",
      "Confirm the report is available for review under NDA.",
    ],
    strongest_counterevidence_examples: [
      "Independent engineer's report by a tier-1 firm covering performance, safety, and constructability.",
      "Notified-body certification (UL, TUV, IEC) covering the specific commercial product.",
    ],
    common_false_positive_pattern:
      "Products with mandatory certification (inverters, cells for aviation/automotive) where the validation is legally required and narrowly scoped.",
  },
  {
    key: "physics_based_model_is_accurate",
    domains: ["battery", "waste_to_fuels", "power_to_liquid"],
    module_owner: "physics",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "high",
    pattern: "Our model is physics-based, so projections are reliable.",
    why_tempting:
      "'Physics-based' connotes first-principles rigor and reviewer deference.",
    what_to_check:
      "What calibration data was used, what phenomena are not modeled (fouling, corrosion, catalyst sintering, side reactions, contamination), validation against independent datasets, and quantified residuals.",
    typical_evidence_gap:
      "Physics models still require empirical closure terms. Unmodeled phenomena often dominate long-term performance but are hidden by short-duration calibration datasets.",
    required_disconfirming_checks: [
      "List unmodeled phenomena and their expected impact.",
      "Compare model predictions to an independent holdout dataset and report residuals.",
      "Confirm closure/empirical terms are cited and grounded.",
    ],
    strongest_counterevidence_examples: [
      "Model validated against multiple operating assets covering the service envelope.",
      "Published peer-reviewed validation with quantified uncertainty.",
    ],
    common_false_positive_pattern:
      "Well-established engineering models (Aspen/HYSYS for chemical processes, pvlib for PV) in regimes where empirical closure is well-characterized.",
  },
  {
    key: "capacity_factor_assumption",
    domains: ["pv", "waste_to_fuels", "power_to_liquid", "inverter"],
    module_owner: "performance",
    applies_from_stage: "pilot_diligence",
    applies_to_brief_type: ["diligence", "decision"],
    priority: "high",
    pattern: "LCOE assumes a high capacity factor consistent with resource/feedstock.",
    why_tempting:
      "Resource/feedstock data often supports a high theoretical maximum.",
    what_to_check:
      "Historical capacity factors for comparable operating assets, planned maintenance downtime, forced outage rate from incumbent operators, and whether grid curtailment or feedstock interruption is modeled.",
    typical_evidence_gap:
      "Nameplate capacity factor assumed above 90% when real operating assets average 70-85% after accounting for maintenance, curtailment, and feedstock variability.",
    required_disconfirming_checks: [
      "Report assumed capacity factor and benchmark against comparable operating assets.",
      "Confirm planned and forced outage rates are modeled.",
      "Check whether feedstock interruption or grid curtailment is reflected in the base case.",
    ],
    strongest_counterevidence_examples: [
      "10+ years of operating data from comparable assets supporting the assumed CF.",
      "Third-party resource/feedstock study with probabilistic CF distribution.",
    ],
    common_false_positive_pattern:
      "Baseload technologies (geothermal, dispatchable hydro) with robust historical operating data.",
  },
  {
    key: "competitors_are_behind",
    domains: ["generic"],
    module_owner: "novelty",
    applies_from_stage: "discovery",
    applies_to_brief_type: ["research", "diligence", "decision"],
    priority: "medium",
    pattern: "Competitors are 5+ years behind our technology.",
    why_tempting:
      "Provides urgency, scarcity, and a moat narrative.",
    what_to_check:
      "Named competitors including quiet incumbents (oil majors, utilities, chemical companies have large unpublished R&D). Patent landscape, published pilot announcements, funded competing programs in DOE/ARPA-E/EU portfolios.",
    typical_evidence_gap:
      "Public-company deprioritization is often mistaken for absence. Hyperscalers, incumbents, and state-backed programs are underrepresented in Western competitive mapping.",
    required_disconfirming_checks: [
      "Map named competitors including incumbents and state-backed programs.",
      "Search patent filings in the core claim areas from the last 5 years.",
      "Check DOE/ARPA-E/EU funded program lists for adjacent work.",
    ],
    strongest_counterevidence_examples: [
      "Third-party competitive landscape study covering incumbents.",
      "Patent analytics report showing a defensible IP position.",
    ],
    common_false_positive_pattern:
      "Genuinely novel chemistry/architecture where an exhaustive patent/program search confirms the claim.",
  },
];

/** Filter catalog entries for a given selection context (stage + domain + brief type). */
export function selectRationalizations(
  ctx: SelectionContext,
): Rationalization[] {
  const filtered = RATIONALIZATIONS.filter(
    (r) =>
      domainApplies(r.domains, ctx.domain) &&
      stageApplies(r.applies_from_stage, ctx.stage) &&
      briefTypeApplies(r.applies_to_brief_type, ctx.brief_type),
  );
  return sortByPriorityThenKey(filtered);
}

/** Format a set of rationalizations into a prompt-ready markdown block. */
export function formatRationalizationsForPrompt(
  entries: Rationalization[],
): string {
  const lines = entries.map((r) => {
    const checks = r.required_disconfirming_checks.map((c) => `    - ${c}`).join("\n");
    return [
      `- **${r.pattern}** (key: \`${r.key}\`, module: ${r.module_owner}, priority: ${r.priority})`,
      `  - Why tempting: ${r.why_tempting}`,
      `  - What to check: ${r.what_to_check}`,
      `  - Typical gap: ${r.typical_evidence_gap}`,
      `  - Disconfirming checks required:\n${checks}`,
      `  - False-positive pattern: ${r.common_false_positive_pattern}`,
    ].join("\n");
  });
  return lines.join("\n");
}

/** Lookup a rationalization by key (stable ID). */
export function getRationalization(key: string): Rationalization | undefined {
  return RATIONALIZATIONS.find((r) => r.key === key);
}
