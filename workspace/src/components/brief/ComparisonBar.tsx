"use client";

/**
 * ComparisonBar — horizontal bar showing a value's position relative to baseline.
 *
 * Used in the "How Your Data Compares" section of BriefDetail to visually
 * represent where user-provided parameters fall vs. published baselines.
 */

import { BRAND, SEMANTIC } from "@/lib/chart-theme";

interface ComparisonBarProps {
  parameter: string;
  yourValue: string | number;
  baselineValue: string | number;
  assessment?: string;
  position?: string;
}

function assessmentColor(assessment?: string): string {
  if (!assessment) return SEMANTIC.neutral;
  const a = assessment.toLowerCase();
  if (a.includes("strong") || a.includes("above") || a.includes("exceeds")) return BRAND.teal;
  if (a.includes("below") || a.includes("concern") || a.includes("weak")) return BRAND.rose;
  if (a.includes("comparable") || a.includes("at baseline") || a.includes("meets")) return BRAND.blue;
  return SEMANTIC.neutral;
}

function estimateFillPct(yourValue: string | number, baselineValue: string | number): number {
  const parse = (v: string | number): number => {
    if (typeof v === "number") return v;
    const cleaned = String(v).replace(/[^0-9.\-]/g, "");
    return parseFloat(cleaned) || 0;
  };
  const y = parse(yourValue);
  const b = parse(baselineValue);
  if (b === 0) return 50;
  const ratio = y / b;
  return Math.max(8, Math.min(92, ratio * 50));
}

export function ComparisonBar({
  parameter,
  yourValue,
  baselineValue,
  assessment,
  position,
}: ComparisonBarProps) {
  const color = assessmentColor(assessment);
  const fillPct = estimateFillPct(yourValue, baselineValue);

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[var(--border)] last:border-b-0">
      {/* Parameter name */}
      <div className="w-[30%] shrink-0">
        <span className="text-[12px] text-[var(--text-secondary)] capitalize">
          {(typeof parameter === "string" ? parameter : "").replace(/_/g, " ")}
        </span>
      </div>

      {/* Visual bar */}
      <div className="flex-1 relative h-2.5">
        {/* Track */}
        <div className="absolute inset-0 rounded-full bg-[var(--border)]" style={{ opacity: 0.2 }} />
        {/* Fill */}
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${fillPct}%`, backgroundColor: color, opacity: 0.7 }}
        />
        {/* Baseline marker at 50% */}
        <div
          className="absolute top-[-2px] h-[calc(100%+4px)] w-[1.5px] rounded-full"
          style={{ left: "50%", backgroundColor: "var(--text-dim)", opacity: 0.5 }}
        />
      </div>

      {/* Values */}
      <div className="w-[32%] shrink-0 flex items-center justify-end gap-2">
        <span className="font-mono text-[11px] font-semibold" style={{ color }}>
          {yourValue}
        </span>
        <span className="text-[10px] text-[var(--text-dim)]">vs {baselineValue}</span>
      </div>
    </div>
  );
}

/** Compact list of comparison bars with overflow indicator. */
export function ComparisonBarList({
  comparisons,
  max = 10,
}: {
  comparisons: Array<{
    parameter: string;
    your_value: any;
    baseline_value: any;
    assessment?: string;
    position?: string;
  }>;
  max?: number;
}) {
  if (!comparisons?.length) return null;
  const shown = comparisons.slice(0, max);
  const remaining = comparisons.length - max;

  return (
    <div>
      {shown.map((bc, i) => (
        <ComparisonBar
          key={i}
          parameter={bc.parameter}
          yourValue={bc.your_value}
          baselineValue={bc.baseline_value}
          assessment={bc.assessment}
          position={bc.position}
        />
      ))}
      {remaining > 0 && (
        <p className="text-[10px] text-[var(--text-dim)] mt-2 text-right">
          +{remaining} more comparisons
        </p>
      )}
    </div>
  );
}
