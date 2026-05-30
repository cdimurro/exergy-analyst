// @ts-nocheck
"use client";

/**
 * Chart Primitives — shared Recharts 3 wrappers for the Exergy Lab workspace.
 *
 * Every chart component in the workspace should compose from these primitives.
 * They enforce consistent styling, responsive behavior, tooltips, axis labeling,
 * empty/blocked states, and dark-theme compatibility.
 *
 * Built on Recharts 3.8+ with the Exergy Lab chart-theme tokens.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell, ReferenceLine,
} from "recharts";
import { BRAND, SEMANTIC, CHART_TOOLTIP, CHART_GRID, CHART_AXIS, CHART_MARGIN, CHART_HEIGHT } from "@/lib/chart-theme";

// ── Shared Tooltip ──────────────────────────────────────────

export function ChartTooltipContent({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      ...CHART_TOOLTIP.contentStyle,
      minWidth: 120,
    }}>
      {label && <div className="text-[12px] text-[var(--text-dim)] mb-1">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-[12px] text-[var(--text-secondary)]">
            {formatter ? formatter(p.value, p.name) : `${p.name}: ${p.value}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Empty / Blocked State ───────────────────────────────────

export function ChartEmptyState({ message, height = 120 }: { message: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg"
      style={{ height, background: "rgba(42, 53, 85, 0.15)", border: "1px dashed rgba(42, 53, 85, 0.4)" }}
    >
      <span className="text-[15px] text-[var(--text-dim)]">{message}</span>
    </div>
  );
}

// ── Chart Card wrapper ──────────────────────────────────────

export function ChartCard({ title, subtitle, children, className, actions, flat = false }: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
  /**
   * When true, renders as a flat subsection — just a heading row + content,
   * no border or background — so it can live inside a parent section
   * without creating a nested bordered box. Use inside CollapsibleSection
   * content. Defaults to false (card chrome preserved).
   */
  flat?: boolean;
}) {
  if (flat) {
    return (
      <div className={`${className || ""}`}>
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              {title && (
                <h4 className="text-[15px] font-semibold text-[var(--text-primary)] leading-tight tracking-[-0.005em]">
                  {title}
                </h4>
              )}
              {subtitle && (
                <p className="text-[15px] text-[var(--text-dim)] mt-1 leading-relaxed">{subtitle}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 text-[var(--text-dim)]">
              {actions}
            </div>
          </div>
        )}
        {children}
      </div>
    );
  }
  return (
    <div className={`rounded-lg border border-[var(--border)]/80 bg-[var(--bg-secondary)] overflow-hidden ${className || ""}`}>
      {(title || subtitle) && (
        <div className="px-5 py-3.5 border-b border-[var(--border)]/60 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <h4 className="text-[15px] font-semibold text-[var(--text-primary)] leading-tight tracking-[-0.005em]">
                {title}
              </h4>
            )}
            {subtitle && (
              <p className="text-[15px] text-[var(--text-dim)] mt-1 leading-relaxed">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 text-[var(--text-dim)]">
            {actions}
          </div>
        </div>
      )}
      <div className="px-5 py-4">
        {children}
      </div>
    </div>
  );
}

// ── Horizontal Impact Bar Chart ─────────────────────────────

export interface HBarDatum {
  label: string;
  value: number;
  color?: string;
}

export function HorizontalBarChart({ data, height, valueFormatter, barSize = 14 }: {
  data: HBarDatum[];
  height?: number;
  valueFormatter?: (v: number) => string;
  barSize?: number;
}) {
  if (!data.length) return <ChartEmptyState message="No data available" />;
  const maxVal = Math.max(...data.map(d => Math.abs(d.value)));
  const h = height || Math.max(120, data.length * 32 + 20);
  const fmt = valueFormatter || ((v: number) => `${v}`);

  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 50, bottom: 4, left: 100 }}>
        <CartesianGrid horizontal={false} {...CHART_GRID} />
        <XAxis type="number" domain={[0, maxVal * 1.15]} hide />
        <YAxis
          type="category"
          dataKey="label"
          width={95}
          tick={{ fill: "#b8c4dc", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={<ChartTooltipContent formatter={(v: number) => fmt(v)} />}
          cursor={{ fill: "rgba(42, 53, 85, 0.3)" }}
        />
        <Bar dataKey="value" barSize={barSize} radius={[0, 4, 4, 0]} label={{
          position: "right", fill: "#b8c4dc", fontSize: 10, formatter: fmt,
        }}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color || BRAND.blue} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Scenario Range Chart ────────────────────────────────────

export function ScenarioRangeChart({ optimistic, base, pessimistic, unit, label }: {
  optimistic: number;
  base: number;
  pessimistic: number;
  unit: string;
  label?: string;
}) {
  const data = [
    { name: "Optimistic", value: optimistic, color: BRAND.teal },
    { name: "Base", value: base, color: BRAND.blue },
    { name: "Pessimistic", value: pessimistic, color: BRAND.rose },
  ];

  const padding = (pessimistic - optimistic) * 0.08;
  const domain = [Math.max(0, optimistic - padding), pessimistic + padding];

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 45, bottom: 4, left: 80 }}>
          <XAxis type="number" domain={domain} hide />
          <YAxis
            type="category"
            dataKey="name"
            width={75}
            tick={{ fill: "#b8c4dc", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<ChartTooltipContent formatter={(v: number) => `$${v.toFixed(1)} ${unit}`} />}
            cursor={{ fill: "rgba(42, 53, 85, 0.2)" }}
          />
          <Bar dataKey="value" barSize={16} radius={[0, 5, 5, 0]} label={{
            position: "right", fill: "#b8c4dc", fontSize: 10,
            formatter: (v: number) => `$${v.toFixed(1)}`,
          }}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} fillOpacity={0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Comparison Bar (side-by-side) ───────────────────────────

export function ComparisonBarChart({ candidate, incumbent, candidateLabel, incumbentLabel, unit }: {
  candidate: number;
  incumbent: number;
  candidateLabel?: string;
  incumbentLabel?: string;
  unit: string;
}) {
  const isCompetitive = candidate <= incumbent;
  const data = [
    { name: candidateLabel || "Candidate", value: candidate, color: isCompetitive ? BRAND.teal : BRAND.rose },
    { name: incumbentLabel || "Incumbent", value: incumbent, color: SEMANTIC.neutral },
  ];
  const maxVal = Math.max(candidate, incumbent);

  return (
    <ResponsiveContainer width="100%" height={72}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 50, bottom: 4, left: 80 }}>
        <XAxis type="number" domain={[0, maxVal * 1.2]} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={75}
          tick={{ fill: "#b8c4dc", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={<ChartTooltipContent formatter={(v: number) => `$${v.toFixed(1)} ${unit}`} />}
          cursor={{ fill: "rgba(42, 53, 85, 0.2)" }}
        />
        <Bar dataKey="value" barSize={18} radius={[0, 5, 5, 0]} label={{
          position: "right", fill: "#b8c4dc", fontSize: 10,
          formatter: (v: number) => `$${v.toFixed(1)}`,
        }}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── System LCOE Stacked View ────────────────────────────────

export function SystemLCOEChart({ standaloneLCOE, curtailmentAdder, integrationCost, unit }: {
  standaloneLCOE: number;
  curtailmentAdder: number;
  integrationCost: number;
  unit: string;
}) {
  const data = [{
    name: "Cost Breakdown",
    standalone: standaloneLCOE,
    curtailment: curtailmentAdder,
    integration: integrationCost,
  }];
  const total = standaloneLCOE + curtailmentAdder + integrationCost;

  return (
    <div>
      <ResponsiveContainer width="100%" height={50}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 50, bottom: 4, left: 0 }}>
          <XAxis type="number" domain={[0, total * 1.1]} hide />
          <YAxis type="category" dataKey="name" hide />
          <Tooltip
            content={<ChartTooltipContent formatter={(v: number, name: string) => {
              const labels: Record<string, string> = {
                standalone: "Stand-alone LCOE",
                curtailment: "Curtailment adder",
                integration: "Integration cost",
              };
              return `${labels[name] || name}: $${v.toFixed(1)} ${unit}`;
            }} />}
            cursor={false}
          />
          <Bar dataKey="standalone" stackId="a" fill={BRAND.blue} fillOpacity={0.8} barSize={22} radius={[4, 0, 0, 4]} />
          <Bar dataKey="curtailment" stackId="a" fill={BRAND.amber} fillOpacity={0.7} barSize={22} />
          <Bar dataKey="integration" stackId="a" fill={BRAND.rose} fillOpacity={0.6} barSize={22} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-1 text-[12px]">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: BRAND.blue }} /> LCOE</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: BRAND.amber }} /> Curtailment</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: BRAND.rose }} /> Integration</span>
        <span className="ml-auto font-medium text-[var(--text-secondary)]">Total: ${total.toFixed(1)} {unit}</span>
      </div>
    </div>
  );
}

// ── Green Premium Comparison ────────────────────────────────

export function GreenPremiumChart({ greenCost, conventionalCost, premium, unit }: {
  greenCost: number;
  conventionalCost: number;
  premium: number;
  unit: string;
}) {
  const data = [
    { name: "Green", value: greenCost, color: BRAND.teal },
    { name: "Conventional", value: conventionalCost, color: SEMANTIC.neutral },
  ];
  const maxVal = Math.max(greenCost, conventionalCost);

  return (
    <div>
      <ResponsiveContainer width="100%" height={72}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 50, bottom: 4, left: 80 }}>
          <XAxis type="number" domain={[0, maxVal * 1.2]} hide />
          <YAxis type="category" dataKey="name" width={75}
            tick={{ fill: "#b8c4dc", fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            content={<ChartTooltipContent formatter={(v: number) => `$${v.toFixed(0)} ${unit}`} />}
            cursor={{ fill: "rgba(42, 53, 85, 0.2)" }}
          />
          <Bar dataKey="value" barSize={18} radius={[0, 5, 5, 0]} label={{
            position: "right", fill: "#b8c4dc", fontSize: 10,
            formatter: (v: number) => `$${v.toFixed(0)}`,
          }}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="text-[12px] text-[var(--text-dim)] mt-0.5">
        Green premium: <span className="font-medium" style={{ color: premium > 0 ? BRAND.rose : BRAND.teal }}>
          ${premium > 0 ? "+" : ""}{premium.toFixed(0)}/ton ({((premium / conventionalCost) * 100).toFixed(0)}%)
        </span>
      </div>
    </div>
  );
}
