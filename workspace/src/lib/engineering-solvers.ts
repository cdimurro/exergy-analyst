type Metric = {
  label: string;
  value: string;
  unit?: string;
  raw_value?: number;
};

export type SolverConfidence = "computed" | "screening" | "needs_inputs";

export interface EngineeringSolverResult {
  status: "ran" | "partial" | "needs_inputs";
  solver_type: "economics" | "physics";
  title: string;
  executive_summary: string;
  confidence: SolverConfidence;
  computed_metrics: Metric[];
  assumptions: string[];
  limitations: string[];
  missing_inputs: string[];
  sensitivity?: Array<{ case: string; metric: string; value: string; note?: string }>;
  normalized_params: Record<string, number>;
}

export const FIRST_PRINCIPLES_SOLVER_FAMILIES = [
  "thermal exergy and Carnot limits",
  "heat-pump and refrigeration second-law calculations",
  "sensible/latent heat and storage balances",
  "heat-exchanger LMTD/UA sizing",
  "pump, fan, hydro, and pressure-drop power",
  "compressor ideal-gas isentropic power",
  "electrolysis Faraday and specific-energy balances",
  "carbon capture energy and net-avoidance balances",
  "reactor conversion/selectivity/yield mass balance",
  "PV irradiance/area/temperature derating",
  "wind rotor power",
  "storage duration and round-trip delivered energy",
  "desalination/recovery and membrane water balance",
  "thermal cycle heat-rate and fuel/exergy efficiency",
  "project economics and levelized cost",
] as const;

const BTU_PER_KWH = 3412.142;
const NATURAL_GAS_CO2_T_PER_MMBTU = 0.05306;
const NATURAL_GAS_EXERGY_FACTOR = 1.04;
const HOURS_PER_YEAR = 8760;
const KELVIN_OFFSET = 273.15;
const WATER_CP_KJ_KG_K = 4.186;
const WATER_DENSITY_KG_M3 = 1000;
const AIR_DENSITY_KG_M3 = 1.225;
const GRAVITY_M_S2 = 9.80665;
const FARADAY_C_PER_MOL = 96485.33212;
const H2_LHV_KWH_PER_KG = 33.33;
const H2_HHV_KWH_PER_KG = 39.4;
const H2_MOLAR_MASS_KG_PER_MOL = 0.00201588;
const WATER_KG_PER_KG_H2 = 8.936;
const O2_KG_PER_KG_H2 = 7.936;
const CO2_KG_PER_T = 1000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberFrom(value: unknown): number | null {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function addParam(params: Record<string, number>, key: string, value: unknown): void {
  const parsed = numberFrom(value);
  if (parsed === null) return;
  params[key] = parsed;
}

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function collectObjectParams(value: unknown, output: Record<string, number>): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (isFiniteNumber(rawValue) || typeof rawValue === "string") {
      addParam(output, normalized, rawValue);
    } else if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      collectObjectParams(rawValue, output);
    }
  }
}

function parseTextParams(text: string, output: Record<string, number>): void {
  const source = text.replace(/,/g, "");
  const grab = (key: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        output[key] = parsed;
        return;
      }
    }
  };

  grab("capacity_mw", [
    /\b(?:net\s+)?(?:capacity|output|power|plant\s+output)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*mw\b/i,
    /\b([-+]?\d+(?:\.\d+)?)\s*mw(?:ac|dc)?\b/i,
  ]);
  grab("capacity_kw", [/\b([-+]?\d+(?:\.\d+)?)\s*kw\b/i]);
  grab("capacity_factor_pct", [
    /\bcapacity\s+factor\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i,
    /\bcf\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i,
  ]);
  grab("heat_rate_btu_per_kwh", [
    /\b(?:net\s+)?heat\s+rate\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*btu\s*\/\s*kwh\b/i,
  ]);
  grab("fuel_price_per_mmbtu", [
    /\b(?:gas|fuel)\s+(?:price|cost)\s*(?:is|=|:)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)\s*\/?\s*mmbtu\b/i,
    /\bgas\s+is\s+\$?\s*([-+]?\d+(?:\.\d+)?)\s*\/?\s*mmbtu\b/i,
  ]);
  grab("electricity_price_per_mwh", [
    /\b(?:power|electricity|merchant\s+power)\s+price\s*(?:is|=|:)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)\s*\/?\s*mwh\b/i,
    /\b\$?\s*([-+]?\d+(?:\.\d+)?)\s*\/\s*mwh\b/i,
  ]);
  grab("capex", [/\bcapex\s*(?:is|=|:)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)\s*(?:m|mm|million)?\b(?!\s*\/)/i]);
  grab("capex_per_kw", [/\bcapex\s*(?:is|=|:)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)\s*\/\s*kw\b/i]);
  grab("opex_per_kw_year", [/\bopex\s*(?:is|=|:)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)\s*\/\s*kw(?:\s*[-/]?\s*yr|year)?\b/i]);
  grab("annual_opex", [/\b(?:annual\s+)?opex\s*(?:is|=|:)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)\s*(?:m|mm|million)?\b(?!\s*\/)/i]);
  grab("discount_rate_pct", [/\b(?:discount\s+rate|wacc)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("lifetime_years", [/\b(?:life|lifetime|project\s+life)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:years?|yr)\b/i]);
  grab("heat_kw", [/\b(?:heat|thermal\s+duty|q)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kw(?:th)?\b/i]);
  grab("heat_mw", [/\b(?:heat|thermal\s+duty|q)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*mw(?:th)?\b/i]);
  grab("hot_temp_c", [/\b(?:hot|sink|delivery|supply)\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("cold_temp_c", [/\b(?:cold|source|return|ambient)\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("reference_temp_c", [/\b(?:reference|dead\s+state|environment)\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("cop", [/\bcop\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)/i]);
  grab("electric_power_kw", [/\b(?:electric|electrical|power\s+input)\s*(?:power|input)?\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kw\b/i]);
  grab("mass_flow_kg_s", [/\bmass\s+flow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\s*\/\s*s\b/i]);
  grab("mass_flow_kg_h", [/\bmass\s+flow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\s*\/\s*h(?:r|our)?\b/i]);
  grab("mass_kg", [/\b(?:mass|inventory|batch)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\b/i]);
  grab("cp_kj_kg_k", [/\bcp\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kj\s*\/\s*kg\s*\/?\s*k\b/i]);
  grab("delta_t_c", [/\b(?:delta\s*t|dt|temperature\s+rise|temperature\s+drop)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|k)\b/i]);
  grab("inlet_temp_c", [/\b(?:inlet|input|feed)\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("outlet_temp_c", [/\b(?:outlet|output|exit)\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("flow_m3_s", [/\bflow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m3\s*\/\s*s\b/i]);
  grab("flow_m3_h", [/\bflow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m3\s*\/\s*h(?:r|our)?\b/i]);
  grab("flow_l_s", [/\bflow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*l\s*\/\s*s\b/i]);
  grab("feed_flow_m3_day", [/\bfeed\s+flow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m3\s*\/\s*d(?:ay)?\b/i]);
  grab("feed_flow_kg_h", [/\bfeed\s+flow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\s*\/\s*h(?:r|our)?\b/i]);
  grab("product_flow_kg_h", [/\bproduct\s+flow\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\s*\/\s*h(?:r|our)?\b/i]);
  grab("delta_p_pa", [/\b(?:delta\s*p|pressure\s+drop)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*pa\b/i]);
  grab("delta_p_kpa", [/\b(?:delta\s*p|pressure\s+drop)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kpa\b/i]);
  grab("delta_p_bar", [/\b(?:delta\s*p|pressure\s+drop)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*bar\b/i]);
  grab("inlet_pressure_bar", [/\b(?:inlet|suction|input)\s+pressure\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*bar\b/i]);
  grab("outlet_pressure_bar", [/\b(?:outlet|discharge|output)\s+pressure\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*bar\b/i]);
  grab("pump_efficiency_pct", [/\bpump\s+efficiency\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("fan_efficiency_pct", [/\bfan\s+efficiency\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("compressor_efficiency_pct", [/\bcompressor\s+efficiency\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("turbine_efficiency_pct", [/\bturbine\s+efficiency\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("efficiency_pct", [/\b(?:efficiency|eta)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("head_m", [/\bhead\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m\b/i]);
  grab("density_kg_m3", [/\bdensity\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\s*\/\s*m3\b/i]);
  grab("rotor_diameter_m", [/\b(?:rotor\s+diameter|diameter)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m\b/i]);
  grab("swept_area_m2", [/\b(?:swept\s+area|area)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m2\b/i]);
  grab("area_m2", [/\barea\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m2\b/i]);
  grab("wind_speed_m_s", [/\bwind\s+speed\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m\s*\/\s*s\b/i]);
  grab("power_coefficient", [/\b(?:cp|power\s+coefficient)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)/i]);
  grab("irradiance_w_m2", [/\b(?:irradiance|solar\s+irradiance)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*w\s*\/\s*m2\b/i]);
  grab("module_efficiency_pct", [/\b(?:module|pv|solar)\s+efficiency\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("temperature_coefficient_pct_c", [/\b(?:temperature\s+coefficient|temp\s+coefficient)\s*(?:is|=|:)?\s*(-?\d+(?:\.\d+)?)\s*%\s*\/\s*(?:c|degc|k)\b/i]);
  grab("cell_temp_c", [/\bcell\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("stc_power_w", [/\b(?:stc|rated|module)\s+power\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*w\b/i]);
  grab("current_a", [/\bcurrent\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*a\b/i]);
  grab("voltage_v", [/\bvoltage\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*v\b/i]);
  grab("cell_voltage_v", [/\bcell\s+voltage\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*v\b/i]);
  grab("n_cells", [/\b(?:cells|cell\s+count|n[_\s]?cells)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)/i]);
  grab("faradaic_efficiency_pct", [/\bfaradaic\s+efficiency\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("specific_energy_kwh_per_kg_h2", [/\b(?:specific\s+energy|energy\s+use|electricity\s+use)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kwh\s*\/\s*kg\s*(?:h2|hydrogen)\b/i]);
  grab("h2_production_kg_h", [/\b(?:h2|hydrogen)\s+(?:production|output|rate)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\s*\/\s*h(?:r|our)?\b/i]);
  grab("co2_capture_t_day", [/\bco2\s+(?:capture|captured|removal)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*t(?:onnes?|ons?)?\s*\/\s*d(?:ay)?\b/i]);
  grab("co2_capture_t_year", [/\bco2\s+(?:capture|captured|removal)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*t(?:onnes?|ons?)?\s*\/\s*y(?:ear|r)?\b/i]);
  grab("capture_rate_pct", [/\b(?:capture\s+rate|co2\s+capture\s+rate)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("energy_kwh_per_tco2", [/\b(?:energy|electricity|power)\s+(?:use|intensity)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kwh\s*\/\s*t(?:co2|onne\s+co2)?\b/i]);
  grab("thermal_energy_gj_per_tco2", [/\bthermal\s+energy\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*gj\s*\/\s*t(?:co2|onne\s+co2)?\b/i]);
  grab("grid_emissions_kg_per_mwh", [/\bgrid\s+(?:emissions|intensity)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kg\s*(?:co2e?|co2)?\s*\/\s*mwh\b/i]);
  grab("conversion_pct", [/\bconversion\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("selectivity_pct", [/\bselectivity\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("yield_pct", [/\byield\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("recovery_pct", [/\brecovery\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("salt_rejection_pct", [/\b(?:salt\s+rejection|rejection)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
  grab("specific_energy_kwh_m3", [/\b(?:specific\s+energy|energy\s+intensity|sec)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*kwh\s*\/\s*m3\b/i]);
  grab("hot_in_temp_c", [/\bhot\s+in(?:let)?\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("hot_out_temp_c", [/\bhot\s+out(?:let)?\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("cold_in_temp_c", [/\bcold\s+in(?:let)?\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("cold_out_temp_c", [/\bcold\s+out(?:let)?\s+(?:temp|temperature)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|degc|degrees?\s*c)\b/i]);
  grab("overall_u_w_m2_k", [/\b(?:overall\s+)?u\s*(?:value|coefficient)?\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*w\s*\/\s*m2\s*\/?\s*k\b/i]);
  grab("heat_transfer_area_m2", [/\bheat\s+transfer\s+area\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*m2\b/i]);
  grab("storage_capacity_mwh", [/\b(?:storage|battery)\s+capacity\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*mwh\b/i]);
  grab("round_trip_efficiency_pct", [/\b(?:round\s*trip|rte)\s+efficiency\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i]);
}

export function collectSolverParams(input: Record<string, unknown>): Record<string, number> {
  const output: Record<string, number> = {};
  collectObjectParams(input, output);
  for (const key of ["question", "description", "query", "prompt"]) {
    const value = input[key];
    if (typeof value === "string") parseTextParams(value, output);
  }
  const params = input.params;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    collectObjectParams(params, output);
  }
  normalizeAliases(output);
  return output;
}

function normalizeAliases(p: Record<string, number>): void {
  const aliasGroups: Array<[string, string[]]> = [
    ["capacity_kw", ["net_capacity_kw", "power_kw", "rated_power_kw"]],
    ["capacity_mw", ["net_capacity_mw", "plant_capacity_mw", "power_mw", "rated_power_mw"]],
    ["capacity_factor_pct", ["cf_pct", "capacity_factor", "load_factor_pct"]],
    ["heat_rate_btu_per_kwh", ["net_heat_rate_btu_kwh", "heat_rate"]],
    ["fuel_price_per_mmbtu", ["gas_price_per_mmbtu", "natural_gas_price_per_mmbtu"]],
    ["electricity_price_per_mwh", ["power_price_per_mwh", "price_per_mwh", "revenue_per_mwh"]],
    ["annual_generation_mwh", ["annual_output_mwh", "generation_mwh"]],
    ["annual_generation_gwh", ["annual_output_gwh", "generation_gwh"]],
    ["discount_rate_pct", ["wacc_pct"]],
    ["lifetime_years", ["life_years", "project_life_years"]],
    ["hot_temp_c", ["sink_temp_c", "delivery_temp_c", "supply_temp_c"]],
    ["cold_temp_c", ["source_temp_c", "ambient_temp_c", "return_temp_c"]],
    ["reference_temp_c", ["t0_c", "dead_state_temp_c", "environment_temp_c"]],
    ["electric_power_kw", ["power_input_kw", "stack_power_kw", "rated_power_kw", "dc_power_kw"]],
    ["heat_kw", ["heat_duty_kw", "thermal_duty_kw", "q_kw"]],
    ["flow_m3_s", ["flow_rate_m3_s", "volumetric_flow_m3_s"]],
    ["mass_flow_kg_s", ["flow_rate_kg_s", "feed_rate_kg_s"]],
    ["overall_u_w_m2_k", ["u_w_per_m2k", "u_value_w_m2k"]],
    ["heat_transfer_area_m2", ["hx_area_m2"]],
    ["area_m2", ["module_area_m2", "panel_area_m2"]],
    ["efficiency_pct", ["thermal_efficiency_pct", "system_efficiency_pct"]],
    ["storage_capacity_mwh", ["energy_capacity_mwh", "battery_capacity_mwh"]],
  ];
  for (const [canonical, aliases] of aliasGroups) {
    if (p[canonical] !== undefined) continue;
    for (const alias of aliases) {
      if (p[alias] !== undefined) {
        p[canonical] = p[alias];
        break;
      }
    }
  }
  if (p.capacity_mw !== undefined && p.capacity_kw === undefined) p.capacity_kw = p.capacity_mw * 1000;
  if (p.capacity_kw !== undefined && p.capacity_mw === undefined) p.capacity_mw = p.capacity_kw / 1000;
  if (p.heat_mw !== undefined && p.heat_kw === undefined) p.heat_kw = p.heat_mw * 1000;
  if (p.heat_kw !== undefined && p.heat_mw === undefined) p.heat_mw = p.heat_kw / 1000;
  if (p.flow_m3_h !== undefined && p.flow_m3_s === undefined) p.flow_m3_s = p.flow_m3_h / 3600;
  if (p.flow_l_s !== undefined && p.flow_m3_s === undefined) p.flow_m3_s = p.flow_l_s / 1000;
  if (p.mass_flow_kg_h !== undefined && p.mass_flow_kg_s === undefined) p.mass_flow_kg_s = p.mass_flow_kg_h / 3600;
  if (p.delta_p_kpa !== undefined && p.delta_p_pa === undefined) p.delta_p_pa = p.delta_p_kpa * 1000;
  if (p.delta_p_bar !== undefined && p.delta_p_pa === undefined) p.delta_p_pa = p.delta_p_bar * 100000;
  if (p.hot_in_temp_c !== undefined && p.hot_out_temp_c !== undefined && p.delta_t_hot_c === undefined) {
    p.delta_t_hot_c = p.hot_in_temp_c - p.hot_out_temp_c;
  }
  if (p.cold_in_temp_c !== undefined && p.cold_out_temp_c !== undefined && p.delta_t_cold_c === undefined) {
    p.delta_t_cold_c = p.cold_out_temp_c - p.cold_in_temp_c;
  }
  if (p.inlet_temp_c !== undefined && p.outlet_temp_c !== undefined && p.delta_t_c === undefined) {
    p.delta_t_c = p.outlet_temp_c - p.inlet_temp_c;
  }
  if (p.co2_capture_t_day !== undefined && p.co2_capture_t_year === undefined) p.co2_capture_t_year = p.co2_capture_t_day * 365;
  if (p.co2_capture_t_year !== undefined && p.co2_capture_t_day === undefined) p.co2_capture_t_day = p.co2_capture_t_year / 365;
  if (p.rotor_diameter_m !== undefined && p.swept_area_m2 === undefined) {
    p.swept_area_m2 = Math.PI * Math.pow(p.rotor_diameter_m / 2, 2);
  }
  if (p.storage_capacity_mwh !== undefined && p.storage_capacity_kwh === undefined) p.storage_capacity_kwh = p.storage_capacity_mwh * 1000;
  if (p.annual_generation_gwh !== undefined && p.annual_generation_mwh === undefined) {
    p.annual_generation_mwh = p.annual_generation_gwh * 1000;
  }
  if (p.annual_generation_mwh !== undefined && p.annual_generation_kwh === undefined) {
    p.annual_generation_kwh = p.annual_generation_mwh * 1000;
  }
}

function metric(label: string, value: number, unit = "", digits = 2): Metric {
  return {
    label,
    value: formatNumber(value, digits),
    unit,
    raw_value: value,
  };
}

function fraction(value: number | undefined, fallback?: number): number | undefined {
  const raw = value ?? fallback;
  if (raw === undefined || !Number.isFinite(raw)) return undefined;
  return raw > 1 ? raw / 100 : raw;
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function addMetric(metrics: Metric[], label: string, value: number | undefined, unit = "", digits = 2): void {
  if (value === undefined || !Number.isFinite(value)) return;
  metrics.push(metric(label, value, unit, digits));
}

function lmtd(deltaT1: number, deltaT2: number): number | null {
  if (deltaT1 <= 0 || deltaT2 <= 0) return null;
  if (Math.abs(deltaT1 - deltaT2) < 1e-9) return deltaT1;
  const ratio = deltaT1 / deltaT2;
  if (ratio <= 0 || ratio === 1) return null;
  return (deltaT1 - deltaT2) / Math.log(ratio);
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  const fixedDigits = abs >= 100 ? Math.min(digits, 1) : digits;
  return value.toLocaleString("en-US", {
    maximumFractionDigits: fixedDigits,
    minimumFractionDigits: 0,
  });
}

function discountFactor(rate: number, year: number): number {
  return 1 / Math.pow(1 + rate, year);
}

function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((sum, cf, index) => sum + cf * (index === 0 ? 1 : discountFactor(rate, index)), 0);
}

function irr(cashflows: number[]): number | null {
  const hasPositive = cashflows.some((cf) => cf > 0);
  const hasNegative = cashflows.some((cf) => cf < 0);
  if (!hasPositive || !hasNegative) return null;
  let low = -0.95;
  let high = 1.0;
  let lowNpv = npv(low, cashflows);
  let highNpv = npv(high, cashflows);
  for (let i = 0; i < 20 && lowNpv * highNpv > 0; i += 1) {
    high *= 2;
    highNpv = npv(high, cashflows);
  }
  if (lowNpv * highNpv > 0) return null;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const midNpv = npv(mid, cashflows);
    if (Math.abs(midNpv) < 1e-6) return mid;
    if (lowNpv * midNpv <= 0) {
      high = mid;
      highNpv = midNpv;
    } else {
      low = mid;
      lowNpv = midNpv;
    }
  }
  return (low + high) / 2;
}

function moneyScale(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value < 10_000 ? value * 1_000_000 : value;
}

export function runEconomicsSolver(input: Record<string, unknown>): EngineeringSolverResult {
  const p = collectSolverParams(input);
  const metrics: Metric[] = [];
  const assumptions: string[] = [];
  const limitations: string[] = [];
  const missing = new Set<string>();
  const sensitivity: EngineeringSolverResult["sensitivity"] = [];

  const capacityKw = p.capacity_kw;
  const capacityMw = p.capacity_mw;
  const cf = p.capacity_factor_pct !== undefined
    ? (p.capacity_factor_pct > 1 ? p.capacity_factor_pct / 100 : p.capacity_factor_pct)
    : undefined;

  let annualMwh = p.annual_generation_mwh;
  if (annualMwh === undefined && capacityKw !== undefined && cf !== undefined) {
    annualMwh = capacityKw * cf * HOURS_PER_YEAR / 1000;
    metrics.push(metric("Annual generation", annualMwh / 1000, "GWh/year", 3));
  }
  if (capacityMw !== undefined) metrics.push(metric("Capacity", capacityMw, "MW", 3));
  if (cf !== undefined) metrics.push(metric("Capacity factor", cf * 100, "%", 2));

  const heatRate = p.heat_rate_btu_per_kwh;
  const fuelPrice = p.fuel_price_per_mmbtu;
  let fuelCostPerMwh: number | undefined;
  if (heatRate !== undefined) {
    const efficiency = BTU_PER_KWH / heatRate;
    metrics.push(metric("Heat-rate efficiency", efficiency * 100, "%", 2));
    if (fuelPrice !== undefined) {
      fuelCostPerMwh = (heatRate / 1000) * fuelPrice;
      metrics.push(metric("Fuel cost", fuelCostPerMwh, "USD/MWh", 2));
    }
  }
  const powerPrice = p.electricity_price_per_mwh;
  if (powerPrice !== undefined) metrics.push(metric("Power price", powerPrice, "USD/MWh", 2));
  if (powerPrice !== undefined && fuelCostPerMwh !== undefined) {
    metrics.push(metric("Spark spread", powerPrice - fuelCostPerMwh, "USD/MWh", 2));
  }

  let totalCapex = moneyScale(p.capex);
  if (totalCapex === undefined && p.capex_per_kw !== undefined && capacityKw !== undefined) {
    totalCapex = p.capex_per_kw * capacityKw;
  }
  if (totalCapex !== undefined) metrics.push(metric("CAPEX", totalCapex / 1_000_000, "USD million", 2));

  let annualOpex = moneyScale(p.annual_opex);
  if (annualOpex === undefined && p.opex_per_kw_year !== undefined && capacityKw !== undefined) {
    annualOpex = p.opex_per_kw_year * capacityKw;
  }
  if (annualOpex !== undefined) metrics.push(metric("Annual OPEX", annualOpex / 1_000_000, "USD million/year", 2));

  const variableCost = (p.variable_opex_per_mwh ?? 0) + (fuelCostPerMwh ?? 0);
  const annualVariableCost = annualMwh !== undefined ? variableCost * annualMwh : undefined;
  const allAnnualOpex = (annualOpex ?? 0) + (annualVariableCost ?? 0);
  if (annualVariableCost !== undefined && variableCost > 0) {
    metrics.push(metric("Variable operating cost", variableCost, "USD/MWh", 2));
  }

  const annualRevenue = annualMwh !== undefined && powerPrice !== undefined ? annualMwh * powerPrice : undefined;
  if (annualRevenue !== undefined) metrics.push(metric("Annual revenue", annualRevenue / 1_000_000, "USD million/year", 2));

  const discountRate = p.discount_rate_pct !== undefined ? p.discount_rate_pct / 100 : (p.discount_rate ?? 0.08);
  const lifetime = Math.max(1, Math.round(p.lifetime_years ?? 20));
  if (p.discount_rate_pct === undefined && (totalCapex !== undefined || annualRevenue !== undefined)) {
    assumptions.push("Discount rate assumed at 8% because no WACC/discount rate was supplied.");
  }
  if (p.lifetime_years === undefined && (totalCapex !== undefined || annualRevenue !== undefined)) {
    assumptions.push("Project life assumed at 20 years because no lifetime was supplied.");
  }

  if (totalCapex !== undefined && annualMwh !== undefined && annualMwh > 0) {
    const crf = discountRate > -1
      ? (discountRate * Math.pow(1 + discountRate, lifetime)) / (Math.pow(1 + discountRate, lifetime) - 1)
      : NaN;
    if (Number.isFinite(crf)) {
      const levelized = (totalCapex * crf + allAnnualOpex) / annualMwh;
      metrics.push(metric("Levelized cost", levelized, "USD/MWh", 2));
    }
  }

  if (totalCapex !== undefined && annualRevenue !== undefined) {
    const annualCashflow = annualRevenue - allAnnualOpex;
    const cashflows = [-totalCapex, ...Array.from({ length: lifetime }, () => annualCashflow)];
    const projectNpv = npv(discountRate, cashflows);
    const projectIrr = irr(cashflows);
    metrics.push(metric("NPV", projectNpv / 1_000_000, "USD million", 2));
    if (projectIrr !== null) metrics.push(metric("IRR", projectIrr * 100, "%", 2));
    if (annualCashflow > 0) metrics.push(metric("Simple payback", totalCapex / annualCashflow, "years", 2));
    sensitivity.push(
      { case: "CAPEX +20%", metric: "NPV", value: `${formatNumber((projectNpv - totalCapex * 0.2) / 1_000_000, 2)} USD million` },
      { case: "CAPEX -20%", metric: "NPV", value: `${formatNumber((projectNpv + totalCapex * 0.2) / 1_000_000, 2)} USD million` },
    );
    if (annualRevenue > 0) {
      sensitivity.push(
        { case: "Revenue +20%", metric: "Annual cash flow", value: `${formatNumber((annualCashflow + annualRevenue * 0.2) / 1_000_000, 2)} USD million/year` },
        { case: "Revenue -20%", metric: "Annual cash flow", value: `${formatNumber((annualCashflow - annualRevenue * 0.2) / 1_000_000, 2)} USD million/year` },
      );
    }
  }

  if (annualMwh === undefined) missing.add("annual production or capacity plus capacity factor");
  if (totalCapex === undefined) missing.add("total CAPEX or CAPEX per kW/unit capacity");
  if (annualOpex === undefined && p.variable_opex_per_mwh === undefined && fuelCostPerMwh === undefined) missing.add("fixed OPEX, variable OPEX, or fuel cost basis");
  if (powerPrice === undefined) missing.add("product/electricity price or revenue basis");

  if (heatRate !== undefined && annualMwh !== undefined) {
    const annualFuelMmbtu = annualMwh * heatRate / 1000;
    const co2 = annualFuelMmbtu * NATURAL_GAS_CO2_T_PER_MMBTU;
    metrics.push(metric("Annual fuel use", annualFuelMmbtu, "MMBtu/year", 0));
    metrics.push(metric("CO2 intensity", (heatRate / 1000) * NATURAL_GAS_CO2_T_PER_MMBTU, "t/MWh", 4));
    metrics.push(metric("Annual CO2", co2, "t/year", 0));
  }

  const status = metrics.length >= 3 ? "ran" : metrics.length > 0 ? "partial" : "needs_inputs";
  const summary = status === "needs_inputs"
    ? "I need at least production, cost, and revenue inputs before I can compute useful economics."
    : status === "ran"
      ? "I computed an economics case from the supplied values."
      : "I computed the available economics metrics from the supplied values.";
  if (status !== "needs_inputs") {
    limitations.push("This is a deterministic finance calculation from supplied inputs; it does not replace a full project finance model with tax, debt, depreciation, incentives, construction schedule, and working capital.");
  }

  return {
    status,
    solver_type: "economics",
    title: "Economics Solver",
    executive_summary: summary,
    confidence: status === "ran" ? "computed" : status === "partial" ? "screening" : "needs_inputs",
    computed_metrics: metrics,
    assumptions,
    limitations,
    missing_inputs: Array.from(missing),
    sensitivity,
    normalized_params: p,
  };
}

function tempKFromC(value: number): number {
  return value + KELVIN_OFFSET;
}

export function runPhysicsSolver(input: Record<string, unknown>): EngineeringSolverResult {
  const p = collectSolverParams(input);
  const metrics: Metric[] = [];
  const assumptions: string[] = [];
  const limitations: string[] = [];
  const missing = new Set<string>();

  const t0C = p.reference_temp_c ?? p.cold_temp_c ?? 25;
  const t0K = tempKFromC(t0C);
  if (p.reference_temp_c === undefined) assumptions.push(`Reference environment assumed at ${t0C} C where needed.`);

  const heatKw = p.heat_kw;
  const hotTempC = p.hot_temp_c ?? p.temperature_c;
  if (heatKw !== undefined && hotTempC !== undefined) {
    const hotK = tempKFromC(hotTempC);
    if (hotK > t0K) {
      const carnot = 1 - t0K / hotK;
      metrics.push(metric("Thermal exergy factor", carnot, "", 4));
      metrics.push(metric("Thermal exergy", heatKw * carnot, "kW_ex", 3));
    } else {
      limitations.push("Hot stream temperature is at or below the reference environment, so useful thermal exergy is zero or not physically meaningful.");
    }
  } else if (heatKw !== undefined || hotTempC !== undefined) {
    missing.add("heat duty plus hot/source temperature for thermal exergy");
  }

  if (p.cop !== undefined && heatKw !== undefined) {
    const electricKw = heatKw / p.cop;
    metrics.push(metric("Electric input", electricKw, "kW", 3));
    if (hotTempC !== undefined && p.cold_temp_c !== undefined) {
      const hotK = tempKFromC(hotTempC);
      const coldK = tempKFromC(p.cold_temp_c);
      if (hotK > coldK) {
        const carnotFactor = 1 - coldK / hotK;
        const usefulHeatExergy = heatKw * carnotFactor;
        metrics.push(metric("Heat-pump useful heat exergy", usefulHeatExergy, "kW_ex", 3));
        metrics.push(metric("Second-law efficiency", usefulHeatExergy / electricKw * 100, "%", 2));
        metrics.push(metric("Carnot COP", hotK / (hotK - coldK), "", 2));
      }
    } else {
      missing.add("hot and cold reservoir temperatures for heat-pump second-law efficiency");
    }
  }

  if (p.mass_flow_kg_s !== undefined && p.delta_t_c !== undefined) {
    const cp = p.cp_kj_kg_k ?? WATER_CP_KJ_KG_K;
    if (p.cp_kj_kg_k === undefined) assumptions.push("Specific heat assumed as water at 4.186 kJ/kg-K.");
    const dutyKw = p.mass_flow_kg_s * cp * p.delta_t_c;
    metrics.push(metric("Sensible heat duty", dutyKw, "kW", 3));
    if (hotTempC !== undefined) {
      const carnot = Math.max(0, 1 - t0K / tempKFromC(hotTempC));
      metrics.push(metric("Sensible heat exergy", dutyKw * carnot, "kW_ex", 3));
    }
  }

  if (p.mass_kg !== undefined && p.delta_t_c !== undefined) {
    const cp = p.cp_kj_kg_k ?? WATER_CP_KJ_KG_K;
    if (p.cp_kj_kg_k === undefined) assumptions.push("Batch sensible-heat calculation assumes water specific heat at 4.186 kJ/kg-K.");
    metrics.push(metric("Batch sensible heat", p.mass_kg * cp * p.delta_t_c / 3600, "kWh", 3));
  }

  if (p.flow_m3_s !== undefined && p.delta_p_pa !== undefined) {
    const eff = p.pump_efficiency_pct !== undefined ? p.pump_efficiency_pct / 100 : (p.pump_efficiency ?? 0.7);
    if (p.pump_efficiency_pct === undefined && p.pump_efficiency === undefined) assumptions.push("Pump efficiency assumed at 70%.");
    metrics.push(metric("Hydraulic pump power", p.flow_m3_s * p.delta_p_pa / Math.max(eff, 0.01) / 1000, "kW", 3));
  }

  if (p.flow_m3_s !== undefined && p.head_m !== undefined) {
    const density = p.density_kg_m3 ?? WATER_DENSITY_KG_M3;
    const eff = fraction(p.turbine_efficiency_pct ?? p.efficiency_pct, p.turbine_efficiency ?? 0.9) ?? 0.9;
    const pumpEff = fraction(p.pump_efficiency_pct, p.pump_efficiency ?? 0.85) ?? 0.85;
    if (p.density_kg_m3 === undefined) assumptions.push("Hydraulic head calculation assumes water density at 1000 kg/m3.");
    metrics.push(metric("Hydro/turbine power", density * GRAVITY_M_S2 * p.flow_m3_s * p.head_m * eff / 1000, "kW", 3));
    metrics.push(metric("Pumping power at head", density * GRAVITY_M_S2 * p.flow_m3_s * p.head_m / Math.max(pumpEff, 0.01) / 1000, "kW", 3));
  }

  if (p.flow_m3_s !== undefined && p.delta_p_pa !== undefined && (p.fan_efficiency_pct !== undefined || p.domain_fan !== undefined)) {
    const eff = fraction(p.fan_efficiency_pct, 0.65) ?? 0.65;
    metrics.push(metric("Fan/blower power", p.flow_m3_s * p.delta_p_pa / Math.max(eff, 0.01) / 1000, "kW", 3));
  }

  if (positive(p.mass_flow_kg_s) && positive(p.inlet_pressure_bar) && positive(p.outlet_pressure_bar)) {
    const gamma = p.gamma ?? 1.4;
    const gasR = p.gas_r_j_kg_k ?? 287;
    const inletK = tempKFromC(p.inlet_temp_c ?? p.cold_temp_c ?? 25);
    const eff = fraction(p.compressor_efficiency_pct, p.compressor_efficiency ?? 0.75) ?? 0.75;
    const pressureRatio = p.outlet_pressure_bar / p.inlet_pressure_bar;
    if (pressureRatio > 1 && gamma > 1) {
      const specificWorkJkg = gamma / (gamma - 1) * gasR * inletK * (Math.pow(pressureRatio, (gamma - 1) / gamma) - 1) / Math.max(eff, 0.01);
      metrics.push(metric("Compressor power", p.mass_flow_kg_s * specificWorkJkg / 1000, "kW", 3));
      metrics.push(metric("Compressor specific work", specificWorkJkg / 1000, "kJ/kg", 2));
    }
  }

  if (
    p.hot_in_temp_c !== undefined &&
    p.hot_out_temp_c !== undefined &&
    p.cold_in_temp_c !== undefined &&
    p.cold_out_temp_c !== undefined
  ) {
    const counterflowLmtd = lmtd(p.hot_in_temp_c - p.cold_out_temp_c, p.hot_out_temp_c - p.cold_in_temp_c);
    if (counterflowLmtd !== null) {
      metrics.push(metric("Heat-exchanger LMTD", counterflowLmtd, "K", 2));
      if (p.heat_kw !== undefined && p.overall_u_w_m2_k !== undefined) {
        metrics.push(metric("Required heat-transfer area", p.heat_kw * 1000 / (p.overall_u_w_m2_k * counterflowLmtd), "m2", 2));
      }
      if (p.heat_transfer_area_m2 !== undefined && p.overall_u_w_m2_k !== undefined) {
        metrics.push(metric("UA heat-transfer capacity", p.overall_u_w_m2_k * p.heat_transfer_area_m2 * counterflowLmtd / 1000, "kW", 2));
      }
      if (p.heat_kw !== undefined) {
        const cHot = p.heat_kw / Math.max(p.hot_in_temp_c - p.hot_out_temp_c, 0.001);
        const cCold = p.heat_kw / Math.max(p.cold_out_temp_c - p.cold_in_temp_c, 0.001);
        const qMax = Math.min(cHot, cCold) * (p.hot_in_temp_c - p.cold_in_temp_c);
        if (qMax > 0) metrics.push(metric("Heat-exchanger effectiveness", p.heat_kw / qMax, "", 4));
      }
    } else {
      limitations.push("Heat-exchanger terminal temperatures cross or touch, so LMTD sizing is not physically meaningful.");
    }
  }

  if (p.irradiance_w_m2 !== undefined && p.area_m2 !== undefined && (p.module_efficiency_pct !== undefined || p.efficiency_pct !== undefined)) {
    const eff = fraction(p.module_efficiency_pct ?? p.efficiency_pct) ?? 0;
    let powerW = p.irradiance_w_m2 * p.area_m2 * eff;
    if (p.temperature_coefficient_pct_c !== undefined && p.cell_temp_c !== undefined) {
      powerW *= 1 + (p.temperature_coefficient_pct_c / 100) * (p.cell_temp_c - 25);
    }
    metrics.push(metric("PV DC power", powerW, "W", 1));
    metrics.push(metric("PV DC power", powerW / 1000, "kW", 3));
  } else if (p.stc_power_w !== undefined && p.irradiance_w_m2 !== undefined) {
    let powerW = p.stc_power_w * p.irradiance_w_m2 / 1000;
    if (p.temperature_coefficient_pct_c !== undefined && p.cell_temp_c !== undefined) {
      powerW *= 1 + (p.temperature_coefficient_pct_c / 100) * (p.cell_temp_c - 25);
    }
    metrics.push(metric("PV DC power", powerW, "W", 1));
  }

  if (p.wind_speed_m_s !== undefined && p.swept_area_m2 !== undefined) {
    const rho = p.density_kg_m3 ?? AIR_DENSITY_KG_M3;
    const cp = p.power_coefficient ?? 0.42;
    const eff = fraction(p.efficiency_pct, 1) ?? 1;
    if (p.power_coefficient === undefined) assumptions.push("Wind calculation assumes power coefficient Cp=0.42 unless supplied.");
    metrics.push(metric("Wind rotor power", 0.5 * rho * p.swept_area_m2 * Math.pow(p.wind_speed_m_s, 3) * cp * eff / 1000, "kW", 3));
    metrics.push(metric("Betz-limit wind power", 0.5 * rho * p.swept_area_m2 * Math.pow(p.wind_speed_m_s, 3) * 0.593 / 1000, "kW", 3));
  }

  if (p.electric_power_kw !== undefined && p.specific_energy_kwh_per_kg_h2 !== undefined) {
    const h2KgH = p.electric_power_kw / p.specific_energy_kwh_per_kg_h2;
    metrics.push(metric("Hydrogen production", h2KgH, "kg H2/hour", 3));
    metrics.push(metric("Hydrogen production", h2KgH * HOURS_PER_YEAR / 1000, "t H2/year", 2));
    metrics.push(metric("Electrolyzer LHV efficiency", H2_LHV_KWH_PER_KG / p.specific_energy_kwh_per_kg_h2 * 100, "%", 2));
    metrics.push(metric("Water feed consumption", h2KgH * WATER_KG_PER_KG_H2, "kg/hour", 2));
    metrics.push(metric("Oxygen byproduct", h2KgH * O2_KG_PER_KG_H2, "kg/hour", 2));
  }

  if (p.current_a !== undefined && (p.cell_voltage_v !== undefined || p.voltage_v !== undefined) && p.n_cells !== undefined) {
    const faradaic = fraction(p.faradaic_efficiency_pct, 1) ?? 1;
    const h2KgS = p.current_a * p.n_cells / (2 * FARADAY_C_PER_MOL) * H2_MOLAR_MASS_KG_PER_MOL * faradaic;
    const voltage = p.cell_voltage_v ?? p.voltage_v ?? 0;
    const electricKw = p.current_a * voltage * p.n_cells / 1000;
    const h2KgH = h2KgS * 3600;
    metrics.push(metric("Faraday hydrogen production", h2KgH, "kg H2/hour", 4));
    metrics.push(metric("Stack electric power", electricKw, "kW", 3));
    if (h2KgH > 0) {
      const specificEnergy = electricKw / h2KgH;
      metrics.push(metric("Electrolysis specific energy", specificEnergy, "kWh/kg H2", 2));
      metrics.push(metric("Electrolyzer LHV efficiency", H2_LHV_KWH_PER_KG / specificEnergy * 100, "%", 2));
      metrics.push(metric("Electrolyzer HHV efficiency", H2_HHV_KWH_PER_KG / specificEnergy * 100, "%", 2));
    }
  }

  if (p.h2_production_kg_h !== undefined && p.specific_energy_kwh_per_kg_h2 !== undefined) {
    metrics.push(metric("Electrolyzer electric load", p.h2_production_kg_h * p.specific_energy_kwh_per_kg_h2, "kW", 3));
    metrics.push(metric("Water feed consumption", p.h2_production_kg_h * WATER_KG_PER_KG_H2, "kg/hour", 2));
  }

  if (p.co2_capture_t_year !== undefined) {
    metrics.push(metric("CO2 captured", p.co2_capture_t_year, "t CO2/year", 0));
    if (p.energy_kwh_per_tco2 !== undefined) {
      const annualElectricMwh = p.co2_capture_t_year * p.energy_kwh_per_tco2 / 1000;
      metrics.push(metric("Capture electricity use", annualElectricMwh, "MWh/year", 1));
      if (p.co2_capture_t_day !== undefined) {
        metrics.push(metric("Average capture electric load", p.co2_capture_t_day * p.energy_kwh_per_tco2 / 24, "kW", 2));
      }
      if (p.grid_emissions_kg_per_mwh !== undefined) {
        const energyEmissionsT = annualElectricMwh * p.grid_emissions_kg_per_mwh / CO2_KG_PER_T;
        metrics.push(metric("Energy-related CO2 emissions", energyEmissionsT, "t CO2/year", 0));
        metrics.push(metric("Net CO2 avoided", p.co2_capture_t_year - energyEmissionsT, "t CO2/year", 0));
      }
    }
    if (p.thermal_energy_gj_per_tco2 !== undefined) {
      metrics.push(metric("Capture thermal energy", p.co2_capture_t_year * p.thermal_energy_gj_per_tco2, "GJ/year", 0));
    }
  }

  if (p.feed_flow_kg_h !== undefined && (p.conversion_pct !== undefined || p.yield_pct !== undefined || p.selectivity_pct !== undefined)) {
    const conversion = fraction(p.conversion_pct, 1) ?? 1;
    const selectivity = fraction(p.selectivity_pct, 1) ?? 1;
    const yieldFrac = fraction(p.yield_pct, conversion * selectivity) ?? conversion * selectivity;
    metrics.push(metric("Converted feed", p.feed_flow_kg_h * conversion, "kg/hour", 3));
    metrics.push(metric("Target product rate", p.feed_flow_kg_h * yieldFrac, "kg/hour", 3));
    metrics.push(metric("Overall yield", yieldFrac * 100, "%", 2));
  }

  if (p.product_flow_kg_h !== undefined && p.feed_flow_kg_h !== undefined) {
    metrics.push(metric("Mass yield", p.product_flow_kg_h / p.feed_flow_kg_h * 100, "%", 2));
  }

  if (p.feed_flow_m3_day !== undefined && p.recovery_pct !== undefined) {
    const recovery = fraction(p.recovery_pct) ?? 0;
    const permeate = p.feed_flow_m3_day * recovery;
    metrics.push(metric("Permeate production", permeate, "m3/day", 2));
    metrics.push(metric("Brine/reject flow", p.feed_flow_m3_day - permeate, "m3/day", 2));
    if (p.specific_energy_kwh_m3 !== undefined) {
      metrics.push(metric("Desalination electric load", permeate * p.specific_energy_kwh_m3 / 24, "kW", 2));
      metrics.push(metric("Desalination energy", permeate * p.specific_energy_kwh_m3, "kWh/day", 1));
    }
  }

  if (p.storage_capacity_mwh !== undefined) {
    addMetric(metrics, "Storage duration", positive(p.capacity_mw) ? p.storage_capacity_mwh / p.capacity_mw : undefined, "hours", 2);
    const rte = fraction(p.round_trip_efficiency_pct, p.round_trip_efficiency);
    if (rte !== undefined) {
      metrics.push(metric("Delivered storage energy", p.storage_capacity_mwh * rte, "MWh", 2));
      metrics.push(metric("Round-trip losses", p.storage_capacity_mwh * (1 - rte), "MWh", 2));
    }
  }

  if (p.heat_rate_btu_per_kwh !== undefined) {
    const firstLaw = BTU_PER_KWH / p.heat_rate_btu_per_kwh;
    metrics.push(metric("First-law efficiency", firstLaw * 100, "%", 2));
    metrics.push(metric("Fuel-to-electric exergy efficiency proxy", firstLaw / NATURAL_GAS_EXERGY_FACTOR * 100, "%", 2));
  }

  if (p.electric_power_kw !== undefined && p.hours !== undefined) {
    metrics.push(metric("Electric energy", p.electric_power_kw * p.hours, "kWh", 2));
  }

  if (metrics.length === 0) {
    missing.add("numeric operating inputs such as heat duty, temperatures, COP, power, flow, pressure, mass flow, heat rate, or capacity");
  }

  const status = metrics.length >= 2 ? "ran" : metrics.length > 0 ? "partial" : "needs_inputs";
  if (status !== "needs_inputs") {
    limitations.push("This is a deterministic engineering calculation from supplied inputs; it is not calibration against measured field data.");
  }
  return {
    status,
    solver_type: "physics",
    title: "Physics and Exergy Solver",
    executive_summary: status === "needs_inputs"
      ? "I need numeric operating inputs before I can compute a physics result."
      : status === "ran"
        ? "I computed physics and exergy metrics from the supplied values."
        : "I computed the available physics and exergy metrics from the supplied values.",
    confidence: status === "ran" ? "computed" : status === "partial" ? "screening" : "needs_inputs",
    computed_metrics: metrics,
    assumptions,
    limitations,
    missing_inputs: Array.from(missing),
    normalized_params: p,
  };
}
