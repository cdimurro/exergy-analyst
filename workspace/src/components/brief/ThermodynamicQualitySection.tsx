"use client";

/**
 * ThermodynamicQualitySection — dedicated exergy analysis view in the brief.
 *
 * Shows:
 *  - Plain-English summary (3-5 sentences for non-experts)
 *  - η_II gauge (large, color-coded vs domain ceiling)
 *  - Quality factor + carrier type
 *  - Destruction map (top 3 loss mechanisms as HorizontalBarChart)
 *  - Headroom vs family ceiling
 *  - Technical detail (expandable for specialists)
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreGauge } from "./ScoreGauge";
import { HorizontalBarChart } from "@/components/charts/ChartPrimitives";
import type { ThermodynamicAxis } from "@/lib/brief-types";
import { cn } from "@/lib/utils";
import { Gauge } from "lucide-react";

interface Props {
  axis?: ThermodynamicAxis;
  summaryPlain?: string;
  secondLawEfficiency?: number | null;
  exergyCeiling?: number | null;
  exergyHeadroom?: number | null;
  destructionMap?: Array<{
    mechanism: string;
    destruction_Wh: number;
    fraction_of_input: number;
  }>;
  carrierType?: string;
  qualityFactor?: number | null;
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function humanizeMechanism(m: string): string {
  return m
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ThermodynamicQualitySection({
  axis,
  summaryPlain,
  secondLawEfficiency,
  exergyCeiling,
  exergyHeadroom,
  destructionMap,
  carrierType,
  qualityFactor,
}: Props) {
  const [showTechnical, setShowTechnical] = useState(false);

  // If no axis data at all, don't render
  if (!axis && !summaryPlain && secondLawEfficiency == null) return null;

  const verdict = axis?.verdict || "exergy_unknown";
  const eta_II = secondLawEfficiency ?? axis?.second_law_efficiency;
  const ceiling = exergyCeiling ?? axis?.exergy_ceiling;
  const headroom = exergyHeadroom ?? axis?.exergy_headroom;
  const dmap = destructionMap || axis?.destruction_map || [];
  const carrier = carrierType || axis?.carrier_type;
  const qf = qualityFactor ?? axis?.quality_factor;

  // Gauge score: eta_II as 0-100
  const eta_II_pct = eta_II != null ? Math.round(eta_II * 100) : null;
  const ceiling_pct = ceiling != null ? Math.round(ceiling * 100) : null;

  // Destruction map → HorizontalBarChart data
  const barData = dmap.slice(0, 3).map((d) => ({
    label: humanizeMechanism(d.mechanism),
    value: Math.round((d.fraction_of_input || 0) * 1000) / 10, // % with 1 decimal
  }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          Thermodynamic Quality (Exergy Analysis)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {summaryPlain && (
          <p className="text-sm text-secondary-foreground leading-relaxed mb-4">
            {summaryPlain}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
          {/* Left: eta_II gauge + ceiling/headroom */}
          <div className="flex flex-col items-center justify-center gap-2">
            {eta_II_pct != null ? (
              <>
                <ScoreGauge score={eta_II_pct} size={100} strokeWidth={7} />
                <p className="text-[11px] text-muted-foreground">
                  Second-law efficiency (η<sub>II</sub>)
                </p>
                {ceiling_pct != null && (
                  <p className="text-[11px] text-muted-foreground">
                    Family ceiling: {ceiling_pct}% · headroom{" "}
                    {headroom != null ? `+${(headroom * 100).toFixed(0)}pp` : "—"}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Exergy analysis not computed for this domain.
              </p>
            )}
          </div>

          {/* Right: destruction map */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Exergy Destruction Map (top 3)
            </p>
            {barData.length > 0 ? (
              <HorizontalBarChart
                data={barData}
                valueFormatter={(v) => `${v.toFixed(1)}% of input`}
                barSize={14}
                height={140}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Destruction decomposition not available.
              </p>
            )}
          </div>
        </div>

        {/* Verdict + gaps */}
        {axis && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Thermodynamic Quality Verdict
              </p>
              {axis.evidence_tier && (
                <span className="text-[10px] font-mono text-muted-foreground/70">
                  {axis.evidence_tier}
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              {(axis.verdict || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </p>
            {axis.basis && (
              <p className="text-xs text-secondary-foreground leading-relaxed">{axis.basis}</p>
            )}
            {axis.gaps && axis.gaps.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1">
                  Gaps
                </p>
                <ul className="space-y-0.5">
                  {axis.gaps.slice(0, 3).map((g, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground leading-snug">
                      • {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Technical detail (collapsible) */}
        <button
          onClick={() => setShowTechnical(!showTechnical)}
          className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showTechnical ? "Hide" : "Show"} technical detail
        </button>
        {showTechnical && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">First-law efficiency</span>
            <span className="font-mono text-foreground">
              {formatPct(axis?.first_law_efficiency)}
            </span>
            <span className="text-muted-foreground">Second-law efficiency</span>
            <span className="font-mono text-foreground">{formatPct(eta_II)}</span>
            <span className="text-muted-foreground">Quality factor</span>
            <span className="font-mono text-foreground">
              {qf != null ? qf.toFixed(3) : "—"}
            </span>
            <span className="text-muted-foreground">Carrier type</span>
            <span className="font-mono text-foreground">
              {carrier ? carrier.replace(/_/g, " ") : "—"}
            </span>
            <span className="text-muted-foreground">Exergy ceiling</span>
            <span className="font-mono text-foreground">{formatPct(ceiling)}</span>
            <span className="text-muted-foreground">Headroom to ceiling</span>
            <span className="font-mono text-foreground">
              {headroom != null ? `+${(headroom * 100).toFixed(1)}pp` : "—"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
