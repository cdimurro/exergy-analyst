// @ts-nocheck
"use client";

/**
 * WhatIfPanel — Compare Results: multi-scenario parameter editor.
 *
 * Users adjust parameters, click "Add to Comparison" to create a scenario,
 * and see multiple scenarios overlaid on charts. Up to 5 scenarios with
 * distinct colors. Each scenario can be removed.
 *
 * Domain-agnostic: manifest drives which parameters appear.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { fetchManifest, validateEditsWithManifest, type InteractiveManifest, type EditableParam } from "@/lib/interactive-manifest";
import { BRAND, SEMANTIC, scoreColor } from "@/lib/chart-theme";
import { ChartCard } from "@/components/charts/ChartPrimitives";

interface WhatIfPanelProps {
  domain: string;
  baselineResult: Record<string, unknown>;
  projectId: string;
}

interface Scenario {
  id: string;
  label: string;
  edits: Record<string, number>;
  result: Record<string, unknown>;
  color: string;
}

const SCENARIO_COLORS = [BRAND.teal, BRAND.blue, BRAND.purple, BRAND.amber, BRAND.rose];
const MAX_SCENARIOS = 5;

export function WhatIfPanel({ domain, baselineResult, projectId }: WhatIfPanelProps) {
  const [manifest, setManifest] = useState<InteractiveManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);

  useEffect(() => {
    setManifestLoading(true);
    fetchManifest(domain).then(m => { setManifest(m); setManifestLoading(false); });
  }, [domain]);

  const [edits, setEdits] = useState<Record<string, number>>({});
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baselineParams = useMemo(() => {
    const metrics = (baselineResult.experiment_metrics || {}) as Record<string, unknown>;
    const modules = (baselineResult.module_evaluations || {}) as Record<string, Record<string, unknown>>;
    const econInputs = (modules.economics?.details as Record<string, unknown>)?.physics_inputs_used || {};
    return { ...metrics, ...econInputs };
  }, [baselineResult]);

  const baselineScore = useMemo(() => {
    const s = (baselineResult.score as number) || 0;
    return s < 1 ? Math.round(s * 100) : Math.round(s);
  }, [baselineResult]);

  if (manifestLoading) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <p className="text-[12px] text-[var(--text-dim)] animate-pulse">Loading parameters for {domain}...</p>
      </div>
    );
  }
  if (!manifest) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <p className="text-[12px] text-[var(--text-dim)]">No parameter schema found for this domain.</p>
      </div>
    );
  }

  const handleEdit = (key: string, value: number) => {
    setEdits(prev => ({ ...prev, [key]: value }));
    setError(null);
  };
  const handleReset = (key: string) => {
    setEdits(prev => { const next = { ...prev }; delete next[key]; return next; });
    setError(null);
  };
  const handleResetAll = () => { setEdits({}); setError(null); };

  const handleAddScenario = async () => {
    if (Object.keys(edits).length === 0) return;
    if (scenarios.length >= MAX_SCENARIOS) { setError(`Maximum ${MAX_SCENARIOS} scenarios`); return; }
    if (!manifest) return;
    const validation = validateEditsWithManifest(manifest, edits);
    if (!validation.valid) { setError(validation.errors.join("; ")); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, baseline_params: baselineParams, edits }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || "Rerun failed"); return; }

      const label = Object.entries(edits)
        .map(([k, v]) => {
          const p = manifest.params.find(p => p.key === k);
          return `${p?.label || k}: ${v}`;
        })
        .join(", ");

      const scenario: Scenario = {
        id: `s${Date.now()}`,
        label: label.length > 60 ? label.slice(0, 57) + "..." : label,
        edits: { ...edits },
        result: data.result,
        color: SCENARIO_COLORS[scenarios.length % SCENARIO_COLORS.length],
      };
      setScenarios(prev => [...prev, scenario]);
      setEdits({}); // Clear edits after adding
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setLoading(false); }
  };

  const removeScenario = (id: string) => {
    setScenarios(prev => prev.filter(s => s.id !== id));
  };

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="space-y-4">
      {/* ── Parameter Editor ─────────────────────────────── */}
      <ChartCard title="Compare Results" subtitle="Adjust parameters and add scenarios to compare">
        <div className="space-y-3">
          {manifest.params.map(param => (
            <ParamSlider
              key={param.key}
              param={param}
              baselineValue={baselineParams[param.key] as number ?? param.default}
              editedValue={edits[param.key]}
              onChange={(v) => handleEdit(param.key, v)}
              onReset={() => handleReset(param.key)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--border)]/50">
          <button
            onClick={handleAddScenario}
            disabled={!hasEdits || loading || scenarios.length >= MAX_SCENARIOS}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40"
            style={{
              background: hasEdits ? BRAND.teal : "transparent",
              color: hasEdits ? "white" : SEMANTIC.neutral,
              border: hasEdits ? "none" : `1px solid ${SEMANTIC.neutral}30`,
            }}
          >
            {loading ? "Running..." : `Add to Comparison${scenarios.length > 0 ? ` (${scenarios.length}/${MAX_SCENARIOS})` : ""}`}
          </button>
          {hasEdits && (
            <button onClick={handleResetAll} className="px-2 py-1.5 text-[11px] text-[var(--text-dim)] hover:text-[var(--text-secondary)]">
              Reset
            </button>
          )}
          {error && <span className="text-[11px] ml-2" style={{ color: BRAND.rose }}>{error}</span>}
        </div>
      </ChartCard>

      {/* ── Scenario Comparison ──────────────────────────── */}
      {scenarios.length > 0 && (
        <ScenarioComparison
          baseline={baselineResult}
          baselineScore={baselineScore}
          scenarios={scenarios}
          manifest={manifest}
          onRemove={removeScenario}
        />
      )}
    </div>
  );
}

// ── Scenario comparison view ─────────────────────────────

function ScenarioComparison({ baseline, baselineScore, scenarios, manifest, onRemove }: {
  baseline: Record<string, unknown>;
  baselineScore: number;
  scenarios: Scenario[];
  manifest: InteractiveManifest;
  onRemove: (id: string) => void;
}) {
  const baselineModules = (baseline.module_evaluations || {}) as Record<string, Record<string, unknown>>;

  const MODULE_DISPLAY: Record<string, string> = {
    physics: "Physics", performance: "Performance", economics: "Economics",
    safety: "Safety", environmental: "Environmental", regulatory: "Regulatory",
    manufacturing: "Manufacturing", scalability: "Scalability",
    system_integration: "Integration", novelty: "Strategic Value",
  };
  const moduleKeys = Object.keys(baselineModules).filter(k => MODULE_DISPLAY[k]);

  return (
    <div className="space-y-3">
      {/* Score comparison bar chart */}
      <ChartCard title="Score Comparison">
        <div className="space-y-2">
          {/* Baseline */}
          <ScoreBar label="Baseline" score={baselineScore} color="var(--text-dim)" />
          {/* Scenarios */}
          {scenarios.map((s, i) => {
            const sScore = (s.result.score as number) || 0;
            const display = sScore < 1 ? Math.round(sScore * 100) : Math.round(sScore);
            const delta = display - baselineScore;
            return (
              <div key={s.id} className="group">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ScoreBar label={`Scenario ${i + 1}`} score={display} color={s.color} />
                  </div>
                  <span className="text-[11px] font-bold tabular-nums w-10 text-right"
                    style={{ color: delta > 0 ? BRAND.teal : delta < 0 ? BRAND.rose : SEMANTIC.neutral }}>
                    {delta > 0 ? "+" : ""}{delta}
                  </span>
                  <button onClick={() => onRemove(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-[var(--accent-red)] text-[11px] transition-opacity"
                    title="Remove scenario">&times;</button>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] ml-1 mt-0.5 truncate">{s.label}</div>
              </div>
            );
          })}
        </div>
      </ChartCard>

      {/* Module verdict comparison table */}
      {moduleKeys.length > 0 && (
        <ChartCard title="Module Verdicts Across Scenarios">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[var(--border)]/50">
                  <th className="text-left py-1.5 text-[var(--text-dim)] font-medium">Module</th>
                  <th className="text-center py-1.5 text-[var(--text-dim)] font-medium">Baseline</th>
                  {scenarios.map((s, i) => (
                    <th key={s.id} className="text-center py-1.5 font-medium" style={{ color: s.color }}>
                      Scenario {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {moduleKeys.map(k => {
                  const bVerdict = baselineModules[k]?.verdict as string || "blocked";
                  return (
                    <tr key={k} className="border-b border-[var(--border)]/20">
                      <td className="py-1.5 text-[var(--text-secondary)]">{MODULE_DISPLAY[k]}</td>
                      <td className="py-1.5 text-center"><VerdictChip verdict={bVerdict} /></td>
                      {scenarios.map(s => {
                        const mods = (s.result.module_evaluations || {}) as Record<string, Record<string, unknown>>;
                        const mVerdict = mods[k]?.verdict as string || "blocked";
                        const changed = mVerdict !== bVerdict;
                        return (
                          <td key={s.id} className="py-1.5 text-center">
                            <VerdictChip verdict={mVerdict} highlight={changed} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}

      {/* Scenario details — what was changed in each */}
      <ChartCard title="Scenario Details">
        <div className="space-y-3">
          {scenarios.map((s, i) => (
            <div key={s.id} className="flex items-start gap-3 pb-3 border-b border-[var(--border)]/30 last:border-b-0 last:pb-0">
              <span className="shrink-0 w-3 h-3 rounded-full mt-1" style={{ background: s.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-[var(--text-primary)]">Scenario {i + 1}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {Object.entries(s.edits).map(([key, val]) => {
                    const p = manifest.params.find(p => p.key === key);
                    const oldVal = (baseline.experiment_metrics as Record<string, unknown>)?.[key] as number ?? p?.default ?? 0;
                    return (
                      <span key={key} className="text-[11px] text-[var(--text-muted)]">
                        {p?.label || key}: <span className="text-[var(--text-dim)]">{oldVal.toFixed(1)}</span> → <span className="font-medium" style={{ color: s.color }}>{val.toFixed(1)}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <button onClick={() => onRemove(s.id)}
                className="shrink-0 text-[var(--text-dim)] hover:text-[var(--accent-red)] text-[12px]" title="Remove">&times;</button>
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

// ── Components ───────────────────────────────────────────

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[var(--text-muted)] w-20 shrink-0">{label}</span>
      <div className="flex-1 h-5 rounded-full bg-[var(--bg-elevated)]/60 overflow-hidden relative">
        <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${score}%`, background: `${color}60` }} />
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums" style={{ color }}>
          {score}
        </span>
      </div>
    </div>
  );
}

function VerdictChip({ verdict, highlight }: { verdict: string; highlight?: boolean }) {
  const colors: Record<string, string> = {
    pass: BRAND.teal, conditional: BRAND.amber, fail: BRAND.rose, blocked: SEMANTIC.neutral,
  };
  const c = colors[verdict] || SEMANTIC.neutral;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
      style={{ background: highlight ? `${c}20` : "transparent", color: c, fontWeight: highlight ? 600 : 400 }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      {verdict}
    </span>
  );
}

function ParamSlider({ param, baselineValue, editedValue, onChange, onReset }: {
  param: EditableParam;
  baselineValue: number;
  editedValue: number | undefined;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  const currentValue = editedValue ?? baselineValue;
  const isEdited = editedValue !== undefined;
  const pctOfRange = ((currentValue - param.min) / (param.max - param.min)) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-[var(--text-secondary)]">
          {param.label}
          {param.unit && <span className="text-[var(--text-dim)] ml-1">({param.unit})</span>}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium tabular-nums" style={{ color: isEdited ? BRAND.teal : "var(--text-primary)" }}>
            {currentValue.toFixed(param.step < 1 ? 1 : 0)}
          </span>
          {isEdited && (
            <button onClick={onReset} className="text-[9px] text-[var(--text-dim)] hover:text-[var(--text-secondary)]">reset</button>
          )}
        </div>
      </div>
      <div className="relative">
        <input type="range" min={param.min} max={param.max} step={param.step} value={currentValue}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${isEdited ? BRAND.teal : BRAND.blue}60 0%, ${isEdited ? BRAND.teal : BRAND.blue}60 ${pctOfRange}%, rgba(42,53,85,0.4) ${pctOfRange}%, rgba(42,53,85,0.4) 100%)`,
          }}
        />
        {isEdited && (
          <div className="absolute top-0 w-0.5 h-1.5 rounded-full"
            style={{ left: `${((baselineValue - param.min) / (param.max - param.min)) * 100}%`, background: SEMANTIC.neutral }}
            title={`Baseline: ${baselineValue}`} />
        )}
      </div>
      <div className="flex justify-between text-[9px] text-[var(--text-dim)]">
        <span>{param.min}</span><span>{param.max}</span>
      </div>
    </div>
  );
}
