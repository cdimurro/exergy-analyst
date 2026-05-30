/**
 * Domain Registry — Central configuration map for multi-domain simulation.
 *
 * Maps SimDomain → DomainConfig with types, defaults, presets, preview runner,
 * metric display, and export functions. The project page reads this registry
 * to render domain-appropriate UI with zero domain-specific branching.
 */

import type { SimDomain, DomainConfig, AnySimParams, AnySimResult, ParamFieldDef, StressPreset } from "./sim-types";
import { DEFAULT_LFP_18650, runSimulation as runBatteryPreview } from "./battery-sim";
import type { CellParams, SimulationResult } from "./battery-sim";
import { defaultPVParams, runPVSimulation, PV_MODULE_PROFILES, PV_MODULE_KEYS } from "./pv-sim";
import type { PVModuleParams, PVSimulationResult } from "./sim-types";
import { defaultInverterParams, runInverterSimulation, INVERTER_TOPOLOGY_PROFILES, INVERTER_TOPOLOGY_KEYS } from "./inverter-sim";
import type { InverterParams, InverterSimulationResult } from "./sim-types";
import { CHEMISTRY_PROFILES, CHEMISTRY_KEYS } from "./chemistry-defaults";

/* ── Helpers ──────────────────────────────────────────────── */

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function safeName(s: string): string { return s.replace(/[^a-z0-9]/gi, "_"); }

/* ── Battery Domain Config ────────────────────────────────── */

const batteryConfig: DomainConfig = {
  domain: "battery",
  label: "Battery",
  defaultParams: () => ({ ...DEFAULT_LFP_18650 } as unknown as AnySimParams),
  paramFields: [
    { key: "capacity_mAh", label: "Capacity", unit: "mAh", min: 100, max: 10000, step: 50 },
    { key: "impedance_mOhm", label: "Impedance", unit: "mOhm", min: 5, max: 200, step: 1 },
    { key: "weight_g", label: "Weight", unit: "g", min: 1, max: 500, step: 1 },
    { key: "ambient_temp_C", label: "Ambient Temp", unit: "°C", min: -30, max: 80, step: 1 },
    { key: "cycle_count", label: "Cycles", unit: "", min: 100, max: 10000, step: 100 },
    { key: "nominal_V", label: "Nominal V", unit: "V", min: 1.0, max: 5.0, step: 0.1 },
    { key: "cutoff_V", label: "Cutoff V", unit: "V", min: 1.5, max: 4.0, step: 0.1 },
    { key: "max_V", label: "Max V", unit: "V", min: 2.0, max: 5.0, step: 0.05 },
  ],
  presetCategories: [{
    label: "Chemistry",
    options: CHEMISTRY_KEYS.map(k => ({ key: k, label: CHEMISTRY_PROFILES[k].label, hint: `${CHEMISTRY_PROFILES[k].nominal_V}V` })),
  }],
  stressPresets: [
    { label: "Baseline", desc: "25°C, standard", patch: { ambient_temp_C: 25, impedance_mOhm: 40, cycle_count: 500 } },
    { label: "High Temp", desc: "60°C stress", patch: { ambient_temp_C: 60, impedance_mOhm: 30, cycle_count: 1000 } },
    { label: "Extreme Heat", desc: "70°C limit", patch: { ambient_temp_C: 70, impedance_mOhm: 40, cycle_count: 500 } },
    { label: "Cold", desc: "-20°C", patch: { ambient_temp_C: -20, impedance_mOhm: 50, cycle_count: 300 } },
    { label: "Endurance", desc: "3000 cycles", patch: { ambient_temp_C: 45, impedance_mOhm: 25, cycle_count: 3000 } },
    { label: "High Z", desc: "80 mOhm", patch: { ambient_temp_C: 45, impedance_mOhm: 80, cycle_count: 800 } },
  ],
  quickButtons: [{ label: "Temperature", field: "ambient_temp_C", values: [{ label: "-20°C", value: -20 }, { label: "0°C", value: 0 }, { label: "25°C", value: 25 }, { label: "45°C", value: 45 }, { label: "60°C", value: 60 }] }],
  runPreview: (params) => runBatteryPreview(params as unknown as CellParams) as unknown as AnySimResult,
  summaryMetrics: (result) => {
    const r = result as unknown as SimulationResult;
    return [
      { label: "Energy Density", value: r.summary.energy_density_Wh_kg, unit: "Wh/kg" },
      { label: "Cycle Life @80%", value: r.summary.cycle_life_80pct.toLocaleString(), unit: "cycles" },
      { label: "Power Density", value: r.summary.power_density_W_kg, unit: "W/kg" },
      { label: "Safe C-Rate", value: r.summary.max_crate_safe, unit: "C" },
      { label: "Overall Grade", value: r.summary.overall_grade, unit: "" },
    ];
  },
  runName: (params) => {
    const p = params as unknown as CellParams;
    return `${(p.chemistry || "LFP").toUpperCase()} @ ${p.ambient_temp_C}°C, R0=${p.impedance_mOhm}mΩ`;
  },
  compareColumns: [
    { label: "Energy (Wh/kg)", key: "energy_density_Wh_kg" },
    { label: "Cycles @80%", key: "cycle_life_80pct" },
    { label: "Power (W/kg)", key: "power_density_W_kg" },
    { label: "Safe C-Rate", key: "max_crate_safe" },
    { label: "Grade", key: "overall_grade" },
  ],
  downloadCSV: (result, name) => {
    const r = result as unknown as SimulationResult;
    const L: string[] = ["Metric,Value,Unit"];
    L.push(`Energy Density,${r.summary.energy_density_Wh_kg},Wh/kg`);
    L.push(`Cycle Life,${r.summary.cycle_life_80pct},cycles`);
    L.push(`Power Density,${r.summary.power_density_W_kg},W/kg`);
    L.push(`Safe C-Rate,${r.summary.max_crate_safe},C`);
    L.push(`Grade,${r.summary.overall_grade},`);
    L.push(""); L.push("C-Rate,Delivered mAh,Avg Voltage V,Energy Wh,Max Temp C,Efficiency %,Runtime min");
    r.crate_metrics.forEach(m => L.push(`${m.cRate},${m.delivered_mAh},${m.avg_voltage},${m.energy_Wh},${m.max_temp_C},${m.efficiency_pct},${m.runtime_min}`));
    L.push(""); L.push("Cycle,Retention %,Resistance Growth %");
    r.cycle_life.forEach(p => L.push(`${p.cycle},${p.retention_pct},${p.resistance_growth_pct}`));
    downloadBlob(L.join("\n"), `${safeName(name)}.csv`, "text/csv");
  },
  downloadJSON: (result, name) => downloadBlob(JSON.stringify(result, null, 2), `${safeName(name)}.json`, "application/json"),
  milestonePrompts: {
    1: "Research the latest published findings on this battery technology, including cycle life benchmarks, degradation mechanisms, and thermal safety data",
    2: "Analyze the research findings. Identify critical parameters, performance gaps, and key risks to test",
    3: "Design a comprehensive simulation plan with baseline, stress tests (high temp, cold, high impedance), and endurance cycling",
    4: "Run all planned simulations now",
    5: "Generate a comprehensive report summarizing all results with deployment recommendations",
  },
};

/* ── PV Domain Config ─────────────────────────────────────── */

const pvConfig: DomainConfig = {
  domain: "pv",
  label: "Solar PV",
  defaultParams: () => defaultPVParams("mono_perc") as unknown as AnySimParams,
  paramFields: [
    { key: "I_L_ref", label: "Photocurrent", unit: "A", min: 5, max: 15, step: 0.1 },
    { key: "I_o_ref", label: "Saturation Current", unit: "nA", min: 0.001, max: 100, step: 0.1 },
    { key: "R_s", label: "Series Resistance", unit: "Ω", min: 0.05, max: 2.0, step: 0.01 },
    { key: "R_sh_ref", label: "Shunt Resistance", unit: "Ω", min: 50, max: 2000, step: 10 },
    { key: "a_ref", label: "Ideality Factor", unit: "V", min: 0.8, max: 2.5, step: 0.05 },
    { key: "N_s", label: "Cells in Series", unit: "", min: 32, max: 144, step: 1 },
    { key: "cell_area_cm2", label: "Cell Area", unit: "cm²", min: 50, max: 250, step: 1 },
    { key: "irradiance", label: "Irradiance", unit: "W/m²", min: 100, max: 1400, step: 50 },
    { key: "cell_temp", label: "Cell Temperature", unit: "°C", min: -10, max: 85, step: 1 },
  ],
  presetCategories: [{
    label: "Module Type",
    options: PV_MODULE_KEYS.map(k => ({ key: k, label: PV_MODULE_PROFILES[k].label })),
  }],
  stressPresets: [
    { label: "STC", desc: "1000 W/m², 25°C", patch: { irradiance: 1000, cell_temp: 25 } },
    { label: "High Irradiance", desc: "1200 W/m²", patch: { irradiance: 1200, cell_temp: 35 } },
    { label: "Low Light", desc: "200 W/m²", patch: { irradiance: 200, cell_temp: 25 } },
    { label: "Hot Climate", desc: "65°C cell", patch: { irradiance: 1000, cell_temp: 65 } },
    { label: "Cold Climate", desc: "-5°C cell", patch: { irradiance: 800, cell_temp: -5 } },
    { label: "Desert Peak", desc: "1200 W/m², 75°C", patch: { irradiance: 1200, cell_temp: 75 } },
  ],
  quickButtons: [
    { label: "Irradiance", field: "irradiance", values: [{ label: "200", value: 200 }, { label: "600", value: 600 }, { label: "1000", value: 1000 }, { label: "1200", value: 1200 }] },
    { label: "Temperature", field: "cell_temp", values: [{ label: "15°C", value: 15 }, { label: "25°C", value: 25 }, { label: "45°C", value: 45 }, { label: "65°C", value: 65 }] },
  ],
  runPreview: (params) => runPVSimulation(params as PVModuleParams) as unknown as AnySimResult,
  summaryMetrics: (result) => {
    const r = result as unknown as PVSimulationResult;
    return [
      { label: "Peak Power", value: r.summary.Pmax, unit: "W" },
      { label: "Efficiency", value: r.summary.efficiency, unit: "%" },
      { label: "Fill Factor", value: r.summary.fill_factor, unit: "" },
      { label: "Voc", value: r.summary.Voc, unit: "V" },
      { label: "Grade", value: r.summary.overall_grade, unit: "" },
    ];
  },
  runName: (params) => {
    const p = params as PVModuleParams;
    const tech = PV_MODULE_PROFILES[p.technology]?.label || p.technology;
    return `${tech} @ ${p.irradiance}W/m², ${p.cell_temp}°C`;
  },
  compareColumns: [
    { label: "Pmax (W)", key: "Pmax" },
    { label: "Efficiency (%)", key: "efficiency" },
    { label: "Fill Factor", key: "fill_factor" },
    { label: "Voc (V)", key: "Voc" },
    { label: "Grade", key: "overall_grade" },
  ],
  downloadCSV: (result, name) => {
    const r = result as unknown as PVSimulationResult;
    const L: string[] = ["Metric,Value,Unit"];
    L.push(`Pmax,${r.metrics.Pmax},W`); L.push(`Efficiency,${r.metrics.efficiency},%`);
    L.push(`Fill Factor,${r.metrics.fill_factor},`); L.push(`Voc,${r.metrics.Voc},V`);
    L.push(`Isc,${r.metrics.Isc},A`); L.push(`Vmp,${r.metrics.Vmp},V`); L.push(`Imp,${r.metrics.Imp},A`);
    L.push(""); L.push("Voltage V,Current A,Power W");
    r.iv_curve.forEach(p => L.push(`${p.voltage},${p.current},${p.power}`));
    L.push(""); L.push("Irradiance W/m2,Pmax W,Efficiency %,FF");
    r.irradiance_sweep.forEach(p => L.push(`${p.variable},${p.Pmax},${p.efficiency},${p.fill_factor}`));
    L.push(""); L.push("Temperature C,Pmax W,Efficiency %,FF");
    r.temp_sweep.forEach(p => L.push(`${p.variable},${p.Pmax},${p.efficiency},${p.fill_factor}`));
    downloadBlob(L.join("\n"), `${safeName(name)}.csv`, "text/csv");
  },
  downloadJSON: (result, name) => downloadBlob(JSON.stringify(result, null, 2), `${safeName(name)}.json`, "application/json"),
  milestonePrompts: {
    1: "Research the latest published data on this PV technology, including efficiency records, degradation rates, and temperature coefficients",
    2: "Analyze the research findings. Identify the critical cell parameters, module performance limits, and degradation risks",
    3: "Design a comprehensive characterization plan with STC baseline, irradiance sweeps, temperature sweeps, and stress conditions",
    4: "Run all planned simulations now",
    5: "Generate a comprehensive report comparing performance across conditions with deployment recommendations",
  },
};

/* ── Inverter Domain Config ───────────────────────────────── */

const inverterConfig: DomainConfig = {
  domain: "inverter",
  label: "Inverter",
  defaultParams: () => defaultInverterParams("string_1ph") as unknown as AnySimParams,
  paramFields: [
    { key: "rated_power_w", label: "Rated Power", unit: "W", min: 100, max: 100000, step: 100 },
    { key: "r_on_mohm", label: "On-Resistance", unit: "mΩ", min: 30, max: 800, step: 5 },
    { key: "f_sw_khz", label: "Switching Freq", unit: "kHz", min: 5, max: 120, step: 1 },
    { key: "e_sw_uj", label: "Switching Energy", unit: "µJ", min: 10, max: 2000, step: 10 },
    { key: "p_aux_w", label: "Standby Power", unit: "W", min: 1, max: 100, step: 1 },
    { key: "v_dc_nom", label: "DC Voltage (nom)", unit: "V", min: 20, max: 1500, step: 10 },
    { key: "t_ambient", label: "Ambient Temp", unit: "°C", min: -10, max: 60, step: 1 },
    { key: "thermal_resistance_cw", label: "Thermal R", unit: "°C/W", min: 0.01, max: 0.3, step: 0.01 },
  ],
  presetCategories: [{
    label: "Topology",
    options: INVERTER_TOPOLOGY_KEYS.map(k => ({ key: k, label: INVERTER_TOPOLOGY_PROFILES[k].label })),
  }],
  stressPresets: [
    { label: "Rated Load", desc: "100%, 25°C", patch: { t_ambient: 25 } },
    { label: "Hot Climate", desc: "55°C ambient", patch: { t_ambient: 55 } },
    { label: "High Z", desc: "500 mΩ R_on", patch: { r_on_mohm: 500 } },
    { label: "SiC Profile", desc: "Low R_on, high f_sw", patch: { r_on_mohm: 120, f_sw_khz: 60, e_sw_uj: 100 } },
    { label: "Budget Si", desc: "High losses", patch: { r_on_mohm: 500, f_sw_khz: 16, e_sw_uj: 600 } },
    { label: "High Power", desc: "50kW central", patch: { rated_power_w: 50000, v_dc_nom: 800, r_on_mohm: 150 } },
  ],
  quickButtons: [
    { label: "Load", field: "_load_pct", values: [{ label: "10%", value: 10 }, { label: "25%", value: 25 }, { label: "50%", value: 50 }, { label: "75%", value: 75 }, { label: "100%", value: 100 }] },
    { label: "Temperature", field: "t_ambient", values: [{ label: "25°C", value: 25 }, { label: "35°C", value: 35 }, { label: "45°C", value: 45 }, { label: "55°C", value: 55 }] },
  ],
  runPreview: (params) => runInverterSimulation(params as InverterParams) as unknown as AnySimResult,
  summaryMetrics: (result) => {
    const r = result as unknown as InverterSimulationResult;
    return [
      { label: "Peak Efficiency", value: r.summary.peak_efficiency, unit: "%" },
      { label: "CEC Weighted", value: r.summary.cec_weighted, unit: "%" },
      { label: "Rated Power", value: r.summary.rated_power_w.toLocaleString(), unit: "W" },
      { label: "Derating Factor", value: r.summary.derating_factor, unit: "" },
      { label: "Grade", value: r.summary.overall_grade, unit: "" },
    ];
  },
  runName: (params) => {
    const p = params as InverterParams;
    const topo = INVERTER_TOPOLOGY_PROFILES[p.topology]?.label || p.topology;
    return `${topo} ${(p.rated_power_w / 1000).toFixed(1)}kW @ ${p.t_ambient}°C`;
  },
  compareColumns: [
    { label: "Peak Eff (%)", key: "peak_efficiency" },
    { label: "CEC Wtd (%)", key: "cec_weighted" },
    { label: "Derating", key: "derating_factor" },
    { label: "Power (W)", key: "rated_power_w" },
    { label: "Grade", key: "overall_grade" },
  ],
  downloadCSV: (result, name) => {
    const r = result as unknown as InverterSimulationResult;
    const L: string[] = ["Metric,Value,Unit"];
    L.push(`Peak Efficiency,${r.metrics.peak_efficiency},%`);
    L.push(`CEC Weighted,${r.metrics.cec_weighted},%`);
    L.push(`Partial Load 10%,${r.metrics.partial_load_10},%`);
    L.push(`Thermal Derating,${r.metrics.thermal_derating_factor},`);
    L.push(`THD Rated,${r.metrics.thd_rated},%`);
    L.push(""); L.push("Load %,Efficiency %,Derating");
    r.efficiency_vs_load.forEach(p => L.push(`${p.variable},${p.efficiency_pct},${p.derating_factor}`));
    L.push(""); L.push("Ambient C,Efficiency %,Derating");
    r.thermal_derating.forEach(p => L.push(`${p.variable},${p.efficiency_pct},${p.derating_factor}`));
    L.push(""); L.push("V_dc V,Efficiency %");
    r.efficiency_vs_vdc.forEach(p => L.push(`${p.variable},${p.efficiency_pct}`));
    downloadBlob(L.join("\n"), `${safeName(name)}.csv`, "text/csv");
  },
  downloadJSON: (result, name) => downloadBlob(JSON.stringify(result, null, 2), `${safeName(name)}.json`, "application/json"),
  milestonePrompts: {
    1: "Research the latest inverter technologies, efficiency benchmarks, and topology comparisons for this application",
    2: "Analyze the findings. Identify optimal topology, switching parameters, and thermal management requirements",
    3: "Design a characterization plan with load sweeps, voltage range tests, and thermal stress conditions",
    4: "Run all planned simulations now",
    5: "Generate a comprehensive report comparing efficiency curves with deployment and sizing recommendations",
  },
};

/* ── Registry ─────────────────────────────────────────────── */

/**
 * Static builtin domain configs — always available, no API call needed.
 * Both short names ("battery") and canonical names ("battery_ecm") resolve here.
 */
export const DOMAIN_REGISTRY: Record<string, DomainConfig> = {
  battery: batteryConfig,
  battery_ecm: batteryConfig,
  pv: pvConfig,
  pv_iv: pvConfig,
  inverter: inverterConfig,
  inverter_dc_ac: inverterConfig,
};

/** Check if a domain has a builtin (optimized) config */
export function hasBuiltinConfig(domain: string): boolean {
  return domain in DOMAIN_REGISTRY;
}

/** Get a domain config — returns builtin if available, null otherwise.
 *  For unknown domains, callers should use the generic fallback pattern. */
export function getDomainConfig(domain: string): DomainConfig | null {
  return DOMAIN_REGISTRY[domain] || null;
}

/** Domain summary from the /api/domains endpoint */
export interface DomainSummary {
  name: string;
  display_name: string;
  description: string;
  maturity: string;
  energy_kernel: string;
  metric_count: number;
  parameter_count: number;
  preset_count: number;
}

/** Fetch available domains from the API (includes builtins + any provisioned domains) */
export async function fetchAvailableDomains(): Promise<DomainSummary[]> {
  try {
    const res = await fetch("/api/domains");
    if (res.ok) return res.json();
  } catch { /* ignore */ }
  // Fallback: return builtin summaries
  return [
    { name: "battery_ecm", display_name: "Battery ECM", description: "Li-ion battery simulation", maturity: "builtin_calibrated", energy_kernel: "electrochemical_storage", metric_count: 9, parameter_count: 9, preset_count: 4 },
    { name: "pv_iv", display_name: "PV I-V", description: "PV module simulation", maturity: "builtin_calibrated", energy_kernel: "photovoltaic", metric_count: 5, parameter_count: 9, preset_count: 4 },
    { name: "inverter_dc_ac", display_name: "DC-AC Inverter", description: "Inverter efficiency simulation", maturity: "builtin_calibrated", energy_kernel: "power_electronics", metric_count: 6, parameter_count: 8, preset_count: 5 },
  ];
}
