// @ts-nocheck
"use client";

/**
 * SimCharts — Battery simulation results (4-chart grid).
 *
 * Uses unified chart theme from chart-utils / chart-theme.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from "recharts";
import type { SimulationResult } from "@/lib/battery-sim";
import {
  COLORS, CHART_MARGIN, CHART_GRID, CHART_AXIS, CHART_HEIGHT, ChartCard,
} from "./chart-utils";
import { CHART_TOOLTIP } from "@/lib/chart-theme";

const CRATE_LABELS = ["0.2C", "0.5C", "1.0C", "2.0C", "3.0C"];

export function SimCharts({ result }: { result: SimulationResult }) {
  const dischargeData = buildDischargeMerged(result);
  const thermalData = buildThermalMerged(result);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Discharge Curves */}
      <ChartCard title="Discharge Curves — Voltage vs Capacity">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <LineChart data={dischargeData} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="capacity_mAh"
              tick={CHART_AXIS.tick}
              label={{ value: "Capacity (mAh)", position: "bottom", offset: -2, ...CHART_AXIS.label }}
            />
            <YAxis
              tick={CHART_AXIS.tick}
              domain={[2.4, 3.8]}
              label={{ value: "V", angle: -90, position: "insideLeft", ...CHART_AXIS.label }}
            />
            <Tooltip {...CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {CRATE_LABELS.map((label, i) => (
              <Line
                key={label}
                type="monotone"
                dataKey={`V_${label}`}
                name={label}
                stroke={COLORS[i]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Thermal Profiles */}
      <ChartCard title="Thermal Profile — Temperature vs Time">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <AreaChart data={thermalData} margin={CHART_MARGIN}>
            <defs>
              {COLORS.slice(0, 5).map((c, i) => (
                <linearGradient key={i} id={`simGrad_${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={c} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="time_min"
              tick={CHART_AXIS.tick}
              label={{ value: "Time (min)", position: "bottom", offset: -2, ...CHART_AXIS.label }}
            />
            <YAxis
              tick={CHART_AXIS.tick}
              label={{ value: "\u00B0C", angle: -90, position: "insideLeft", ...CHART_AXIS.label }}
            />
            <Tooltip {...CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {CRATE_LABELS.map((label, i) => (
              <Area
                key={label}
                type="monotone"
                dataKey={`T_${label}`}
                name={label}
                stroke={COLORS[i]}
                fill={`url(#simGrad_${i})`}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Cycle Life */}
      <ChartCard title="Cycle Life — Capacity Retention">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <AreaChart data={result.cycle_life} margin={CHART_MARGIN}>
            <defs>
              <linearGradient id="simGradCycle" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[0]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS[0]} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="simGradResist" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[4]} stopOpacity={0.2} />
                <stop offset="95%" stopColor={COLORS[4]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="cycle"
              tick={CHART_AXIS.tick}
              label={{ value: "Cycles", position: "bottom", offset: -2, ...CHART_AXIS.label }}
            />
            <YAxis
              yAxisId="left"
              tick={CHART_AXIS.tick}
              domain={[60, 100]}
              label={{ value: "%", angle: -90, position: "insideLeft", ...CHART_AXIS.label }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={CHART_AXIS.tick}
              label={{ value: "R growth %", angle: 90, position: "insideRight", ...CHART_AXIS.label }}
            />
            <Tooltip {...CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="retention_pct"
              name="Capacity Retention"
              stroke={COLORS[0]}
              fill="url(#simGradCycle)"
              strokeWidth={2}
              dot={false}
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="resistance_growth_pct"
              name="Resistance Growth"
              stroke={COLORS[4]}
              fill="url(#simGradResist)"
              strokeWidth={1.5}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Rate Capability */}
      <ChartCard title="Rate Capability — Energy & Efficiency">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <LineChart data={result.crate_metrics} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis
              dataKey="cRate"
              tick={CHART_AXIS.tick}
              tickFormatter={(v) => `${v}C`}
              label={{ value: "C-Rate", position: "bottom", offset: -2, ...CHART_AXIS.label }}
            />
            <YAxis
              yAxisId="energy"
              tick={CHART_AXIS.tick}
              label={{ value: "Wh", angle: -90, position: "insideLeft", ...CHART_AXIS.label }}
            />
            <YAxis
              yAxisId="eff"
              orientation="right"
              tick={CHART_AXIS.tick}
              domain={[70, 105]}
              label={{ value: "%", angle: 90, position: "insideRight", ...CHART_AXIS.label }}
            />
            <Tooltip {...CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              yAxisId="energy"
              type="monotone"
              dataKey="energy_Wh"
              name="Energy (Wh)"
              stroke={COLORS[1]}
              strokeWidth={2.5}
              dot={{ r: 4, fill: COLORS[1] }}
            />
            <Line
              yAxisId="eff"
              type="monotone"
              dataKey="efficiency_pct"
              name="Efficiency (%)"
              stroke={COLORS[2]}
              strokeWidth={2.5}
              dot={{ r: 4, fill: COLORS[2] }}
              strokeDasharray="5 5"
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ── Data merging helpers ────────────────────────────────────────

function buildDischargeMerged(result: SimulationResult) {
  const allCap = new Set<number>();
  for (const key of CRATE_LABELS) {
    const pts = result.discharge_curves[key];
    if (pts) pts.forEach((p) => allCap.add(p.capacity_mAh));
  }
  const caps = [...allCap].sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(caps.length / 200));
  const sampled = caps.filter((_, i) => i % step === 0);

  return sampled.map((cap) => {
    const row: Record<string, number | null> = { capacity_mAh: cap };
    for (const key of CRATE_LABELS) {
      const pts = result.discharge_curves[key];
      if (!pts) { row[`V_${key}`] = null; continue; }
      const nearest = pts.reduce((best, p) =>
        Math.abs(p.capacity_mAh - cap) < Math.abs(best.capacity_mAh - cap) ? p : best,
      );
      row[`V_${key}`] = Math.abs(nearest.capacity_mAh - cap) < 50 ? nearest.voltage : null;
    }
    return row;
  });
}

function buildThermalMerged(result: SimulationResult) {
  const allTime = new Set<number>();
  for (const key of CRATE_LABELS) {
    const pts = result.thermal_profiles[key];
    if (pts) pts.forEach((p) => allTime.add(p.time_min));
  }
  const times = [...allTime].sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(times.length / 200));
  const sampled = times.filter((_, i) => i % step === 0);

  return sampled.map((t) => {
    const row: Record<string, number | null> = { time_min: t };
    for (const key of CRATE_LABELS) {
      const pts = result.thermal_profiles[key];
      if (!pts) { row[`T_${key}`] = null; continue; }
      const nearest = pts.reduce((best, p) =>
        Math.abs(p.time_min - t) < Math.abs(best.time_min - t) ? p : best,
      );
      row[`T_${key}`] = Math.abs(nearest.time_min - t) < 5 ? nearest.temperature_C : null;
    }
    return row;
  });
}
