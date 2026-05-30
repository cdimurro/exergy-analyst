// @ts-nocheck
"use client";

/**
 * SectionContent — renders module section content based on data shape.
 *
 * Shape-driven, not domain-specific. Inspects what fields exist in
 * the module data and renders the appropriate visualization:
 * - gate_results → pass/fail grid
 * - value_deltas → baseline comparison chart
 * - economic_metric + scenario triplet → charts
 * - sensitivity_tornado → horizontal bar chart
 * - key_detail → paragraph text
 * - blocking_reasons → concern list
 * - critical_assumptions → assumption list
 */

import { BRAND, SEMANTIC, verdictColor } from "@/lib/chart-theme";

function humanizeParam(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b(pct|kw|mj|per kg|per ton|gco2|mah|wh|mw)\b/gi, "").replace(/\s+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase());
}
import {
  ChartEmptyState,
  HorizontalBarChart,
  ScenarioRangeChart,
  ComparisonBarChart,
  SystemLCOEChart,
} from "@/components/charts/ChartPrimitives";
import { generateModuleNarrative } from "@/lib/narrative-engine";

interface SectionContentProps {
  moduleKey: string;
  moduleData: Record<string, unknown>;
}

export function SectionContent({ moduleKey, moduleData }: SectionContentProps) {
  const det = (moduleData.details || {}) as Record<string, unknown>;
  const verdict = moduleData.verdict as string;
  const score = moduleData.score_0_100 as number;
  const confidence = moduleData.confidence_0_1 as number;

  // Blocked state
  if (verdict === "blocked") {
    const blocking = (moduleData.blocking_reasons || []) as string[];
    const actions = (moduleData.next_required_actions || []) as string[];
    return (
      <div>
        <ChartEmptyState message="Insufficient data to evaluate this module" />
        {blocking.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[15px] font-semibold text-[var(--text-dim)]">Missing data:</div>
            {blocking.map((b, i) => (
              <div key={i} className="text-[15px] text-[var(--text-muted)] pl-2">- {b}</div>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[15px] font-semibold text-[var(--text-dim)]">To unlock:</div>
            {actions.map((a, i) => (
              <div key={i} className="text-[15px] text-[var(--text-muted)] pl-2">{i + 1}. {a}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const sections: React.ReactNode[] = [];

  // Score + verdict summary
  if (score != null) {
    sections.push(
      <div key="score" className="flex items-center gap-3 py-2 px-3 rounded-lg bg-[var(--bg-elevated)]/50">
        <span className="text-[15px] text-[var(--text-dim)]">Score:</span>
        <span className="text-[17px] font-bold tabular-nums" style={{ color: verdictColor(verdict) }}>
          {score.toFixed(1)}/100
        </span>
        <span className="text-[15px] text-[var(--text-dim)]">|</span>
        <span className="text-[15px] text-[var(--text-dim)]">Confidence:</span>
        <span className="text-[15px] font-medium tabular-nums text-[var(--text-secondary)]">
          {confidence != null ? `${(confidence * 100).toFixed(0)}%` : "--"}
        </span>
      </div>,
    );
  }

  // Narrative explanation — prefer AI-generated, fall back to template
  try {
    const aiNarrative = det.ai_narrative as string;
    const templateNarrative = generateModuleNarrative(moduleKey, moduleData as any);
    const narrative = aiNarrative || templateNarrative;
    if (narrative) {
      sections.push(
        <div key="narrative" className="text-[15px] text-[var(--text-secondary)] leading-relaxed rounded-lg p-3 bg-[var(--bg-elevated)]/30">
          {aiNarrative && (
            <div className="text-[12px] text-[var(--text-dim)] mb-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
              AI Analysis
            </div>
          )}
          {narrative.split("\n").map((line, i) => {
            if (line.startsWith("•")) {
              return <div key={i} className="pl-2 mt-0.5">{line}</div>;
            }
            return <div key={i} className={i > 0 ? "mt-1.5" : ""}>{line}</div>;
          })}
        </div>,
      );
    }
  } catch { /* narrative is non-critical */ }

  // Gate results
  const gates = (moduleData.gate_results || []) as Array<Record<string, unknown>>;
  if (gates.length > 0) {
    sections.push(
      <div key="gates" className="space-y-1">
        <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Gates</div>
        {gates.map((g, i) => (
          <div key={i} className="flex items-center gap-2 py-1 border-b border-[var(--border)]/30 last:border-b-0">
            <span className="w-2 h-2 rounded-full shrink-0"
              style={{ background: g.passed ? BRAND.teal : BRAND.rose }} />
            <span className="text-[15px] text-[var(--text-secondary)] flex-1">
              {g.gate_name || g.gate_id}
            </span>
            <span className="text-[15px]" style={{ color: g.passed ? BRAND.teal : BRAND.rose }}>
              {g.passed ? "pass" : "fail"}
            </span>
          </div>
        ))}
      </div>,
    );
  }

  // Economics: scenario range
  if (moduleKey === "economics") {
    const metric = det.economic_metric as string || "";
    const unit = det.metric_unit as string || "";
    const mk = metric.toLowerCase().replace(/ /g, "_");
    const base = det[`${mk}_base`] as number;
    const opt = det[`${mk}_optimistic`] as number;
    const pess = det[`${mk}_pessimistic`] as number;

    if (base != null && opt != null && pess != null) {
      sections.push(
        <div key="scenario">
          <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-2">
            {metric} Scenario Range
          </div>
          <ScenarioRangeChart optimistic={opt} base={base} pessimistic={pess} unit={unit} />
        </div>,
      );
    }

    // Incumbent comparison
    const inc = det.incumbent_comparison as Record<string, unknown> | null;
    if (inc && inc.incumbent_value != null) {
      sections.push(
        <div key="incumbent">
          <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-2">
            vs Incumbent
          </div>
          <ComparisonBarChart
            candidate={inc.candidate_value as number}
            incumbent={inc.incumbent_value as number}
            candidateLabel="Candidate"
            incumbentLabel={inc.segment as string || "Incumbent"}
            unit={unit}
          />
        </div>,
      );
    }

    // Sensitivity tornado
    const tornado = det.sensitivity_tornado as Array<Record<string, unknown>>;
    if (tornado && tornado.length > 0) {
      sections.push(
        <div key="tornado">
          <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-2">
            Sensitivity — Top Drivers
          </div>
          <HorizontalBarChart
            data={tornado.slice(0, 6).map(t => ({
              label: humanizeParam(t.param as string || ""),
              value: Math.abs(t.swing as number),
              color: (t.swing as number) > 0 ? BRAND.rose : BRAND.teal,
            }))}
            valueFormatter={(v: number) => `\u00B1$${v.toFixed(1)} ${unit}`}
            barSize={12}
          />
        </div>,
      );
    }

    // System LCOE
    if (det.system_lcoe_base != null && det.system_adjustment) {
      const adj = det.system_adjustment as Record<string, unknown>;
      sections.push(
        <div key="system_lcoe">
          <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-2">
            System-Adjusted LCOE
          </div>
          <SystemLCOEChart
            standaloneLCOE={base || 0}
            curtailmentAdder={(base || 0) * ((adj.curtailment_rate as number) || 0)}
            integrationCost={(adj.integration_cost_per_mwh as number) || 0}
            unit={unit}
          />
        </div>,
      );
    }

    // CAPEX breakdown
    const capex = det.capex_breakdown as Record<string, number>;
    if (capex && Object.keys(capex).length > 0) {
      sections.push(
        <div key="capex">
          <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-2">
            CAPEX Breakdown
          </div>
          <HorizontalBarChart
            data={Object.entries(capex).map(([k, v], i) => ({
              label: k.replace(/_/g, " "),
              value: v,
              color: [BRAND.blue, BRAND.teal, BRAND.purple, BRAND.amber][i % 4],
            }))}
            valueFormatter={(v: number) => `$${v.toLocaleString()}/kW`}
          />
        </div>,
      );
    }

    // Assumptions
    const assumptions = det.assumptions as Record<string, unknown>;
    if (assumptions) {
      sections.push(
        <div key="assumptions">
          <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
            Key Assumptions
          </div>
          {Object.entries(assumptions).map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-[var(--border)]/30 last:border-b-0 text-[15px]">
              <span className="text-[var(--text-dim)]">{k.replace(/_/g, " ")}</span>
              <span className="text-[var(--text-secondary)] font-medium tabular-nums">{String(v)}</span>
            </div>
          ))}
        </div>,
      );
    }
  }

  // Value deltas (baseline comparison) — works for any module
  const deltas = det.value_deltas as Array<Record<string, unknown>>;
  if (deltas && deltas.length > 0) {
    const meaningful = deltas.filter(d => Math.abs((d.delta_pct as number) || 0) > 3);
    if (meaningful.length > 0) {
      sections.push(
        <div key="deltas">
          <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
            vs {det.baseline_name as string || "Baseline"}
          </div>
          {meaningful.map((d, i) => (
            <div key={i} className="flex items-center gap-2 py-1 border-b border-[var(--border)]/30 last:border-b-0 text-[15px]">
              <span className="w-1.5 h-1.5 rounded-full" style={{
                background: (d.quality as string) === "above" ? BRAND.teal : BRAND.rose,
              }} />
              <span className="text-[var(--text-secondary)] flex-1">
                {humanizeParam(d.param as string || "")}
              </span>
              <span className="tabular-nums font-medium" style={{
                color: (d.quality as string) === "above" ? BRAND.teal : BRAND.rose,
              }}>
                {(d.delta_pct as number) > 0 ? "+" : ""}{(d.delta_pct as number).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>,
      );
    }
  }

  // WtE-specific: output allocation
  const wteAlloc = det.wte_output_allocation as Record<string, unknown>;
  if (wteAlloc && (wteAlloc.outputs as unknown[])?.length > 0) {
    const outputs = wteAlloc.outputs as Array<Record<string, unknown>>;
    sections.push(
      <div key="wte_outputs">
        <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
          Output Allocation {wteAlloc.multi_output ? "(multi-output)" : ""}
        </div>
        {outputs.map((o, i) => (
          <div key={i} className="flex items-center gap-2 py-1 border-b border-[var(--border)]/30 last:border-b-0 text-[15px]">
            <span className="w-2 h-2 rounded-full shrink-0"
              style={{ background: o.scored ? BRAND.teal : SEMANTIC.neutral }} />
            <span className="text-[var(--text-secondary)] flex-1">{o.product as string}</span>
            <span className="text-[var(--text-dim)]">{o.metric as string}</span>
            <span className="text-[15px] px-1 py-0.5 rounded-full"
              style={{ background: o.scored ? `${BRAND.teal}15` : `${SEMANTIC.neutral}15`, color: o.scored ? BRAND.teal : SEMANTIC.neutral }}>
              {o.scored ? "scored" : "advisory"}
            </span>
          </div>
        ))}
      </div>,
    );
  }

  // Key detail text (generic — works for any module)
  const keyDetail = det.key_detail as string;
  if (keyDetail && keyDetail.length > 10) {
    sections.push(
      <p key="detail" className="text-[15px] text-[var(--text-secondary)] leading-relaxed">
        {keyDetail}
      </p>,
    );
  }

  // Critical assumptions
  const assumptions_list = (moduleData.critical_assumptions || []) as string[];
  if (assumptions_list.length > 0) {
    sections.push(
      <div key="assumptions_list">
        <div className="text-[15px] font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
          Assumptions
        </div>
        {assumptions_list.map((a, i) => (
          <div key={i} className="text-[15px] text-[var(--text-muted)] pl-2">- {a}</div>
        ))}
      </div>,
    );
  }

  if (sections.length === 0) {
    return <p className="text-[15px] text-[var(--text-dim)] italic">No detailed data available for this module.</p>;
  }

  return <div className="space-y-4">{sections}</div>;
}
