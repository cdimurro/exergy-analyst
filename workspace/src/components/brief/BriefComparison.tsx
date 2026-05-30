// @ts-nocheck
"use client";

/**
 * BriefComparison — side-by-side technology comparison view.
 *
 * Two DeviceDecisionBriefs displayed with:
 *   - Score gauges
 *   - Radar chart overlay (both on the same chart)
 *   - Module-by-module comparison table
 *   - Key differences summary
 */

import { ScoreGauge } from "./ScoreGauge";
import { ModuleRadar } from "./ModuleRadar";
import { StatusBadge } from "@/components/ui/custom/StatusBadge";
import {
  BRAND,
  MODULE_SHORT_NAMES,
  MODULE_ORDER,
  verdictColor,
} from "@/lib/chart-theme";
import type { DeviceDecisionBrief } from "@/lib/brief-types";
import { formatCompositeScore } from "@/lib/canonical-score";

interface BriefComparisonProps {
  briefA: DeviceDecisionBrief;
  briefB: DeviceDecisionBrief;
  className?: string;
}

function verdictToNumber(verdict: string): number {
  switch (verdict) {
    case "pass":        return 3;
    case "conditional": return 2;
    case "fail":        return 1;
    case "blocked":     return 0;
    default:            return 0;
  }
}

function ComparisonHeader({ brief, accent }: { brief: DeviceDecisionBrief; accent: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <ScoreGauge score={Number(formatCompositeScore(brief.composite_score, "gauge"))} size={100} strokeWidth={7} />
      <div className="text-center">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">
          {brief.commercial_name || brief.device_id}
        </p>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
          {brief.domain}
          {brief.technology_family ? ` · ${brief.technology_family}` : ""}
        </p>
        <div className="mt-1.5">
          <StatusBadge variant="tier" value={brief.readiness_tier} size="sm" />
        </div>
      </div>
    </div>
  );
}

export function BriefComparison({ briefA, briefB, className = "" }: BriefComparisonProps) {
  const modulesA = briefA.module_summary || [];
  const modulesB = briefB.module_summary || [];

  const mapA = new Map(
    modulesA.map((m) => [MODULE_SHORT_NAMES[m.module_name] || m.module_name, m]),
  );
  const mapB = new Map(
    modulesB.map((m) => [MODULE_SHORT_NAMES[m.module_name] || m.module_name, m]),
  );

  const differences: Array<{
    module: string;
    aVerdict: string;
    bVerdict: string;
    winner: "A" | "B" | "tie";
  }> = [];

  for (const name of MODULE_ORDER) {
    const aScore = verdictToNumber(mapA.get(name)?.verdict || "blocked");
    const bScore = verdictToNumber(mapB.get(name)?.verdict || "blocked");
    if (aScore !== bScore) {
      differences.push({
        module: name,
        aVerdict: mapA.get(name)?.verdict || "blocked",
        bVerdict: mapB.get(name)?.verdict || "blocked",
        winner: aScore > bScore ? "A" : "B",
      });
    }
  }

  const nameA = briefA.commercial_name || "Technology A";
  const nameB = briefB.commercial_name || "Technology B";

  return (
    <div className={`space-y-5 ${className}`}>
      {/* ── Headers ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="rounded-xl border bg-[var(--bg-card)] p-5"
          style={{ borderColor: `${BRAND.teal}25` }}
        >
          <ComparisonHeader brief={briefA} accent={BRAND.teal} />
        </div>
        <div
          className="rounded-xl border bg-[var(--bg-card)] p-5"
          style={{ borderColor: `${BRAND.blue}25` }}
        >
          <ComparisonHeader brief={briefB} accent={BRAND.blue} />
        </div>
      </div>

      {/* ── Radar overlay ────────────────────────── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">
          Module Comparison
        </h3>
        <ModuleRadar
          modules={modulesA}
          compareModules={modulesB}
          compareLabel={nameB}
          height={300}
        />
        <div className="flex items-center justify-center gap-6 mt-1">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded" style={{ backgroundColor: BRAND.teal }} />
            <span className="text-[10px] text-[var(--text-muted)]">{nameA}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded" style={{ backgroundColor: BRAND.blue }} />
            <span className="text-[10px] text-[var(--text-muted)]">{nameB}</span>
          </span>
        </div>
      </div>

      {/* ── Module comparison table ──────────────── */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-[var(--bg-elevated)]">
            <tr>
              <th className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Module
              </th>
              <th
                className="px-3 py-2.5 text-center text-[9px] font-semibold uppercase tracking-wider"
                style={{ color: BRAND.teal }}
              >
                {nameA.slice(0, 20)}
              </th>
              <th
                className="px-3 py-2.5 text-center text-[9px] font-semibold uppercase tracking-wider"
                style={{ color: BRAND.blue }}
              >
                {nameB.slice(0, 20)}
              </th>
            </tr>
          </thead>
          <tbody>
            {MODULE_ORDER.map((name) => {
              const a = mapA.get(name);
              const b = mapB.get(name);
              const aV = a?.verdict || "blocked";
              const bV = b?.verdict || "blocked";
              const isDiff = verdictToNumber(aV) !== verdictToNumber(bV);
              return (
                <tr
                  key={name}
                  className={`border-t border-[var(--border)] ${isDiff ? "bg-[var(--bg-hover)]" : ""}`}
                >
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{name}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge variant="verdict" value={aV} size="sm" />
                      {a && a.confidence > 0 && (
                        <span className="text-[9px] text-[var(--text-dim)]">
                          {Math.round(a.confidence * 100)}%
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge variant="verdict" value={bV} size="sm" />
                      {b && b.confidence > 0 && (
                        <span className="text-[9px] text-[var(--text-dim)]">
                          {Math.round(b.confidence * 100)}%
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Key differences ──────────────────────── */}
      {differences.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h3 className="text-[12px] font-semibold text-[var(--text-primary)] mb-2">
            Key Differences ({differences.length})
          </h3>
          <div className="space-y-1.5">
            {differences.map((d) => (
              <div key={d.module} className="flex items-center gap-2 text-[11px]">
                <span className="text-[var(--text-muted)] w-[100px] shrink-0">{d.module}</span>
                <span className="font-mono text-[10px]" style={{ color: verdictColor(d.aVerdict) }}>
                  {d.aVerdict}
                </span>
                <span className="text-[var(--text-dim)]">vs</span>
                <span className="font-mono text-[10px]" style={{ color: verdictColor(d.bVerdict) }}>
                  {d.bVerdict}
                </span>
                <span
                  className="text-[9px] font-medium ml-auto"
                  style={{ color: d.winner === "A" ? BRAND.teal : BRAND.blue }}
                >
                  {d.winner === "A" ? `${nameA} stronger` : `${nameB} stronger`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
