// @ts-nocheck
"use client";

/**
 * CustomChart — renders declarative chart specs from governed engine outputs.
 *
 * Lane 2 (Exploratory): Agent generates the spec, not code.
 * Data must come from existing artifacts — no arbitrary backend access.
 *
 * Supported chart types:
 * - bar: grouped/stacked bar charts
 * - line: line charts with multiple series
 * - radar: radar/spider charts for multi-dimensional comparison
 * - waterfall: waterfall decomposition charts
 * - scatter: scatter plots with optional trend line
 * - table: structured data tables (no chart, just formatted data)
 */

import {
  BarChart, Bar, LineChart, Line, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, ReferenceLine,
} from "recharts";
import {
  SERIES_COLORS as COLORS,
  CHART_GRID,
  CHART_AXIS,
  CHART_TOOLTIP,
  CHART_HEIGHT,
} from "@/lib/chart-theme";
import { ChartCard } from "@/components/simulate/chart-utils";

// ── Chart Spec Types ────────────────────────────────────────

export interface ChartSpec {
  chart_type: "bar" | "line" | "radar" | "scatter" | "waterfall" | "table";
  title: string;
  subtitle?: string;
  data: Array<Record<string, unknown>>;
  x_key: string;
  y_keys: string[];
  y_labels?: Record<string, string>;
  x_label?: string;
  y_label?: string;
  colors?: string[];
  stacked?: boolean;
  reference_lines?: Array<{ value: number; label: string; color?: string }>;
  source_description?: string;
}

export interface CustomChartProps {
  spec: ChartSpec;
  onExpand?: (spec: ChartSpec) => void;
}

// ── Compact Inline Chart ────────────────────────────────────

export function CustomChart({ spec, onExpand }: CustomChartProps) {
  if (!spec || !spec.data || spec.data.length === 0) return null;

  const colors = spec.colors || COLORS;

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--text-primary)]">{spec.title}</div>
          {spec.subtitle && (
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{spec.subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {onExpand && (
            <button
              onClick={() => onExpand(spec)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/5 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2h4v4M6 14H2v-4M14 2L9 7M2 14l5-5"/></svg>
              Expand
            </button>
          )}
          <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-[var(--accent-purple)]/10 text-[var(--accent-purple)] uppercase tracking-wider">
            Analysis
          </span>
        </div>
      </div>

      {/* Chart body */}
      <div className="px-4 py-4">
        <ChartRenderer spec={spec} colors={colors} height={280} />
      </div>

      {/* Source attribution */}
      {spec.source_description && (
        <div className="px-4 py-2 border-t border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)]">
            Source: {spec.source_description}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared Chart Renderer ───────────────────────────────────

export function ChartRenderer({ spec, colors, height = 280 }: { spec: ChartSpec; colors?: string[]; height?: number }) {
  const c = colors || spec.colors || COLORS;
  return (
    <>
      {spec.chart_type === "bar" && <BarView spec={spec} colors={c} height={height} />}
      {spec.chart_type === "line" && <LineView spec={spec} colors={c} height={height} />}
      {spec.chart_type === "radar" && <RadarView spec={spec} colors={c} height={height} />}
      {spec.chart_type === "scatter" && <ScatterView spec={spec} colors={c} height={height} />}
      {spec.chart_type === "waterfall" && <WaterfallView spec={spec} colors={c} height={height} />}
      {spec.chart_type === "table" && <TableView spec={spec} />}
    </>
  );
}

// ── Chart Type Renderers ────────────────────────────────────

function BarView({ spec, colors, height = 280 }: { spec: ChartSpec; colors: string[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={spec.data} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey={spec.x_key} tick={CHART_AXIS.tick} label={spec.x_label ? { value: spec.x_label, position: "bottom", ...CHART_AXIS.label } : undefined} />
        <YAxis tick={CHART_AXIS.tick} label={spec.y_label ? { value: spec.y_label, angle: -90, position: "insideLeft", ...CHART_AXIS.label } : undefined} />
        <Tooltip {...CHART_TOOLTIP} />
        {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {spec.y_keys.map((key, i) => (
          <Bar key={key} dataKey={key} name={spec.y_labels?.[key] || key}
            fill={colors[i % colors.length]} stackId={spec.stacked ? "stack" : undefined}
            radius={[3, 3, 0, 0]} />
        ))}
        {spec.reference_lines?.map((rl, i) => (
          <ReferenceLine key={i} y={rl.value} stroke={rl.color || "var(--accent-amber)"}
            strokeDasharray="4 4" label={{ value: rl.label, fill: "var(--text-muted)", fontSize: 10 }} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function LineView({ spec, colors, height = 280 }: { spec: ChartSpec; colors: string[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={spec.data} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey={spec.x_key} tick={CHART_AXIS.tick} label={spec.x_label ? { value: spec.x_label, position: "bottom", ...CHART_AXIS.label } : undefined} />
        <YAxis tick={CHART_AXIS.tick} label={spec.y_label ? { value: spec.y_label, angle: -90, position: "insideLeft", ...CHART_AXIS.label } : undefined} />
        <Tooltip {...CHART_TOOLTIP} />
        {spec.y_keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {spec.y_keys.map((key, i) => (
          <Line key={key} dataKey={key} name={spec.y_labels?.[key] || key}
            stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} />
        ))}
        {spec.reference_lines?.map((rl, i) => (
          <ReferenceLine key={i} y={rl.value} stroke={rl.color || "var(--accent-amber)"}
            strokeDasharray="4 4" label={{ value: rl.label, fill: "var(--text-muted)", fontSize: 10 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function RadarView({ spec, colors, height = 300 }: { spec: ChartSpec; colors: string[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={spec.data}>
        <PolarGrid stroke={CHART_GRID.stroke} />
        <PolarAngleAxis dataKey={spec.x_key} tick={{ ...CHART_AXIS.tick, fontSize: 9 }} />
        <PolarRadiusAxis tick={{ fill: "#4a5a70", fontSize: 8 }} />
        {spec.y_keys.map((key, i) => (
          <Radar key={key} dataKey={key} name={spec.y_labels?.[key] || key}
            stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.15} />
        ))}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Tooltip {...CHART_TOOLTIP} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function ScatterView({ spec, colors, height = 280 }: { spec: ChartSpec; colors: string[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey={spec.x_key} type="number" tick={CHART_AXIS.tick}
          label={spec.x_label ? { value: spec.x_label, position: "bottom", ...CHART_AXIS.label } : undefined} />
        <YAxis dataKey={spec.y_keys[0]} type="number" tick={CHART_AXIS.tick}
          label={spec.y_label ? { value: spec.y_label, angle: -90, position: "insideLeft", ...CHART_AXIS.label } : undefined} />
        <Tooltip {...CHART_TOOLTIP} />
        <Scatter data={spec.data} fill={colors[0]}>
          {spec.data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Scatter>
        {spec.reference_lines?.map((rl, i) => (
          <ReferenceLine key={i} y={rl.value} stroke={rl.color || "var(--accent-amber)"}
            strokeDasharray="4 4" label={{ value: rl.label, fill: "var(--text-muted)", fontSize: 10 }} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function WaterfallView({ spec, colors, height = 280 }: { spec: ChartSpec; colors: string[]; height?: number }) {
  const yKey = spec.y_keys[0];
  let running = 0;
  const waterfallData = spec.data.map((d) => {
    const val = Number(d[yKey]) || 0;
    const start = running;
    running += val;
    return { ...d, _start: start, _end: running, _value: val };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={waterfallData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey={spec.x_key} tick={CHART_AXIS.tick} />
        <YAxis tick={CHART_AXIS.tick} />
        <Tooltip {...CHART_TOOLTIP} />
        {/* Invisible base bar */}
        <Bar dataKey="_start" stackId="waterfall" fill="transparent" />
        {/* Visible delta bar */}
        <Bar dataKey="_value" stackId="waterfall" radius={[3, 3, 0, 0]}>
          {waterfallData.map((d, i) => (
            <Cell key={i} fill={d._value >= 0 ? "var(--accent-green)" : "var(--accent-red)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TableView({ spec }: { spec: ChartSpec }) {
  const allKeys = [spec.x_key, ...spec.y_keys];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {allKeys.map(k => (
              <th key={k} className="px-3 py-2 text-left text-[var(--text-muted)] font-semibold uppercase tracking-wider text-[10px]">
                {spec.y_labels?.[k] || k.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.data.map((row, i) => (
            <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
              {allKeys.map(k => (
                <td key={k} className="px-3 py-2 text-[var(--text-secondary)]">
                  {typeof row[k] === "number" ? (row[k] as number).toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(row[k] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
