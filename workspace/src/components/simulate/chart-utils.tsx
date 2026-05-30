"use client";

/**
 * Chart utilities — re-exports unified theme constants and provides
 * the shared ChartCard wrapper component.
 *
 * All chart components should import from here (or directly from chart-theme).
 * This file exists for backward compatibility and the ChartCard component.
 */

export {
  SERIES_COLORS as COLORS,
  CHART_MARGIN,
  CHART_TOOLTIP as tooltipStyle,
  CHART_GRID,
  CHART_AXIS,
  CHART_LEGEND,
  CHART_HEIGHT,
  BRAND,
  SEMANTIC,
  SERIES_COLORS,
  scoreColor,
  verdictColor,
} from "@/lib/chart-theme";

import { CHART_TOOLTIP } from "@/lib/chart-theme";

// Re-export tooltip as the spread-friendly shape chart components expect
export const tooltipProps = CHART_TOOLTIP;

export function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 print-avoid-break">
      <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      {children}
    </div>
  );
}
