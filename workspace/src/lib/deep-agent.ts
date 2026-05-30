import { callDeepSeekV3, getEnvVar } from "@/lib/backend";
import {
  evaluateAgentQuality,
  type AgentQualityEvaluationResult,
} from "@/lib/agent-quality-evaluator";
import type { ActionType, Artifact, Project, ProjectDocument } from "@/lib/storage/types";

export type DeepAgentToolType = Exclude<
  ActionType,
  "deep_agent" | "generate_pdf" | "update_project" | "deep_diligence" | "evidence_interview"
>;

export interface DeepAgentPlanStep {
  step_id: string;
  title: string;
  reason: string;
  tool_type: DeepAgentToolType;
  input: Record<string, unknown>;
}

export interface DeepAgentToolExecutionResult {
  step_id: string;
  tool_type: DeepAgentToolType;
  status: "completed" | "failed";
  summary: string;
  action_id?: string;
  artifact?: Artifact | null;
  error?: string;
}

export interface DeepAgentEvidenceItem {
  id: string;
  source_type: "tool_result" | "artifact" | "document" | "calculation" | "research" | "environmental" | "failure";
  source_id?: string;
  title: string;
  claim: string;
  support: "direct" | "computed" | "inferred" | "failed";
  quote?: string;
  tool_type?: DeepAgentToolType;
}

export interface DeepAgentVerificationFinding {
  severity: "blocker" | "warning" | "info";
  type: string;
  message: string;
  suggested_fix: string;
}

export interface DeepAgentResult {
  question: string;
  plan: DeepAgentPlanStep[];
  tool_runs: DeepAgentToolExecutionResult[];
  evidence_ledger: DeepAgentEvidenceItem[];
  verification: DeepAgentVerificationFinding[];
  quality_evaluation: AgentQualityEvaluationResult;
  final_answer: string;
}

export type DeepAgentExecuteTool = (
  step: DeepAgentPlanStep,
) => Promise<Omit<DeepAgentToolExecutionResult, "step_id" | "tool_type">>;

export interface ExecuteDeepAgentInput {
  project: Project | null;
  question: string;
  domain?: string;
  documents?: ProjectDocument[];
  artifacts?: Artifact[];
  context?: string;
  requiredOutputs?: string[];
  maxSteps?: number;
  executeTool: DeepAgentExecuteTool;
  onProgress?: (message: string, data?: Record<string, unknown>) => Promise<void> | void;
}

const TOOL_TYPES: DeepAgentToolType[] = [
  "document_analysis",
  "comprehensive_analysis",
  "literature_search",
  "deep_research",
  "physics_simulation",
  "economics_analysis",
  "environmental_site_analysis",
  "scientific_review",
  "exploratory_analysis",
  "custom_chart",
  "agent_workspace",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
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

function hasModelKey(): boolean {
  return !!(getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY"));
}

function uniqueTools(steps: DeepAgentPlanStep[]): DeepAgentPlanStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = `${step.tool_type}:${JSON.stringify(step.input).slice(0, 400)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function outputNeeds(question: string): string[] {
  const out = new Set<string>();
  if (/\bcsv\b/i.test(question)) out.add("csv");
  if (/\b(pdf|brief|memo|report)\b/i.test(question)) out.add("pdf");
  if (/\b(xlsx|excel|spreadsheet)\b/i.test(question)) out.add("xlsx");
  if (/\b(chart|plot|figure|graph|png)\b/i.test(question)) out.add("png");
  return Array.from(out);
}

export function shouldUseDeepAgent(question: string): boolean {
  const text = question.toLowerCase();
  const explicit =
    /\b(deep\s*agent|deep\s*research|deepresearch|full diligence|comprehensive|state of the art|systematic review|extended reasoning|multi[- ]?step|end[- ]to[- ]end|client[- ]ready)\b/.test(text);
  const buckets = [
    /\b(literature|papers?|research|sources?|citations?|benchmark|market|current|latest)\b/.test(text),
    /\b(simulat|physics|thermodynamic|exergy|solver|mass balance|energy balance|model)\b/.test(text),
    /\b(economic|finance|capex|opex|npv|irr|payback|lcoe|lcoh|breakeven|sensitivity)\b/.test(text),
    /\b(environment|emissions?|co2|water|permit|site|weather|ecology|air quality|soil)\b/.test(text),
    /\b(upload|document|pdf|datasheet|file)\b/.test(text),
    /\b(csv|xlsx|excel|spreadsheet|memo|brief|download|export|report)\b/.test(text),
  ].filter(Boolean).length;
  return explicit || buckets >= 4;
}

function deterministicPlan(args: ExecuteDeepAgentInput): DeepAgentPlanStep[] {
  const question = args.question;
  const docs = args.documents || [];
  const requiredOutputs = args.requiredOutputs?.length ? args.requiredOutputs : outputNeeds(question);
  const steps: DeepAgentPlanStep[] = [];
  const add = (tool_type: DeepAgentToolType, title: string, reason: string, input: Record<string, unknown>) => {
    steps.push({
      step_id: `step_${String(steps.length + 1).padStart(2, "0")}`,
      title,
      reason,
      tool_type,
      input,
    });
  };

  if (docs.length > 0) {
    add("comprehensive_analysis", "Read uploaded evidence", "Uploaded files should be converted into source-backed facts before any conclusions.", {
      question,
      description: question,
      current_attachments: docs.map((doc) => doc.filename),
      domain: args.domain || args.project?.domain || "general",
    });
  }

  if (/\b(literature|papers?|research|sources?|citations?|benchmark|market|current|latest|state of the art|systematic)\b/i.test(question)) {
    add("deep_research", "Research external sources", "The request needs source-backed context beyond the current workspace.", {
      query: question,
      domain: args.domain || args.project?.domain || "general",
    });
  }

  if (/\b(environment|emissions?|co2|water|permit|site|weather|ecology|air quality|soil|latitude|longitude|\d+\.\d+\s*[°]?\s*[ns],?\s*\d+\.\d+)/i.test(question)) {
    add("environmental_site_analysis", "Collect environmental context", "Site or environmental impacts should be grounded in remote data layers when available.", {
      question,
      domain: args.domain || args.project?.domain || "general",
    });
  }

  if (/\b(simulat|physics|thermodynamic|exergy|solver|mass balance|energy balance|temperature|pressure|flow|reaction|heat transfer)\b/i.test(question)) {
    add("physics_simulation", "Run physics screen", "The answer needs a first-principles or solver-backed physics check.", {
      question,
      description: question,
      domain: args.domain || args.project?.domain || "general",
    });
  }

  if (/\b(economic|finance|capex|opex|npv|irr|payback|lcoe|lcoh|breakeven|sensitivity|price|cost)\b/i.test(question)) {
    add("economics_analysis", "Run economics screen", "The answer needs explicit financial calculations or missing-input checks.", {
      question,
      description: question,
      domain: args.domain || args.project?.domain || "general",
    });
  }

  add("agent_workspace", "Execute integrated model and report", "A code-capable workspace can reconcile prior tool outputs, run custom calculations, and create requested files.", {
    task: question,
    question,
    context: args.context || "",
    current_attachments: docs.map((doc) => doc.filename),
    requested_outputs: requiredOutputs.length ? requiredOutputs : ["markdown", "json"],
    allow_dependency_install: true,
    timeout_ms: 15 * 60_000,
  });

  return uniqueTools(steps).slice(0, args.maxSteps || 6);
}

function normalizePlanSteps(value: unknown, args: ExecuteDeepAgentInput): DeepAgentPlanStep[] {
  const rawSteps = Array.isArray(value) ? value : [];
  const steps = rawSteps
    .filter(isRecord)
    .map((item, index) => {
      const tool = clean(item.tool_type || item.action_type) as DeepAgentToolType;
      if (!TOOL_TYPES.includes(tool)) return null;
      const input = isRecord(item.input) ? { ...item.input } : isRecord(item.config) ? { ...item.config } : {};
      if (!input.question && tool !== "literature_search" && tool !== "deep_research") input.question = args.question;
      if (!input.query && (tool === "literature_search" || tool === "deep_research")) input.query = args.question;
      if (!input.domain) input.domain = args.domain || args.project?.domain || "general";
      if ((tool === "agent_workspace" || tool === "comprehensive_analysis") && args.documents?.length && !input.current_attachments) {
        input.current_attachments = args.documents.map((doc) => doc.filename);
      }
      if (tool === "agent_workspace" && !input.requested_outputs) {
        input.requested_outputs = args.requiredOutputs?.length ? args.requiredOutputs : outputNeeds(args.question);
      }
      return {
        step_id: clean(item.step_id) || `step_${String(index + 1).padStart(2, "0")}`,
        title: clean(item.title) || tool.replace(/_/g, " "),
        reason: clean(item.reason) || "Useful for this request.",
        tool_type: tool,
        input,
      };
    })
    .filter((step): step is DeepAgentPlanStep => !!step);
  return uniqueTools(steps).slice(0, args.maxSteps || 6);
}

async function createPlan(args: ExecuteDeepAgentInput): Promise<DeepAgentPlanStep[]> {
  const fallback = deterministicPlan(args);
  if (!hasModelKey()) return fallback;

  const system = [
    "You are the private planning controller for Exergy Lab Agent.",
    "Plan a domain-agnostic tool sequence. Do not reveal provider or model names.",
    "Use broad tools only; do not hard-code technology-specific fixes.",
    "Prefer fewer high-value steps. Include agent_workspace when custom code, files, scenario models, or integrated calculations are useful.",
    "Return JSON only: {\"steps\":[{\"step_id\":\"step_01\",\"title\":\"...\",\"reason\":\"...\",\"tool_type\":\"allowed_tool\",\"input\":{}}]}",
    `Allowed tools: ${TOOL_TYPES.join(", ")}.`,
  ].join("\n");
  const user = [
    args.project?.name ? `Project: ${args.project.name}` : "",
    args.project?.description ? `Description: ${args.project.description}` : "",
    `Domain: ${args.domain || args.project?.domain || "general"}`,
    args.documents?.length ? `Current documents: ${args.documents.map((doc) => doc.filename).join(", ")}` : "Current documents: none",
    args.requiredOutputs?.length ? `Requested outputs: ${args.requiredOutputs.join(", ")}` : "",
    args.context ? `Context:\n${args.context.slice(0, 24000)}` : "",
    `User request:\n${args.question}`,
  ].filter(Boolean).join("\n\n");

  const raw = await callDeepSeekV3(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { jsonMode: true, thinking: "disabled", temperature: 0.1, maxTokens: 2400, timeoutMs: 25_000 },
  ).catch(() => "");
  const parsed = raw ? parseJsonObject(raw) : null;
  const planned = normalizePlanSteps(parsed?.steps, args);
  if (planned.length === 0) return fallback;
  if (!planned.some((step) => step.tool_type === "agent_workspace") && fallback.some((step) => step.tool_type === "agent_workspace")) {
    planned.push(fallback.find((step) => step.tool_type === "agent_workspace") as DeepAgentPlanStep);
  }
  return uniqueTools(planned).slice(0, args.maxSteps || 6);
}

function textArray(value: unknown, keys: string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string" || typeof item === "number") return String(item);
    if (isRecord(item)) {
      for (const key of keys) {
        const text = clean(item[key]);
        if (text) return text;
      }
    }
    return "";
  }).filter(Boolean);
}

function artifactEvidence(toolRun: DeepAgentToolExecutionResult): DeepAgentEvidenceItem[] {
  const artifact = toolRun.artifact;
  const baseTitle = clean(artifact?.title) || toolRun.tool_type.replace(/_/g, " ");
  const content = isRecord(artifact?.content) ? artifact.content : {};
  const summary = clean(artifact?.summary) || clean(toolRun.summary);
  const out: DeepAgentEvidenceItem[] = [];
  const add = (claim: string, support: DeepAgentEvidenceItem["support"], source_type: DeepAgentEvidenceItem["source_type"], quote?: string) => {
    if (!claim) return;
    out.push({
      id: `ev_${toolRun.step_id}_${out.length + 1}`,
      source_type,
      source_id: artifact?.id || toolRun.action_id || toolRun.step_id,
      title: baseTitle,
      claim,
      support,
      quote,
      tool_type: toolRun.tool_type,
    });
  };

  if (toolRun.status === "failed") {
    add(toolRun.error || toolRun.summary || "Tool failed before returning results.", "failed", "failure");
    return out;
  }

  add(summary, artifact?.source === "canonical_engine" || artifact?.source === "physics_engine" ? "computed" : "direct", artifact?.type === "research" || artifact?.type === "deep_research" ? "research" : "artifact");

  const clientSummary = isRecord(content.client_summary) ? content.client_summary : {};
  for (const claim of textArray(clientSummary.supported_claims, ["claim", "statement", "summary"]).slice(0, 6)) {
    add(claim, "direct", "artifact");
  }
  for (const finding of textArray(content.findings, ["statement", "finding", "title", "summary"]).slice(0, 6)) {
    add(finding, "direct", content.total_papers || content.literature_results ? "research" : "artifact");
  }
  const solver = isRecord(content.solver_result) ? content.solver_result : {};
  for (const metric of (Array.isArray(solver.computed_metrics) ? solver.computed_metrics : Array.isArray(clientSummary.computed_metrics) ? clientSummary.computed_metrics : [])) {
    if (!isRecord(metric)) continue;
    const label = clean(metric.label) || clean(metric.name);
    const value = clean(metric.value);
    const unit = clean(metric.unit);
    if (label && value) add(`${label}: ${value}${unit ? ` ${unit}` : ""}`, "computed", "calculation");
  }
  if (isRecord(content.environmental_site_data)) {
    add(clean((content.environmental_site_data as Record<string, unknown>).executive_summary), "direct", "environmental");
  }
  const report = clean(content.report_markdown);
  if (report) add(report.slice(0, 1200), "computed", "artifact", report.slice(0, 1200));
  return out.slice(0, 12);
}

function verifyLedger(args: {
  question: string;
  plan: DeepAgentPlanStep[];
  toolRuns: DeepAgentToolExecutionResult[];
  ledger: DeepAgentEvidenceItem[];
  requiredOutputs: string[];
}): DeepAgentVerificationFinding[] {
  const findings: DeepAgentVerificationFinding[] = [];
  const completed = args.toolRuns.filter((run) => run.status === "completed");
  const failed = args.toolRuns.filter((run) => run.status === "failed");
  if (completed.length === 0) {
    findings.push({
      severity: "blocker",
      type: "no_completed_tools",
      message: "No planned tool returned a completed result.",
      suggested_fix: "Retry with the general workspace tool and produce a bounded answer from saved context if needed.",
    });
  }
  if (failed.length > 0) {
    findings.push({
      severity: "warning",
      type: "tool_failures_present",
      message: `${failed.length} tool step${failed.length === 1 ? "" : "s"} failed and should be disclosed as limitations, not hidden.`,
      suggested_fix: "Use completed tool results, try alternate tools where practical, and state what remains unproven.",
    });
  }
  const text = args.question.toLowerCase();
  const completedTypes = new Set(completed.map((run) => run.tool_type));
  if (/\b(literature|research|source|citation|latest|current|state of the art)\b/.test(text) && !completedTypes.has("literature_search") && !completedTypes.has("deep_research")) {
    findings.push({
      severity: "warning",
      type: "research_not_completed",
      message: "The request asked for source-backed research, but no research tool completed.",
      suggested_fix: "Run deep_research or clearly label the answer as based only on uploaded/project context.",
    });
  }
  if (/\b(simulat|model|calculate|compute|scenario|sensitivity|npv|irr|capex|opex|physics|thermodynamic)\b/.test(text) && !completedTypes.has("agent_workspace") && !completedTypes.has("physics_simulation") && !completedTypes.has("economics_analysis")) {
    findings.push({
      severity: "warning",
      type: "calculation_tool_not_completed",
      message: "The request asked for modelling or calculation, but no calculation-capable tool completed.",
      suggested_fix: "Run agent_workspace or the relevant deterministic solver before giving numeric conclusions.",
    });
  }
  if (args.requiredOutputs.length > 0) {
    const hasGeneratedFile = completed.some((run) => {
      const files = isRecord(run.artifact?.content) ? run.artifact.content.files : null;
      return Array.isArray(files) && files.length > 0;
    });
    if (!hasGeneratedFile) {
      findings.push({
        severity: "warning",
        type: "requested_files_not_created",
        message: "The request asked for generated outputs, but the completed tool results do not list output files.",
        suggested_fix: "Use agent_workspace to write the requested CSV/PDF/XLSX artifacts or state that files were not created.",
      });
    }
  }
  if (args.ledger.length < Math.min(2, completed.length)) {
    findings.push({
      severity: "info",
      type: "thin_evidence_ledger",
      message: "The evidence ledger is thin relative to the requested work.",
      suggested_fix: "Extract explicit claims, inputs, and computed metrics from each completed artifact before final synthesis.",
    });
  }
  return findings;
}

function sourceTextsFromLedger(ledger: DeepAgentEvidenceItem[]): string[] {
  return ledger.map((item) => [item.title, item.claim, item.quote].filter(Boolean).join(": "));
}

function deterministicFinal(args: {
  question: string;
  toolRuns: DeepAgentToolExecutionResult[];
  ledger: DeepAgentEvidenceItem[];
  verification: DeepAgentVerificationFinding[];
}): string {
  const completed = args.toolRuns.filter((run) => run.status === "completed");
  const failed = args.toolRuns.filter((run) => run.status === "failed");
  const findings = args.ledger.filter((item) => item.support !== "failed").slice(0, 8);
  const limits = args.verification.filter((finding) => finding.severity !== "info").slice(0, 6);
  return [
    "## Bottom Line",
    completed.length > 0
      ? `I completed ${completed.length} tool step${completed.length === 1 ? "" : "s"} and used those results to answer the request.`
      : "I could not complete a tool-backed result, so no new calculated conclusion should be treated as supported.",
    "",
    "## Evidence Used",
    findings.length ? findings.map((item) => `- ${item.claim}`).join("\n") : "- No completed evidence items were available.",
    "",
    "## What the Data Supports",
    findings.length ? "- The findings above are supported by completed tool outputs in this run." : "- The request and files were retained, but the completed evidence is insufficient for a decision-grade conclusion.",
    "",
    "## What It Cannot Prove",
    limits.length ? limits.map((item) => `- ${item.message}`).join("\n") : "- This is not independent validation without measured operating data and source-backed assumptions.",
    failed.length ? `- ${failed.length} tool step${failed.length === 1 ? "" : "s"} failed and should be rerun or replaced before client use.` : "",
  ].filter(Boolean).join("\n");
}

async function synthesizeFinal(args: {
  question: string;
  project: Project | null;
  plan: DeepAgentPlanStep[];
  toolRuns: DeepAgentToolExecutionResult[];
  ledger: DeepAgentEvidenceItem[];
  verification: DeepAgentVerificationFinding[];
  quality: AgentQualityEvaluationResult;
}): Promise<string> {
  const fallback = deterministicFinal(args);
  if (!hasModelKey()) return fallback;
  const system = [
    "You are Exergy Lab Agent writing the final user-facing answer from a verified evidence ledger.",
    "Never reveal provider names, backend model names, internal model classes, or model-version labels.",
    "Use natural first-person past tense: say 'I extracted', 'I ran', or 'I checked', not 'I've already extracted'.",
    "Do not invent numbers, citations, files, or completed tools. If a tool failed, state the limitation without raw stack traces.",
    "For high-stakes engineering, economics, environmental, or scientific claims, include what the data supports and what it cannot prove.",
    "Use organized Markdown with short tables only when they improve readability. Keep table cells concise.",
  ].join("\n");
  const user = [
    args.project?.name ? `Project: ${args.project.name}` : "",
    `User request:\n${args.question}`,
    `Plan:\n${args.plan.map((step) => `${step.step_id}: ${step.tool_type} - ${step.title}`).join("\n")}`,
    `Tool runs:\n${args.toolRuns.map((run) => `${run.step_id} ${run.tool_type} ${run.status}: ${run.summary || run.error || ""}`).join("\n")}`,
    `Evidence ledger:\n${JSON.stringify(args.ledger, null, 2).slice(0, 50000)}`,
    `Verification findings:\n${JSON.stringify(args.verification, null, 2).slice(0, 12000)}`,
    `Quality evaluation:\n${JSON.stringify(args.quality, null, 2).slice(0, 12000)}`,
  ].filter(Boolean).join("\n\n");
  const text = await callDeepSeekV3(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 5000, timeoutMs: 45_000 },
  ).catch(() => "");
  return typeof text === "string" && text.trim() ? text.trim() : fallback;
}

export async function executeDeepAgent(args: ExecuteDeepAgentInput): Promise<DeepAgentResult> {
  const requiredOutputs = args.requiredOutputs?.length ? args.requiredOutputs : outputNeeds(args.question);
  const plan = await createPlan({ ...args, requiredOutputs });
  await args.onProgress?.("Planned the multi-tool analysis.", { steps: plan.length });

  const toolRuns: DeepAgentToolExecutionResult[] = [];
  for (const step of plan) {
    await args.onProgress?.(`Running ${step.title}.`, { step_id: step.step_id, tool_type: step.tool_type });
    try {
      const result = await args.executeTool(step);
      toolRuns.push({
        ...result,
        step_id: step.step_id,
        tool_type: step.tool_type,
        status: result.status || "completed",
      });
    } catch (error) {
      toolRuns.push({
        step_id: step.step_id,
        tool_type: step.tool_type,
        status: "failed",
        summary: "Tool step failed.",
        error: error instanceof Error ? error.message : String(error || "Tool step failed"),
      });
    }
  }

  let evidenceLedger = toolRuns.flatMap(artifactEvidence);
  if (evidenceLedger.length === 0 && args.artifacts?.length) {
    evidenceLedger = args.artifacts.slice(-6).map((artifact, index) => ({
      id: `ev_prior_${index + 1}`,
      source_type: "artifact",
      source_id: artifact.id,
      title: artifact.title,
      claim: artifact.summary,
      support: "direct" as const,
    }));
  }
  const verification = verifyLedger({ question: args.question, plan, toolRuns, ledger: evidenceLedger, requiredOutputs });
  const preliminary = deterministicFinal({ question: args.question, toolRuns, ledger: evidenceLedger, verification });
  const quality = evaluateAgentQuality({
    prompt: args.question,
    finalAnswer: preliminary,
    sourceTexts: sourceTextsFromLedger(evidenceLedger),
    requiresTool: true,
    requiresFiles: requiredOutputs.length > 0,
    files: toolRuns.flatMap((run) => {
      const files = isRecord(run.artifact?.content) && Array.isArray(run.artifact.content.files)
        ? run.artifact.content.files
        : [];
      return files.filter(isRecord).map((file) => ({
        filename: clean(file.filename),
        url: clean(file.url || file.path),
        mime_type: clean(file.mime_type),
      }));
    }),
  });
  const finalAnswer = await synthesizeFinal({
    question: args.question,
    project: args.project,
    plan,
    toolRuns,
    ledger: evidenceLedger,
    verification,
    quality,
  });

  return {
    question: args.question,
    plan,
    tool_runs: toolRuns,
    evidence_ledger: evidenceLedger,
    verification,
    quality_evaluation: quality,
    final_answer: finalAnswer,
  };
}
