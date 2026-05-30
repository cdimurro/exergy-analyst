/**
 * Inverter Tier 0 Preview Simulation Engine
 *
 * Analytic DC-AC loss model for inverter efficiency characterization.
 * Port of breakthrough_engine/inverter_domain.py (lines 164-340).
 *
 * THIS IS TIER 0 PREVIEW ONLY — directional feedback, not governed verdicts.
 * Authoritative inverter evaluation requires the Python engine (inverter_loop.py).
 */

import type { InverterParams, InverterSimulationResult, InverterSweepPoint, InverterOpPoint, PerformanceGrade } from "./sim-types";

/* ── Topology Profiles ────────────────────────────────────── */

export const INVERTER_TOPOLOGY_PROFILES: Record<string, { label: string; params: Omit<InverterParams, "_domain" | "name" | "t_ambient"> }> = {
  string_1ph: {
    label: "String (1-Phase)",
    params: { topology: "string_1ph", rated_power_w: 5000, v_dc_nom: 360, v_dc_min: 250, v_dc_max: 480, v_ac: 240, r_on_mohm: 350, f_sw_khz: 20, e_sw_uj: 400, p_aux_w: 15, t_derate_start: 55, t_derate_full: 75, thermal_resistance_cw: 0.08, thd_base_pct: 3.0 },
  },
  string_3ph: {
    label: "String (3-Phase)",
    params: { topology: "string_3ph", rated_power_w: 10000, v_dc_nom: 600, v_dc_min: 400, v_dc_max: 800, v_ac: 400, r_on_mohm: 250, f_sw_khz: 16, e_sw_uj: 350, p_aux_w: 20, t_derate_start: 55, t_derate_full: 75, thermal_resistance_cw: 0.06, thd_base_pct: 2.5 },
  },
  central: {
    label: "Central",
    params: { topology: "central", rated_power_w: 50000, v_dc_nom: 800, v_dc_min: 600, v_dc_max: 1000, v_ac: 690, r_on_mohm: 150, f_sw_khz: 12, e_sw_uj: 800, p_aux_w: 80, t_derate_start: 50, t_derate_full: 70, thermal_resistance_cw: 0.04, thd_base_pct: 2.0 },
  },
  microinverter: {
    label: "Microinverter",
    params: { topology: "microinverter", rated_power_w: 400, v_dc_nom: 40, v_dc_min: 25, v_dc_max: 55, v_ac: 240, r_on_mohm: 500, f_sw_khz: 80, e_sw_uj: 80, p_aux_w: 3, t_derate_start: 60, t_derate_full: 80, thermal_resistance_cw: 0.15, thd_base_pct: 3.5 },
  },
  sic_optimized: {
    label: "SiC Optimized",
    params: { topology: "sic_optimized", rated_power_w: 8000, v_dc_nom: 500, v_dc_min: 350, v_dc_max: 650, v_ac: 240, r_on_mohm: 120, f_sw_khz: 60, e_sw_uj: 100, p_aux_w: 10, t_derate_start: 60, t_derate_full: 85, thermal_resistance_cw: 0.05, thd_base_pct: 1.5 },
  },
};

export const INVERTER_TOPOLOGY_KEYS = Object.keys(INVERTER_TOPOLOGY_PROFILES);

export function defaultInverterParams(topology: string = "string_1ph"): InverterParams {
  const profile = INVERTER_TOPOLOGY_PROFILES[topology] || INVERTER_TOPOLOGY_PROFILES.string_1ph;
  return { _domain: "inverter", name: "", t_ambient: 25, ...profile.params };
}

/* ── Core Loss Model ──────────────────────────────────────── */

function computeLosses(p: InverterParams, p_ac_w: number, v_dc: number): { p_cond: number; p_sw: number; p_aux: number; p_total: number; efficiency: number } {
  const r_on = p.r_on_mohm / 1000; // to ohms
  const i_dc = p_ac_w / Math.max(v_dc, 1);

  // Conduction: R_on * I² * 2 (two active switches in H-bridge)
  const p_cond = r_on * i_dc * i_dc * 2;

  // Switching: f_sw * E_sw * (V_dc / V_dc_nom) * 4 (4 transitions per cycle)
  const f_sw = p.f_sw_khz * 1000;
  const e_sw = p.e_sw_uj * 1e-6;
  const p_sw = f_sw * e_sw * (v_dc / Math.max(p.v_dc_nom, 1)) * 4;

  const p_aux = p.p_aux_w;
  const p_total = p_cond + p_sw + p_aux;
  const efficiency = p_ac_w > 0 ? (p_ac_w / (p_ac_w + p_total)) * 100 : 0;

  return { p_cond, p_sw, p_aux, p_total, efficiency: Math.max(0, Math.min(efficiency, 100)) };
}

function computeThermalDerating(p: InverterParams, p_loss: number, t_ambient: number): number {
  const t_junction = t_ambient + p.thermal_resistance_cw * p_loss;
  if (t_junction <= p.t_derate_start) return 1.0;
  if (t_junction >= p.t_derate_full) return 0.0;
  return Math.max(0, 1 - (t_junction - p.t_derate_start) / (p.t_derate_full - p.t_derate_start));
}

function computeTHD(p: InverterParams, load_fraction: number): number {
  const load = Math.max(load_fraction, 0.01);
  return p.thd_base_pct * (1 / Math.sqrt(load)) * (20 / Math.max(p.f_sw_khz, 1));
}

function simulateOperatingPoint(p: InverterParams, load_fraction: number, v_dc: number, t_amb: number): InverterOpPoint {
  const p_ac = p.rated_power_w * load_fraction;
  const losses = computeLosses(p, p_ac, v_dc);
  const derating = computeThermalDerating(p, losses.p_total, t_amb);
  const thd = computeTHD(p, load_fraction);
  const t_junction = t_amb + p.thermal_resistance_cw * losses.p_total;

  return {
    load_pct: load_fraction * 100,
    efficiency_pct: Number(losses.efficiency.toFixed(2)),
    p_loss_w: Number(losses.p_total.toFixed(1)),
    thd_pct: Number(Math.min(thd, 100).toFixed(2)),
    derating_factor: Number(derating.toFixed(3)),
    t_junction: Number(t_junction.toFixed(1)),
  };
}

/* ── CEC Weighted Efficiency ──────────────────────────────── */

function computeCECWeighted(p: InverterParams, v_dc: number, t_amb: number): number {
  const weights = [
    { load: 0.10, w: 0.04 },
    { load: 0.20, w: 0.05 },
    { load: 0.30, w: 0.12 },
    { load: 0.50, w: 0.21 },
    { load: 0.75, w: 0.53 },
    { load: 1.00, w: 0.05 },
  ];
  let weighted = 0;
  for (const { load, w } of weights) {
    const op = simulateOperatingPoint(p, load, v_dc, t_amb);
    weighted += op.efficiency_pct * w;
  }
  return Number(weighted.toFixed(2));
}

/* ── Grading ──────────────────────────────────────────────── */

type GradeLetter = "A+" | "A" | "B" | "C" | "D" | "F";

function gradeVal(val: number, thresholds: number[]): GradeLetter {
  if (val >= thresholds[0]) return "A+";
  if (val >= thresholds[1]) return "A";
  if (val >= thresholds[2]) return "B";
  if (val >= thresholds[3]) return "C";
  if (val >= thresholds[4]) return "D";
  return "F";
}

function overallGrade(grades: GradeLetter[]): string {
  const gpaMap: Record<string, number> = { "A+": 4.3, A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0 };
  const avg = grades.reduce((s, g) => s + (gpaMap[g] || 0), 0) / grades.length;
  if (avg >= 4.15) return "A+";
  if (avg >= 3.5) return "A";
  if (avg >= 2.5) return "B";
  if (avg >= 1.5) return "C";
  if (avg >= 0.5) return "D";
  return "F";
}

function buildGrades(m: { peak_efficiency: number; cec_weighted: number; thermal_derating_factor: number; thd_rated: number }): PerformanceGrade[] {
  const peakG = gradeVal(m.peak_efficiency, [98.5, 97, 95, 93, 90]);
  const cecG = gradeVal(m.cec_weighted, [97.5, 96, 94, 92, 89]);
  const thermalG = gradeVal(m.thermal_derating_factor * 100, [98, 95, 90, 80, 70]);
  const thdG = gradeVal(100 - m.thd_rated, [98, 96, 95, 93, 90]); // lower THD = better

  return [
    { category: "Peak Efficiency", metric: "Peak Efficiency", value: m.peak_efficiency, unit: "%", grade: peakG, benchmark: "96-98.5% string" },
    { category: "CEC Weighted", metric: "CEC Weighted Eff.", value: m.cec_weighted, unit: "%", grade: cecG, benchmark: "95.5-97.5% string" },
    { category: "Thermal", metric: "Thermal Derating", value: Number((m.thermal_derating_factor * 100).toFixed(1)), unit: "%", grade: thermalG, benchmark: "95-100% at 25°C" },
    { category: "Power Quality", metric: "THD at Rated", value: m.thd_rated, unit: "%", grade: thdG, benchmark: "<3% typical" },
  ];
}

/* ── Main Entry Point ─────────────────────────────────────── */

export function runInverterSimulation(params: InverterParams): InverterSimulationResult {
  const v_dc = params.v_dc_nom;
  const t_amb = params.t_ambient;

  // Load sweep
  const loadLevels = [0.05, 0.10, 0.20, 0.30, 0.50, 0.75, 1.00, 1.10];
  const efficiency_vs_load: InverterSweepPoint[] = loadLevels.map(load => {
    const op = simulateOperatingPoint(params, load, v_dc, t_amb);
    return { variable: load * 100, efficiency_pct: op.efficiency_pct, derating_factor: op.derating_factor };
  });

  // Temperature sweep at rated load
  const tempLevels = [25, 30, 35, 40, 45, 50, 55, 60];
  const thermal_derating: InverterSweepPoint[] = tempLevels.map(t => {
    const op = simulateOperatingPoint(params, 1.0, v_dc, t);
    return { variable: t, efficiency_pct: op.efficiency_pct, derating_factor: op.derating_factor };
  });

  // Voltage sweep at 50% load
  const vdcLevels = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3].map(f => f * v_dc);
  const efficiency_vs_vdc: InverterSweepPoint[] = vdcLevels.map(vdc => {
    const op = simulateOperatingPoint(params, 0.5, vdc, t_amb);
    return { variable: Number(vdc.toFixed(0)), efficiency_pct: op.efficiency_pct, derating_factor: op.derating_factor };
  });

  // Key metrics
  const peakOp = efficiency_vs_load.reduce((best, cur) => cur.efficiency_pct > best.efficiency_pct ? cur : best, efficiency_vs_load[0]);
  const ratedOp = simulateOperatingPoint(params, 1.0, v_dc, t_amb);
  const cec_weighted = computeCECWeighted(params, v_dc, t_amb);
  const partialOp = simulateOperatingPoint(params, 0.10, v_dc, t_amb);

  // Voltage range coverage: fraction of Vdc points with efficiency > 90% of peak
  const peakEff = peakOp.efficiency_pct;
  const threshold90 = peakEff * 0.9;
  const coverageCount = efficiency_vs_vdc.filter(p => p.efficiency_pct >= threshold90).length;
  const voltage_range_coverage = coverageCount / efficiency_vs_vdc.length;

  const metrics = {
    peak_efficiency: peakOp.efficiency_pct,
    cec_weighted,
    partial_load_10: partialOp.efficiency_pct,
    thermal_derating_factor: ratedOp.derating_factor,
    thd_rated: ratedOp.thd_pct,
    voltage_range_coverage: Number(voltage_range_coverage.toFixed(2)),
  };

  const grades = buildGrades(metrics);

  return {
    params,
    efficiency_vs_load,
    thermal_derating,
    efficiency_vs_vdc,
    metrics,
    grades,
    summary: {
      peak_efficiency: metrics.peak_efficiency,
      cec_weighted: metrics.cec_weighted,
      rated_power_w: params.rated_power_w,
      derating_factor: metrics.thermal_derating_factor,
      overall_grade: overallGrade(grades.map(g => g.grade)),
    },
  };
}
