import { readFile } from "fs/promises";

import { callDeepSeekV3, getEnvVar } from "@/lib/backend";
import { getProjectUploadPaths } from "@/lib/exergy-agent";
import type { InitialEvaluationProjectState } from "@/lib/initial-evaluation-guardrail";
import type { ActionType, Artifact, Project, ProjectDocument, StorageAdapter } from "@/lib/storage/types";
import {
  ALLOWED_AGENT_ACTIONS,
  formatAgentToolRegistryForPrompt,
  isAgentActionType,
} from "@/lib/agent-tool-registry";
import { buildConversationMemory, renderConversationMemory } from "@/lib/agent-memory";
import {
  artifactMentionsAnyAttachment,
  currentTurnAttachmentNames,
  latestConversationAttachmentNames,
  staleArtifactNotice,
} from "@/lib/agent-context-hygiene";
import { appendAgentTrace } from "@/lib/agent-trace";
import { PUBLIC_AGENT_IDENTITY_ANSWER, PUBLIC_AGENT_NAME } from "@/lib/agent-output";
import { shouldUseDeepAgent } from "@/lib/deep-agent";

interface ModelRouterArgs {
  projectId: string;
  message: string;
  history?: Array<{ role?: string; content?: string }> | null;
  project: Project | null | undefined;
  projectDomain: string;
  state: InitialEvaluationProjectState;
  storage: StorageAdapter;
  currentDocuments?: ProjectDocument[];
  routingContext?: string;
}

const DEFAULT_FOLLOWUPS = [
  "What data would improve confidence?",
  "Turn this into a client-ready memo",
  "What should I do next?",
];

function requestedOutputs(message: string): string[] {
  const outputs = new Set<string>();
  if (/\b(markdown|md)\b/i.test(message)) outputs.add("markdown");
  if (/\bjson\b/i.test(message)) outputs.add("json");
  if (/\bcsv\b/i.test(message)) outputs.add("csv");
  if (/\b(xlsx|excel|spreadsheet|workbook)\b/i.test(message)) outputs.add("xlsx");
  if (/\b(pdf|report|brief|memo)\b/i.test(message)) outputs.add("pdf");
  if (/\b(chart|plot|graph|figure|png)\b/i.test(message)) outputs.add("png");
  return Array.from(outputs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function modelText(value: unknown): string {
  return typeof value === "string"
    ? value
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
    : "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = oneLine(value);
    if (text) return text;
  }
  return "";
}

function artifactSummaryItems(summary: Record<string, unknown>, key: string, limit: number): string {
  const value = summary[key];
  if (!Array.isArray(value)) return "";
  const items = value
    .filter(isRecord)
    .map((item) => {
      const claim = firstText(item.claim, item.title, item.action, item.request);
      const evidence = firstText(item.evidence, item.why_it_matters);
      return [claim, evidence].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .slice(0, limit);
  return items.join("; ");
}

function artifactStringItems(summary: Record<string, unknown>, key: string, limit: number): string {
  const value = summary[key];
  if (!Array.isArray(value)) return "";
  return value.map(oneLine).filter(Boolean).slice(0, limit).join("; ");
}

function documentLine(doc: ProjectDocument): string {
  return `${doc.filename} (${doc.mime_type || "unknown"}, ${doc.size_bytes || 0} bytes)`;
}

function artifactLine(artifact: Artifact): string {
  const content = artifact.content || {};
  const summary = isRecord(content.client_summary) ? content.client_summary : {};
  const conclusion = firstText(summary.conclusion, content.executive_summary, artifact.summary);
  const metrics = Array.isArray(summary.computed_metrics)
    ? summary.computed_metrics
      .filter(isRecord)
      .slice(0, 5)
      .map((metric) => `${firstText(metric.label)}=${firstText(metric.value)}`)
      .filter(Boolean)
      .join("; ")
    : "";
  const supported = artifactSummaryItems(summary, "supported_claims", 4);
  const recommended = artifactSummaryItems(summary, "recommended_actions", 4);
  const requests = artifactSummaryItems(summary, "data_requests", 3);
  const notProven = artifactStringItems(summary, "not_proven", 3);
  return [
    `${artifact.type}: ${artifact.title}`,
    conclusion ? `conclusion: ${conclusion}` : "",
    metrics ? `metrics: ${metrics}` : "",
    supported ? `supported: ${supported}` : "",
    recommended ? `recommended_next_evidence: ${recommended}` : "",
    requests ? `data_requests: ${requests}` : "",
    notProven ? `not_proven: ${notProven}` : "",
  ].filter(Boolean).join(" | ");
}

function artifactContextBlock(artifact: Artifact): string {
  const content = isRecord(artifact.content) ? artifact.content : {};
  const rawPreview = Object.keys(content).length > 0
    ? JSON.stringify(content, null, 2).slice(0, 20_000)
    : "";
  return [
    artifactLine(artifact),
    rawPreview ? `content:\n${rawPreview}` : "",
  ].filter(Boolean).join("\n");
}

async function sourcePreview(path: string): Promise<string> {
  const name = path.split("/").pop() || path;
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) {
    for (const sidecar of [
      { path: `${path}.gemini.json`, label: "Gemini vision extraction" },
      { path: `${path}.mineru.json`, label: "PDF extraction" },
    ]) {
      const json = await readFile(sidecar.path, "utf-8").catch(() => "");
      if (!json) continue;
      try {
        const parsed = JSON.parse(json) as unknown;
        if (isRecord(parsed)) {
          const text = firstText(parsed.markdown, parsed.text, parsed.content, parsed.raw_output);
          if (text) {
            const parser = firstText(parsed.parser, parsed.engine) || sidecar.label;
            return `${name}: ${parser} preview\n${text.slice(0, 20_000)}`;
          }
        }
      } catch {
        return `${name}: PDF extraction sidecar could not be parsed; route to agent_workspace if contents matter.`;
      }
    }
    for (const sidecar of [
      { path: `${path}.gemini.md`, label: "Gemini vision markdown" },
      { path: `${path}.mineru.md`, label: "MinerU markdown" },
    ]) {
      const markdown = await readFile(sidecar.path, "utf-8").catch(() => "");
      if (markdown.trim()) {
        return `${name}: ${sidecar.label} preview\n${markdown.slice(0, 20_000)}`;
      }
    }
    return `${name}: PDF uploaded; no cached text extraction preview found. Use agent_workspace when the answer depends on the document contents.`;
  }
  const raw = await readFile(path, "utf-8").catch(() => "");
  if (!raw) return `${name}: unreadable or binary.`;
  if (lower.endsWith(".csv")) {
    const rows = raw.split(/\r?\n/).filter((row) => row.trim()).slice(0, 6);
    return `${name}: CSV preview\n${rows.join("\n")}`;
  }
  if (lower.endsWith(".json")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) {
        return `${name}: JSON keys=${Object.keys(parsed).slice(0, 14).join(", ")}`;
      }
    } catch {
      return `${name}: JSON parse failed; text preview=${raw.slice(0, 500)}`;
    }
  }
  return `${name}: text preview\n${raw.slice(0, 20_000)}`;
}

async function buildRoutingContext(args: ModelRouterArgs): Promise<string> {
  const attachments = currentAttachmentNames(args);
  const currentAttachments = currentTurnAttachmentNames(args.history, args.message);
  const [documents, artifactSummaries, uploadPaths] = await Promise.all([
    args.storage.listDocuments(args.projectId),
    args.storage.listArtifacts(args.projectId),
    getProjectUploadPaths(args.projectId, attachments),
  ]);
  const loadedArtifacts = await Promise.all(
    artifactSummaries.map((artifact) => args.storage.getArtifact(args.projectId, artifact.id)),
  );
  const filteredArtifacts = loadedArtifacts
    .filter((artifact): artifact is Artifact => !!artifact)
    .filter((artifact) =>
      currentAttachments.length === 0 || artifactMentionsAnyAttachment(artifact, currentAttachments)
    );
  const fullArtifacts = filteredArtifacts;
  const previews = await Promise.all(uploadPaths.map(sourcePreview));
  const contextNotice = staleArtifactNotice({
    currentAttachments,
    totalArtifacts: loadedArtifacts.filter(Boolean).length,
    includedArtifacts: filteredArtifacts.length,
  });
  const memory = buildConversationMemory(args.history, args.message);
  const fullHistory = (args.history || [])
    .map((entry) => `${entry.role || "user"}: ${entry.content || ""}`)
    .filter((entry) => entry.trim())
    .join("\n\n");

  return [
    `Project: ${args.project?.name || "Untitled"}`,
    `Project domain: ${args.projectDomain || args.project?.domain || "general"}`,
    args.project?.description ? `Description: ${args.project.description}` : "",
    args.project?.goal ? `Goal: ${args.project.goal}` : "",
    `Uploaded documents: ${documents.length ? documents.map(documentLine).join(" | ") : "none"}`,
    attachments.length ? `Current attachments referenced by the user: ${attachments.join(" | ")}` : "",
    `Successful prior evaluation: ${args.state.hasSuccessfulEvaluationArtifact ? "yes" : "no"}`,
    `Any artifacts: ${args.state.hasAnyArtifact ? "yes" : "no"}`,
    `Conversation memory:\n${renderConversationMemory(memory)}`,
    fullHistory ? `Full prior run and conversation context:\n${fullHistory}` : "",
    contextNotice,
    fullArtifacts.length
      ? `Project artifacts:\n${fullArtifacts.map(artifactContextBlock).join("\n\n")}`
      : "Recent artifacts: none",
    previews.length ? `Source previews:\n${previews.join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function normalizeFollowups(value: unknown): string[] {
  const followups = Array.isArray(value)
    ? value.map(oneLine).filter(Boolean).slice(0, 3)
    : [];
  while (followups.length < 3) {
    followups.push(DEFAULT_FOLLOWUPS[followups.length]);
  }
  return followups;
}

function normalizeActionConfig(actionType: string, config: unknown, args: ModelRouterArgs): Record<string, unknown> {
  const out = isRecord(config) ? { ...config } : {};
  const attachments = currentAttachmentNames(args);
  const messageWithAttachments = attachments.length > 0
    ? `${args.message}\n\n[Attached: ${attachments.join(", ")}]`
    : args.message;
  const description = [
    messageWithAttachments,
    args.project?.description ? `Project context: ${args.project.description}` : "",
    args.project?.goal ? `Goal: ${args.project.goal}` : "",
  ].filter(Boolean).join("\n\n");

  if (attachments.length > 0) {
    out.current_attachments = Array.isArray(out.current_attachments) && out.current_attachments.length > 0
      ? out.current_attachments
      : attachments;
    if (!out.question && ["evidence_evaluation", "document_analysis", "physics_simulation", "simulation_run", "comprehensive_analysis"].includes(actionType)) {
      out.question = messageWithAttachments;
    }
  }

  if (!out.domain && ["evidence_evaluation", "physics_simulation", "economics_analysis", "scientific_review"].includes(actionType)) {
    out.domain = args.projectDomain || args.project?.domain || "general";
  }
  if (!out.description && ["evidence_evaluation", "physics_simulation", "economics_analysis", "scientific_review", "comprehensive_analysis"].includes(actionType)) {
    out.description = description;
  }
  if (!out.question && ["deep_analysis", "economics_analysis", "exploratory_analysis", "environmental_site_analysis"].includes(actionType)) {
    out.question = args.message;
  }
  if (!out.query && ["literature_search", "deep_research"].includes(actionType)) {
    out.query = [
      args.message,
      args.project?.name || "",
      args.project?.description || "",
      args.projectDomain !== "general" ? args.projectDomain.replace(/_/g, " ") : "",
    ].filter(Boolean).join(" ");
  }
  if (actionType === "deep_agent") {
    if (!out.question) out.question = args.message;
    if (!out.domain) out.domain = args.projectDomain || args.project?.domain || "general";
    if (!out.context) out.context = args.routingContext || description;
    if (attachments.length > 0 && !out.current_attachments) out.current_attachments = attachments;
    if (!out.required_outputs) out.required_outputs = requestedOutputs(args.message);
  }
  if (!out.analysis_type && actionType === "exploratory_analysis") {
    out.analysis_type = /\bsensitivity|scenario|what if|tornado\b/i.test(args.message)
      ? "sensitivity"
      : /\btrade[- ]?off\b/i.test(args.message)
        ? "tradeoff"
        : "comparison";
  }
  if (actionType === "agent_workspace") {
    if (!out.task) out.task = args.message;
    if (!out.context) out.context = args.routingContext || description;
  }

  return out;
}

function requiresWorkspaceExecution(message: string): boolean {
  const text = message || "";
  const asksForExecution =
    /\b(run|rerun|re-run|simulate|model|calculate|compute|build|create|generate|export|download|write)\b/i.test(text);
  const asksForStructuredWork =
    /\b(simulation|physics|thermodynamic|economic|economics|finance|scenario|sensitivity|npv|irr|payback|lcoe|lcoh|lcof|breakeven|co2|emissions|environmental|csv|xlsx|excel|spreadsheet|pdf|report|memo|table|chart|plot)\b/i.test(text);
  const asksForMultipleOutputs =
    /\b(compare|case|cases|sensitivity|all other assumptions|keep .* unchanged|downloadable|client-ready)\b/i.test(text);
  return asksForExecution && (asksForStructuredWork || asksForMultipleOutputs);
}

function currentAttachmentNames(args: ModelRouterArgs): string[] {
  const fromConversation = latestConversationAttachmentNames(args.history, args.message);
  const fromRunDocuments = (args.currentDocuments || []).map((doc) => doc.filename).filter(Boolean);
  return Array.from(new Set([...fromConversation, ...fromRunDocuments]));
}

function planStepsToText(steps: Array<{ step: number; title: string; description: string; action_type: ActionType }>): string {
  return steps
    .map((step) => `${step.step}. ${step.title}: ${step.description}`)
    .join("\n");
}

function planAsWorkspaceAction(
  args: ModelRouterArgs,
  content: string,
  steps: Array<{ step: number; title: string; description: string; action_type: ActionType; config: Record<string, unknown> }>,
  suggestedFollowups: unknown,
): Record<string, unknown> {
  const attachments = currentAttachmentNames(args);
  const stepText = planStepsToText(steps);
  const planOutline = steps.map((step, index) => ({
    step: index + 1,
    title: step.title,
    description: step.description,
  }));
  const messageWithAttachments = attachments.length > 0
    ? `${args.message}\n\n[Attached: ${attachments.join(", ")}]`
    : args.message;
  const task = [
    messageWithAttachments,
    "",
    "Execution plan selected by the agent:",
    stepText,
    "",
    "Run the needed work inside one workspace and return the final answer directly in chat. Do not return internal step labels, artifact inventory, or process logs unless they directly help the user.",
  ].join("\n");
  const context = [
    args.project?.name ? `Project: ${args.project.name}` : "",
    args.project?.description ? `Description: ${args.project.description}` : "",
    args.project?.goal ? `Goal: ${args.project.goal}` : "",
    args.projectDomain && args.projectDomain !== "general" ? `Detected domain: ${args.projectDomain}` : "",
  ].filter(Boolean).join("\n");
  return appendAgentTrace({
    type: "action",
    content: content || "I’ll run this as a workspace analysis and return the final answer directly in chat.",
    plan_steps: null,
    action: {
      type: "agent_workspace",
      config: {
        task,
        question: messageWithAttachments,
        context,
        current_attachments: attachments,
        plan_outline: planOutline,
        allow_dependency_install: true,
        timeout_ms: 15 * 60_000,
      },
    },
    suggested_followups: normalizeFollowups(suggestedFollowups),
    workflow_orchestration: {
      source: "model_router",
      reason: "plan_collapsed_to_workspace_action",
      starts_with_evidence_intake: false,
      routed_tool: "agent_workspace",
    },
  }, {
    stage: "model_router",
    decision: "action",
    reason: "plan_collapsed_to_workspace_action",
    action: "agent_workspace",
    type: "action",
    attachments,
  });
}

function validateModelRoute(parsed: Record<string, unknown>, args: ModelRouterArgs): Record<string, unknown> | null {
  const type = oneLine(parsed.type);
  if (!["response", "action", "plan"].includes(type)) return null;
  const content = modelText(parsed.content) || "I’ll work on this request and use the best available workspace path.";

  if (type === "response") {
    return appendAgentTrace({
      type,
      content,
      plan_steps: null,
      action: null,
      suggested_followups: normalizeFollowups(parsed.suggested_followups),
      workflow_orchestration: {
        source: "model_router",
        reason: "deepseek_v4_flash_direct_response",
        starts_with_evidence_intake: false,
      },
    }, {
      stage: "model_router",
      decision: "response",
      reason: "deepseek_v4_flash_direct_response",
      action: null,
      type,
      attachments: currentTurnAttachmentNames(args.history, args.message),
    });
  }

  if (type === "action") {
    const rawAction = isRecord(parsed.action) ? parsed.action : {};
    const requestedActionType = oneLine(rawAction.type);
    const explicitToolSelection = [
      "agent_workspace",
      "deep_agent",
      "physics_simulation",
      "economics_analysis",
      "environmental_site_analysis",
      "literature_search",
      "deep_research",
    ].includes(requestedActionType);
    const actionType = shouldUseDeepAgent(args.message)
      ? "deep_agent"
      : !explicitToolSelection && requiresWorkspaceExecution(args.message)
      ? "agent_workspace"
      : requestedActionType;
    if (!isAgentActionType(actionType)) return null;
    const config = normalizeActionConfig(actionType, rawAction.config, args);
    return appendAgentTrace({
      type,
      content,
      plan_steps: null,
      action: { type: actionType, config },
      suggested_followups: normalizeFollowups(parsed.suggested_followups),
      workflow_orchestration: {
        source: "model_router",
        reason: "deepseek_v4_flash_tool_route",
        starts_with_evidence_intake: actionType === "evidence_evaluation",
        routed_tool: actionType,
      },
    }, {
      stage: "model_router",
      decision: "action",
      reason: "deepseek_v4_flash_tool_route",
      action: actionType,
      type,
      attachments: currentTurnAttachmentNames(args.history, args.message),
    });
  }

  const rawSteps = Array.isArray(parsed.plan_steps) ? parsed.plan_steps : [];
  const steps = rawSteps
    .filter(isRecord)
    .map((step, index) => {
      const actionType = oneLine(step.action_type);
      if (!isAgentActionType(actionType)) return null;
      return {
        step: Number(step.step) || index + 1,
        title: firstText(step.title, step.description, actionType.replace(/_/g, " ")),
        description: firstText(step.description, step.title, `Run ${actionType.replace(/_/g, " ")}`),
        action_type: actionType,
        config: normalizeActionConfig(actionType, step.config, args),
      };
    })
    .filter((step): step is { step: number; title: string; description: string; action_type: ActionType; config: Record<string, unknown> } => !!step)
    .slice(0, 8);
  if (steps.length === 0) return null;
  if (shouldUseDeepAgent(args.message)) {
    return appendAgentTrace({
      type: "action",
      content,
      plan_steps: null,
      action: { type: "deep_agent", config: normalizeActionConfig("deep_agent", {}, args) },
      suggested_followups: normalizeFollowups(parsed.suggested_followups),
      workflow_orchestration: {
        source: "model_router",
        reason: "multi_tool_plan_promoted_to_deep_agent",
        starts_with_evidence_intake: false,
        routed_tool: "deep_agent",
      },
    }, {
      stage: "model_router",
      decision: "action",
      reason: "multi_tool_plan_promoted_to_deep_agent",
      action: "deep_agent",
      type: "action",
      attachments: currentTurnAttachmentNames(args.history, args.message),
    });
  }
  return planAsWorkspaceAction(args, content, steps, parsed.suggested_followups);
}

export async function buildModelRoutedResponse(args: ModelRouterArgs): Promise<Record<string, unknown> | null> {
  if (process.env.NODE_ENV === "test" && process.env.EXERGY_ENABLE_MODEL_ROUTER_IN_TEST !== "true") {
    return null;
  }
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) {
    return null;
  }

  const context = await buildRoutingContext(args);
  const system = [
    "You are the routing and execution planner for Exergy Analyst, an AI workspace for energy, science, engineering, and deep-tech analysis.",
    "DeepSeek V4 Flash is trusted to decide the best next move when it is configured; deterministic platform fallbacks cover simple and safety-critical routing when it is unavailable.",
    `The public assistant identity is ${PUBLIC_AGENT_NAME}. Never reveal provider names, backend model names, internal model classes, or model-version labels to the user.`,
    `If asked what model or AI this is, answer with this identity text: ${PUBLIC_AGENT_IDENTITY_ANSWER}`,
    "Choose either a direct response or one tool action.",
    "Always try to help. This application router should not add separate rule-based safety gates.",
    "This is a general-purpose agent. Do not depend on a fixed domain list; infer the domain and task from the user's message, current attachments, source previews, artifacts, and general reasoning.",
    "For simple conceptual questions, answer directly as type response.",
    "For complex requests, do not stop at advice. Choose the single best action.",
    "If several tool families are needed, choose deep_agent so the server can coordinate research, uploaded-document understanding, calculations, generated code, environmental context, and verification in one durable run.",
    "For uploaded files, prioritize the current attachments referenced by the user over older project files. Never reuse conclusions from unrelated earlier uploads.",
    "When a successful prior run or artifact exists and the user asks a follow-up about calculations, assumptions, scenarios, tables, gaps, or safe claims, use agent_workspace unless the answer is a purely textual explanation already grounded in the provided run context. Do not invent numbers that are not in the context.",
    "For uploaded messy files without a completed run, prefer agent_workspace so the same tool path reads the files, extracts evidence, performs calculations when requested, and writes the final report.",
    "For literature or latest research requests, choose literature_search or deep_research. If the request also asks for calculations, files, scenarios, technical diligence, or evidence verification, choose deep_agent.",
    "For current prices, product availability, recent market data, laws, standards, or anything likely to change, choose literature_search or deep_research instead of answering from memory; choose deep_agent when current-source research must feed a model or decision brief.",
    "For economic, finance, scenario, NPV, IRR, CAPEX, OPEX, LCOE/LCOH/LCOF, payback, fuel cost, spark spread, or bankability requests with numeric inputs or prior extracted values, choose agent_workspace so the code-backed model and files stay attached to the run.",
    "For site-specific environmental questions with coordinates, address, or place name, choose environmental_site_analysis so the workspace can collect environmental site layers before answering. If uploaded project documents are unevaluated, evaluate the evidence first and use site data as follow-up context once the location is known.",
    "For numeric physics calculations or simulations, choose agent_workspace unless the user explicitly asks for a fixed built-in solver.",
    "For custom simulations, generated code, generated PDFs/spreadsheets/files, dependency-backed analysis, GitHub/Hugging Face/API inspection, or workflows that do not fit a fixed solver, choose agent_workspace. This tool can create a project-local run, write code, run it, and return generated outputs.",
    "For deep research on any topic that needs extended reasoning plus extended tool use, choose deep_agent rather than asking the user to manually sequence tools.",
    "Do not tell the user to ask you to use your own tools. Say the Exergy Lab Agent has access to workspace tools and can choose them when useful.",
    "For charts, sensitivity sweeps, tradeoff views, and comparisons from existing artifacts, choose exploratory_analysis or custom_chart.",
    "Do not return plan_steps for normal execution. If the user explicitly asks for a plan only, answer as a plain text response.",
    "Never invent file contents, citations, or computed values. If data is missing, still provide a useful path and say what assumptions or evidence are needed.",
    "Keep user-facing text natural. Let the final response format vary with the request: one or two sentences for simple questions, or headings, bullets, tables, charts, and detailed breakdowns for complex work when useful.",
    "Do not emit platform UI labels or repeated audit headings such as Screening, Use as a triage note, What Is Supported, Do Not Claim Yet, View Details, or Export Report unless the user explicitly asks for an audit-style report.",
    "Tool registry:",
    formatAgentToolRegistryForPrompt(),
    "Return only JSON with this schema: {\"type\":\"response|action\",\"content\":\"plain language user-facing text\",\"action\":{\"type\":\"allowed_action\",\"config\":{}},\"plan_steps\":null,\"suggested_followups\":[\"...\",\"...\",\"...\"]}.",
    `Allowed actions: ${Array.from(ALLOWED_AGENT_ACTIONS).join(", ")}.`,
  ].join(" ");

  try {
    const raw = await callDeepSeekV3(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Workspace context:\n${context}`,
            `Recent conversation and saved run context:\n${(args.history || []).map((item) => `${item.role || "user"}: ${item.content || ""}`).join("\n")}`,
            `User request:\n${args.message}`,
          ].join("\n\n"),
        },
      ],
      {
        jsonMode: true,
        thinking: "disabled",
        temperature: 0.1,
        maxTokens: 2500,
      },
    );
    const parsed = parseJsonObject(raw);
    return parsed ? validateModelRoute(parsed, { ...args, routingContext: context }) : null;
  } catch {
    return null;
  }
}
