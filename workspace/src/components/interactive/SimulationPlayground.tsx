// @ts-nocheck
"use client";

/**
 * SimulationPlayground — Live parameter exploration with auto-rerun.
 *
 * Combines parameter sliders with debounced API calls to show how
 * changing inputs affects simulation results in real time. Shows:
 * - Parameter sliders from domain manifest
 * - Live composite score + module radar updates
 * - Delta indicators (green/red) for score changes
 * - Reset to baseline button
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { fetchManifest, type InteractiveManifest, type EditableParam } from "@/lib/interactive-manifest";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreGauge } from "@/components/brief/ScoreGauge";
import { MODULE_SHORT_NAMES, BRAND, SEMANTIC } from "@/lib/chart-theme";
import {
  SlidersHorizontal,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Loader2,
  Zap,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

interface SimulationPlaygroundProps {
  domain: string;
  projectId: string;
  baselineResult: Record<string, unknown>;
}

// Debounce delay for auto-rerun (ms)
const DEBOUNCE_MS = 800;

export function SimulationPlayground({ domain, projectId, baselineResult }: SimulationPlaygroundProps) {
  const [manifest, setManifest] = useState<InteractiveManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [liveResult, setLiveResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load manifest
  useEffect(() => {
    setManifestLoading(true);
    fetchManifest(domain)
      .then(m => { setManifest(m); setManifestLoading(false); })
      .catch(() => setManifestLoading(false));
  }, [domain]);

  // Extract baseline params
  const baselineParams = useMemo(() => {
    const metrics = (baselineResult.experiment_metrics || {}) as Record<string, unknown>;
    const modules = (baselineResult.module_evaluations || {}) as Record<string, Record<string, unknown>>;
    const econInputs = (modules.economics?.details as Record<string, unknown>)?.physics_inputs_used || {};
    const family = (baselineResult.technology_family as string) || "";
    return { ...metrics, ...econInputs, ...(family ? { technology_family: family } : {}) };
  }, [baselineResult]);

  const baselineScore = useMemo(() => {
    const s = (baselineResult.score as number) || 0;
    return s < 1 ? Math.round(s * 100) : Math.round(s);
  }, [baselineResult]);

  // Debounced rerun
  const runReeval = useCallback(async (currentEdits: Record<string, number>) => {
    if (Object.keys(currentEdits).length === 0) {
      setLiveResult(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          baseline_params: baselineParams,
          edits: currentEdits,
        }),
      });

      if (!res.ok) throw new Error("Simulation failed");
      const data = await res.json();
      setLiveResult(data.result || data);
    } catch (e) {
      setError("Simulation failed. Try adjusting parameters.");
    } finally {
      setLoading(false);
    }
  }, [domain, projectId, baselineParams]);

  // Handle parameter change with debounce
  const handleEdit = useCallback((key: string, value: number) => {
    const newEdits = { ...edits, [key]: value };

    // If value equals the manifest default, remove the edit
    const param = manifest?.params.find(p => p.key === key);
    if (param && Math.abs(value - param.default) < param.step * 0.1) {
      delete newEdits[key];
    }

    setEdits(newEdits);

    // Debounce the API call
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runReeval(newEdits), DEBOUNCE_MS);
  }, [edits, manifest, runReeval]);

  const handleReset = useCallback(() => {
    setEdits({});
    setLiveResult(null);
    setError(null);
  }, []);

  const hasEdits = Object.keys(edits).length > 0;
  const liveScore = useMemo(() => {
    if (!liveResult) return baselineScore;
    const s = (liveResult.score as number) || 0;
    return s < 1 ? Math.round(s * 100) : Math.round(s);
  }, [liveResult, baselineScore]);

  const scoreDelta = liveScore - baselineScore;

  // Build module comparison data
  const moduleComparison = useMemo(() => {
    const baseModules = (baselineResult.module_evaluations || {}) as Record<string, any>;
    const liveModules = liveResult
      ? ((liveResult.module_evaluations || {}) as Record<string, any>)
      : baseModules;

    return Object.keys(baseModules).map(key => {
      const baseMod = baseModules[key] || {};
      const liveMod = liveModules[key] || baseMod;
      const baseConf = (baseMod.confidence_0_1 || 0) * 100;
      const liveConf = (liveMod.confidence_0_1 || baseMod.confidence_0_1 || 0) * 100;
      const name = MODULE_SHORT_NAMES[key] || key.replace(/_/g, " ");
      return {
        name,
        key,
        baseline: Math.round(baseConf),
        live: Math.round(liveConf),
        delta: Math.round(liveConf - baseConf),
        baseVerdict: baseMod.verdict || "unknown",
        liveVerdict: liveMod.verdict || baseMod.verdict || "unknown",
      };
    }).filter(m => m.baseline > 0 || m.live > 0);
  }, [baselineResult, liveResult]);

  // Loading state
  if (manifestLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="size-6 text-primary animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading simulation parameters...</p>
        </CardContent>
      </Card>
    );
  }

  if (!manifest || manifest.params.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <SlidersHorizontal className="size-6 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Interactive simulation is not yet available for this domain.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-primary" />
            Simulation Explorer
          </CardTitle>
          <div className="flex items-center gap-2">
            {loading && (
              <Badge variant="info" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                Running
              </Badge>
            )}
            {hasEdits && !loading && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 h-7 text-xs">
                <RotateCcw className="size-3" />
                Reset
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Adjust parameters to see how they affect the evaluation. Changes auto-run after {DEBOUNCE_MS}ms.
        </p>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Parameter sliders */}
          <div className="lg:col-span-1 space-y-4">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Parameters</p>
            <div className="space-y-3">
              {manifest.params.map(param => {
                const currentValue = edits[param.key] ?? param.default;
                const isEdited = param.key in edits;
                const baseValue = (baselineParams[param.key] as number) ?? param.default;

                return (
                  <div key={param.key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-secondary-foreground">{param.label}</label>
                      <span className={cn(
                        "text-xs font-mono tabular-nums",
                        isEdited ? "text-primary" : "text-muted-foreground",
                      )}>
                        {currentValue % 1 === 0 ? currentValue : currentValue.toFixed(2)}
                        {param.unit && <span className="text-muted-foreground ml-0.5">{param.unit}</span>}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={currentValue}
                      onChange={(e) => handleEdit(param.key, parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, ${isEdited ? '#4db8a4' : '#2a3555'} ${((currentValue - param.min) / (param.max - param.min)) * 100}%, #1e2844 ${((currentValue - param.min) / (param.max - param.min)) * 100}%)`,
                      }}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground/50">
                      <span>{param.min}{param.unit}</span>
                      <span>{param.max}{param.unit}</span>
                    </div>
                    {param.tooltip && (
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{param.tooltip}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Right column: Results visualization */}
          <div className="lg:col-span-2 space-y-4">
            {/* Score comparison */}
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Baseline</p>
                <ScoreGauge score={baselineScore} size={70} strokeWidth={5} />
              </div>
              {hasEdits && (
                <>
                  <div className="flex flex-col items-center gap-1">
                    {scoreDelta > 0 ? (
                      <TrendingUp className="size-5 text-[var(--accent-green)]" />
                    ) : scoreDelta < 0 ? (
                      <TrendingDown className="size-5 text-destructive" />
                    ) : (
                      <Minus className="size-5 text-muted-foreground" />
                    )}
                    <span className={cn(
                      "text-lg font-bold font-mono",
                      scoreDelta > 0 ? "text-[var(--accent-green)]" : scoreDelta < 0 ? "text-destructive" : "text-muted-foreground",
                    )}>
                      {scoreDelta > 0 ? "+" : ""}{scoreDelta}
                    </span>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Modified</p>
                    <ScoreGauge score={liveScore} size={70} strokeWidth={5} />
                  </div>
                </>
              )}
            </div>

            <Separator />

            {/* Module comparison bars */}
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Module Impact
              </p>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={moduleComparison}
                    layout="vertical"
                    margin={{ top: 0, right: 10, bottom: 0, left: 100 }}
                  >
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#8294b0' }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#b8c4dc' }} axisLine={false} tickLine={false} width={95} />
                    <Tooltip
                      contentStyle={{
                        background: '#151a2e',
                        border: '1px solid #1e2844',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#f2f4fa',
                      }}
                      formatter={(value: number, name: string) => [
                        `${value}%`,
                        name === 'baseline' ? 'Baseline' : 'Modified',
                      ]}
                    />
                    <Bar dataKey="baseline" fill="#2a3555" radius={[0, 4, 4, 0]} barSize={8} />
                    {hasEdits && (
                      <Bar dataKey="live" radius={[0, 4, 4, 0]} barSize={8}>
                        {moduleComparison.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={entry.delta > 0 ? BRAND.teal : entry.delta < 0 ? '#d4646a' : '#4a5a70'}
                          />
                        ))}
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Changed verdicts */}
            {hasEdits && moduleComparison.some(m => m.baseVerdict !== m.liveVerdict) && (
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Verdict Changes</p>
                <div className="flex flex-wrap gap-2">
                  {moduleComparison.filter(m => m.baseVerdict !== m.liveVerdict).map(m => (
                    <Badge key={m.key} variant={m.liveVerdict === "pass" ? "success" : m.liveVerdict === "fail" ? "destructive" : "warning"}>
                      {m.name}: {m.baseVerdict} → {m.liveVerdict}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Edited parameters summary */}
            {hasEdits && (
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-[11px] font-medium text-muted-foreground mb-2">Changes Applied</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(edits).map(([key, val]) => {
                    const param = manifest.params.find(p => p.key === key);
                    return (
                      <Badge key={key} variant="tier" className="gap-1">
                        {param?.label || key}: {val}{param?.unit || ""}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
