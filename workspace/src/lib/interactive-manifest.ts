/**
 * Interactive Parameter Manifest — defines which inputs are safe to edit.
 *
 * Each domain can expose 3–5 validated editable parameters for what-if
 * analysis. The manifest is declarative: it specifies field metadata,
 * bounds, and what subsystems a change affects (simulation, economics,
 * or both).
 *
 * Design:
 * - Domain-agnostic: new domains add a manifest entry, no UI changes
 * - Bounded: min/max prevent unphysical edits
 * - Transparent: labels and units are user-facing
 * - Deterministic: same edited params → same rerun result
 */

// ── Manifest types ─────────────────────────────────────────

export interface EditableParam {
  /** Parameter key (matches domain schema / candidate_params key). */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Physical unit. */
  unit: string;
  /** Minimum allowed value (inclusive). */
  min: number;
  /** Maximum allowed value (inclusive). */
  max: number;
  /** Step increment for UI slider/input. */
  step: number;
  /** Default baseline value. */
  default: number;
  /** What subsystems this parameter affects. */
  affects: ("simulation" | "economics" | "both")[];
  /** Optional tooltip explaining what this parameter controls. */
  tooltip?: string;
}

export interface InteractiveManifest {
  /** Domain identifier. */
  domain: string;
  /** Human-readable domain name. */
  displayName: string;
  /** Editable parameters (3–5 for v1). */
  params: EditableParam[];
  /** Whether this domain supports physics solver rerun. */
  hasSolver: boolean;
  /** Whether this domain has scored economics. */
  hasEconomics: boolean;
}

// ── Manifest registry ──────────────────────────────────────

/**
 * Registry of interactive manifests by domain.
 *
 * To add a new domain:
 * 1. Pick 3–5 parameters that are decision-relevant and have clear bounds
 * 2. Match keys to the domain schema parameter keys exactly
 * 3. Set affects based on what changes: simulation (physics solver),
 *    economics (universal economics), or both
 */
const MANIFEST_REGISTRY: Record<string, InteractiveManifest> = {

  // ── Heat Pump HVAC ───────────────────────────────────────
  heat_pump_hvac: {
    domain: "heat_pump_hvac",
    displayName: "Heat Pump HVAC",
    hasSolver: true,
    hasEconomics: true,
    params: [
      {
        key: "cop_heating",
        label: "COP (Heating)",
        unit: "",
        min: 2.0,
        max: 6.0,
        step: 0.1,
        default: 3.5,
        affects: ["both"],
        tooltip: "Coefficient of performance in heating mode. Higher means more efficient.",
      },
      {
        key: "heating_capacity_kw",
        label: "Heating Capacity",
        unit: "kW",
        min: 2.0,
        max: 50.0,
        step: 0.5,
        default: 12.0,
        affects: ["simulation"],
        tooltip: "Rated heating output at design conditions.",
      },
      {
        key: "refrigerant_gwp",
        label: "Refrigerant GWP",
        unit: "",
        min: 1,
        max: 3000,
        step: 1,
        default: 675,
        affects: ["simulation"],
        tooltip: "Global warming potential of the refrigerant. Lower is better.",
      },
      {
        key: "noise_level_dba",
        label: "Noise Level",
        unit: "dBA",
        min: 30,
        max: 70,
        step: 1,
        default: 52,
        affects: ["simulation"],
        tooltip: "Outdoor unit noise at 1m distance.",
      },
    ],
  },

  // ── Heat Pump Systems (production non-catalog) ───────────
  heat_pump_systems: {
    domain: "heat_pump_systems",
    displayName: "Heat Pump Systems",
    hasSolver: true,
    hasEconomics: true,
    params: [
      {
        key: "cop_heating",
        label: "COP (Heating)",
        unit: "",
        min: 2.0,
        max: 6.0,
        step: 0.1,
        default: 3.5,
        affects: ["both"],
        tooltip: "Coefficient of performance in heating mode.",
      },
      {
        key: "heating_capacity_kw",
        label: "Heating Capacity",
        unit: "kW",
        min: 2.0,
        max: 100.0,
        step: 1.0,
        default: 12.0,
        affects: ["simulation"],
        tooltip: "Rated heating output.",
      },
      {
        key: "refrigerant_gwp",
        label: "Refrigerant GWP",
        unit: "",
        min: 1,
        max: 3000,
        step: 1,
        default: 675,
        affects: ["simulation"],
        tooltip: "Global warming potential of the refrigerant.",
      },
    ],
  },

  // ── Waste-to-Energy ──────────────────────────────────────
  waste_to_energy: {
    domain: "waste_to_energy",
    displayName: "Waste-to-Energy",
    hasSolver: true,
    hasEconomics: true,
    params: [
      {
        key: "net_electrical_efficiency",
        label: "Net Electrical Efficiency",
        unit: "%",
        min: 0,
        max: 35,
        step: 0.5,
        default: 24,
        affects: ["both"],
        tooltip: "Net electrical output divided by waste thermal input (LHV basis).",
      },
      {
        key: "heat_recovery_efficiency",
        label: "Heat Recovery",
        unit: "%",
        min: 0,
        max: 95,
        step: 1,
        default: 72.5,
        affects: ["simulation"],
        tooltip: "Total useful heat recovered as fraction of waste thermal input.",
      },
      {
        key: "gate_fee_per_ton",
        label: "Gate Fee",
        unit: "$/ton",
        min: 0,
        max: 250,
        step: 5,
        default: 75,
        affects: ["economics"],
        tooltip: "Tipping fee charged per ton of waste accepted (primary revenue source).",
      },
      {
        key: "feedstock_lhv_mj_per_kg",
        label: "Feedstock LHV",
        unit: "MJ/kg",
        min: 4,
        max: 30,
        step: 0.5,
        default: 10.5,
        affects: ["simulation"],
        tooltip: "Lower heating value of incoming feedstock.",
      },
      {
        key: "emissions_gco2_per_ton",
        label: "CO₂ Emissions",
        unit: "gCO₂/ton",
        min: 100,
        max: 1500,
        step: 25,
        default: 650,
        affects: ["simulation"],
        tooltip: "Total fossil CO₂ per ton processed (biogenic excluded).",
      },
    ],
  },

  // ── Electrolysis / Hydrogen ──────────────────────────────
  electrolysis_conversion: {
    domain: "electrolysis_conversion",
    displayName: "Electrolysis",
    hasSolver: true,
    hasEconomics: true,
    params: [
      {
        key: "stack_efficiency",
        label: "Stack Efficiency",
        unit: "%",
        min: 55,
        max: 85,
        step: 0.5,
        default: 67,
        affects: ["both"],
        tooltip: "Electrolyzer stack efficiency (HHV basis).",
      },
      {
        key: "current_density",
        label: "Current Density",
        unit: "A/cm²",
        min: 0.3,
        max: 4.0,
        step: 0.1,
        default: 2.0,
        affects: ["simulation"],
        tooltip: "Operating current density at rated load.",
      },
      {
        key: "degradation_rate",
        label: "Degradation Rate",
        unit: "%/khr",
        min: 0.1,
        max: 5.0,
        step: 0.1,
        default: 0.5,
        affects: ["simulation"],
        tooltip: "Voltage degradation rate per 1000 operating hours.",
      },
      {
        key: "capex_per_kw",
        label: "CAPEX",
        unit: "$/kW",
        min: 200,
        max: 3000,
        step: 25,
        default: 750,
        affects: ["economics"],
        tooltip: "System-level capital expenditure per kW of capacity.",
      },
    ],
  },

  // ── Carbon Capture ───────────────────────────────────────
  carbon_capture: {
    domain: "carbon_capture",
    displayName: "Carbon Capture",
    hasSolver: true,
    hasEconomics: true,
    params: [
      {
        key: "capture_efficiency",
        label: "Capture Efficiency",
        unit: "%",
        min: 50,
        max: 99,
        step: 1,
        default: 90,
        affects: ["both"],
        tooltip: "Percentage of CO₂ captured from flue gas or air.",
      },
      {
        key: "energy_penalty",
        label: "Energy Penalty",
        unit: "kWh/tCO₂",
        min: 200,
        max: 3000,
        step: 50,
        default: 1200,
        affects: ["both"],
        tooltip: "Total energy consumption per tonne CO₂ captured.",
      },
      {
        key: "cost_per_ton",
        label: "Cost per Tonne",
        unit: "$/tCO₂",
        min: 30,
        max: 1000,
        step: 10,
        default: 200,
        affects: ["economics"],
        tooltip: "Total cost per tonne of CO₂ captured.",
      },
    ],
  },
};

// ── Public API ─────────────────────────────────────────────

/** Get the interactive manifest for a domain synchronously.
 *  Returns curated manifest if available, null otherwise.
 *  For universal coverage (all 107 domains), use fetchManifest() instead. */
export function getManifest(domain: string): InteractiveManifest | null {
  return MANIFEST_REGISTRY[domain] || null;
}

/** Fetch manifest for ANY domain — auto-generates from schema YAML via API.
 *  Falls back to curated MANIFEST_REGISTRY if API unavailable.
 *  Works for all 107 domain schemas. */
export async function fetchManifest(domain: string): Promise<InteractiveManifest | null> {
  // Check curated overrides first
  if (MANIFEST_REGISTRY[domain]) return MANIFEST_REGISTRY[domain];

  try {
    const res = await fetch(`/api/domains/${encodeURIComponent(domain)}/manifest`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.params) return null;
    return data as InteractiveManifest;
  } catch {
    return null;
  }
}

/** Check if a domain supports interactive rerun (sync — curated only). */
export function isInteractiveSupported(domain: string): boolean {
  return domain in MANIFEST_REGISTRY;
}

/** Get all curated domain IDs (sync). For full list, use the API. */
export function getSupportedDomains(): string[] {
  return Object.keys(MANIFEST_REGISTRY);
}

/** Validate edited parameters against manifest bounds. */
export function validateEditsWithManifest(
  manifest: InteractiveManifest,
  edits: Record<string, number>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const knownKeys = new Set(manifest.params.map(p => p.key));
  for (const [key, value] of Object.entries(edits)) {
    if (!knownKeys.has(key)) { errors.push(`Parameter '${key}' is not editable`); continue; }
    const param = manifest.params.find(p => p.key === key)!;
    if (typeof value !== "number" || isNaN(value)) { errors.push(`${param.label}: must be a number`); continue; }
    if (value < param.min) errors.push(`${param.label}: ${value} below min (${param.min})`);
    if (value > param.max) errors.push(`${param.label}: ${value} above max (${param.max})`);
  }
  return { valid: errors.length === 0, errors };
}

/** Validate edited parameters against manifest bounds (legacy sync API). */
export function validateEdits(
  domain: string,
  edits: Record<string, number>,
): { valid: boolean; errors: string[] } {
  const manifest = MANIFEST_REGISTRY[domain];
  if (!manifest) {
    return { valid: false, errors: [`Domain '${domain}' — use fetchManifest() for auto-generated manifests`] };
  }

  const errors: string[] = [];
  const knownKeys = new Set(manifest.params.map(p => p.key));

  for (const [key, value] of Object.entries(edits)) {
    if (!knownKeys.has(key)) {
      errors.push(`Parameter '${key}' is not editable for ${domain}`);
      continue;
    }
    const param = manifest.params.find(p => p.key === key)!;
    if (typeof value !== "number" || isNaN(value)) {
      errors.push(`${param.label}: must be a number`);
      continue;
    }
    if (value < param.min) {
      errors.push(`${param.label}: ${value} is below minimum (${param.min})`);
    }
    if (value > param.max) {
      errors.push(`${param.label}: ${value} is above maximum (${param.max})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Build the merged candidate_params for a rerun (baseline + edits). */
export function mergeEdits(
  baselineParams: Record<string, unknown>,
  edits: Record<string, number>,
): Record<string, unknown> {
  return { ...baselineParams, ...edits };
}
