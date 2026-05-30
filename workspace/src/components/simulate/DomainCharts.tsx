// @ts-nocheck
"use client";

import type { SimDomain, AnySimResult } from "@/lib/sim-types";
import type { SimulationResult } from "@/lib/battery-sim";
import type { PVSimulationResult, InverterSimulationResult } from "@/lib/sim-types";
import { SimCharts } from "./SimCharts";
import { PVCharts } from "./PVCharts";
import { InverterCharts } from "./InverterCharts";

/**
 * Domain-aware chart dispatcher.
 *
 * Builtin domains get optimized chart components.
 * Unknown/provisional domains get a generic JSON fallback.
 */
export function DomainCharts({ domain, result }: { domain: SimDomain; result: AnySimResult }) {
  // Builtin domains with optimized chart components
  if (domain === "pv" || domain === "pv_iv") return <PVCharts result={result as PVSimulationResult} />;
  if (domain === "inverter" || domain === "inverter_dc_ac") return <InverterCharts result={result as InverterSimulationResult} />;
  if (domain === "battery" || domain === "battery_ecm") return <SimCharts result={result as SimulationResult} />;

  // Generic fallback for unknown/provisional domains
  return <GenericResultView domain={domain} result={result} />;
}

/** Generic result view for domains without dedicated chart components */
function GenericResultView({ domain, result }: { domain: string; result: AnySimResult }) {
  const summary = (result as any)?.summary;
  const grades = (result as any)?.grades;

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-[var(--text-dim)] uppercase tracking-wider">
        {domain} — Generic View
      </div>

      {/* Summary metrics as cards */}
      {summary && typeof summary === "object" && (
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(summary).filter(([, v]) => typeof v === "number" || typeof v === "string").map(([key, value]) => (
            <div key={key} className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-center">
              <div className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">{key.replace(/_/g, " ")}</div>
              <div className="text-base font-semibold mt-0.5">{typeof value === "number" ? value.toLocaleString() : String(value)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Grades */}
      {grades && Array.isArray(grades) && grades.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {grades.map((g: any, i: number) => (
            <div key={i} className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
              <div className="text-[9px] text-[var(--text-dim)]">{g.category || g.metric}</div>
              <div className={`text-sm font-bold mt-0.5 ${g.grade === "A+" || g.grade === "A" ? "text-[var(--accent-green)]" : g.grade === "B" ? "text-[var(--accent-blue)]" : "text-[var(--accent-amber)]"}`}>
                {g.grade} — {g.value} {g.unit}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raw data as collapsible JSON for debugging */}
      <details className="text-xs">
        <summary className="text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
          View raw simulation data
        </summary>
        <pre className="mt-2 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] overflow-auto max-h-[400px] text-[10px] text-[var(--text-dim)]">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}
