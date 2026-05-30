// @ts-nocheck
"use client";

/**
 * InverterCharts — DC-AC inverter simulation results.
 *
 * Uses unified chart theme from chart-utils / chart-theme.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from "recharts";
import type { InverterSimulationResult } from "@/lib/sim-types";
import {
  COLORS, CHART_MARGIN, CHART_GRID, CHART_AXIS, CHART_HEIGHT, ChartCard,
} from "./chart-utils";
import { CHART_TOOLTIP } from "@/lib/chart-theme";

export function InverterCharts({ result }: { result: InverterSimulationResult }) {
  const { efficiency_vs_load, thermal_derating, efficiency_vs_vdc, metrics } = result;

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Efficiency vs Load — full width */}
      <div className="col-span-2">
        <ChartCard title="Efficiency vs Load">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
            <AreaChart data={efficiency_vs_load} margin={CHART_MARGIN}>
              <defs>
                <linearGradient id="invEffGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS[0]} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="variable" tick={CHART_AXIS.tick} label={{ value: "Load (%)", position: "insideBottom", offset: -2, ...CHART_AXIS.label }} />
              <YAxis tick={CHART_AXIS.tick} domain={["auto", "auto"]} label={{ value: "Efficiency (%)", angle: -90, position: "insideLeft", ...CHART_AXIS.label }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Area type="monotone" dataKey="efficiency_pct" stroke={COLORS[0]} fill="url(#invEffGrad)" strokeWidth={2} name="Efficiency" />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-[10px] text-[var(--text-dim)]">
            <span>Peak = {metrics.peak_efficiency}%</span>
            <span>CEC Weighted = {metrics.cec_weighted}%</span>
            <span>10% Load = {metrics.partial_load_10}%</span>
          </div>
        </ChartCard>
      </div>

      {/* Thermal Derating */}
      <ChartCard title="Thermal Derating \u2014 Max Power vs Temperature">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <AreaChart
            data={thermal_derating.map((p) => ({ ...p, derating_pct: p.derating_factor * 100 }))}
            margin={CHART_MARGIN}
          >
            <defs>
              <linearGradient id="invThermalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[4]} stopOpacity={0.2} />
                <stop offset="95%" stopColor={COLORS[4]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="variable" tick={CHART_AXIS.tick} label={{ value: "Ambient Temp (\u00B0C)", position: "insideBottom", offset: -2, ...CHART_AXIS.label }} />
            <YAxis tick={CHART_AXIS.tick} domain={[0, 105]} label={{ value: "Max Power (%)", angle: -90, position: "insideLeft", ...CHART_AXIS.label }} />
            <Tooltip {...CHART_TOOLTIP} />
            <Area type="monotone" dataKey="derating_pct" stroke={COLORS[4]} fill="url(#invThermalGrad)" strokeWidth={2} name="Max Power %" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Efficiency vs DC Voltage */}
      <ChartCard title="Efficiency vs DC Voltage">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <LineChart data={efficiency_vs_vdc} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="variable" tick={CHART_AXIS.tick} label={{ value: "V_dc (V)", position: "insideBottom", offset: -2, ...CHART_AXIS.label }} />
            <YAxis tick={CHART_AXIS.tick} domain={["auto", "auto"]} label={{ value: "Efficiency (%)", angle: -90, position: "insideLeft", ...CHART_AXIS.label }} />
            <Tooltip {...CHART_TOOLTIP} />
            <Line type="monotone" dataKey="efficiency_pct" stroke={COLORS[1]} strokeWidth={2} dot={{ fill: COLORS[1], r: 3 }} name="Efficiency" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
