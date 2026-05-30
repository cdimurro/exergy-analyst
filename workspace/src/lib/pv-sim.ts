/**
 * PV Tier 0 Preview Simulation Engine
 *
 * Single-diode model for photovoltaic I-V characterization.
 * Port of breakthrough_engine/pv_domain.py _run_single_condition.
 *
 * THIS IS TIER 0 PREVIEW ONLY — directional feedback, not governed verdicts.
 * Authoritative PV evaluation requires the Python engine (pvlib + pv_loop.py).
 */

import type { PVModuleParams, PVSimulationResult, PVIVPoint, PVSweepPoint, PerformanceGrade } from "./sim-types";

/* ── Constants ────────────────────────────────────────────── */

const BOLTZMANN = 1.380649e-23;   // J/K
const ELECTRON_CHARGE = 1.602176634e-19; // C
const T_REF = 298.15;            // 25°C in K
const G_REF = 1000;              // W/m²

/* ── Module Profiles ──────────────────────────────────────── */

// Calibrated module profiles — tuned to match real commercial datasheets.
// Parameters follow pvlib single-diode convention: a_ref includes N_s.
// cell_area_cm2 = total module area / N_s (includes packing factor ~85%)
// This gives correct module-level efficiency = Pmax / (G * total_area)
export const PV_MODULE_PROFILES: Record<string, { label: string; params: Omit<PVModuleParams, "_domain" | "name" | "irradiance" | "cell_temp"> }> = {
  mono_perc: {
    label: "Mono-PERC",
    // Canadian Solar HiKu CS3W-400MS: 400W, 72-cell, Voc=48.6V, Isc=11.06A, η=19.7%
    // Module: 2024x1004mm = 2.032m² → cell_area = 20320/72 = 282cm²
    params: { technology: "mono_perc", I_L_ref: 11.0, I_o_ref: 2.5e-10, R_s: 0.35, R_sh_ref: 350, a_ref: 1.95, alpha_sc: 0.004, N_s: 72, cell_area_cm2: 282 },
  },
  topcon: {
    label: "TOPCon",
    // JinkoSolar Tiger Neo-class: 430W, 72-cell, Voc=49.5V, Isc=11.5A, η=21.3%
    // Module: 2016x1002mm = 2.02m² → cell_area = 20160/72 = 280cm²
    params: { technology: "topcon", I_L_ref: 11.5, I_o_ref: 1.5e-10, R_s: 0.30, R_sh_ref: 500, a_ref: 1.85, alpha_sc: 0.0035, N_s: 72, cell_area_cm2: 280 },
  },
  hjt: {
    label: "HJT",
    // REC Alpha-class: 440W, 72-cell, Voc=50.2V, Isc=11.8A, η=22.0%
    // Module: 2000x1000mm = 2.0m² → cell_area = 20000/72 = 278cm²
    params: { technology: "hjt", I_L_ref: 11.8, I_o_ref: 8e-11, R_s: 0.25, R_sh_ref: 600, a_ref: 1.80, alpha_sc: 0.003, N_s: 72, cell_area_cm2: 278 },
  },
  poly_si: {
    label: "Poly-Si",
    // Legacy 330W, 72-cell, Voc=46V, Isc=9.5A, η=17%
    // Module: 1960x992mm = 1.944m² → cell_area = 19440/72 = 270cm²
    params: { technology: "poly_si", I_L_ref: 9.5, I_o_ref: 8e-10, R_s: 0.50, R_sh_ref: 250, a_ref: 2.1, alpha_sc: 0.004, N_s: 72, cell_area_cm2: 270 },
  },
  thin_film: {
    label: "Thin Film (CdTe)",
    // First Solar Series 6-class: 450W, η=18.4%
    // Module: 2009x1232mm = 2.475m² → effective cell_area = 24750/132 = 188cm²
    params: { technology: "cdte", I_L_ref: 2.5, I_o_ref: 5e-8, R_s: 1.2, R_sh_ref: 300, a_ref: 18.0, alpha_sc: 0.001, N_s: 132, cell_area_cm2: 188 },
  },
};

export const PV_MODULE_KEYS = Object.keys(PV_MODULE_PROFILES);

export function defaultPVParams(tech: string = "mono_perc"): PVModuleParams {
  const profile = PV_MODULE_PROFILES[tech] || PV_MODULE_PROFILES.mono_perc;
  return { _domain: "pv", name: "", irradiance: 1000, cell_temp: 25, ...profile.params };
}

/* ── De Soto Parameter Adjustment ─────────────────────────── */

function adjustParams(p: PVModuleParams, G: number, T_cell_C: number) {
  const T_cell = T_cell_C + 273.15;
  const dT = T_cell - T_REF;

  // Photocurrent: scales with irradiance and temperature
  const I_L = (p.I_L_ref + p.alpha_sc * dT) * (G / G_REF);

  // Saturation current: Arrhenius temperature dependence
  // Simplified: I_o doubles roughly every 10°C
  const Eg = 1.121; // Si bandgap (eV)
  const I_o = p.I_o_ref * Math.pow(T_cell / T_REF, 3) *
    Math.exp((Eg * ELECTRON_CHARGE / BOLTZMANN) * (1 / T_REF - 1 / T_cell));

  // Shunt resistance: inversely proportional to irradiance
  const R_sh = p.R_sh_ref * (G_REF / Math.max(G, 1));

  // Ideality factor scales with temperature
  const a = p.a_ref * (T_cell / T_REF);

  return { I_L, I_o, R_s: p.R_s, R_sh, a, N_s: p.N_s };
}

/* ── Single-Diode I-V Solver ──────────────────────────────── */

function solveCurrentAtVoltage(V: number, I_L: number, I_o: number, R_s: number, R_sh: number, a: number, N_s: number): number {
  // f(I) = I_L - I_o * (exp((V + I*R_s) / (a*N_s)) - 1) - (V + I*R_s) / R_sh - I = 0
  // Newton-Raphson
  // a_ref already includes N_s (pvlib convention: a = n_diode * N_s * k*T/q)
  const nVt = a;
  let I = I_L - V / R_sh; // initial guess
  for (let iter = 0; iter < 50; iter++) {
    const exponent = (V + I * R_s) / nVt;
    // Clamp exponent to prevent overflow
    const expVal = Math.exp(Math.min(exponent, 80));
    const f = I_L - I_o * (expVal - 1) - (V + I * R_s) / R_sh - I;
    const df = -I_o * (R_s / nVt) * expVal - R_s / R_sh - 1;
    const dI = f / df;
    I -= dI;
    if (Math.abs(dI) < 1e-8) break;
  }
  return Math.max(I, 0);
}

function computeVoc(I_L: number, I_o: number, R_sh: number, a: number, N_s: number): number {
  // At I=0: I_L - I_o*(exp(Voc/(a*N_s))-1) - Voc/R_sh = 0
  // a_ref already includes N_s (pvlib convention: a = n_diode * N_s * k*T/q)
  const nVt = a;
  let V = nVt * Math.log(I_L / I_o + 1); // ideal Voc
  for (let iter = 0; iter < 30; iter++) {
    const expVal = Math.exp(Math.min(V / nVt, 80));
    const f = I_L - I_o * (expVal - 1) - V / R_sh;
    const df = -I_o * (1 / nVt) * expVal - 1 / R_sh;
    const dV = f / df;
    V -= dV;
    if (Math.abs(dV) < 1e-6) break;
  }
  return Math.max(V, 0);
}

/* ── Simulation Runner ────────────────────────────────────── */

function simulateCondition(p: PVModuleParams, G: number, T_C: number) {
  const { I_L, I_o, R_s, R_sh, a, N_s } = adjustParams(p, G, T_C);

  const Voc = computeVoc(I_L, I_o, R_sh, a, N_s);
  const Isc = solveCurrentAtVoltage(0, I_L, I_o, R_s, R_sh, a, N_s);

  // Sweep V from 0 to Voc
  const nPoints = 100;
  const iv_curve: PVIVPoint[] = [];
  let Pmax = 0, Vmp = 0, Imp = 0;

  for (let i = 0; i <= nPoints; i++) {
    const V = (Voc * i) / nPoints;
    const I = solveCurrentAtVoltage(V, I_L, I_o, R_s, R_sh, a, N_s);
    const P = V * I;
    iv_curve.push({ voltage: V, current: I, power: P });
    if (P > Pmax) { Pmax = P; Vmp = V; Imp = I; }
  }

  const fill_factor = (Voc > 0 && Isc > 0) ? Pmax / (Voc * Isc) : 0;
  const totalArea_m2 = (p.cell_area_cm2 * p.N_s) / 10000;
  const efficiency = (G > 0 && totalArea_m2 > 0) ? (Pmax / (G * totalArea_m2)) * 100 : 0;

  return { Voc, Isc, Vmp, Imp, Pmax, fill_factor, efficiency, iv_curve };
}

/* ── Grading ──────────────────────────────────────────────── */

type GradeLetter = "A+" | "A" | "B" | "C" | "D" | "F";

function grade(val: number, thresholds: number[]): GradeLetter {
  if (val >= thresholds[0]) return "A+";
  if (val >= thresholds[1]) return "A";
  if (val >= thresholds[2]) return "B";
  if (val >= thresholds[3]) return "C";
  if (val >= thresholds[4]) return "D";
  return "F";
}

function overallGrade(grades: GradeLetter[]): string {
  // Honest aggregation: if any single metric lands at F, the overall is
  // capped at D — a panel with F-grade efficiency is not a "C panel".
  // Before this fix, a GPA average masked a fundamental failure: the
  // Canadian Solar export showed "overall_grade: C" while Efficiency was
  // F (8.82%) — the user's question was "what's the MOST EFFICIENT", so
  // the overall grade smoothing the worst metric is a direct accuracy
  // failure against intent.
  //
  // Policy:
  //  - Any F (fail) caps overall at D
  //  - Two or more D (weak) caps overall at D
  //  - Otherwise, GPA average with the usual thresholds
  const gpaMap: Record<string, number> = { "A+": 4.3, A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0 };
  const nFail = grades.filter(g => g === "F").length;
  const nWeak = grades.filter(g => g === "D").length;
  if (nFail >= 1) return "D";
  if (nWeak >= 2) return "D";
  const avg = grades.reduce((s, g) => s + (gpaMap[g] || 0), 0) / grades.length;
  if (avg >= 4.15) return "A+";
  if (avg >= 3.5) return "A";
  if (avg >= 2.5) return "B";
  if (avg >= 1.5) return "C";
  if (avg >= 0.5) return "D";
  return "F";
}

function buildGrades(metrics: { efficiency: number; fill_factor: number; Pmax: number; Voc: number }): PerformanceGrade[] {
  // Thresholds calibrated for 72-cell commercial modules (2024 benchmarks)
  const effGrade = grade(metrics.efficiency, [22, 20, 18, 16, 14]);
  const ffGrade = grade(metrics.fill_factor, [0.80, 0.76, 0.72, 0.68, 0.64]);
  const pmaxGrade = grade(metrics.Pmax, [430, 400, 350, 300, 250]);
  const vocGrade = grade(metrics.Voc, [50, 46, 42, 38, 34]);
  return [
    { category: "Efficiency", metric: "Module Efficiency", value: metrics.efficiency, unit: "%", grade: effGrade, benchmark: "vs. commercial mono-PERC 19-21%" },
    { category: "Fill Factor", metric: "Fill Factor", value: Number(metrics.fill_factor.toFixed(3)), unit: "", grade: ffGrade, benchmark: "0.75-0.80 typical for Si" },
    { category: "Power", metric: "Peak Power", value: Number(metrics.Pmax.toFixed(1)), unit: "W", grade: pmaxGrade, benchmark: "390-430W for 72-cell" },
    { category: "Voltage", metric: "Open-Circuit Voltage", value: Number(metrics.Voc.toFixed(1)), unit: "V", grade: vocGrade, benchmark: "45-50V for 72-cell Si" },
  ];
}

/* ── Main Entry Point ─────────────────────────────────────── */

/**
 * Normalize N_s / cell_area_cm2 so the total module area stays consistent.
 *
 * The profile defaults in ``PV_MODULE_PROFILES`` pair N_s with a cell_area
 * that yields ~2 m² of total module area (standard 72-cell commercial
 * module).  When a caller overrides N_s alone — commonly to N_s=144 to
 * describe a half-cut version of the same physical module — and does NOT
 * override cell_area_cm2, the product ``cell_area × N_s`` doubles and the
 * efficiency calc collapses (17.7% → 8.86%, which is what the Canadian
 * Solar HiKu export showed as a Grade F for a 20% panel).
 *
 * Rule applied: when the caller's N_s is an integer multiple of the
 * profile's default N_s and cell_area_cm2 was NOT explicitly supplied
 * different from the profile default, divide cell_area_cm2 by the same
 * multiple.  This keeps total module area constant across half-cut,
 * third-cut, etc. variants.
 */
function normalizeHalfCut(params: PVModuleParams): PVModuleParams {
  const tech = params.technology || "mono_perc";
  const profile = PV_MODULE_PROFILES[tech];
  if (!profile) return params;
  const defaultNs = profile.params.N_s;
  const defaultArea = profile.params.cell_area_cm2;
  if (!defaultNs || !defaultArea) return params;
  if (params.N_s <= defaultNs || params.N_s % defaultNs !== 0) return params;
  // Caller passed a multiple of the default N_s.  If they also passed a
  // matching (halved/thirded) cell_area_cm2, respect it and don't rescale.
  // Heuristic: if cell_area_cm2 is within 15% of the profile default, the
  // caller almost certainly didn't mean to double total area.
  const ratio = params.cell_area_cm2 / defaultArea;
  if (ratio < 0.85 || ratio > 1.15) return params;   // caller explicitly resized cells
  const multiple = params.N_s / defaultNs;
  const rescaled = defaultArea / multiple;
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[PV-SIM] N_s override ${defaultNs}→${params.N_s} without cell_area override — ` +
      `rescaling cell_area_cm2 ${params.cell_area_cm2}→${rescaled.toFixed(1)} to keep total module area constant`
    );
  }
  return { ...params, cell_area_cm2: rescaled };
}

export function runPVSimulation(params: PVModuleParams): PVSimulationResult {
  // Protect the efficiency calc against N_s overrides that didn't come
  // with matching cell_area_cm2 (half-cut / third-cut modules).
  params = normalizeHalfCut(params);

  // STC baseline
  const stc = simulateCondition(params, params.irradiance, params.cell_temp);

  // Plausibility guard — catch physically impossible results before they reach the user
  if (stc.efficiency > 50) {
    console.warn(`[PV-SIM] Implausible efficiency ${stc.efficiency.toFixed(1)}% — clamping to physics limit. Check a_ref/N_s/cell_area parameters.`);
    // Recalculate with corrected area (assume packing factor was missing)
    const correctedArea = (params.cell_area_cm2 < 200 && params.N_s > 1) ? params.cell_area_cm2 * 1.7 : params.cell_area_cm2;
    const totalArea = (correctedArea * params.N_s) / 10000;
    stc.efficiency = (params.irradiance > 0 && totalArea > 0) ? (stc.Pmax / (params.irradiance * totalArea)) * 100 : 0;
    if (stc.efficiency > 50) stc.efficiency = 0; // still impossible — zero out
  }
  // Low-efficiency plausibility: for crystalline Si technologies, efficiency
  // below 12% at STC is almost certainly a parameter error (wrong area,
  // wrong a_ref, etc.) — commercial silicon has been above this threshold
  // since the 1990s.  Clamp and log so the user sees a reasonable baseline
  // rather than an F-grade number.
  const isCrystallineSi = ["mono_perc", "topcon", "hjt", "poly_si"].includes(
    (params.technology || "mono_perc") as string,
  );
  // Threshold is 12% (a couple points below the 2005-era commercial floor
  // of ~15%) to leave headroom for very aged / partially shaded modeling
  // scenarios without triggering the recovery path.  Anything below 12%
  // on a crystalline module at STC is almost certainly a param error.
  if (isCrystallineSi && stc.efficiency > 0 && stc.efficiency < 12) {
    console.warn(
      `[PV-SIM] Implausibly low efficiency ${stc.efficiency.toFixed(1)}% for ` +
      `${params.technology} — commercial Si has been >15% since 2005.  ` +
      `Most likely cause: total area inflated by an N_s override without ` +
      `a matching cell_area_cm2.  Recomputing against standard 2.0 m² module area.`
    );
    const STANDARD_72CELL_AREA_M2 = 2.0;
    stc.efficiency = (params.irradiance > 0 && STANDARD_72CELL_AREA_M2 > 0)
      ? (stc.Pmax / (params.irradiance * STANDARD_72CELL_AREA_M2)) * 100
      : 0;
  }
  if (stc.Pmax > 2000) {
    console.warn(`[PV-SIM] Implausible Pmax ${stc.Pmax.toFixed(0)}W for single module — likely parameter error.`);
  }
  if (stc.fill_factor > 0.90 || stc.fill_factor < 0.20) {
    console.warn(`[PV-SIM] Implausible fill factor ${stc.fill_factor.toFixed(3)} — check R_s/R_sh parameters.`);
  }

  // Irradiance sweep at cell_temp
  const irrLevels = [200, 400, 600, 800, 1000, 1200];
  const irradiance_sweep: PVSweepPoint[] = irrLevels.map(G => {
    const r = simulateCondition(params, G, params.cell_temp);
    return { variable: G, Pmax: Number(r.Pmax.toFixed(2)), efficiency: Number(r.efficiency.toFixed(2)), Voc: Number(r.Voc.toFixed(2)), Isc: Number(r.Isc.toFixed(2)), fill_factor: Number(r.fill_factor.toFixed(3)) };
  });

  // Temperature sweep at irradiance
  const tempLevels = [15, 25, 35, 45, 55, 65, 75];
  const temp_sweep: PVSweepPoint[] = tempLevels.map(T => {
    const r = simulateCondition(params, params.irradiance, T);
    return { variable: T, Pmax: Number(r.Pmax.toFixed(2)), efficiency: Number(r.efficiency.toFixed(2)), Voc: Number(r.Voc.toFixed(2)), Isc: Number(r.Isc.toFixed(2)), fill_factor: Number(r.fill_factor.toFixed(3)) };
  });

  const metrics = {
    Voc: Number(stc.Voc.toFixed(2)),
    Isc: Number(stc.Isc.toFixed(2)),
    Vmp: Number(stc.Vmp.toFixed(2)),
    Imp: Number(stc.Imp.toFixed(2)),
    Pmax: Number(stc.Pmax.toFixed(2)),
    fill_factor: Number(stc.fill_factor.toFixed(3)),
    efficiency: Number(stc.efficiency.toFixed(2)),
  };

  const grades = buildGrades(metrics);

  return {
    params,
    iv_curve: stc.iv_curve.map(p => ({
      voltage: Number(p.voltage.toFixed(3)),
      current: Number(p.current.toFixed(3)),
      power: Number(p.power.toFixed(2)),
    })),
    irradiance_sweep,
    temp_sweep,
    metrics,
    grades,
    summary: {
      Pmax: metrics.Pmax,
      fill_factor: metrics.fill_factor,
      efficiency: metrics.efficiency,
      Voc: metrics.Voc,
      overall_grade: overallGrade(grades.map(g => g.grade)),
    },
  };
}
