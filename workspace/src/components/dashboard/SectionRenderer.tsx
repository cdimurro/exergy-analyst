// @ts-nocheck
"use client";

/**
 * SectionRenderer — maps a VizSection to the correct chart/display widget.
 *
 * Pure pattern dispatch — no domain logic. Each VizPattern maps to a
 * reusable chart primitive or a lightweight inline renderer.
 */

import { type VizSection } from "@/lib/visualization-policy";
import { BRAND, SEMANTIC, scoreColor, verdictColor } from "@/lib/chart-theme";
import {
  ChartCard,
  ChartEmptyState,
  HorizontalBarChart,
  ScenarioRangeChart,
  ComparisonBarChart,
  SystemLCOEChart,
} from "@/components/charts/ChartPrimitives";

interface SectionRendererProps {
  section: VizSection;
}

export function SectionRenderer({ section }: SectionRendererProps) {
  const { pattern, data, title, subtitle, showCaveat, confidence } = section;

  const content = (() => {
    switch (pattern) {
      case "scalar_hero":
        return <ScalarHero data={data} />;
      case "scenario_triplet":
        return <ScenarioTriplet data={data} />;
      case "comparison_bar":
        return <ComparisonSection data={data} />;
      case "sensitivity_tornado":
        return <SensitivitySection data={data} />;
      case "module_breakdown":
        return <ModuleBreakdown data={data} />;
      case "capex_breakdown":
        return <CapexSection data={data} />;
      case "stacked_cost":
        return <StackedCostSection data={data} />;
      case "literature_range":
        return <LiteratureRange data={data} />;
      case "output_allocation":
        return <OutputAllocation data={data} />;
      case "baseline_comparison":
        return <BaselineComparison data={data} />;
      case "metric_table":
        return <MetricTable data={data} />;
      case "advisory_note":
        return <AdvisoryNote data={data} />;
      case "empty_state":
        return <ChartEmptyState message={data.message as string || "No data"} />;
      default:
        return <ChartEmptyState message={`Unknown pattern: ${pattern}`} />;
    }
  })();

  // Wrap in ChartCard for non-hero patterns
  if (pattern === "scalar_hero") {
    return (
      <div>
        {content}
        {showCaveat && subtitle && (
          <p className="text-[10px] text-[var(--text-dim)] mt-1 italic">{subtitle}</p>
        )}
      </div>
    );
  }

  return (
    <ChartCard title={title} subtitle={showCaveat ? subtitle : undefined}>
      {content}
      {showCaveat && confidence != null && confidence < 0.5 && (
        <p className="text-[10px] text-[var(--text-dim)] mt-2 italic">
          Low confidence ({(confidence * 100).toFixed(0)}%) — interpret with caution
        </p>
      )}
    </ChartCard>
  );
}

// ── Widget implementations ─────────────────────────────────

function ScalarHero({ data }: { data: Record<string, unknown> }) {
  const value = data.value as number;
  const label = data.label as string || "";
  const unit = data.unit as string || "";
  const mode = data.mode as string || "";
  const format = data.format as string || "number";

  let displayValue: string;
  if (format === "score") {
    displayValue = typeof value === "number" ? (value * 100).toFixed(0) : String(value);
  } else if (format === "currency") {
    displayValue = typeof value === "number"
      ? (Math.abs(value) >= 1000
          ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : `$${value.toFixed(1)}`)
      : String(value);
  } else {
    displayValue = String(value);
  }

  const color = format === "score" ? scoreColor(value * 100) : BRAND.blue;

  return (
    <div className="rounded-xl p-5" style={{
      background: `linear-gradient(135deg, ${color}08 0%, ${color}04 100%)`,
      border: `1px solid ${color}20`,
    }}>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {displayValue}
        </span>
        {unit && <span className="text-[14px] text-[var(--text-muted)]">{unit}</span>}
        {format === "score" && (
          <span className="text-[12px] text-[var(--text-dim)]">/ 100</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
        {mode && (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold"
            style={{
              background: `${mode === "computed" ? BRAND.teal : mode === "estimated" ? BRAND.amber : SEMANTIC.neutral}18`,
              color: mode === "computed" ? BRAND.teal : mode === "estimated" ? BRAND.amber : SEMANTIC.neutral,
            }}>
            {mode}
          </span>
        )}
      </div>
    </div>
  );
}

function ScenarioTriplet({ data }: { data: Record<string, unknown> }) {
  return (
    <ScenarioRangeChart
      optimistic={data.optimistic as number}
      base={data.base as number}
      pessimistic={data.pessimistic as number}
      unit={data.unit as string}
      label={data.label as string}
    />
  );
}

function ComparisonSection({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <ComparisonBarChart
        candidate={data.candidate as number}
        incumbent={data.incumbent as number}
        candidateLabel={data.candidateLabel as string}
        incumbentLabel={data.incumbentLabel as string}
        unit={data.unit as string}
      />
      {data.delta_pct != null && (
        <div className="text-[11px] mt-1 text-center">
          <span style={{ color: (data.is_competitive as boolean) ? BRAND.teal : BRAND.rose }}>
            {(data.delta_pct as number) > 0 ? "+" : ""}{(data.delta_pct as number).toFixed(1)}% vs incumbent
          </span>
        </div>
      )}
    </div>
  );
}

function SensitivitySection({ data }: { data: Record<string, unknown> }) {
  const items = (data.items as Array<{ label: string; value: number; color?: string }>) || [];
  const unit = data.unit as string || "";

  return (
    <HorizontalBarChart
      data={items.map(it => ({
        label: it.label,
        value: Math.abs(it.value),
        color: it.value > 0 ? BRAND.rose : BRAND.teal,
      }))}
      valueFormatter={(v: number) => `\u00B1$${v.toFixed(1)} ${unit}`}
      barSize={12}
    />
  );
}

function ModuleBreakdown({ data }: { data: Record<string, unknown> }) {
  const modules = (data.modules as Array<{
    name: string; verdict: string; confidence: number; score: number; isVeto: boolean;
  }>) || [];

  if (modules.length === 0) return <ChartEmptyState message="No module data" />;

  return (
    <div className="space-y-1">
      {modules.map(m => (
        <div key={m.name} className="flex items-center gap-2 py-1 border-b border-[var(--border)]/30 last:border-b-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: verdictColor(m.verdict) }}
          />
          <span className="text-[12px] text-[var(--text-secondary)] flex-1 min-w-0 truncate">
            {m.name}
            {m.isVeto && <span className="text-[9px] text-[var(--text-dim)] ml-1">(veto)</span>}
          </span>
          <span className="text-[11px] font-medium tabular-nums" style={{ color: verdictColor(m.verdict) }}>
            {m.verdict}
          </span>
          <span className="text-[10px] text-[var(--text-dim)] tabular-nums w-8 text-right">
            {(m.confidence * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function CapexSection({ data }: { data: Record<string, unknown> }) {
  const items = (data.items as Array<{ label: string; value: number }>) || [];
  const unit = data.unit as string || "";

  return (
    <HorizontalBarChart
      data={items.map((it, i) => ({
        label: it.label,
        value: it.value,
        color: [BRAND.blue, BRAND.teal, BRAND.purple, BRAND.amber, BRAND.cyan][i % 5],
      }))}
      valueFormatter={(v: number) => `$${v.toLocaleString()} ${unit}`}
    />
  );
}

function StackedCostSection({ data }: { data: Record<string, unknown> }) {
  return (
    <SystemLCOEChart
      standaloneLCOE={data.standaloneLCOE as number}
      curtailmentAdder={data.curtailmentAdder as number}
      integrationCost={data.integrationCost as number}
      unit={data.unit as string || "$/MWh"}
    />
  );
}

function LiteratureRange({ data }: { data: Record<string, unknown> }) {
  const min = data.min as number;
  const max = data.max as number;
  const unit = data.unit as string || "";
  const sources = (data.sources as string[]) || [];

  return (
    <div>
      <div className="rounded-lg p-4" style={{
        background: `linear-gradient(135deg, ${BRAND.purple}08 0%, ${BRAND.blue}04 100%)`,
        border: `1px solid ${BRAND.purple}20`,
      }}>
        <span className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
          ${min?.toLocaleString()}--${max?.toLocaleString()}
        </span>
        <span className="text-[13px] text-[var(--text-muted)] ml-2">{unit}</span>
      </div>
      {sources.length > 0 && (
        <div className="mt-2 text-[10px] text-[var(--text-dim)]">
          Sources: {sources.join("; ")}
        </div>
      )}
    </div>
  );
}

function OutputAllocation({ data }: { data: Record<string, unknown> }) {
  const outputs = (data.outputs as Array<{
    product: string; metric: string; scored: boolean; scoring_basis: string;
  }>) || [];

  return (
    <div className="space-y-1.5">
      {outputs.map((o, i) => (
        <div key={i} className="flex items-start gap-2 py-1.5 border-b border-[var(--border)]/30 last:border-b-0">
          <span
            className="w-2 h-2 rounded-full shrink-0 mt-1"
            style={{ background: o.scored ? BRAND.teal : SEMANTIC.neutral }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-[var(--text-secondary)]">{o.product}</div>
            <div className="text-[11px] text-[var(--text-dim)]">{o.metric}</div>
          </div>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{
            background: o.scored ? `${BRAND.teal}15` : `${SEMANTIC.neutral}15`,
            color: o.scored ? BRAND.teal : SEMANTIC.neutral,
          }}>
            {o.scored ? "scored" : "advisory"}
          </span>
        </div>
      ))}
    </div>
  );
}

function BaselineComparison({ data }: { data: Record<string, unknown> }) {
  const comparisons = (data.comparisons as Array<{
    label?: string;
    baseline?: string;
    source?: string;
    deltas: Array<{
      metric: string;
      candidate?: number;
      baseline_value?: number;
      delta?: number;
      unit?: string;
      favorable?: boolean;
      scored?: boolean;
    }>;
  }>) || [];

  return (
    <div className="space-y-3">
      {comparisons.map((comp, ci) => (
        <div key={ci}>
          <div className="text-[11px] font-medium text-[var(--text-secondary)] mb-1">
            vs {comp.label || comp.baseline || "Baseline"}
          </div>
          <div className="space-y-0.5">
            {comp.deltas?.map((d, di) => (
              <div key={di} className="flex items-center gap-2 py-1 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full" style={{
                  background: d.favorable ? BRAND.teal : d.favorable === false ? BRAND.rose : SEMANTIC.neutral,
                }} />
                <span className="text-[var(--text-dim)] flex-1 truncate">{d.metric}</span>
                <span className="tabular-nums font-medium" style={{
                  color: d.favorable ? BRAND.teal : d.favorable === false ? BRAND.rose : SEMANTIC.neutral,
                }}>
                  {typeof d.delta === "number" ? `${d.delta > 0 ? "+" : ""}${d.delta.toFixed(1)}` : "--"}
                  {d.unit ? ` ${d.unit}` : ""}
                </span>
                {d.scored === false && (
                  <span className="text-[8px] text-[var(--text-dim)]">advisory</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricTable({ data }: { data: Record<string, unknown> }) {
  const rows = (data.rows as Array<{ label: string; value: string }>) || [];

  return (
    <div className="space-y-0">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between py-1.5 border-b border-[var(--border)]/30 last:border-b-0">
          <span className="text-[11px] text-[var(--text-dim)]">{r.label}</span>
          <span className="text-[12px] text-[var(--text-secondary)] tabular-nums font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function AdvisoryNote({ data }: { data: Record<string, unknown> }) {
  const text = data.text as string || "";
  const status = data.status as string || "";
  const verdict = data.verdict as string || "";

  const borderColor = status === "warning" || status === "implausible"
    ? BRAND.amber
    : verdict === "fail"
      ? BRAND.rose
      : verdict === "pass"
        ? BRAND.teal
        : SEMANTIC.neutral;

  return (
    <div className="rounded-lg p-3 text-[12px] text-[var(--text-secondary)] leading-relaxed"
      style={{
        background: `${borderColor}08`,
        borderLeft: `3px solid ${borderColor}60`,
      }}>
      {text}
    </div>
  );
}
