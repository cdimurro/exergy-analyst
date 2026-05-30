// @ts-nocheck
"use client";

/**
 * InteractiveChart — Full-featured chart view for the Canvas panel.
 *
 * Provides chart type switching, axis selection, data table toggle,
 * and a larger rendering area than the inline CustomChart.
 */

import { useState, useMemo } from "react";
import type { ChartSpec } from "./CustomChart";
import { ChartRenderer } from "./CustomChart";
import { COLORS } from "@/components/simulate/chart-utils";

interface InteractiveChartProps {
  specs: ChartSpec[];
  onRequestChange?: (request: string) => void;
}

const CHART_TYPES: Array<{ key: ChartSpec["chart_type"]; label: string; icon: string }> = [
  { key: "bar", label: "Bar", icon: "|||" },
  { key: "line", label: "Line", icon: "~" },
  { key: "radar", label: "Radar", icon: "*" },
  { key: "scatter", label: "Scatter", icon: "." },
  { key: "waterfall", label: "Waterfall", icon: "V" },
  { key: "table", label: "Table", icon: "#" },
];

export function InteractiveChart({ specs, onRequestChange }: InteractiveChartProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [chartTypeOverride, setChartTypeOverride] = useState<ChartSpec["chart_type"] | null>(null);
  const [showData, setShowData] = useState(false);
  const [selectedYKeys, setSelectedYKeys] = useState<Set<string> | null>(null);
  const [requestText, setRequestText] = useState("");

  const activeSpec = specs[activeIdx];
  if (!activeSpec) return null;

  // Detect all numeric keys in the data for axis selection
  const allKeys = useMemo(() => {
    if (!activeSpec.data?.length) return [];
    const sample = activeSpec.data[0];
    return Object.keys(sample).filter(k => !k.startsWith("_"));
  }, [activeSpec]);

  const numericKeys = useMemo(() => {
    if (!activeSpec.data?.length) return [];
    const sample = activeSpec.data[0];
    return Object.keys(sample).filter(
      k => !k.startsWith("_") && typeof sample[k] === "number"
    );
  }, [activeSpec]);

  // Build the effective spec with overrides
  const effectiveSpec: ChartSpec = useMemo(() => {
    const yKeys = selectedYKeys
      ? activeSpec.y_keys.filter(k => selectedYKeys.has(k))
      : activeSpec.y_keys;
    return {
      ...activeSpec,
      chart_type: chartTypeOverride || activeSpec.chart_type,
      y_keys: yKeys.length > 0 ? yKeys : activeSpec.y_keys,
    };
  }, [activeSpec, chartTypeOverride, selectedYKeys]);

  const currentChartType = chartTypeOverride || activeSpec.chart_type;

  const handleToggleYKey = (key: string) => {
    setSelectedYKeys(prev => {
      const next = new Set(prev || new Set(activeSpec.y_keys));
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleRequest = () => {
    if (requestText.trim() && onRequestChange) {
      onRequestChange(requestText.trim());
      setRequestText("");
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab selector for multiple charts */}
      {specs.length > 1 && (
        <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-secondary)]">
          {specs.map((sp, i) => (
            <button
              key={i}
              onClick={() => { setActiveIdx(i); setChartTypeOverride(null); setSelectedYKeys(null); setShowData(false); }}
              className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                i === activeIdx
                  ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {sp.title.length > 35 ? sp.title.slice(0, 35) + "..." : sp.title}
            </button>
          ))}
        </div>
      )}

      {/* Chart header */}
      <div>
        <h3 className="text-[16px] font-bold text-[var(--text-primary)]">{activeSpec.title}</h3>
        {activeSpec.subtitle && (
          <p className="text-[12px] text-[var(--text-muted)] mt-1">{activeSpec.subtitle}</p>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Chart type switcher */}
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
          {CHART_TYPES.map(ct => (
            <button
              key={ct.key}
              onClick={() => setChartTypeOverride(ct.key === activeSpec.chart_type ? null : ct.key)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                currentChartType === ct.key
                  ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                  : "text-[var(--text-dim)] hover:text-[var(--text-muted)]"
              }`}
              title={ct.label}
            >
              {ct.label}
            </button>
          ))}
        </div>

        {/* Data table toggle */}
        <button
          onClick={() => setShowData(!showData)}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
            showData
              ? "border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]"
              : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text-muted)]"
          }`}
        >
          {showData ? "Hide Data" : "Show Data"}
        </button>
      </div>

      {/* Series selector (y-key toggles) */}
      {numericKeys.length > 1 && currentChartType !== "table" && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-[var(--text-dim)] self-center mr-1">Series:</span>
          {activeSpec.y_keys.map((key, i) => {
            const active = selectedYKeys ? selectedYKeys.has(key) : true;
            const color = (activeSpec.colors || COLORS)[i % COLORS.length];
            return (
              <button
                key={key}
                onClick={() => handleToggleYKey(key)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  active
                    ? "border-transparent"
                    : "border-[var(--border)] opacity-40"
                }`}
                style={active ? { backgroundColor: `${color}15`, color, borderColor: `${color}30` } : undefined}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? color : "var(--text-dim)" }} />
                {activeSpec.y_labels?.[key] || key.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      )}

      {/* Chart — larger than inline */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <ChartRenderer spec={effectiveSpec} height={400} />
      </div>

      {/* Data table (expandable) */}
      {showData && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
          <div className="px-4 py-2 border-b border-[var(--border)]">
            <span className="text-[11px] font-semibold text-[var(--text-muted)]">
              Raw Data ({activeSpec.data.length} rows)
            </span>
          </div>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[var(--bg-card)]">
                <tr className="border-b border-[var(--border)]">
                  {allKeys.map(k => (
                    <th key={k} className="px-3 py-2 text-left text-[var(--text-muted)] font-semibold uppercase tracking-wider text-[9px]">
                      {activeSpec.y_labels?.[k] || k.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeSpec.data.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--bg-hover)]">
                    {allKeys.map(k => (
                      <td key={k} className="px-3 py-1.5 text-[var(--text-secondary)]">
                        {typeof row[k] === "number"
                          ? (row[k] as number).toLocaleString(undefined, { maximumFractionDigits: 3 })
                          : String(row[k] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Source */}
      {activeSpec.source_description && (
        <p className="text-[10px] text-[var(--text-dim)]">
          Source: {activeSpec.source_description}
        </p>
      )}

      {/* Ask agent to modify */}
      {onRequestChange && (
        <div className="rounded-xl border border-dashed border-[var(--border-mid)] bg-[var(--bg-secondary)] p-3">
          <p className="text-[10px] text-[var(--text-dim)] mb-2">
            Ask the agent to modify this chart — change data, add comparisons, switch axes, or create new visualizations.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={requestText}
              onChange={e => setRequestText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleRequest(); }}
              placeholder="e.g., Add a reference line at 50% efficiency..."
              className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-secondary)] placeholder:text-[var(--text-dim)] outline-none focus:border-[var(--accent-blue)]/40"
            />
            {requestText.trim() && (
              <button
                onClick={handleRequest}
                className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-muted)]"
              >
                Update
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
