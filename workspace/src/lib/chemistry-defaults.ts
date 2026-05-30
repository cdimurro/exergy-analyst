/**
 * Chemistry-specific ECM parameter defaults.
 *
 * Ported from breakthrough_engine/datasheet/derive.py lines 204-214.
 * Each chemistry has grounded default parameters from published literature
 * and commercial cell characterization.
 */

export type ChemistryKey = "lfp" | "nmc" | "nmc811" | "nca" | "lmo" | "lto";

export interface ChemistryProfile {
  key: ChemistryKey;
  label: string;
  fullName: string;
  ocvModel: ChemistryKey;

  // ECM defaults
  R0_mOhm: number;
  R1_mOhm: number;
  C1_F: number;
  nominal_V: number;
  max_V: number;
  cutoff_V: number;
  coulombic_eff: number;
  fade_rate_per_cycle: number;

  // Thermal safety
  thermal_runaway_onset_C: number;
  operating_temp_max_C: number;

  // Typical ranges for validation
  typical_capacity_range_mAh: [number, number];
  typical_impedance_range_mOhm: [number, number];

  // Use cases & notes
  typical_use_cases: string[];
  notes: string;
}

export const CHEMISTRY_PROFILES: Record<ChemistryKey, ChemistryProfile> = {
  lfp: {
    key: "lfp",
    label: "LFP",
    fullName: "Lithium Iron Phosphate (LiFePO4)",
    ocvModel: "lfp",
    R0_mOhm: 42,
    R1_mOhm: 20,
    C1_F: 600,
    nominal_V: 3.2,
    max_V: 3.65,
    cutoff_V: 2.5,
    coulombic_eff: 0.997,
    fade_rate_per_cycle: 0.0002,
    thermal_runaway_onset_C: 270,
    operating_temp_max_C: 60,
    typical_capacity_range_mAh: [500, 6000],
    typical_impedance_range_mOhm: [15, 80],
    typical_use_cases: ["Grid storage", "Solar+storage", "EV buses", "Backup power"],
    notes: "Excellent cycle life and safety. Lower energy density than NMC. Flat voltage plateau.",
  },
  nmc: {
    key: "nmc",
    label: "NMC",
    fullName: "Nickel Manganese Cobalt (NMC-523/622)",
    ocvModel: "nmc",
    R0_mOhm: 25,
    R1_mOhm: 12,
    C1_F: 500,
    nominal_V: 3.7,
    max_V: 4.2,
    cutoff_V: 2.5,
    coulombic_eff: 0.995,
    fade_rate_per_cycle: 0.0004,
    thermal_runaway_onset_C: 210,
    operating_temp_max_C: 55,
    typical_capacity_range_mAh: [1000, 7000],
    typical_impedance_range_mOhm: [10, 60],
    typical_use_cases: ["EV passenger vehicles", "Consumer electronics", "Power tools"],
    notes: "Balanced energy, power, and cost. Moderate cycle life. Cobalt dependency.",
  },
  nmc811: {
    key: "nmc811",
    label: "NMC-811",
    fullName: "Nickel Manganese Cobalt 8:1:1",
    ocvModel: "nmc",
    R0_mOhm: 20,
    R1_mOhm: 10,
    C1_F: 500,
    nominal_V: 3.7,
    max_V: 4.2,
    cutoff_V: 2.5,
    coulombic_eff: 0.995,
    fade_rate_per_cycle: 0.0005,
    thermal_runaway_onset_C: 190,
    operating_temp_max_C: 50,
    typical_capacity_range_mAh: [2000, 8000],
    typical_impedance_range_mOhm: [8, 45],
    typical_use_cases: ["High-range EVs", "Premium electronics"],
    notes: "Highest energy density NMC variant. Lower thermal stability and cycle life than NMC-523.",
  },
  nca: {
    key: "nca",
    label: "NCA",
    fullName: "Nickel Cobalt Aluminum (NCA)",
    ocvModel: "nmc", // NCA OCV similar to NMC
    R0_mOhm: 18,
    R1_mOhm: 9,
    C1_F: 450,
    nominal_V: 3.6,
    max_V: 4.2,
    cutoff_V: 2.5,
    coulombic_eff: 0.995,
    fade_rate_per_cycle: 0.0005,
    thermal_runaway_onset_C: 150,
    operating_temp_max_C: 50,
    typical_capacity_range_mAh: [2000, 6000],
    typical_impedance_range_mOhm: [8, 40],
    typical_use_cases: ["Tesla vehicles", "High-performance EVs"],
    notes: "High energy density. Lowest thermal stability. Requires robust thermal management.",
  },
  lmo: {
    key: "lmo",
    label: "LMO",
    fullName: "Lithium Manganese Oxide (LiMn2O4)",
    ocvModel: "lmo",
    R0_mOhm: 35,
    R1_mOhm: 18,
    C1_F: 400,
    nominal_V: 3.7,
    max_V: 4.2,
    cutoff_V: 2.5,
    coulombic_eff: 0.994,
    fade_rate_per_cycle: 0.0008,
    thermal_runaway_onset_C: 250,
    operating_temp_max_C: 55,
    typical_capacity_range_mAh: [500, 4000],
    typical_impedance_range_mOhm: [15, 70],
    typical_use_cases: ["Power tools", "Medical devices", "Hybrid EVs"],
    notes: "Best rate capability. Shortest cycle life. Cobalt-free. Spinel structure.",
  },
  lto: {
    key: "lto",
    label: "LTO",
    fullName: "Lithium Titanate (Li4Ti5O12)",
    ocvModel: "lto",
    R0_mOhm: 5,
    R1_mOhm: 3,
    C1_F: 800,
    nominal_V: 2.3,
    max_V: 2.8,
    cutoff_V: 1.5,
    coulombic_eff: 0.999,
    fade_rate_per_cycle: 0.00005,
    thermal_runaway_onset_C: 300,
    operating_temp_max_C: 65,
    typical_capacity_range_mAh: [500, 3000],
    typical_impedance_range_mOhm: [2, 20],
    typical_use_cases: ["Fast-charge stations", "Grid frequency regulation", "Cold-climate"],
    notes: "10,000–30,000 cycle life. Very low impedance. Low energy density (2.3V nominal). No lithium plating risk.",
  },
};

/**
 * Create default cell parameters from a chemistry profile.
 */
export function defaultParamsForChemistry(key: ChemistryKey): Record<string, unknown> {
  const p = CHEMISTRY_PROFILES[key];
  return {
    name: "",
    chemistry: key,
    cell_format: "cylindrical",
    capacity_mAh: Math.round((p.typical_capacity_range_mAh[0] + p.typical_capacity_range_mAh[1]) / 2),
    nominal_V: p.nominal_V,
    max_V: p.max_V,
    cutoff_V: p.cutoff_V,
    impedance_mOhm: p.R0_mOhm,
    max_charge_A: 1.0,
    max_discharge_A: 3.0,
    R0_mOhm: p.R0_mOhm,
    R1_mOhm: p.R1_mOhm,
    C1_F: p.C1_F,
    coulombic_efficiency: p.coulombic_eff,
    fade_rate_per_cycle: p.fade_rate_per_cycle,
    weight_g: 50,
    ambient_temp_C: 25,
    operating_temp_max_C: p.operating_temp_max_C,
    cycle_count: 2000,
  };
}

export const CHEMISTRY_KEYS: ChemistryKey[] = ["lfp", "nmc", "nmc811", "nca", "lmo", "lto"];
