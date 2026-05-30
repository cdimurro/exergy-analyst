#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { evaluateAgentQuality } from "./lib/agent-quality-evaluator.mjs";
import { evaluateExpectedContext } from "./lib/expected-context-evaluator.mjs";

const BASE_URL = process.env.MAJOR_STRESS_BASE_URL || "http://localhost:3001";
const RUN_TIMEOUT_MS = Number(process.env.MAJOR_STRESS_RUN_TIMEOUT_MS || "360000");
const POLL_MS = Number(process.env.MAJOR_STRESS_POLL_MS || "3000");
const MAX_PROMPTS = Number(process.env.MAJOR_STRESS_MAX_PROMPTS || "50");
const SAVE_DIAGNOSTICS = process.env.MAJOR_STRESS_SAVE_DIAGNOSTICS === "1";
const REPORT_PATH = process.env.MAJOR_STRESS_REPORT_PATH || "";

const terminalStatuses = new Set(["completed", "failed", "cancelled", "waiting_approval"]);

function isoStamp() {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw_text: text };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} for ${url}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function textFile(name, content, type = "text/markdown") {
  return { name, type, blob: new Blob([content], { type }), sourceText: content };
}

function csvFile(name, rows) {
  const content = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  return textFile(name, content, "text/csv");
}

function minimalPdf(name, text) {
  const safeText = text
    .replace(/[\\()]/g, (match) => `\\${match}`)
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ");
  const stream = `BT /F1 10 Tf 50 760 Td 12 TL (${safeText.slice(0, 2600)}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
  ];
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${object}\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return { name, type: "application/pdf", blob: new Blob([chunks.join("")], { type: "application/pdf" }), sourceText: text };
}

const cases = [
  {
    id: "smr-screening",
    technology_area: "small modular nuclear reactors",
    files: [
      textFile("smr_deployment_case.md", `# SMR Deployment Case

Net electrical capacity: 77 MWe. Net thermal efficiency: 32 percent. Capacity factor target: 92 percent.
Overnight CAPEX: 7,500 USD/kWe. Fixed O&M: 135 USD/kW-year. Variable O&M: 3 USD/MWh. Fuel: 8 USD/MWh.
Construction period: 5 years. Project life: 40 years. WACC: 8 percent. Decommissioning reserve: 6 USD/MWh.
Alternative diesel generation cost: 210 USD/MWh and emissions 0.74 tCO2/MWh.
Alternative gas generation cost: 85 USD/MWh and emissions 0.39 tCO2/MWh.
Water withdrawal planning basis: 2,100 m3/day, consumptive use 720 m3/day.
No firm EPC wrap, licensed schedule, or site-specific environmental impact statement is available.`),
    ],
    turns: [
      {
        request_type: "physics simulation and economic model",
        prompt: "Build a physics, economics, and environmental screening model for this SMR case. Estimate annual generation, thermal input, LCOE components, emissions avoided versus diesel and gas, water use, and bankability risks. Show tables and separate source-backed values from model assumptions.",
        requiresTool: true,
        expectedTerms: ["77", "92", "LCOE", "diesel", "gas"],
      },
      {
        request_type: "follow-up scenario change",
        prompt: "Rerun the economics with only two changes: CAPEX is 25% lower and WACC is 6%. Keep capacity factor, O&M, fuel, decommissioning, and project life unchanged. Compare against the base case and call out if any assumption drift occurred.",
        requiresTool: true,
        expectedTerms: ["25%", "6%", "unchanged", "base"],
        followup: true,
      },
    ],
  },
  {
    id: "geothermal-doublet",
    technology_area: "geothermal systems",
    files: [
      textFile("geothermal_doublet_data.md", `# Geothermal Doublet Screening Data

Reservoir temperature: 168 degC. Injection temperature: 70 degC. Production flow: 82 kg/s.
Brine heat capacity: 4.2 kJ/kg-K. Plant parasitic load: 0.9 MW. Binary plant gross efficiency: 11 percent of produced thermal energy.
Capacity factor: 86 percent. Drilling and surface CAPEX: 94 million USD. Fixed O&M: 2.8 million USD/year.
Project life: 25 years. WACC: 9 percent. Expected thermal decline: 1.4 percent/year after year 3.
No well test, pump curve, scaling chemistry, induced seismicity study, or reinjection pressure limit is available.`),
    ],
    turns: [
      {
        request_type: "physics simulation",
        prompt: "Run a screening geothermal production simulation with annual thermal decline. Estimate gross/net electric output, annual generation, LCOE, and the exergy efficiency relative to 25 degC ambient. Include a year-1 and year-10 comparison table and limits.",
        requiresTool: true,
        expectedTerms: ["168", "82", "1.4", "LCOE"],
      },
      {
        request_type: "export JSON and markdown",
        prompt: "Change only production flow to 70 kg/s and export a JSON scenario package plus a Markdown memo comparing base and changed cases. Keep all economics and decline assumptions unchanged.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["70", "JSON", "Markdown", "unchanged"],
        followup: true,
      },
    ],
  },
  {
    id: "district-heating",
    technology_area: "district heating",
    files: [
      textFile("district_heat_waste_heat_survey.md", `# District Heat Waste-Heat Survey

Available waste heat: 8.4 MW thermal at 92 degC supply and 54 degC return. Annual availability: 6,300 hours/year.
District heating demand: 5.1 MW peak and 31,000 MWh/year useful heat. Pipe route: 1.2 km each way. Heat loss: 4.5 percent.
Heat exchanger approach temperature: 5 degC. Pump electrical load: 110 kW when operating.
Avoided gas boiler efficiency: 88 percent HHV. Gas price: 7.20 USD/MMBtu. Grid emissions factor: 0.42 kg CO2/kWh. Gas emissions factor: 53.06 kg CO2/MMBtu.
Installed CAPEX: 5.8 million USD with +/-30 percent class 4 uncertainty.`),
    ],
    turns: [
      {
        request_type: "techno-economic model",
        prompt: "Prepare an exergy-aware techno-economic decision brief for using this waste heat in a district heating loop. Calculate annual heat delivered, pump electricity, avoided gas, CO2 impact, simple payback, and main decision risks. Use organized sections and a readable table.",
        requiresTool: true,
        expectedTerms: ["8.4", "5.8", "payback", "CO2"],
      },
      {
        request_type: "export CSV",
        prompt: "Create a client-ready memo and a downloadable CSV with the base case and a sensitivity where gas price is 30% lower. Do not change any other assumptions. Explain whether the recommendation changes.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["30%", "CSV", "recommendation"],
        followup: true,
      },
    ],
  },
  {
    id: "industrial-waste-heat-ambiguous",
    technology_area: "industrial waste heat",
    files: [
      csvFile("furnace_exhaust_partial_log.csv", [
        ["timestamp", "exhaust_temp_degC", "flow_note", "production_rate_tph", "ambient_degC"],
        ["2026-04-01T08:00", "310", "damper 70 percent, flow meter offline", "18", "22"],
        ["2026-04-01T09:00", "326", "damper 72 percent, flow meter offline", "19", "23"],
        ["2026-04-01T10:00", "298", "damper 61 percent, flow meter offline", "15", "23"],
      ]),
    ],
    turns: [
      {
        request_type: "ambiguous incomplete request",
        prompt: "Can this furnace exhaust stream support a waste-heat recovery project? The log is incomplete, so be explicit about what can be screened now, what cannot be proven, and the next measurements needed before sizing equipment.",
        requiresTool: true,
        expectedTerms: ["flow", "310", "cannot", "measurements"],
      },
      {
        request_type: "follow-up with added data",
        prompt: "Assume a temporary pitot survey now estimates exhaust flow at 14 kg/s dry gas with heat capacity 1.08 kJ/kg-K, and a usable exhaust outlet limit of 160 degC. Estimate recoverable heat and exergy at 25 degC ambient, but keep confidence appropriately low.",
        requiresTool: true,
        expectedTerms: ["14", "160", "25", "low"],
        followup: true,
      },
    ],
  },
  {
    id: "hydrogen-electrolysis",
    technology_area: "hydrogen electrolysis",
    files: [
      textFile("electrolyzer_project_sheet.md", `# Hydrogen Electrolysis Project Sheet

Electrolyzer type: PEM. Nameplate electrical input: 50 MW. Specific electricity use: 52 kWh/kg H2 at stack terminals.
Balance-of-plant parasitic load: 6 percent of stack power. Water consumption: 10 liters/kg H2.
Capacity factor: 62 percent. Electricity price: 38 USD/MWh. Electrolyzer CAPEX: 1,050 USD/kW. Fixed O&M: 3 percent of CAPEX/year.
Stack replacement: 18 percent of CAPEX in year 9. Project life: 20 years. WACC: 8 percent.
Grid emissions factor: 0.24 kg CO2/kWh. No hourly matching, interconnection study, or water permit is complete.`),
    ],
    turns: [
      {
        request_type: "economic model",
        prompt: "Build an LCOH screening model for this PEM electrolyzer. Calculate annual hydrogen, electricity use including parasitics, water use, levelized cost components, emissions intensity, and decision caveats.",
        requiresTool: true,
        expectedTerms: ["50", "52", "LCOH", "water"],
      },
      {
        request_type: "export XLSX",
        prompt: "Run a sensitivity where electricity price is 20, 38, and 60 USD/MWh, then export the scenario table as XLSX or CSV if XLSX is not available. Keep all non-electricity inputs unchanged.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["20", "60", "XLSX", "unchanged"],
        followup: true,
      },
    ],
  },
  {
    id: "soec-sofc",
    technology_area: "SOEC / SOFC",
    files: [
      textFile("soec_sofc_reversible_stack_notes.md", `# Reversible SOEC/SOFC Stack Notes

Electrolysis mode: 1.31 V at 0.42 A/cm2, 780 degC, steam utilization 72 percent. Hydrogen productivity: 29 kg/MWh electric.
Fuel-cell mode: 56 percent LHV electrical efficiency on hydrogen, stack degradation 1.8 percent per 1,000 hours.
Thermal integration claim: 18 percent of steam heat can be recovered from adjacent process heat at 820 degC.
Pilot active area: 1,200 cm2. Stack test duration: 1,400 hours. Electricity price: 48 USD/MWh.
No pressure cycling, contaminant tolerance, commercial stack replacement cost, or safety certification data are available.`),
    ],
    turns: [
      {
        request_type: "physics simulation",
        prompt: "Analyze reversible SOEC/SOFC operation as a screening case. Estimate hydrogen output in electrolysis mode, fuel-cell electricity from that hydrogen, round-trip energy efficiency, degradation implications, and what the pilot data cannot prove.",
        requiresTool: true,
        expectedTerms: ["1.31", "29", "56", "degradation"],
      },
      {
        request_type: "uncertainty analysis",
        prompt: "Add an uncertainty table with low/base/high cases for degradation at 0.8, 1.8, and 3.5 percent per 1,000 hours. Keep the electrolysis productivity and fuel-cell efficiency fixed.",
        requiresTool: true,
        expectedTerms: ["0.8", "3.5", "fixed", "uncertainty"],
        followup: true,
      },
    ],
  },
  {
    id: "fischer-tropsch-saf",
    technology_area: "Fischer-Tropsch fuels",
    files: [
      textFile("ft_saf_pilot.md", `# Fischer-Tropsch SAF Pilot

Design case: 250 barrels/day liquid product. Product density: 0.78 kg/L. Operating factor: 7,500 hours/year.
Syngas consumption: 2.15 kg syngas/kg liquid product. Syngas H2/CO ratio: 2.05.
CO2 source cost: 82 USD/tCO2. Green H2 price: 3.40 USD/kg. FT island CAPEX: 138 million USD.
Upgrading yield to jet-range product: 62 percent by mass. Fixed O&M: 6.5 million USD/year. WACC: 10 percent. Project life: 15 years.
Pilot selectivity data are lab-scale only; no catalyst lifetime guarantee or ASTM pathway certification is provided.`),
    ],
    turns: [
      {
        request_type: "techno-economic diligence",
        prompt: "Produce a techno-economic diligence note for this Fischer-Tropsch SAF pilot. Estimate annual liquid output, jet-range output, syngas/H2/CO needs at a screening level, rough cost drivers, and the evidence gaps that block investment-grade claims.",
        requiresTool: true,
        expectedTerms: ["250", "62", "3.40", "ASTM"],
      },
      {
        request_type: "challenge correction from user",
        prompt: "Challenge: your implied fuel economics may be too optimistic because carbon balance losses were ignored. Audit the prior calculation for unsupported or missing carbon-balance assumptions, correct the answer if needed, and say what still cannot be proven.",
        requiresTool: true,
        expectedTerms: ["carbon", "unsupported", "cannot"],
        followup: true,
      },
    ],
  },
  {
    id: "carbon-capture-cement",
    technology_area: "carbon capture",
    files: [
      textFile("cement_capture_case.md", `# Cement Kiln Carbon Capture Case

Clinker production: 1.2 million tonnes/year. Process emissions: 0.52 tCO2/t clinker. Fuel emissions: 0.31 tCO2/t clinker.
Capture technology: amine post-combustion. Capture rate target: 90 percent of flue gas CO2.
Specific reboiler duty: 3.2 GJ/tCO2 captured. Auxiliary electricity: 110 kWh/tCO2 captured.
Steam cost: 9.50 USD/GJ. Electricity cost: 64 USD/MWh. Capture island CAPEX: 410 million USD. Fixed O&M: 4 percent CAPEX/year.
CO2 transport and storage tariff: 28 USD/tCO2. No storage permit, solvent degradation test, or waste disposal plan is complete.`),
    ],
    turns: [
      {
        request_type: "environmental impact estimate",
        prompt: "Estimate captured CO2, residual emissions, steam/electricity requirements, annual operating cost, and cost per tonne avoided for this cement capture case. Include what the data supports and what it cannot prove for permitting.",
        requiresTool: true,
        expectedTerms: ["1.2", "90", "3.2", "avoided"],
      },
      {
        request_type: "export PDF and markdown",
        prompt: "Create a client-ready report in Markdown and PDF if available. The report must include a one-page executive summary, the calculation table, and a section on claims that are not supported yet.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["Markdown", "PDF", "not supported"],
        followup: true,
      },
    ],
  },
  {
    id: "direct-air-capture",
    technology_area: "direct air capture",
    files: [
      textFile("dac_screening_case.md", `# Direct Air Capture Screening Case

Capture capacity: 100,000 tCO2/year nameplate. Expected utilization: 82 percent.
Thermal energy: 5.6 GJ/tCO2. Electricity: 1.15 MWh/tCO2. Heat source: low-carbon steam at 11 USD/GJ.
Power price: 44 USD/MWh. Sorbent makeup: 18 USD/tCO2 captured. Fixed O&M: 16 million USD/year.
Installed CAPEX: 720 million USD. Project life: 20 years. WACC: 9 percent.
Storage cost: 22 USD/tCO2. No MRV protocol approval, Class VI permit, or sorbent degradation data is available.`),
    ],
    turns: [
      {
        request_type: "techno-economic model",
        prompt: "Build a DAC cost and energy model from the uploaded case. Estimate annual captured/stored CO2, thermal and electric energy, cost per tonne gross captured, and cost per tonne stored. Flag MRV and storage limits.",
        requiresTool: true,
        expectedTerms: ["100,000", "5.6", "1.15", "MRV"],
      },
      {
        request_type: "partial tool failure recovery",
        prompt: "Try to add a weather-sensitivity note for hot/dry operation. If public weather or humidity data cannot be fetched, continue with transparent assumptions and do not fabricate site-specific weather values.",
        requiresTool: true,
        expectedTerms: ["weather", "assumptions", "do not", "site"],
        followup: true,
      },
    ],
  },
  {
    id: "lithium-battery-safety",
    technology_area: "lithium-ion batteries",
    files: [
      textFile("li_ion_pack_abuse_notes.md", `# Lithium-Ion Pack Abuse Notes

Pack: 96s2p NMC, 74 kWh nominal. Cell mass: 0.72 kg. Cell heat capacity: 960 J/kg-K.
Internal resistance: 1.9 milliohm/cell at 25 degC, 2.6 milliohm/cell above 55 degC.
Cooling loop: 6 L/min water glycol normal, 3 L/min degraded. Hottest module reached 52 degC after 18 minutes at 1.8C discharge.
Thresholds: separator shutdown around 130 degC, vent onset 142 degC, thermal runaway onset 178 degC.
No ARC data above 80 percent SOC and no validated crush, nail, or internal-short model is available.`),
    ],
    turns: [
      {
        request_type: "physics simulation",
        prompt: "Run a physics-based screening simulation to estimate when thermal-runaway risk becomes credible under a 2C fast-charge event with cooling degraded by 50%. Show equations or assumptions, a time/risk table, and limits.",
        requiresTool: true,
        expectedTerms: ["178", "142", "2C", "cooling"],
      },
      {
        request_type: "follow-up scenario change",
        prompt: "Now rerun with coolant flow restored to 6 L/min and ambient temperature increased to 35 degC. Keep all other assumptions constant and compare both cases in one compact table.",
        requiresTool: true,
        expectedTerms: ["6 L/min", "35", "constant", "compare"],
        followup: true,
      },
    ],
  },
  {
    id: "sodium-ion-storage",
    technology_area: "sodium-ion batteries",
    files: [
      textFile("sodium_ion_storage_offer.md", `# Sodium-Ion Storage Offer

System: 20 MW / 80 MWh grid storage block. AC round-trip efficiency: 84 percent. Usable capacity warranty: 70 percent after 6,000 cycles or 12 years.
Installed CAPEX: 205 USD/kWh. Fixed O&M: 8 USD/kW-year. Augmentation allowance: 12 USD/kWh in year 8.
Cycle schedule: 320 equivalent full cycles/year. Charge energy price: 22 USD/MWh. Discharge value: 71 USD/MWh.
Project life: 15 years. WACC: 8 percent. No bankability report, UL certification packet, or degradation test raw data is provided.`),
    ],
    turns: [
      {
        request_type: "economic model",
        prompt: "Evaluate this sodium-ion storage offer as a screening investment. Estimate annual throughput, arbitrage margin, simple payback, LCOS-style cost indicators, and the main technology diligence gaps.",
        requiresTool: true,
        expectedTerms: ["20", "80", "84", "LCOS"],
      },
    ],
  },
  {
    id: "thermal-energy-storage",
    technology_area: "thermal energy storage",
    files: [
      textFile("thermal_storage_case.md", `# Packed-Bed Thermal Energy Storage Case

Storage medium: ceramic packed bed. Charge air temperature: 620 degC. Discharge target: 480 degC. Ambient reference: 25 degC.
Thermal capacity: 420 MWhth usable. Round-trip thermal efficiency: 78 percent. Fan electricity: 18 kWh/MWhth discharged.
Daily cycles: 0.85. CAPEX: 38 million USD. Fixed O&M: 0.9 million USD/year. Electricity for charging: curtailed power at 18 USD/MWh.
Avoided gas heat value: 46 USD/MWhth. Project life: 20 years. WACC: 7 percent. No long-duration refractory cycling test is available.`),
    ],
    turns: [
      {
        request_type: "physics simulation",
        prompt: "Model this thermal energy storage case. Estimate annual discharged heat, fan electricity, exergy content at discharge, levelized discharged heat cost, and sensitivity to cycle count. Use tables.",
        requiresTool: true,
        expectedTerms: ["420", "78", "480", "exergy"],
      },
      {
        request_type: "export CSV",
        prompt: "Export a CSV with low/base/high daily cycle cases at 0.45, 0.85, and 1.1 cycles/day. Keep temperatures, CAPEX, and efficiency fixed.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["0.45", "1.1", "CSV", "fixed"],
        followup: true,
      },
    ],
  },
  {
    id: "heat-pump-hvac",
    technology_area: "heat pumps and HVAC retrofits",
    files: [
      minimalPdf("heat_pump_retrofit_brief.pdf", `Heat pump retrofit brief. Building annual heat load 7,800 MWh. Existing gas boiler efficiency 86 percent. Proposed water-source heat pump COP 3.1 at 45 degC supply and 15 degC source. Peak heat load 3.8 MW. Electricity price 96 USD/MWh. Gas price 8.10 USD/MMBtu. Grid emissions 0.31 kg CO2/kWh. Gas emissions 53.06 kg CO2/MMBtu. Installed CAPEX 4.6 million USD. No hourly load profile, defrost data, or electrical service study is available.`),
    ],
    turns: [
      {
        request_type: "uploaded-document extraction",
        prompt: "Extract the key values from this heat-pump retrofit brief and calculate annual electricity use, gas displaced, emissions change, operating-cost change, payback, and exergy-relevant temperature limitations.",
        requiresTool: true,
        expectedTerms: ["7,800", "3.1", "4.6", "payback"],
      },
      {
        request_type: "ambiguous request with missing data",
        prompt: "The client asks whether this is guaranteed to work at peak winter conditions. Answer directly, but do not overclaim because the hourly load profile and electrical service study are missing.",
        requiresTool: false,
        expectedTerms: ["not guaranteed", "hourly", "electrical"],
        followup: true,
      },
    ],
  },
  {
    id: "pv-module",
    technology_area: "PV modules",
    files: [
      minimalPdf("pv_module_test_sheet.pdf", `PV module test sheet. Module power 440 W STC. Temperature coefficient Pmax -0.37 percent per degC. NOCT 42 degC. Module area 2.108 m2. Inverter efficiency 96 percent. System losses 14 percent. Location 24.4539 N, 54.3773 E. Typical daily plane-of-array irradiance screening value 7.5 kWh/m2-day. This simplified sheet is not bankable design.`),
    ],
    turns: [
      {
        request_type: "physics simulation",
        prompt: "Simulate peak module output and daily production under clear-sky screening conditions at 24.4539 N, 54.3773 E. Use the uploaded module data, include temperature derating, and return a compact table plus caveats.",
        requiresTool: true,
        expectedTerms: ["440", "24.4539", "54.3773", "temperature"],
      },
      {
        request_type: "long-context follow-up",
        prompt: "Scale the previous per-module result to 1,000,000 modules, estimate daily AC energy, and identify what site/weather data would be needed before a client could rely on the result.",
        requiresTool: true,
        expectedTerms: ["1,000,000", "daily", "site"],
        followup: true,
      },
    ],
  },
  {
    id: "wind-turbine-scada",
    technology_area: "wind turbines",
    files: [
      csvFile("wind_scada_excerpt.csv", [
        ["timestamp", "wind_speed_mps", "power_kw", "air_density_kg_m3", "status"],
        ["2026-02-01T00:00", "8.1", "1020", "1.21", "normal"],
        ["2026-02-01T00:10", "8.4", "980", "1.21", "normal"],
        ["2026-02-01T00:20", "9.0", "1105", "1.20", "normal"],
        ["2026-02-01T00:30", "9.2", "820", "1.20", "pitch warning"],
        ["2026-02-01T00:40", "10.1", "1240", "1.19", "normal"],
      ]),
      textFile("wind_reference_curve.md", `# Wind Reference Curve

Rated power: 2,500 kW. Rotor diameter: 110 m. Expected power at 8 m/s: 1,050 kW; at 9 m/s: 1,400 kW; at 10 m/s: 1,850 kW.
Availability target: 97 percent. The SCADA excerpt is too short for annual loss quantification.`),
    ],
    turns: [
      {
        request_type: "document upload and extraction",
        prompt: "Analyze the SCADA excerpt against the reference curve. Identify underperformance signals, estimate rough lost power for the suspicious rows, and state why this cannot prove annual energy loss.",
        requiresTool: true,
        expectedTerms: ["pitch", "annual", "reference"],
      },
      {
        request_type: "export JSON",
        prompt: "Export a JSON issue log for the suspicious SCADA rows with fields for timestamp, observed power, reference power, estimated delta, and confidence.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["JSON", "timestamp", "confidence"],
        followup: true,
      },
    ],
  },
  {
    id: "microgrid-storage",
    technology_area: "grid-scale storage and microgrids",
    files: [
      textFile("island_microgrid_case.md", `# Island Microgrid Case

Peak load: 14 MW. Average load: 8.2 MW. Existing diesel fuel use: 21 million liters/year. Diesel cost delivered: 1.18 USD/liter.
Proposed PV: 32 MWdc with 22 percent capacity factor. Battery: 18 MW / 72 MWh, round-trip efficiency 88 percent. Battery installed CAPEX: 310 USD/kWh.
PV CAPEX: 980 USD/kWdc. Diesel generator heat rate: 10.2 kWh/liter. Diesel emissions: 2.68 kg CO2/liter.
Curtailment without storage estimated 17 percent; with storage 6 percent. Project WACC: 8 percent. No interconnection stability study is complete.`),
    ],
    turns: [
      {
        request_type: "multi-tool request",
        prompt: "Build a microgrid screening model combining PV, battery storage, diesel displacement, CO2 reduction, CAPEX, and operating savings. Include a table of energy flows and decision limitations.",
        requiresTool: true,
        expectedTerms: ["32", "72", "diesel", "CO2"],
      },
      {
        request_type: "uncertainty sensitivity",
        prompt: "Run a sensitivity where PV capacity factor is 18%, 22%, and 26%. Keep battery size, diesel price, and curtailment assumptions fixed. Compare annual diesel displaced.",
        requiresTool: true,
        expectedTerms: ["18%", "26%", "fixed", "diesel"],
        followup: true,
      },
    ],
  },
  {
    id: "desalination-wastewater",
    technology_area: "desalination and wastewater treatment",
    files: [
      textFile("water_treatment_screening.md", `# Water Treatment Screening Case

RO desalination product water: 20,000 m3/day. Specific energy: 3.4 kWh/m3. Recovery: 45 percent. Brine TDS estimate: 74,000 mg/L.
Wastewater reuse train: 12,000 m3/day. Aeration energy: 0.38 kWh/m3. UV and pumping: 0.11 kWh/m3.
Electricity cost: 72 USD/MWh. Grid emissions factor: 0.46 kg CO2/kWh. RO CAPEX: 42 million USD. Reuse CAPEX: 18 million USD.
Membrane replacement: 0.06 USD/m3. Chemicals and maintenance: 0.04 USD/m3. No marine dispersion model or seasonal water-quality record is available.`),
    ],
    turns: [
      {
        request_type: "environmental impact estimate",
        prompt: "Compare the desalination and wastewater reuse options on water output, energy use, emissions, levelized water cost screening, brine or discharge risks, and missing permitting evidence.",
        requiresTool: true,
        expectedTerms: ["20,000", "12,000", "brine", "permitting"],
      },
      {
        request_type: "follow-up scenario change",
        prompt: "Evaluate a power supply sensitivity where curtailed PV supplies 40% of electricity at 28 USD/MWh and the remaining 60% stays at grid price. Keep plant performance unchanged.",
        requiresTool: true,
        expectedTerms: ["40%", "28", "60%", "unchanged"],
        followup: true,
      },
    ],
  },
  {
    id: "mining-mineral-processing",
    technology_area: "mining/mineral processing",
    files: [
      textFile("comminution_upgrade_case.md", `# Mineral Processing Energy Upgrade

Ore throughput: 2.4 million tonnes/year. Existing SAG mill energy: 18.5 kWh/t ore. Proposed HPGR plus ball mill energy: 14.2 kWh/t ore.
Plant availability: 91 percent. Electricity cost: 68 USD/MWh. Grid emissions: 0.58 kg CO2/kWh.
Recovery improvement claim: 0.7 percentage points copper recovery, but only from a 96-hour locked-cycle test.
Copper grade: 0.58 percent. Copper price: 8,900 USD/t. Upgrade CAPEX: 64 million USD. Fixed O&M increase: 1.6 million USD/year.
No geometallurgical variability campaign or liner wear data is available.`),
    ],
    turns: [
      {
        request_type: "techno-economic model",
        prompt: "Assess this mineral-processing upgrade. Estimate electricity savings, CO2 reduction, potential copper value from recovery improvement, payback, and why the recovery claim is not proven at mine scale.",
        requiresTool: true,
        expectedTerms: ["18.5", "14.2", "0.7", "payback"],
      },
      {
        request_type: "assumptions and limits",
        prompt: "Now produce a risk-adjusted version that excludes the unproven recovery uplift and values energy savings only. Compare the recommendation to the prior case.",
        requiresTool: true,
        expectedTerms: ["excludes", "recovery", "energy", "prior"],
        followup: true,
      },
    ],
  },
  {
    id: "cement-steel",
    technology_area: "cement and steel",
    files: [
      textFile("cement_steel_heat_integration.md", `# Cement and Steel Heat Integration

Cement kiln waste heat source: 11 MWth at 340 degC for 7,200 hours/year. Steel reheat furnace demand: 8 MWth at 260 degC for 5,900 hours/year.
Heat transfer loop loss: 8 percent. Heat exchanger approach: 20 degC. Backup gas boiler efficiency: 86 percent.
Gas price: 6.80 USD/MMBtu. Gas emissions factor: 53.06 kg CO2/MMBtu. Pump and fan parasitic electricity: 180 kW.
Interconnect CAPEX: 13.5 million USD. No synchronized hourly operating schedule or contamination/fouling study is available.`),
    ],
    turns: [
      {
        request_type: "physics simulation",
        prompt: "Evaluate this cement-to-steel heat integration concept. Estimate deliverable heat, exergy quality, avoided gas and emissions, parasitic load, payback, and operating schedule risks.",
        requiresTool: true,
        expectedTerms: ["11", "340", "8", "payback"],
      },
    ],
  },
  {
    id: "ammonia-methanol",
    technology_area: "ammonia and methanol",
    files: [
      textFile("green_ammonia_methanol_case.md", `# Green Ammonia and Methanol Case

Shared electrolyzer hydrogen: 18,000 tH2/year. Ammonia synthesis consumption: 0.178 tH2/tNH3. Methanol synthesis consumption: 0.188 tH2/tMeOH plus 1.375 tCO2/tMeOH.
Ammonia product price: 620 USD/t. Methanol product price: 410 USD/t. CO2 supply cost: 70 USD/tCO2.
Ammonia loop CAPEX: 210 million USD. Methanol island CAPEX: 165 million USD. Fixed O&M: 4 percent CAPEX/year.
Capacity factor: 84 percent. WACC: 9 percent. Project life: 20 years. No offtake contract or CO2 purity specification is provided.`),
    ],
    turns: [
      {
        request_type: "economic model",
        prompt: "Compare allocating all available hydrogen to green ammonia versus methanol. Estimate product tonnes, revenue, CO2 requirement for methanol, simple cost flags, and evidence gaps.",
        requiresTool: true,
        expectedTerms: ["18,000", "0.178", "1.375", "CO2"],
      },
      {
        request_type: "export markdown and CSV",
        prompt: "Export a Markdown comparison memo and CSV table for the ammonia and methanol cases. Do not invent electrolyzer cost because it is outside this sheet.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["Markdown", "CSV", "electrolyzer"],
        followup: true,
      },
    ],
  },
  {
    id: "biochar-lca",
    technology_area: "biochar and lifecycle emissions",
    files: [
      textFile("biochar_lca_screen.md", `# Biochar LCA Screen

Feedstock: 45,000 dry tonnes/year forestry residues. Biochar yield: 28 percent dry mass. Stable carbon fraction: 72 percent of biochar mass.
Carbon content of biochar: 78 percent. Pyrolysis energy use: 0.18 MWh/t feedstock. Avoided open-pile decay credit claim: 0.42 tCO2e/t feedstock, not verified.
Biochar selling price: 180 USD/t. Carbon removal credit price: 115 USD/tCO2e. CAPEX: 22 million USD. Fixed O&M: 2.4 million USD/year.
No permanence protocol approval, soil trial, or feedstock counterfactual audit is available.`),
    ],
    turns: [
      {
        request_type: "lifecycle emissions",
        prompt: "Estimate biochar output, stable carbon stored as CO2e, energy use, potential revenue, and the difference between physical carbon storage and unverified avoided-decay credits.",
        requiresTool: true,
        expectedTerms: ["45,000", "28", "72", "permanence"],
      },
      {
        request_type: "cannot prove request",
        prompt: "The founder says the project is already a certified carbon-removal asset. Explain what the uploaded data supports, what it cannot prove, and what evidence would be needed for that claim.",
        requiresTool: false,
        expectedTerms: ["cannot prove", "certified", "protocol"],
        followup: true,
      },
    ],
  },
  {
    id: "aviation-shipping-fuels",
    technology_area: "aviation fuels and shipping fuels",
    files: [
      textFile("fuel_switch_case.md", `# Aviation and Shipping Fuel Switch Case

SAF route: HEFA blendstock, lifecycle emissions estimate 32 gCO2e/MJ, fossil jet baseline 89 gCO2e/MJ. SAF price: 1,760 USD/t.
Marine route: e-methanol, lifecycle emissions estimate 18 gCO2e/MJ, VLSFO baseline 91 gCO2e/MJ. E-methanol price: 720 USD/t.
Annual aviation fuel demand: 95,000 tonnes. Annual marine fuel demand: 140,000 tonnes. Lower heating value: jet 43 MJ/kg, methanol 20 MJ/kg, VLSFO 40 MJ/kg.
No supplier chain-of-custody certificates or engine compatibility letters are provided.`),
    ],
    turns: [
      {
        request_type: "environmental impact estimate",
        prompt: "Compare the aviation SAF and shipping e-methanol options on energy delivered, lifecycle emissions reduction, fuel mass implications, and claim risks. Use the supplied values only.",
        requiresTool: true,
        expectedTerms: ["32", "18", "95,000", "140,000"],
      },
    ],
  },
  {
    id: "data-center-cooling",
    technology_area: "data-center cooling and heat exchangers",
    files: [
      textFile("data_center_cooling_case.md", `# Data Center Cooling and Heat Recovery

IT load: 24 MW. Current annual PUE: 1.31. Proposed liquid cooling PUE: 1.12. Annual operating hours: 8,760.
Recoverable heat: 18 MWth at 48 degC supply, 38 degC return. Nearby district heat minimum supply need: 70 degC.
Heat pump COP for lift to 75 degC: 3.4. Electricity cost: 78 USD/MWh. Grid emissions: 0.29 kg CO2/kWh.
Cooling retrofit CAPEX: 28 million USD. Heat recovery heat-pump CAPEX: 19 million USD. No customer heat offtake agreement is signed.`),
    ],
    turns: [
      {
        request_type: "multi-tool request",
        prompt: "Analyze the data-center cooling retrofit and heat-recovery option. Estimate electricity savings from PUE improvement, heat-pump electricity, useful heat delivered, emissions impact, and exergy limits of low-temperature heat.",
        requiresTool: true,
        expectedTerms: ["24", "1.31", "1.12", "COP"],
      },
      {
        request_type: "follow-up one variable changed",
        prompt: "Change only the heat pump COP from 3.4 to 2.7 and compare heat-recovery economics and emissions. Keep PUE savings unchanged.",
        requiresTool: true,
        expectedTerms: ["2.7", "3.4", "unchanged"],
        followup: true,
      },
    ],
  },
  {
    id: "compressors-pumps-refrigeration",
    technology_area: "compressors, pumps, and refrigeration",
    files: [
      csvFile("utility_equipment_log.csv", [
        ["equipment", "flow", "pressure_lift", "power_kw", "hours_per_year", "note"],
        ["compressor_A", "5.6 kg/s air", "2.8 bar", "620", "6200", "inlet filter fouling suspected"],
        ["pump_B", "420 m3/h water", "38 m head", "74", "5400", "throttled valve 45 percent"],
        ["refrigeration_C", "1.8 MW cooling", "evap -8 degC cond 38 degC", "710", "7000", "high condensing temp"],
      ]),
    ],
    turns: [
      {
        request_type: "document extraction and analysis",
        prompt: "Review this compressor, pump, and refrigeration log. Identify the highest-value efficiency opportunities, estimate annual electricity exposure, and state what measurements are needed before claiming savings.",
        requiresTool: true,
        expectedTerms: ["compressor", "pump", "refrigeration", "measurements"],
      },
      {
        request_type: "export CSV",
        prompt: "Export a prioritized CSV opportunity register with equipment, issue, annual kWh exposure, confidence, and next measurement.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["CSV", "confidence", "measurement"],
        followup: true,
      },
    ],
  },
  {
    id: "combustion-gas-turbine",
    technology_area: "combustion systems and gas turbines",
    files: [
      textFile("gas_turbine_upgrade_case.md", `# Gas Turbine Upgrade Case

Simple-cycle gas turbine net output: 44 MW. Heat rate: 10,900 Btu/kWh LHV. Annual operating hours: 2,100.
Duct burner and HRSG retrofit option: adds 28 MWth recoverable steam at 82 percent boiler efficiency equivalent. Additional parasitic load: 0.8 MW.
Gas price: 5.60 USD/MMBtu. NOx permit limit: 9 ppmvd at 15 percent O2. Current stack tests: 7.4, 8.1, and 8.8 ppmvd.
Retrofit CAPEX: 24 million USD. No detailed heat balance, emissions guarantee, or grid interconnection approval is complete.`),
    ],
    turns: [
      {
        request_type: "physics and environmental model",
        prompt: "Evaluate the gas-turbine heat-recovery retrofit. Estimate fuel use baseline, recoverable steam value at a screening level, parasitic impact, emissions/permitting risks, and what cannot be proven from current stack tests.",
        requiresTool: true,
        expectedTerms: ["44", "10,900", "9", "NOx"],
      },
    ],
  },
  {
    id: "membranes-catalysts",
    technology_area: "membranes and catalysts",
    files: [
      textFile("membrane_catalyst_source_pack.md", `# Membrane and Catalyst Source Pack

Source A, bench membrane test: CO2/N2 selectivity 42, CO2 permeance 1,250 GPU, feed 15 percent CO2, pressure ratio 4, test duration 240 hours.
Source B, catalyst note: methanol synthesis catalyst conversion 18 percent per pass at 250 degC and 50 bar, selectivity 91 percent, test duration 600 hours.
Source C, scale-up memo: target membrane skid 20,000 Nm3/h flue gas and catalyst demo 10 t/day methanol equivalent. No long-run fouling, impurity tolerance, module replacement cost, or independent replication is available.
These sources are synthetic excerpts for workspace testing and should be treated as supplied source context, not external literature.`),
    ],
    turns: [
      {
        request_type: "source-backed literature scan",
        prompt: "Using only the supplied source pack, write a source-backed literature-style scan comparing membrane separation and catalyst scale-up readiness. Include extracted numbers, confidence, contradictions or gaps, and what cannot be claimed.",
        requiresTool: true,
        expectedTerms: ["42", "1,250", "18", "600"],
      },
      {
        request_type: "scientific literature review",
        prompt: "Now convert that scan into a scientific review outline with hypotheses, evidence table, reproducibility concerns, and next experiments. Do not imply external peer-reviewed validation beyond the supplied source pack.",
        requiresTool: false,
        expectedTerms: ["hypotheses", "reproducibility", "source pack"],
        followup: true,
      },
    ],
  },
  {
    id: "ev-interconnection-permitting",
    technology_area: "EV charging infrastructure, grid interconnection, and environmental permitting",
    files: [
      textFile("ev_depot_interconnection_case.md", `# EV Depot Interconnection and Permitting Case

Fleet: 180 electric delivery trucks. Charger plan: 60 DC fast chargers at 180 kW each, managed charging diversity factor 0.62.
Daily energy need: 38 MWh. Onsite solar: 4.2 MWdc at 19 percent capacity factor. Battery buffer: 6 MW / 18 MWh.
Utility feeder available hosting capacity: 5.5 MW before reconductoring. Demand charge: 18 USD/kW-month. Energy charge: 92 USD/MWh.
Interconnection upgrade estimate: 7.8 million USD. Wetland setback issue affects the preferred transformer location. No final utility study or environmental permit is issued.`),
    ],
    turns: [
      {
        request_type: "techno-economic diligence",
        prompt: "Assess this EV depot plan across charging load, grid interconnection constraint, battery/PV mitigation, demand-charge exposure, permitting risk, and next engineering steps.",
        requiresTool: true,
        expectedTerms: ["60", "180", "5.5", "wetland"],
      },
      {
        request_type: "export MD/JSON",
        prompt: "Export a Markdown risk memo and JSON assumptions ledger. The ledger should list source-supported values separately from assumptions and missing permits.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["Markdown", "JSON", "permits"],
        followup: true,
      },
    ],
  },
];

function buildPromptPlan() {
  let promptNumber = 0;
  return cases.flatMap((caseDef) => caseDef.turns.map((turn, index) => ({
    ...turn,
    prompt_number: ++promptNumber,
    case_id: caseDef.id,
    technology_area: caseDef.technology_area,
    request_type: turn.request_type,
    turn_index: index,
  })));
}

async function createProject(caseDef) {
  return fetchJson(`${BASE_URL}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      name: `[major-stress] ${caseDef.technology_area} ${isoStamp()}`,
      description: `Major stress campaign case ${caseDef.id}`,
      goal: "Stress-test agent reliability, grounding, tool recovery, exports, follow-up continuity, and claim limits.",
      domain: "general",
    }),
  });
}

async function uploadDocument(projectId, file) {
  const form = new FormData();
  form.append("file", file.blob, file.name);
  return fetchJson(`${BASE_URL}/api/projects/${projectId}/documents`, {
    method: "POST",
    body: form,
  });
}

async function startRun(projectId, message, documentIds, parentRunId) {
  return fetchJson(`${BASE_URL}/api/projects/${projectId}/runs`, {
    method: "POST",
    body: JSON.stringify({
      message,
      document_ids: documentIds,
      current_document_ids: documentIds,
      mode: "implement",
      thinking_level: "expert",
      ...(parentRunId ? { parent_run_id: parentRunId } : {}),
    }),
  });
}

async function pollRun(projectId, runId) {
  const started = Date.now();
  let lastSnapshot = null;
  while (Date.now() - started < RUN_TIMEOUT_MS) {
    lastSnapshot = await fetchJson(`${BASE_URL}/api/projects/${projectId}/runs/${runId}`);
    const status = lastSnapshot?.run?.status;
    if (terminalStatuses.has(status)) return { ...lastSnapshot, elapsed_ms: Date.now() - started, timed_out: false };
    await sleep(POLL_MS);
  }
  return { ...(lastSnapshot || {}), elapsed_ms: Date.now() - started, timed_out: true };
}

async function exportDiagnostics(projectId) {
  return fetchJson(`${BASE_URL}/api/projects/${projectId}/export`, { signal: AbortSignal.timeout(60000) });
}

function eventCounts(events = []) {
  return events.reduce((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {});
}

function eventMessages(events = []) {
  return events
    .filter((event) => typeof event.message === "string" && event.message.trim())
    .map((event) => ({ type: event.type, message: event.message.trim() }))
    .slice(-12);
}

function collectFiles(run = {}, events = []) {
  const runFiles = Array.isArray(run.files) ? run.files : [];
  const eventFiles = events
    .filter((event) => event.type === "file.created" && event.data)
    .map((event) => event.data);
  return [...runFiles, ...eventFiles].map((file) => ({
    filename: file.filename,
    mime_type: file.mime_type,
    url: file.url,
    artifact_id: file.artifact_id,
    run_id: file.run_id,
  }));
}

function latestCompletedDiagnostics(events = []) {
  const completed = [...events].reverse().find((event) => event.type === "run.completed" && event.data && typeof event.data === "object");
  const data = completed?.data || {};
  return {
    quality_evaluation: data.quality_evaluation || null,
    claim_ledger: data.claim_ledger || null,
    source_extraction_confidence: Array.isArray(data.source_extraction_confidence) ? data.source_extraction_confidence : [],
    scenario_reproducibility: data.scenario_reproducibility || null,
    quality_gate: data.quality_gate || null,
  };
}

function countMarkdownSections(text) {
  return (text.match(/^#{1,3}\s+/gm) || []).length;
}

function hasMarkdownTable(text) {
  return /\|[^\n]+\|\n\|[\s:-]+\|/m.test(text);
}

function hasSupportLimitsLanguage(text) {
  return /(cannot prove|cannot support|not supported|what the data (can|does) support|assumption|uncertain|uncertainty|data gap|next data|would need|not bankable|not validated|limitations?|support\s*&\s*limits|missing evidence|not enough evidence)/i.test(text);
}

function termMissing(text, term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(escaped, "i").test(text)) return false;
  const numeric = String(term).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (numeric) {
    const value = Number(numeric[0]);
    const answerNumbers = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) || [];
    if (answerNumbers.some((item) => Math.abs(Number(item) - value) / Math.max(1, Math.abs(value)) <= 0.02)) return false;
  }
  return true;
}

function diagnosticRunFor(diagnosticExport, runId) {
  return diagnosticExport?.diagnostics?.run_diagnostics?.find((entry) => entry.run_id === runId) || null;
}

function summarizeDiagnosticExport(diagnosticExport, runId) {
  const diagnostics = diagnosticExport?.diagnostics || {};
  const runDiagnostic = diagnosticRunFor(diagnosticExport, runId);
  return {
    export_type: diagnosticExport?.export_type || null,
    health: diagnostics.health ? {
      run_count: diagnostics.health.run_count,
      completed_run_count: diagnostics.health.completed_run_count,
      failed_run_count: diagnostics.health.failed_run_count,
      artifact_count: diagnostics.health.artifact_count,
      issue_counts: diagnostics.health.issue_counts,
    } : null,
    project_issue_count: Array.isArray(diagnostics.issues) ? diagnostics.issues.length : 0,
    run_issue_codes: Array.isArray(diagnostics.issues)
      ? diagnostics.issues.filter((issue) => issue.run_id === runId).map((issue) => issue.code)
      : [],
    run_quality_score: runDiagnostic?.quality_evaluation?.score ?? null,
    run_claim_summary: runDiagnostic?.claim_ledger?.summary ?? null,
    run_source_extraction_confidence: runDiagnostic?.source_extraction_confidence ?? [],
    run_scenario_reproducibility: runDiagnostic?.scenario_reproducibility ?? null,
  };
}

function extractionConfidenceSummary(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.map((entry) => ({
    filename: entry.filename,
    confidence: entry.confidence,
    issues: Array.isArray(entry.issues) ? entry.issues : [],
  }));
}

function addIssue(issues, severity, type, detail, broad_fix, evidence) {
  issues.push({ severity, type, detail, broad_fix, ...(evidence ? { evidence } : {}) });
}

function evaluatePromptResult({ caseDef, turn, snapshot, diagnosticExport, diagnosticExportPath }) {
  const run = snapshot.run || {};
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const answer = String(run.final_answer || "");
  const files = collectFiles(run, events);
  const counts = eventCounts(events);
  const completedDiagnostics = latestCompletedDiagnostics(events);
  const diagnosticSummary = summarizeDiagnosticExport(diagnosticExport, run.id);
  const runDiagnostic = diagnosticRunFor(diagnosticExport, run.id);
  const issues = [];
  const sourceTexts = (caseDef.files || []).map((file) => file.sourceText || "").filter(Boolean);

  if (snapshot.timed_out) addIssue(issues, "blocker", "run_timeout", `Run did not reach a terminal state within ${RUN_TIMEOUT_MS} ms.`, "Bound tool execution and synthesize useful partial results when a tool stalls.");
  if (run.status !== "completed") addIssue(issues, "blocker", "not_completed", `Run status was ${run.status || "<missing>"}.`, "Keep platform failures inside the agent loop and persist a useful final answer.");
  if (answer.trim().length < 120) addIssue(issues, "blocker", "missing_or_short_final_answer", "Final answer is missing or too short to be useful.", "Always synthesize a client-readable answer from available context and tool traces.");

  const forbiddenPatterns = [
    { pattern: /\bDeepSeek\b|\bGPT\b|\bOpenAI\b|\bClaude\b|\bV4 Flash\b|underlying model|provider/i, label: "model_or_provider_leak" },
    { pattern: /\btool\.started\b|\brun\.completed\b|\bclaim ledger\b|\bunsupported_numeric_claim/i, label: "internal_diagnostic_leak" },
    { pattern: /evidence card|claim label|Breakthrough Engine|View Details|Export Report|Do Not Claim Yet|Best Next Data Requests|Outputs collected/i, label: "legacy_or_internal_phrase" },
    { pattern: /Traceback|File "\/workspace|failed with exit code|did not return executable Python code/i, label: "raw_tool_failure_leak" },
  ];
  for (const item of forbiddenPatterns) {
    if (item.pattern.test(answer)) {
      addIssue(issues, "blocker", item.label, "Final answer exposed internal, legacy, provider, or raw failure language.", "Sanitize synthesis and translate internal diagnostics into client-facing limitations.");
    }
  }

  for (const check of evaluateExpectedContext({
    answer,
    expectedTerms: turn.expectedTerms || [],
    prompt: turn.prompt,
    sourceTexts,
  })) {
    if (check.status === "missing") {
      addIssue(
        issues,
        "warning",
        "missing_expected_context",
        `Expected context not covered: ${check.term}. ${check.reason}`,
        "Strengthen source-grounded context injection and final answer requirements.",
        check,
      );
    } else if (check.status === "false_positive") {
      addIssue(
        issues,
        "info",
        "expected_context_false_positive_downgraded",
        `Expected context warning downgraded for ${check.term}. ${check.reason}`,
        "Keep expected-context checks source-aware and avoid keyword-only warnings.",
        check,
      );
    }
  }

  if (turn.requiresTool && !counts["tool.started"] && !counts["artifact.created"] && !counts["file.created"]) {
    addIssue(issues, "blocker", "tool_not_used_for_complex_request", "Complex request completed without visible tool or artifact activity.", "Route complex analysis, simulation, and export requests through the server-owned tool loop.");
  }
  if (turn.requiresFiles && files.length === 0) {
    addIssue(issues, "blocker", "missing_downloadable_file", "The request asked for downloadable output but no file artifact/download URL was produced.", "Make requested exports first-class run files with stable URLs.");
  }
  if (turn.requiresTool && !hasMarkdownTable(answer)) {
    addIssue(issues, "warning", "missing_table_for_model_result", "Tool-backed result did not include a Markdown table.", "Require compact tables for numeric and scenario outputs.");
  }
  if (turn.requiresTool && countMarkdownSections(answer) < 2) {
    addIssue(issues, "warning", "weak_response_structure", "Tool-backed result lacked clear section structure.", "Use a stable, domain-agnostic decision brief structure for complex outputs.");
  }
  if ((turn.requiresTool || /claim|prove|guarantee|permit|investment|client|economic|emissions|safety/i.test(turn.prompt)) && !hasSupportLimitsLanguage(answer)) {
    addIssue(issues, "warning", "missing_support_limits", "High-stakes answer did not clearly say what the data supports or cannot prove.", "Enforce support/limits language for high-stakes outputs.");
  }

  const quality = evaluateAgentQuality({
    prompt: turn.prompt,
    finalAnswer: answer,
    sourceTexts,
    files,
    events,
    requiresTool: turn.requiresTool,
    requiresFiles: turn.requiresFiles,
    followup: turn.followup,
  });
  for (const finding of quality.findings) {
    if (finding.severity === "info") continue;
    addIssue(issues, finding.severity, finding.type, finding.detail, finding.broad_fix, finding.evidence);
  }

  const serverQuality = completedDiagnostics.quality_evaluation || runDiagnostic?.quality_evaluation || null;
  const claimLedger = completedDiagnostics.claim_ledger || runDiagnostic?.claim_ledger || null;
  const sourceConfidence = completedDiagnostics.source_extraction_confidence?.length
    ? completedDiagnostics.source_extraction_confidence
    : runDiagnostic?.source_extraction_confidence || [];
  const scenarioRepro = completedDiagnostics.scenario_reproducibility || runDiagnostic?.scenario_reproducibility || null;

  if (!serverQuality || !claimLedger) {
    addIssue(issues, "warning", "missing_server_quality_gate_diagnostics", "Run completed without quality diagnostics and claim ledger on run.completed.", "Persist quality and claim diagnostics for every final answer.");
  }

  const unsupported = claimLedger?.summary?.unsupported_numeric_claims;
  if (typeof unsupported === "number" && unsupported > 0) {
    addIssue(issues, "warning", "unsupported_numeric_claims_in_claim_ledger", `${unsupported} numeric claim(s) lacked source, tool-output, calculation, assumption, or limitation support.`, "Use private claim diagnostics as a repair trigger before final answers are emitted.", claimLedger.summary);
  }

  const weakSources = Array.isArray(sourceConfidence) ? sourceConfidence.filter((entry) => ["none", "low"].includes(entry?.confidence)) : [];
  if (weakSources.length > 0 && turn.requiresTool) {
    addIssue(issues, "warning", "weak_source_extraction_confidence", "One or more source documents had weak extraction confidence.", "Improve extraction and lower answer confidence when parser-readable source context is weak.", {
      documents: weakSources.map((entry) => ({ filename: entry.filename, confidence: entry.confidence, issues: entry.issues })),
    });
  }

  if (scenarioRepro?.required === true && typeof scenarioRepro.score === "number" && scenarioRepro.score < 75) {
    addIssue(issues, "warning", "weak_scenario_reproducibility", `Scenario reproducibility score was ${scenarioRepro.score}.`, "Scenario follow-ups should state changed inputs, held constants, calculation basis, and comparison tables.", scenarioRepro);
  }

  const diagnosticRunIssues = diagnosticSummary.run_issue_codes || [];
  for (const code of diagnosticRunIssues) {
    if (["answer_numbers_not_seen_in_sources"].includes(code)) continue;
    addIssue(issues, code.includes("failed") || code.includes("missing_final") ? "blocker" : "warning", `diagnostic_${code}`, `Diagnostic export reported ${code}.`, "Use diagnostic export issues as repair signals for run storage, tool execution, and final synthesis.");
  }

  const artifactsCreated = Array.isArray(run.artifact_ids) ? run.artifact_ids : [];
  const score = typeof serverQuality?.score === "number" ? serverQuality.score : quality.score;
  return {
    prompt_number: turn.prompt_number,
    prompt_text: turn.prompt,
    technology_area: turn.technology_area,
    request_type: turn.request_type,
    project_id: run.project_id || null,
    run_id: run.id || null,
    status: run.status || "unknown",
    duration_ms: snapshot.elapsed_ms ?? null,
    final_answer_preview: answer.replace(/\s+/g, " ").trim().slice(0, 900),
    final_answer: answer,
    artifacts_created: artifactsCreated,
    files_created: files,
    diagnostic_export_path: diagnosticExportPath || null,
    diagnostic_export_summary: diagnosticSummary,
    quality_score: score,
    local_quality_evaluation: quality,
    unsupported_numeric_claim_count: typeof unsupported === "number" ? unsupported : null,
    extraction_confidence: extractionConfidenceSummary(sourceConfidence),
    scenario_reproducibility_score: typeof scenarioRepro?.score === "number" ? scenarioRepro.score : null,
    event_counts: counts,
    progress_messages: eventMessages(events),
    observed_issues: issues,
    fix_applied: null,
    verification_after_fix: null,
    residual_risk: issues.length > 0 ? "Needs engineering review or targeted rerun." : "No major residual issue observed in this prompt review.",
  };
}

async function newReport(outputPath) {
  const started = new Date();
  return {
    campaign_id: `major_stress_${isoStamp()}`,
    base_url: BASE_URL,
    started_at: started.toISOString(),
    completed_at: null,
    report_path: outputPath,
    prompt_target: 50,
    prompt_count: 0,
    reviewed_count: 0,
    readiness: null,
    sandbox_check: "Run separately with npm run sandbox:check before campaign.",
    cases: {},
    prompts: [],
    fixes_implemented: [],
    final_summary: {},
  };
}

async function loadOrCreateReport() {
  const outputDir = path.resolve("test-results");
  await mkdir(outputDir, { recursive: true });
  const outputPath = REPORT_PATH ? path.resolve(REPORT_PATH) : path.join(outputDir, `major-stress-campaign-${isoStamp()}.json`);
  if (existsSync(outputPath)) {
    return { outputPath, report: JSON.parse(await readFile(outputPath, "utf8")) };
  }
  return { outputPath, report: await newReport(outputPath) };
}

function summarize(report) {
  const prompts = report.prompts || [];
  const issues = prompts.flatMap((prompt) => prompt.observed_issues || []);
  const issueTypes = issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {});
  const completed = prompts.filter((prompt) => prompt.status === "completed").length;
  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const scores = prompts.map((prompt) => prompt.quality_score).filter((score) => typeof score === "number");
  const scenarioScores = prompts.map((prompt) => prompt.scenario_reproducibility_score).filter((score) => typeof score === "number");
  const unsupported = prompts.map((prompt) => prompt.unsupported_numeric_claim_count).filter((value) => typeof value === "number");
  const filePrompts = prompts.filter((prompt) => /export|csv|xlsx|pdf|json|markdown|md/i.test(prompt.request_type || prompt.prompt_text || ""));
  const fileSuccess = filePrompts.filter((prompt) => Array.isArray(prompt.files_created) && prompt.files_created.length > 0).length;
  report.prompt_count = prompts.length;
  report.reviewed_count = prompts.length;
  report.final_summary = {
    overall_pass_fail: prompts.length === 50 && completed === 50 && blockers === 0 ? "pass" : "fail",
    prompts_sent_and_reviewed: prompts.length,
    completed_runs: completed,
    blocker_count: blockers,
    warning_count: warnings,
    issue_types: issueTypes,
    average_quality_score: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    unsupported_numeric_claim_total: unsupported.reduce((sum, value) => sum + value, 0),
    average_scenario_reproducibility_score: scenarioScores.length ? Math.round(scenarioScores.reduce((sum, score) => sum + score, 0) / scenarioScores.length) : null,
    export_success_rate: filePrompts.length ? `${fileSuccess}/${filePrompts.length}` : null,
    strongest_capabilities_observed: [],
    most_common_failure_modes: Object.entries(issueTypes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count })),
    fixes_implemented: report.fixes_implemented || [],
    remaining_risks: [],
    recommended_next_engineering_priorities: [],
    ready_for_broader_external_client_testing: "not_assessed_until_50_prompts_complete",
  };
}

async function saveReport(report, outputPath) {
  summarize(report);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function ensureCaseReady(report, outputPath, caseDef) {
  report.cases[caseDef.id] ||= { case_id: caseDef.id, technology_area: caseDef.technology_area, project_id: null, documents: [], run_ids: [] };
  const caseState = report.cases[caseDef.id];
  if (caseState.project_id) return caseState;

  const project = await createProject(caseDef);
  caseState.project_id = project.id;
  caseState.documents = [];
  await saveReport(report, outputPath);

  for (const file of caseDef.files || []) {
    const doc = await uploadDocument(project.id, file);
    caseState.documents.push({
      id: doc.id,
      filename: doc.filename,
      mime_type: doc.mime_type,
      size_bytes: doc.size_bytes,
      status: doc.status,
    });
    await saveReport(report, outputPath);
  }
  return caseState;
}

function existingPrompt(report, promptNumber) {
  return (report.prompts || []).find((entry) => entry.prompt_number === promptNumber);
}

async function main() {
  const { outputPath, report } = await loadOrCreateReport();
  const promptPlan = buildPromptPlan();
  if (promptPlan.length !== 50) throw new Error(`Expected 50 prompts, found ${promptPlan.length}`);

  report.readiness ||= await fetchJson(`${BASE_URL}/api/readiness`, { signal: AbortSignal.timeout(15000) });
  await saveReport(report, outputPath);

  let sentThisRun = 0;
  for (const turn of promptPlan) {
    if (sentThisRun >= MAX_PROMPTS) break;
    if (existingPrompt(report, turn.prompt_number)) continue;

    const caseDef = cases.find((item) => item.id === turn.case_id);
    if (!caseDef) throw new Error(`Missing case ${turn.case_id}`);
    const caseState = await ensureCaseReady(report, outputPath, caseDef);
    const documentIds = (caseState.documents || []).map((doc) => doc.id);
    const parentRunId = turn.followup && Array.isArray(caseState.run_ids) && caseState.run_ids.length > 0
      ? caseState.run_ids[caseState.run_ids.length - 1]
      : undefined;

    const started = Date.now();
    let result;
    try {
      const runResponse = await startRun(caseState.project_id, turn.prompt, documentIds, parentRunId);
      const snapshot = await pollRun(caseState.project_id, runResponse.run.id);
      if (!Array.isArray(caseState.run_ids)) caseState.run_ids = [];
      caseState.run_ids.push(runResponse.run.id);

      const diagnosticExport = await exportDiagnostics(caseState.project_id);
      let diagnosticExportPath = null;
      if (SAVE_DIAGNOSTICS) {
        const diagnosticsDir = path.resolve("test-results", "diagnostics");
        await mkdir(diagnosticsDir, { recursive: true });
        diagnosticExportPath = path.join(diagnosticsDir, `${report.campaign_id}-p${String(turn.prompt_number).padStart(2, "0")}-${slug(turn.case_id)}.json`);
        await writeFile(diagnosticExportPath, `${JSON.stringify(diagnosticExport, null, 2)}\n`, "utf8");
      }

      result = evaluatePromptResult({
        caseDef,
        turn,
        snapshot: { ...snapshot, elapsed_ms: Date.now() - started },
        diagnosticExport,
        diagnosticExportPath,
      });
      console.log(`reviewed ${turn.prompt_number}/50 ${turn.case_id} ${result.status} ${result.duration_ms}ms issues=${result.observed_issues.length}`);
    } catch (error) {
      result = {
        prompt_number: turn.prompt_number,
        prompt_text: turn.prompt,
        technology_area: turn.technology_area,
        request_type: turn.request_type,
        project_id: caseState.project_id,
        run_id: null,
        status: "harness_error",
        duration_ms: Date.now() - started,
        final_answer_preview: "",
        final_answer: "",
        artifacts_created: [],
        files_created: [],
        diagnostic_export_path: null,
        diagnostic_export_summary: null,
        quality_score: null,
        unsupported_numeric_claim_count: null,
        extraction_confidence: null,
        scenario_reproducibility_score: null,
        event_counts: {},
        progress_messages: [],
        observed_issues: [{
          severity: "blocker",
          type: "harness_or_api_error",
          detail: error?.body ? JSON.stringify(error.body) : String(error?.message || error),
          broad_fix: "API requests and run snapshots must fail with diagnosable structured errors.",
        }],
        fix_applied: null,
        verification_after_fix: null,
        residual_risk: "Prompt did not complete because the harness or API request failed.",
      };
      console.error(`failed ${turn.prompt_number}/50 ${turn.case_id}:`, error?.message || error);
    }

    report.prompts.push(result);
    report.prompts.sort((a, b) => a.prompt_number - b.prompt_number);
    sentThisRun += 1;
    await saveReport(report, outputPath);
  }

  if ((report.prompts || []).length === 50) {
    report.completed_at ||= new Date().toISOString();
    report.final_summary.ready_for_broader_external_client_testing = report.final_summary.overall_pass_fail === "pass"
      ? "candidate_ready_with_recorded_residual_risks"
      : "not_ready_until_blockers_are_fixed_and_rerun";
  }
  await saveReport(report, outputPath);
  console.log(`major stress report: ${outputPath}`);
  console.log(JSON.stringify(report.final_summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
