import type { ActionType } from "@/lib/storage/types";

export interface AgentToolDefinition {
  type: ActionType;
  label: string;
  whenToUse: string;
  produces: string;
  inputHint: string;
  complexity: "simple" | "specialized" | "long_running";
}

export const AGENT_TOOL_REGISTRY: AgentToolDefinition[] = [
  {
    type: "evidence_evaluation",
    label: "Evidence and file analysis",
    whenToUse: "Uploaded files, messy evidence, decks, datasheets, technical reports, and any request where the answer depends on file contents.",
    produces: "Extracted facts, parameters, evidence gaps, first-pass calculations when possible, and a plain-language evidence summary.",
    inputHint: "domain, description, question, current_attachments, params when the user supplied numbers",
    complexity: "specialized",
  },
  {
    type: "document_analysis",
    label: "Focused document extraction",
    whenToUse: "The user wants specific fields, tables, or parameters extracted from a document before deeper analysis.",
    produces: "Structured document fields and confidence notes.",
    inputHint: "document_id, product_type or domain",
    complexity: "simple",
  },
  {
    type: "comprehensive_analysis",
    label: "Comprehensive document analysis",
    whenToUse: "The user asks to extract everything important from one or more documents, including claims, parameters, gaps, and commercial context.",
    produces: "A broader extraction with parameters, claims, gaps, and technical interpretation.",
    inputHint: "source_type, document_id or text, comprehensive=true",
    complexity: "specialized",
  },
  {
    type: "physics_simulation",
    label: "Physics and exergy calculation",
    whenToUse: "The user asks for numeric engineering, physics, thermodynamic, exergy, performance, or process calculations.",
    produces: "Solver-backed or engineering-estimate first-principles metrics across thermal, fluids, electrochemical, reactor, capture, renewable, storage, and process-balance cases, plus missing inputs when no calculation can run.",
    inputHint: "domain, description, params with every numeric value the user supplied",
    complexity: "specialized",
  },
  {
    type: "simulation_run",
    label: "Interactive PV, battery, or inverter simulation",
    whenToUse: "The user supplies explicit numeric inputs for supported interactive PV, battery, or inverter simulations.",
    produces: "Simulation curves, metrics, and interactive chart-ready outputs.",
    inputHint: "domain and required numeric simulation parameters",
    complexity: "specialized",
  },
  {
    type: "economics_analysis",
    label: "Economics and finance calculation",
    whenToUse: "The user asks for CAPEX, OPEX, NPV, IRR, payback, LCOE/LCOH/LCOF, spark spread, fuel cost, sensitivity, or bankability math.",
    produces: "Computed economics where inputs are sufficient, otherwise a ranked list of missing financial inputs.",
    inputHint: "domain, question, description, params with all costs, prices, rates, utilization, and lifetime assumptions",
    complexity: "specialized",
  },
  {
    type: "environmental_site_analysis",
    label: "Environmental site data",
    whenToUse: "The user asks environmental, permitting, ecology, soil, weather, air-quality, fire, habitat, or water questions tied to a location.",
    produces: "Remote environmental layers and site context.",
    inputHint: "question, location or latitude/longitude, radius_km",
    complexity: "specialized",
  },
  {
    type: "literature_search",
    label: "Published source search",
    whenToUse: "The user asks for papers, sources, current research, benchmarks, market context, or facts likely to change.",
    produces: "Source-grounded research findings and citations where available.",
    inputHint: "query",
    complexity: "simple",
  },
  {
    type: "deep_research",
    label: "Deep research",
    whenToUse: "The user asks for a broad, thorough, state-of-the-art, or systematic research synthesis.",
    produces: "Multi-topic research synthesis with source-backed findings and gaps.",
    inputHint: "query",
    complexity: "long_running",
  },
  {
    type: "deep_agent",
    label: "Deep multi-tool agent",
    whenToUse: "The user asks for complex diligence, deep research, multi-step reasoning, or broad client-ready work that may require literature search, uploaded-document understanding, physics/economic/environmental tools, generated code, and verification in one run.",
    produces: "A plan, append-only tool results, evidence ledger, verification findings, final synthesis, and downloadable outputs when requested.",
    inputHint: "question, domain, current_attachments, required_outputs, max_steps",
    complexity: "long_running",
  },
  {
    type: "deep_analysis",
    label: "Deep project analysis",
    whenToUse: "The user asks for interpretation, diligence, risks, commercial meaning, or synthesis from existing artifacts.",
    produces: "A senior-analyst style synthesis grounded in saved artifacts and prior tool outputs.",
    inputHint: "question, artifact_id when a specific artifact is being analyzed",
    complexity: "long_running",
  },
  {
    type: "scientific_review",
    label: "Scientific plausibility review",
    whenToUse: "The user provides technical claims that need physics, parameter-range, or benchmark plausibility checks.",
    produces: "Claim-by-claim plausibility findings and recommended validation evidence.",
    inputHint: "domain, description, claims",
    complexity: "long_running",
  },
  {
    type: "exploratory_analysis",
    label: "Artifact exploration and comparison",
    whenToUse: "The user asks for patterns, comparisons, sensitivity, tradeoffs, or charts from existing project results.",
    produces: "Derived insights and chart-ready structured outputs from saved artifacts.",
    inputHint: "question, analysis_type",
    complexity: "specialized",
  },
  {
    type: "custom_chart",
    label: "Custom chart",
    whenToUse: "The user asks for a specific chart or table using values already present in the workspace.",
    produces: "A declarative chart spec rendered by the UI.",
    inputHint: "spec with chart_type, title, data, x_key, y_keys, and source_description",
    complexity: "simple",
  },
  {
    type: "agent_workspace",
    label: "Agent workspace run",
    whenToUse: "The user asks for custom code, long-running simulations, generated files, spreadsheet/PDF outputs, web/API data collection, GitHub or Hugging Face inspection, or a workflow that needs several programmatic steps beyond the fixed solvers.",
    produces: "A project-local run with generated code, execution logs, report text, structured results, file manifest, and downloadable outputs such as CSV, JSON, XLSX, PDF, or images when useful.",
    inputHint: "task, current_attachments, requested_outputs, allow_network, allow_dependency_install, context",
    complexity: "long_running",
  },
  {
    type: "update_project",
    label: "Project context update",
    whenToUse: "The user corrects project domain, name, goal, or important persistent context.",
    produces: "Updated project metadata.",
    inputHint: "patch with project fields to update",
    complexity: "simple",
  },
];

export const ALLOWED_AGENT_ACTIONS = new Set<ActionType>(
  AGENT_TOOL_REGISTRY.map((tool) => tool.type),
);

export function isAgentActionType(value: unknown): value is ActionType {
  return typeof value === "string" && ALLOWED_AGENT_ACTIONS.has(value as ActionType);
}

export function formatAgentToolRegistryForPrompt(): string {
  return AGENT_TOOL_REGISTRY
    .map((tool, index) => {
      return [
        `${index + 1}. ${tool.type} — ${tool.label}`,
        `   Use when: ${tool.whenToUse}`,
        `   Produces: ${tool.produces}`,
        `   Input: ${tool.inputHint}`,
      ].join("\n");
    })
    .join("\n");
}

export function actionLabel(actionType: string): string {
  const match = AGENT_TOOL_REGISTRY.find((tool) => tool.type === actionType);
  return match?.label || actionType.replace(/_/g, " ");
}
