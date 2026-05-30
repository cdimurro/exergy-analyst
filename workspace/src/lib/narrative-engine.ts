/**
 * Narrative Engine — generates plain-English explanations from evaluation data.
 *
 * Turns structured module results (scores, verdicts, gates, value deltas,
 * economics data) into readable narratives that explain WHAT was found,
 * WHY it matters, and WHAT to do about it.
 *
 * No LLM calls — pure template-based generation from structured data.
 * Fast, deterministic, always available.
 */

// ── Module narrative generation ────────────────────────────

interface ModuleData {
  module_name?: string;
  verdict?: string;
  score_0_100?: number;
  confidence_0_1?: number;
  gate_results?: Array<{ gate_id: string; gate_name: string; passed: boolean; detail?: string }>;
  critical_assumptions?: string[];
  blocking_reasons?: string[];
  next_required_actions?: string[];
  details?: Record<string, unknown>;
}

export function generateModuleNarrative(moduleKey: string, mod: ModuleData): string {
  const verdict = mod.verdict || "blocked";
  const score = mod.score_0_100 || 0;
  const det = mod.details || {};

  switch (moduleKey) {
    case "economics": return generateEconomicsNarrative(mod);
    case "physics": return generatePhysicsNarrative(mod);
    case "performance": return generatePerformanceNarrative(mod);
    case "safety": return generateSafetyNarrative(mod);
    case "environmental": return generateEnvironmentalNarrative(mod);
    default: return generateGenericNarrative(moduleKey, mod);
  }
}

function generateEconomicsNarrative(mod: ModuleData): string {
  const det = mod.details || {};
  const mode = (det.provenance as Record<string, unknown>)?.economics_mode as string || "";
  const metric = det.economic_metric as string || "";
  const unit = det.metric_unit as string || "";
  const mk = metric.toLowerCase().replace(/ /g, "_");
  const base = det[`${mk}_base`] as number;
  const opt = det[`${mk}_optimistic`] as number;
  const pess = det[`${mk}_pessimistic`] as number;
  const inc = det.incumbent_comparison as Record<string, unknown> | null;

  const parts: string[] = [];

  if (mode === "blocked") {
    parts.push(`Economics could not be assessed — critical cost inputs are missing. ${(mod.blocking_reasons || []).join(" ")}`);
    if (mod.next_required_actions?.length) {
      parts.push(`To unlock economics: ${mod.next_required_actions.join("; ")}.`);
    }
    return parts.join(" ");
  }

  if (base != null) {
    parts.push(`The estimated ${metric} is $${base.toFixed(1)} ${unit}.`);
    if (opt != null && pess != null) {
      parts.push(`Under optimistic assumptions this drops to $${opt.toFixed(1)}, while pessimistic scenarios push it to $${pess.toFixed(1)} ${unit}.`);
    }
  }

  if (inc && inc.incumbent_value != null) {
    const delta = inc.delta_pct as number;
    const segment = inc.segment as string || "incumbent";
    if (delta > 0) {
      parts.push(`This is ${Math.abs(delta).toFixed(0)}% above the ${segment.replace(/_/g, " ")} benchmark ($${(inc.incumbent_value as number).toFixed(1)} ${unit}), indicating a significant cost gap that must be addressed for commercial viability.`);
    } else {
      parts.push(`This is ${Math.abs(delta).toFixed(0)}% below the ${segment.replace(/_/g, " ")} benchmark, suggesting strong cost competitiveness.`);
    }
  }

  if (mode === "estimated") {
    parts.push("Note: some cost inputs used industry defaults rather than technology-specific data. Providing actual CAPEX, OPEX, and feedstock costs would improve this estimate.");
  }

  // Sensitivity
  const tornado = det.sensitivity_tornado as Array<Record<string, unknown>>;
  if (tornado && tornado.length > 0) {
    const top = tornado.slice(0, 3).map(t => (t.param as string || "").replace(/_/g, " "));
    parts.push(`The most influential cost drivers are: ${top.join(", ")}. Targeted improvements in these areas would have the largest impact on economic viability.`);
  }

  return parts.join(" ") || "Economics assessment available — see charts below.";
}

function generatePhysicsNarrative(mod: ModuleData): string {
  const det = mod.details || {};
  const parts: string[] = [];
  const deltas = det.value_deltas as Array<Record<string, unknown>> || [];
  const baseline = det.baseline_name as string || "published benchmark";

  if (mod.verdict === "pass") {
    parts.push("Physics plausibility checks pass — all claimed performance values fall within established thermodynamic and engineering limits.");
  } else if (mod.verdict === "conditional") {
    parts.push("Physics assessment is directional — some plausibility checks could not be fully verified with available data.");
  }

  const above = deltas.filter(d => d.quality === "above");
  const below = deltas.filter(d => d.quality === "below");

  if (above.length > 0) {
    const items = above.map(d => {
      const param = (d.param as string).replace(/_/g, " ");
      const pct = Math.abs(d.delta_pct as number).toFixed(0);
      return `${param} (${pct}% above ${baseline.replace(/_/g, " ")})`;
    });
    parts.push(`Key strengths vs baseline: ${items.join("; ")}.`);
  }

  if (below.length > 0) {
    const items = below.map(d => {
      const param = (d.param as string).replace(/_/g, " ");
      const pct = Math.abs(d.delta_pct as number).toFixed(0);
      return `${param} (${pct}% below ${baseline.replace(/_/g, " ")})`;
    });
    parts.push(`Areas below baseline: ${items.join("; ")}. These may require further optimization or engineering attention.`);
  }

  if (det.solver_family) {
    parts.push(`Analysis used the ${(det.solver_family as string).replace(/_/g, " ")} physics solver for computed verification.`);
  }

  return parts.join(" ") || "Physics assessment complete.";
}

function generatePerformanceNarrative(mod: ModuleData): string {
  const det = mod.details || {};
  const parts: string[] = [];
  const deltas = det.value_deltas as Array<Record<string, unknown>> || [];

  if (mod.verdict === "pass") {
    parts.push("Performance metrics meet or exceed baseline expectations for this technology class.");
  } else if (mod.verdict === "conditional") {
    parts.push("Performance assessment is incomplete — additional durability and degradation data would strengthen this evaluation.");
  }

  if (deltas.length > 0) {
    const meaningful = deltas.filter(d => Math.abs(d.delta_pct as number) > 5);
    if (meaningful.length > 0) {
      parts.push("Notable performance differences vs published benchmarks:");
      for (const d of meaningful.slice(0, 4)) {
        const param = (d.param as string).replace(/_/g, " ");
        const quality = d.quality === "above" ? "exceeds" : "falls below";
        const pct = Math.abs(d.delta_pct as number).toFixed(0);
        parts.push(`• ${param}: ${quality} baseline by ${pct}%`);
      }
    }
  }

  return parts.join("\n") || "Performance assessment complete.";
}

function generateSafetyNarrative(mod: ModuleData): string {
  const parts: string[] = [];
  const gates = mod.gate_results || [];
  const passed = gates.filter(g => g.passed).length;
  const total = gates.length;

  if (mod.verdict === "pass") {
    parts.push(`Safety assessment passed — ${passed}/${total} safety gates cleared. No critical hazards identified within the evaluated scope.`);
  } else if (mod.verdict === "conditional") {
    parts.push(`Safety assessment is conditional — ${passed}/${total} gates passed. Additional hazard analysis may be needed.`);
  } else if (mod.verdict === "fail") {
    const failed = gates.filter(g => !g.passed);
    parts.push(`Safety concerns identified: ${failed.map(g => g.gate_name).join(", ")}. These must be addressed before deployment.`);
  }

  if (mod.critical_assumptions?.length) {
    parts.push(`Key safety assumptions: ${mod.critical_assumptions.join("; ")}.`);
  }

  return parts.join(" ") || "Safety assessment complete.";
}

function generateEnvironmentalNarrative(mod: ModuleData): string {
  const parts: string[] = [];

  if (mod.verdict === "pass") {
    parts.push("Environmental assessment indicates acceptable lifecycle impact within regulatory thresholds.");
  } else if (mod.verdict === "conditional") {
    parts.push("Environmental assessment is directional — full lifecycle analysis requires additional data on emissions, resource use, and end-of-life pathways.");
  }

  if (mod.blocking_reasons?.length) {
    parts.push(`Gaps: ${mod.blocking_reasons.join("; ")}.`);
  }

  return parts.join(" ") || "Environmental assessment complete.";
}

function generateGenericNarrative(moduleKey: string, mod: ModuleData): string {
  const displayNames: Record<string, string> = {
    regulatory: "Regulatory & Permitting",
    manufacturing: "Manufacturing & Supply Chain",
    scalability: "Scalability & Deployment",
    system_integration: "System Integration",
    novelty: "Novelty & Strategic Value",
  };
  const name = displayNames[moduleKey] || moduleKey.replace(/_/g, " ");
  const parts: string[] = [];

  if (mod.verdict === "pass") {
    parts.push(`${name}: Assessment indicates readiness within the evaluated scope.`);
  } else if (mod.verdict === "conditional") {
    parts.push(`${name}: Assessment is directional — additional evidence would strengthen the evaluation.`);
    if (mod.next_required_actions?.length) {
      parts.push(`To improve: ${mod.next_required_actions.slice(0, 2).join("; ")}.`);
    }
  } else if (mod.verdict === "fail") {
    parts.push(`${name}: Significant gaps identified.`);
    if (mod.blocking_reasons?.length) {
      parts.push(mod.blocking_reasons[0]);
    }
  } else {
    parts.push(`${name}: Could not be assessed with available data.`);
    if (mod.next_required_actions?.length) {
      parts.push(`Required: ${mod.next_required_actions[0]}.`);
    }
  }

  return parts.join(" ");
}

// ── Overall evaluation summary ─────────────────────────────

export function generateEvaluationSummary(evaluation: Record<string, unknown>): string {
  const score = evaluation.score as number || 0;
  const displayScore = score < 1 ? Math.round(score * 100) : Math.round(score);
  const modules = (evaluation.module_evaluations || {}) as Record<string, ModuleData>;
  const brief = (evaluation.brief || {}) as Record<string, unknown>;

  const parts: string[] = [];

  // Headline
  const tier = brief.readiness_tier as string || "early";
  const tierNarratives: Record<string, string> = {
    deploy: "This technology meets deployment criteria across all assessed dimensions.",
    strong: "Strong results across the board with only minor gaps remaining.",
    promising: "The core physics and economics are viable, with several areas needing deeper evidence.",
    early: "Some fundamentals check out, but significant questions remain at this stage.",
    insufficient: "Not enough data was provided for a definitive assessment. Findings are directional.",
    conditional: "This technology shows potential but requires more evidence.",
    caution: "Several critical issues were identified that need to be addressed.",
    not_ready: "Critical gaps prevent a positive assessment at this stage.",
  };
  parts.push(tierNarratives[tier] || tierNarratives.early);

  // Key findings
  const strengths = (brief.key_strengths as string[]) || [];
  const concerns = (brief.key_concerns as string[]) || [];

  if (strengths.length > 0) {
    parts.push(`\n**What works well:** ${strengths.slice(0, 3).join(". ")}.`);
  }

  if (concerns.length > 0) {
    parts.push(`\n**Key concerns:** ${concerns.slice(0, 3).join(". ")}.`);
  }

  // Economics headline
  const econSummary = brief.economics_summary as string;
  if (econSummary) {
    parts.push(`\n**Economics:** ${econSummary}`);
  }

  // Recommendations
  const actions = (brief.next_actions as string[]) || [];
  if (actions.length > 0) {
    parts.push("\n**Recommended next steps:**");
    actions.slice(0, 4).forEach((a, i) => {
      parts.push(`${i + 1}. ${a}`);
    });
  }

  return parts.join("\n");
}

// ── Recommendations from evaluation data ───────────────────

export function generateRecommendations(evaluation: Record<string, unknown>): string[] {
  const modules = (evaluation.module_evaluations || {}) as Record<string, ModuleData>;
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const recs: string[] = [];

  // From brief next_actions
  const actions = (brief.next_actions as string[]) || [];
  recs.push(...actions);

  // From module blocking reasons and next required actions
  for (const [key, mod] of Object.entries(modules)) {
    if (mod.verdict === "fail" || mod.verdict === "blocked") {
      for (const action of (mod.next_required_actions || []).slice(0, 1)) {
        if (!recs.includes(action)) recs.push(action);
      }
    }
  }

  // Economics-specific
  const econ = modules.economics?.details || {};
  const mode = (econ.provenance as Record<string, unknown>)?.economics_mode as string;
  if (mode === "estimated") {
    recs.push("Provide actual CAPEX, OPEX, and feedstock cost data to replace default assumptions in the economics model.");
  }

  return recs.slice(0, 6);
}
