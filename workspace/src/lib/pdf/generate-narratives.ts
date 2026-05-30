/**
 * Narrative generation for the Techno-Economic Assessment Report.
 *
 * Generates institutional-grade narratives via four parallel cheap text-model
 * calls. Each section reads like a techno-economic assessment from a
 * national laboratory or top-tier consultancy — grounded in specific
 * numbers from the brief, calibrated uncertainty language, and explicit
 * peer/incumbent comparisons where available.
 *
 * Sections:
 *   1. Executive Summary + Technology Profile
 *   2. Technical Analysis + Thermodynamic Assessment + Economic Assessment + Commercial Positioning
 *   3. Manufacturing & Scale + Regulatory & Compliance + Safety & Risk + Environmental Impact
 *   4. System Integration + Strategic Value + Recommendations + Evidence Quality Narrative
 *
 * The 10-module scorecard still exists in the brief JSON and the PDF's
 * technical appendix — it is not the body of the report.
 */

import type { DeviceDecisionBrief, ModuleVerdictSummary } from "@/lib/brief-types";
import { callDeepSeekV3, getEnvVar } from "@/lib/backend";
import { formatCompositeScore } from "@/lib/canonical-score";
import {
  removeContradictoryUnavailableMetricPhrases,
  sanitizeUnsupportedMaturityClaims,
} from "@/lib/pdf/report-sanitizers";

// ── Types ────────────────────────────────────────────────────

export interface ReportNarratives {
  executive_summary: string;
  technology_profile: string;
  technical_analysis: string;
  thermodynamic_assessment: string;
  economic_assessment: string;
  commercial_positioning: string;
  manufacturing_and_scale: string;
  regulatory_and_compliance: string;
  safety_and_risk: string;
  environmental_impact: string;
  system_integration: string;
  strategic_value: string;
  recommendations: string;
  evidence_quality_narrative: string;
  // Backward compatibility — callers that reference old per-module
  // dictionaries will find them empty; the Technical Appendix renders
  // module findings from brief.module_summary directly.
  module_narratives: Record<string, string>;
  module_deep_dives: Record<string, string>;
}

export interface ProjectContext {
  name: string;
  goal?: string;
  domain?: string;
}

// ── Verdict mapping ──────────────────────────────────────────

const TIER_LABELS: Record<string, string> = {
  deploy: "Deployment Candidate \u2014 All Required Gates Cleared",
  strong: "Advanced Assessment \u2014 Strong Fundamentals Demonstrated",
  promising: "Pre-Commercial \u2014 Key Validation Milestones Pending",
  early: "Early-Stage \u2014 Technology Thesis Under Evaluation",
  insufficient: "Preliminary \u2014 Insufficient Evidence for Full Assessment",
  conditional: "Conditional \u2014 Critical Evidence Gaps Remain",
  caution: "Material Concerns \u2014 Significant Risk Factors Identified",
  not_ready: "Pre-Deployment \u2014 Fundamental Requirements Not Met",
};

function getTierLabel(brief: DeviceDecisionBrief): string {
  const trl = (brief as any).trl_assessment || "";
  const tier = brief.readiness_tier;
  const isTrlLow = /TRL [1-5]/.test(trl);

  if (isTrlLow && tier === "not_ready") return "Pre-Deployment \u2014 Physics Under Review";
  if (isTrlLow && tier === "insufficient") return "Pre-Pilot Assessment \u2014 De-Risking Pathway Identified";
  if (isTrlLow && tier === "early") return "Early-Stage \u2014 Investment Thesis Under Evaluation";
  return TIER_LABELS[tier] || tier;
}

function moduleDisplayName(name: string): string {
  const map: Record<string, string> = {
    "Physics & Causal Validity": "Physics",
    "Performance & Durability": "Performance",
    "Economics & Bankability": "Economics",
    "Safety & Resilience": "Safety",
    "Regulatory & Permitting": "Regulatory",
    "Manufacturing & Supply Chain": "Manufacturing",
    "Environmental & Circularity": "Environmental",
    "Scalability & Deployment": "Scalability",
    "System Integration": "Integration",
    "Novelty & Strategic Value": "Strategic Value",
  };
  return map[name] || name;
}

// ── Cheap text-model narrative generation ─────────────────────

async function callNarrativeModel(
  messages: Array<{ role: string; content: string }>,
  opts?: { maxTokens?: number },
): Promise<string> {
  const thinking = getEnvVar("BT_REPORT_DEEPSEEK_THINKING");
  return callDeepSeekV3(messages, {
    model: getEnvVar("BT_REPORT_TEXT_MODEL") || "deepseek-v4-flash",
    temperature: 0.3,
    maxTokens: opts?.maxTokens ?? 4000,
    jsonMode: true,
    thinking: thinking === "enabled" || thinking === "adaptive" ? thinking : "disabled",
    reasoningEffort: (getEnvVar("BT_REPORT_REASONING_EFFORT") as "low" | "medium" | "high" | "max" | "xhigh" | undefined) || "medium",
  });
}

function parseJSON(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { /* continue */ }
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1].trim()); } catch { /* continue */ } }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* continue */ }
  }
  return null;
}

function evidencePosture(brief: DeviceDecisionBrief): string {
  const b = brief as Record<string, any>;
  return String(brief.evidence_strength || b.evidence_level || "unknown").toLowerCase();
}

function evidenceContradictionReplacement(posture: string): string {
  const label = posture === "moderate" ? "moderate" : "strong";
  return `The evidence base is ${label} for the available document set; remaining limitations are specific gaps in independent operational, cost, regulatory, or long-duration performance data.`;
}

export function sanitizeNarrativeEvidencePosture(text: string, brief: DeviceDecisionBrief): string {
  if (!text) return text;
  const posture = evidencePosture(brief);
  if (!["strong", "moderate"].includes(posture)) return text;
  const sentenceWithEvidenceWeakness = /(?:^|(?<=[.!?]\s))[^.\n]*\bevidence base\b[^.\n]*\b(?:weak|minimal|thin|poor)\b[^.\n]*\./gi;
  return text.replace(sentenceWithEvidenceWeakness, (sentence) => {
    if (/\bnot\s+(?:weak|minimal|thin|poor)\b/i.test(sentence)) return sentence;
    return evidenceContradictionReplacement(posture);
  });
}

export function sanitizeNarrativesEvidencePosture(
  narratives: ReportNarratives,
  brief: DeviceDecisionBrief,
): ReportNarratives {
  const sanitize = (text: string) => removeContradictoryUnavailableMetricPhrases(
    sanitizeUnsupportedMaturityClaims(
      sanitizeNarrativeEvidencePosture(text, brief),
      brief as unknown as Record<string, unknown>,
    ),
    brief as unknown as Record<string, unknown>,
  );

  return {
    ...narratives,
    executive_summary: sanitize(narratives.executive_summary),
    technology_profile: sanitize(narratives.technology_profile),
    technical_analysis: sanitize(narratives.technical_analysis),
    thermodynamic_assessment: sanitize(narratives.thermodynamic_assessment),
    economic_assessment: sanitize(narratives.economic_assessment),
    commercial_positioning: sanitize(narratives.commercial_positioning),
    manufacturing_and_scale: sanitize(narratives.manufacturing_and_scale),
    regulatory_and_compliance: sanitize(narratives.regulatory_and_compliance),
    safety_and_risk: sanitize(narratives.safety_and_risk),
    environmental_impact: sanitize(narratives.environmental_impact),
    system_integration: sanitize(narratives.system_integration),
    strategic_value: sanitize(narratives.strategic_value),
    recommendations: sanitize(narratives.recommendations),
    evidence_quality_narrative: sanitize(narratives.evidence_quality_narrative),
  };
}

// ── Brief serialization ──────────────────────────────────────
//
// Hand the narrative model the *substance* it needs — the real
// numbers, the concrete findings, the specific gaps — and strip
// every layer of internal chrome (gate counts, IRIS tiers, axis
// verdicts, confidence percentages, module pass/fail labels). The
// brief JSON is still the system of record; this is just the
// client-facing projection.

function formatModuleFinding(m: ModuleVerdictSummary): string {
  const detail = (m.key_detail || "").trim();
  if (!detail) return `${moduleDisplayName(m.module_name)}: no specific finding reported.`;
  return `${moduleDisplayName(m.module_name)}: ${detail}`;
}

function prepareBriefContext(brief: DeviceDecisionBrief): string {
  const b = brief as Record<string, any>;
  const modules = brief.module_summary || [];

  // ── Module findings by area ──
  const physicsFindings = modules
    .filter((m) => ["Physics & Causal Validity", "Performance & Durability"].includes(m.module_name || ""))
    .map(formatModuleFinding);

  const economicsFindings = modules
    .filter((m) => m.module_name === "Economics & Bankability")
    .map(formatModuleFinding);

  const scaleFindings = modules
    .filter((m) => ["Scalability & Deployment", "Manufacturing & Supply Chain"].includes(m.module_name || ""))
    .map(formatModuleFinding);

  const blockerFindings = modules
    .filter((m) => ["Regulatory & Permitting", "Safety & Resilience", "Environmental & Circularity"].includes(m.module_name || ""))
    .map(formatModuleFinding);

  const otherFindings = modules
    .filter((m) => ["System Integration", "Novelty & Strategic Value"].includes(m.module_name || ""))
    .map(formatModuleFinding);

  // ── Structured axis data (Wave D) ──
  const axisLines: string[] = [];
  if (b.technical_feasibility) {
    axisLines.push("=== Technical feasibility axis ===");
    axisLines.push(`  Verdict: ${b.technical_feasibility.verdict}`);
    if (b.technical_feasibility.basis) axisLines.push(`  Basis: ${b.technical_feasibility.basis}`);
    if (b.technical_feasibility.delta_vs_benchmark) axisLines.push(`  vs benchmark: ${b.technical_feasibility.delta_vs_benchmark}`);
    if (b.technical_feasibility.gaps?.length) axisLines.push(`  Gaps: ${b.technical_feasibility.gaps.join("; ")}`);
    axisLines.push("");
  }
  if (b.commercial_viability) {
    axisLines.push("=== Commercial viability axis ===");
    axisLines.push(`  Verdict: ${b.commercial_viability.verdict}`);
    if (b.commercial_viability.basis) axisLines.push(`  Basis: ${b.commercial_viability.basis}`);
    if (b.commercial_viability.delta_vs_benchmark) axisLines.push(`  vs benchmark: ${b.commercial_viability.delta_vs_benchmark}`);
    if (b.commercial_viability.gaps?.length) axisLines.push(`  Gaps: ${b.commercial_viability.gaps.join("; ")}`);
    axisLines.push("");
  }
  if (b.scale_readiness_axis) {
    axisLines.push("=== Scale readiness axis ===");
    axisLines.push(`  Verdict: ${b.scale_readiness_axis.verdict}`);
    if (b.scale_readiness_axis.basis) axisLines.push(`  Basis: ${b.scale_readiness_axis.basis}`);
    if (b.scale_readiness_axis.gaps?.length) axisLines.push(`  Gaps: ${b.scale_readiness_axis.gaps.join("; ")}`);
    axisLines.push("");
  }
  if (b.spec_compliance_axis) {
    axisLines.push("=== Spec compliance axis ===");
    axisLines.push(`  Verdict: ${b.spec_compliance_axis.verdict}`);
    if (b.spec_compliance_axis.basis) axisLines.push(`  Basis: ${b.spec_compliance_axis.basis}`);
    if (b.spec_compliance_axis.gaps?.length) axisLines.push(`  Gaps: ${b.spec_compliance_axis.gaps.join("; ")}`);
    axisLines.push("");
  }

  // ── Thermodynamic quality data ──
  const thermoLines: string[] = [];
  if (b.thermodynamic_quality || b.second_law_efficiency != null) {
    thermoLines.push("=== Thermodynamic quality ===");
    const tq = b.thermodynamic_quality || {};
    if (b.second_law_efficiency != null) thermoLines.push(`  Second-law (exergy) efficiency: ${(b.second_law_efficiency * 100).toFixed(1)}%`);
    else if (tq.second_law_efficiency != null) thermoLines.push(`  Second-law (exergy) efficiency: ${(tq.second_law_efficiency * 100).toFixed(1)}%`);
    if (tq.first_law_efficiency != null) thermoLines.push(`  First-law efficiency: ${(tq.first_law_efficiency * 100).toFixed(1)}%`);
    if (b.exergy_ceiling != null) thermoLines.push(`  Exergy ceiling: ${(b.exergy_ceiling * 100).toFixed(1)}%`);
    if (b.exergy_headroom != null) thermoLines.push(`  Exergy headroom: ${(b.exergy_headroom * 100).toFixed(1)}%`);
    if (b.exergy_carrier_type) thermoLines.push(`  Carrier type: ${b.exergy_carrier_type}`);
    if (b.exergy_quality_factor != null) thermoLines.push(`  Quality factor: ${b.exergy_quality_factor.toFixed(3)}`);
    if (tq.verdict) thermoLines.push(`  Thermodynamic verdict: ${tq.verdict}`);
    if (tq.basis) thermoLines.push(`  Basis: ${tq.basis}`);
    if (b.exergy_summary_plain) thermoLines.push(`  Summary: ${b.exergy_summary_plain}`);
    thermoLines.push("");
  }

  // ── Exergy destruction map ──
  const destructionLines: string[] = [];
  if (b.exergy_destruction_map?.length > 0) {
    destructionLines.push("=== Exergy destruction map (loss allocation) ===");
    for (const entry of b.exergy_destruction_map.slice(0, 8)) {
      destructionLines.push(`  - ${entry.mechanism}: ${entry.destruction_Wh.toFixed(1)} Wh (${(entry.fraction_of_input * 100).toFixed(1)}% of input)`);
    }
    destructionLines.push("");
  }

  // ── Economics detailed fields ──
  const econLines: string[] = [];
  if (b.lcof_nominal_per_gge != null || b.lcof_exergy_adjusted_per_gge != null) {
    econLines.push("=== Levelized cost data ===");
    if (b.lcof_nominal_per_gge != null) econLines.push(`  LCOF (nominal): $${b.lcof_nominal_per_gge.toFixed(2)}/GGE`);
    if (b.lcof_exergy_adjusted_per_gge != null) econLines.push(`  LCOF (exergy-adjusted): $${b.lcof_exergy_adjusted_per_gge.toFixed(2)}/GGE`);
    if (b.lcof_divergence_pct != null) econLines.push(`  Exergy-adjusted divergence: ${b.lcof_divergence_pct.toFixed(1)}%`);
    if (b.lcof_exergy_adjustment_note) econLines.push(`  Adjustment note: ${b.lcof_exergy_adjustment_note}`);
    if (b.quality_factor_applied != null) econLines.push(`  Quality factor applied: ${b.quality_factor_applied.toFixed(3)}`);
    econLines.push("");
  }

  // ── Spec compliance ──
  const specLines: string[] = [];
  const specBlock = b.spec_compliance || {};
  if (specBlock.verdict || b.spec_compliance_verdict) {
    specLines.push("=== Spec compliance ===");
    specLines.push(`  Verdict: ${specBlock.verdict || b.spec_compliance_verdict}`);
    if (specBlock.checks?.length > 0) {
      for (const c of specBlock.checks.slice(0, 6)) {
        specLines.push(`  - ${c.check_id}: ${c.verdict}${c.detail ? ` (${c.detail})` : ""}${c.market_impact ? ` [market: ${c.market_impact}]` : ""}`);
      }
    }
    specLines.push("");
  }

  // ── Solver / sidecar status ──
  const solverLines: string[] = [];
  const solverStatus = b.solver_surface_status || b.sidecar_gate;
  if (solverStatus) {
    solverLines.push("=== Solver verification ===");
    solverLines.push(`  Status: ${solverStatus}`);
    if (b.sidecar_concordance != null) solverLines.push(`  Concordance: ${b.sidecar_concordance}`);
    if (b.sidecar_note) solverLines.push(`  Note: ${b.sidecar_note}`);
    solverLines.push("");
  }

  // ── Validation status ──
  const validationLines: string[] = [];
  if (b.validation_valid != null) {
    validationLines.push("=== Validation status ===");
    validationLines.push(`  Valid: ${b.validation_valid}`);
    if (b.validation_errors?.length > 0) {
      validationLines.push(`  Errors: ${b.validation_errors.join("; ")}`);
    }
    validationLines.push("");
  }

  // ── Score components ──
  const scoreLines: string[] = [];
  if (b.score_components) {
    scoreLines.push("=== Score components ===");
    for (const [key, value] of Object.entries(b.score_components)) {
      if (typeof value === "number") {
        scoreLines.push(`  ${key}: ${value.toFixed(3)}`);
      } else {
        scoreLines.push(`  ${key}: ${value}`);
      }
    }
    scoreLines.push("");
  }

  // ── Performance claims ──
  const claimsLines: string[] = [];
  if (b.performance_claims?.length > 0) {
    claimsLines.push("=== Performance claims ===");
    for (const claim of b.performance_claims.slice(0, 8)) {
      claimsLines.push(`  - ${claim}`);
    }
    claimsLines.push("");
  }

  // ── System description ──
  const sysLines: string[] = [];
  if (b.system_description) {
    sysLines.push(`System description: ${b.system_description}`);
    sysLines.push("");
  }

  // ── Competitive context ──
  const compLines: string[] = [];
  if (b.competitive_context) {
    compLines.push(`Competitive context: ${b.competitive_context}`);
    compLines.push("");
  }

  // ── Recommendations / alternatives ──
  const recLines: string[] = [];
  if (b.recommendations?.length > 0) {
    recLines.push("=== Alternative technologies considered ===");
    for (const rec of b.recommendations.slice(0, 4)) {
      recLines.push(`  - ${rec.alternative_name} (${rec.alternative_domain}): ${rec.rationale}`);
      if (rec.comparison_metric) recLines.push(`    Comparison: ${rec.comparison_metric}: ${rec.evaluated_value} vs ${rec.alternative_value}`);
      if (rec.key_advantages?.length) recLines.push(`    Advantages: ${rec.key_advantages.join("; ")}`);
      if (rec.key_tradeoffs?.length) recLines.push(`    Tradeoffs: ${rec.key_tradeoffs.join("; ")}`);
    }
    recLines.push("");
  }

  // ── Information gaps ──
  const gapLines: string[] = [];
  if (b.information_gaps?.length > 0) {
    gapLines.push("=== Information gaps ===");
    for (const gap of b.information_gaps.slice(0, 8)) {
      gapLines.push(`  - ${gap}`);
    }
    gapLines.push("");
  }

  // ── Combined verdict ──
  const verdictLines: string[] = [];
  if (b.combined_verdict) {
    verdictLines.push(`Combined verdict: ${b.combined_verdict}`);
    if (b.combined_verdict_label) verdictLines.push(`Verdict label: ${b.combined_verdict_label}`);
    if (b.verdict_modifiers?.length) verdictLines.push(`Modifiers: ${b.verdict_modifiers.join(", ")}`);
    verdictLines.push("");
  }

  // ── Evidence coverage ──
  const covLines: string[] = [];
  if (b.evidence_coverage_summary) {
    covLines.push("=== Evidence coverage by module ===");
    for (const [mod, cov] of Object.entries(b.evidence_coverage_summary) as [string, any][]) {
      covLines.push(`  ${mod}: ${cov.params_matched}/${cov.params_expected} (${(cov.coverage * 100).toFixed(0)}%)`);
    }
    covLines.push("");
  }

  return [
    `Technology: ${brief.commercial_name || brief.device_id}`,
    brief.manufacturer ? `Manufacturer: ${brief.manufacturer}` : "",
    `Domain: ${brief.domain}`,
    brief.technology_family ? `Technology family: ${brief.technology_family}` : "",
    b.trl_assessment ? `Technology readiness: ${b.trl_assessment}` : "",
    `Headline: ${brief.headline}`,
    `Overall assessment result: ${getTierLabel(brief)}`,
    `Composite score: ${formatCompositeScore(brief.composite_score, "narrative")}`,
    brief.hard_fail ? `Hard fail: YES (${brief.hard_fail_reasons.join("; ")})` : "",
    "",
    ...sysLines,
    ...compLines,
    ...verdictLines,
    "",
    "=== Physics & performance findings ===",
    ...physicsFindings,
    "",
    "=== Economics findings ===",
    ...economicsFindings,
    brief.economics_summary ? `Economics summary: ${brief.economics_summary}` : "",
    brief.economics_range ? `Economics range: ${brief.economics_range}` : "",
    ...(brief.economics_sensitivity?.length ? ["Sensitivity factors:", ...brief.economics_sensitivity.map((s) => `  - ${s}`)] : []),
    "",
    ...econLines,
    "",
    "=== Scale & manufacturing findings ===",
    ...scaleFindings,
    brief.manufacturing_summary ? `Manufacturing summary: ${brief.manufacturing_summary}` : "",
    "",
    "=== Regulatory, safety, environmental ===",
    ...blockerFindings,
    brief.regulatory_summary ? `Regulatory summary: ${brief.regulatory_summary}` : "",
    "",
    "=== System integration & strategic ===",
    ...otherFindings,
    "",
    ...axisLines,
    ...thermoLines,
    ...destructionLines,
    ...specLines,
    ...solverLines,
    ...validationLines,
    ...scoreLines,
    ...claimsLines,
    ...recLines,
    ...gapLines,
    ...covLines,
    "",
    "=== Key strengths (integrate into narrative \u2014 do not list) ===",
    ...(brief.key_strengths || []).map((s) => `  - ${s}`),
    "",
    "=== Key concerns (integrate into narrative \u2014 do not list) ===",
    ...(brief.key_concerns || []).map((c) => `  - ${c}`),
    "",
    "=== Prioritized next actions ===",
    ...(brief.next_actions || []).map((a, i) => `  ${i + 1}. ${a}`),
    "",
    // Baseline comparisons
    ...(b.baseline_comparisons?.length > 0 ? [
      "=== Baseline comparisons (assessed values vs published references) ===",
      ...b.baseline_comparisons.slice(0, 8).map((bc: any) =>
        `  - ${bc.parameter}: ${bc.your_value} vs ${bc.baseline_value} (${bc.baseline_source}) \u2192 ${bc.position} (${bc.assessment})`,
      ),
      "",
    ] : []),
    // Highest-impact data gaps
    ...(b.ranked_gap_guidance?.length > 0 ? [
      "=== Highest-impact data gaps ===",
      ...b.ranked_gap_guidance.slice(0, 6).map((g: any) =>
        `  - [${g.impact}${g.blocking ? "/BLOCKING" : ""}] ${g.parameter}: ${g.why_it_matters}${g.typical_range ? ` (typical range: ${g.typical_range})` : ""}`,
      ),
      "",
    ] : []),
    // Founder / commercial signals
    ...(b.founder_insights ? [
      "=== Commercial signals ===",
      b.founder_insights.technology_identity ? `  Technology identity: ${b.founder_insights.technology_identity}` : "",
      b.founder_insights.top_commercial_bottleneck ? `  Primary commercial bottleneck: ${b.founder_insights.top_commercial_bottleneck}` : "",
      b.founder_insights.sellable_market ? `  Target market position: ${b.founder_insights.sellable_market}` : "",
      b.founder_insights.strongest_claim ? `  Strongest substantiated claim: ${b.founder_insights.strongest_claim}` : "",
      b.founder_insights.weakest_claim ? `  Weakest claim (requires evidence): ${b.founder_insights.weakest_claim}` : "",
      b.founder_insights.highest_value_next_action ? `  Highest-value next action: ${b.founder_insights.highest_value_next_action}` : "",
      "",
    ] : []),
    // Resolved subject
    ...(b.resolved_subject?.company ? [
      `Resolved subject: ${b.resolved_subject.company} \u2014 ${b.resolved_subject.technology}`,
      b.resolved_subject.feedstock ? `Feedstock: ${b.resolved_subject.feedstock}` : "",
      b.resolved_subject.application ? `Application: ${b.resolved_subject.application}` : "",
      "",
    ] : []),
    // Red flags
    ...((brief.red_flags_triggered?.length || 0) > 0 ? [
      `=== Triggered risk flags (${brief.unresolved_red_flag_count ?? brief.red_flags_triggered!.length} unresolved, ${brief.blocker_red_flag_count ?? 0} blockers) ===`,
      ...brief.red_flags_triggered!.map((f) =>
        `  - [${f.severity}/${f.status}] ${f.key}: ${f.trigger_basis}${f.evidence_refs.length ? ` \u2014 evidence: ${f.evidence_refs.join(", ")}` : ""}`,
      ),
      "",
    ] : []),
    // Rationalization checks
    ...((brief.rationalization_checks?.length || 0) > 0 ? [
      "=== Rationalization checks (claims flagged for interrogation) ===",
      ...brief.rationalization_checks!.map((r) =>
        `  - [${r.status}] ${r.key}: "${r.pattern}" \u2014 ${r.trigger_basis}`,
      ),
      "",
    ] : []),
    // Veto concerns
    ...(brief.veto_concerns?.length > 0 ? [
      "=== Veto-class concerns ===",
      ...brief.veto_concerns.map((v) => `  - ${v}`),
      "",
    ] : []),
    // Truth reconciliation
    ...(b.truth_reconciliation && b.truth_reconciliation.status !== "clean" ? [
      `=== Truth reconciliation: ${b.truth_reconciliation.status} (${b.truth_reconciliation.n_critical} critical, ${b.truth_reconciliation.n_warning} warnings) ===`,
      ...b.truth_reconciliation.disagreements.slice(0, 4).map((d: any) =>
        `  - [${d.severity}] ${d.field}: ${d.message}`,
      ),
      "",
    ] : []),
    // Evidence basis
    `Evidence basis: ${brief.evidence_strength || "unknown"}`,
    b.evidence_level ? `Evidence level: ${b.evidence_level}` : "",
    ["strong", "moderate"].includes(evidencePosture(brief))
      ? "Narrative constraint: do not describe the overall evidence base as weak, minimal, thin, or poor. Discuss specific remaining evidence gaps separately."
      : "",
    brief.literature_findings ? `Literature sources consulted: ${brief.literature_findings}` : "",
    brief.methodology_note ? `Methodology note: ${brief.methodology_note}` : "",
    "",
    "=== Caveats ===",
    ...(brief.caveats || []).slice(0, 8).map((c) => `  - ${c}`),
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Tone gates (CC-BE-WTF-0002) ───────────────────────────────
//
// When the underlying brief shows weak-evidence / failed-validation /
// unconfirmed-sidecar / failed-spec, the narrative model must not be
// allowed to use bullish language ("well-positioned", "clear path",
// "comfortably beats", "ready to deploy", etc.). Otherwise the PDF
// claims a posture the JSON does not support.
//
// Returns an array of constraint strings; empty when no gate fires.

interface ToneGateContext {
  validationFailed: boolean;
  sidecarNotConfirmed: boolean;
  specVerdictFail: boolean;
  evidenceWeak: boolean;
  reasons: string[];
}

function evaluateToneGates(brief: DeviceDecisionBrief): ToneGateContext {
  const b = brief as Record<string, any>;
  const reasons: string[] = [];

  const validationValid = b.validation_valid;
  const validationFailed = validationValid === false;
  if (validationFailed) {
    const errs = (b.validation_errors as string[] | undefined) || [];
    reasons.push(
      errs.length > 0
        ? `validation_valid=false (${errs.slice(0, 2).join("; ")})`
        : "validation_valid=false",
    );
  }

  const sidecarStatus = (b.solver_surface_status as string | undefined) || (b.sidecar_gate as string | undefined);
  const sidecarNotConfirmed = sidecarStatus === "not_confirmed";
  if (sidecarNotConfirmed) {
    reasons.push("sidecar_gate=not_confirmed (solver did not corroborate the headline result)");
  }

  const specBlock = (b.spec_compliance as Record<string, any> | undefined) || {};
  const specVerdict = (specBlock.verdict as string | undefined) || (b.spec_compliance_verdict as string | undefined);
  const specVerdictFail = specVerdict === "fail";
  if (specVerdictFail) {
    const failingChecks = ((specBlock.checks as Array<Record<string, any>> | undefined) || [])
      .filter((c) => c.verdict === "fail")
      .slice(0, 2)
      .map((c) => `${c.check_id}: ${c.detail || c.market_impact || "fails spec"}`);
    reasons.push(
      failingChecks.length > 0
        ? `spec_compliance.verdict=fail (${failingChecks.join("; ")})`
        : "spec_compliance.verdict=fail",
    );
  }

  const evidence = ((b.evidence_strength as string | undefined) || (b.evidence_level as string | undefined) || "").toLowerCase();
  const evidenceWeak = evidence === "weak" || evidence === "minimal";
  if (evidenceWeak) {
    reasons.push(`evidence_strength=${evidence} (insufficient operational data for deployment-grade assessment)`);
  }

  return { validationFailed, sidecarNotConfirmed, specVerdictFail, evidenceWeak, reasons };
}

function toneGateBlock(gates: ToneGateContext): string {
  if (gates.reasons.length === 0) return "";
  return [
    "",
    "=== TONE GATES (BINDING \u2014 DO NOT OVERRIDE) ===",
    "The underlying assessment carries the following posture-defining flags:",
    ...gates.reasons.map((r) => `  - ${r}`),
    "",
    "Because of the above, the narrative MUST NOT use any of the following",
    "bullish framings \u2014 they would misrepresent the assessment:",
    '  - "well-positioned", "clear path to deployment", "comfortably beats",',
    '    "ready for commercialization", "validated at scale", "proven economics",',
    '    "robust" (as a verdict), "strong fit", "investment-ready" (without caveat),',
    '    "game-changing", "disruptive", "breakthrough" (as unqualified claims).',
    "",
    "Required posture instead:",
    "  - Lead each affected section with a one-sentence caveat that names the",
    "    specific limitation BEFORE describing any positive findings.",
    gates.specVerdictFail
      ? "  - Spec compliance discussion MUST state plainly that the technology currently fails one or more market specifications and name which markets are blocked."
      : "",
    gates.sidecarNotConfirmed
      ? "  - Technical analysis MUST state that the independent solver did not confirm the headline mass/energy balance and that the result is provisional."
      : "",
    gates.evidenceWeak
      ? "  - Evidence discussion MUST state the evidence base is weak/minimal and identify the specific operational data that would upgrade the assessment."
      : "",
    gates.validationFailed
      ? "  - Recommendations MUST acknowledge that the assessment currently fails internal validation checks and is not yet a deployment-grade artifact."
      : "",
    "  - Recommendations must read as a de-risking pathway, not a commercialization plan.",
    "",
    "If a positive finding is substantiated, you may state it \u2014 but always after the caveat,",
    "and never with language that implies the technology is currently deployable.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── System prompt ───────────────────────────────────────────

export const SYSTEM_PROMPT = `You are preparing a techno-economic deployment-readiness assessment report. This report was generated by Exergy Lab's deployment-readiness assessment platform. The assessment synthesizes physics-based simulation, techno-economic analysis, regulatory pathway mapping, and model-pending manufacturing scale evaluation across ten independent evaluation dimensions.

VOICE AND REGISTER:
- Write in the register of a senior technical advisor at a national laboratory or international energy agency. The audience is institutional: project finance teams, corporate development officers, technology scouts at utilities, and public-sector program managers.
- Be precise. Cite specific numbers from the assessment data: levelized costs ($/GGE, $/MWh), yields, conversion efficiencies, second-law efficiencies, capital cost ranges, capacity factors, degradation rates, and peer benchmarks. Generic language ("shows favorable economics") has no place in this report.
- Be balanced and calibrated. Substantiated strengths are stated clearly. Material risks and evidence gaps are stated with equal clarity. There is no advocacy — only assessment.
- Use calibrated uncertainty language. "The evidence base supports..." when data is strong. "Absent validated operational data at scale..." when it is not. "The current assessment is bounded by..." to frame limitations.
- Be thorough. Each section should provide 3-5 substantive paragraphs. The reader should finish each section with a clear understanding of the finding, its basis, its limitations, and its implications.

DO NOT:
- Use casual or promotional language. No "game-changing", "disruptive", "exciting", "promising" (as an unqualified adjective), or startup pitch framing.
- Reference internal methodology, scoring systems, module names, gate counts, IRIS grades, C0/C1/C2/C3 tiers, confidence percentages, or calibration tiers. Methodology is described in a separate appendix.
- Describe the assessment platform itself or its architecture. The report speaks in the voice of the assessment, not about the assessment.
- Declare technologies "uninvestable" or "not viable" — instead, state what evidence is required and what milestones would advance the assessment.
- Treat pre-commercial technologies as failing because they lack deployment history. State the technology readiness level and what validation is required to advance.
- Use filler phrases ("further study is needed", "additional research required") without specifying exactly what study, what research, and why it matters.

SOURCE OF TRUTH:
- The assessment data provided is authoritative. Render the findings. Do not invent risks, red flags, or concerns not present in the data.
- When the data includes triggered risk flags, name them explicitly and distinguish them from rationalization checks (claims under interrogation).
- When baseline comparisons are available, use them as peer anchors. State the assessed value, the reference value, and the source.

Return only valid JSON. Each string value should use \\n for paragraph breaks.`;

// ── Prompt builders ─────────────────────────────────────────

export function buildCall1Prompt(brief: DeviceDecisionBrief, ctx: ProjectContext): string {
  const gates = evaluateToneGates(brief);
  return `Write the opening sections of a Techno-Economic Deployment-Readiness Assessment Report.

SUBJECT:
- Technology: ${ctx.name}
${ctx.goal ? `- Assessment objective: ${ctx.goal}` : ""}
${ctx.domain ? `- Domain: ${ctx.domain}` : ""}

${prepareBriefContext(brief)}
${toneGateBlock(gates)}
Return a JSON object with these keys:

{
  "executive_summary": "4-5 paragraphs of institutional-grade executive summary.\\n\\nParagraph 1: Identify the technology, its developer/manufacturer, and state the bottom-line assessment result in one clear sentence. Name the assessment tier (${getTierLabel(brief)}) and what it means in plain terms.\\n\\nParagraph 2: Summarize the strongest technical findings with specific numbers \u2014 conversion efficiencies, yields, thermodynamic performance, levelized costs, and how they compare to incumbent benchmarks or published peer data. Every claim must cite a number from the assessment data.\\n\\nParagraph 3: State the material risks, evidence gaps, and unresolved concerns. Name specific parameters, not categories. If risk flags were triggered, name the most significant ones and their implications.\\n\\nParagraph 4: Outline the 3-4 highest-priority actions that would materially advance the assessment \u2014 what evidence, what validation, what milestones. Each action should specify what it would resolve and why it matters now.\\n\\nParagraph 5 (if warranted): State the investment/deployment implication \u2014 not a recommendation, but a clear statement of what the current evidence base does and does not support.",

  "technology_profile": "3-4 paragraphs providing a comprehensive technology profile.\\n\\nParagraph 1: Describe the technology \u2014 what it is, its operating principle, the conversion pathway, and the target application. Use domain-appropriate technical language but ensure a technically literate non-specialist can follow. Include the technology family and any relevant process configuration details.\\n\\nParagraph 2: Place the technology in its competitive landscape. What incumbent technologies does it aim to displace or complement? What are the key differentiators \u2014 feedstock flexibility, conversion efficiency, product quality, cost structure, or environmental profile? If baseline comparisons are available, anchor the positioning with specific numbers.\\n\\nParagraph 3: Describe the current development status \u2014 technology readiness level, stage of validation, and the gap between current demonstrated performance and commercial requirements. Be specific about what has been demonstrated and what remains to be validated.\\n\\nParagraph 4 (if data supports): Note the regulatory and market context \u2014 relevant policy frameworks, certification requirements, and target market segments. This sets the frame for the detailed sections that follow."
}`;
}

export function buildCall2Prompt(brief: DeviceDecisionBrief): string {
  const gates = evaluateToneGates(brief);
  return `Write the core technical and economic assessment sections of a Techno-Economic Deployment-Readiness Assessment Report.

${prepareBriefContext(brief)}
${toneGateBlock(gates)}
Return a JSON object with these keys. Each section is a synthesized analytical narrative, not a list of findings:

{
  "technical_analysis": "4-5 paragraphs synthesizing the physics, performance, and durability assessment.\\n\\nParagraph 1: State the core technical finding \u2014 does the underlying physics and engineering hold up under scrutiny? Cite specific metrics: conversion efficiency, yield, selectivity, energy balance, mass balance. Compare to theoretical limits and published peer performance where baseline data is available.\\n\\nParagraph 2: Assess performance durability and degradation. What is the projected performance trajectory over the intended operating life? Are there identified degradation mechanisms, catalyst deactivation pathways, or materials limitations? If operational data is limited, state exactly what duration and conditions would constitute adequate validation.\\n\\nParagraph 3: Address the specific technical risks and open questions identified in the assessment. Name the parameters that are most uncertain, the operating conditions under which performance has not been validated, and the failure modes that have not been characterized. Distinguish between risks that are resolvable through standard engineering practice and those that require fundamental advances.\\n\\nParagraph 4: If solver verification or independent simulation was performed, state whether it corroborated the headline results and note any discrepancies. If verification was not performed or did not confirm results, state this clearly and note the implication for the confidence level of the technical assessment.\\n\\nParagraph 5: Provide a net technical assessment \u2014 a calibrated statement of where the technology stands technically, what the binding technical uncertainties are, and what validation pathway would resolve them.",

  "thermodynamic_assessment": "3-4 paragraphs on thermodynamic quality and exergy analysis.\\n\\nParagraph 1: Report the second-law (exergy) efficiency and compare it to the first-law efficiency. Explain what the gap between them reveals about the thermodynamic quality of the conversion process. If the exergy ceiling and headroom are known, state them and explain what fraction of the theoretical maximum the technology captures.\\n\\nParagraph 2: If an exergy destruction map is available, describe the dominant loss mechanisms \u2014 where in the process chain is thermodynamic quality being destroyed, and what fraction of input exergy each mechanism consumes. Identify the largest destruction hotspot and assess whether it is inherent to the process or addressable through engineering optimization.\\n\\nParagraph 3: Assess the exergy quality factor and carrier type. What does the thermodynamic quality of the output product imply for its end-use value? If there is a material divergence between nominal and exergy-adjusted levelized costs, explain what drives it and what it means for the true economic competitiveness of the technology.\\n\\nParagraph 4 (if data supports): Compare the thermodynamic performance to incumbent or peer technologies. Is the exergy efficiency competitive, or does it represent a structural disadvantage? What thermodynamic improvements would have the greatest impact on overall system economics?",

  "economic_assessment": "4-5 paragraphs on the techno-economic case.\\n\\nParagraph 1: State the headline economics \u2014 levelized cost of the primary output (LCOF, LCOE, LCOS as appropriate), both nominal and exergy-adjusted if available. Compare directly to the incumbent benchmark and state the cost premium or discount. If the economics are policy-dependent, state the cost with and without policy support.\\n\\nParagraph 2: Break down the cost structure \u2014 what are the 2-3 largest cost drivers? Capital intensity ($/kW or $/unit capacity), feedstock or energy input costs, operating costs, and any policy credits or tipping fees that materially affect the unit economics. If FOAK vs NOAK cost projections are available, state the learning rate assumptions and the production volume at which cost parity is expected.\\n\\nParagraph 3: Assess the sensitivity landscape \u2014 which parameters have the greatest leverage on economics? If sensitivity factors are provided, rank them by impact and state the range of outcomes. Identify the single parameter whose resolution would most improve model-pending finance diligence.\\n\\nParagraph 4: Address the path from modeled economics to finance-ready evidence. What is the gap between the current assessment (simulation-based, limited operational data) and what a project finance team would require? What data, demonstration, or operating history would close that validation-pending gap?\\n\\nParagraph 5: State the net economic assessment \u2014 is the technology economically competitive today, conditionally competitive (dependent on specific policy or market conditions), or pre-competitive (requiring cost reduction through scale or learning)?",

  "commercial_positioning": "3-4 paragraphs on market position and commercial viability.\\n\\nParagraph 1: Define the target market segment and the competitive frame. What products does this technology produce, who are the buyers, and what do they currently pay? If the assessment includes market positioning data, state the assessed market fit and any spec compliance results.\\n\\nParagraph 2: Assess commercial differentiation \u2014 what is the technology's value proposition beyond cost? Consider feedstock flexibility, environmental attributes (carbon intensity, lifecycle emissions), product quality, co-product value, modularity, and geographic deployment flexibility. Anchor claims to specific data from the assessment.\\n\\nParagraph 3: Identify the primary commercial bottleneck \u2014 the single factor that most constrains the path from technical demonstration to commercial revenue. Is it cost, product quality/specification, offtake certainty, regulatory approval, or scale? State what would resolve the bottleneck and on what timeline.\\n\\nParagraph 4 (if data supports): If alternative technologies were evaluated or are referenced in the assessment, provide a brief comparative assessment. State where this technology has advantages and where alternatives may be better positioned."
}`;
}

export function buildCall3Prompt(brief: DeviceDecisionBrief): string {
  const gates = evaluateToneGates(brief);
  return `Write the deployment feasibility sections of a Techno-Economic Deployment-Readiness Assessment Report.

${prepareBriefContext(brief)}
${toneGateBlock(gates)}
Return a JSON object with these keys. Each section is a synthesized analytical narrative:

{
  "manufacturing_and_scale": "3-5 paragraphs on model-pending manufacturing scale and scaling pathway.\\n\\nParagraph 1: Assess the current validation-pending manufacturing scale evidence \u2014 what production processes are required, what is the current scale of demonstrated production, and what is the gap to commercial-scale manufacturing? If manufacturing findings are available, cite specific constraints: equipment availability, process complexity, quality control requirements, and throughput limitations.\\n\\nParagraph 2: Describe the scaling pathway \u2014 is scale-up achieved through numbering-up of modular units, through equipment scale-up, or through process intensification? State the FOAK/NOAK cost relationship and the production volume or number of deployments required to achieve cost maturity. If capacity utilization data is available, state the sustained throughput as a fraction of nameplate capacity.\\n\\nParagraph 3: Assess supply chain risks \u2014 are there critical materials, catalysts, or components with concentrated supply, long lead times, or price volatility? Identify the single supply chain element that poses the greatest risk to scale-up and what mitigation options exist.\\n\\nParagraph 4 (if data supports): Address workforce and infrastructure requirements. What specialized skills, equipment, or site characteristics are needed for deployment? Are these readily available in target markets or do they represent a constraint?\\n\\nParagraph 5 (if data supports): Provide a net manufacturing assessment \u2014 state the model-pending manufacturing scale position and the critical path items that require pilot validation before commercial production is feasible.",

  "regulatory_and_compliance": "3-4 paragraphs on regulatory pathway and compliance.\\n\\nParagraph 1: Identify the applicable regulatory frameworks, standards, and certification requirements for the technology and its target markets. Name specific standards bodies, codes, and permits. If the assessment includes regulatory findings, state the current compliance status and any identified gaps.\\n\\nParagraph 2: Assess the permitting and approval pathway \u2014 what permits, certifications, or approvals are required before commercial deployment? Estimate the timeline and identify potential bottlenecks. If regulatory risk flags were triggered, name them and explain their implications.\\n\\nParagraph 3: Address policy dependencies \u2014 if the technology's economics or market access depend on specific policy instruments (tax credits, mandates, carbon pricing, renewable fuel standards), name them and assess the policy risk. State what the economics look like with and without policy support.\\n\\nParagraph 4 (if data supports): Identify jurisdictional considerations \u2014 which markets offer the most favorable regulatory environment, and which present barriers? If international deployment is contemplated, note cross-border regulatory complexity.",

  "safety_and_risk": "3-4 paragraphs on safety assessment and risk profile.\\n\\nParagraph 1: Summarize the overall safety assessment. Identify the primary hazards associated with the technology \u2014 thermal runaway, toxic emissions, high-pressure operation, hazardous materials handling, or other process-specific risks. State the safety verdict from the assessment and cite specific findings.\\n\\nParagraph 2: Assess the risk mitigation framework \u2014 what safety systems, engineering controls, and operational procedures are required? Are they standard industry practice or do they require novel approaches? If safety risk flags were triggered, name them and their implications for deployment.\\n\\nParagraph 3: Address failure modes and resilience \u2014 what happens when the system fails? Are failure modes well-characterized? Is there a credible failure analysis, or is this a gap in the current assessment? State what safety validation would be required before commercial deployment.\\n\\nParagraph 4 (if data supports): Note any safety-related regulatory requirements that specifically affect this technology \u2014 siting restrictions, buffer zones, emergency response requirements, or insurance implications.",

  "environmental_impact": "3-4 paragraphs on environmental assessment and lifecycle impact.\\n\\nParagraph 1: State the lifecycle environmental profile \u2014 carbon intensity of the primary product (gCO2e/MJ or equivalent), comparison to the incumbent it aims to displace, and whether the technology achieves a net emissions reduction. If lifecycle assessment data is available, cite the well-to-gate or cradle-to-grave figures.\\n\\nParagraph 2: Assess resource efficiency and circularity \u2014 water consumption, waste streams, byproduct disposition, and end-of-life considerations. If the technology produces hazardous waste or requires hazardous inputs, state the volumes and disposal requirements.\\n\\nParagraph 3: Identify environmental risk factors \u2014 air emissions, water discharge, land use, noise, or other environmental impacts that could trigger permitting requirements or community opposition. If environmental risk flags were triggered, name them.\\n\\nParagraph 4 (if data supports): Place the environmental performance in competitive context. How does the lifecycle footprint compare to alternative technologies in the same application space? Does the environmental profile represent a competitive advantage (e.g., qualifying for green premiums or low-carbon fuel standards) or a liability?"
}`;
}

export function buildCall4Prompt(brief: DeviceDecisionBrief): string {
  const gates = evaluateToneGates(brief);
  return `Write the integration, strategic, and concluding sections of a Techno-Economic Deployment-Readiness Assessment Report.

${prepareBriefContext(brief)}
${toneGateBlock(gates)}
Return a JSON object with these keys. Each section is a synthesized analytical narrative:

{
  "system_integration": "3-4 paragraphs on system integration and operational requirements.\\n\\nParagraph 1: Assess the system integration requirements \u2014 what infrastructure, utilities, and upstream/downstream interfaces are needed to operate the technology in a real deployment? Identify grid interconnection, feedstock supply, product handling, thermal management, and control system requirements. If integration findings are available, cite specific constraints or compatibility issues.\\n\\nParagraph 2: Address operational complexity \u2014 what are the steady-state operating requirements, startup/shutdown procedures, and turndown capabilities? Is the technology suited for continuous operation, batch processing, or flexible dispatch? State the implications for operator training, maintenance scheduling, and system availability.\\n\\nParagraph 3: Assess balance-of-system requirements and site-specific considerations. What fraction of total installed cost is the balance of system? Are there site-specific constraints (climate, altitude, feedstock proximity) that materially affect performance or cost?\\n\\nParagraph 4 (if data supports): Evaluate the technology's compatibility with existing energy infrastructure. Can it retrofit into existing sites or does it require greenfield development? What is the expected commissioning timeline from final investment decision?",

  "strategic_value": "3-4 paragraphs on strategic value and differentiation.\\n\\nParagraph 1: Assess the novelty and strategic differentiation of the technology. What makes it distinct from existing approaches in the ${brief.domain || "energy"} domain? Is the differentiation based on cost, performance, feedstock flexibility, environmental profile, or a combination? State whether the differentiation is incremental or represents a structural shift in the technology landscape.\\n\\nParagraph 2: Evaluate the intellectual property and competitive moat. If the technology relies on proprietary processes, novel catalysts, or unique configurations, assess the defensibility and duration of the competitive advantage. If the approach is based on established science with engineering innovation, state the barrier to replication.\\n\\nParagraph 3: Assess strategic fit \u2014 where does this technology sit in the broader energy transition? Does it address a gap that incumbents cannot fill? Is it complementary to or competitive with technologies that are further along the deployment curve? What market conditions (carbon price, policy mandates, feedstock availability) would most accelerate its strategic value?\\n\\nParagraph 4 (if data supports): Provide a net strategic assessment \u2014 given the current evidence base, is the technology strategically differentiated enough to justify continued investment in the de-risking pathway? What would change the strategic calculus?",

  "recommendations": "4-5 paragraphs providing a structured recommendations section.\\n\\nParagraph 1: State the overall assessment conclusion. Summarize the deployment-readiness status in one or two sentences \u2014 what the assessment supports and what it does not yet support. This is not a recapitulation of the executive summary; it is a forward-looking statement about what actions the current evidence base justifies.\\n\\nParagraph 2: Present the priority de-risking actions, ordered by impact. For each action, state: (a) what it would validate or resolve, (b) why it is the highest-priority item at this stage, and (c) what resources or timeline it requires. These should be specific and actionable \u2014 not generic calls for 'further research.'\\n\\nParagraph 3: Identify the decision gates \u2014 what evidence milestones would advance the assessment to the next tier? State what 'success' looks like for each milestone and what the implication of failure would be for the investment thesis.\\n\\nParagraph 4: Address the timeline and sequencing \u2014 which de-risking actions can proceed in parallel, which are sequential, and what is the critical path? Provide a realistic timeline frame (months, not weeks) for the key milestones.\\n\\nParagraph 5: Close with a statement of conditional assessment \u2014 under what specific conditions would this technology advance to deployment readiness, and what are the key uncertainties that could prevent that outcome?",

  "evidence_quality_narrative": "3-4 paragraphs for the evidence quality appendix section.\\n\\nParagraph 1: Characterize the evidence base on which the assessment rests. What types of evidence were available \u2014 peer-reviewed literature, manufacturer specifications, pilot-scale operational data, commercial deployment data, independent testing, or simulation/modeling only? State the evidence strength level and what it implies for the confidence bounds of the assessment.\\n\\nParagraph 2: Identify the highest-impact evidence gaps \u2014 the specific parameters or measurements whose absence most constrains the assessment. For each gap, state: (a) the parameter, (b) why it matters for the deployment-readiness determination, (c) what the typical range is for comparable technologies, and (d) what type of evidence (field measurement, lab test, pilot campaign) would close the gap.\\n\\nParagraph 3: Address the calibration basis \u2014 if baseline comparisons to published reference devices or peer technologies were available, summarize the comparison. State which parameters tracked well against references and which diverged, and what the divergences imply for the assessment's reliability.\\n\\nParagraph 4 (if data supports): Note any evidence quality concerns \u2014 rationalization checks that were inconclusive, claims that could not be independently verified, or data that showed internal inconsistencies. State these as observations, not verdicts \u2014 the purpose is to give the reader full transparency on the strength of the assessment foundation."
}`;
}

// ── Main entry point ─────────────────────────────────────────

export async function generateReportNarratives(
  brief: DeviceDecisionBrief,
  projectContext: ProjectContext,
): Promise<ReportNarratives> {
  const b = brief as Record<string, any>;
  // ── Fallback narratives built directly from brief data ──
  // The PDF renders useful content even when the narrative model is unavailable.
  const strengths = (brief.key_strengths || []) as string[];
  const concerns = (brief.key_concerns || []) as string[];
  const actions = (brief.next_actions || []) as string[];
  const econSummary = (brief.economics_summary as string) || "";
  const mfgSummary = (brief.manufacturing_summary as string) || "";
  const regSummary = (brief.regulatory_summary as string) || "";
  const techName = brief.commercial_name || brief.device_id || projectContext.name || "technology";
  const domain = brief.domain || projectContext.domain || "energy";

  const fallbackExec = [
    brief.headline || `Techno-economic deployment-readiness assessment for ${techName}.`,
    `Assessment result: ${getTierLabel(brief)}.`,
    strengths.length > 0 ? `Key substantiated strengths: ${strengths.slice(0, 4).join(". ")}.` : "",
    concerns.length > 0 ? `Material concerns identified: ${concerns.slice(0, 4).join(". ")}.` : "",
    econSummary ? `Economic assessment: ${econSummary}` : "",
    actions.length > 0 ? `Priority actions: ${actions.slice(0, 3).join(". ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const fallbackTechProfile = [
    `Assessment of ${techName} in the ${domain} domain.`,
    brief.technology_family ? `Technology family: ${brief.technology_family}.` : "",
    b.system_description ? b.system_description : "",
    b.trl_assessment ? `Technology readiness: ${b.trl_assessment}.` : "",
    b.competitive_context ? b.competitive_context : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const fallbackTechnical = [
    strengths.length > 0 ? `Technical strengths identified in the assessment: ${strengths.join(". ")}.` : "",
    concerns.length > 0 ? `Technical concerns requiring resolution: ${concerns.join(". ")}.` : "",
    b.performance_claims?.length > 0 ? `Performance claims under evaluation: ${b.performance_claims.slice(0, 4).join(". ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n") || `Technical analysis for ${techName} is pending additional evidence.`;

  const fallbackThermo = b.exergy_summary_plain
    ? b.exergy_summary_plain
    : (b.second_law_efficiency != null
      ? `Second-law efficiency: ${(b.second_law_efficiency * 100).toFixed(1)}%.`
      : `Thermodynamic assessment for ${techName} requires additional exergy data.`);

  const fallbackEcon = econSummary
    ? [
      econSummary,
      brief.economics_range ? `Range: ${brief.economics_range}.` : "",
      brief.economics_sensitivity?.length > 0 ? `Key sensitivities: ${brief.economics_sensitivity.slice(0, 3).join("; ")}.` : "",
    ].filter(Boolean).join("\n\n")
    : `Economic assessment for ${techName} is pending cost data.`;

  const fallbackCommercial = b.founder_insights?.sellable_market
    ? [
      `Target market: ${b.founder_insights.sellable_market}.`,
      b.founder_insights.top_commercial_bottleneck ? `Primary commercial bottleneck: ${b.founder_insights.top_commercial_bottleneck}.` : "",
    ].filter(Boolean).join("\n\n")
    : `Commercial positioning for ${techName} requires additional market and spec compliance data.`;

  const fallbackMfg = mfgSummary
    ? mfgSummary
    : `Manufacturing and scale assessment for ${techName} is pending production data.`;

  const fallbackReg = regSummary
    ? regSummary
    : `Regulatory pathway assessment for ${techName} requires identification of applicable standards and permitting requirements.`;

  const fallbackSafety = concerns.length > 0
    ? `Safety-relevant concerns identified: ${concerns.filter(c => /safety|hazard|risk|thermal|toxic|pressure/i.test(c)).slice(0, 3).join(". ") || concerns.slice(0, 2).join(". ")}.`
    : `Safety assessment for ${techName} is pending hazard and failure mode analysis.`;

  const fallbackEnv = b.exergy_summary_plain
    ? `Environmental profile is informed by thermodynamic assessment: ${b.exergy_summary_plain}`
    : `Environmental impact assessment for ${techName} requires lifecycle emissions and resource efficiency data.`;

  const fallbackSysInteg = `System integration assessment for ${techName} in the ${domain} domain requires infrastructure compatibility and operational requirements data.`;

  const fallbackStrategic = b.founder_insights?.strongest_claim
    ? `Strongest substantiated claim: ${b.founder_insights.strongest_claim}. ${b.founder_insights.weakest_claim ? `Weakest claim requiring evidence: ${b.founder_insights.weakest_claim}.` : ""}`
    : `Strategic value assessment for ${techName} is pending competitive differentiation analysis.`;

  const fallbackRecs = actions.length > 0
    ? `Priority de-risking actions:\n${actions.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : `Recommendations for ${techName} are pending completion of the full assessment.`;

  const fallbackEvidence = [
    `Evidence basis: ${brief.evidence_strength || "unknown"}.`,
    b.evidence_level ? `Evidence level: ${b.evidence_level}.` : "",
    brief.literature_findings ? `Literature sources consulted: ${brief.literature_findings}.` : "",
    (brief.caveats || []).length > 0 ? `Assessment caveats: ${brief.caveats!.slice(0, 4).join(". ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const fallback: ReportNarratives = sanitizeNarrativesEvidencePosture({
    executive_summary: fallbackExec,
    technology_profile: fallbackTechProfile,
    technical_analysis: fallbackTechnical,
    thermodynamic_assessment: fallbackThermo,
    economic_assessment: fallbackEcon,
    commercial_positioning: fallbackCommercial,
    manufacturing_and_scale: fallbackMfg,
    regulatory_and_compliance: fallbackReg,
    safety_and_risk: fallbackSafety,
    environmental_impact: fallbackEnv,
    system_integration: fallbackSysInteg,
    strategic_value: fallbackStrategic,
    recommendations: fallbackRecs,
    evidence_quality_narrative: fallbackEvidence,
    module_narratives: {},
    module_deep_dives: {},
  }, brief);

  try {
    const [raw1, raw2, raw3, raw4] = await Promise.all([
      callNarrativeModel(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildCall1Prompt(brief, projectContext) },
        ],
        { maxTokens: 8000 },
      ),
      callNarrativeModel(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildCall2Prompt(brief) },
        ],
        { maxTokens: 12000 },
      ),
      callNarrativeModel(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildCall3Prompt(brief) },
        ],
        { maxTokens: 10000 },
      ),
      callNarrativeModel(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildCall4Prompt(brief) },
        ],
        { maxTokens: 8000 },
      ),
    ]);

    const p1 = parseJSON(raw1) || {};
    const p2 = parseJSON(raw2) || {};
    const p3 = parseJSON(raw3) || {};
    const p4 = parseJSON(raw4) || {};

    return sanitizeNarrativesEvidencePosture({
      executive_summary: (p1.executive_summary as string) || fallback.executive_summary,
      technology_profile: (p1.technology_profile as string) || fallback.technology_profile,
      technical_analysis: (p2.technical_analysis as string) || fallback.technical_analysis,
      thermodynamic_assessment: (p2.thermodynamic_assessment as string) || fallback.thermodynamic_assessment,
      economic_assessment: (p2.economic_assessment as string) || fallback.economic_assessment,
      commercial_positioning: (p2.commercial_positioning as string) || fallback.commercial_positioning,
      manufacturing_and_scale: (p3.manufacturing_and_scale as string) || fallback.manufacturing_and_scale,
      regulatory_and_compliance: (p3.regulatory_and_compliance as string) || fallback.regulatory_and_compliance,
      safety_and_risk: (p3.safety_and_risk as string) || fallback.safety_and_risk,
      environmental_impact: (p3.environmental_impact as string) || fallback.environmental_impact,
      system_integration: (p4.system_integration as string) || fallback.system_integration,
      strategic_value: (p4.strategic_value as string) || fallback.strategic_value,
      recommendations: (p4.recommendations as string) || fallback.recommendations,
      evidence_quality_narrative: (p4.evidence_quality_narrative as string) || fallback.evidence_quality_narrative,
      module_narratives: {},
      module_deep_dives: {},
    }, brief);
  } catch (err) {
    console.error("Narrative generation failed, using fallback narratives:", err);
    return fallback;
  }
}
