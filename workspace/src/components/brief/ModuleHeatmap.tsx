// @ts-nocheck
"use client";

/**
 * ModuleHeatmap — grid visualization for multi-technology comparison.
 *
 * Rows = technologies, Columns = 10 evaluation modules.
 * Cells colored by verdict, opacity modulated by confidence.
 */

import {
  BRAND,
  SEMANTIC,
  MODULE_SHORT_NAMES,
  MODULE_ORDER,
  verdictColor,
} from "@/lib/chart-theme";

interface ModuleVerdictLike {
  module_name: string;
  confidence: number;
  verdict: string;
  key_detail?: string;
}

interface Technology {
  name: string;
  modules: ModuleVerdictLike[];
}

interface ModuleHeatmapProps {
  technologies: Technology[];
  className?: string;
}

const VERDICT_ICONS: Record<string, string> = {
  pass:        "+",
  fail:        "!",
  conditional: "~",
  blocked:     "-",
};

function cellStyles(verdict: string, confidence: number) {
  const color = verdictColor(verdict);
  const opacity = Math.max(0.25, Math.min(1, confidence * 1.3));
  return {
    backgroundColor: `color-mix(in srgb, ${color} ${Math.round(opacity * 28)}%, transparent)`,
    color,
    borderLeft: `2px solid color-mix(in srgb, ${color} ${Math.round(opacity * 50)}%, transparent)`,
  };
}

export function ModuleHeatmap({ technologies, className = "" }: ModuleHeatmapProps) {
  if (!technologies?.length) return null;

  return (
    <div className={`rounded-xl border border-[var(--border)] overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-[var(--bg-elevated)]">
              <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[9px] uppercase tracking-wider sticky left-0 bg-[var(--bg-elevated)] z-10 min-w-[120px]">
                Technology
              </th>
              {MODULE_ORDER.map((name) => (
                <th
                  key={name}
                  className="px-1 py-2.5 text-center font-semibold text-[8px] uppercase tracking-wider text-[var(--text-muted)] min-w-[56px]"
                >
                  <span className="block whitespace-nowrap">
                    {name.length > 8 ? name.slice(0, 7) + "." : name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {technologies.map((tech, ri) => {
              const moduleMap = new Map(
                tech.modules.map((m) => [
                  MODULE_SHORT_NAMES[m.module_name] || m.module_name,
                  m,
                ]),
              );
              return (
                <tr key={ri} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2.5 text-[11px] font-medium text-[var(--text-primary)] sticky left-0 bg-[var(--bg-card)] z-10">
                    {tech.name}
                  </td>
                  {MODULE_ORDER.map((name) => {
                    const m = moduleMap.get(name);
                    if (!m)
                      return (
                        <td key={name} className="px-1 py-2 text-center">
                          <span className="text-[var(--text-dim)] text-[9px]">-</span>
                        </td>
                      );
                    const style = cellStyles(m.verdict, m.confidence);
                    return (
                      <td key={name} className="px-1 py-2">
                        <div
                          className="flex items-center justify-center rounded px-1 py-1 transition-colors"
                          style={style}
                          title={`${name}: ${m.verdict} (${Math.round(m.confidence * 100)}%)\n${m.key_detail || ""}`}
                        >
                          <span className="font-bold text-[9px]">
                            {VERDICT_ICONS[m.verdict] || "?"}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2.5 border-t border-[var(--border)] bg-[var(--bg-card)]">
        {[
          { label: "Strong",      color: BRAND.teal,      icon: "+" },
          { label: "Directional", color: BRAND.amber,     icon: "~" },
          { label: "Concern",     color: BRAND.rose,      icon: "!" },
          { label: "Needs Data",  color: SEMANTIC.neutral, icon: "-" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span
              className="w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[8px] font-bold"
              style={{
                backgroundColor: `color-mix(in srgb, ${item.color} 25%, transparent)`,
                color: item.color,
              }}
            >
              {item.icon}
            </span>
            <span className="text-[9px] text-[var(--text-muted)]">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
