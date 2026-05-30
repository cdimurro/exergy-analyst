"use client";

/**
 * DualLCOEDisplay — side-by-side nominal vs exergy-adjusted LCOE/LCOF.
 *
 * Renders the primary (nominal) cost prominently and the exergy-adjusted
 * cost as a secondary value, with a divergence badge when they differ
 * meaningfully (|divergence| > 10%).
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function toneFromDivergence(pct: number | null | undefined): "success" | "warning" | "destructive" | "default" {
  if (pct == null) return "default";
  const abs = Math.abs(pct);
  if (abs < 10) return "success";
  if (abs < 25) return "warning";
  return "destructive";
}

function formatCost(v: number | null | undefined, unit: string): string {
  if (v == null || !isFinite(v)) return "—";
  return `$${v.toFixed(2)}/${unit}`;
}

interface DualLCOEDisplayProps {
  nominal: number | null | undefined;
  exergyAdjusted: number | null | undefined;
  qualityFactor: number | null | undefined;
  divergencePct: number | null | undefined;
  note?: string;
  unit?: string;        // e.g., "GGE" or "MWh"
  metricLabel?: string; // e.g., "LCOF" or "LCOE"
}

export function DualLCOEDisplay({
  nominal,
  exergyAdjusted,
  qualityFactor,
  divergencePct,
  note,
  unit = "GGE",
  metricLabel = "LCOF",
}: DualLCOEDisplayProps) {
  if (nominal == null && exergyAdjusted == null) return null;
  const divTone = toneFromDivergence(divergencePct);
  const divSign = divergencePct != null ? (divergencePct > 0 ? "+" : "") : "";

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {metricLabel} (nominal)
          </p>
          <p className="text-2xl font-bold text-foreground font-mono">
            {formatCost(nominal, unit)}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            {metricLabel} (exergy-adjusted)
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-lg font-semibold text-secondary-foreground font-mono">
              {formatCost(exergyAdjusted, unit)}
            </p>
            {divergencePct != null && (
              <Badge variant={divTone}>
                {divSign}
                {divergencePct.toFixed(1)}%
              </Badge>
            )}
          </div>
        </div>
      </div>

      {qualityFactor != null && (
        <p className="text-[11px] text-muted-foreground mt-3">
          Output quality factor:{" "}
          <span className="font-mono text-secondary-foreground">
            {qualityFactor.toFixed(2)}
          </span>
          {" "}— reflects product thermodynamic quality vs reference-grade output.
        </p>
      )}

      {note && (
        <p
          className={cn(
            "text-xs leading-relaxed mt-2",
            divTone === "destructive" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}
