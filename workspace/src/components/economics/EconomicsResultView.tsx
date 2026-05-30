// @ts-nocheck
"use client";

/**
 * EconomicsResultView — Recharts 3 powered economics dashboard.
 *
 * Visual hierarchy (scan order):
 *   1. KEY RESULT    — Primary metric + mode badge + scenario range chart
 *   2. COMPARISON    — Incumbent bar chart + system LCOE stacked view
 *   3. RISK          — Sensitivity tornado + green premium
 *   4. ASSUMPTIONS   — CAPEX breakdown + provenance footer
 *
 * Special paths:
 *   - Benchmark envelope: literature range with advisory framing
 *   - Infrastructure add-on: delivery labeling
 *   - Blocked: missing-inputs guidance
 */

import { BRAND, SEMANTIC } from "@/lib/chart-theme";
import { StatusBadge } from "@/components/ui/custom/StatusBadge";
import {
  ChartCard,
  ChartEmptyState,
  HorizontalBarChart,
  ScenarioRangeChart,
  ComparisonBarChart,
  SystemLCOEChart,
  GreenPremiumChart,
} from "@/components/charts/ChartPrimitives";
import type { HBarDatum } from "@/components/charts/ChartPrimitives";

// ── Types (re-exported for consumers) ───────────────────────

export interface EconomicsData {
  economic_metric?: string;
  metric_unit?: string;
  provenance?: {
    economics_mode?: string;
    config_maturity?: string;
    explicit_input_count?: number;
    defaulted_input_count?: number;
    boundary_declared?: number;
    boundary_total?: number;
    missing_critical_inputs?: string[];
  };
  incumbent_comparison?: {
    segment?: string;
    incumbent_value?: number;
    incumbent_unit?: string;
    incumbent_source?: string;
    candidate_value?: number;
    delta_pct?: number;
    is_competitive?: boolean;
  } | null;
  sensitivity_tornado?: Array<{
    param: string;
    swing: number;
    low_metric?: number;
    high_metric?: number;
  }>;
  assumptions?: {
    project_lifetime_years?: number;
    discount_rate?: number;
    variable_cost_per_unit?: number;
  };
  capex_breakdown?: Record<string, number>;
  system_lcoe_base?: number;
  system_lcoe_optimistic?: number;
  system_lcoe_pessimistic?: number;
  system_adjustment?: {
    curtailment_rate?: number;
    integration_cost_per_mwh?: number;
    capacity_credit?: number;
    sources?: string[];
    note?: string;
  };
  infrastructure_addon?: boolean;
  addon_note?: string;
  delivery_commodity?: string;
  distance_km?: number;
  advisory_only?: boolean;
  literature_range_min?: number;
  literature_range_max?: number;
  literature_range_unit?: string;
  literature_sources?: string[];
  literature_vintage?: string;
  literature_notes?: string;
  co2_accounting_type?: string;
  green_premium_per_ton?: number;
  green_premium_pct?: number;
  conventional_cost_per_ton?: number;
  [key: string]: unknown;
}

interface EconomicsResultViewProps {
  data: EconomicsData;
  verdict?: string;
  score?: number;
  confidence?: number;
  compact?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  computed:           { label: "Computed",         color: BRAND.teal },
  estimated:          { label: "Estimated",        color: BRAND.amber },
  benchmark_only:     { label: "Benchmark Only",   color: SEMANTIC.neutral },
  blocked:            { label: "Blocked",          color: BRAND.rose },
  benchmark_envelope: { label: "Literature Range", color: BRAND.purple },
};

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "--";
  if (Math.abs(v) >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${v.toFixed(decimals)}`;
}

function pct(v: number | null | undefined): string {
  if (v == null) return "--";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function metricKey(label: string): string {
  return label.toLowerCase().replace(/ /g, "_");
}

function ModeBadge({ mode }: { mode: string }) {
  const cfg = MODE_LABELS[mode] || MODE_LABELS.blocked;
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
      {cfg.label}
    </span>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-[var(--border)]/50 last:border-b-0">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      <div className="text-right">
        <span className="text-[13px] font-medium text-[var(--text-primary)] tabular-nums">{value}</span>
        {sub && <span className="text-[10px] text-[var(--text-dim)] ml-1">{sub}</span>}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

export function EconomicsResultView({ data, verdict, score, confidence, compact }: EconomicsResultViewProps) {
  const mode = data.provenance?.economics_mode || "";
  const label = data.economic_metric || "Economics";
  const unit = data.metric_unit || "";
  const mk = metricKey(label);

  // ── BENCHMARK ENVELOPE PATH ───────────────────────────────
  if (data.advisory_only) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-bold text-[var(--text-primary)]">{label}</span>
          <ModeBadge mode="benchmark_envelope" />
        </div>

        {/* Literature range hero */}
        <div className="rounded-xl p-5"
          style={{ background: "linear-gradient(135deg, rgba(136,120,184,0.06) 0%, rgba(91,141,217,0.04) 100%)",
                   border: "1px solid rgba(136,120,184,0.15)" }}>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">
              {fmt(data.literature_range_min)}--{fmt(data.literature_range_max)}
            </span>
            <span className="text-[14px] text-[var(--text-muted)]">{data.literature_range_unit || unit}</span>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed max-w-prose">
            Advisory only -- no validated TEA model exists for this technology.
            This range reflects published literature estimates, not a candidate-specific computation.
          </p>
          {data.literature_vintage && (
            <div className="mt-2 text-[10px] text-[var(--text-dim)]">Data vintage: {data.literature_vintage}</div>
          )}
        </div>

        {/* Sources */}
        {data.literature_sources && data.literature_sources.length > 0 && (
          <ChartCard title="Sources">
            <ul className="space-y-1 pt-1">
              {data.literature_sources.map((s, i) => (
                <li key={i} className="text-[11px] text-[var(--text-dim)] flex gap-1.5">
                  <span className="text-[var(--text-dim)]/60 shrink-0">{i + 1}.</span>{s}
                </li>
              ))}
            </ul>
          </ChartCard>
        )}

        {data.literature_notes && (
          <p className="text-[11px] text-[var(--text-dim)] italic leading-relaxed px-1">{data.literature_notes}</p>
        )}
      </div>
    );
  }

  // ── BLOCKED PATH ──────────────────────────────────────────
  const base = data[`${mk}_base`] as number | undefined;
  const optimistic = data[`${mk}_optimistic`] as number | undefined;
  const pessimistic = data[`${mk}_pessimistic`] as number | undefined;

  if (base == null) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-bold text-[var(--text-primary)]">{label}</span>
          <ModeBadge mode={mode || "blocked"} />
        </div>
        <ChartEmptyState
          message={mode === "blocked"
            ? `Cannot compute -- missing: ${(data.provenance?.missing_critical_inputs || []).join(", ") || "critical inputs"}`
            : "No economics result available for this domain"}
          height={100}
        />
      </div>
    );
  }

  // ── COMPUTED / ESTIMATED / BENCHMARK_ONLY PATH ────────────

  // Prepare sensitivity data for tornado chart
  const tornadoData: HBarDatum[] = (data.sensitivity_tornado || []).slice(0, 6).map((d) => ({
    label: d.param,
    value: d.swing,
    color: BRAND.blue,
  }));

  // Compute system LCOE adders
  const hasSystemLCOE = data.system_lcoe_base != null && data.system_adjustment;
  let curtailmentAdder = 0;
  let integrationCost = 0;
  if (hasSystemLCOE) {
    const curtRate = data.system_adjustment!.curtailment_rate || 0;
    curtailmentAdder = base / (1 - curtRate) - base;
    integrationCost = data.system_adjustment!.integration_cost_per_mwh || 0;
  }

  return (
    <div className="space-y-4">

      {/* ════════════════════════════════════════════════════════
          1. KEY RESULT — Primary metric + scenario chart
          ════════════════════════════════════════════════════════ */}
      <div>
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[16px] font-bold text-[var(--text-primary)]">{label}</span>
          <ModeBadge mode={mode} />
          {data.infrastructure_addon && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: `${BRAND.cyan}18`, color: BRAND.cyan, border: `1px solid ${BRAND.cyan}30` }}>
              Delivery Add-on
            </span>
          )}
          {data.co2_accounting_type && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: `${BRAND.sage}18`, color: BRAND.sage, border: `1px solid ${BRAND.sage}30` }}>
              CO2 {data.co2_accounting_type}
            </span>
          )}
        </div>

        {/* Hero metric */}
        <div className="rounded-xl p-4"
          style={{ background: "linear-gradient(135deg, rgba(77,184,164,0.04) 0%, rgba(91,141,217,0.04) 100%)",
                   border: "1px solid rgba(77,184,164,0.10)" }}>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-bold tabular-nums text-[var(--text-primary)]">{fmt(base)}</span>
            <span className="text-[14px] text-[var(--text-muted)]">{unit}</span>
            {data.incumbent_comparison?.delta_pct != null && (
              <span className="text-[12px] font-medium tabular-nums ml-2"
                style={{ color: data.incumbent_comparison.is_competitive ? BRAND.teal : BRAND.rose }}>
                {pct(data.incumbent_comparison.delta_pct)} vs {data.incumbent_comparison.segment}
              </span>
            )}
          </div>

          {/* Scenario range chart */}
          {optimistic != null && pessimistic != null && (
            <ScenarioRangeChart
              optimistic={optimistic} base={base} pessimistic={pessimistic}
              unit={unit} label={label}
            />
          )}

          {data.infrastructure_addon && data.addon_note && (
            <p className="text-[10px] text-[var(--text-dim)] mt-2 italic">{data.addon_note}</p>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          2. COMPARISON — Incumbent + System LCOE
          ════════════════════════════════════════════════════════ */}

      {/* Incumbent comparison chart */}
      {data.incumbent_comparison && data.incumbent_comparison.incumbent_value != null &&
       data.incumbent_comparison.candidate_value != null && (
        <ChartCard title="Incumbent Comparison"
          subtitle={data.incumbent_comparison.incumbent_source || undefined}>
          <ComparisonBarChart
            candidate={data.incumbent_comparison.candidate_value}
            incumbent={data.incumbent_comparison.incumbent_value}
            candidateLabel={label}
            incumbentLabel={data.incumbent_comparison.segment || "Incumbent"}
            unit={unit}
          />
        </ChartCard>
      )}

      {/* System LCOE stacked breakdown */}
      {hasSystemLCOE && (
        <ChartCard title="System-Adjusted LCOE"
          subtitle={`Stand-alone: ${fmt(base)} | System: ${fmt(data.system_lcoe_base)} ${unit}`}>
          <SystemLCOEChart
            standaloneLCOE={base}
            curtailmentAdder={Math.round(curtailmentAdder * 10) / 10}
            integrationCost={integrationCost}
            unit={unit}
          />
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div>
              <span className="text-[var(--text-dim)]">Curtailment</span>
              <div className="font-medium text-[var(--text-secondary)]">
                {((data.system_adjustment!.curtailment_rate || 0) * 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Integration</span>
              <div className="font-medium text-[var(--text-secondary)]">
                {fmt(data.system_adjustment!.integration_cost_per_mwh)}/MWh
              </div>
            </div>
            <div>
              <span className="text-[var(--text-dim)]">Capacity credit</span>
              <div className="font-medium text-[var(--text-secondary)]">
                {((data.system_adjustment!.capacity_credit || 0) * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </ChartCard>
      )}

      {/* Green premium chart */}
      {data.green_premium_per_ton != null && data.conventional_cost_per_ton != null && base != null && (
        <ChartCard title="Green Premium vs Conventional">
          <GreenPremiumChart
            greenCost={base}
            conventionalCost={data.conventional_cost_per_ton}
            premium={data.green_premium_per_ton}
            unit="/ton"
          />
        </ChartCard>
      )}

      {/* ════════════════════════════════════════════════════════
          3. RISK — Sensitivity tornado
          ════════════════════════════════════════════════════════ */}
      {!compact && tornadoData.length > 0 && (
        <ChartCard title="Sensitivity Drivers" subtitle="Impact on base metric (swing width)">
          <HorizontalBarChart
            data={tornadoData}
            valueFormatter={(v) => fmt(v)}
          />
        </ChartCard>
      )}

      {/* ════════════════════════════════════════════════════════
          4. ASSUMPTIONS — CAPEX + provenance
          ════════════════════════════════════════════════════════ */}
      {!compact && data.capex_breakdown && Object.keys(data.capex_breakdown).length > 0 && (
        <ChartCard title="CAPEX Breakdown">
          <HorizontalBarChart
            data={Object.entries(data.capex_breakdown).map(([name, value]) => ({
              label: name.replace(/_/g, " "),
              value,
              color: BRAND.cyan,
            }))}
            valueFormatter={(v) => fmt(v)}
            barSize={12}
          />
        </ChartCard>
      )}

      {!compact && data.assumptions && (
        <ChartCard title="Key Assumptions">
          {data.assumptions.project_lifetime_years != null && (
            <MetricRow label="Project lifetime" value={`${data.assumptions.project_lifetime_years} years`} />
          )}
          {data.assumptions.discount_rate != null && (
            <MetricRow label="Discount rate" value={`${(data.assumptions.discount_rate * 100).toFixed(0)}%`} />
          )}
          {data.assumptions.variable_cost_per_unit != null && (
            <MetricRow label="Variable cost" value={fmt(data.assumptions.variable_cost_per_unit)} sub={`/${unit.replace("$/", "")}`} />
          )}
        </ChartCard>
      )}

      {/* Provenance footer */}
      {data.provenance && (
        <div className="flex items-center gap-3 flex-wrap text-[10px] text-[var(--text-dim)] pt-2 border-t border-[var(--border)]/30">
          <span>
            {data.provenance.explicit_input_count ?? 0} explicit / {data.provenance.defaulted_input_count ?? 0} defaulted
          </span>
          {data.provenance.boundary_declared != null && (
            <span>{data.provenance.boundary_declared}/{data.provenance.boundary_total} boundaries</span>
          )}
          {data.provenance.config_maturity && (
            <span className="capitalize">{data.provenance.config_maturity}</span>
          )}
          {confidence != null && (
            <span className="ml-auto">Confidence: {(confidence * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline Card Variant ─────────────────────────────────────

export function EconomicsCard({ data, verdict, onOpenDetails }: {
  data: EconomicsData;
  verdict?: string;
  onOpenDetails?: () => void;
}) {
  const mode = data.provenance?.economics_mode || "";
  const modeConfig = MODE_LABELS[mode] || MODE_LABELS.blocked;
  const label = data.economic_metric || "Economics";
  const unit = data.metric_unit || "";
  const mk = metricKey(label);

  if (data.advisory_only) {
    return (
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
            <ModeBadge mode="benchmark_envelope" />
          </div>
          {onOpenDetails && (
            <button onClick={onOpenDetails} className="text-[11px] text-[var(--accent-blue)] hover:underline">
              View Details
            </button>
          )}
        </div>
        <p className="text-[13px] text-[var(--text-secondary)] mt-1">
          {fmt(data.literature_range_min)}--{fmt(data.literature_range_max)} {data.literature_range_unit || unit}
        </p>
      </div>
    );
  }

  const base = data[`${mk}_base`] as number | undefined;

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
          <ModeBadge mode={mode} />
          {data.infrastructure_addon && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{ background: `${BRAND.cyan}18`, color: BRAND.cyan }}>
              Add-on
            </span>
          )}
        </div>
        {onOpenDetails && base != null && (
          <button onClick={onOpenDetails} className="text-[11px] text-[var(--accent-blue)] hover:underline">
            View Details
          </button>
        )}
      </div>
      {base != null ? (
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{fmt(base)}</span>
          <span className="text-[12px] text-[var(--text-muted)]">{unit}</span>
          {data.incumbent_comparison?.delta_pct != null && (
            <span className="text-[11px] tabular-nums" style={{
              color: data.incumbent_comparison.is_competitive ? BRAND.teal : BRAND.rose
            }}>
              {pct(data.incumbent_comparison.delta_pct)} vs {data.incumbent_comparison.segment}
            </span>
          )}
          {data.system_lcoe_base != null && (
            <span className="text-[11px] text-[var(--text-dim)]">
              | System: {fmt(data.system_lcoe_base)}
            </span>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-[var(--text-secondary)] mt-1">
          {mode === "blocked" ? "Missing critical inputs" : "No result available"}
        </p>
      )}
    </div>
  );
}
