import type { InitialEvaluationProjectState } from "@/lib/initial-evaluation-guardrail";
import type { Project, StorageAdapter } from "@/lib/storage/types";

interface AgentOrchestratorArgs {
  projectId: string;
  message: string;
  history?: Array<{ role?: string; content?: string }> | null;
  project: Project | null | undefined;
  projectDomain: string;
  state: InitialEvaluationProjectState;
  storage: StorageAdapter;
}

const RESEARCH_RE = /\b(search|find|look up|pull|review|survey)\b.*\b(papers?|literature|research|studies|sources?|benchmarks?|latest|current|state of the art)\b|\bwhat does the literature say\b|\bstate of the art\b/i;
const DEEP_RESEARCH_RE = /\b(deep|comprehensive|thorough|systematic|full)\b.*\b(research|literature|review|survey)\b|\bstate of the art\b/i;
const SIMULATION_RE = /\b(run|perform|do|set up)?\s*(physics\s*)?(simulat(?:e|ion)|model|solver|calculate|compute)\b|\bsensitivity\b|\bscenario\b|\bwhat if\b/i;
const ECONOMICS_RE = /\b(economics?|bankability|financial model|npv|irr|payback|lcoe|lcoh|lcof|capex|opex|wacc|breakeven|scenario|sensitivity|unit economics)\b/i;
const UPLOADED_EVIDENCE_RE = /\b(analy[sz]e|assess|evaluate|review|screen|process|extract|calculate|summari[sz]e|find insights?|what matters|what should)\b.*\b(file|upload|uploaded|attached|document|dataset|spreadsheet|csv|pdf|json|data)\b|\b(attached|uploaded)\b/i;
const DEEP_ANALYSIS_RE = /\b(deep|comprehensive|thorough|complete|full)\s+(analysis|assessment|evaluation|review|diligence)\b|\bdue diligence\b|\binvestment thesis\b|\bscientific review\b/i;
const CHART_RE = /\b(chart|graph|plot|visuali[sz]ation|dashboard|table|waterfall|tornado)\b/i;
const ENVIRONMENTAL_SITE_RE = /\b(environmental|ecolog(?:y|ical)|biodiversity|habitat|wetland|soil|air quality|water quality|flood|fire risk|wildfire|permitting|site risk|environmental risk|environmental impact)\b[\s\S]{0,220}\b(site|location|coordinates?|lat(?:itude)?|lon(?:gitude)?|near|around|at|facility|plant|project|parcel|address)\b|\b(?:lat(?:itude)?|coordinates?)\b[\s\S]{0,220}\b(environmental|ecolog(?:y|ical)|biodiversity|soil|air quality|water|fire risk|wildfire)\b/i;
const CLEAR_SAFETY_RE = /\b(step[- ]?by[- ]?step|instructions?|recipe|protocol|how (?:do|to) i|build|make|design|synthesize|weaponi[sz]e)\b[\s\S]{0,140}\b(bomb|explosive|weapon|poison|nerve agent|bioweapon|pathogen|dirty bomb)\b|\b(bypass|disable|defeat|remove)\b[\s\S]{0,80}\b(safety|interlock|protection|limit(?:er)?)\b|\b(home|garage|backyard)\b[\s\S]{0,80}\b(nuclear reactor|uranium enrichment|plutonium)\b/i;
const PROVIDER_FAILURE_META_RE = /\b(?:model|provider)(?:-backed)?\s+(?:call|response)?\s*(?:fails?|failed|unavailable)|\beven if the model\b/i;

function textOf(args: AgentOrchestratorArgs): string {
  return [
    args.message,
    args.project?.name || "",
    args.project?.description || "",
    args.project?.goal || "",
    args.projectDomain,
  ].join(" ");
}

function cleanDomain(domain: string | null | undefined): string {
  return domain && domain !== "general" ? domain : "general";
}

function inferDomain(args: AgentOrchestratorArgs): string {
  const explicit = cleanDomain(args.projectDomain || args.project?.domain);
  if (explicit !== "general") return explicit;

  const text = textOf(args).toLowerCase();
  if (/\bheat pump|cop|refrigerant\b/.test(text)) return "heat_pump_hvac";
  if (/\bdistrict heating|substation|supply temp|return temp\b/.test(text)) return "district_heating";
  if (/\bwaste heat|flue gas|exhaust heat|industrial heat\b/.test(text)) return "industrial_heat";
  if (/\bsolar|pv|photovoltaic|module|panel\b/.test(text)) return "photovoltaic";
  if (/\bbattery|cell|lithium|soc|soh|cycle life\b/.test(text)) return "electrochemical_storage";
  if (/\bfuel cell|pemfc|sofc\b/.test(text)) return "fuel_cell_systems";
  if (/\bhydrogen|electroly[sz]er|electrolysis\b/.test(text)) return "electrolysis_conversion";
  if (/\bsteel|dri|blast furnace|eaf\b/.test(text)) return "steel_decarbonization";
  if (/\bcement|clinker|kiln\b/.test(text)) return "cement_decarbonization";
  if (/\bwind|turbine|scada\b/.test(text)) return "wind_power";
  if (/\bev|electric vehicle|vehicle range\b/.test(text)) return "electric_vehicle";
  if (/\bsynthetic fuel|saf|fischer|ft synthesis|power-to-liquid|ptl\b/.test(text)) return "fuels_chemical";
  if (/\bcarbon capture|co2 capture|dac\b/.test(text)) return "carbon_capture";
  return "general";
}

function hasNumericInputs(message: string): boolean {
  return /[-+]?\d+(?:\.\d+)?\s*(?:%|kw|kwh|mw|mwh|c|°c|k|bar|pa|kg|g|ton|tonne|tpd|\/h|per\s+hour|usd|\$)?\b/i.test(message);
}

function extractKnownParams(message: string): Record<string, number> {
  const params: Record<string, number> = {};
  const lower = message.toLowerCase();
  const grab = (key: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        params[key] = value;
        return;
      }
    }
  };

  grab("cop_heating", [/\bcop\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)/, /([-+]?\d+(?:\.\d+)?)\s*cop\b/]);
  grab("efficiency_pct", [/\befficiency\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)\s*%?/, /([-+]?\d+(?:\.\d+)?)\s*%\s*efficiency\b/]);
  grab("supply_temp_c", [/\bsupply\s*(?:temperature|temp)?\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|°c)?/]);
  grab("return_temp_c", [/\breturn\s*(?:temperature|temp)?\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|°c)?/]);
  grab("temperature_c", [/\btemperature\s*(?:=|:|is|of|to|at)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|°c)\b/, /\bat\s*([-+]?\d+(?:\.\d+)?)\s*(?:c|°c)\b/]);
  grab("temperature_k", [/\btemperature\s*(?:=|:|is|of|to|at)?\s*([-+]?\d+(?:\.\d+)?)\s*k\b/, /\bat\s*([-+]?\d+(?:\.\d+)?)\s*k\b/]);
  grab("pressure_bar", [/\bpressure\s*(?:=|:|is|of|to|at)?\s*([-+]?\d+(?:\.\d+)?)\s*bar\b/]);
  grab("power_kw", [/\bpower\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)\s*kw\b/, /([-+]?\d+(?:\.\d+)?)\s*kw\b/]);
  grab("energy_kwh", [/\benergy\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)\s*kwh\b/, /([-+]?\d+(?:\.\d+)?)\s*kwh\b/]);
  grab("throughput_tpd", [/\bthroughput\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)\s*(?:tpd|tonnes?\s+per\s+day)\b/, /([-+]?\d+(?:\.\d+)?)\s*(?:tpd|tonnes?\s+per\s+day)\b/]);
  grab("capex", [/\bcapex\s*(?:=|:|is|of|to)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)/]);
  grab("opex", [/\bopex\s*(?:=|:|is|of|to)?\s*\$?\s*([-+]?\d+(?:\.\d+)?)/]);
  grab("wacc_pct", [/\bwacc\s*(?:=|:|is|of|to)?\s*([-+]?\d+(?:\.\d+)?)\s*%?/]);

  return params;
}

function hasActionIntent(message: string): boolean {
  return UPLOADED_EVIDENCE_RE.test(message) ||
    RESEARCH_RE.test(message) ||
    SIMULATION_RE.test(message) ||
    ECONOMICS_RE.test(message) ||
    ENVIRONMENTAL_SITE_RE.test(message) ||
    DEEP_ANALYSIS_RE.test(message) ||
    CHART_RE.test(message);
}

function response(content: string, reason: string, followups: string[]): Record<string, unknown> {
  return {
    type: "response",
    content,
    plan_steps: null,
    action: null,
    suggested_followups: followups,
    workflow_orchestration: {
      source: "platform",
      reason,
      starts_with_evidence_intake: false,
    },
  };
}

function action(
  content: string,
  actionType: string,
  config: Record<string, unknown>,
  reason: string,
  followups: string[],
): Record<string, unknown> {
  return {
    type: "action",
    content,
    plan_steps: null,
    questions: null,
    action: {
      type: actionType,
      config,
    },
    continue_with: null,
    suggested_followups: followups,
    workflow_orchestration: {
      source: "platform",
      reason,
      starts_with_evidence_intake: actionType === "evidence_evaluation",
      routed_tool: actionType,
    },
  };
}

async function latestArtifactId(args: AgentOrchestratorArgs): Promise<string | null> {
  const artifacts = await args.storage.listArtifacts(args.projectId);
  return artifacts[0]?.id || null;
}

function projectDescription(args: AgentOrchestratorArgs): string {
  return [
    args.message,
    args.project?.description ? `Project context: ${args.project.description}` : "",
    args.project?.goal ? `Goal: ${args.project.goal}` : "",
  ].filter(Boolean).join("\n\n");
}

export function buildAgentSafetyResponse(message: string): Record<string, unknown> | null {
  if (!CLEAR_SAFETY_RE.test(message || "")) return null;
  return response(
    [
      "I cannot help with instructions for dangerous construction, weaponization, safety bypasses, or unsafe nuclear or chemical work.",
      "",
      "I can still help in a legitimate direction: risk assessment, regulatory pathway, safety case structure, incident review, hazard analysis, or a non-operational technical overview.",
    ].join("\n"),
    "clear_safety_violation",
    [
      "Turn this into a safety risk assessment",
      "Explain the regulatory barriers",
      "Create a safe diligence checklist",
    ],
  );
}

export async function buildAgentOrchestratedResponse(args: AgentOrchestratorArgs): Promise<Record<string, unknown> | null> {
  const message = (args.message || "").trim();
  if (!message) return null;
  if (PROVIDER_FAILURE_META_RE.test(message)) return null;
  if (args.state.documentEvidence) return null;
  if (!hasActionIntent(message)) return null;

  const domain = inferDomain(args);
  const docsExist = !!args.state.hasUploadedDocuments;
  const priorEvaluation = !!args.state.hasSuccessfulEvaluationArtifact;
  const anyArtifact = !!args.state.hasAnyArtifact || priorEvaluation;
  const params = extractKnownParams(message);
  const description = projectDescription(args);

  if (ENVIRONMENTAL_SITE_RE.test(message) && (!docsExist || priorEvaluation)) {
    return action(
      "Collecting site environmental context now using remote weather, air, soil, biodiversity, and fire-data layers where available.",
      "environmental_site_analysis",
      { question: message, description },
      "deterministic_environmental_site_data_route",
      [
        "What does this mean for permitting?",
        "What site data would improve confidence?",
        "Compare this site with another location",
      ],
    );
  }

  if (docsExist && !priorEvaluation && (UPLOADED_EVIDENCE_RE.test(message) || DEEP_ANALYSIS_RE.test(message) || ECONOMICS_RE.test(message))) {
    return action(
      "I’ll start by reading the uploaded evidence, extracting usable values, separating computed findings from assumptions and unresolved gaps, and returning the most useful next actions.",
      "evidence_evaluation",
      { domain, description },
      "uploaded_documents_first_grounded_evaluation",
      [
        "What is strongest enough to act on?",
        "What evidence gaps matter most?",
        "Turn the result into a client memo",
      ],
    );
  }

  if (RESEARCH_RE.test(message)) {
    const query = [
      message,
      args.project?.name || "",
      args.project?.description || "",
      domain !== "general" ? domain.replace(/_/g, " ") : "",
    ].filter(Boolean).join(" ");
    return action(
      DEEP_RESEARCH_RE.test(message)
        ? "I’ll run a broader research pass, synthesize the strongest sources, and call out what the literature does and does not support."
        : "I’ll search published sources and return the useful findings, benchmarks, and open questions.",
      DEEP_RESEARCH_RE.test(message) ? "deep_research" : "literature_search",
      { query },
      DEEP_RESEARCH_RE.test(message) ? "deterministic_deep_research_route" : "deterministic_literature_route",
      [
        "Compare this to the uploaded evidence",
        "What benchmarks matter most?",
        "What should we verify next?",
      ],
    );
  }

  if (CHART_RE.test(message) && anyArtifact) {
    return action(
      "I’ll derive the chart from existing project artifacts only, then show where the data is too thin to plot honestly.",
      "exploratory_analysis",
      {
        question: message,
        analysis_type: /\bsensitivity|tornado|scenario\b/i.test(message) ? "sensitivity" : "comparison",
      },
      "deterministic_chart_or_exploratory_route",
      [
        "Which values are source-backed?",
        "What data would unlock better charts?",
        "Create a client-ready summary",
      ],
    );
  }

  if (/\bsensitivity|scenario|what if|trade[- ]?off|compare all|patterns?\b/i.test(message) && anyArtifact) {
    return action(
      "I’ll use the existing project results to run a derived scenario analysis, highlight the strongest sensitivities, and keep unsupported assumptions visible.",
      "exploratory_analysis",
      {
        question: message,
        analysis_type: /\btrade[- ]?off\b/i.test(message) ? "tradeoff" : "sensitivity",
      },
      "deterministic_sensitivity_route",
      [
        "Which assumption matters most?",
        "What changes the recommendation?",
        "What data would improve confidence?",
      ],
    );
  }

  if (ECONOMICS_RE.test(message)) {
    const artifactId = await latestArtifactId(args);
    return action(
      "I’ll run the economics solver from the numeric inputs and current workspace context, then report the computed metrics, assumptions, sensitivities, and missing finance inputs.",
      "economics_analysis",
      {
        artifact_id: artifactId || undefined,
        question: message,
        domain,
        description,
        params,
      },
      "deterministic_economics_analysis_route",
      [
        "What inputs drive the result?",
        "Create a finance data request",
        "Turn this into an investment memo",
      ],
    );
  }

  if (SIMULATION_RE.test(message) && (hasNumericInputs(message) || priorEvaluation)) {
    return action(
      "I’ll run the strongest available calculation path for this request and report whether the result is computed, an engineering estimate, or not solver-backed.",
      "physics_simulation",
      {
        domain,
        description,
        params,
      },
      "deterministic_physics_simulation_route",
      [
        "Run a sensitivity sweep",
        "Compare this to a baseline",
        "What assumptions limit the result?",
      ],
    );
  }

  if (DEEP_ANALYSIS_RE.test(message) || UPLOADED_EVIDENCE_RE.test(message)) {
    const artifactId = await latestArtifactId(args);
    return action(
      "I’ll run a deeper workspace analysis and return a practical answer with supported findings, caveats, and recommended next steps.",
      anyArtifact ? "deep_analysis" : "evidence_evaluation",
      anyArtifact
        ? { artifact_id: artifactId || undefined, question: message, domain, description }
        : { domain, description },
      anyArtifact ? "deterministic_deep_analysis_route" : "deterministic_general_evaluation_route",
      [
        "What is strongest enough to act on?",
        "What should we verify next?",
        "Make this client-ready",
      ],
    );
  }

  return null;
}
