// @ts-nocheck
"use client";

/**
 * EconomicsExplorer — Interactive economics calculator.
 *
 * Client-side LCOE/LCOS/TCO computation with live chart updates.
 * No API calls needed — all math runs in the browser.
 *
 * Sliders for: CAPEX, OPEX, discount rate, project lifetime,
 * capacity factor, degradation rate, electricity price.
 *
 * Charts: cost breakdown waterfall, annual cash flow, sensitivity bars.
 */

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BRAND } from "@/lib/chart-theme";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Area, AreaChart,
} from "recharts";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  RotateCcw,
  Calculator,
} from "lucide-react";

import {
  computeLCOE as _computeLCOE,
  MIN_DISCOUNT_RATE as _MIN_DISCOUNT_RATE,
  type EconParams as _EconParams,
  type LCOEResult as _LCOEResult,
} from "@/lib/economics";

// Re-export at the module surface for any downstream code that previously
// imported these from EconomicsExplorer directly (CC-BE-FIX-0012). New code
// should import from ``@/lib/economics`` instead.
export const MIN_DISCOUNT_RATE = _MIN_DISCOUNT_RATE;
export const computeLCOE = _computeLCOE;
export type EconParams = _EconParams;
export type LCOEResult = _LCOEResult;

interface EconomicsExplorerProps {
  domain: string;
  baselineResult: Record<string, unknown>;
}

const DEFAULT_PARAMS: Record<string, EconParams> = {
  battery_ecm: {
    capex_per_kw: 350, opex_per_kw_year: 8, discount_rate: 0.08,
    lifetime_years: 15, capacity_factor: 0.25, degradation_rate: 0.02,
    electricity_price: 0.12, capacity_kw: 1000,
  },
  pv_iv: {
    capex_per_kw: 800, opex_per_kw_year: 12, discount_rate: 0.07,
    lifetime_years: 25, capacity_factor: 0.20, degradation_rate: 0.005,
    electricity_price: 0.10, capacity_kw: 500,
  },
  inverter_dc_ac: {
    capex_per_kw: 50, opex_per_kw_year: 2, discount_rate: 0.08,
    lifetime_years: 15, capacity_factor: 0.30, degradation_rate: 0.003,
    electricity_price: 0.10, capacity_kw: 1000,
  },
};

const GENERIC_DEFAULTS: EconParams = {
  capex_per_kw: 500, opex_per_kw_year: 10, discount_rate: 0.08,
  lifetime_years: 20, capacity_factor: 0.30, degradation_rate: 0.01,
  electricity_price: 0.10, capacity_kw: 1000,
};

const SLIDER_CONFIGS = [
  { key: "capex_per_kw", label: "CAPEX", unit: "$/kW", min: 50, max: 2000, step: 10 },
  { key: "opex_per_kw_year", label: "OPEX", unit: "$/kW/yr", min: 1, max: 50, step: 1 },
  { key: "discount_rate", label: "Discount Rate", unit: "%", min: 0.03, max: 0.15, step: 0.005, displayMult: 100 },
  { key: "lifetime_years", label: "Project Life", unit: "years", min: 5, max: 40, step: 1 },
  { key: "capacity_factor", label: "Capacity Factor", unit: "%", min: 0.05, max: 0.95, step: 0.01, displayMult: 100 },
  { key: "degradation_rate", label: "Degradation", unit: "%/yr", min: 0, max: 0.05, step: 0.001, displayMult: 100 },
  { key: "electricity_price", label: "Electricity Price", unit: "$/kWh", min: 0.02, max: 0.40, step: 0.005 },
  { key: "capacity_kw", label: "System Size", unit: "kW", min: 10, max: 10000, step: 10 },
];

export function EconomicsExplorer({ domain, baselineResult }: EconomicsExplorerProps) {
  const defaults = DEFAULT_PARAMS[domain] || GENERIC_DEFAULTS;

  // Try to extract economic params from baseline result
  const initialParams = useMemo(() => {
    const modules = (baselineResult.module_evaluations || {}) as Record<string, any>;
    const econDetails = modules.economics?.details || {};
    return {
      ...defaults,
      ...(econDetails.capex_per_kw ? { capex_per_kw: econDetails.capex_per_kw } : {}),
      ...(econDetails.opex_per_kw_year ? { opex_per_kw_year: econDetails.opex_per_kw_year } : {}),
      ...(econDetails.discount_rate ? { discount_rate: econDetails.discount_rate } : {}),
      ...(econDetails.lifetime_years ? { lifetime_years: econDetails.lifetime_years } : {}),
    };
  }, [baselineResult, defaults]);

  const [params, setParams] = useState<EconParams>(initialParams);

  const handleChange = useCallback((key: string, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleReset = useCallback(() => {
    setParams(initialParams);
  }, [initialParams]);

  const hasChanges = useMemo(() => {
    return SLIDER_CONFIGS.some(s => params[s.key] !== initialParams[s.key]);
  }, [params, initialParams]);

  const economics = useMemo(() => computeLCOE(params), [params]);
  const baselineEcon = useMemo(() => computeLCOE(initialParams), [initialParams]);

  const lcoeDelta = economics.lcoe - baselineEcon.lcoe;

  // Cost breakdown data for waterfall
  const waterfallData = [
    { name: "CAPEX", value: economics.totalCapex, fill: BRAND.blue },
    { name: "OPEX", value: economics.totalOpex, fill: BRAND.amber },
    { name: "Revenue", value: -economics.totalRevenue, fill: BRAND.teal },
    { name: "Net", value: economics.npv, fill: economics.npv >= 0 ? BRAND.teal : '#d4646a' },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="size-4 text-primary" />
            Economics Explorer
          </CardTitle>
          {hasChanges && (
            <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 h-7 text-xs">
              <RotateCcw className="size-3" /> Reset
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Adjust financial parameters to explore how economics change. All calculations run instantly in your browser.
        </p>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Parameter sliders */}
          <div className="lg:col-span-1 space-y-3">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Financial Inputs</p>
            {SLIDER_CONFIGS.map(s => {
              const value = params[s.key];
              const isEdited = value !== initialParams[s.key];
              const displayMult = s.displayMult || 1;
              const displayVal = value * displayMult;

              return (
                <div key={s.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-secondary-foreground">{s.label}</label>
                    <span className={cn(
                      "text-xs font-mono tabular-nums",
                      isEdited ? "text-primary" : "text-muted-foreground",
                    )}>
                      {displayVal % 1 === 0 ? displayVal : displayVal.toFixed(displayMult > 1 ? 1 : 3)}
                      <span className="text-muted-foreground/60 ml-0.5">{s.unit}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={value}
                    onChange={(e) => handleChange(s.key, parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${isEdited ? '#4db8a4' : '#2a3555'} ${((value - s.min) / (s.max - s.min)) * 100}%, #1e2844 ${((value - s.min) / (s.max - s.min)) * 100}%)`,
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-2 space-y-5">
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPICard
                label="LCOE"
                value={`$${(economics.lcoe * 100).toFixed(1)}`}
                unit="¢/kWh"
                delta={lcoeDelta !== 0 ? `${lcoeDelta > 0 ? '+' : ''}${(lcoeDelta * 100).toFixed(1)}¢` : undefined}
                deltaPositive={lcoeDelta < 0}
              />
              <KPICard
                label="Payback"
                value={`${economics.paybackYear}`}
                unit="years"
                delta={economics.paybackYear !== baselineEcon.paybackYear
                  ? `${economics.paybackYear < baselineEcon.paybackYear ? '-' : '+'}${Math.abs(economics.paybackYear - baselineEcon.paybackYear)}yr`
                  : undefined}
                deltaPositive={economics.paybackYear < baselineEcon.paybackYear}
              />
              <KPICard
                label="Total CAPEX"
                value={`$${(economics.totalCapex / 1000).toFixed(0)}`}
                unit="K"
              />
              <KPICard
                label="NPV"
                value={`$${(economics.npv / 1000).toFixed(0)}`}
                unit="K"
                deltaPositive={economics.npv >= 0}
              />
            </div>

            <Tabs defaultValue="cashflow" className="w-full">
              <TabsList className="mb-3">
                <TabsTrigger value="cashflow" className="text-xs">Cash Flow</TabsTrigger>
                <TabsTrigger value="breakdown" className="text-xs">Cost Breakdown</TabsTrigger>
                <TabsTrigger value="cumulative" className="text-xs">Cumulative</TabsTrigger>
              </TabsList>

              {/* Annual cash flow chart */}
              <TabsContent value="cashflow">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={economics.annualCosts} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,40,68,0.4)" />
                      <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#8294b0' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#8294b0' }} axisLine={false} tickLine={false}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip
                        contentStyle={{ background: '#151a2e', border: '1px solid #1e2844', borderRadius: '8px', fontSize: '11px', color: '#f2f4fa' }}
                        formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name === 'revenue' ? 'Revenue' : name === 'opex' ? 'OPEX' : 'CAPEX']}
                      />
                      <Bar dataKey="opex" stackId="costs" fill={BRAND.amber} fillOpacity={0.7} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="capex" stackId="costs" fill={BRAND.blue} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="revenue" fill={BRAND.teal} fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>

              {/* Cost breakdown waterfall */}
              <TabsContent value="breakdown">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={waterfallData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,40,68,0.4)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#b8c4dc' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#8294b0' }} axisLine={false} tickLine={false}
                        tickFormatter={(v) => `$${(Math.abs(v) / 1000).toFixed(0)}K`} />
                      <Tooltip
                        contentStyle={{ background: '#151a2e', border: '1px solid #1e2844', borderRadius: '8px', fontSize: '11px', color: '#f2f4fa' }}
                        formatter={(v: number) => [`$${Math.abs(v).toLocaleString()}`, '']}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {waterfallData.map((d, i) => (
                          <Cell key={i} fill={d.fill} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>

              {/* Cumulative cash flow */}
              <TabsContent value="cumulative">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={economics.annualCosts} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,40,68,0.4)" />
                      <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#8294b0' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#8294b0' }} axisLine={false} tickLine={false}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip
                        contentStyle={{ background: '#151a2e', border: '1px solid #1e2844', borderRadius: '8px', fontSize: '11px', color: '#f2f4fa' }}
                        formatter={(v: number) => [`$${v.toLocaleString()}`, 'Cumulative']}
                      />
                      <defs>
                        <linearGradient id="cumulativeFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={BRAND.teal} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={BRAND.teal} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="cumulative"
                        stroke={BRAND.teal}
                        fill="url(#cumulativeFill)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── KPI Card ────────────────────────────────────────────────

function KPICard({ label, value, unit, delta, deltaPositive }: {
  label: string; value: string; unit: string; delta?: string; deltaPositive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold text-foreground font-mono">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      {delta && (
        <div className={cn(
          "flex items-center gap-1 mt-1 text-[10px] font-medium",
          deltaPositive ? "text-[var(--accent-green)]" : "text-destructive",
        )}>
          {deltaPositive ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />}
          {delta}
        </div>
      )}
    </div>
  );
}
