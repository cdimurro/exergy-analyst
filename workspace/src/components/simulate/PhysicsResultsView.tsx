// @ts-nocheck
"use client";
/**
 * DetailedResultsView — Comprehensive canvas panel for evaluation results.
 *
 * Domain-adaptive: renders nuclear-specific sections (verdict, safety bars,
 * decay chart, four-factor) for nuclear domains, and generic module/metrics
 * views for all other domains (battery, PV, inverter, general).
 */

import React, { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell,
} from "recharts";
import { BRAND, SEMANTIC, CHART_GRID, CHART_AXIS } from "@/lib/chart-theme";
import { fmtVal } from "@/lib/format-metric";

interface Props {
  physicsSolver?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  brief?: Record<string, unknown>;
  domain?: string;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  return null;
}

const TT: React.CSSProperties = {
  backgroundColor: "#1e2a42", border: "1px solid #334466",
  borderRadius: "8px", fontSize: "12px", color: "#e8ecf4", padding: "8px 12px",
};

const NUCLEAR_LABELS: Record<string, string> = {
  k_inf: "k-infinity", k_eff: "k-effective", dnbr_minimum: "Minimum DNBR",
  fuel_centerline_max_k: "Peak Fuel Centerline", clad_max_temp_k: "Peak Cladding",
  coolant_outlet_temp_k: "Coolant Outlet", alpha_doppler_pcm_per_k: "Doppler Coefficient",
  alpha_moderator_pcm_per_k: "Moderator Coefficient", thermal_efficiency: "Thermal Efficiency",
  net_power_w: "Net Electrical Output", decay_heat_fraction_1h: "Decay Heat (1 hr)",
  decay_heat_fraction_24h: "Decay Heat (24 hr)", peak_linear_heat_rate_w_per_m: "Peak Linear Heat Rate",
  hot_channel_factor: "Hot Channel Factor", pressure_drop_kpa: "Pressure Drop",
  reactivity_margin_pcm: "Reactivity Margin",
};

function label(k: string): string {
  return NUCLEAR_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function marginColor(pct: number): string {
  if (pct > 50) return SEMANTIC.positive;
  if (pct > 10) return SEMANTIC.warning;
  return SEMANTIC.negative;
}

function domainLabel(d?: string): string {
  if (!d) return "Assessment";
  const map: Record<string, string> = {
    battery_ecm: "Battery", electrochemical_storage: "Battery",
    pv_iv: "Solar PV", photovoltaic: "Solar PV",
    inverter_dc_ac: "Inverter", power_electronics: "Inverter",
    nuclear_fission: "Nuclear Reactor", small_modular_nuclear: "Small Modular Reactor",
    fuels_chemical: "Chemical Process", electrolysis_conversion: "Electrolyzer",
    heat_pump_hvac: "Heat Pump", fuel_cell_systems: "Fuel Cell",
    concentrated_solar_power: "CSP", geothermal: "Geothermal",
    electric_vehicle: "Electric Vehicle", desalination: "Desalination",
  };
  return map[d] || d.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function isNuclearDomain(d?: string): boolean {
  return d === "nuclear_fission" || d === "small_modular_nuclear";
}

// ── Nuclear-Specific Sections ──────────────────────────────────

interface VerdictCheck {
  name: string;
  pass: boolean;
  value: string;
  detail: string;
}

function computeNuclearVerdict(om: Record<string, unknown>): { overall: "viable" | "marginal" | "not_viable"; checks: VerdictCheck[] } {
  const checks: VerdictCheck[] = [];
  const dnbr = num(om.dnbr_minimum);
  const fuelK = num(om.fuel_centerline_max_k);
  const keff = num(om.k_eff);
  const doppler = num(om.alpha_doppler_pcm_per_k);
  const mtc = num(om.alpha_moderator_pcm_per_k);

  if (dnbr !== null) {
    const pass = dnbr > 1.3;
    const margin = ((dnbr / 1.3 - 1) * 100).toFixed(0);
    checks.push({ name: "Thermal Margin (DNBR)", pass, value: dnbr.toFixed(2),
      detail: pass ? `${margin}% above the 1.3 safety limit — adequate cooling margin` : `Below 1.3 safety limit — risk of cladding failure` });
  }
  if (fuelK !== null) {
    const fuelC = fuelK - 273.15;
    const pass = fuelC < 2840;
    checks.push({ name: "Fuel Integrity", pass, value: `${fuelC.toFixed(0)} °C`,
      detail: pass ? `${(2840 - fuelC).toFixed(0)} °C below UO2 melting point — fuel pellets remain intact` : `Exceeds UO2 melting point — fuel failure` });
  }
  if (keff !== null) {
    const pass = keff > 1.0;
    checks.push({ name: "Criticality", pass, value: keff.toFixed(3),
      detail: pass ? `Core sustains chain reaction with ${((keff - 1) * 100).toFixed(1)}% excess reactivity for burnup and control` : `Subcritical — cannot sustain chain reaction` });
  }
  if (doppler !== null) {
    const pass = doppler < 0;
    checks.push({ name: "Doppler Feedback", pass, value: `${doppler.toFixed(2)} pcm/K`,
      detail: pass ? `Negative — reactor naturally reduces power when fuel heats up (inherent safety)` : `Positive — unstable temperature feedback` });
  }
  if (mtc !== null) {
    const pass = mtc < 0;
    checks.push({ name: "Moderator Feedback", pass, value: `${mtc.toFixed(2)} pcm/K`,
      detail: pass ? `Negative — power decreases if coolant temperature rises (passive safety)` : `Positive — unstable moderator feedback` });
  }

  const fails = checks.filter(c => !c.pass).length;
  const marginals = checks.filter(c => c.pass && c.name === "Thermal Margin (DNBR)" && dnbr !== null && dnbr < 1.8).length;
  const overall = fails > 0 ? "not_viable" : marginals > 0 ? "marginal" : "viable";
  return { overall, checks };
}

function NuclearVerdictHero({ om }: { om: Record<string, unknown> }) {
  const { overall, checks } = computeNuclearVerdict(om);
  if (checks.length === 0) return null;
  const verdictMap = {
    viable: { text: "Physically Viable", desc: "All safety margins are adequate. This design meets the fundamental physics requirements for deployment.", color: SEMANTIC.positive, bg: SEMANTIC.positive + "12" },
    marginal: { text: "Viable with Tight Margins", desc: "The design works but one or more safety margins are narrow. Engineering refinement recommended.", color: SEMANTIC.warning, bg: SEMANTIC.warning + "12" },
    not_viable: { text: "Does Not Meet Safety Requirements", desc: "One or more critical safety checks failed. Design changes required.", color: SEMANTIC.negative, bg: SEMANTIC.negative + "12" },
  };
  const v = verdictMap[overall];

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: v.bg, border: `1px solid ${v.color}30` }}>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[20px] font-bold" style={{ color: v.color }}>{v.text}</span>
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] mb-4">{v.desc}</p>
      <div className="space-y-2.5">
        {checks.map(c => (
          <div key={c.name} className="flex items-start gap-3">
            <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{ backgroundColor: c.pass ? SEMANTIC.positive + "20" : SEMANTIC.negative + "20", color: c.pass ? SEMANTIC.positive : SEMANTIC.negative }}>
              {c.pass ? "\u2713" : "\u2717"}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">{c.name}</span>
                <span className="text-[13px] font-mono" style={{ color: c.pass ? SEMANTIC.positive : SEMANTIC.negative }}>{c.value}</span>
              </div>
              <p className="text-[12px] text-[var(--text-muted)]">{c.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NuclearSafetyBars({ om }: { om: Record<string, unknown> }) {
  const items = [
    { key: "dnbr_minimum", lbl: "DNBR", limit: 1.3, dir: "above" as const, desc: "Boiling safety margin" },
    { key: "fuel_centerline_max_k", lbl: "Fuel Temperature", limit: 3113, dir: "below" as const, desc: "Margin to UO2 melting" },
    { key: "k_eff", lbl: "Criticality", limit: 1.0, dir: "above" as const, desc: "Chain reaction margin" },
  ].map(m => {
    const val = num(om[m.key]);
    if (val === null) return null;
    const pct = m.dir === "above" ? ((val / m.limit - 1) * 100) : ((m.limit / val - 1) * 100);
    return { ...m, value: val, margin: Math.round(pct) };
  }).filter(Boolean) as any[];
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Safety Margins</h3>
      <div className="space-y-3">
        {items.map((d: any) => (
          <div key={d.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] text-[var(--text-secondary)]">{d.lbl}</span>
              <span className="text-[13px] font-semibold" style={{ color: marginColor(d.margin) }}>
                +{d.margin}% margin
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, d.margin)}%`, backgroundColor: marginColor(d.margin) }} />
            </div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{d.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const NUCLEAR_TABLE_ROWS = [
  { key: "k_eff", ref: "Must exceed 1.0" },
  { key: "k_inf", ref: "Typical PWR: 1.25 \u2013 1.40" },
  { key: "dnbr_minimum", ref: "NRC limit: > 1.3" },
  { key: "fuel_centerline_max_k", ref: "UO2 melt: 2840 \u00b0C" },
  { key: "coolant_outlet_temp_k", ref: "NuScale: 321 \u00b0C" },
  { key: "alpha_doppler_pcm_per_k", ref: "Must be negative" },
  { key: "alpha_moderator_pcm_per_k", ref: "Must be negative" },
  { key: "thermal_efficiency", ref: "NuScale: 31%" },
  { key: "net_power_w", ref: "NuScale: 77 MWe" },
  { key: "decay_heat_fraction_1h", ref: "ANS 5.1: ~1.2%" },
  { key: "peak_linear_heat_rate_w_per_m", ref: "Typical: 20 \u2013 45 kW/m" },
];

function NuclearMetricsTable({ om }: { om: Record<string, unknown> }) {
  const rows = NUCLEAR_TABLE_ROWS.map(m => {
    const val = num(om[m.key]);
    if (val === null) return null;
    return { key: m.key, label: label(m.key), display: fmtVal(m.key, val), ref: m.ref };
  }).filter(Boolean) as any[];
  if (rows.length === 0) return null;

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Computed Metrics</h3>
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg-elevated)]">
              <th className="text-left px-3 py-2.5 font-medium text-[var(--text-muted)]">Metric</th>
              <th className="text-right px-3 py-2.5 font-medium text-[var(--text-muted)]">Value</th>
              <th className="text-right px-3 py-2.5 font-medium text-[var(--text-muted)]">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((r: any) => (
              <tr key={r.key} className="hover:bg-[var(--bg-elevated)]/50">
                <td className="px-3 py-2.5 text-[var(--text-secondary)]">{r.label}</td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold text-[var(--text-primary)]">{r.display}</td>
                <td className="px-3 py-2.5 text-right text-[var(--text-muted)] text-[12px]">{r.ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DecayChart({ om }: { om: Record<string, unknown> }) {
  const pts = [
    { key: "decay_heat_fraction_10s", t: "10 sec" }, { key: "decay_heat_fraction_100s", t: "100 sec" },
    { key: "decay_heat_fraction_1000s", t: "17 min" }, { key: "decay_heat_fraction_1h", t: "1 hour" },
    { key: "decay_heat_fraction_24h", t: "24 hours" }, { key: "decay_heat_fraction_30d", t: "30 days" },
  ].map(p => { const v = num(om[p.key]); return v !== null ? { time: p.t, pct: +(v * 100).toFixed(3) } : null; }).filter(Boolean) as any[];
  if (pts.length < 2) return null;

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Decay Heat After Shutdown</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={pts} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="time" {...CHART_AXIS} />
          <YAxis {...CHART_AXIS} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip contentStyle={TT} formatter={(v: number) => [`${v}% of rated power`, "Decay Heat"]} />
          <Line type="monotone" dataKey="pct" stroke={BRAND.amber} strokeWidth={2} dot={{ r: 4, fill: BRAND.amber }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FourFactor({ om }: { om: Record<string, unknown> }) {
  const eta = num(om.eta), f = num(om.f), p = num(om.p), eps = num(om.epsilon), kinf = num(om.k_inf);
  if (eta === null || f === null || p === null || eps === null) return null;
  const data = [
    { name: "Reproduction (\u03b7)", value: eta, color: BRAND.blue },
    { name: "Thermal Util. (f)", value: f, color: BRAND.teal },
    { name: "Resonance Esc. (p)", value: p, color: BRAND.purple },
    { name: "Fast Fission (\u03b5)", value: eps, color: BRAND.cyan },
  ];
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-1">Neutron Multiplication</h3>
      <p className="text-[12px] text-[var(--text-muted)] mb-3">k-infinity = \u03b7 \u00d7 f \u00d7 p \u00d7 \u03b5 = {kinf?.toFixed(3)}</p>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 110 }}>
          <CartesianGrid {...CHART_GRID} horizontal={false} />
          <XAxis type="number" {...CHART_AXIS} domain={[0, 2]} />
          <YAxis type="category" dataKey="name" {...CHART_AXIS} width={105} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={TT} formatter={(v: number) => [v.toFixed(4), "Factor"]} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Generic Sections (all domains) ─────────────────────────────

function getModuleDepth(details: Record<string, unknown> | undefined): { label: string; color: string } | null {
  if (!details) return null;
  const maturity = details.domain_maturity as string | undefined;
  const evidenceTier = details.module_evidence_tier as string | undefined;
  const cap = details.confidence_cap as number | undefined;

  // Derive label from governed metadata only — no hardcoded module names
  if (maturity === "builtin_calibrated" || cap === 1.0)
    return { label: "Calibrated", color: SEMANTIC.positive };
  if (maturity === "benchmarked_generated" && evidenceTier === "supported")
    return { label: "Benchmarked", color: SEMANTIC.warning };
  if (maturity === "benchmarked_generated")
    return { label: "Assessed", color: "var(--text-muted)" };
  if (maturity === "provisional_generated")
    return { label: "Directional", color: "var(--text-dim)" };

  // Metadata absent — don't guess
  return null;
}

function ModuleVerdicts({ evaluation }: { evaluation: Record<string, unknown> }) {
  const mods = evaluation.module_evaluations as Record<string, Record<string, unknown>> | undefined;
  if (!mods || Object.keys(mods).length === 0) return null;

  const verdictColor = (v: string) => {
    if (v === "pass") return SEMANTIC.positive;
    if (v === "conditional") return SEMANTIC.warning;
    if (v === "fail" || v === "blocked") return SEMANTIC.negative;
    return "var(--text-dim)";
  };

  const entries = Object.entries(mods).filter(([, m]) => m && typeof m === "object").sort((a, b) => {
    const order = ["physics", "performance", "economics", "safety", "regulatory", "manufacturing", "environmental", "scalability", "integration", "novelty"];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  });

  const passCount = entries.filter(([, m]) => m.verdict === "pass").length;
  const condCount = entries.filter(([, m]) => m.verdict === "conditional").length;
  const failCount = entries.filter(([, m]) => m.verdict === "fail" || m.verdict === "blocked").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">Module Assessment</h3>
        <div className="flex items-center gap-3 text-[11px]">
          {passCount > 0 && <span style={{ color: SEMANTIC.positive }}>{passCount} pass</span>}
          {condCount > 0 && <span style={{ color: SEMANTIC.warning }}>{condCount} conditional</span>}
          {failCount > 0 && <span style={{ color: SEMANTIC.negative }}>{failCount} blocked</span>}
        </div>
      </div>
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg-elevated)]">
              <th className="text-left px-3 py-2.5 font-medium text-[var(--text-muted)]">Module</th>
              <th className="text-center px-3 py-2.5 font-medium text-[var(--text-muted)]">Verdict</th>
              <th className="text-right px-3 py-2.5 font-medium text-[var(--text-muted)]">Score</th>
              <th className="text-right px-3 py-2.5 font-medium text-[var(--text-muted)]">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {entries.map(([name, m]) => (
              <tr key={name} className="hover:bg-[var(--bg-elevated)]/50">
                <td className="px-3 py-2.5 text-[var(--text-secondary)] capitalize">{name.replace(/_/g, " ")}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ backgroundColor: verdictColor(String(m.verdict)) + "18", color: verdictColor(String(m.verdict)) }}>
                    {String(m.verdict)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[var(--text-primary)]">
                  {typeof m.score_0_100 === "number" ? m.score_0_100 : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[var(--text-muted)]">
                  {typeof m.confidence_0_1 === "number" ? `${Math.round((m.confidence_0_1 as number) * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GenericMetricsTable({ om }: { om: Record<string, unknown> }) {
  // Show ALL output metrics in a clean table (for non-nuclear domains)
  const skipKeys = new Set(["uncertainty_tier", "solver_family", "solver_version", "n_output_metrics", "exergy_metrics", "exergy_status", "exergy_reason"]);
  const rows = Object.entries(om)
    .filter(([k, v]) => !skipKeys.has(k) && (typeof v === "number" || typeof v === "string"))
    .map(([k, v]) => ({
      key: k,
      label: label(k),
      value: typeof v === "number" ? fmtVal(k, v) : String(v),
    }));
  if (rows.length === 0) return null;

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Computed Metrics</h3>
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg-elevated)]">
              <th className="text-left px-3 py-2.5 font-medium text-[var(--text-muted)]">Metric</th>
              <th className="text-right px-3 py-2.5 font-medium text-[var(--text-muted)]">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map(r => (
              <tr key={r.key} className="hover:bg-[var(--bg-elevated)]/50">
                <td className="px-3 py-2.5 text-[var(--text-secondary)]">{r.label}</td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold text-[var(--text-primary)]">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OverallAssessment({ evaluation, brief }: { evaluation?: Record<string, unknown>; brief?: Record<string, unknown> }) {
  const score = num(evaluation?.score as number);
  const mods = evaluation?.module_evaluations as Record<string, Record<string, unknown>> | undefined;
  if (!mods || Object.keys(mods).length === 0) return null;

  const passCount = Object.values(mods).filter(m => m.verdict === "pass").length;
  const total = Object.keys(mods).length;
  const failCount = Object.values(mods).filter(m => m.verdict === "fail" || m.verdict === "blocked").length;

  let overall: "strong" | "conditional" | "weak";
  let text: string, desc: string;
  if (failCount > 0) {
    overall = "weak";
    text = "Significant Gaps Identified";
    desc = `${failCount} of ${total} modules have critical issues that need resolution before deployment.`;
  } else if (passCount >= total * 0.7) {
    overall = "strong";
    text = "Strong Deployment Readiness";
    desc = `${passCount} of ${total} modules pass. This technology shows strong fundamentals across most evaluation dimensions.`;
  } else {
    overall = "conditional";
    text = "Conditional — Needs More Evidence";
    desc = `${passCount} of ${total} modules pass. Additional data would strengthen the assessment in several areas.`;
  }

  const colorMap = { strong: SEMANTIC.positive, conditional: SEMANTIC.warning, weak: SEMANTIC.negative };
  const color = colorMap[overall];

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: color + "12", border: `1px solid ${color}30` }}>
      <span className="text-[20px] font-bold" style={{ color }}>{text}</span>
      <p className="text-[13px] text-[var(--text-secondary)] mt-2">{desc}</p>
      {score !== null && (
        <p className="text-[12px] text-[var(--text-muted)] mt-2">Composite score: {(score * 100).toFixed(1)} / 100</p>
      )}
    </div>
  );
}

// ── Shared Sections ────────────────────────────────────────────

function TransparencySection({ ps }: { ps: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const assumptions = (ps.solver_assumptions as string[]) || [];
  const unmodeled = (ps.unmodeled_phenomena as string[]) || [];
  if (assumptions.length === 0 && unmodeled.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] pt-3">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[12px] text-[var(--text-dim)] hover:text-[var(--text-muted)] transition-colors">
        <span className="text-[10px]">{open ? "\u25BC" : "\u25B6"}</span>
        Methodology details ({assumptions.length} assumptions, {unmodeled.length} limitations)
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-[12px]">
          {assumptions.length > 0 && (
            <div>
              <div className="text-[var(--text-dim)] font-medium mb-1">Assumptions</div>
              {assumptions.map((a, i) => <div key={i} className="text-[var(--text-muted)] ml-3">- {a}</div>)}
            </div>
          )}
          {unmodeled.length > 0 && (
            <div>
              <div className="font-medium mb-1" style={{ color: SEMANTIC.warning }}>Limitations</div>
              {unmodeled.map((u, i) => <div key={i} className="text-[var(--text-muted)] ml-3">- {u.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExergySummary({ ps }: { ps: Record<string, unknown> }) {
  const em = ps.exergy_metrics as Record<string, unknown> | undefined;
  const status = ps.exergy_status as string | undefined;
  const reason = ps.exergy_reason as string | undefined;
  if (!status) return null;
  if (!em || Object.keys(em).length === 0) {
    if (status === "blocked" || status === "failed" || status === "degraded") {
      return <div className="text-[12px] text-[var(--text-dim)] italic mt-2">{reason ? `Exergy analysis: ${reason}` : "Exergy analysis unavailable"}</div>;
    }
    return null;
  }

  const exEff = num(em.exergetic_efficiency);
  const e1Eff = num(em.first_law_efficiency);
  const qf = num(em.quality_factor);
  const carrier = em.carrier_type as string || "unknown";
  const method = em.quality_factor_method as string || "";

  return (
    <div className="border-t border-[var(--border)] pt-4">
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-3">Second-Law Analysis</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
        {exEff !== null && (<><span className="text-[var(--text-muted)]">Exergetic Efficiency</span><span className="font-mono text-[var(--text-primary)]">{(exEff * 100).toFixed(1)}%</span></>)}
        {e1Eff !== null && (<><span className="text-[var(--text-muted)]">First-Law Efficiency</span><span className="font-mono text-[var(--text-primary)]">{(e1Eff * 100).toFixed(1)}%</span></>)}
        {qf !== null && (<><span className="text-[var(--text-muted)]">Quality Factor{method ? ` (${method})` : ""}</span><span className="font-mono text-[var(--text-primary)]">{qf.toFixed(3)}</span></>)}
        <span className="text-[var(--text-muted)]">Energy Carrier</span>
        <span className="font-mono text-[var(--text-primary)]">{carrier.replace(/_/g, " ")}</span>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────

export default function PhysicsResultsView({ physicsSolver, evaluation, brief, domain }: Props) {
  const om = (physicsSolver?.output_metrics as Record<string, unknown>) || {};
  const hasPhysics = Object.keys(om).length > 0;
  const nuclear: boolean = isNuclearDomain(domain) && hasPhysics;
  const hasModules: boolean = !!(evaluation?.module_evaluations && Object.keys(evaluation.module_evaluations as object).length > 0);

  // Nothing to show at all
  if (!hasPhysics && !hasModules && !brief) {
    return (
      <div className="space-y-4">
        <h2 className="text-[18px] font-bold text-[var(--text-primary)]">Detailed Results</h2>
        <p className="text-[13px] text-[var(--text-muted)]">No detailed results available yet. Run an evaluation or simulation to see results here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[18px] font-bold text-[var(--text-primary)]">Detailed Results</h2>
        <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{domainLabel(domain)}</p>
      </div>

      {/* Nuclear-specific: definitive verdict from computed physics */}
      {nuclear && <NuclearVerdictHero om={om} />}

      {/* Generic: overall assessment from module verdicts */}
      {!nuclear && hasModules && <OverallAssessment evaluation={evaluation} brief={brief} />}

      {/* Nuclear-specific: safety margin bars */}
      {nuclear && <NuclearSafetyBars om={om} />}

      {/* Nuclear-specific: computed metrics with references */}
      {nuclear && <NuclearMetricsTable om={om} />}

      {/* Generic: module verdicts table */}
      {hasModules && <ModuleVerdicts evaluation={evaluation!} />}

      {/* Generic: all computed metrics (non-nuclear) */}
      {hasPhysics && !nuclear && <GenericMetricsTable om={om} />}

      {/* Nuclear-specific: decay heat curve */}
      {nuclear && <DecayChart om={om} />}

      {/* Nuclear-specific: four-factor breakdown */}
      {nuclear && <FourFactor om={om} />}

      {/* Shared: solver transparency */}
      {physicsSolver && hasPhysics && <TransparencySection ps={physicsSolver} />}

      {/* Shared: exergy analysis */}
      {physicsSolver && <ExergySummary ps={physicsSolver} />}
    </div>
  );
}
