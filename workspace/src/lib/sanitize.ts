/**
 * Centralized sanitization for all user-facing surfaces.
 *
 * All domain labels, internal term scrubbing, caveat filtering, and
 * credibility labels live here — one source of truth, not per-file filters.
 */

/** Domain ID → human-readable label */
export const DOMAIN_LABELS: Record<string, string> = {
  // Builtin benchmark domains
  pv_iv: "Solar PV", pv: "Solar PV",
  battery_ecm: "Battery", battery: "Battery",
  inverter_dc_ac: "Inverter", inverter: "Inverter",
  // Heat pump / HVAC
  heat_pump_hvac: "Heat Pump", heat_pump_systems: "Heat Pump",
  absorption_chiller: "Absorption Chiller", refrigeration_commercial: "Commercial Refrigeration",
  // Nuclear
  nuclear_fission: "Nuclear Fission", small_modular_nuclear: "Small Modular Reactor",
  // Electrochemical
  electrochemical_storage: "Energy Storage", fuel_cell_hydrogen: "Fuel Cell",
  electrolysis_conversion: "Electrolyzer", flow_battery: "Flow Battery",
  // Thermal / Power
  geothermal_power: "Geothermal", concentrated_solar: "Concentrated Solar",
  organic_rankine: "Organic Rankine Cycle", combined_heat_power: "CHP",
  // Wind / Marine
  wind_turbine_onshore: "Wind Turbine (Onshore)", wind_turbine_offshore: "Wind Turbine (Offshore)",
  marine_energy: "Marine Energy", tidal_energy: "Tidal Energy",
  // Transport
  electric_vehicle: "Electric Vehicle", rail_electrification: "Rail Electrification",
  maritime_propulsion: "Maritime Propulsion",
  // Industrial
  carbon_capture: "Carbon Capture", steel_decarbonization: "Steel Decarbonization",
  hydrogen_production: "Hydrogen Production", ammonia_synthesis: "Ammonia Synthesis",
  // Grid
  grid_distribution: "Grid Distribution", grid_transmission: "Grid Transmission",
  microgrid: "Microgrid",
  // PV variants
  perovskite_solar: "Perovskite Solar", agrivoltaics: "Agrivoltaics",
  // Storage
  thermal_storage: "Thermal Storage", compressed_air: "Compressed Air Storage",
  flywheel_storage: "Flywheel Storage",
  // Other
  desalination: "Desalination", building_energy: "Building Energy",
  led_lighting: "LED Lighting",
};

/** Get human-readable domain label, with fallback formatting */
export function domainLabel(id: string | undefined | null): string {
  if (!id) return "";
  return DOMAIN_LABELS[id] || id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Internal terms that must never appear in user-facing text */
const INTERNAL_PATTERNS = [
  /\bpv_iv\b/gi, /\bbattery_ecm\b/gi, /\binverter_dc_ac\b/gi,
  /\bgeneric_draft\b/gi, /\bgeneric_kernel\b/gi, /\bIRIS-\d\b/gi,
  /\bdeepseek[-_]?reasoner\b/gi, /\bgemma\s*4?\b/gi, /\boracle_sidecar\b/gi,
  /\bintern[-.]s1[-.]pro\b/gi, /\bevidence_evaluation\b/gi,
  /\bdeep_analysis\b/gi, /\bscientific_review\b/gi,
  /\benergy_kernel\b/gi,
];

/** Scrub internal terms from user-facing text */
export function scrubInternalTerms(text: string): string {
  let result = text;
  for (const p of INTERNAL_PATTERNS) {
    result = result.replace(p, "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

/** Filter internal caveats from user-facing lists */
export function filterCaveats(caveats: string[]): string[] {
  return caveats.filter(c =>
    !c.startsWith("Energy kernel:") &&
    !c.includes("domain '") &&
    !c.startsWith("Provisional evaluation") &&
    !c.startsWith("Benchmark-validated") &&
    !c.startsWith("Domain:")
  );
}

/** Credibility tier → user-friendly label */
export function credibilityLabel(tier: string | undefined | null): string {
  switch (tier) {
    case "C3": return "Verified against published reference data";
    case "C2": return "Simulation-based estimate";
    case "C1": return "Preliminary estimate";
    case "C0": return "Baseline comparison only";
    default: return "";
  }
}

/** Check if physics solver produced computed (not fallback) results */
export function isComputedResult(physicsSolver: Record<string, unknown> | undefined | null): boolean {
  if (!physicsSolver) return false;
  return physicsSolver.result_mode === "computed" && Number(physicsSolver.user_params_count || 0) > 0;
}
