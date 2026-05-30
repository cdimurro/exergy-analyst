// @ts-nocheck
"use client";

/**
 * UniversalDashboard — composes VizSections into a responsive dashboard.
 *
 * Given an evaluation result, runs the visualization policy to determine
 * what to show, then renders each section using the appropriate chart
 * widget. Module-agnostic and domain-agnostic.
 *
 * Layout:
 *   Hero zone     — score + primary metric (full width)
 *   Primary zone  — 2-column grid for charts
 *   Secondary zone — collapsible panels for supporting data
 *   Detail zone   — expandable for assumptions/provenance
 */

import { useMemo, useState } from "react";
import {
  buildVisualizationPlan,
  type VizSection,
  type DisplayTier,
} from "@/lib/visualization-policy";
import { SectionRenderer } from "./SectionRenderer";

interface UniversalDashboardProps {
  evaluation: Record<string, unknown>;
  compact?: boolean;
  maxSections?: number;
}

export function UniversalDashboard({ evaluation, compact, maxSections }: UniversalDashboardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  const plan = useMemo(
    () => buildVisualizationPlan(evaluation, { compact, maxSections }),
    [evaluation, compact, maxSections],
  );

  if (plan.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <span className="text-[13px] text-[var(--text-dim)]">
          No visualizable data in this evaluation
        </span>
      </div>
    );
  }

  const hero = plan.filter(s => s.tier === "hero");
  const primary = plan.filter(s => s.tier === "primary");
  const secondary = plan.filter(s => s.tier === "secondary");
  const detail = plan.filter(s => s.tier === "detail");

  return (
    <div className="space-y-4">
      {/* ── Hero zone ──────────────────────────────────────── */}
      {hero.length > 0 && (
        <div className={hero.length > 1 ? "grid grid-cols-2 gap-3" : ""}>
          {hero.map(s => (
            <SectionRenderer key={s.id} section={s} />
          ))}
        </div>
      )}

      {/* ── Primary zone ───────────────────────────────────── */}
      {primary.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {primary.map(s => (
            <SectionRenderer key={s.id} section={s} />
          ))}
        </div>
      )}

      {/* ── Secondary zone ─────────────────────────────────── */}
      {secondary.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-dim)] pt-2">
            Supporting Analysis
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {secondary.map(s => (
              <SectionRenderer key={s.id} section={s} />
            ))}
          </div>
        </div>
      )}

      {/* ── Detail zone ────────────────────────────────────── */}
      {detail.length > 0 && (
        <div>
          <button
            onClick={() => setDetailOpen(!detailOpen)}
            className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors flex items-center gap-1 py-1"
          >
            <span className="text-[10px]">{detailOpen ? "\u25BC" : "\u25B6"}</span>
            {detailOpen ? "Hide" : "Show"} assumptions & details ({detail.length})
          </button>
          {detailOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              {detail.map(s => (
                <SectionRenderer key={s.id} section={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
