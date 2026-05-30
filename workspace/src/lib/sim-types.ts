/**
 * Shared type system for multi-domain simulation.
 *
 * All three domains (battery, PV, inverter) share these union types.
 * Domain-specific types are defined here so the page, registry, and
 * chart components can operate on `AnySimParams` / `AnySimResult`
 * without importing domain-specific engines.
 */

// Re-export battery types (already exist)
export type { CellParams, SimulationResult, PerformanceGrade } from "./battery-sim";

/**
 * Domain identifier. Builtin domains use short names for backward compat.
 * New domains use namespace prefixes: "provisional:h2_pem_v1", "benchmarked:wind_v2".
 * The DOMAIN_REGISTRY resolves both styles.
 */
export type SimDomain = string;

/** Well-known builtin domain IDs for type-safe references */
export const BUILTIN_DOMAINS = ["battery", "pv", "inverter"] as const;
export type BuiltinDomain = typeof BUILTIN_DOMAINS[number];

/** Validate a domain ID string (non-empty, no whitespace, reasonable length) */
export function isValidDomainId(id: string): boolean {
  return id.length > 0 && id.length <= 64 && /^[a-z0-9_:.-]+$/.test(id);
}

/* ── PV Types ─────────────────────────────────────────────── */

export interface PVModuleParams {
  _domain: "pv";
  name: string;
  technology: string;       // "mono_perc" | "topcon" | "hjt" | "ibc" | "cdte" | "cigs"
  I_L_ref: number;          // Photocurrent at reference (A)
  I_o_ref: number;          // Diode saturation current (A)
  R_s: number;              // Series resistance (ohm)
  R_sh_ref: number;         // Shunt resistance (ohm)
  a_ref: number;            // Modified ideality factor (V)
  alpha_sc: number;         // Temp coeff of Isc (A/°C)
  N_s: number;              // Cells in series
  cell_area_cm2: number;    // Cell area (cm²)
  irradiance: number;       // W/m²
  cell_temp: number;        // °C
}

export interface PVIVPoint {
  voltage: number;
  current: number;
  power: number;
}

export interface PVSweepPoint {
  variable: number;         // irradiance or temperature value
  Pmax: number;
  efficiency: number;
  Voc: number;
  Isc: number;
  fill_factor: number;
}

export interface PVSimulationResult {
  params: PVModuleParams;
  iv_curve: PVIVPoint[];
  irradiance_sweep: PVSweepPoint[];
  temp_sweep: PVSweepPoint[];
  metrics: {
    Voc: number;
    Isc: number;
    Vmp: number;
    Imp: number;
    Pmax: number;
    fill_factor: number;
    efficiency: number;
  };
  grades: import("./battery-sim").PerformanceGrade[];
  summary: {
    Pmax: number;
    fill_factor: number;
    efficiency: number;
    Voc: number;
    overall_grade: string;
  };
}

/* ── Inverter Types ───────────────────────────────────────── */

export interface InverterParams {
  _domain: "inverter";
  name: string;
  topology: string;             // "string_1ph" | "string_3ph" | "central" | "microinverter" | "sic_optimized"
  rated_power_w: number;
  v_dc_nom: number;             // Nominal DC input voltage (V)
  v_dc_min: number;             // MPPT lower bound (V)
  v_dc_max: number;             // MPPT upper bound (V)
  v_ac: number;                 // AC output voltage (V)
  r_on_mohm: number;            // Bridge on-resistance (mOhm)
  f_sw_khz: number;             // Switching frequency (kHz)
  e_sw_uj: number;              // Switching energy per event (µJ)
  p_aux_w: number;              // Auxiliary/standby power (W)
  t_ambient: number;            // Ambient temperature (°C)
  t_derate_start: number;       // Derating start temp (°C)
  t_derate_full: number;        // Full derating temp (°C)
  thermal_resistance_cw: number; // Junction-to-ambient (°C/W)
  thd_base_pct: number;         // Base THD at rated load (%)
}

export interface InverterOpPoint {
  load_pct: number;
  efficiency_pct: number;
  p_loss_w: number;
  thd_pct: number;
  derating_factor: number;
  t_junction: number;
}

export interface InverterSweepPoint {
  variable: number;             // load_pct, v_dc, or t_ambient
  efficiency_pct: number;
  derating_factor: number;
}

export interface InverterSimulationResult {
  params: InverterParams;
  efficiency_vs_load: InverterSweepPoint[];
  thermal_derating: InverterSweepPoint[];
  efficiency_vs_vdc: InverterSweepPoint[];
  metrics: {
    peak_efficiency: number;
    cec_weighted: number;
    partial_load_10: number;
    thermal_derating_factor: number;
    thd_rated: number;
    voltage_range_coverage: number;
  };
  grades: import("./battery-sim").PerformanceGrade[];
  summary: {
    peak_efficiency: number;
    cec_weighted: number;
    rated_power_w: number;
    derating_factor: number;
    overall_grade: string;
  };
}

/* ── Union Types ──────────────────────────────────────────── */

export type AnySimParams = import("./battery-sim").CellParams | PVModuleParams | InverterParams;
export type AnySimResult = import("./battery-sim").SimulationResult | PVSimulationResult | InverterSimulationResult;

/* ── Domain Registry Types ────────────────────────────────── */

export interface ParamFieldDef {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export interface StressPreset {
  label: string;
  desc: string;
  patch: Record<string, number | string>;
}

export interface DomainConfig {
  domain: SimDomain;
  label: string;
  defaultParams: () => AnySimParams;
  paramFields: ParamFieldDef[];
  presetCategories: { label: string; options: { key: string; label: string; hint?: string }[] }[];
  stressPresets: StressPreset[];
  quickButtons: { label: string; field: string; values: { label: string; value: number }[] }[];
  runPreview: (params: AnySimParams) => AnySimResult;
  summaryMetrics: (result: AnySimResult) => { label: string; value: string | number; unit: string }[];
  runName: (params: AnySimParams) => string;
  compareColumns: { label: string; key: string }[];
  downloadCSV: (result: AnySimResult, name: string) => void;
  downloadJSON: (result: AnySimResult, name: string) => void;
  milestonePrompts: Record<number, string>;
}
