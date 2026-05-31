export interface TechnicalDomainAdapter {
  id: string;
  label: string;
  match: RegExp[];
  helperFunctions: string[];
  requiredChecks: string[];
  guidance: string[];
}

export const UNIVERSAL_TECHNICAL_CHECKS = [
  "state the system boundary, basis, and units before modeling",
  "for unfamiliar or benchmark-sensitive domains, build a temporary domain context before modeling",
  "separate input-supported values from assumptions",
  "search for relevant open-source tools or libraries before hand-rolling complex solvers",
  "run unit and dimensional checks on derived values",
  "check conservation or balance constraints when inputs/outputs are present",
  "check physical upper/lower bounds before making feasibility claims",
  "run at least one independent calculation check for the primary result",
  "rank sensitivities from numeric deltas rather than narrative guesses",
  "downgrade the recommendation when evidence does not support readiness",
];

export const TECHNICAL_DOMAIN_ADAPTERS: TechnicalDomainAdapter[] = [
  {
    id: "data_center_power",
    label: "Data-center power, turbines, transformers, and switchgear",
    match: [/data\s+cent(?:er|re)/i, /behind[- ]the[- ]meter/i, /gas\s+turbine/i, /transformer/i, /switchgear/i, /short[- ]?circuit/i, /ride[- ]?through/i],
    helperFunctions: [
      "gas_turbine_derated_capacity",
      "capacity_margin",
      "binomial_at_least",
      "transformer_losses",
      "fault_current_from_mva",
      "fault_current_from_transformer",
      "ride_through_energy",
    ],
    requiredChecks: [
      "hot-day and altitude derating",
      "N, N-1, and N-2 capacity margin",
      "availability target vs computed probability",
      "generator and utility fault-current contribution",
      "transformer loading and loss basis",
      "ride-through energy and dynamic-study limits",
    ],
    guidance: [
      "Do not infer switchgear adequacy from utility short-circuit data alone when generators are present.",
      "Do not treat steady-state capacity as proof of ride-through or transient stability.",
    ],
  },
  {
    id: "battery_materials",
    label: "Battery materials and electrochemical readiness",
    match: [/battery/i, /lithium[- ]ion/i, /NMC\s*811/i, /cathode/i, /anode/i, /electrolyte/i, /mAh\/g/i, /C[- ]?rate/i],
    helperFunctions: ["battery_areal_metrics", "cycle_life_application_gap"],
    requiredChecks: [
      "cell-level vs pack-level vs active-material energy-density basis",
      "areal capacity and areal current density",
      "cycle-life target vs application duty",
      "rate capability at stated loading",
      "temperature and degradation failure modes",
    ],
    guidance: [
      "Do not call a material deployment-ready from half-cell or low-loading data alone.",
      "Separate EV competitiveness from grid-storage competitiveness.",
    ],
  },
  {
    id: "hydrogen",
    label: "Hydrogen and electrolysis",
    match: [/hydrogen/i, /\bH2\b/i, /electroly[sz]er/i, /electrolysis/i, /kWh\s*\/\s*kg/i, /\bPEM\b/i, /\bSOEC\b/i],
    helperFunctions: ["hydrogen_electrolyzer_metrics"],
    requiredChecks: [
      "LHV/HHV basis",
      "specific energy vs thermodynamic floor",
      "stack vs system efficiency",
      "auxiliary loads and utilization",
      "water, compression, storage, and balance-of-plant boundaries",
    ],
    guidance: [
      "Treat kWh/kg below the LHV floor as a unit or boundary error unless carefully justified.",
      "Do not compare efficiencies unless LHV/HHV and stack/system basis are explicit.",
    ],
  },
  {
    id: "thermal_systems",
    label: "Heat pumps, refrigeration, and thermal systems",
    match: [/heat\s+pump/i, /\bCOP\b/i, /coefficient\s+of\s+performance/i, /Carnot/i, /refrigeration/i, /waste\s+heat/i, /district\s+heating/i],
    helperFunctions: ["carnot_heat_pump_cop"],
    requiredChecks: [
      "source/sink temperatures and temperature lift",
      "COP vs Carnot limit",
      "thermal capacity and flow balance",
      "parasitic electrical loads",
      "seasonal/load-profile basis",
    ],
    guidance: [
      "A COP claim must be tied to source and sink temperatures.",
      "Do not compare heat-recovery options without capacity, temperature grade, and utilization basis.",
    ],
  },
  {
    id: "generation",
    label: "Power generation and renewable performance",
    match: [/capacity\s+factor/i, /annual\s+generation/i, /\bPV\b/i, /solar/i, /wind/i, /turbine/i, /generator/i, /MWh\s*(?:\/\s*yr|per\s+year)/i],
    helperFunctions: ["annual_generation_metrics", "pvlib_fixed_tilt_day", "pvlib_cell_temperature"],
    requiredChecks: [
      "nameplate capacity vs annual generation",
      "capacity factor bound",
      "weather/resource basis",
      "losses, degradation, and curtailment",
      "AC/DC and gross/net output basis",
    ],
    guidance: [
      "Do not report generation that implies capacity factor above 100%.",
      "Keep AC, DC, gross, and net generation bases separate.",
    ],
  },
  {
    id: "finance",
    label: "Techno-economic analysis",
    match: [/NPV/i, /\bIRR\b/i, /payback/i, /\bLCOE\b/i, /CAPEX/i, /OPEX/i, /WACC/i, /breakeven/i, /finance/i, /economic/i],
    helperFunctions: ["capital_recovery_factor", "npv", "irr", "financial_metrics"],
    requiredChecks: [
      "sign of NPV/IRR/payback vs narrative recommendation",
      "project life and discount-rate basis",
      "production basis stays fixed in cost-only sensitivities",
      "CAPEX/OPEX/revenue unit consistency",
      "low/base/high sensitivity cases",
    ],
    guidance: [
      "Do not call a case viable when computed NPV is negative or payback exceeds project life.",
      "Do not let cost-only scenarios silently change production or utilization.",
    ],
  },
  {
    id: "chemical_process",
    label: "Chemical process, reactors, separations, and scale-up",
    match: [/chemical\s+process/i, /reactor/i, /conversion/i, /selectivity/i, /yield/i, /mass\s+balance/i, /stoichiometry/i, /distillation/i, /separation/i, /throughput/i],
    helperFunctions: ["process_fraction_check"],
    requiredChecks: [
      "mass and elemental balance closure",
      "conversion, selectivity, recovery, and yield bounds",
      "stoichiometric limiting reagent",
      "heat of reaction and heat-removal basis",
      "scale-up residence time and mixing basis",
    ],
    guidance: [
      "Treat conversion, yield, recovery, and capture fractions above 100% as unit or basis errors.",
      "Do not call scale-up ready without heat/mass transfer, residence-time, and safety-envelope checks.",
    ],
  },
  {
    id: "structural_mechanical",
    label: "Structural and mechanical design",
    match: [/structural/i, /mechanical/i, /stress/i, /strain/i, /yield\s+strength/i, /safety\s+factor/i, /factor\s+of\s+safety/i, /fatigue/i, /buckling/i, /pressure\s+vessel/i],
    helperFunctions: ["mechanical_safety_factor", "pressure_vessel_hoop_stress"],
    requiredChecks: [
      "applied stress vs yield/allowable stress",
      "factor of safety and design code basis",
      "buckling/fatigue/fracture mode screening",
      "load case and boundary-condition definition",
      "pressure-vessel hoop stress when pressure geometry is present",
    ],
    guidance: [
      "Do not call a design acceptable when stress exceeds allowable or yield strength.",
      "Separate screening stress checks from code-compliant design approval.",
    ],
  },
  {
    id: "fluids_pumps",
    label: "Fluids, pumps, pipelines, and hydraulics",
    match: [/pump/i, /pipeline/i, /hydraulic/i, /flow\s+rate/i, /head/i, /pressure\s+drop/i, /Reynolds/i, /pipe/i, /m3\/s/i],
    helperFunctions: ["pump_hydraulic_power"],
    requiredChecks: [
      "hydraulic power floor from flow and head",
      "pump efficiency bound",
      "pressure drop and velocity basis",
      "NPSH/cavitation risk where suction conditions are present",
      "fluid density/viscosity assumptions",
    ],
    guidance: [
      "Pump shaft/electrical power cannot be below hydraulic power at the stated flow and head.",
      "Do not infer pump readiness without NPSH/cavitation checks when suction conditions matter.",
    ],
  },
  {
    id: "carbon_capture",
    label: "Carbon capture and emissions systems",
    match: [/carbon\s+capture/i, /\bCCUS\b/i, /\bCCS\b/i, /CO2/i, /capture\s+(?:rate|efficiency)/i, /amine/i, /DAC/i],
    helperFunctions: ["carbon_capture_balance", "process_fraction_check"],
    requiredChecks: [
      "captured CO2 vs inlet emissions",
      "capture fraction bound",
      "energy penalty and parasitic load",
      "solvent/sorbent regeneration basis",
      "storage/compression boundary",
    ],
    guidance: [
      "Do not claim captured CO2 above inlet CO2 without a stated external CO2 source or accounting boundary.",
      "Keep gross capture, net capture, and avoided emissions separate.",
    ],
  },
  {
    id: "water_desalination",
    label: "Water treatment, desalination, and brine management",
    match: [/desalination/i, /reverse\s+osmosis/i, /\bRO\b/i, /brine/i, /\bTDS\b/i, /water\s+recovery/i, /specific\s+energy/i],
    helperFunctions: ["process_fraction_check", "pump_hydraulic_power"],
    requiredChecks: [
      "water recovery and salt mass balance",
      "specific energy and pressure basis",
      "brine concentration and disposal boundary",
      "osmotic pressure or hydraulic pressure floor",
      "pretreatment/fouling assumptions",
    ],
    guidance: [
      "Water recovery above 100% or salt removal without a salt balance is not decision-grade.",
      "Separate product-water quality from recovery and energy metrics.",
    ],
  },
  {
    id: "controls_robotics",
    label: "Controls, robotics, and dynamic systems",
    match: [/control\s+system/i, /robot/i, /actuator/i, /servo/i, /PID/i, /stability/i, /settling\s+time/i, /overshoot/i, /torque/i],
    helperFunctions: [],
    requiredChecks: [
      "stability margin or closed-loop pole basis",
      "actuator torque/current saturation",
      "sampling rate vs system bandwidth",
      "sensor latency/noise assumptions",
      "failure mode and safe-state behavior",
    ],
    guidance: [
      "Do not call a dynamic system stable from steady-state calculations alone.",
      "Actuator and sensor limits must be checked before deployment claims.",
    ],
  },
  {
    id: "semiconductor_electronics",
    label: "Semiconductors, electronics, and thermal packaging",
    match: [/semiconductor/i, /chip/i, /die/i, /wafer/i, /junction\s+temperature/i, /thermal\s+resistance/i, /power\s+density/i, /PCB/i, /MOSFET/i],
    helperFunctions: [],
    requiredChecks: [
      "junction temperature from power and thermal resistance",
      "voltage/current/power derating",
      "thermal interface and cooling boundary",
      "yield, defect density, and process-node basis",
      "EMI/signal-integrity constraints where relevant",
    ],
    guidance: [
      "Do not call an electronics design ready without thermal and derating checks.",
      "Separate bench feasibility from manufacturability and yield.",
    ],
  },
  {
    id: "biotech_pharma",
    label: "Biotech, pharma process development, and biomanufacturing",
    match: [/biotech/i, /pharma/i, /bioreactor/i, /fermentation/i, /cell\s+culture/i, /titer/i, /GMP/i, /sterility/i, /scale[- ]up/i],
    helperFunctions: ["process_fraction_check"],
    requiredChecks: [
      "titer/yield/productivity basis",
      "mass balance and media/feed assumptions",
      "sterility/GMP/comparability limits",
      "scale-up oxygen transfer and mixing basis",
      "batch failure and contamination risk",
    ],
    guidance: [
      "Do not infer GMP readiness from technical yield alone.",
      "Scale-up claims need oxygen transfer, mixing, sterility, and comparability evidence.",
    ],
  },
  {
    id: "aerospace",
    label: "Aerospace propulsion, structures, and flight systems",
    match: [/aerospace/i, /aircraft/i, /rocket/i, /propulsion/i, /thrust/i, /specific\s+impulse/i, /\bIsp\b/i, /payload/i, /flight/i],
    helperFunctions: ["mechanical_safety_factor"],
    requiredChecks: [
      "mass and energy balance",
      "thrust-to-weight and propellant basis",
      "thermal/structural margins",
      "trajectory or duty-cycle assumptions",
      "certification/test-envelope limits",
    ],
    guidance: [
      "Do not treat subsystem performance as flight readiness without system mass, thermal, controls, and certification constraints.",
      "Separate ground-test evidence from flight qualification.",
    ],
  },
  {
    id: "mining_minerals",
    label: "Mining, minerals, and critical-material processing",
    match: [/mining/i, /mineral/i, /ore/i, /grade/i, /recovery/i, /lithium\s+brine/i, /tailings/i, /beneficiation/i],
    helperFunctions: ["process_fraction_check"],
    requiredChecks: [
      "ore grade, recovery, and product mass balance",
      "water/reagent/energy intensity",
      "tailings and impurity boundary",
      "resource vs reserve confidence",
      "scale-up and permitting constraints",
    ],
    guidance: [
      "Do not convert resource grades into production claims without recovery and throughput basis.",
      "Recovery above 100% or product mass above contained metal must be treated as a basis error.",
    ],
  },
  {
    id: "nuclear_safety",
    label: "Nuclear, radiation, and critical safety systems",
    match: [/nuclear/i, /radiation/i, /reactor/i, /criticality/i, /dose/i, /shielding/i, /\bALARA\b/i],
    helperFunctions: [],
    requiredChecks: [
      "regulatory and licensing boundary",
      "dose/shielding basis",
      "decay heat and cooling margin",
      "criticality/safety envelope",
      "defense-in-depth and failure modes",
    ],
    guidance: [
      "Do not present nuclear safety, shielding, or criticality conclusions as validated without licensed engineering review and code-specific analysis.",
      "Separate screening calculations from regulatory compliance.",
    ],
  },
];

export function detectTechnicalDomainAdapters(text: string): TechnicalDomainAdapter[] {
  const source = text || "";
  return TECHNICAL_DOMAIN_ADAPTERS.filter((adapter) =>
    adapter.match.some((pattern) => pattern.test(source)),
  );
}

export function buildTechnicalDomainGuidance(text: string): string {
  const adapters = detectTechnicalDomainAdapters(text);
  const lines = [
    "Universal technical checks for this run:",
    ...UNIVERSAL_TECHNICAL_CHECKS.map((check) => `- ${check}`),
  ];

  if (adapters.length === 0) {
    lines.push(
      "No narrow domain adapter matched. Build a temporary domain pack at runtime: domain name, governing variables, governing equations, unit conventions, physical limits, common failure modes, benchmark ranges, useful tools/libraries, required checks, missing inputs, and confidence limits.",
      "Use retrieval when network is available: search_literature(), search_openalex_works(), search_crossref_works(), discover_open_source_tools(), and inspect_pypi_package() before creating a custom model for unfamiliar domains.",
      "Then create technical_checks in results.json for units, bounds, conservation, independent arithmetic, source/benchmark support, and recommendation support.",
    );
    return lines.join("\n");
  }

  lines.push("Matched lightweight domain adapters:");
  for (const adapter of adapters) {
    lines.push(`- ${adapter.label}`);
    lines.push(`  helpers: ${adapter.helperFunctions.join(", ") || "none"}`);
    lines.push(`  required checks: ${adapter.requiredChecks.join("; ")}`);
    for (const guidance of adapter.guidance) lines.push(`  note: ${guidance}`);
  }
  lines.push(
    "If sources or benchmarks are needed, write results.json.domain_context with retrieved references, benchmark ranges, useful tools considered, and why the selected modeling approach is adequate.",
  );
  lines.push(
    "Write results.json.technical_checks as an array of checks with name, status or passed, formula_or_basis, expected_range_or_bound, observed_value, and implication.",
  );
  return lines.join("\n");
}
