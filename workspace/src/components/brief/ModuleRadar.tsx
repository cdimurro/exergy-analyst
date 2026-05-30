// @ts-nocheck
"use client";

/**
 * ModuleRadar — 10-axis spider chart showing module confidence profile.
 *
 * Each axis represents one of the 10 evaluation modules.
 * Value = confidence (0–100 scale). Supports an optional second dataset
 * for side-by-side technology comparison.
 */

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  BRAND,
  CHART_TOOLTIP,
  MODULE_SHORT_NAMES,
  MODULE_ORDER,
} from "@/lib/chart-theme";

interface ModuleVerdictLike {
  module_name: string;
  confidence: number;
  verdict: string;
  key_detail?: string;
}

interface ModuleRadarProps {
  modules: ModuleVerdictLike[];
  height?: number;
  /** Optional second dataset for comparison overlay. */
  compareModules?: ModuleVerdictLike[];
  compareLabel?: string;
}

function buildRadarData(modules: ModuleVerdictLike[]) {
  const moduleMap = new Map(
    modules.map((m) => [
      MODULE_SHORT_NAMES[m.module_name] || m.module_name,
      m,
    ]),
  );

  return MODULE_ORDER.map((name) => {
    const m = moduleMap.get(name);
    return {
      module: name,
      confidence: m ? Math.round(m.confidence * 100) : 0,
      verdict: m?.verdict || "blocked",
    };
  });
}

function CustomTick({ payload, x, y, cx, cy }: any) {
  const dx = x - cx;
  const dy = y - cy;
  const textAnchor = dx > 5 ? "start" : dx < -5 ? "end" : "middle";
  const yOff = dy > 5 ? 12 : dy < -5 ? -4 : 4;

  return (
    <text
      x={x}
      y={y + yOff}
      textAnchor={textAnchor}
      fill="#8a96a8"
      fontSize={9}
      fontWeight={500}
    >
      {payload.value}
    </text>
  );
}

export function ModuleRadar({
  modules,
  height = 280,
  compareModules,
  compareLabel,
}: ModuleRadarProps) {
  const data = buildRadarData(modules);
  const compareData = compareModules ? buildRadarData(compareModules) : null;

  const mergedData = compareData
    ? data.map((d, i) => ({ ...d, compare: compareData[i].confidence }))
    : data;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={mergedData} cx="50%" cy="50%" outerRadius="68%">
        <PolarGrid stroke="rgba(42, 53, 85, 0.5)" />
        <PolarAngleAxis dataKey="module" tick={<CustomTick />} />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: "#4a5a70", fontSize: 8 }}
          tickCount={5}
        />
        <Tooltip
          {...CHART_TOOLTIP}
          formatter={(value: number, name: string) => [
            `${value}%`,
            name === "compare" ? (compareLabel || "Comparison") : "Confidence",
          ]}
        />
        <Radar
          name="Confidence"
          dataKey="confidence"
          stroke={BRAND.teal}
          fill={BRAND.teal}
          fillOpacity={0.15}
          strokeWidth={2}
        />
        {compareData && (
          <Radar
            name={compareLabel || "Comparison"}
            dataKey="compare"
            stroke={BRAND.blue}
            fill={BRAND.blue}
            fillOpacity={0.08}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        )}
        {compareData && (
          <Legend wrapperStyle={{ fontSize: 10, color: "#8a96a8" }} />
        )}
      </RadarChart>
    </ResponsiveContainer>
  );
}
