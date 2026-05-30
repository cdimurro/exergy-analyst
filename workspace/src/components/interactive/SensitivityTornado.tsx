// @ts-nocheck
"use client";

/**
 * SensitivityTornado — One-at-a-time parameter sensitivity analysis.
 *
 * For each manifest parameter, varies it ±20% from baseline and measures
 * the impact on composite score. Displays as a horizontal tornado chart
 * sorted by absolute impact. Helps users identify which parameters
 * have the most influence on the evaluation.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchManifest, type InteractiveManifest } from "@/lib/interactive-manifest";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND } from "@/lib/chart-theme";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine, CartesianGrid,
} from "recharts";
import {
  Activity,
  Loader2,
  Play,
  BarChart3,
} from "lucide-react";

interface SensitivityTornadoProps {
  domain: string;
  projectId: string;
  baselineResult: Record<string, unknown>;
}

interface SensitivityEntry {
  param: string;
  label: string;
  unit: string;
  lowValue: number;
  highValue: number;
  lowScore: number;
  highScore: number;
  lowDelta: number;
  highDelta: number;
  absImpact: number;
}

export function SensitivityTornado({ domain, projectId, baselineResult }: SensitivityTornadoProps) {
  const [manifest, setManifest] = useState<InteractiveManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [results, setResults] = useState<SensitivityEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasRun, setHasRun] = useState(false);
  // CC-BE-FIX-0012: explicit error + skip state so the UI mirrors
  // SimulationPlayground's honest posture instead of silently degrading
  // to "all deltas zero" when the API fails or a parameter is zero-range.
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  // Load manifest
  useEffect(() => {
    setManifestLoading(true);
    fetchManifest(domain)
      .then(m => { setManifest(m); setManifestLoading(false); })
      .catch(() => setManifestLoading(false));
  }, [domain]);

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

  /**
   * CC-BE-FIX-0012: Run one rerun-API call and return the parsed score.
   * Throws on any transport or response error so the caller can surface
   * it honestly — a silent fallback to baselineScore produces a zero-delta
   * bar that looks like "no impact" rather than "no data."
   */
  const runOneVariation = useCallback(
    async (paramKey: string, value: number): Promise<number> => {
      const res = await fetch(`/api/projects/${projectId}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          baseline_params: baselineParams,
          edits: { [paramKey]: value },
        }),
      });
      if (!res.ok) {
        throw new Error(`Rerun API returned ${res.status}`);
      }
      const data = await res.json();
      const s = data.result?.score || data.score || 0;
      return s < 1 ? Math.round(s * 100) : Math.round(s);
    },
    [domain, projectId, baselineParams],
  );

  const runSensitivity = useCallback(async () => {
    if (!manifest) return;
    setRunning(true);
    setProgress(0);
    setError(null);
    setSkipped([]);

    const entries: SensitivityEntry[] = [];
    const skippedParams: string[] = [];
    // Pairs (low + high) are counted per non-skipped parameter only, so
    // progress reaches 100% regardless of how many zero-range params the
    // manifest contains.
    const toRun = manifest.params.filter(p => p.max > p.min);
    const total = toRun.length * 2;
    let completed = 0;

    for (const param of manifest.params) {
      // CC-BE-FIX-0012: zero-range parameters produce lowVal == highVal so
      // the API would be called twice with identical inputs, producing two
      // zero-delta bars. Skip explicitly and record it so the UI can say
      // "this parameter has no range to vary" rather than "it has zero
      // impact."
      const range = param.max - param.min;
      if (range <= 0) {
        skippedParams.push(param.key);
        continue;
      }

      const baseVal = (baselineParams[param.key] as number) ?? param.default;
      const lowVal = Math.max(param.min, baseVal - range * 0.2);
      const highVal = Math.min(param.max, baseVal + range * 0.2);

      try {
        const lowScore = await runOneVariation(param.key, lowVal);
        completed++;
        setProgress(Math.round((completed / total) * 100));
        const highScore = await runOneVariation(param.key, highVal);
        completed++;
        setProgress(Math.round((completed / total) * 100));

        entries.push({
          param: param.key,
          label: param.label,
          unit: param.unit,
          lowValue: lowVal,
          highValue: highVal,
          lowScore,
          highScore,
          lowDelta: lowScore - baselineScore,
          highDelta: highScore - baselineScore,
          absImpact: Math.max(
            Math.abs(lowScore - baselineScore),
            Math.abs(highScore - baselineScore),
          ),
        });
      } catch (e) {
        // CC-BE-FIX-0012: surface the error instead of swallowing. The
        // SimulationPlayground uses the same explicit setError posture.
        setError(
          `Sensitivity run failed on parameter "${param.label}". ` +
            (e instanceof Error ? e.message : String(e)),
        );
        setRunning(false);
        return;
      }
    }

    // Sort by absolute impact (highest first)
    entries.sort((a, b) => b.absImpact - a.absImpact);
    setResults(entries);
    setSkipped(skippedParams);
    setRunning(false);
    setHasRun(true);
  }, [manifest, baselineParams, baselineScore, runOneVariation]);

  if (manifestLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="space-y-3">
            <Skeleton className="h-4 w-48 mx-auto" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!manifest || manifest.params.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Activity className="size-6 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Sensitivity analysis is not available for this domain.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Build chart data for tornado
  const chartData = results.map(r => ({
    name: r.label,
    low: r.lowDelta,
    high: r.highDelta,
    absImpact: r.absImpact,
  }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            Sensitivity Analysis
          </CardTitle>
          <Button
            size="sm"
            onClick={runSensitivity}
            disabled={running}
            className="gap-1.5 h-7"
          >
            {running ? (
              <><Loader2 className="size-3 animate-spin" /> Running ({progress}%)</>
            ) : hasRun ? (
              <><Play className="size-3" /> Re-run</>
            ) : (
              <><Play className="size-3" /> Run Analysis</>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Varies each parameter ±20% to measure impact on composite score.
          Sorted by influence — top parameters matter most.
        </p>
      </CardHeader>

      <CardContent>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        {skipped.length > 0 && (
          <div
            role="status"
            className="mb-4 rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          >
            Skipped {skipped.length} parameter{skipped.length === 1 ? "" : "s"} with no range to vary: {skipped.join(", ")}
          </div>
        )}

        {running && (
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Running {manifest.params.length} parameter variations...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {!hasRun && !running && (
          <div className="py-12 text-center">
            <Activity className="size-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">
              Click "Run Analysis" to discover which parameters have the most impact.
            </p>
            <p className="text-xs text-muted-foreground/60">
              This will run {manifest.params.length * 2} simulations ({manifest.params.length} parameters × 2 variations each).
            </p>
          </div>
        )}

        {hasRun && results.length > 0 && (
          <div className="space-y-4">
            {/* Tornado chart */}
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 20, bottom: 5, left: 90 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,40,68,0.5)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: '#8294b0' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 11, fill: '#b8c4dc' }}
                    axisLine={false}
                    tickLine={false}
                    width={85}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#151a2e',
                      border: '1px solid #1e2844',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#f2f4fa',
                    }}
                    formatter={(value: number, name: string) => [
                      `${value > 0 ? '+' : ''}${value} pts`,
                      name === 'low' ? 'Lower bound (-20%)' : 'Upper bound (+20%)',
                    ]}
                  />
                  <ReferenceLine x={0} stroke="#3a4d6a" strokeWidth={1} />
                  <Bar dataKey="low" barSize={12} radius={[4, 0, 0, 4]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.low < 0 ? '#d4646a' : BRAND.teal} fillOpacity={0.8} />
                    ))}
                  </Bar>
                  <Bar dataKey="high" barSize={12} radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.high > 0 ? BRAND.teal : '#d4646a'} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Parameter details table */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Detail</p>
              <div className="divide-y divide-border">
                {results.map((r, i) => (
                  <div key={r.param} className="flex items-center gap-3 py-2 text-xs">
                    <span className="w-5 text-muted-foreground/60 text-right font-mono">{i + 1}</span>
                    <span className="flex-1 text-secondary-foreground">{r.label}</span>
                    <span className="text-muted-foreground font-mono w-24 text-right">
                      {r.lowValue.toFixed(1)}–{r.highValue.toFixed(1)} {r.unit}
                    </span>
                    <Badge variant={r.absImpact >= 5 ? "warning" : r.absImpact >= 2 ? "info" : "default"}>
                      ±{r.absImpact} pts
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
