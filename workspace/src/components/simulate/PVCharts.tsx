// @ts-nocheck
"use client";

/**
 * PVCharts — Photovoltaic simulation results (2x2 grid).
 *
 * Uses unified chart theme from chart-utils / chart-theme.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceDot,
} from "recharts";
import type { PVSimulationResult } from "@/lib/sim-types";
import {
  COLORS, CHART_MARGIN, CHART_GRID, CHART_AXIS, CHART_HEIGHT, ChartCard,
} from "./chart-utils";
import { CHART_TOOLTIP } from "@/lib/chart-theme";

export function PVCharts({ result }: { result: PVSimulationResult }) {
  const { iv_curve, irradiance_sweep, temp_sweep, metrics } = result;

  const pvData = iv_curve.map((p) => ({
    voltage: p.voltage,
    power: p.power,
    current: p.current,
  }));

  const mppIdx = pvData.reduce((best, cur, i) => (cur.power > pvData[best].power ? i : best), 0);
  const mpp = pvData[mppIdx];

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* I-V Curve */}
      <ChartCard title="I-V Curve \u2014 Current vs Voltage">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <LineChart data={pvData} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="voltage" tick={CHART_AXIS.tick} label={{ value: "Voltage (V)", position: "insideBottom", offset: -2, ...CHART_AXIS.label }} />
            <YAxis tick={CHART_AXIS.tick} label={{ value: "Current (A)", angle: -90, position: "insideLeft", ...CHART_AXIS.label }} />
            <Tooltip {...CHART_TOOLTIP} />
            <Line type="monotone" dataKey="current" stroke={COLORS[0]} strokeWidth={2} dot={false} name="Current" />
            {mpp && <ReferenceDot x={mpp.voltage} y={mpp.current} r={5} fill={COLORS[3]} stroke="white" strokeWidth={1} />}
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-[10px] text-[var(--text-dim)]">
          <span>Isc = {metrics.Isc} A</span>
          <span>Voc = {metrics.Voc} V</span>
          <span>MPP = {metrics.Vmp}V / {metrics.Imp}A</span>
        </div>
      </ChartCard>

      {/* P-V Curve */}
      <ChartCard title="P-V Curve \u2014 Power vs Voltage">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <AreaChart data={pvData} margin={CHART_MARGIN}>
            <defs>
              <linearGradient id="pvPowerGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[1]} stopOpacity={0.2} />
                <stop offset="95%" stopColor={COLORS[1]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="voltage" tick={CHART_AXIS.tick} label={{ value: "Voltage (V)", position: "insideBottom", offset: -2, ...CHART_AXIS.label }} />
            <YAxis tick={CHART_AXIS.tick} label={{ value: "Power (W)", angle: -90, position: "insideLeft", ...CHART_AXIS.label }} />
            <Tooltip {...CHART_TOOLTIP} />
            <Area type="monotone" dataKey="power" stroke={COLORS[1]} fill="url(#pvPowerGrad)" strokeWidth={2} name="Power" />
            {mpp && <ReferenceDot x={mpp.voltage} y={mpp.power} r={5} fill={COLORS[3]} stroke="white" strokeWidth={1} />}
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-[10px] text-[var(--text-dim)]">
          <span>Pmax = {metrics.Pmax} W</span>
          <span>FF = {metrics.fill_factor}</span>
          <span>\u03B7 = {metrics.efficiency}%</span>
        </div>
      </ChartCard>

      {/* Irradiance Response */}
      <ChartCard title="Irradiance Response \u2014 Pmax vs Irradiance">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <LineChart data={irradiance_sweep} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="variable" tick={CHART_AXIS.tick} label={{ value: "Irradiance (W/m\u00B2)", position: "insideBottom", offset: -2, ...CHART_AXIS.label }} />
            <YAxis tick={CHART_AXIS.tick} label={{ value: "Pmax (W)", angle: -90, position: "insideLeft", ...CHART_AXIS.label }} />
            <Tooltip {...CHART_TOOLTIP} />
            <Line type="monotone" dataKey="Pmax" stroke={COLORS[0]} strokeWidth={2} dot={{ fill: COLORS[0], r: 3 }} name="Pmax" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Temperature Response */}
      <ChartCard title="Temperature Response \u2014 Pmax vs Cell Temperature">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.inline}>
          <LineChart data={temp_sweep} margin={CHART_MARGIN}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="variable" tick={CHART_AXIS.tick} label={{ value: "Temperature (\u00B0C)", position: "insideBottom", offset: -2, ...CHART_AXIS.label }} />
            <YAxis tick={CHART_AXIS.tick} label={{ value: "Pmax (W)", angle: -90, position: "insideLeft", ...CHART_AXIS.label }} />
            <Tooltip {...CHART_TOOLTIP} />
            <Line type="monotone" dataKey="Pmax" stroke={COLORS[3]} strokeWidth={2} dot={{ fill: COLORS[3], r: 3 }} name="Pmax" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
