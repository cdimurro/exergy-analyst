/**
 * Universal Visualization Policy — decides what to show and how.
 *
 * Classifies evaluation result data into chartable patterns and produces
 * a deterministic rendering plan. Module-agnostic and domain-agnostic.
 *
 * Design principles:
 * - Result shape drives chart selection, not domain name
 * - Confidence gates prevent premature visualization
 * - Decision value determines display priority
 * - Deferred/blocked/advisory states are visually honest
 * - No domain-specific logic — works for any energy domain
 */

// ── Visualization patterns ─────────────────────────────────

/** The chartable patterns this system recognizes. */
export type VizPattern =
  | "scalar_hero"            // Single key metric with mode badge
  | "scenario_triplet"       // base / optimistic / pessimistic range
  | "comparison_bar"         // Candidate vs incumbent
  | "sensitivity_tornado"    // Top drivers ranked by swing
  | "module_breakdown"       // 10-module verdict/confidence radar
  | "capex_breakdown"        // Cost component bar chart
  | "stacked_cost"           // System LCOE-style stacked breakdown
  | "literature_range"       // Advisory benchmark envelope
  | "output_allocation"      // Multi-output scored/advisory summary
  | "baseline_comparison"    // Multi-baseline delta table
  | "metric_table"           // Key-value metric list
  | "advisory_note"          // Non-chartable advisory text
  | "empty_state";           // No data / blocked

/** Confidence thresholds for display gating. */
export const CONFIDENCE_GATES = {
  /** Show charts with full styling */
  full: 0.5,
  /** Show charts with reduced prominence + caveat */
  reduced: 0.2,
  /** Below this: show only text summary, no charts */
  minimum: 0.0,
} as const;

// ── Display priority tiers ─────────────────────────────────

/** Priority tiers — lower number = shown first. */
export type DisplayTier = "hero" | "primary" | "secondary" | "detail" | "hidden";

const TIER_ORDER: Record<DisplayTier, number> = {
  hero: 0,
  primary: 1,
  secondary: 2,
  detail: 3,
  hidden: 4,
};

// ── Visualization section ──────────────────────────────────

export interface VizSection {
  /** Unique section ID for keying. */
  id: string;
  /** Human-readable section title. */
  title: string;
  /** Chart pattern to render. */
  pattern: VizPattern;
  /** Display priority tier. */
  tier: DisplayTier;
  /** Priority within tier (lower = first). */
  priority: number;
  /** The data payload for the chart renderer. */
  data: Record<string, unknown>;
  /** Optional confidence level — drives visual gating. */
  confidence?: number;
  /** If true, show a low-confidence caveat. */
  showCaveat?: boolean;
  /** Optional subtitle/note. */
  subtitle?: string;
}

// ── Result data shape detection ────────────────────────────

/**
 * Analyze a raw evaluation result and produce a rendering plan.
 *
 * This is the main entry point. Given any evaluation result dict,
 * it detects what data is present and builds an ordered list of
 * VizSections to render.
 *
 * @param evaluation - The full evaluation result (module_evaluations, score, etc.)
 * @param options - Optional overrides (domain hint, compact mode, etc.)
 * @returns Ordered list of VizSections, sorted by tier then priority.
 */
export function buildVisualizationPlan(
  evaluation: Record<string, unknown>,
  options: { compact?: boolean; maxSections?: number } = {},
): VizSection[] {
  const sections: VizSection[] = [];
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const score = evaluation.score as number | undefined;

  // ── 1. Score hero ────────────────────────────────────────
  if (score != null) {
    sections.push({
      id: "score_hero",
      title: "Composite Score",
      pattern: "scalar_hero",
      tier: "hero",
      priority: 0,
      data: {
        value: Math.round(score * 100) / 100,
        label: "Deployment Readiness",
        format: "score",
      },
    });
  }

  // ── 2. Module breakdown ──────────────────────────────────
  const moduleSummaries = extractModuleSummaries(modules);
  if (moduleSummaries.length > 0) {
    sections.push({
      id: "module_breakdown",
      title: "Module Assessment",
      pattern: "module_breakdown",
      tier: "primary",
      priority: 10,
      data: { modules: moduleSummaries },
    });
  }

  // ── 3. Economics sections ────────────────────────────────
  const econDetails = (modules.economics?.details || {}) as Record<string, unknown>;
  sections.push(...extractEconomicsSections(econDetails));

  // ── 4. WtE / domain enrichment ──────────────────────────
  sections.push(...extractEnrichmentSections(econDetails));

  // ── 5. Environmental highlights ──────────────────────────
  const envDetails = (modules.environmental?.details || {}) as Record<string, unknown>;
  sections.push(...extractEnvironmentalSections(envDetails, modules.environmental as Record<string, unknown>));

  // ── 6. Physics summary ──────────────────────────────────
  const physicsDetails = (modules.physics?.details || {}) as Record<string, unknown>;
  sections.push(...extractPhysicsSections(physicsDetails, modules.physics as Record<string, unknown>));

  // ── Sort by tier, then priority ──────────────────────────
  sections.sort((a, b) => {
    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return a.priority - b.priority;
  });

  // ── Apply limits ─────────────────────────────────────────
  const maxSections = options.compact ? 4 : (options.maxSections || 12);
  const visible = sections.filter(s => s.tier !== "hidden");
  return visible.slice(0, maxSections);
}

// ── Economics extraction ───────────────────────────────────

function extractEconomicsSections(det: Record<string, unknown>): VizSection[] {
  const sections: VizSection[] = [];
  const mode = (det.provenance as Record<string, unknown>)?.economics_mode as string || "";
  const metric = det.economic_metric as string || "";
  const unit = det.metric_unit as string || "";
  const mk = metric.toLowerCase().replace(/ /g, "_");

  // Advisory / benchmark envelope
  if (det.advisory_only) {
    sections.push({
      id: "econ_literature",
      title: `${metric || "Economics"} — Literature Range`,
      pattern: "literature_range",
      tier: "primary",
      priority: 5,
      data: {
        min: det.literature_range_min,
        max: det.literature_range_max,
        unit: det.literature_range_unit || unit,
        sources: det.literature_sources,
      },
      subtitle: "Advisory only — no validated TEA model",
    });
    return sections;
  }

  // Blocked
  if (mode === "blocked" || (!det[`${mk}_base`] && !det.advisory_only)) {
    const missing = (det.provenance as Record<string, unknown>)?.missing_critical_inputs as string[] || [];
    if (missing.length > 0 || mode === "blocked") {
      sections.push({
        id: "econ_blocked",
        title: `${metric || "Economics"} — Blocked`,
        pattern: "empty_state",
        tier: "primary",
        priority: 5,
        data: {
          message: `Missing critical inputs: ${missing.join(", ") || "insufficient data"}`,
        },
      });
    }
    return sections;
  }

  // Deferred
  if (det.economics_deferred) {
    const family = det.deferred_suggested_family as string || "";
    sections.push({
      id: "econ_deferred",
      title: "Economics — Deferred",
      pattern: "advisory_note",
      tier: "secondary",
      priority: 20,
      data: {
        text: det.deferred_diagnostic as string || `Would use ${family.toUpperCase()} model when validated cost data is available`,
        family,
      },
    });
    return sections;
  }

  // Computed / estimated — primary metric
  const base = det[`${mk}_base`] as number | undefined;
  if (base != null) {
    sections.push({
      id: "econ_hero",
      title: `${metric}`,
      pattern: "scalar_hero",
      tier: "hero",
      priority: 1,
      data: {
        value: base,
        label: metric,
        unit,
        mode,
        format: "currency",
      },
      showCaveat: mode === "estimated",
      subtitle: mode === "estimated" ? "Some inputs are defaults" : undefined,
    });
  }

  // Scenario triplet
  const opt = det[`${mk}_optimistic`] as number | undefined;
  const pess = det[`${mk}_pessimistic`] as number | undefined;
  if (base != null && opt != null && pess != null) {
    sections.push({
      id: "econ_scenario",
      title: `${metric} Scenario Range`,
      pattern: "scenario_triplet",
      tier: "primary",
      priority: 6,
      data: { optimistic: opt, base, pessimistic: pess, unit, label: metric },
    });
  }

  // Incumbent comparison
  const inc = det.incumbent_comparison as Record<string, unknown> | null;
  if (inc && inc.incumbent_value != null) {
    sections.push({
      id: "econ_comparison",
      title: "vs Incumbent",
      pattern: "comparison_bar",
      tier: "primary",
      priority: 7,
      data: {
        candidate: inc.candidate_value,
        incumbent: inc.incumbent_value,
        candidateLabel: "Candidate",
        incumbentLabel: inc.segment || "Incumbent",
        unit,
        delta_pct: inc.delta_pct,
        is_competitive: inc.is_competitive,
      },
    });
  }

  // Sensitivity tornado
  const tornado = det.sensitivity_tornado as Array<Record<string, unknown>> | undefined;
  if (tornado && tornado.length > 0) {
    sections.push({
      id: "econ_sensitivity",
      title: "Sensitivity — Top Drivers",
      pattern: "sensitivity_tornado",
      tier: "secondary",
      priority: 15,
      data: {
        items: tornado.slice(0, 6).map(t => ({
          label: (t.param as string || "").replace(/_/g, " "),
          value: t.swing as number,
          color: undefined,
        })),
        unit,
      },
    });
  }

  // CAPEX breakdown
  const capex = det.capex_breakdown as Record<string, number> | undefined;
  if (capex && Object.keys(capex).length > 0) {
    sections.push({
      id: "econ_capex",
      title: "CAPEX Breakdown",
      pattern: "capex_breakdown",
      tier: "detail",
      priority: 25,
      data: {
        items: Object.entries(capex).map(([k, v]) => ({
          label: k.replace(/_/g, " "),
          value: v,
        })),
        unit: "$/kW",
      },
    });
  }

  // System LCOE
  if (det.system_lcoe_base != null && det.system_adjustment) {
    const adj = det.system_adjustment as Record<string, unknown>;
    sections.push({
      id: "econ_system_lcoe",
      title: "System-Adjusted LCOE",
      pattern: "stacked_cost",
      tier: "primary",
      priority: 8,
      data: {
        standaloneLCOE: base,
        curtailmentAdder: (base || 0) * ((adj.curtailment_rate as number) || 0),
        integrationCost: (adj.integration_cost_per_mwh as number) || 0,
        unit,
      },
    });
  }

  // Assumptions table
  const assumptions = det.assumptions as Record<string, unknown> | undefined;
  if (assumptions) {
    sections.push({
      id: "econ_assumptions",
      title: "Key Assumptions",
      pattern: "metric_table",
      tier: "detail",
      priority: 30,
      data: {
        rows: Object.entries(assumptions).map(([k, v]) => ({
          label: k.replace(/_/g, " "),
          value: String(v),
        })),
      },
    });
  }

  return sections;
}

// ── Domain enrichment extraction ──────────────────────────

function extractEnrichmentSections(det: Record<string, unknown>): VizSection[] {
  const sections: VizSection[] = [];

  // WtE output allocation
  const alloc = det.wte_output_allocation as Record<string, unknown> | undefined;
  if (alloc && (alloc.outputs as unknown[])?.length > 0) {
    sections.push({
      id: "wte_outputs",
      title: "Output Allocation",
      pattern: "output_allocation",
      tier: "primary",
      priority: 9,
      data: alloc,
      subtitle: alloc.multi_output ? "Multi-output system" : undefined,
    });
  }

  // WtE baseline comparisons
  const baselines = det.wte_baseline_comparisons as unknown[] | undefined;
  if (baselines && baselines.length > 0) {
    sections.push({
      id: "wte_baselines",
      title: "Baseline Comparisons",
      pattern: "baseline_comparison",
      tier: "secondary",
      priority: 16,
      data: { comparisons: baselines },
    });
  }

  // WtE energy balance
  const eb = det.wte_energy_balance as Record<string, unknown> | undefined;
  if (eb && eb.status && eb.status !== "ok") {
    sections.push({
      id: "wte_energy_balance",
      title: "Energy Balance Check",
      pattern: "advisory_note",
      tier: "secondary",
      priority: 18,
      data: {
        text: eb.note as string || "Energy balance inconsistency detected",
        status: eb.status,
      },
    });
  }

  return sections;
}

// ── Environmental extraction ──────────────────────────────

function extractEnvironmentalSections(
  det: Record<string, unknown>,
  mod: Record<string, unknown> | undefined,
): VizSection[] {
  const sections: VizSection[] = [];
  const verdict = mod?.verdict as string;
  if (!verdict || verdict === "blocked") return sections;

  // Surface environmental verdict as a summary metric
  const confidence = mod?.confidence_0_1 as number || 0;
  if (confidence > 0.1) {
    const keyDetail = (mod?.details as Record<string, unknown>)?.key_detail as string || "";
    sections.push({
      id: "env_summary",
      title: "Environmental Assessment",
      pattern: "advisory_note",
      tier: "secondary",
      priority: 22,
      data: {
        text: keyDetail || `Verdict: ${verdict}`,
        verdict,
      },
      confidence,
      showCaveat: confidence < CONFIDENCE_GATES.full,
    });
  }

  return sections;
}

// ── Physics extraction ─────────────────────────────────────

function extractPhysicsSections(
  det: Record<string, unknown>,
  mod: Record<string, unknown> | undefined,
): VizSection[] {
  const sections: VizSection[] = [];
  const verdict = mod?.verdict as string;
  if (!verdict || verdict === "blocked") return sections;

  // Value deltas (above/below baseline)
  const deltas = det.value_deltas as Array<Record<string, unknown>> | undefined;
  if (deltas && deltas.length > 0) {
    const meaningful = deltas.filter(d => Math.abs((d.delta_pct as number) || 0) > 5);
    if (meaningful.length > 0) {
      sections.push({
        id: "physics_deltas",
        title: "Performance vs Baseline",
        pattern: "baseline_comparison",
        tier: "primary",
        priority: 12,
        data: {
          comparisons: [{
            label: det.baseline_name as string || "Baseline",
            deltas: meaningful.map(d => ({
              metric: (d.param as string || "").replace(/_/g, " "),
              candidate: d.user,
              baseline_value: d.baseline,
              delta: d.delta_pct,
              unit: d.unit || "",
              favorable: (d.quality as string) === "above",
            })),
          }],
        },
      });
    }
  }

  return sections;
}

// ── Module summary extraction ──────────────────────────────

interface ModuleSummary {
  name: string;
  verdict: string;
  confidence: number;
  score: number;
  isVeto: boolean;
}

const VETO_MODULES = new Set(["physics", "safety", "environmental", "regulatory_readiness"]);

const MODULE_DISPLAY: Record<string, string> = {
  physics: "Physics",
  performance: "Performance",
  economics: "Economics",
  safety: "Safety",
  environmental: "Environmental",
  regulatory_readiness: "Regulatory",
  manufacturing_readiness: "Manufacturing",
  scalability_readiness: "Scalability",
  system_integration: "Integration",
  novelty: "Strategic Value",
};

function extractModuleSummaries(modules: Record<string, Record<string, unknown>>): ModuleSummary[] {
  return Object.entries(modules)
    .filter(([_, mod]) => mod && typeof mod === "object" && mod.verdict)
    .map(([key, mod]) => ({
      name: MODULE_DISPLAY[key] || key,
      verdict: mod.verdict as string,
      confidence: (mod.confidence_0_1 as number) || 0,
      score: (mod.score_0_100 as number) || 0,
      isVeto: VETO_MODULES.has(key),
    }));
}

// ── Public utilities ───────────────────────────────────────

/** Check if a result has enough data for meaningful visualization. */
export function hasVisualizableData(evaluation: Record<string, unknown>): boolean {
  const plan = buildVisualizationPlan(evaluation, { compact: true });
  return plan.length > 0;
}

/** Get the dominant visualization pattern for a result. */
export function getDominantPattern(evaluation: Record<string, unknown>): VizPattern {
  const plan = buildVisualizationPlan(evaluation, { compact: true });
  if (plan.length === 0) return "empty_state";
  return plan[0].pattern;
}
