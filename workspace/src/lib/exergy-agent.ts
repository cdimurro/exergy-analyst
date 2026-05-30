import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { basename, join } from "path";
import { promisify } from "util";

import { getEnvVar, RUNTIME_DIR } from "@/lib/backend";

const execFileAsync = promisify(execFile);

export const EXERGY_ROOT =
  process.env.EXERGY_ANALYST_ROOT ||
  process.env.ENGINE_ROOT ||
  join(process.cwd(), "..");

export const EXERGY_RUNTIME_DIR =
  typeof RUNTIME_DIR === "string" && RUNTIME_DIR.length > 0
    ? RUNTIME_DIR
    : join(EXERGY_ROOT, "runtime");

const DEFAULT_VENV_PYTHON = join(EXERGY_ROOT, ".venv", "bin", "python");
export const EXERGY_PYTHON =
  process.env.PYTHON_PATH ||
  (existsSync(DEFAULT_VENV_PYTHON) ? DEFAULT_VENV_PYTHON : "python3");

type AgentRunPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function firstSentence(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const match = trimmed.match(/^(.{40,240}?[.!?])\s/);
  return match ? match[1] : trimmed.slice(0, 220);
}

function readinessFromConfidence(confidence: string): string {
  if (confidence === "useful_but_bounded") return "conditional";
  if (confidence === "screening_grade") return "early";
  if (confidence === "intake_only") return "insufficient";
  return "blocked";
}

function credibilityFromConfidence(confidence: string): string {
  if (confidence === "useful_but_bounded") return "C2";
  if (confidence === "screening_grade") return "C1";
  return "C0";
}

function confidenceValue(confidence: string): number {
  if (confidence === "useful_but_bounded") return 0.72;
  if (confidence === "screening_grade") return 0.58;
  if (confidence === "intake_only") return 0.34;
  return 0.18;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayUseCaseLabel(useCases: string[]): string {
  const wrapperLabels = new Set([
    "platform-export-review",
    "prior-analysis-audit",
    "archive-intake",
    "csv-intake",
    "file-intake",
    "structured-data-review",
  ]);
  const domainLabels = useCases.filter((item) => !wrapperLabels.has(item));
  const labels = domainLabels.length > 0 ? domainLabels : useCases;
  return labels.length > 0 ? labels.map(titleCase).join(", ") : "General Engineering Analysis";
}

function evidenceLabel(confidence: string, screens: Record<string, unknown>[]): string {
  if (confidence === "useful_but_bounded") return "Useful but bounded";
  if (confidence === "screening_grade" && screens.length > 0) return "Computed result";
  if (confidence === "screening_grade") return "Evidence review";
  if (confidence === "intake_only") return "Intake only";
  return "Not enough evidence";
}

function decisionLabel(confidence: string, screens: Record<string, unknown>[]): string {
  if (screens.length > 0 && confidence !== "intake_only") return "Act on first-pass prioritization";
  if (confidence === "intake_only") return "Do not act yet";
  return "Analysis complete";
}

function metricCards(screens: Record<string, unknown>[]): Array<{ label: string; value: string; note: string }> {
  const first = screens.find((screen) => isRecord(screen.key_metrics));
  const metrics = first && isRecord(first.key_metrics) ? first.key_metrics : {};
  const cards: Array<{ label: string; value: string; note: string }> = [];
  if (metrics.top_stream !== undefined && metrics.top_stream !== null) {
    cards.push({ label: "First Place To Inspect", value: String(metrics.top_stream), note: "Highest useful-work signal in the current evidence." });
  }
  if (typeof metrics.accessible_exergy_mwh === "number") {
    cards.push({ label: "Accessible Exergy", value: `${metrics.accessible_exergy_mwh} MWh_ex`, note: "Useful-work potential, not just heat quantity." });
  }
  if (typeof metrics.total_energy_mwh === "number") {
    cards.push({ label: "Total Energy", value: `${metrics.total_energy_mwh} MWh`, note: "Raw energy quantity in the screened data." });
  }
  if (typeof metrics.weighted_exergy_factor === "number") {
    cards.push({ label: "Quality Factor", value: metrics.weighted_exergy_factor.toFixed(3), note: "Delivery-weighted exergy factor." });
  }
  if (typeof metrics.peak_power_stc_w === "number") {
    cards.push({ label: "Peak Power", value: `${metrics.peak_power_stc_w} W`, note: "Module DC rating from the datasheet." });
  }
  if (typeof metrics.site_peak_power_w === "number") {
    cards.push({ label: "Site Peak Power", value: `${metrics.site_peak_power_w} W`, note: "Temperature-adjusted peak DC output for the assumed cell temperature." });
  }
  if (typeof metrics.average_daily_generation_kwh === "number") {
    cards.push({ label: "Average Daily Generation", value: `${metrics.average_daily_generation_kwh} kWh/day`, note: "One-module yield estimate at the requested location." });
  }
  if (typeof metrics.annual_generation_kwh === "number") {
    cards.push({ label: "Annual Generation", value: `${metrics.annual_generation_kwh} kWh/year`, note: "One-module annualized yield from the daily estimate." });
  }
  if (typeof metrics.solar_exergy_factor === "number") {
    cards.push({ label: "Exergy Factor", value: metrics.solar_exergy_factor.toFixed(3), note: "Petela solar-radiation exergy factor; generated DC electricity has exergy factor 1.0." });
  }
  if (typeof metrics.plane_of_array_sun_hours === "number") {
    cards.push({ label: "Equivalent Sun Hours", value: `${metrics.plane_of_array_sun_hours} h/day`, note: "Irradiance basis for the requested location." });
  }
  if (typeof metrics.performance_ratio === "number") {
    cards.push({ label: "Performance Ratio", value: metrics.performance_ratio.toFixed(2), note: "Generic DC allowance for temperature and operating losses." });
  }
  if (typeof metrics.net_capacity_mw === "number") {
    cards.push({ label: "Net Capacity", value: `${metrics.net_capacity_mw} MW`, note: "Net plant electrical capacity from the extracted basis." });
  }
  if (typeof metrics.gross_capacity_mw === "number") {
    cards.push({ label: "Gross Capacity", value: `${metrics.gross_capacity_mw} MW`, note: "Gross plant electrical capacity before net/export adjustments." });
  }
  if (typeof metrics.heat_rate_btu_per_kwh === "number") {
    cards.push({ label: "Net Heat Rate", value: `${metrics.heat_rate_btu_per_kwh} Btu/kWh`, note: "Fuel input per unit of net electrical output." });
  }
  if (typeof metrics.net_efficiency_pct === "number") {
    cards.push({ label: "Net Efficiency", value: `${metrics.net_efficiency_pct}%`, note: "Thermal efficiency implied by heat rate or extracted directly." });
  }
  if (typeof metrics.capacity_factor_pct === "number") {
    cards.push({ label: "Capacity Factor", value: `${metrics.capacity_factor_pct}%`, note: "Utilization basis used for annual generation." });
  }
  if (typeof metrics.annual_generation_gwh === "number") {
    cards.push({ label: "Annual Generation", value: `${metrics.annual_generation_gwh} GWh/year`, note: "Annual net generation at the stated or assumed capacity factor." });
  }
  if (typeof metrics.annual_fuel_mmbtu === "number") {
    cards.push({ label: "Annual Fuel Use", value: `${metrics.annual_fuel_mmbtu} MMBtu/year`, note: "Fuel use implied by annual generation and heat rate." });
  }
  if (typeof metrics.gas_price_per_mmbtu === "number") {
    cards.push({ label: "Gas Price", value: `$${metrics.gas_price_per_mmbtu}/MMBtu`, note: "Fuel-price basis found in the document or prompt." });
  }
  if (typeof metrics.fuel_cost_per_mwh === "number") {
    cards.push({ label: "Fuel Cost", value: `$${metrics.fuel_cost_per_mwh}/MWh`, note: "Variable fuel cost implied by heat rate and gas price." });
  }
  if (typeof metrics.power_price_per_mwh === "number") {
    cards.push({ label: "Power Price", value: `$${metrics.power_price_per_mwh}/MWh`, note: "Revenue or PPA price basis found in the document or prompt." });
  }
  if (typeof metrics.spark_spread_per_mwh === "number") {
    cards.push({ label: "Spark Spread", value: `$${metrics.spark_spread_per_mwh}/MWh`, note: "Power price less fuel cost before O&M and other costs." });
  }
  if (typeof metrics.co2_intensity_t_per_mwh === "number") {
    cards.push({ label: "CO2 Intensity", value: `${metrics.co2_intensity_t_per_mwh} t/MWh`, note: "Operational CO2 intensity from extracted data or fuel/heat-rate estimate." });
  }
  if (typeof metrics.annual_co2_t === "number") {
    cards.push({ label: "Annual CO2", value: `${metrics.annual_co2_t} t/year`, note: "Annual operational CO2 at the screened generation level." });
  }
  if (typeof metrics.exergy_efficiency_proxy_pct === "number") {
    cards.push({ label: "Exergy Efficiency Proxy", value: `${metrics.exergy_efficiency_proxy_pct}%`, note: "Fuel-to-electric useful-work proxy; electricity exergy factor is 1.0." });
  }
  return cards;
}

function nextActionKind(action: string): string {
  const lower = action.toLowerCase();
  if (/\b(flow|pump|valve|temperature|time series|hydraulic)\b/.test(lower)) return "Data request";
  if (/\b(cost|opex|capex|tariff|price|financial|roi|revenue)\b/.test(lower)) return "Economics request";
  if (/\b(customer|comfort|service|complaint|unmet)\b/.test(lower)) return "Service-quality request";
  if (/\b(add|request|provide|upload|join)\b/.test(lower)) return "Data request";
  if (/\b(investigate|inspect|review|check)\b/.test(lower)) return "Engineering action";
  return "Next action";
}

function actionPayoff(action: string): string {
  const lower = action.toLowerCase();
  if (/\b(flow|pump|valve|hydraulic)\b/.test(lower)) return "Shows whether the exergy opportunity is hydraulically actionable.";
  if (/\b(cost|opex|capex|tariff|price|financial|roi|revenue)\b/.test(lower)) return "Converts useful-work potential into financial impact.";
  if (/\b(customer|comfort|service|complaint|unmet)\b/.test(lower)) return "Prevents optimization that saves energy but hurts service quality.";
  if (/\b(temperature|time series|operating)\b/.test(lower)) return "Separates persistent opportunities from one-off operating noise.";
  return "Improves confidence and reduces unsupported inference.";
}

function topStreamFromScreens(screens: Record<string, unknown>[]): string | null {
  const first = screens.find((screen) => isRecord(screen.key_metrics));
  const metrics = first && isRecord(first.key_metrics) ? first.key_metrics : {};
  return metrics.top_stream !== undefined && metrics.top_stream !== null ? String(metrics.top_stream) : null;
}

function hasUseCase(useCases: string[], pattern: string): boolean {
  return useCases.some((item) => item.toLowerCase().includes(pattern));
}

function buildDataRequests(args: {
  nextActions: string[];
  detectedUseCases: string[];
  screens: Record<string, unknown>[];
}): Array<{ request: string; kind: string; why_it_matters: string }> {
  const topStream = topStreamFromScreens(args.screens);
  if (hasUseCase(args.detectedUseCases, "district-heating")) {
    const target = topStream ? `${topStream} and the next two ranked branches` : "the top-ranked branches";
    return [
      {
        kind: "Operating data request",
        request: `Collect branch-level flow rate, pump power, valve position, and supply/return temperature time series for ${target}.`,
        why_it_matters: "Shows whether the useful-work signal is caused by a controllable hydraulic or temperature-control issue rather than a one-off sample artifact.",
      },
      {
        kind: "Budget basis request",
        request: "Provide installed-cost, controls scope, maintenance/OPEX, operating-hours, tariff or heat-value assumptions, and expected intervention life.",
        why_it_matters: "Converts the exergy opportunity into a budget-grade financial case instead of a technical ranking.",
      },
      {
        kind: "Service-quality request",
        request: "Provide customer comfort or service-quality data, including indoor temperature complaints, unmet load events, and return-temperature constraints.",
        why_it_matters: "Prevents recommending an operating change that improves energy quality while degrading customer service.",
      },
    ];
  }
  if (hasUseCase(args.detectedUseCases, "industrial-waste-heat")) {
    const target = topStream || "the top-ranked stream";
    return [
      {
        kind: "Process data request",
        request: `Collect flow rate, duty cycle, operating-hours, contamination/fouling constraints, and temperature stability for ${target}.`,
        why_it_matters: "Determines whether the apparent useful-work source is recoverable in real plant operation.",
      },
      {
        kind: "Integration request",
        request: "Map nearby heat demands by required temperature, schedule, distance, and retrofit constraints.",
        why_it_matters: "Useful heat only has value if there is a matching demand or conversion pathway.",
      },
      {
        kind: "Economics request",
        request: "Provide installed-cost, avoided fuel or electricity value, downtime constraints, OPEX, and maintenance assumptions.",
        why_it_matters: "Turns a thermodynamic opportunity into a financeable retrofit screen.",
      },
    ];
  }
  const requestLike = args.nextActions.filter((action) => {
    const lower = action.toLowerCase();
    return /\b(add|request|provide|upload|join|collect|measure|instrument)\b/.test(lower);
  });
  const source = requestLike.length > 0 ? requestLike : args.nextActions;
  return source.slice(0, 5).map((action) => ({
    request: action,
    kind: nextActionKind(action),
    why_it_matters: actionPayoff(action),
  }));
}

function buildRecommendedActions(nextActions: string[]): Array<{ action: string; kind: string; why_it_matters: string }> {
  return nextActions.slice(0, 5).map((action) => ({
    action,
    kind: nextActionKind(action),
    why_it_matters: actionPayoff(action),
  }));
}

function priorityRecommendation(args: {
  detectedUseCases: string[];
  screens: Record<string, unknown>[];
}): Record<string, string> | null {
  const topStream = topStreamFromScreens(args.screens);
  if (hasUseCase(args.detectedUseCases, "district-heating")) {
    return {
      title: topStream ? `Instrument and inspect ${topStream} first` : "Instrument the top-ranked district-heating branch first",
      rationale: "It is the fastest way to test whether the computed useful-work signal is controllable, recurring, and large enough to justify engineering budget.",
      evidence_needed: "Flow rate, pump power, valve position, supply/return temperatures, operating schedule, and customer comfort or unmet-load records.",
    };
  }
  if (hasUseCase(args.detectedUseCases, "industrial-waste-heat")) {
    return {
      title: topStream ? `Validate recoverability for ${topStream}` : "Validate recoverability for the top useful-work stream",
      rationale: "The top thermodynamic opportunity only matters commercially if the heat is clean, available, and matchable to a nearby demand.",
      evidence_needed: "Flow rate, duty cycle, contaminants, operating-hours, nearby heat demands, retrofit constraints, and avoided energy value.",
    };
  }
  return null;
}

function buildClientSummary(args: {
  run: AgentRunPayload;
  confidence: string;
  detectedUseCases: string[];
  insights: Record<string, unknown>[];
  limitations: string[];
  nextActions: string[];
  screens: Record<string, unknown>[];
  executiveAnswer: string;
}): Record<string, unknown> {
  const supportedClaims = args.insights.slice(0, 5).map((insight) => ({
    claim: String(insight.title || "Supported claim"),
    evidence: String(insight.evidence || "Evidence recorded in the uploaded package."),
    support: String(insight.support || "computed"),
    recommendation: String(insight.recommendation || ""),
  }));
  const dataRequests = buildDataRequests({
    nextActions: args.nextActions,
    detectedUseCases: args.detectedUseCases,
    screens: args.screens,
  });
  const recommendedActions = buildRecommendedActions(args.nextActions);
  const files = recordArray(args.run.files).map((file) => ({
    filename: file.filename,
    type: file.file_type,
    parser_status: file.parser_status,
    summary: file.summary,
  }));
  const trace = recordArray(args.run.stages).map((stage) => ({
    name: stage.name,
    status: stage.status,
    summary: stage.summary,
  }));
  return {
    product_surface: "exergy_analyst",
    decision: decisionLabel(args.confidence, args.screens),
    evidence_label: evidenceLabel(args.confidence, args.screens),
    confidence: args.confidence,
    conclusion: args.executiveAnswer,
    use_case_label: displayUseCaseLabel(args.detectedUseCases),
    computed_metrics: metricCards(args.screens),
    supported_claims: supportedClaims,
    not_proven: args.limitations,
    recommended_actions: recommendedActions,
    data_requests: dataRequests,
    priority_recommendation: priorityRecommendation({
      detectedUseCases: args.detectedUseCases,
      screens: args.screens,
    }),
    reviewed_files: files,
    analysis_trace: trace,
    client_warning: args.screens.length > 0
      ? "This is a computed result from the available inputs. It can guide where to look first, but it is not a capital decision or validation report."
      : "This is an intake result. It identifies what was uploaded and what can be parsed, but it does not yet compute a domain result.",
  };
}

function sourceEvidenceDigest(run: AgentRunPayload): Record<string, unknown> {
  const files = recordArray(run.files);
  const parserReady = files.filter((file) => String(file.parser_status || "").toLowerCase().includes("available")).length;
  const facts = [
    `${files.length} uploaded file${files.length === 1 ? "" : "s"} reviewed.`,
    `${parserReady} file${parserReady === 1 ? "" : "s"} matched a parser-ready intake path.`,
    `${recordArray(run.physics_screens).length} deterministic physics or data screen${recordArray(run.physics_screens).length === 1 ? "" : "s"} produced.`,
  ];
  return {
    digest_status: files.length > 0 ? "facts_extracted" : "partial_extraction",
    headline_facts: facts,
    confidence_tier_summary: {
      "well-substantiated": run.confidence === "useful_but_bounded" ? 1 : 0,
      moderate: run.confidence === "screening_grade" ? 1 : 0,
      preliminary: run.confidence === "intake_only" || run.confidence === "not_enough_evidence" ? 1 : 0,
    },
    actionable_caveats: stringArray(run.limitations).slice(0, 3).map((message) => ({
      severity: "warning",
      message,
      suggested_action: "Provide the missing measured inputs, operating basis, and source documents before using the result as decision-grade evidence.",
    })),
  };
}

function buildModuleEvaluations(run: AgentRunPayload): Record<string, Record<string, unknown>> {
  const screens = recordArray(run.physics_screens);
  const files = recordArray(run.files);
  const insights = recordArray(run.top_insights);
  const limitations = stringArray(run.limitations);
  const confidence = String(run.confidence || "not_enough_evidence");
  const conf = confidenceValue(confidence);

  return {
    physics: {
      verdict: screens.length > 0 ? "conditional" : "blocked",
      confidence_0_1: conf,
      summary: screens.length > 0
        ? `${screens.length} deterministic physics/data screen(s) ran successfully.`
        : "No supported physics solver matched the uploaded evidence yet.",
      details: {
        evidence_coverage: screens.length > 0 ? 0.65 : 0.2,
        screens,
        solver_status: screens.length > 0 ? "engineering estimate" : "not computed",
      },
    },
    data_quality: {
      verdict: files.length > 0 ? "conditional" : "blocked",
      confidence_0_1: files.length > 0 ? Math.max(0.35, conf - 0.05) : 0.15,
      summary: files.length > 0
        ? `${files.length} upload(s) inventoried and normalized where parser support exists.`
        : "No uploaded evidence was available.",
      details: { files },
    },
    performance: {
      verdict: insights.length > 0 ? "conditional" : "blocked",
      confidence_0_1: conf,
      summary: insights.length > 0
        ? `${insights.length} evidence-backed performance insight(s) were extracted.`
        : "No performance claim could be tested from the current files.",
      details: { insights },
    },
    economics: {
      verdict: "blocked",
      confidence_0_1: 0.2,
      summary: "Economic conclusions are limited until CAPEX, OPEX, utilization, and price assumptions are supplied.",
      details: {
        missing_inputs: ["CAPEX basis", "OPEX breakdown", "capacity utilization", "product or energy price", "discount rate"],
      },
    },
    risk: {
      verdict: limitations.length > 0 ? "conditional" : "pass",
      confidence_0_1: limitations.length > 0 ? 0.48 : conf,
      summary: limitations.length > 0
        ? `${limitations.length} important limitation(s) remain before decision-grade use.`
        : "No major limitation was detected by the current analysis path.",
      details: { limitations },
    },
  };
}

export function buildExergyArtifactInput(args: {
  run: AgentRunPayload;
  prompt: string;
  actionId: string;
  title?: string;
  parentArtifactId?: string;
}): Record<string, unknown> {
  const run = args.run;
  const confidence = String(run.confidence || "not_enough_evidence");
  const detectedUseCases = stringArray(run.detected_use_cases);
  const insights = recordArray(run.top_insights);
  const limitations = stringArray(run.limitations);
  const nextActions = stringArray(run.next_actions);
  const screens = recordArray(run.physics_screens);
  const executiveAnswer = String(run.executive_answer || "Analysis complete.");
  const headline = firstSentence(executiveAnswer) || "Analysis complete.";
  const readinessTier = readinessFromConfidence(confidence);
  const credibilityTier = credibilityFromConfidence(confidence);
  const moduleEvaluations = buildModuleEvaluations(run);
  const clientSummary = buildClientSummary({
    run,
    confidence,
    detectedUseCases,
    insights,
    limitations,
    nextActions,
    screens,
    executiveAnswer,
  });

  const strengths = insights.length > 0
    ? insights.slice(0, 4).map((insight) => {
        const title = String(insight.title || "Evidence-backed insight");
        const evidence = String(insight.evidence || "");
        return evidence ? `${title}: ${evidence}` : title;
      })
    : ["The uploaded material was inventoried and the platform identified which parts can be parsed today."];

  const concerns = limitations.length > 0
    ? limitations.slice(0, 4)
    : ["The current run is bounded by the available evidence until more measured operating data is available."];

  const content = {
    run_state: "completed",
    extraction_status: screens.length > 0 ? "complete" : "partial",
    evidence_level: screens.length > 0 ? "computed" : "intake_only",
    memo_markdown: String(run.memo_markdown || ""),
    executive_summary: executiveAnswer,
    detected_use_cases: detectedUseCases,
    files: recordArray(run.files),
    stages: recordArray(run.stages),
    tool_calls: recordArray(run.tool_calls),
    physics_screens: screens,
    client_summary: clientSummary,
    analysis_type: "exergy_agent_assessment",
    structured_insights: insights.map((insight) => ({
      insight_type: insight.support === "computed" ? "validated" : "finding",
      title: insight.title,
      evidence: insight.evidence,
      recommendation: insight.recommendation,
      support: insight.support,
    })),
    key_findings: insights.map((insight) => ({
      statement: insight.title,
      evidence: insight.evidence,
      recommendation: insight.recommendation,
    })),
    limitations,
    module_evaluations: moduleEvaluations,
    brief: {
      headline,
      commercial_name: "Uploaded Evidence Package",
      combined_verdict_label: readinessTier.replace(/_/g, " "),
      readiness_tier: readinessTier,
      credibility_tier: credibilityTier,
      evidence_strength: confidence.replace(/_/g, " "),
      domain: detectedUseCases.join(", ") || "general",
      key_strengths: strengths,
      key_concerns: concerns,
      next_actions: nextActions.length > 0
        ? nextActions
        : ["Upload measured operating data, source documents, and explicit assumptions for a stronger assessment."],
      module_summary: Object.entries(moduleEvaluations).map(([moduleName, module]) => ({
        module_name: moduleName === "data_quality" ? "data quality" : moduleName,
        verdict: module.verdict,
        summary: module.summary,
      })),
      founder_insights: {
        technology_identity: detectedUseCases.length > 0
          ? `The evidence appears related to ${detectedUseCases.map((item) => item.replace(/-/g, " ")).join(", ")}.`
          : "The evidence package has not been assigned to a specific technical domain yet.",
      },
      ranked_gap_guidance: concerns.slice(0, 4).map((concern, index) => ({
        parameter: `Gap ${index + 1}`,
        impact: index === 0 ? "high" : "medium",
        why_it_matters: concern,
      })),
    },
    founder_surface: {
      headline,
      verdict_summary: {
        outcome: readinessTier,
        verdict_text: executiveAnswer,
      },
      bottlenecks: {
        blocking_factors: concerns,
      },
      path_forward: {
        next_actions: nextActions,
      },
    },
    path_to_investable: {
      changes_required: nextActions.slice(0, 4).map((action) => ({
        change: action,
        payoff: actionPayoff(action),
      })),
    },
    evidence_digest: sourceEvidenceDigest(run),
  };

  return {
    schema_version: 1,
    type: "evaluation",
    title: args.title || "Exergy Analyst Assessment",
    summary: executiveAnswer,
    content,
    source: "canonical_engine",
    raw: run,
    metadata: {
      prompt: args.prompt,
      engine: "exergy_analyst",
      confidence,
      use_cases: detectedUseCases,
    },
    parent_id: args.parentArtifactId,
    action_id: args.actionId,
    provenance: {
      source: "canonical_engine",
      deterministic: true,
      engine_version: "exergy-analyst",
      lane: "official",
    },
    pinned: false,
  };
}

function normalizeFilename(value: string): string {
  return basename(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ")
    .trim();
}

function filenameMatches(filename: string, requestedNames: string[]): boolean {
  if (requestedNames.length === 0) return true;
  const normalized = normalizeFilename(filename);
  return requestedNames.some((name) => {
    const requested = normalizeFilename(name);
    return normalized === requested || normalized.includes(requested) || requested.includes(normalized);
  });
}

export async function getProjectUploadPaths(projectId: string, onlyFilenames: string[] = []): Promise<string[]> {
  const docsDir = join(EXERGY_RUNTIME_DIR, "projects", `proj_${projectId}`, "documents");
  const requestedNames = onlyFilenames.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  try {
    const files = await readdir(docsDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));
    const paths: string[] = [];
    for (const jsonFile of jsonFiles) {
      try {
        const raw = await readFile(join(docsDir, jsonFile), "utf-8");
        const doc = JSON.parse(raw) as Record<string, unknown>;
        if (typeof doc.id !== "string" || typeof doc.filename !== "string") continue;
        if (!filenameMatches(doc.filename, requestedNames)) continue;
        const id = String(doc.id || jsonFile.replace(/\.json$/, ""));
        const storedName = files.find((file) => file.startsWith(`${id}_`));
        if (storedName) paths.push(join(docsDir, storedName));
      } catch {
        // Ignore malformed document metadata and continue with readable files.
      }
    }
    if (paths.length > 0 || requestedNames.length === 0) return paths;
    return getProjectUploadPaths(projectId);
  } catch {
    return [];
  }
}

export async function saveAnalyzeUpload(file: File | string, originalName: string): Promise<string> {
  const ingestDir = join(EXERGY_RUNTIME_DIR, "ingestion");
  await mkdir(ingestDir, { recursive: true });
  const safeName = basename(originalName).replace(/[^a-zA-Z0-9._-]+/g, "_") || "upload.txt";
  const filePath = join(ingestDir, `analyze_${Date.now()}_${safeName}`);
  if (typeof file === "string") {
    await writeFile(filePath, file, "utf-8");
  } else {
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));
  }
  return filePath;
}

export async function runExergyWorkspaceAgent(
  prompt: string,
  filePaths: string[],
  timeout = 600_000,
): Promise<AgentRunPayload> {
  const envVars: Record<string, string> = {
    ...(process.env as unknown as Record<string, string>),
    PYTHONPATH: [join(EXERGY_ROOT, "src"), EXERGY_ROOT, process.env.PYTHONPATH || ""]
      .filter(Boolean)
      .join(":"),
    EXERGY_AGENT_MODEL: process.env.EXERGY_AGENT_MODEL || "deepseek-v4-flash",
  };
  for (const key of [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_V3_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "EXERGY_MINERU_COMMAND",
    "MINERU_COMMAND",
    "BT_MINERU_OCR_COMMAND",
    "MINERU_OCR_COMMAND",
    "EXERGY_MINERU_PYTHON",
    "EXERGY_BREAKTHROUGH_ENGINE_ROOT",
    "BREAKTHROUGH_ENGINE_ROOT",
    "EXERGY_MINERU_BACKEND",
    "BT_MINERU_BACKEND",
    "MINERU_BACKEND",
    "EXERGY_MINERU_TIMEOUT_SECONDS",
    "BT_MINERU_TIMEOUT_S",
    "EXERGY_DISABLE_MINERU",
    "MINERU_LANGUAGE",
    "MINERU_LANG",
    "MINERU_USE_OCR",
    "MINERU_ENABLE_TABLE",
    "MINERU_ENABLE_FORMULA",
    "MINERU_TIMEOUT_SECONDS",
  ]) {
    const value = getEnvVar(key);
    if (value) envVars[key] = value;
  }

  const args = ["-m", "exergy_analyst", "agent-run", "--prompt", prompt, ...filePaths];
  try {
    const { stdout } = await execFileAsync(EXERGY_PYTHON, args, {
      cwd: EXERGY_ROOT,
      env: envVars as NodeJS.ProcessEnv,
      maxBuffer: 20 * 1024 * 1024,
      timeout,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const detail = err.stderr || err.stdout || err.message || "Unknown Exergy Analyst runtime error";
    throw new Error(detail.slice(0, 1200));
  }
}
