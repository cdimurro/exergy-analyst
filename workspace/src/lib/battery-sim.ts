/**
 * Client-side battery simulation engine.
 *
 * Runs entirely in the browser for instant parameter feedback.
 * Uses simplified ECM + thermal + degradation models calibrated
 * to typical LFP 18650 behavior.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface CellParams {
  name: string;
  chemistry: string;
  capacity_mAh: number;
  nominal_V: number;
  max_V: number;
  cutoff_V: number;
  impedance_mOhm: number;
  max_charge_A: number;
  max_discharge_A: number;
  weight_g: number;
  diameter_mm: number;
  height_mm: number;
  ambient_temp_C: number;
  cycle_count: number;
}

export interface DischargePoint {
  capacity_mAh: number;
  voltage: number;
  soc: number;
  time_min: number;
  temperature_C: number;
}

export interface ThermalPoint {
  time_min: number;
  temperature_C: number;
  heat_gen_W: number;
  cRate: number;
}

export interface CyclePoint {
  cycle: number;
  retention_pct: number;
  resistance_growth_pct: number;
}

export interface CRateMetrics {
  cRate: number;
  delivered_mAh: number;
  avg_voltage: number;
  energy_Wh: number;
  max_temp_C: number;
  efficiency_pct: number;
  runtime_min: number;
}

export interface PerformanceGrade {
  category: string;
  metric: string;
  value: number;
  unit: string;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  benchmark: string;
}

export interface SimulationResult {
  params: CellParams;
  discharge_curves: Record<string, DischargePoint[]>;
  thermal_profiles: Record<string, ThermalPoint[]>;
  cycle_life: CyclePoint[];
  crate_metrics: CRateMetrics[];
  grades: PerformanceGrade[];
  summary: {
    energy_Wh: number;
    energy_density_Wh_kg: number;
    power_density_W_kg: number;
    max_crate_safe: number;
    cycle_life_80pct: number;
    overall_grade: string;
  };
}

// ── OCV model (multi-chemistry dispatch) ───────────────────────────

import { getOCVFunction } from "./ocv-models";
import { CHEMISTRY_PROFILES } from "./chemistry-defaults";
import type { ChemistryKey } from "./chemistry-defaults";

function resolveOCV(params: CellParams): (soc: number) => number {
  const key = (params.chemistry?.toLowerCase() ?? "lfp") as ChemistryKey;
  return getOCVFunction(key);
}

function resolveFadeRate(params: CellParams): number {
  const key = (params.chemistry?.toLowerCase() ?? "lfp") as ChemistryKey;
  const profile = CHEMISTRY_PROFILES[key];
  return profile?.fade_rate_per_cycle ?? 0.0004;
}

// ── Discharge simulation ───────────────────────────────────────────

function simulateDischarge(
  params: CellParams,
  cRate: number,
): { points: DischargePoint[]; thermal: ThermalPoint[] } {
  const cap_Ah = params.capacity_mAh / 1000;
  const I = cRate * cap_Ah;

  // Auto-scale impedance for large-capacity cells.
  // Default impedance (40-50 mOhm) is calibrated for small 18650 cells (3-5 Ah).
  // For large prismatic cells (100+ Ah), impedance should be proportionally lower.
  // Rule of thumb: impedance inversely proportional to capacity.
  let impedance_mOhm = params.impedance_mOhm;
  if (cap_Ah > 10 && impedance_mOhm > 5) {
    // Scale: 50 mOhm @ 5Ah → ~0.9 mOhm @ 280Ah
    const reference_Ah = 5;
    const reference_mOhm = impedance_mOhm;
    impedance_mOhm = Math.max(0.3, (reference_mOhm * reference_Ah) / cap_Ah);
  }
  const R_base = impedance_mOhm / 1000;
  const mass_kg = params.weight_g / 1000;
  const dt_h = 0.002;
  const T_amb = params.ambient_temp_C;

  // Capacity derates at high temperatures and high C-rates
  const temp_capacity_factor = T_amb > 40
    ? 1 - (T_amb - 40) * 0.003    // lose 0.3% capacity per degree above 40°C
    : T_amb < 10
      ? 1 - (10 - T_amb) * 0.008  // lose 0.8% per degree below 10°C (cold penalty)
      : 1.0;
  const crate_capacity_factor = cRate > 2
    ? 1 - (cRate - 2) * 0.04      // lose 4% capacity per C above 2C
    : 1.0;
  const effective_cap_Ah = cap_Ah * Math.max(0.5, temp_capacity_factor * crate_capacity_factor);

  const points: DischargePoint[] = [];
  const thermal: ThermalPoint[] = [];

  let It = 0;
  let T = T_amb;
  let step = 0;

  while (It < effective_cap_Ah * 1.02) {
    const soc = Math.max(0, 1 - It / effective_cap_Ah);
    const ocv = resolveOCV(params)(soc);

    // Temperature-dependent resistance: aggressive Arrhenius-like behavior
    // R doubles roughly every 40°C below 25°C, increases 15% per 10°C above 25°C
    let R = R_base;
    if (T < 25) {
      R *= 1 + 0.025 * (25 - T);  // +2.5% per degree below 25°C
    } else {
      R *= 1 + 0.015 * (T - 25);  // +1.5% per degree above 25°C
    }
    // High-current polarization
    if (cRate > 1) R *= 1 + (cRate - 1) * 0.06;
    if (cRate > 3) R *= 1 + (cRate - 3) * 0.12;

    const V = Math.max(0, ocv - I * R); // Floor at 0V — negative voltage is physically impossible
    if (V < params.cutoff_V || V <= 0 || soc <= 0) break;

    const time_min = (It / I) * 60;

    // Thermal model — more aggressive heating
    const q_gen = I * I * R + Math.abs(I) * 0.005; // ohmic + entropic
    const h_conv = 5.0; // W/(m²·K) — natural convection for cylindrical cell
    const A_surf = 3.85e-3; // m² surface area
    const q_loss = h_conv * A_surf * (T - T_amb);
    const Cp = mass_kg * 1000; // J/K
    T += (q_gen - q_loss) * dt_h * 3600 / Cp;
    T = Math.max(T_amb - 5, Math.min(150, T)); // physical bounds

    if (step % Math.max(1, Math.floor(1 / (cRate * 5))) === 0 || It === 0) {
      points.push({
        capacity_mAh: Math.round(It * 1000 * 10) / 10,
        voltage: Math.round(V * 1000) / 1000,
        soc,
        time_min: Math.round(time_min * 10) / 10,
        temperature_C: Math.round(T * 10) / 10,
      });
      thermal.push({
        time_min: Math.round(time_min * 10) / 10,
        temperature_C: Math.round(T * 10) / 10,
        heat_gen_W: Math.round(q_gen * 1000) / 1000,
        cRate,
      });
    }

    It += I * dt_h;
    step++;
    if (step > 50000) break;
  }

  return { points, thermal };
}

// ── Cycle life simulation ──────────────────────────────────────────

function simulateCycleLife(params: CellParams, cRate: number): CyclePoint[] {
  // Square-root degradation: Q(n) = 1 - alpha * sqrt(n)
  // Aggressive temperature and C-rate dependence for visible differentiation
  const base_alpha = resolveFadeRate(params) * 2.25;

  // C-rate acceleration: 1C baseline, 2C = 1.5x, 3C = 2.5x, 5C = 5x
  const crate_factor = 1 + 0.5 * Math.max(0, cRate - 1) + 0.3 * Math.max(0, cRate - 2) ** 2;

  // Temperature acceleration: Arrhenius-like doubling every 10°C above 25°C
  const T = params.ambient_temp_C;
  const temp_factor = T > 25
    ? Math.pow(2, (T - 25) / 10)  // doubles every 10°C
    : T < 10
      ? 1 + (10 - T) * 0.05       // mild cold stress
      : 1.0;

  const alpha = base_alpha * crate_factor * temp_factor;
  const beta = 0.0005 * crate_factor * Math.sqrt(temp_factor);

  const points: CyclePoint[] = [];
  const nCycles = params.cycle_count;
  const step = Math.max(1, Math.floor(nCycles / 300));

  for (let n = 0; n <= nCycles; n += step) {
    const retention = Math.max(0, (1 - alpha * Math.sqrt(n)) * 100);
    const r_growth = beta * Math.sqrt(n) * 100;
    points.push({
      cycle: n,
      retention_pct: Math.round(retention * 10) / 10,
      resistance_growth_pct: Math.round(r_growth * 10) / 10,
    });
  }

  return points;
}

// ── Grading ────────────────────────────────────────────────────────

function grade(val: number, thresholds: [number, number, number, number, number]): PerformanceGrade["grade"] {
  const [ap, a, b, c, d] = thresholds;
  if (val >= ap) return "A+";
  if (val >= a) return "A";
  if (val >= b) return "B";
  if (val >= c) return "C";
  if (val >= d) return "D";
  return "F";
}

// ── Main simulation ────────────────────────────────────────────────

export function runSimulation(params: CellParams): SimulationResult {
  const cRates = [0.2, 0.5, 1.0, 2.0, 3.0];
  const discharge_curves: Record<string, DischargePoint[]> = {};
  const thermal_profiles: Record<string, ThermalPoint[]> = {};
  const crate_metrics: CRateMetrics[] = [];

  for (const cr of cRates) {
    const key = `${cr}C`;
    const { points, thermal } = simulateDischarge(params, cr);
    discharge_curves[key] = points;
    thermal_profiles[key] = thermal;

    const last = points[points.length - 1];
    const delivered = last?.capacity_mAh ?? 0;
    const avgV = points.length > 0
      ? points.reduce((s, p) => s + p.voltage, 0) / points.length
      : params.nominal_V;
    const energy = (delivered / 1000) * avgV;
    const maxT = Math.max(...thermal.map((t) => t.temperature_C));
    const nominal_energy = (params.capacity_mAh / 1000) * params.nominal_V;
    const eff = nominal_energy > 0 ? (energy / nominal_energy) * 100 : 0;

    crate_metrics.push({
      cRate: cr,
      delivered_mAh: Math.round(delivered),
      avg_voltage: Math.round(avgV * 1000) / 1000,
      energy_Wh: Math.round(energy * 100) / 100,
      max_temp_C: Math.round(maxT * 10) / 10,
      efficiency_pct: Math.round(eff * 10) / 10,
      runtime_min: last?.time_min ?? 0,
    });
  }

  // Cycle life at 1C
  const cycle_life = simulateCycleLife(params, 1.0);

  // Find cycle at 80% retention
  const cycle80 = cycle_life.find((p) => p.retention_pct <= 80)?.cycle ?? params.cycle_count;

  // Nominal metrics
  const nom = crate_metrics.find((m) => m.cRate === 1.0)!;
  const energy_Wh = nom.energy_Wh;
  const weight_kg = params.weight_g / 1000;
  const energy_density = energy_Wh / weight_kg;

  // Peak power at 3C
  const peak = crate_metrics.find((m) => m.cRate === 3.0);
  const peak_power_W = peak ? peak.cRate * (params.capacity_mAh / 1000) * peak.avg_voltage : 0;
  const power_density = peak_power_W / weight_kg;

  // Max safe C-rate (temp < 60°C)
  const safe = [...crate_metrics].reverse().find((m) => m.max_temp_C < 60);
  const max_safe_crate = safe?.cRate ?? 0.2;

  // Grades
  const grades: PerformanceGrade[] = [
    {
      category: "Energy",
      metric: "Specific Energy",
      value: Math.round(energy_density * 10) / 10,
      unit: "Wh/kg",
      grade: grade(energy_density, [250, 180, 120, 80, 50]),
      benchmark: ">250 Wh/kg = A+, >180 = A",
    },
    {
      category: "Power",
      metric: "Specific Power",
      value: Math.round(power_density),
      unit: "W/kg",
      grade: grade(power_density, [1000, 600, 400, 200, 100]),
      benchmark: ">1000 W/kg = A+, >600 = A",
    },
    {
      category: "Efficiency",
      metric: "Coulombic @ 1C",
      value: nom.efficiency_pct,
      unit: "%",
      grade: grade(nom.efficiency_pct, [98, 95, 90, 85, 75]),
      benchmark: ">98% = A+, >95% = A",
    },
    {
      category: "Cycle Life",
      metric: "Cycles to 80%",
      value: cycle80,
      unit: "cycles",
      grade: grade(cycle80, [5000, 2000, 1000, 500, 200]),
      benchmark: ">5000 = A+, >2000 = A",
    },
    {
      category: "Thermal",
      metric: "Max Temp @ 3C",
      value: peak?.max_temp_C ?? 0,
      unit: "°C",
      grade: grade(100 - (peak?.max_temp_C ?? 100), [60, 40, 20, 0, -20]),
      benchmark: "<40°C = A+, <60°C = A",
    },
    {
      category: "Rate Capability",
      metric: "Safe C-rate",
      value: max_safe_crate,
      unit: "C",
      grade: grade(max_safe_crate, [5, 3, 2, 1, 0.5]),
      benchmark: ">5C = A+, >3C = A",
    },
  ];

  const gradePoints: Record<string, number> = { "A+": 4.3, A: 4, B: 3, C: 2, D: 1, F: 0 };
  const avgGpa =
    grades.reduce((s, g) => s + gradePoints[g.grade], 0) / grades.length;
  const overall =
    avgGpa >= 4.0 ? "A+" : avgGpa >= 3.5 ? "A" : avgGpa >= 2.5 ? "B" : avgGpa >= 1.5 ? "C" : "D";

  return {
    params,
    discharge_curves,
    thermal_profiles,
    cycle_life,
    crate_metrics,
    grades,
    summary: {
      energy_Wh,
      energy_density_Wh_kg: Math.round(energy_density * 10) / 10,
      power_density_W_kg: Math.round(power_density),
      max_crate_safe: max_safe_crate,
      cycle_life_80pct: cycle80,
      overall_grade: overall,
    },
  };
}

// ── Default 18650 LFP params ───────────────────────────────────────

export const DEFAULT_LFP_18650: CellParams = {
  name: "Antbatt 18650-3.2V-1600mAh",
  chemistry: "LiFePO4",
  capacity_mAh: 1600,
  nominal_V: 3.2,
  max_V: 3.65,
  cutoff_V: 2.5,
  impedance_mOhm: 40,
  max_charge_A: 1.6,
  max_discharge_A: 4.8,
  weight_g: 41,
  diameter_mm: 18.15,
  height_mm: 65.2,
  ambient_temp_C: 25,
  cycle_count: 2500,
};
