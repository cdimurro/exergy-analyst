#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { evaluateAgentQuality } from "./lib/agent-quality-evaluator.mjs";
import { evaluateExpectedContext } from "./lib/expected-context-evaluator.mjs";

const BASE_URL = process.env.STRESS_BASE_URL || "http://localhost:3000";
const TIMEBOX_MINUTES = Number(process.env.STRESS_TIMEBOX_MINUTES || "60");
const MAX_MESSAGES = Number(process.env.STRESS_MAX_MESSAGES || "100");
const RUN_TIMEOUT_MS = Number(process.env.STRESS_RUN_TIMEOUT_MS || "240000");
const POLL_MS = Number(process.env.STRESS_POLL_MS || "3000");
const CASE_FILTER = new Set(
  (process.env.STRESS_CASES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

function makeTextFile(name, content, type = "text/markdown") {
  return { name, type, blob: new Blob([content], { type }), sourceText: content };
}

function makeMinimalPdf(name, text) {
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
  for (const offset of offsets.slice(1)) {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return { name, type: "application/pdf", blob: new Blob([chunks.join("")], { type: "application/pdf" }), sourceText: text };
}

const cases = [
  {
    id: "battery-thermal-runaway",
    name: "Battery thermal runaway screening",
    domain: "general",
    files: [
      makeTextFile(
        "battery_pack_abuse_test_notes.md",
        `# Battery Pack Abuse Test Notes

Pack architecture: 96 cells in series, NMC chemistry, nominal energy 74 kWh.
Cell mass: 0.72 kg each. Cell heat capacity assumption for screening: 960 J/kg-K.
Internal resistance: 1.9 milliohm per cell at 25 degC, 2.6 milliohm per cell above 55 degC.
Nominal cooling loop: 6 L/min water glycol, degraded cooling case: 3 L/min.
Observed pack test: at 1.8C discharge, hottest module thermocouple reached 52 degC after 18 minutes.
Abuse reference thresholds: separator shutdown around 130 degC, vent onset measured at 142 degC, thermal runaway onset measured at 178 degC.
No ARC data are available above 80 percent SOC. No validated abuse model exists for crush, nail penetration, or internal short.
Ambient design range: 25 degC base, 35 degC hot-day case.
`,
      ),
    ],
    turns: [
      {
        id: "primary",
        prompt:
          "Run a physics-based screening simulation to estimate when thermal-runaway risk becomes credible under a 2C fast-charge event with cooling degraded by 50%. Use the uploaded pack notes, show equations or model assumptions, provide a table of temperature/risk over time, and state what the data can support and cannot prove.",
        requiresTool: true,
        expectedTerms: ["178", "142", "2C", "cooling"],
      },
      {
        id: "followup",
        prompt:
          "Now rerun the same screening with coolant flow restored to 6 L/min and ambient temperature increased to 35 degC. Keep all other assumptions constant and compare the two cases in a compact table.",
        requiresTool: true,
        expectedTerms: ["6 L/min", "35", "compare"],
        followup: true,
      },
    ],
  },
  {
    id: "district-heat-waste-heat",
    name: "District heat waste-heat recovery",
    domain: "general",
    files: [
      makeTextFile(
        "industrial_waste_heat_site_survey.md",
        `# Industrial Waste Heat Site Survey

Available waste heat: 8.4 MW thermal at 92 degC supply and 54 degC return.
Annual availability: 6,300 hours per year.
District heating demand: 5.1 MW peak, 31,000 MWh per year useful heat.
Pipe route: 1.2 km each way, preliminary heat loss 4.5 percent.
Heat exchanger approach temperature: 5 degC.
Circulation pump electrical load: 110 kW when operating.
Avoided gas boiler efficiency: 88 percent HHV.
Gas price: 7.20 USD/MMBtu. Grid emissions factor: 0.42 kg CO2/kWh. Gas emissions factor: 53.06 kg CO2/MMBtu.
Installed CAPEX estimate: 5.8 million USD with +/-30 percent class 4 uncertainty.
`,
      ),
    ],
    turns: [
      {
        id: "primary",
        prompt:
          "Prepare an exergy-aware techno-economic decision brief for using this waste heat in a district heating loop. Calculate annual heat delivered, pump electricity, avoided gas, CO2 impact, simple payback, and the main decision risks. Use organized sections and a table.",
        requiresTool: true,
        expectedTerms: ["8.4", "5.8", "payback", "CO2"],
      },
      {
        id: "followup-export",
        prompt:
          "Create a client-ready memo and a downloadable CSV with the base case and a sensitivity where gas price is 30% lower. Do not change any other assumptions. Explain whether the recommendation changes.",
        requiresTool: true,
        requiresFiles: true,
        expectedTerms: ["30%", "CSV", "recommendation"],
        followup: true,
      },
    ],
  },
  {
    id: "smr-energy-economics-environment",
    name: "Small modular reactor deployment",
    domain: "general",
    files: [
      makeTextFile(
        "smr_deployment_case.md",
        `# SMR Deployment Case

Technology: proposed small modular nuclear reactor.
Net electrical capacity: 77 MWe. Net thermal efficiency: 32 percent.
Capacity factor target: 92 percent.
Overnight CAPEX: 7,500 USD/kWe. Fixed O&M: 135 USD/kW-year. Variable O&M: 3 USD/MWh. Fuel: 8 USD/MWh.
Construction period: 5 years. Project life: 40 years. WACC: 8 percent.
Alternative diesel generation cost: 210 USD/MWh and emissions 0.74 tCO2/MWh.
Alternative gas generation cost: 85 USD/MWh and emissions 0.39 tCO2/MWh.
Water withdrawal planning basis: 2,100 m3/day, consumptive use 720 m3/day.
Decommissioning reserve: 6 USD/MWh.
No firm EPC wrap, licensed schedule, or site-specific environmental impact statement is available.
`,
      ),
    ],
    turns: [
      {
        id: "primary",
        prompt:
          "Build a physics, economics, and environmental screening model for this SMR case. Estimate annual generation, thermal input, LCOE components, emissions avoided versus diesel and gas, water use, and bankability risks. Show tables and separate source-backed values from model assumptions.",
        requiresTool: true,
        expectedTerms: ["77", "92", "LCOE", "diesel", "gas"],
      },
      {
        id: "followup",
        prompt:
          "Rerun the economics with only two changes: CAPEX is 25% lower and WACC is 6%. Keep capacity factor, O&M, fuel, decommissioning, and project life unchanged. Compare against the base case and call out if any assumption drift occurred.",
        requiresTool: true,
        expectedTerms: ["25%", "6%", "unchanged", "base"],
        followup: true,
      },
    ],
  },
  {
    id: "soec-ft-process",
    name: "SOEC plus Fischer-Tropsch process",
    domain: "general",
    files: [
      makeTextFile(
        "soec_ft_process_sheet.md",
        `# SOEC and Fischer-Tropsch Process Sheet

SOEC stack data: high-temperature current efficiency test point 1.32 V and 300 mA/cm2.
Hydrogen productivity: 28 kg H2 per MWh electric under steam co-feed test; conventional reference: 21 kg H2 per MWh.
Fischer-Tropsch pilot: lab skid produced 5 gallons per day liquid hydrocarbons. Demonstration design case: 2 barrels per day.
FT operating conditions: 230 degC and 300 psi. Chain growth probability alpha: 0.84.
Carbon source assumption for screening: captured CO2 at 95 USD/tCO2 with 90 percent capture rate.
Electricity base price: 55 USD/MWh. Product selling price screening basis: 1.00 USD/kg liquid fuel.
Project life: 12 years. Discount rate: 10 percent. Installed pilot CAPEX placeholder: 2.9 million USD.
Do not claim commercial readiness from this sheet; it only supports pilot-scale screening.
`,
      ),
    ],
    turns: [
      {
        id: "primary",
        prompt:
          "Analyze this SOEC plus Fischer-Tropsch pilot as a process and economics screening case. Estimate hydrogen use, electricity use, CO2 requirement, annual fuel output for the 2 bpd case, breakeven fuel price, and the largest technical uncertainties. Use a structured decision brief with tables.",
        requiresTool: true,
        expectedTerms: ["28", "2 barrels", "95", "breakeven"],
      },
      {
        id: "followup",
        prompt:
          "Run one additional case where electricity price is 50% lower while all other assumptions stay constant. Show exactly which inputs changed and whether the conclusion materially improves.",
        requiresTool: true,
        expectedTerms: ["50%", "electricity", "constant"],
        followup: true,
      },
    ],
  },
  {
    id: "pv-module-location",
    name: "PV module location production",
    domain: "general",
    files: [
      makeMinimalPdf(
        "Canadian_Solar_HiKu_CS3W_MS_test_sheet.pdf",
        `Canadian Solar HiKu CS3W-MS test sheet. Module power class 440 W STC. Temperature coefficient Pmax -0.37 percent per degC. NOCT 42 degC. Module area 2.108 m2. Inverter efficiency assumption 96 percent. System losses 14 percent. Location for simulation: 24.4539 N, 54.3773 E. Typical daily plane-of-array irradiance screening value 7.5 kWh/m2-day. This simplified sheet is for software testing, not bankable design.`,
      ),
    ],
    turns: [
      {
        id: "primary",
        prompt:
          "Simulate peak module output and daily production under normal clear-sky screening conditions at 24.4539 N, 54.3773 E. Use the uploaded module data, include temperature derating, and return a compact table plus caveats.",
        requiresTool: true,
        expectedTerms: ["440", "24.4539", "54.3773", "temperature"],
      },
      {
        id: "followup",
        prompt:
          "Scale the previous per-module result to 1,000,000 modules, estimate daily AC energy, and identify what site/weather data would be needed before a client could rely on the result.",
        requiresTool: false,
        expectedTerms: ["1,000,000", "daily", "site"],
        followup: true,
      },
    ],
  },
  {
    id: "desalination-environment",
    name: "RO desalination energy and brine",
    domain: "general",
    files: [
      makeTextFile(
        "desalination_ro_screening_case.md",
        `# Reverse Osmosis Desalination Screening Case

Plant product water: 20,000 m3/day.
Specific energy consumption: 3.4 kWh/m3 product water.
Recovery: 45 percent.
Seawater TDS: 42,000 mg/L. Brine TDS estimate: 74,000 mg/L.
Electricity cost: 72 USD/MWh. Grid emissions factor: 0.46 kg CO2/kWh.
Membrane replacement cost: 0.06 USD/m3. Chemicals and maintenance: 0.04 USD/m3.
Installed CAPEX: 42 million USD. Project life: 25 years. WACC: 7 percent.
Intake permit planning limit: 52,000 m3/day.
No site-specific marine dispersion model or seasonal water temperature record is available.
`,
      ),
    ],
    turns: [
      {
        id: "primary",
        prompt:
          "Build a screening model for this desalination project covering water balance, energy use, operating cost, levelized water cost, CO2 emissions, brine volume/TDS, and environmental permitting risks. Use tables and explicitly state what cannot be proven.",
        requiresTool: true,
        expectedTerms: ["20,000", "3.4", "45", "brine"],
      },
      {
        id: "followup",
        prompt:
          "Now evaluate a power supply sensitivity where curtailed PV supplies 40% of electricity at 28 USD/MWh and the remaining 60% stays at the grid price. Keep plant performance unchanged and compare cost and emissions.",
        requiresTool: true,
        expectedTerms: ["40%", "28", "60%", "unchanged"],
        followup: true,
      },
    ],
  },
  {
    id: "plain-agent-control",
    name: "Plain agent behavior control",
    domain: "general",
    files: [],
    turns: [
      {
        id: "identity",
        prompt:
          "What can you help me with? Keep it short and describe your capabilities without naming an underlying model or asking me to use model-specific tools.",
        requiresTool: false,
        expectedTerms: ["Exergy Lab Agent", "tools"],
      },
      {
        id: "simple-followup",
        prompt:
          "In one paragraph, explain the difference between energy efficiency and exergy efficiency for a business user.",
        requiresTool: false,
        expectedTerms: ["energy", "exergy", "useful"],
        followup: true,
      },
    ],
  },
];

async function createProject(caseDef) {
  return fetchJson(`${BASE_URL}/api/projects`, {
    method: "POST",
    body: JSON.stringify({
      name: `[stress] ${caseDef.name} ${isoStamp()}`,
      description: `Stress campaign case ${caseDef.id}`,
      goal: "Evaluate agent reliability, grounding, tool use, formatting, follow-up continuity, and exports.",
      domain: caseDef.domain || "general",
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

async function startRun(projectId, message, documentIds) {
  return fetchJson(`${BASE_URL}/api/projects/${projectId}/runs`, {
    method: "POST",
    body: JSON.stringify({
      message,
      document_ids: documentIds,
      current_document_ids: documentIds,
      mode: "implement",
      thinking_level: "expert",
    }),
  });
}

async function pollRun(projectId, runId) {
  const started = Date.now();
  let lastSnapshot = null;
  while (Date.now() - started < RUN_TIMEOUT_MS) {
    lastSnapshot = await fetchJson(`${BASE_URL}/api/projects/${projectId}/runs/${runId}`);
    const status = lastSnapshot?.run?.status;
    if (terminalStatuses.has(status)) {
      return { ...lastSnapshot, elapsed_ms: Date.now() - started, timed_out: false };
    }
    await sleep(POLL_MS);
  }
  return { ...(lastSnapshot || {}), elapsed_ms: Date.now() - started, timed_out: true };
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
    .map((event) => ({ type: event.type, message: event.message.trim() }));
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
  return /(cannot prove|cannot support|not supported|what the data (can|does) support|assumption|uncertain|uncertainty|data gap|next data|would need|not bankable|not validated|limitations?|important limits|support\s*&\s*limits)/i.test(text);
}

function termMissing(text, term) {
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(escaped, "i").test(text)) return false;
  const numeric = String(term).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (numeric) {
    const value = Number(numeric[0]);
    const answerNumbers = String(text).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) || [];
    if (answerNumbers.some((item) => Math.abs(Number(item) - value) / Math.max(1, Math.abs(value)) <= 0.015)) {
      return false;
    }
  }
  return true;
}

function evaluateTurn(caseDef, turn, snapshot) {
  const run = snapshot.run || {};
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const answer = String(run.final_answer || "");
  const files = collectFiles(run, events);
  const counts = eventCounts(events);
  const completedDiagnostics = latestCompletedDiagnostics(events);
  const issues = [];
  const sourceTexts = (caseDef.files || [])
    .map((file) => typeof file.sourceText === "string" ? file.sourceText : "")
    .filter(Boolean);

  if (snapshot.timed_out) {
    issues.push({
      severity: "blocker",
      type: "run_timeout",
      detail: `Run did not reach a terminal state within ${RUN_TIMEOUT_MS} ms.`,
      broad_fix: "Ensure every tool-backed run has bounded retries, fallback synthesis, and persisted partial results.",
    });
  }

  if (run.status !== "completed") {
    issues.push({
      severity: "blocker",
      type: "not_completed",
      detail: `Run status was ${run.status || "<missing>"}.`,
      broad_fix: "Keep failures inside the agent loop and persist a useful final answer even when one tool fails.",
    });
  }

  if (answer.trim().length < 80) {
    issues.push({
      severity: "blocker",
      type: "missing_or_short_final_answer",
      detail: "Final answer is missing or too short to be useful.",
      broad_fix: "Synthesis should always produce a client-readable answer from available context and tool traces.",
    });
  }

  const forbiddenPatterns = [
    { pattern: /\bDeepSeek\b|\bV4 Flash\b|analysis engine|underlying model/i, label: "model_or_engine_leak" },
    { pattern: /I['’]ve already/i, label: "unnatural_already_phrase" },
    { pattern: /View Details|Export Report|Do Not Claim Yet|Best Next Data Requests|Outputs collected|Point me to the heat-pump rating table/i, label: "legacy_ui_phrase" },
    { pattern: /Traceback|File "\/workspace|failed with exit code|did not return executable Python code/i, label: "raw_tool_failure_leak" },
  ];
  for (const item of forbiddenPatterns) {
    if (item.pattern.test(answer)) {
      issues.push({
        severity: "blocker",
        type: item.label,
        detail: "Final answer exposed internal, legacy, or raw failure language.",
        broad_fix: "Sanitize agent synthesis and translate tool failures into actionable client-facing recovery.",
      });
    }
  }

  for (const check of evaluateExpectedContext({
    answer,
    expectedTerms: turn.expectedTerms || [],
    prompt: turn.message || "",
    sourceTexts,
  })) {
    if (check.status === "missing") {
      issues.push({
        severity: "warning",
        type: "missing_expected_context",
        detail: `Expected context '${check.term}' was not covered. ${check.reason}`,
        broad_fix: "Strengthen source-grounded context injection and final answer requirements for uploaded documents.",
      });
    } else if (check.status === "false_positive" || check.status === "irrelevant") {
      issues.push({
        severity: "info",
        type: "expected_context_false_positive_downgraded",
        detail: `Expected context '${check.term}' was downgraded. ${check.reason}`,
        broad_fix: "Keep expected-context checks source-aware so brittle tokens do not create misleading warnings.",
      });
    }
  }

  if (turn.requiresTool && !counts["tool.started"] && !counts["artifact.created"] && !counts["file.created"]) {
    issues.push({
      severity: "blocker",
      type: "tool_not_used_for_complex_request",
      detail: "Complex modelling request completed without a visible tool or artifact event.",
      broad_fix: "Route complex simulation/economics/export requests through the server-owned tool loop.",
    });
  }

  if (turn.requiresFiles && files.length === 0) {
    issues.push({
      severity: "blocker",
      type: "missing_downloadable_file",
      detail: "The request asked for downloadable output but no file artifact/download URL was produced.",
      broad_fix: "Make generated exports first-class run files with stable URLs.",
    });
  }

  if (turn.requiresTool && !hasMarkdownTable(answer)) {
    issues.push({
      severity: "warning",
      type: "missing_table_for_model_result",
      detail: "Tool-backed result did not include a Markdown table.",
      broad_fix: "Require compact tables for numeric scenario outputs in final synthesis.",
    });
  }

  if (turn.requiresTool && countMarkdownSections(answer) < 2) {
    issues.push({
      severity: "warning",
      type: "weak_response_structure",
      detail: "Tool-backed result lacked clear section structure.",
      broad_fix: "Use a stable, domain-agnostic decision brief structure for complex results.",
    });
  }

  if (turn.requiresTool && !hasSupportLimitsLanguage(answer)) {
    issues.push({
      severity: "warning",
      type: "missing_support_limits",
      detail: "High-stakes answer did not clearly say what the data supports or cannot prove.",
      broad_fix: "Enforce support/limits language for high-stakes outputs regardless of domain.",
    });
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
    issues.push({
      severity: finding.severity,
      type: finding.type,
      detail: finding.detail,
      broad_fix: finding.broad_fix,
      evidence: finding.evidence,
    });
  }

  if (!completedDiagnostics.quality_evaluation || !completedDiagnostics.claim_ledger) {
    issues.push({
      severity: "warning",
      type: "missing_server_quality_gate_diagnostics",
      detail: "The run completed without quality gate diagnostics on run.completed.",
      broad_fix: "Every final answer should persist quality_evaluation and claim_ledger diagnostics for audit and repair.",
    });
  }

  const claimSummary = completedDiagnostics.claim_ledger?.summary;
  if (claimSummary?.unsupported_numeric_claims > 0) {
    issues.push({
      severity: "warning",
      type: "unsupported_numeric_claims_in_claim_ledger",
      detail: `${claimSummary.unsupported_numeric_claims} numeric claim(s) lacked source, tool-output, calculation, assumption, or limitation support.`,
      broad_fix: "Use the private claim ledger as a repair trigger before final answers are emitted.",
      evidence: claimSummary,
    });
  }

  const weakSources = completedDiagnostics.source_extraction_confidence
    .filter((entry) => ["none", "low"].includes(entry?.confidence));
  if (weakSources.length > 0 && turn.requiresTool) {
    issues.push({
      severity: "warning",
      type: "weak_source_extraction_confidence",
      detail: "One or more source documents had weak extraction confidence.",
      broad_fix: "Improve complex-PDF/vision extraction and lower answer confidence when source extraction is weak.",
      evidence: { documents: weakSources.map((entry) => ({ filename: entry.filename, confidence: entry.confidence, issues: entry.issues })) },
    });
  }

  if (
    completedDiagnostics.scenario_reproducibility?.required === true &&
    typeof completedDiagnostics.scenario_reproducibility.score === "number" &&
    completedDiagnostics.scenario_reproducibility.score < 75
  ) {
    issues.push({
      severity: "warning",
      type: "weak_scenario_reproducibility",
      detail: `Scenario reproducibility score was ${completedDiagnostics.scenario_reproducibility.score}.`,
      broad_fix: "Scenario follow-ups should state changed inputs, held constants, calculation basis, and comparison tables.",
      evidence: completedDiagnostics.scenario_reproducibility,
    });
  }

  return {
    case_id: caseDef.id,
    turn_id: turn.id,
    prompt: turn.prompt,
    run_id: run.id,
    status: run.status,
    elapsed_ms: snapshot.elapsed_ms,
    timed_out: Boolean(snapshot.timed_out),
    event_counts: counts,
    progress_messages: eventMessages(events).slice(-12),
    files,
    source_text_chars: sourceTexts.reduce((sum, item) => sum + item.length, 0),
    final_answer_chars: answer.length,
    final_answer: answer,
    quality_evaluation: quality,
    server_quality_diagnostics: completedDiagnostics,
    issues,
  };
}

function summarize(report) {
  const allTurns = report.cases.flatMap((item) => item.turns);
  const issues = allTurns.flatMap((turn) => turn.issues);
  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const issueTypes = issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {});
  const qualityScores = allTurns
    .map((turn) => turn.quality_evaluation?.score)
    .filter((score) => typeof score === "number");
  const coverageValues = allTurns
    .map((turn) => turn.quality_evaluation?.source_value_coverage)
    .filter((coverage) => typeof coverage === "number");
  const unsupportedNumericClaims = allTurns
    .map((turn) => turn.server_quality_diagnostics?.claim_ledger?.summary?.unsupported_numeric_claims)
    .filter((value) => typeof value === "number");
  const scenarioScores = allTurns
    .map((turn) => turn.server_quality_diagnostics?.scenario_reproducibility?.score)
    .filter((value) => typeof value === "number");
  report.summary = {
    cases_run: report.cases.length,
    messages_sent: allTurns.length,
    blockers,
    warnings,
    issue_types: issueTypes,
    average_quality_score: qualityScores.length
      ? Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length)
      : null,
    average_source_value_coverage: coverageValues.length
      ? Number((coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length).toFixed(3))
      : null,
    unsupported_numeric_claims: unsupportedNumericClaims.reduce((sum, value) => sum + value, 0),
    average_scenario_reproducibility_score: scenarioScores.length
      ? Math.round(scenarioScores.reduce((sum, value) => sum + value, 0) / scenarioScores.length)
      : null,
    passed: blockers === 0,
  };
}

async function saveReport(report, outputPath) {
  summarize(report);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = new Date();
  const deadline = startedAt.getTime() + TIMEBOX_MINUTES * 60 * 1000;
  const outputDir = path.resolve("test-results");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `agent-stress-campaign-${isoStamp()}.json`);

  const report = {
    campaign_id: `agent_stress_${isoStamp()}`,
    base_url: BASE_URL,
    started_at: startedAt.toISOString(),
    completed_at: null,
    timebox_minutes: TIMEBOX_MINUTES,
    max_messages: MAX_MESSAGES,
    cases: [],
    summary: {},
  };

  await fetchJson(`${BASE_URL}/api/readiness`, { signal: AbortSignal.timeout(15000) });

  let messagesSent = 0;
  const selectedCases = CASE_FILTER.size > 0
    ? cases.filter((caseDef) => CASE_FILTER.has(caseDef.id))
    : cases;

  for (const caseDef of selectedCases) {
    if (Date.now() >= deadline || messagesSent >= MAX_MESSAGES) break;
    const caseResult = {
      case_id: caseDef.id,
      name: caseDef.name,
      project_id: null,
      documents: [],
      turns: [],
    };
    report.cases.push(caseResult);
    await saveReport(report, outputPath);

    try {
      const project = await createProject(caseDef);
      caseResult.project_id = project.id;
      for (const file of caseDef.files) {
        const doc = await uploadDocument(project.id, file);
        caseResult.documents.push({
          id: doc.id,
          filename: doc.filename,
          mime_type: doc.mime_type,
          size_bytes: doc.size_bytes,
          status: doc.status,
        });
      }

      const documentIds = caseResult.documents.map((doc) => doc.id);
      for (const turn of caseDef.turns) {
        if (Date.now() >= deadline || messagesSent >= MAX_MESSAGES) break;
        messagesSent += 1;
        const started = Date.now();
        try {
          const runResponse = await startRun(project.id, turn.prompt, documentIds);
          const snapshot = await pollRun(project.id, runResponse.run.id);
          const turnResult = evaluateTurn(caseDef, turn, {
            ...snapshot,
            elapsed_ms: Date.now() - started,
          });
          caseResult.turns.push(turnResult);
          console.log(
            `${turnResult.status || "unknown"} ${caseDef.id}/${turn.id} ${turnResult.elapsed_ms}ms issues=${turnResult.issues.length}`,
          );
        } catch (error) {
          caseResult.turns.push({
            case_id: caseDef.id,
            turn_id: turn.id,
            prompt: turn.prompt,
            status: "harness_error",
            elapsed_ms: Date.now() - started,
            timed_out: false,
            event_counts: {},
            progress_messages: [],
            files: [],
            final_answer_chars: 0,
            final_answer: "",
            issues: [
              {
                severity: "blocker",
                type: "harness_or_api_error",
                detail: error?.body ? JSON.stringify(error.body) : String(error?.message || error),
                broad_fix: "API requests and run snapshots must fail with diagnosable structured errors.",
              },
            ],
          });
          console.error(`failed ${caseDef.id}/${turn.id}:`, error?.message || error);
        }
        await saveReport(report, outputPath);
      }
    } catch (error) {
      caseResult.turns.push({
        case_id: caseDef.id,
        turn_id: "case_setup",
        prompt: "<case setup>",
        status: "harness_error",
        elapsed_ms: 0,
        timed_out: false,
        event_counts: {},
        progress_messages: [],
        files: [],
        final_answer_chars: 0,
        final_answer: "",
        issues: [
          {
            severity: "blocker",
            type: "case_setup_failed",
            detail: error?.body ? JSON.stringify(error.body) : String(error?.message || error),
            broad_fix: "Project and document setup must be reliable before agent runs start.",
          },
        ],
      });
      console.error(`setup failed ${caseDef.id}:`, error?.message || error);
      await saveReport(report, outputPath);
    }
  }

  report.completed_at = new Date().toISOString();
  await saveReport(report, outputPath);
  console.log(`stress report: ${outputPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
