// @ts-nocheck
"use client";

/**
 * AssessmentCanvas — narrative-led technology assessment canvas.
 *
 * Answers the five questions that actually matter to a founder or
 * investor, each with a scientifically credible section title,
 * synthesized narrative, and dynamic charts showing the real numbers:
 *
 *   1. Technical Viability        — physics, yields, thermodynamic quality
 *   2. Economic Case              — unit cost, margins, sensitivity
 *   3. Scale & Manufacturing      — pilot-to-commercial pathway
 *   4. Deployment Risks           — regulatory, safety, environmental
 *   5. De-Risking Roadmap         — prioritized validation milestones
 *
 * Internal scorecard detail (gate pass/fail counts, IRIS tiers,
 * confidence percentages, 5-axis verdict labels) lives in the
 * "Technical Audit Detail" section at the bottom, defaulted closed.
 * The JSON export and PDF appendix preserve the full audit trail.
 */

import { useMemo, useState } from "react";
import { CollapsibleSection } from "./CollapsibleSection";
import { ScoreGauge } from "@/components/brief/ScoreGauge";
import {
  ChartCard,
  HorizontalBarChart,
  ScenarioRangeChart,
  ComparisonBarChart,
} from "@/components/charts/ChartPrimitives";
import { BRAND, SEMANTIC, verdictColor } from "@/lib/chart-theme";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell,
  ComposedChart, Line,
  ScatterChart, Scatter, ZAxis,
} from "recharts";

// Display guards for values the backend claims are percentages or
// non-negative quantities. Upstream sources (LLM extraction, heuristic
// models) occasionally emit out-of-range numbers; we'd rather show
// nothing or the boundary than render "150% target utilization" or a
// negative capex. Returns null when the input is unusable.
function clampPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

export function firstPassYieldNarrativeTone(firstPassYieldPct: number): string {
  if (firstPassYieldPct >= 85) return "a modeled, validation-pending";
  if (firstPassYieldPct >= 60) return "a developing";
  return "an early-stage";
}

export function firstPassYieldRowNote(firstPassYieldPct: number): string {
  if (firstPassYieldPct >= 85) {
    return "Modeled estimate — requires pilot validation before production readiness";
  }
  if (firstPassYieldPct >= 60) return "Developing — yield ramp is load-bearing";
  return "Early-stage — expect significant learning";
}

function nonNegativeOrNull(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  return v;
}

// ── Props ────────────────────────────────────────────────────

interface AssessmentCanvasProps {
  evaluation: Record<string, unknown>;
  projectId?: string;
  onExportPdf?: () => void;
  /** Title of the source artifact this canvas is rendering. Shown as an
   *  eyebrow so the user can tell which of several analysis cards the
   *  canvas corresponds to when multiple View Details buttons exist. */
  sourceTitle?: string;
}

// ── Humanization helpers ─────────────────────────────────────

function humanizeParam(raw: string): string {
  const LABELS: Record<string, string> = {
    rated_power_kw: "Rated Power",
    fuel_energy_density_mj_per_kg: "Fuel Energy Density",
    feedstock_throughput_tonnes_per_day: "Feedstock Throughput",
    net_electrical_efficiency: "Net Electrical Efficiency",
    heat_recovery_efficiency: "Heat Recovery Efficiency",
    overall_energy_recovery_pct: "Overall Energy Recovery",
    emissions_gco2_per_ton: "CO2 Emissions",
    gate_fee_per_ton: "Gate Fee",
    ash_residue_pct: "Ash Residue",
    fuel_oil_yield_pct: "Fuel Oil Yield",
    gas_yield_pct: "Gas Yield",
    biochar_yield_pct: "Biochar Yield",
    carbon_conversion_pct: "Carbon Conversion",
    process_energy_efficiency_pct: "Process Energy Efficiency",
    contaminant_level_ppm: "Contaminant Level",
    feedstock_flexibility_score: "Feedstock Flexibility",
    total_product_value_per_ton: "Total Product Value",
    conversion_efficiency: "Conversion Efficiency",
    operating_temperature_c: "Operating Temperature",
    operating_pressure_bar: "Operating Pressure",
  };
  if (LABELS[raw]) return LABELS[raw];
  return raw
    .replace(/_/g, " ")
    .replace(/\b(pct|kw|mj|per kg|per ton|gco2|mah|wh|mw|ppm)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function paragraphs(text: string | undefined, className = "text-[15px] text-[var(--text-secondary)] leading-relaxed") {
  if (!text) return null;
  const parts = String(text).split(/\n\n+/).filter(Boolean);
  return (
    <div className="space-y-3">
      {parts.map((p, i) => (
        <p key={i} className={className}>{p.trim()}</p>
      ))}
    </div>
  );
}

// ── Synthesis helpers — cross-module narratives ──────────────

/**
 * Build a synthesized narrative for "Technical Viability" from physics,
 * performance, and thermodynamic quality data. Deterministic prose
 * generation from the structured data already in the evaluation.
 */
function synthesizeTechnical(evaluation: Record<string, unknown>): string {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const phys = modules.physics || {};
  const perf = modules.performance || {};
  const physDet = (phys.details || {}) as Record<string, unknown>;
  const perfDet = (perf.details || {}) as Record<string, unknown>;

  const parts: string[] = [];
  const eta2 = brief.second_law_efficiency as number | undefined;
  const etaCeiling = brief.exergy_ceiling as number | undefined;
  const massClosure = physDet.mass_closure_pct as number | undefined;
  const oil = perfDet.fuel_oil_yield_pct as number | undefined;
  const gas = perfDet.gas_yield_pct as number | undefined;
  const char = perfDet.biochar_yield_pct as number | undefined;

  // Opening paragraph — the physics signal
  const bits: string[] = [];
  if (oil != null) {
    bits.push(`primary fuel yield of ${oil.toFixed(1)}%`);
  }
  if (eta2 != null) {
    const pct = (eta2 * 100).toFixed(1);
    const ceilingNote = etaCeiling ? ` against a domain ceiling of ${(etaCeiling * 100).toFixed(0)}%` : "";
    bits.push(`second-law (exergy) efficiency of ${pct}%${ceilingNote}`);
  }
  if (bits.length > 0) {
    parts.push(`The conversion process shows ${bits.join(" and ")}. ${oil != null ? "The underlying chemistry is well-characterized — what needs closing is the path from modeled performance to measured, sustained output." : "These figures come from platform modeling calibrated to published references rather than a sustained pilot run."}`);
  }

  // Second paragraph — the specific physics concern
  const concerns: string[] = [];
  if (massClosure != null && Math.abs(massClosure - 100) > 5) {
    concerns.push(`mass balance closes at ${massClosure.toFixed(1)}% against a theoretical 100% — the ${Math.abs(massClosure - 100).toFixed(0)}% discrepancy needs to be reconciled with physical pilot measurement before yields can support finance-facing conclusions rather than theoretical targets`);
  }
  const physConcern = phys.key_detail as string;
  if (physConcern && !concerns.some((c) => c.includes("mass balance"))) {
    concerns.push(physConcern.toLowerCase());
  }
  if (concerns.length > 0) {
    parts.push(`The specific concern to resolve: ${concerns[0]}.`);
  }

  // Third paragraph — thermodynamic quality framing
  if (eta2 != null && etaCeiling != null) {
    const headroom = (etaCeiling - eta2) * 100;
    if (headroom > 10) {
      parts.push(`From a thermodynamic quality perspective, there is meaningful headroom (${headroom.toFixed(0)} percentage points) between current operation and the theoretical domain ceiling. This is where process optimization — reducing reaction irreversibility or better integrating waste heat — can move the cost curve materially.`);
    } else if (headroom > 0) {
      parts.push(`From a thermodynamic quality perspective, the process is operating near the ceiling for its technology class (${headroom.toFixed(0)} pp headroom). Large efficiency gains from thermodynamic optimization alone are unlikely — the next lever is capacity utilization and integration.`);
    }
  }

  return parts.join("\n\n");
}

function synthesizeEconomic(evaluation: Record<string, unknown>): string {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const econ = modules.economics || {};
  const det = (econ.details || {}) as Record<string, unknown>;

  const parts: string[] = [];

  const lcof = brief.lcof_nominal_per_gge as number | undefined;
  const lcofAdj = brief.lcof_exergy_adjusted_per_gge as number | undefined;
  const divergence = brief.lcof_divergence_pct as number | undefined;
  const metric = det.economic_metric as string || "";
  const unit = det.metric_unit as string || "";
  const incumbent = det.incumbent_comparison as Record<string, unknown> | null;

  const headline = brief.economics_summary as string;
  if (headline) {
    parts.push(headline);
  } else if (lcof != null) {
    let line = `Levelized cost of fuel comes in at $${lcof.toFixed(2)}/GGE`;
    if (incumbent && incumbent.incumbent_value) {
      const inc = incumbent.incumbent_value as number;
      const ratio = lcof / inc;
      line += `, which is ${ratio.toFixed(2)}x the ${incumbent.segment || "incumbent"} reference of $${inc.toFixed(2)}/GGE`;
    }
    parts.push(line + ".");
  }

  // Divergence flag
  if (lcofAdj != null && divergence != null && Math.abs(divergence) >= 10) {
    parts.push(`Adjusted for thermodynamic quality, the cost rises to $${lcofAdj.toFixed(2)}/GGE (a ${divergence > 0 ? "+" : ""}${divergence.toFixed(0)}% divergence from the nominal). This reflects that the output fuel carries lower exergy density than the nominal-cost accounting assumes — a signal worth flagging in negotiations where product spec is monetized.`);
  }

  // Sensitivity — top drivers
  const tornado = det.sensitivity_tornado as Array<Record<string, unknown>> | undefined;
  if (tornado && tornado.length > 0) {
    const topDrivers = tornado.slice(0, 3).map((t) => humanizeParam(t.param as string || "")).filter(Boolean);
    if (topDrivers.length > 0) {
      parts.push(`The three biggest levers on unit cost are ${topDrivers.join(", ")}. Any path to finance-facing economics runs through tightening the uncertainty on these parameters — typically via site-specific feedstock contracts, utility pricing, and operating-hour evidence.`);
    }
  } else if (brief.economics_sensitivity && (brief.economics_sensitivity as unknown[]).length > 0) {
    const sens = brief.economics_sensitivity as string[];
    parts.push(`Key economic sensitivities: ${sens.slice(0, 3).join("; ")}.`);
  }

  return parts.join("\n\n");
}

function synthesizeScale(evaluation: Record<string, unknown>): string {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const scale = modules.scalability || {};
  const mfg = modules.manufacturing || {};
  const sysInt = modules.system_integration || {};
  const scaleDet = (scale.details || {}) as Record<string, unknown>;
  const mfgDet = (mfg.details || {}) as Record<string, unknown>;
  const sysDet = (sysInt.details || {}) as Record<string, unknown>;
  const fi = (brief.founder_insights || {}) as Record<string, unknown>;
  const parts: string[] = [];

  // Paragraph 1 — the framing: where is this on the TRL ladder and what's the
  // shape of the pilot-to-commercial gap?
  const trl = brief.trl_assessment as string | undefined;
  const trlMatch = trl?.match(/TRL\s*(\d)/i);
  const trlLevel = trlMatch ? parseInt(trlMatch[1], 10) : null;
  const bottleneck = fi.top_commercial_bottleneck as string;
  if (trlLevel != null) {
    const stage = trlLevel <= 3 ? "early-research" : trlLevel <= 5 ? "lab-validated" : trlLevel <= 7 ? "pilot-validated" : "demonstrated at scale";
    const nextStage = trlLevel <= 3 ? "benchtop-to-pilot" : trlLevel <= 5 ? "lab-to-pilot" : trlLevel <= 7 ? "pilot-to-commercial" : "incremental commercial optimization";
    parts.push(`This technology sits at TRL ${trlLevel} — ${stage}. The scale-up question is therefore framed as a ${nextStage} transition, which has historically been where the majority of deep-tech capital and calendar time go. The evidence below indicates which specific steps that transition is gated on for this device.`);
  }
  if (bottleneck) {
    parts.push(`The single most commercially-constraining gap identified is: ${bottleneck}`);
  }

  // Paragraph 2 — scalability signals
  const scaleBits: string[] = [];
  const capex = nonNegativeOrNull(scaleDet.capex_per_unit_capacity as number | undefined);
  const capexUnit = scaleDet.capex_unit as string | undefined;
  if (capex != null) scaleBits.push(`capital intensity of ${capex.toLocaleString()} ${capexUnit || "$/unit capacity"}`);
  const throughput = nonNegativeOrNull(scaleDet.commercial_throughput as number | undefined);
  const throughputUnit = scaleDet.commercial_throughput_unit as string | undefined;
  if (throughput != null) scaleBits.push(`target commercial throughput around ${throughput.toLocaleString()} ${throughputUnit || "units"}`);
  const site = nonNegativeOrNull(scaleDet.site_footprint_m2 as number | undefined);
  if (site != null) scaleBits.push(`site footprint of roughly ${site.toLocaleString()} m²`);
  const utilization = clampPct(scaleDet.target_utilization_pct as number | undefined);
  if (utilization != null) scaleBits.push(`${utilization}% target utilization`);
  if (scaleBits.length > 0) {
    parts.push(`Scalability economics are anchored to ${scaleBits.join(", ")}. Each of these is a lever that either rewards or punishes the deployment case — small shifts compound across a commercial fleet.`);
  }
  const scaleDetTxt = scale.key_detail as string | undefined;
  if (scaleDetTxt && !parts.some((p) => p.includes(scaleDetTxt))) parts.push(scaleDetTxt);

  // Paragraph 3 — manufacturing readiness: BOM, sourcing, yield, learning curve
  const bom = mfgDet.bom as Record<string, unknown> | undefined;
  const bomItems = (bom?.items || []) as Array<Record<string, unknown>>;
  const yieldModel = mfgDet.yield_model as Record<string, unknown> | undefined;
  const firstPassYield = clampPct(yieldModel?.estimated_first_pass_yield_pct as number | undefined);
  const learning = mfgDet.learning_mechanism as string | undefined;
  const mfgBits: string[] = [];
  if (bomItems.length > 0) {
    const nCrit = bomItems.filter((i) => i.critical).length;
    const nSingle = bomItems.filter((i) => i.sourcing_status === "single_source").length;
    mfgBits.push(`a bill of materials of ${bomItems.length} parts${nCrit ? `, ${nCrit} flagged critical` : ""}${nSingle ? ` and ${nSingle} on single-source supply` : ""}`);
  }
  if (firstPassYield != null) {
    const tone = firstPassYieldNarrativeTone(firstPassYield);
    mfgBits.push(`${tone} first-pass yield of ${firstPassYield.toFixed(0)}%`);
  }
  if (mfgBits.length > 0) {
    parts.push(`Manufacturing readiness shows ${mfgBits.join(", and ")}.${learning && learning.length > 20 ? ` ${learning}` : ""}`);
  } else {
    const mfgSum = brief.manufacturing_summary as string | undefined;
    if (mfgSum) parts.push(mfgSum);
  }

  // Paragraph 4 — system integration, where this technology has to plug in
  const siteRequirements = sysDet.site_requirements as string | string[] | undefined;
  const integrationFit = sysDet.integration_fit as string | undefined;
  const gridImpact = sysDet.grid_impact as string | undefined;
  if (integrationFit || siteRequirements || gridImpact) {
    const sentences: string[] = [];
    if (integrationFit) sentences.push(integrationFit);
    if (gridImpact) sentences.push(gridImpact);
    if (Array.isArray(siteRequirements) && siteRequirements.length > 0) {
      sentences.push(`Site-side requirements to stand this up include ${siteRequirements.slice(0, 4).join(", ")}.`);
    } else if (typeof siteRequirements === "string" && siteRequirements.length > 0) {
      sentences.push(siteRequirements);
    }
    if (sentences.length > 0) parts.push(sentences.join(" "));
  }

  return parts.join("\n\n");
}

function synthesizeRegulatory(evaluation: Record<string, unknown>): string {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const reg = modules.regulatory || {};
  const regDet = (reg.details || {}) as Record<string, unknown>;
  const parts: string[] = [];

  const regSum = brief.regulatory_summary as string | undefined;
  if (regSum) parts.push(regSum);

  // Specific regulatory path
  const pathway = regDet.approval_pathway as string | undefined;
  const jurisdictions = regDet.jurisdictions as string[] | undefined;
  const timeline = regDet.estimated_approval_months as number | undefined;
  const bits: string[] = [];
  if (pathway) bits.push(`the governing approval route appears to be ${pathway}`);
  if (jurisdictions && jurisdictions.length > 0) bits.push(`with primary jurisdictions in ${jurisdictions.slice(0, 3).join(", ")}`);
  if (timeline != null) bits.push(`typical approval timelines of around ${timeline} months`);
  if (bits.length > 0) parts.push(`On the regulatory side, ${bits.join(", ")}. Certification and permitting must therefore be sequenced with engineering milestones, not treated as a downstream wrap-up task.`);

  // Compliance gaps
  const gaps = regDet.compliance_gaps as string[] | undefined;
  if (gaps && gaps.length > 0) {
    parts.push(`Open compliance items currently flagged: ${gaps.slice(0, 5).join("; ")}. Each has to be retired with documented evidence before a commercial deployment decision is defensible.`);
  }

  const regKey = reg.key_detail as string | undefined;
  if (regKey && !parts.some((p) => p.includes(regKey))) parts.push(regKey);

  return parts.join("\n\n");
}

function synthesizeSafety(evaluation: Record<string, unknown>): string {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const safety = modules.safety || {};
  const det = (safety.details || {}) as Record<string, unknown>;
  const parts: string[] = [];

  const tier = det.chemistry_risk_tier as string | undefined;
  if (tier) {
    parts.push(`The process falls into the ${tier} chemistry risk tier. That drives the depth of hazard review, the required containment class, and the insurance/credit posture downstream — it is the single biggest cost multiplier on the safety budget.`);
  }

  const abuseBounded = det.abuse_cases_bounded as boolean | undefined;
  const abuseCases = det.abuse_cases as string[] | undefined;
  if (abuseBounded != null) {
    const base = abuseBounded
      ? "Bounded abuse-case analysis is in place — thermal runaway, loss-of-cooling, overpressure and contamination scenarios have been modeled with quantitative bounds rather than assertions."
      : "Abuse-case bounding is not yet complete — at least one credible failure scenario does not have a quantitative safety envelope, which is the single item most likely to hold up permitting review.";
    parts.push(base);
    if (abuseCases && abuseCases.length > 0) {
      parts.push(`Specific scenarios tracked: ${abuseCases.slice(0, 5).join("; ")}.`);
    }
  }

  const mitigations = det.mitigations as string[] | undefined;
  if (mitigations && mitigations.length > 0) {
    parts.push(`Layered mitigations in the current design: ${mitigations.slice(0, 4).join("; ")}.`);
  }

  const safetyKey = safety.key_detail as string | undefined;
  if (safetyKey && !parts.some((p) => p.includes(safetyKey))) parts.push(safetyKey);

  return parts.join("\n\n");
}

function synthesizeEnvironmental(evaluation: Record<string, unknown>): string {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const env = modules.environmental || {};
  const det = (env.details || {}) as Record<string, unknown>;
  const parts: string[] = [];

  const co2 = det.lifecycle_co2e_per_unit as number | undefined;
  const co2Unit = det.co2_unit as string | undefined;
  const baseline = det.baseline_co2e_per_unit as number | undefined;
  if (co2 != null) {
    const sign = baseline != null && baseline > 0 ? (co2 < baseline ? "below" : "above") : null;
    const pct = baseline && baseline > 0 ? Math.abs(((co2 - baseline) / baseline) * 100).toFixed(0) : null;
    parts.push(
      `Lifecycle carbon intensity comes in at ${co2.toLocaleString()} ${co2Unit || "kgCO2e/unit"}${sign && pct ? `, which is ${pct}% ${sign} the incumbent reference. That gap is the core environmental differentiator — either defensible in a green-premium market or, if directionally wrong, a blocker on most ESG-linked offtake` : "."}`,
    );
  }

  const waterUse = det.water_intensity_m3_per_unit as number | undefined;
  if (waterUse != null) {
    parts.push(`Water use is around ${waterUse.toFixed(2)} m³/unit. For many sites — particularly arid regions and water-stressed jurisdictions — this is effectively a permitting gate rather than a cost line.`);
  }

  const airEmissions = det.air_emissions as Record<string, unknown> | undefined;
  if (airEmissions && Object.keys(airEmissions).length > 0) {
    const bits = Object.entries(airEmissions)
      .slice(0, 4)
      .map(([k, v]) => `${humanizeParam(k)}: ${typeof v === "number" ? v.toFixed(2) : v}`);
    parts.push(`Air-side emissions footprint (per unit of production): ${bits.join("; ")}. These drive local permitting conditions more than lifecycle carbon does.`);
  }

  const waste = det.waste_stream as string | undefined;
  if (waste) parts.push(waste);

  const envKey = env.key_detail as string | undefined;
  if (envKey && !parts.some((p) => p.includes(envKey))) parts.push(envKey);

  return parts.join("\n\n");
}

function synthesizeRoadmap(evaluation: Record<string, unknown>): string {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const fi = (brief.founder_insights || {}) as Record<string, unknown>;
  const parts: string[] = [];

  const nextStep = fi.highest_value_next_action as string | undefined;
  if (nextStep) {
    parts.push(`The highest-leverage near-term move is: ${nextStep}. The roadmap below sequences this with the remaining milestones so that calendar and capital line up with de-risking order, not with what happens to be easiest to execute first.`);
  }

  // Explain sequencing logic
  const redFlags = (brief.red_flags_triggered || []) as Array<Record<string, unknown>>;
  const blockers = redFlags.filter((f) => f.severity === "blocker" && f.status !== "resolved");
  if (blockers.length > 0) {
    parts.push(`Sequencing priority: the ${blockers.length} blocker-severity risk signal${blockers.length === 1 ? "" : "s"} must be retired before any milestone downstream of it can be credibly claimed. Every other item should be treated as parallelizable only where it does not depend on a blocker's resolution.`);
  }

  const bottleneck = fi.top_commercial_bottleneck as string | undefined;
  if (bottleneck && !parts.some((p) => p.includes(bottleneck))) {
    parts.push(`Tight coupling: the milestone plan is built around closing the dominant commercial bottleneck — ${bottleneck}. If that framing moves, the sequencing below should be re-ordered accordingly.`);
  }

  return parts.join("\n\n");
}

// ── Embedded chart widgets ───────────────────────────────────

function YieldBreakdownChart({ oil, gas, char }: {
  oil?: number; gas?: number; char?: number;
}) {
  if (oil == null && gas == null && char == null) return null;
  const data = [
    oil != null ? { name: "Fuel Oil", value: oil, color: BRAND.teal } : null,
    gas != null ? { name: "Gas", value: gas, color: BRAND.blue } : null,
    char != null ? { name: "Char", value: char, color: BRAND.amber } : null,
  ].filter(Boolean) as Array<{ name: string; value: number; color: string }>;

  return (
    <ChartCard title="Yield Distribution" subtitle="% of feedstock mass converted to each product stream" flat={true}>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 60 }}>
            <CartesianGrid horizontal={false} stroke="#2a2f42" strokeDasharray="2 3" />
            <XAxis type="number" domain={[0, 100]} tick={{ fill: "#8b93a8", fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#d1d5db", fontSize: 12 }} width={60} />
            <Tooltip
              formatter={(v: number) => [`${v.toFixed(1)}%`, "Yield"]}
              contentStyle={{ background: "#1f2433", border: "1px solid #3a4154", borderRadius: 6, fontSize: 12 }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

interface MetricRow {
  label: string;
  /** Displayed value string (e.g. "$3.04/GGE", "67.6%"). */
  value: string;
  /** Numeric 0-100 for the progress bar (omit to hide bar). */
  progress?: number | null;
  /** Tone for the progress fill and value — teal (good), amber (flag), rose (bad). */
  tone?: "positive" | "warning" | "negative" | "neutral";
  /** Small caption under label — typically a benchmark anchor ("vs $3.50 gasoline"). */
  caption?: string;
}

/**
 * KeyMetricsBar — institutional-grade key-metrics panel.
 *
 * Three-column layout with label, tabular value, and a thin progress bar
 * where applicable. Matches the reference design language: row-based
 * hairline-divided, tabular numbers, small-caps labels, no card chrome.
 */
function KeyMetricsBar({ title, metrics }: { title?: string; metrics: MetricRow[] }) {
  const valid = metrics.filter((m) => m && m.label && m.value);
  if (valid.length === 0) return null;

  const toneColor = (t: MetricRow["tone"]): string => {
    if (t === "positive") return BRAND.teal;
    if (t === "warning") return BRAND.amber;
    if (t === "negative") return BRAND.rose;
    return "#607590";
  };

  return (
    <div>
      {title && (
        <h4 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-[-0.005em] mb-3">
          {title}
        </h4>
      )}
      <div className="border-t border-[var(--border)]/50">
        {valid.map((m, i) => {
          const color = toneColor(m.tone);
          const pct = m.progress != null ? Math.max(0, Math.min(100, m.progress)) : null;
          return (
            <div
              key={i}
              className="grid grid-cols-[1fr_auto] gap-6 items-center py-3 border-b border-[var(--border)]/50 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-3 mb-1.5">
                  <div className="text-[15px] font-medium text-[var(--text-secondary)] truncate">
                    {m.label}
                  </div>
                  {m.caption && (
                    <div className="text-[12px] text-[var(--text-dim)] truncate">
                      {m.caption}
                    </div>
                  )}
                </div>
                {pct != null && (
                  <div className="relative h-1 rounded-full bg-[var(--border)]/40 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                )}
              </div>
              <div
                className="text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-right shrink-0"
                style={{ color: m.tone && m.tone !== "neutral" ? color : "var(--text-primary)" }}
              >
                {m.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EfficiencyGauge({ etaII, ceiling }: { etaII?: number; ceiling?: number }) {
  if (etaII == null) return null;
  const pct = Math.round(etaII * 100);
  const ceilingPct = ceiling != null ? Math.round(ceiling * 100) : null;
  const headroom = ceiling != null ? Math.round((ceiling - etaII) * 100 * 10) / 10 : null;

  return (
    <ChartCard
      title="Second-Law (Exergy) Efficiency"
      subtitle={ceilingPct ? `How much of the theoretical maximum this process captures, against the ${ceilingPct}% domain ceiling.` : "How much of the theoretical maximum this process captures."} flat={true}
    >
      <div className="flex items-center gap-5 py-2">
        <ScoreGauge score={pct} size={110} strokeWidth={9} />
        <div className="flex-1 space-y-2 text-[15px]">
          {ceilingPct && (
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-dim)]">Domain ceiling (theoretical max)</span>
              <span className="tabular-nums font-medium text-[var(--text-secondary)]">{ceilingPct}%</span>
            </div>
          )}
          {headroom != null && (
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-dim)]">Remaining headroom</span>
              <span className="tabular-nums font-medium" style={{ color: headroom > 10 ? BRAND.teal : SEMANTIC.neutral }}>
                {headroom > 0 ? "+" : ""}{headroom}pp
              </span>
            </div>
          )}
          <div className="text-[12px] text-[var(--text-dim)] leading-relaxed pt-1">
            {headroom != null && headroom > 10
              ? "Meaningful room for process optimization to move the cost curve."
              : headroom != null && headroom > 0
              ? "Near the thermodynamic ceiling — further gains require capacity and integration plays."
              : "Process operating at the thermodynamic envelope for this technology class."}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

function ExergyDestructionChart({ destMap }: {
  destMap?: Array<{ mechanism: string; destruction_Wh: number; fraction_of_input: number }>;
}) {
  const validEntries = (destMap || []).filter(
    (d) => d && d.mechanism && (Number(d.destruction_Wh) > 0 || Number(d.fraction_of_input) > 0),
  );
  if (validEntries.length === 0) return null;
  return (
    <ChartCard
      title="Where Quality Is Lost (Exergy Destruction)"
      subtitle="The dominant irreversibilities — the mechanisms that matter for optimization." flat={true}
    >
      <HorizontalBarChart
        data={validEntries.slice(0, 4).map((d) => ({
          label: humanizeParam(d.mechanism || ""),
          value: Number(d.destruction_Wh) || 0,
          color: BRAND.amber,
        }))}
        valueFormatter={(v: number) => `${Math.round(v).toLocaleString()} Wh`}
        barSize={14}
      />
    </ChartCard>
  );
}

function BaselineDeltasChart({ deltas, baselineName }: {
  deltas?: Array<Record<string, unknown>>;
  baselineName?: string;
}) {
  const [filter, setFilter] = useState<"all" | "above" | "below">("all");
  if (!deltas || deltas.length === 0) return null;
  const meaningful = deltas.filter((d) => Math.abs((d.delta_pct as number) || 0) > 3);
  if (meaningful.length === 0) return null;

  const scoped = meaningful.filter((d) => {
    if (filter === "all") return true;
    return (d.quality as string) === filter;
  });

  const Chip = ({ k, label }: { k: "all" | "above" | "below"; label: string }) => (
    <button
      type="button"
      onClick={() => setFilter(k)}
      className="px-2.5 py-1 rounded-full border text-[12px] transition-colors"
      style={{
        borderColor: filter === k ? BRAND.teal : "var(--border)",
        color: filter === k ? BRAND.teal : "var(--text-dim)",
        background: filter === k ? `${BRAND.teal}15` : "transparent",
      }}
    >
      {label}
    </button>
  );

  return (
    <ChartCard
      title={`Delta vs ${baselineName || "Published Baseline"}`}
      subtitle="How this technology's declared parameters compare to the best published reference case. Filter to isolate parameters above or below the baseline."
      flat={true}
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <Chip k="all" label="All parameters" />
        <Chip k="above" label="Above baseline" />
        <Chip k="below" label="Below baseline" />
      </div>
      {scoped.length > 0 ? (
        <HorizontalBarChart
          data={scoped.slice(0, 8).map((d) => ({
            label: humanizeParam((d.param as string) || ""),
            value: d.delta_pct as number,
            color: (d.quality as string) === "above" ? BRAND.teal : BRAND.rose,
          }))}
          valueFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          barSize={12}
        />
      ) : (
        <div className="text-[12px] text-[var(--text-dim)] py-6 text-center">
          No parameters match the selected filter.
        </div>
      )}
    </ChartCard>
  );
}

function DualLCOFChart({ brief }: { brief: Record<string, unknown> }) {
  const nominal = brief.lcof_nominal_per_gge as number | undefined;
  const exAdj = brief.lcof_exergy_adjusted_per_gge as number | undefined;
  const divergence = brief.lcof_divergence_pct as number | undefined;
  if (nominal == null && exAdj == null) return null;

  const divColor = divergence == null || Math.abs(divergence) < 10 ? BRAND.teal
    : Math.abs(divergence) < 25 ? BRAND.amber : BRAND.rose;

  return (
    <ChartCard title="Levelized Cost of Fuel" subtitle="Nominal accounting versus exergy-quality-adjusted cost." flat={true}>
      <div className="grid grid-cols-3 divide-x divide-[var(--border)]/50 border border-[var(--border)]/50 rounded-md">
        {nominal != null && (
          <div className="px-5 py-4">
            <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-dim)] font-medium mb-1.5">
              Nominal
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[28px] font-semibold tabular-nums text-[var(--text-primary)] tracking-[-0.01em]">
                ${nominal.toFixed(2)}
              </span>
              <span className="text-[12px] text-[var(--text-dim)]">/GGE</span>
            </div>
          </div>
        )}
        {exAdj != null && (
          <div className="px-5 py-4">
            <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-dim)] font-medium mb-1.5">
              Exergy-Adjusted
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[28px] font-semibold tabular-nums text-[var(--text-primary)] tracking-[-0.01em]">
                ${exAdj.toFixed(2)}
              </span>
              <span className="text-[12px] text-[var(--text-dim)]">/GGE</span>
            </div>
          </div>
        )}
        {divergence != null && (
          <div className="px-5 py-4">
            <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-dim)] font-medium mb-1.5">
              Divergence
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className="text-[28px] font-semibold tabular-nums tracking-[-0.01em]"
                style={{ color: divColor }}
              >
                {divergence > 0 ? "+" : ""}{divergence.toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </div>
      {brief.lcof_exergy_adjustment_note && Math.abs(divergence || 0) >= 10 && (
        <div className="mt-3 text-[12px] text-[var(--text-dim)] italic leading-relaxed">
          {brief.lcof_exergy_adjustment_note as string}
        </div>
      )}
    </ChartCard>
  );
}

/**
 * InteractiveProcessChain — per-stage efficiency, mass retention, contaminant
 * level overlaid on the same chart. Each series can be toggled via the chip
 * row above the chart — useful when readers want to isolate a single signal.
 */
function InteractiveProcessChain({ stages }: { stages?: Array<Record<string, unknown>> }) {
  const [visible, setVisible] = useState<Record<string, boolean>>({
    efficiency: true,
    mass: true,
    cl: false,
  });
  if (!stages || stages.length === 0) return null;
  const data = stages.map((st) => ({
    name: String(st.stage_name || "Stage"),
    efficiency: clampPct(Number(st.stage_efficiency_pct || 0)) ?? 0,
    mass: Number(st.mass_out_kg || 0),
    cl: Number(st.cl_out_ppm || 0),
  }));
  const hasContam = data.some((d) => d.cl > 0);

  const toggle = (key: string) => setVisible((v) => ({ ...v, [key]: !v[key] }));

  const Chip = ({ k, label, color }: { k: string; label: string; color: string }) => (
    <button
      type="button"
      onClick={() => toggle(k)}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] transition-colors"
      style={{
        borderColor: visible[k] ? color : "var(--border)",
        color: visible[k] ? color : "var(--text-dim)",
        background: visible[k] ? `${color}15` : "transparent",
      }}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: color, opacity: visible[k] ? 1 : 0.35 }} />
      {label}
    </button>
  );

  return (
    <ChartCard
      title="Process Chain — Per-Stage Efficiency, Mass Retention & Contamination"
      subtitle={`${stages.length}-stage pathway. Toggle each series to isolate a signal — click a chip to hide or reveal it.`}
      flat={true}
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <Chip k="efficiency" label="Efficiency %" color={BRAND.teal} />
        <Chip k="mass" label="Mass Retained (kg)" color={BRAND.blue} />
        {hasContam && <Chip k="cl" label="Contaminant (ppm)" color={BRAND.amber} />}
      </div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 55, bottom: 55, left: 20 }}>
            <CartesianGrid stroke="#2a2f42" strokeDasharray="2 3" />
            <XAxis dataKey="name" tick={{ fill: "#8b93a8", fontSize: 10 }} angle={-25} textAnchor="end" height={55} interval={0} />
            <YAxis yAxisId="left" tick={{ fill: "#8b93a8", fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#8b93a8", fontSize: 11 }} tickFormatter={(v) => `${v}kg`} />
            <Tooltip
              contentStyle={{ background: "#1f2433", border: "1px solid #3a4154", borderRadius: 6, fontSize: 12 }}
              formatter={(v: number, name: string) => {
                if (name === "Efficiency") return [`${v.toFixed(0)}%`, name];
                if (name === "Mass Retained") return [`${v.toFixed(0)} kg`, name];
                if (name === "Contaminant") return [`${v.toFixed(1)} ppm`, name];
                return [v, name];
              }}
            />
            {visible.efficiency && (
              <Bar yAxisId="left" dataKey="efficiency" name="Efficiency" fill={BRAND.teal} radius={[3, 3, 0, 0]} />
            )}
            {visible.mass && (
              <Line yAxisId="right" dataKey="mass" name="Mass Retained" stroke={BRAND.blue} strokeWidth={2} dot={{ r: 3 }} />
            )}
            {hasContam && visible.cl && (
              <Line yAxisId="left" dataKey="cl" name="Contaminant" stroke={BRAND.amber} strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/**
 * ManufacturingReadinessTable — structured table with BOM summary, yield,
 * learning-curve mechanism, capacity & supply-chain posture. Draws from
 * the manufacturing and scalability module details with graceful fallbacks.
 */
function ManufacturingReadinessTable({ evaluation }: { evaluation: Record<string, unknown> }) {
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const mfg = (modules.manufacturing?.details || {}) as Record<string, unknown>;
  const scale = (modules.scalability?.details || {}) as Record<string, unknown>;
  const brief = (evaluation.brief || {}) as Record<string, unknown>;

  const bom = mfg.bom as Record<string, unknown> | undefined;
  const bomItems = (bom?.items || []) as Array<Record<string, unknown>>;
  const nCrit = bomItems.filter((i) => i.critical).length;
  const nSingle = bomItems.filter((i) => i.sourcing_status === "single_source").length;
  const yieldModel = mfg.yield_model as Record<string, unknown> | undefined;
  const yieldPct = clampPct(yieldModel?.estimated_first_pass_yield_pct as number | undefined);
  const learning = mfg.learning_mechanism as string | undefined;
  const trl = brief.trl_assessment as string | undefined;
  const capex = nonNegativeOrNull(scale.capex_per_unit_capacity as number | undefined);
  const capexUnit = scale.capex_unit as string | undefined;
  const throughput = nonNegativeOrNull(scale.commercial_throughput as number | undefined);
  const throughputUnit = scale.commercial_throughput_unit as string | undefined;

  const rows: Array<{ label: string; value: string; note?: string; tone?: "positive" | "warning" | "neutral" }> = [];
  if (trl) rows.push({ label: "Technology readiness", value: trl, note: "Rough positioning on the TRL ladder" });
  if (bomItems.length > 0) {
    rows.push({
      label: "Bill of materials",
      value: `${bomItems.length} parts`,
      note: `${nCrit} critical · ${nSingle} single-source`,
      tone: nSingle > 0 ? "warning" : "neutral",
    });
  }
  if (yieldPct != null) {
    rows.push({
      label: "First-pass yield (est.)",
      value: `${yieldPct.toFixed(0)}%`,
      note: firstPassYieldRowNote(yieldPct),
      tone: yieldPct >= 85 ? "positive" : yieldPct >= 60 ? "neutral" : "warning",
    });
  }
  if (learning && learning.length > 20) {
    rows.push({ label: "Learning curve", value: "Documented", note: learning.slice(0, 120) });
  }
  if (capex != null) {
    rows.push({
      label: "Capital intensity",
      value: `${capex.toLocaleString()} ${capexUnit || "$/unit"}`,
      note: "Per unit of commercial capacity",
    });
  }
  if (throughput != null) {
    rows.push({
      label: "Target commercial throughput",
      value: `${throughput.toLocaleString()} ${throughputUnit || "units/yr"}`,
    });
  }

  if (rows.length === 0) return null;

  const toneColor = (t?: string) => t === "positive" ? BRAND.teal : t === "warning" ? BRAND.amber : "var(--text-primary)";

  return (
    <ChartCard title="Manufacturing & Scale Readiness" subtitle="Structured snapshot of the scale-up posture." flat={true}>
      <div className="border-t border-[var(--border)]/50">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-6 items-baseline py-3 border-b border-[var(--border)]/50 last:border-b-0">
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-[var(--text-secondary)]">{r.label}</div>
              {r.note && <div className="text-[12px] text-[var(--text-dim)] mt-0.5 leading-relaxed">{r.note}</div>}
            </div>
            <div className="text-[15px] font-semibold tabular-nums text-right shrink-0" style={{ color: toneColor(r.tone) }}>
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/**
 * RiskMatrix — severity × likelihood scatter for triggered risk flags with
 * an interactive severity filter chip row. Flags are pulled from the brief.
 */
function RiskMatrix({ brief }: { brief: Record<string, unknown> }) {
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const flags = (brief.red_flags_triggered || []) as Array<Record<string, unknown>>;
  if (flags.length === 0) return null;

  const SEV_SCORE: Record<string, number> = { low: 1, medium: 2, high: 3, blocker: 4 };
  const LIK_SCORE: Record<string, number> = { unlikely: 1, possible: 2, likely: 3, observed: 4 };

  const filtered = severityFilter ? flags.filter((f) => (f.severity as string) === severityFilter) : flags;
  const data = filtered.map((f) => ({
    x: LIK_SCORE[(f.likelihood as string) || "possible"] || 2,
    y: SEV_SCORE[(f.severity as string) || "medium"] || 2,
    label: humanizeParam((f.key as string) || ""),
    severity: (f.severity as string) || "medium",
    color:
      (f.severity as string) === "blocker" ? BRAND.rose :
      (f.severity as string) === "high" ? BRAND.amber :
      BRAND.blue,
  }));

  const severities = Array.from(new Set(flags.map((f) => (f.severity as string) || "medium")));
  const Chip = ({ sev }: { sev: string | null }) => (
    <button
      type="button"
      onClick={() => setSeverityFilter(sev)}
      className="px-2.5 py-1 rounded-full border text-[12px] transition-colors"
      style={{
        borderColor: severityFilter === sev ? BRAND.teal : "var(--border)",
        color: severityFilter === sev ? BRAND.teal : "var(--text-dim)",
        background: severityFilter === sev ? `${BRAND.teal}15` : "transparent",
      }}
    >
      {sev ? sev.charAt(0).toUpperCase() + sev.slice(1) : "All"}
    </button>
  );

  return (
    <ChartCard
      title="Risk Matrix — Severity vs Likelihood"
      subtitle="Each point is a triggered risk flag placed by how severe and how likely it is. Click a severity chip to isolate that tier."
      flat={true}
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <Chip sev={null} />
        {severities.map((s) => <Chip key={s} sev={s} />)}
      </div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 12, right: 24, bottom: 40, left: 40 }}>
            <CartesianGrid stroke="#2a2f42" strokeDasharray="2 3" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0.5, 4.5]}
              ticks={[1, 2, 3, 4]}
              tickFormatter={(v) => ["Unlikely", "Possible", "Likely", "Observed"][v - 1] || ""}
              tick={{ fill: "#8b93a8", fontSize: 11 }}
              label={{ value: "Likelihood", position: "insideBottom", offset: -8, fill: "#8b93a8", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0.5, 4.5]}
              ticks={[1, 2, 3, 4]}
              tickFormatter={(v) => ["Low", "Medium", "High", "Blocker"][v - 1] || ""}
              tick={{ fill: "#8b93a8", fontSize: 11 }}
              label={{ value: "Severity", angle: -90, position: "insideLeft", fill: "#8b93a8", fontSize: 11 }}
            />
            <ZAxis range={[120, 120]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{ background: "#1f2433", border: "1px solid #3a4154", borderRadius: 6, fontSize: 12 }}
              content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "#1f2433", border: "1px solid #3a4154", borderRadius: 6, padding: 8, fontSize: 12 }}>
                    <div style={{ color: d.color, fontWeight: 600 }}>{d.label}</div>
                    <div style={{ color: "#b8c4dc" }}>Severity: {d.severity}</div>
                  </div>
                );
              }}
            />
            <Scatter data={data}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/**
 * EnvironmentalImpactChart — horizontal-bar comparison of candidate lifecycle
 * carbon, water, and air-side emissions against the incumbent reference,
 * where those references exist. Each metric is normalized to percentage
 * of the incumbent so the chart stays comparable across unit systems.
 */
function EnvironmentalImpactChart({ evaluation }: { evaluation: Record<string, unknown> }) {
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const det = (modules.environmental?.details || {}) as Record<string, unknown>;
  const candidate = det.lifecycle_co2e_per_unit as number | undefined;
  const baseline = det.baseline_co2e_per_unit as number | undefined;
  const water = det.water_intensity_m3_per_unit as number | undefined;
  const waterBase = det.baseline_water_intensity_m3_per_unit as number | undefined;
  const nox = (det.air_emissions as Record<string, unknown> | undefined)?.nox_kg_per_unit as number | undefined;
  const noxBase = (det.air_emissions as Record<string, unknown> | undefined)?.baseline_nox_kg_per_unit as number | undefined;

  const rows: Array<{ label: string; value: number; color: string; raw: string }> = [];
  const push = (label: string, v?: number, b?: number, unit = "") => {
    if (v == null || b == null || b === 0) return;
    const pct = (v / b) * 100;
    rows.push({
      label,
      value: pct,
      color: pct < 80 ? BRAND.teal : pct < 110 ? BRAND.amber : BRAND.rose,
      raw: `${v.toFixed(2)} ${unit} vs ${b.toFixed(2)} ${unit} baseline`,
    });
  };
  push("Lifecycle CO2e", candidate, baseline, "kgCO2e");
  push("Water intensity", water, waterBase, "m³");
  push("NOx emissions", nox, noxBase, "kg");
  if (rows.length === 0) return null;

  return (
    <ChartCard
      title="Environmental Footprint vs Incumbent"
      subtitle="Each bar is candidate-impact as a percentage of the incumbent reference. Below 100% is an improvement; above is a regression."
      flat={true}
    >
      <HorizontalBarChart
        data={rows}
        valueFormatter={(v: number) => `${v.toFixed(0)}% of incumbent`}
        barSize={14}
      />
      <div className="text-[12px] text-[var(--text-dim)] mt-2 leading-relaxed space-y-0.5">
        {rows.map((r, i) => <div key={i}>{r.label}: {r.raw}</div>)}
      </div>
    </ChartCard>
  );
}

/**
 * RoadmapTable — renders a detailed phase-by-phase milestone plan. If the
 * brief exposes a structured `roadmap_phases` array, use it directly;
 * otherwise synthesize a minimal three-phase plan from `next_actions` so
 * the table is never empty when actions are present.
 */
function RoadmapTable({ brief }: { brief: Record<string, unknown> }) {
  type Phase = { phase: string; duration: string; cost?: string; gate?: string; milestone: string; outcome?: string };
  const structured = brief.roadmap_phases as Phase[] | undefined;
  const actions = (brief.next_actions as string[]) || [];

  let phases: Phase[] = [];
  if (structured && structured.length > 0) {
    phases = structured;
  } else if (actions.length > 0) {
    // Fallback synthesis — bucket next_actions into three horizon tiers.
    const tiers = [
      { phase: "Near-term (0–6 mo)", gate: "Technical validation" },
      { phase: "Medium (6–18 mo)", gate: "Pilot-scale demonstration" },
      { phase: "Long (18–36 mo)", gate: "Commercial go/no-go" },
    ];
    phases = tiers.map((t, i) => ({
      phase: t.phase,
      duration: t.phase.split("(")[1]?.replace(")", "") || "—",
      gate: t.gate,
      milestone: actions[i] || (i === 0 ? actions[0] : "Track milestones from the prior phase before committing incremental capital."),
    })).filter((p) => p.milestone);
  }

  if (phases.length === 0) return null;

  return (
    <ChartCard
      title="De-Risking Milestone Plan"
      subtitle="Each row is a decision-gate horizon. Read left-to-right: commit to the milestone, verify the gate closes, release capital to the next phase."
      flat={true}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]/60">
              <th className="text-left py-2.5 pr-4 text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">Phase</th>
              <th className="text-left py-2.5 pr-4 text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">Duration</th>
              <th className="text-left py-2.5 pr-4 text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">Decision Gate</th>
              <th className="text-left py-2.5 text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">Milestone &amp; expected outcome</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((p, i) => (
              <tr key={i} className="border-b border-[var(--border)]/40 last:border-b-0 align-top">
                <td className="py-3 pr-4 font-medium text-[var(--text-primary)] whitespace-nowrap">{p.phase}</td>
                <td className="py-3 pr-4 text-[var(--text-secondary)] whitespace-nowrap tabular-nums">{p.duration || "—"}</td>
                <td className="py-3 pr-4 text-[var(--text-secondary)]">{p.gate || "—"}</td>
                <td className="py-3 text-[var(--text-secondary)] leading-relaxed">
                  {p.milestone}
                  {p.outcome && <div className="text-[12px] text-[var(--text-dim)] mt-1">Outcome: {p.outcome}</div>}
                  {p.cost && <div className="text-[12px] text-[var(--text-dim)] mt-1">Indicative cost: {p.cost}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

/**
 * ResourceRequirements — bullet list of capital, team, and infrastructure
 * asks required to execute the de-risking roadmap. Pulled from brief.
 * roadmap_resources if present, otherwise synthesized from the top bottleneck.
 */
function ResourceRequirements({ brief }: { brief: Record<string, unknown> }) {
  const resources = brief.roadmap_resources as Record<string, string[]> | undefined;
  if (!resources || Object.keys(resources).length === 0) {
    // Synthesize a light default based on the commercial bottleneck.
    const fi = (brief.founder_insights || {}) as Record<string, unknown>;
    const bottleneck = fi.top_commercial_bottleneck as string | undefined;
    if (!bottleneck) return null;
    return (
      <div className="rounded-md border border-[var(--border)]/50 bg-[var(--bg-secondary)]/40 px-5 py-4 space-y-2">
        <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">Execution Posture</div>
        <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
          The roadmap is organized to retire a single dominant bottleneck — {bottleneck} — before
          committing incremental capital to adjacent work. Expect the team shape to tilt toward the
          disciplines that own that bottleneck (engineering depth over commercial depth) through the
          first two phases.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Object.entries(resources).map(([category, items]) => (
        <div key={category} className="rounded-md border border-[var(--border)]/50 bg-[var(--bg-secondary)]/40 px-5 py-4">
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium mb-2">
            {humanizeParam(category)}
          </div>
          <ul className="space-y-1.5">
            {(items || []).slice(0, 6).map((it, i) => (
              <li key={i} className="text-[14px] text-[var(--text-secondary)] leading-relaxed flex gap-2">
                <span className="text-[var(--text-dim)] shrink-0">·</span>
                <span>{it}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SensitivityTornadoChart({ tornado, unit }: {
  tornado?: Array<Record<string, unknown>>;
  unit?: string;
}) {
  if (!tornado || tornado.length === 0) return null;
  return (
    <ChartCard
      title="Sensitivity — Top Cost Drivers"
      subtitle="The parameters whose uncertainty most affects the unit cost." flat={true}
    >
      <HorizontalBarChart
        data={tornado.slice(0, 6).map((t) => ({
          label: humanizeParam((t.param as string) || ""),
          value: Math.abs(t.swing as number),
          color: (t.swing as number) > 0 ? BRAND.rose : BRAND.teal,
        }))}
        valueFormatter={(v: number) => `\u00B1$${v.toFixed(1)} ${unit || ""}`}
        barSize={12}
      />
    </ChartCard>
  );
}

function NumberedMilestones({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="border-t border-[var(--border)]/50">
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-start gap-5 py-3.5 border-b border-[var(--border)]/50 last:border-b-0"
        >
          <div className="text-[12px] font-medium tabular-nums text-[var(--text-dim)] tracking-wider shrink-0 w-8 pt-0.5">
            {String(i + 1).padStart(2, "0")}
          </div>
          <div className="flex-1 text-[15px] text-[var(--text-secondary)] leading-relaxed">
            {item}
          </div>
        </div>
      ))}
    </div>
  );
}

function RiskCards({ brief }: { brief: Record<string, unknown> }) {
  const redFlags = (brief.red_flags_triggered || []) as Array<Record<string, unknown>>;
  if (redFlags.length === 0) return null;
  return (
    <ChartCard title="Triggered Risk Signals" subtitle="Observed signals that need resolution before deployment decisions." flat={true}>
      <div className="border-t border-[var(--border)]/50">
        {redFlags.slice(0, 5).map((f, i) => {
          const severity = (f.severity as string) || "medium";
          const status = (f.status as string) || "open";
          const color = severity === "blocker" ? BRAND.rose
            : severity === "high" ? BRAND.amber
            : SEMANTIC.neutral;
          return (
            <div
              key={i}
              className="flex items-start gap-5 py-3 border-b border-[var(--border)]/50 last:border-b-0"
            >
              <div className="shrink-0 w-24 pt-0.5">
                <div
                  className="text-[12px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color }}
                >
                  {severity}
                </div>
                {status !== "open" && (
                  <div className="text-[12px] text-[var(--text-dim)] uppercase tracking-wider mt-0.5">
                    {status}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium text-[var(--text-primary)] mb-1">
                  {humanizeParam((f.key as string) || "")}
                </div>
                {f.trigger_basis && (
                  <div className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
                    {f.trigger_basis as string}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// ── Technical audit appendix ─────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  physics: "Physics",
  performance: "Performance",
  economics: "Economics",
  safety: "Safety",
  environmental: "Environmental",
  regulatory: "Regulatory",
  manufacturing: "Manufacturing",
  scalability: "Scalability",
  system_integration: "System Integration",
  novelty: "Strategic Value",
};

/**
 * Humanize a gate name or snake_case parameter: "fuel_oil_yield_pct" → "Fuel Oil Yield".
 * Gate names often come in as human already (e.g., "Physics consistent") — leave those alone.
 */
function humanizeLabel(raw: string): string {
  if (!raw) return "";
  if (raw.includes(" ") && /[A-Z]/.test(raw)) return raw;
  return humanizeParam(raw);
}

/**
 * Humanize inline snake_case tokens inside a free-text detail string.
 * We only rewrite words that look like snake_case identifiers (two+
 * underscore-separated lowercase chunks) so we don't mangle URLs or
 * mixed-case tokens.
 */
function humanizeDetail(text: string): string {
  if (!text) return "";
  return text.replace(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,})\b/g, (m) => humanizeParam(m));
}

function TechnicalAuditAppendix({ evaluation, brief }: {
  evaluation: Record<string, unknown>;
  brief: Record<string, unknown>;
}) {
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const score = evaluation.score as number | undefined;
  const displayScore = score != null ? (score < 1 ? Math.round(score * 100) : Math.round(score)) : null;
  const avgConf = brief.avg_module_confidence as number | undefined;
  const modulesPassing = brief.modules_passing as number | undefined;
  const moduleCount = (brief.module_summary as unknown[])?.length || Object.keys(modules).length;
  const axes = [
    { key: "technical_feasibility", title: "Technical Feasibility", axis: brief.technical_feasibility },
    { key: "commercial_viability", title: "Commercial Viability", axis: brief.commercial_viability },
    { key: "spec_compliance_axis", title: "Spec Compliance", axis: brief.spec_compliance_axis },
    { key: "scale_readiness_axis", title: "Scale Readiness", axis: brief.scale_readiness_axis },
    { key: "thermodynamic_quality", title: "Thermodynamic Quality", axis: brief.thermodynamic_quality },
  ].filter((a) => a.axis && (a.axis as Record<string, unknown>).verdict);

  return (
    <div className="space-y-6">
      {/* Aggregate scorecard — hairline-divided tabular summary */}
      {(displayScore != null || avgConf != null || modulesPassing != null) && (
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]/50 border-y border-[var(--border)]/50">
          {displayScore != null && (
            <div className="px-4 py-4">
              <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-dim)] font-medium mb-1.5">
                Composite
              </div>
              <div className="text-[28px] font-semibold tabular-nums text-[var(--text-primary)] tracking-[-0.02em]">
                {displayScore}
              </div>
            </div>
          )}
          {avgConf != null && (
            <div className="px-4 py-4">
              <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-dim)] font-medium mb-1.5">
                Avg Confidence
              </div>
              <div className="text-[28px] font-semibold tabular-nums text-[var(--text-primary)] tracking-[-0.02em]">
                {Math.round(avgConf * 100)}%
              </div>
            </div>
          )}
          {modulesPassing != null && (
            <div className="px-4 py-4">
              <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-dim)] font-medium mb-1.5">
                Modules Passing
              </div>
              <div className="text-[28px] font-semibold tabular-nums text-[var(--text-primary)] tracking-[-0.02em]">
                {modulesPassing}
                <span className="text-[17px] text-[var(--text-dim)] font-normal"> / {moduleCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {(brief.combined_verdict_label || brief.combined_verdict) && (
        <div className="flex items-baseline gap-4 pb-2 border-b border-[var(--border)]/50">
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium shrink-0 w-[150px]">
            Combined Verdict
          </div>
          <div className="text-[15px] font-medium text-[var(--text-primary)] flex-1">
            {(brief.combined_verdict_label as string) || (brief.combined_verdict as string)}
          </div>
        </div>
      )}

      {/* Structured axis verdicts */}
      {axes.length > 0 && (
        <div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium mb-3">
            Structured Axis Verdicts
          </div>
          <div className="border-y border-[var(--border)]/50">
            {axes.map((a) => {
              const ax = a.axis as Record<string, unknown>;
              const v = ax.verdict as string;
              const conf = ax.confidence as number | undefined;
              const tier = ax.evidence_tier as string | undefined;
              const basis = ax.basis as string | undefined;
              return (
                <div
                  key={a.key}
                  className="py-3.5 border-b border-[var(--border)]/50 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-4 mb-1.5">
                    <span className="text-[15px] font-semibold text-[var(--text-primary)]">{a.title}</span>
                    <div className="flex items-baseline gap-4 text-[12px] tabular-nums shrink-0">
                      {tier && <span className="text-[var(--text-dim)]">{tier}</span>}
                      {conf != null && <span className="text-[var(--text-dim)]">{Math.round(conf * 100)}%</span>}
                      <span
                        className="font-semibold uppercase tracking-[0.1em] text-[12px]"
                        style={{ color: verdictColor(v) }}
                      >
                        {v.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                  {basis && (
                    <div className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
                      {humanizeDetail(basis)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Module-level findings */}
      <div>
        <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium mb-3">
          Module-Level Findings
        </div>
        <div className="border-y border-[var(--border)]/50">
          {Object.entries(modules).map(([key, mod]) => {
            const v = (mod.verdict as string) || "blocked";
            const conf = mod.confidence_0_1 as number | undefined;
            const cov = mod.evidence_coverage as number | undefined;
            const detail = mod.key_detail as string | undefined;
            const gates = (mod.gate_results || []) as Array<Record<string, unknown>>;
            return (
              <div key={key} className="py-4 border-b border-[var(--border)]/50 last:border-b-0">
                <div className="flex items-baseline justify-between gap-4 mb-2">
                  <span className="text-[15px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">
                    {MODULE_LABELS[key] || key}
                  </span>
                  <div className="flex items-baseline gap-4 text-[12px] tabular-nums shrink-0">
                    {conf != null && (
                      <span className="text-[var(--text-dim)]">
                        {Math.round(conf * 100)}% conf
                      </span>
                    )}
                    {cov != null && (
                      <span className="text-[var(--text-dim)]">
                        {Math.round(cov * 100)}% coverage
                      </span>
                    )}
                    <span
                      className="font-semibold uppercase tracking-[0.1em] text-[12px]"
                      style={{ color: verdictColor(v) }}
                    >
                      {v.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                {detail && (
                  <div className="text-[15px] text-[var(--text-secondary)] leading-relaxed mb-2">
                    {humanizeDetail(detail)}
                  </div>
                )}
                {gates.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]/30 space-y-1.5">
                    {gates.slice(0, 6).map((g, gi) => (
                      <div
                        key={gi}
                        className="text-[15px] flex items-baseline gap-4 leading-relaxed"
                      >
                        <span
                          className="shrink-0 w-12 font-semibold text-[12px] uppercase tracking-[0.1em]"
                          style={{ color: g.passed ? BRAND.teal : BRAND.rose }}
                        >
                          {g.passed ? "Pass" : "Fail"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[var(--text-secondary)] font-medium">
                            {humanizeLabel(String(g.gate_name || g.gate_id || ""))}
                          </span>
                          {g.detail && (
                            <span className="text-[var(--text-dim)]">
                              {" — "}
                              {humanizeDetail(String(g.detail)).slice(0, 180)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

export function AssessmentCanvas({ evaluation, projectId, onExportPdf, sourceTitle }: AssessmentCanvasProps) {
  const brief = (evaluation.brief || {}) as Record<string, unknown>;
  const modules = (evaluation.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  const processChain = (evaluation.process_chain || {}) as Record<string, unknown>;
  const stages = (processChain.stages || []) as Array<Record<string, unknown>>;
  const fi = (brief.founder_insights || {}) as Record<string, unknown>;
  const [allExpanded, setAllExpanded] = useState<boolean | null>(null);

  // Headline data
  const tierLabel = (brief.combined_verdict_label as string)
    || ((brief.readiness_tier as string) || "").replace(/_/g, " ");

  // Physics / performance data
  const phys = modules.physics || {};
  const perf = modules.performance || {};
  const physDet = (phys.details || {}) as Record<string, unknown>;
  const perfDet = (perf.details || {}) as Record<string, unknown>;

  // Economics data
  const econ = modules.economics || {};
  const econDet = (econ.details || {}) as Record<string, unknown>;
  const metric = econDet.economic_metric as string || "";
  const unit = econDet.metric_unit as string || "";
  const mk = metric.toLowerCase().replace(/ /g, "_");
  const econBase = econDet[`${mk}_base`] as number;
  const econOpt = econDet[`${mk}_optimistic`] as number;
  const econPess = econDet[`${mk}_pessimistic`] as number;
  const incumbent = econDet.incumbent_comparison as Record<string, unknown> | null;

  // Narratives
  const narratives = useMemo(() => ({
    technical: synthesizeTechnical(evaluation),
    economic: synthesizeEconomic(evaluation),
    scale: synthesizeScale(evaluation),
    regulatory: synthesizeRegulatory(evaluation),
    safety: synthesizeSafety(evaluation),
    environmental: synthesizeEnvironmental(evaluation),
    roadmap: synthesizeRoadmap(evaluation),
  }), [evaluation]);

  const actions = (brief.next_actions as string[]) || [];

  const tierColor = verdictColor((brief.readiness_tier as string) || "conditional");
  const resolvedSubject = brief.resolved_subject as Record<string, unknown> | undefined;
  const commercialName = (brief.commercial_name as string) || (resolvedSubject?.company as string) || "";
  const domainLabel = ((brief.domain as string) || "").replace(/_/g, " ");
  const trlStr = brief.trl_assessment as string | undefined;
  const trlMatch = trlStr?.match(/TRL\s*(\d)/i);
  const trlLevel = trlMatch ? parseInt(trlMatch[1], 10) : null;

  // Meta strip — tier + evidence + TRL composed as one quiet chip row
  const metaChips: Array<{ label: string; value: string; color?: string }> = [];
  if (tierLabel) metaChips.push({ label: "Assessment", value: tierLabel, color: tierColor });
  if (brief.credibility_tier) {
    metaChips.push({
      label: "Evidence",
      value: `${brief.credibility_tier}${brief.evidence_strength ? ` · ${brief.evidence_strength}` : ""}`,
    });
  }
  if (domainLabel) metaChips.push({ label: "Domain", value: domainLabel });
  if (trlLevel != null) metaChips.push({ label: "TRL", value: String(trlLevel) });

  return (
    <article className="pb-10">
      {/* ── Hero — simplified: title, identity, one meta strip, bottom line */}
      <header className="pt-2 pb-6">
        {/* Eyebrow + controls */}
        <div className="flex items-center justify-between gap-4 pb-5">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[12px] uppercase tracking-[0.18em] text-[var(--text-dim)] font-medium">
              Technology Assessment
            </span>
            {sourceTitle && (
              <span className="text-[13px] text-[var(--text-muted)] truncate max-w-[60ch]" title={sourceTitle}>
                {sourceTitle}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[12px] shrink-0">
            <button
              onClick={() => setAllExpanded(true)}
              className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Expand all
            </button>
            <span className="text-[var(--border)]">·</span>
            <button
              onClick={() => setAllExpanded(false)}
              className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Collapse all
            </button>
          </div>
        </div>

        {/* Title */}
        {commercialName && (
          <h1 className="text-[32px] font-semibold text-[var(--text-primary)] leading-[1.12] tracking-[-0.02em] mb-3">
            {commercialName}
          </h1>
        )}
        {fi.technology_identity && (
          <p className="text-[17px] text-[var(--text-muted)] leading-relaxed max-w-3xl">
            {fi.technology_identity as string}
          </p>
        )}

        {/* Meta strip — single line of label/value pairs, hairline-separated */}
        {metaChips.length > 0 && (
          <div className="mt-6 pt-4 border-t border-[var(--border)]/60 flex items-baseline flex-wrap gap-x-8 gap-y-3">
            {metaChips.map((c, i) => (
              <div key={i} className="flex items-baseline gap-2.5">
                <span className="text-[12px] uppercase tracking-[0.18em] text-[var(--text-dim)] font-medium">
                  {c.label}
                </span>
                <span
                  className="text-[15px] font-medium"
                  style={{ color: c.color || "var(--text-secondary)" }}
                >
                  {c.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Bottom line + bottleneck — two short prose blocks, flowing */}
        {(brief.headline || fi.top_commercial_bottleneck) && (
          <div className="mt-6 space-y-4">
            {brief.headline && (
              <p className="text-[17px] text-[var(--text-primary)] leading-[1.6] font-medium max-w-3xl">
                {brief.headline as string}
              </p>
            )}
            {fi.top_commercial_bottleneck && (
              <div className="flex items-baseline gap-4 max-w-3xl">
                <span className="text-[12px] uppercase tracking-[0.18em] text-[var(--text-dim)] font-medium shrink-0 w-[140px]">
                  Critical Bottleneck
                </span>
                <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed flex-1">
                  {fi.top_commercial_bottleneck as string}
                </p>
              </div>
            )}
          </div>
        )}
      </header>

      {/* ── Section 1: Technical Viability ────────────────── */}
      <CollapsibleSection
        title="Technical Viability — Physics, Yields & Thermodynamic Quality"
        defaultOpen={true}
        isOpen={allExpanded != null ? allExpanded : undefined}
      >
        <div className="space-y-5">
          {paragraphs(narratives.technical)}

          {/* Key technical metrics — institutional progress-bar panel */}
          {(() => {
            const metrics: MetricRow[] = [];
            const eta2 = brief.second_law_efficiency as number | undefined;
            const ceiling = brief.exergy_ceiling as number | undefined;
            const oil = perfDet.fuel_oil_yield_pct as number | undefined;
            const gas = perfDet.gas_yield_pct as number | undefined;
            const char_ = perfDet.biochar_yield_pct as number | undefined;
            const massClose = physDet.mass_closure_pct as number | undefined;

            if (eta2 != null) {
              const pct = eta2 * 100;
              const ceilPct = ceiling != null ? ceiling * 100 : null;
              const tone: MetricRow["tone"] =
                ceilPct != null && pct > ceilPct + 2 ? "warning"
                : pct >= 40 ? "positive"
                : "neutral";
              metrics.push({
                label: "Second-Law Efficiency (η_II)",
                value: `${pct.toFixed(1)}%`,
                progress: pct,
                tone,
                caption: ceilPct != null ? `Domain ceiling: ${ceilPct.toFixed(0)}%` : undefined,
              });
            }
            if (oil != null) {
              metrics.push({
                label: "Fuel Oil Yield",
                value: `${oil.toFixed(1)}%`,
                progress: oil,
                tone: oil >= 50 ? "positive" : "neutral",
                caption: "% of feedstock mass",
              });
            }
            if (gas != null) {
              metrics.push({
                label: "Gas Yield",
                value: `${gas.toFixed(1)}%`,
                progress: gas,
                tone: "neutral",
                caption: "% of feedstock mass",
              });
            }
            if (char_ != null) {
              metrics.push({
                label: "Char / Residue",
                value: `${char_.toFixed(1)}%`,
                progress: char_,
                tone: "neutral",
                caption: "% of feedstock mass",
              });
            }
            if (massClose != null) {
              const tone: MetricRow["tone"] =
                massClose >= 95 && massClose <= 105 ? "positive"
                : Math.abs(massClose - 100) > 10 ? "warning"
                : "neutral";
              metrics.push({
                label: "Mass Balance Closure",
                value: `${massClose.toFixed(1)}%`,
                progress: Math.min(massClose, 120),
                tone,
                caption: "Target: 95–105%",
              });
            }
            return <KeyMetricsBar title="Key Performance Metrics" metrics={metrics} />;
          })()}

          <EfficiencyGauge
            etaII={brief.second_law_efficiency as number | undefined}
            ceiling={brief.exergy_ceiling as number | undefined}
          />
          <ExergyDestructionChart destMap={brief.exergy_destruction_map as any} />
          <YieldBreakdownChart
            oil={perfDet.fuel_oil_yield_pct as number | undefined}
            gas={perfDet.gas_yield_pct as number | undefined}
            char={perfDet.biochar_yield_pct as number | undefined}
          />
          <BaselineDeltasChart
            deltas={physDet.value_deltas as any}
            baselineName={physDet.baseline_name as string | undefined}
          />
        </div>
      </CollapsibleSection>

      {/* ── Section 2: Economic Case ──────────────────────── */}
      <CollapsibleSection
        title="Economic Case — Unit Cost, Margins & Market Position"
        defaultOpen={true}
        isOpen={allExpanded != null ? allExpanded : undefined}
      >
        <div className="space-y-5">
          {paragraphs(narratives.economic)}

          {/* Key economic metrics */}
          {(() => {
            const metrics: MetricRow[] = [];
            const lcofN = brief.lcof_nominal_per_gge as number | undefined;
            const lcofX = brief.lcof_exergy_adjusted_per_gge as number | undefined;
            const divergence = brief.lcof_divergence_pct as number | undefined;
            const incVal = incumbent?.incumbent_value as number | undefined;

            if (lcofN != null) {
              const tone: MetricRow["tone"] =
                incVal != null && lcofN <= incVal ? "positive"
                : incVal != null && lcofN > incVal * 1.3 ? "warning"
                : "neutral";
              metrics.push({
                label: "Nominal LCOF",
                value: `$${lcofN.toFixed(2)}/GGE`,
                tone,
                caption: incVal != null ? `vs $${incVal.toFixed(2)} gasoline benchmark` : undefined,
              });
            }
            if (lcofX != null) {
              metrics.push({
                label: "Exergy-Adjusted LCOF",
                value: `$${lcofX.toFixed(2)}/GGE`,
                tone: "neutral",
                caption: "Quality-adjusted cost",
              });
            }
            if (divergence != null && Math.abs(divergence) >= 1) {
              const tone: MetricRow["tone"] =
                Math.abs(divergence) < 10 ? "positive"
                : Math.abs(divergence) < 25 ? "warning"
                : "negative";
              metrics.push({
                label: "Exergy Divergence",
                value: `${divergence > 0 ? "+" : ""}${divergence.toFixed(1)}%`,
                tone,
                caption: "Nominal vs exergy-adjusted",
              });
            }
            return metrics.length > 0 ? <KeyMetricsBar title="Economic Indicators" metrics={metrics} /> : null;
          })()}

          <DualLCOFChart brief={brief} />
          {econBase != null && econOpt != null && econPess != null && (
            <ChartCard
              title={`${metric} — Scenario Range`}
              subtitle="Optimistic, base, and pessimistic case for unit cost." flat={true}
            >
              <ScenarioRangeChart
                optimistic={econOpt}
                base={econBase}
                pessimistic={econPess}
                unit={unit}
              />
            </ChartCard>
          )}
          {incumbent && incumbent.incumbent_value != null && (
            <ChartCard
              title="Candidate vs Incumbent"
              subtitle={`Head-to-head against the ${incumbent.segment || "incumbent"} reference.`} flat={true}
            >
              <ComparisonBarChart
                candidate={incumbent.candidate_value as number}
                incumbent={incumbent.incumbent_value as number}
                candidateLabel="Candidate"
                incumbentLabel={(incumbent.segment as string) || "Incumbent"}
                unit={unit}
              />
            </ChartCard>
          )}
          <SensitivityTornadoChart tornado={econDet.sensitivity_tornado as any} unit={unit} />
        </div>
      </CollapsibleSection>

      {/* ── Section 3: Scale & Manufacturing ──────────────── */}
      <CollapsibleSection
        title="Scale & Manufacturing — Pilot-to-Commercial Pathway"
        subtitle="Where on the TRL ladder this sits, what the manufacturing posture looks like, and the specific scale-up steps that gate the commercial decision."
        defaultOpen={true}
        isOpen={allExpanded != null ? allExpanded : undefined}
      >
        <div className="space-y-6">
          {paragraphs(narratives.scale)}

          <ManufacturingReadinessTable evaluation={evaluation} />

          {stages.length > 0 && <InteractiveProcessChain stages={stages} />}

          {/* Scale-up bottlenecks, pulled from scalability/manufacturing blocking reasons */}
          {(() => {
            const mfgMod = (modules.manufacturing || {}) as Record<string, unknown>;
            const scaleMod = (modules.scalability || {}) as Record<string, unknown>;
            const blockers = [
              ...((mfgMod.blocking_reasons as string[]) || []),
              ...((scaleMod.blocking_reasons as string[]) || []),
            ].filter(Boolean);
            if (blockers.length === 0) return null;
            return (
              <div className="rounded-md border border-[var(--border)]/50 bg-[var(--bg-secondary)]/40 px-5 py-4">
                <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium mb-2">
                  Specific Scale-Up Bottlenecks
                </div>
                <ul className="space-y-2">
                  {blockers.slice(0, 6).map((b, i) => (
                    <li key={i} className="text-[14px] text-[var(--text-secondary)] leading-relaxed flex gap-2.5">
                      <span className="text-[var(--accent-red)] shrink-0 mt-0.5">▸</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </div>
      </CollapsibleSection>

      {/* ── Section 4: Deployment Risks ───────────────────── */}
      <CollapsibleSection
        title="Deployment Risks — Regulatory, Safety & Environmental"
        subtitle="The three risk surfaces that most often stop a technically-sound device from actually shipping. Each has its own dedicated narrative below."
        defaultOpen={true}
        isOpen={allExpanded != null ? allExpanded : undefined}
      >
        <div className="space-y-7">
          {/* Sub-section: Regulatory */}
          {narratives.regulatory && (
            <div className="space-y-3">
              <h3 className="text-[16px] font-semibold text-[var(--text-primary)] tracking-[-0.005em] pb-1.5 border-b border-[var(--border)]/50">
                Regulatory Pathway
              </h3>
              {paragraphs(narratives.regulatory)}
            </div>
          )}

          {/* Sub-section: Safety */}
          {narratives.safety && (
            <div className="space-y-3">
              <h3 className="text-[16px] font-semibold text-[var(--text-primary)] tracking-[-0.005em] pb-1.5 border-b border-[var(--border)]/50">
                Safety & Hazard Envelope
              </h3>
              {paragraphs(narratives.safety)}
            </div>
          )}

          {/* Sub-section: Environmental */}
          {narratives.environmental && (
            <div className="space-y-3">
              <h3 className="text-[16px] font-semibold text-[var(--text-primary)] tracking-[-0.005em] pb-1.5 border-b border-[var(--border)]/50">
                Environmental Footprint
              </h3>
              {paragraphs(narratives.environmental)}
              <EnvironmentalImpactChart evaluation={evaluation} />
            </div>
          )}

          {/* Risk matrix + triggered red-flag table */}
          <div className="space-y-3">
            <h3 className="text-[16px] font-semibold text-[var(--text-primary)] tracking-[-0.005em] pb-1.5 border-b border-[var(--border)]/50">
              Triggered Risk Signals
            </h3>
            <RiskMatrix brief={brief} />
            <RiskCards brief={brief} />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Section 5: De-Risking Roadmap ─────────────────── */}
      <CollapsibleSection
        title="De-Risking Roadmap — Prioritized Validation Milestones"
        subtitle="Sequenced plan for closing the gaps identified above. Read it as the capital-release schedule — each phase releases the next."
        defaultOpen={true}
        isOpen={allExpanded != null ? allExpanded : undefined}
      >
        <div className="space-y-6">
          {paragraphs(narratives.roadmap)}

          <RoadmapTable brief={brief} />

          {actions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">
                Specific Next Actions
              </h4>
              <NumberedMilestones items={actions} />
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">
              Resource &amp; Execution Posture
            </h4>
            <ResourceRequirements brief={brief} />
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Technical Audit Detail (collapsible appendix) ─── */}
      <CollapsibleSection
        title="Appendix — Technical Audit Detail"
        subtitle="Module-level findings, gate results, confidence levels, and the structured axis verdict table. Intended for technical due-diligence readers."
        defaultOpen={false}
        isOpen={allExpanded != null ? allExpanded : undefined}
      >
        <TechnicalAuditAppendix evaluation={evaluation} brief={brief} />
      </CollapsibleSection>

      {/* ── Export Bar ────────────────────────────────────── */}
      {onExportPdf && (
        <div className="pt-8 mt-2 border-t border-[var(--border)]/60">
          <button
            onClick={onExportPdf}
            className="px-4 py-2 rounded-md text-[15px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--text-dim)] transition-colors"
          >
            Export PDF Report
          </button>
        </div>
      )}
    </article>
  );
}
