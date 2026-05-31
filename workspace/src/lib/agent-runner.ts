import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

import { buildActionResultSummary } from "@/lib/action-result-summary";
import {
  PUBLIC_AGENT_IDENTITY_ANSWER,
  PUBLIC_AGENT_NAME,
  isAgentIdentityQuestion,
  sanitizeUserFacingAgentText,
} from "@/lib/agent-output";
import { runFinalQualityGate } from "@/lib/agent-final-quality-gate";
import { formatAgentToolRegistryForPrompt, isAgentActionType } from "@/lib/agent-tool-registry";
import { callDeepSeekV3, callDeepSeekV3Stream, getEnvVar, RUNTIME_DIR } from "@/lib/backend";
import { buildEnvironmentReadiness } from "@/lib/environment-readiness";
import { buildModelRoutedResponse } from "@/lib/model-router";
import { executeProjectAction } from "@/lib/project-action-dispatcher";
import { renderSalientSourceValuesForPrompt } from "@/lib/document-evidence";
import { buildScenarioMemory } from "@/lib/scenario-memory";
import { getStorage } from "@/lib/storage";
import type {
  ActionType,
  AgentEvent,
  AgentPlanStep,
  AgentRun,
  AgentRunFile,
  AgentRunMode,
  AgentThinkingLevel,
  Artifact,
  Project,
  ProjectDocument,
} from "@/lib/storage/types";
import type { InitialEvaluationProjectState } from "@/lib/initial-evaluation-guardrail";

interface CreateRunInput {
  message: string;
  document_ids?: string[];
  current_document_ids?: string[];
  mode?: AgentRunMode;
  thinking_level?: AgentThinkingLevel;
  parent_run_id?: string;
  plan?: AgentPlanStep[];
}

interface RoutedAction {
  type: ActionType;
  config: Record<string, unknown>;
  content: string;
  suggested_followups?: string[];
}

interface RouteDecision {
  kind: "direct" | "action" | "export";
  content?: string;
  action?: RoutedAction;
}

interface ToolFailureRecord {
  attempt: number;
  action_type: ActionType;
  action_config: Record<string, unknown>;
  action_content: string;
  error: string;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const FILE_OUTPUT_REQUEST_RE =
  /\b(export|download|save|convert|attach|attachment|file|csv|xlsx|excel|spreadsheet|pdf|json|markdown|md|ppt|pptx|presentation|deck|slide|slides)\b/i;

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanMultilineString(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim()
    : "";
}

function compactDiagnosticText(value: unknown, max = 8000): string {
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text;
  }
  try {
    const text = JSON.stringify(value ?? "");
    return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text;
  } catch {
    return String(value ?? "");
  }
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function stripAttachmentChrome(message: string): string {
  return message.replace(/\n*\[Attached:\s*.+?\]\s*/gi, "").trim();
}

function parseAttachmentNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/\[Attached:\s*([^\]]+)\]/gi)) {
    for (const name of (match[1] || "").split(/\s*,\s*/)) {
      const clean = name.trim();
      if (clean) names.push(clean);
    }
  }
  return unique(names);
}

function mimeTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function requestedFileOutputs(message: string): string[] {
  if (!FILE_OUTPUT_REQUEST_RE.test(message)) return [];
  const outputs = new Set<string>();
  if (/\bcsv\b/i.test(message)) outputs.add("csv");
  if (/\b(xlsx|excel|spreadsheet|workbook)\b/i.test(message)) outputs.add("xlsx");
  if (/\b(pdf)\b/i.test(message)) outputs.add("pdf");
  if (/\b(json)\b/i.test(message)) outputs.add("json");
  if (/\b(markdown|md)\b/i.test(message)) outputs.add("markdown");
  if (/\b(png|chart|plot|graph|figure)\b/i.test(message)) outputs.add("png");
  if (/\b(ppt|pptx|presentation|deck|slide|slides)\b/i.test(message)) outputs.add("pptx");
  if (outputs.size === 0 && /\b(export|download|save|convert|attach|attachment|file)\b/i.test(message)) {
    outputs.add("markdown");
  }
  return Array.from(outputs);
}

function actionRequestsVisibleFiles(action: RoutedAction): boolean {
  const config = action.config || {};
  const requestedOutputs = [
    ...(Array.isArray(config.requested_outputs) ? config.requested_outputs : []),
    ...(Array.isArray(config.required_outputs) ? config.required_outputs : []),
  ].map((value) => cleanString(value)).filter(Boolean);
  if (requestedOutputs.length > 0) return true;

  if (action.type === "agent_workspace") {
    return FILE_OUTPUT_REQUEST_RE.test(action.content || "");
  }

  const text = [
    action.content,
    cleanString(config.question),
    cleanString(config.task),
  ].filter(Boolean).join("\n");
  return FILE_OUTPUT_REQUEST_RE.test(text);
}

function downloadableFilesForArtifact(
  projectId: string,
  runId: string,
  artifact: Artifact | null | undefined,
  exposeFiles = true,
): AgentRunFile[] {
  if (!exposeFiles) return [];
  if (!artifact || !isRecord(artifact.content) || !Array.isArray(artifact.content.files)) return [];
  return artifact.content.files
    .filter((file): file is Record<string, unknown> => isRecord(file))
    .filter((file) => {
      const filename = cleanString(file.filename);
      const path = cleanString(file.path);
      if (!filename || !path) return false;
      if (/^input_manifest\.xlsx$/i.test(filename)) return false;
      if (/\.py$/i.test(filename)) return false;
      return /\.(csv|xlsx|pdf|md|json|png|jpg|jpeg|txt)$/i.test(filename);
    })
    .slice(0, 12)
    .map((file) => {
      const filename = cleanString(file.filename) || "download";
      const path = cleanString(file.path);
      const url = `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifact.id)}/files?path=${encodeURIComponent(path)}`;
      return {
        filename,
        mime_type: mimeTypeFor(filename),
        artifact_id: artifact.id,
        run_id: runId,
        url,
        path,
        size_bytes: typeof file.bytes === "number" ? file.bytes : undefined,
      };
    });
}

function isUsableLimitedWorkspaceArtifact(artifact: Artifact | null | undefined): boolean {
  if (!artifact || !isRecord(artifact.content)) return false;
  const content = artifact.content;
  if (artifact.type !== "workspace_run" && content.analysis_type !== "agent_workspace") return false;
  const report = cleanMultilineString(content.report_markdown);
  const results = isRecord(content.results) ? content.results : {};
  const summary = cleanMultilineString(results.summary || artifact.summary);
  const files = Array.isArray(content.files) ? content.files : [];
  const hasOutput = report.length >= 80 || summary.length >= 40 || files.length > 0;
  const isLimited =
    results.completed_with_limitations === true ||
    results.tool_execution_completed === false ||
    /could not complete|failed|best-effort|limitations/i.test([report, summary].join("\n"));
  return hasOutput && isLimited;
}

function workspaceArtifactHasExecutionFailure(artifact: Artifact | null | undefined): boolean {
  if (!artifact || !isRecord(artifact.content)) return false;
  if (artifact.type !== "workspace_run" && artifact.content.analysis_type !== "agent_workspace") return false;
  const execution = isRecord(artifact.content.execution) ? artifact.content.execution : {};
  return typeof execution.exit_code === "number" && execution.exit_code !== 0;
}

function addLimitedWorkspaceNotice(answer: string, artifact: Artifact | null | undefined): string {
  if (!workspaceArtifactHasExecutionFailure(artifact)) return answer;
  if (/\b(calculation limitation|executable calculation step did not finish|best-effort outputs)\b/i.test(answer)) {
    return answer;
  }
  return [
    "Calculation limitation: the executable calculation step did not finish cleanly, so the saved report and files are best-effort outputs. Treat computed values as needing independent verification.",
    "",
    answer.trim(),
  ].join("\n");
}

// Generated files are always reachable from the artifact card, so we only put a
// Downloads list inside the response text when the user actually asked for a
// file/export. Otherwise the response stays focused on the answer.
const PROMPT_WANTS_FILE_RE = /\b(file|csv|tsv|xlsx|excel|spreadsheet|pdf|json|markdown|download|export|deliverable)\b/i;
const PROMPT_WANTS_SOURCE_DISCLOSURE_RE =
  /\b(cite|citation|citations|references?|bibliography|source\s+list|show\s+(?:your\s+)?sources?|where\s+(?:the\s+)?(?:evidence|data|numbers?|claims?)\s+(?:came|comes)\s+from|links?\s+to\s+(?:sources?|papers?|references?)|evidence\s+trail|audit\s+trail)\b/i;

function appendDownloadLinks(answer: string, files: AgentRunFile[], requested = false): string {
  if (files.length === 0 || !requested) return answer;
  const links = files.map((file) => `- [Download ${file.filename}](${file.url})`);
  return `${answer.trim()}\n\nDownloads\n${links.join("\n")}`;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function simplePdfBytes(lines: string[]): Buffer {
  const escapePdf = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = [
    "BT",
    "/F1 10 Tf",
    "50 760 Td",
    ...lines
      .flatMap((line, index) => [`(${escapePdf(line.slice(0, 95))}) Tj`, index === lines.length - 1 ? "" : "0 -14 Td"])
      .filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output);
}

function exportContextText(project: Project, run: AgentRun, history: Array<{ role: string; content: string }>): string {
  const prior = history
    .filter((entry) => entry.role === "assistant")
    .slice(-4)
    .map((entry) => entry.content.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [
    `Project: ${project.name}`,
    project.description ? `Description: ${project.description}` : "",
    project.goal ? `Goal: ${project.goal}` : "",
    `Export request: ${run.user_message}`,
    prior.length ? `Prior run context:\n${prior.join("\n\n")}` : "Prior run context: no completed prior run was available.",
  ].filter(Boolean).join("\n\n");
}

async function emit(
  projectId: string,
  runId: string,
  type: AgentEvent["type"],
  message?: string,
  data?: Record<string, unknown>,
): Promise<AgentEvent> {
  return getStorage().appendAgentEvent(projectId, runId, {
    type,
    message,
    data,
  });
}

// Condense the model's running reasoning trace into one short, readable line
// suitable for the live "thinking" indicator.
function reasoningSnippet(text: string): string {
  const clean = (text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let snippet = sentences[sentences.length - 1] || clean;
  if (snippet.length < 25 && sentences.length > 1) snippet = sentences.slice(-2).join(" ");
  snippet = snippet.replace(/[#*_`>]+/g, "").trim();
  return snippet.length > 160 ? `${snippet.slice(0, 157)}...` : snippet;
}

/**
 * Generate an answer with a normal (fast) streaming completion and surface the
 * forming answer to the client as `progress` events, flushed at most once every
 * 5 seconds. This gives real-time visibility into what the agent is producing
 * with no extra latency over a non-streaming call — it is the same generation,
 * just shown as it arrives. Falls back to a plain call if streaming fails.
 */
async function streamAnswerWithProgress(args: {
  projectId: string;
  runId: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  let latest = "";
  let lastEmitted = "";
  const flush = () => {
    const snippet = reasoningSnippet(latest);
    if (snippet && snippet !== lastEmitted) {
      lastEmitted = snippet;
      void emit(args.projectId, args.runId, "progress", snippet).catch(() => {});
    }
  };
  const interval = setInterval(flush, 5000);
  try {
    return await callDeepSeekV3Stream(
      [{ role: "user", content: args.prompt }],
      { temperature: args.temperature ?? 0.2, maxTokens: args.maxTokens },
      { onContent: (full) => { latest = full; } },
    );
  } catch {
    return await callDeepSeekV3([{ role: "user", content: args.prompt }], {
      temperature: args.temperature ?? 0.2,
      maxTokens: args.maxTokens,
    });
  } finally {
    clearInterval(interval);
  }
}

async function getRunOrThrow(projectId: string, runId: string): Promise<AgentRun> {
  const run = await getStorage().getAgentRun(projectId, runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  return run;
}

async function ensureNotCancelled(projectId: string, runId: string): Promise<void> {
  const run = await getRunOrThrow(projectId, runId);
  if (run.status === "cancelled") {
    throw new Error("Run was cancelled");
  }
}

async function resolveRunDocuments(projectId: string, run: Pick<AgentRun, "attachment_document_ids">): Promise<ProjectDocument[]> {
  const docs = await getStorage().listDocuments(projectId);
  const wanted = new Set(run.attachment_document_ids || []);
  return docs.filter((doc) => wanted.has(doc.id));
}

async function latestContextDocumentIds(projectId: string): Promise<string[]> {
  const runs = await getStorage().listAgentRuns(projectId);
  for (const run of [...runs].reverse()) {
    if ((run.attachment_document_ids || []).length > 0) {
      return run.attachment_document_ids || [];
    }
  }
  return [];
}

async function buildRunHistory(projectId: string): Promise<Array<{ role: string; content: string }>> {
  const runs = await getStorage().listAgentRuns(projectId);
  const history: Array<{ role: string; content: string }> = [];
  const fullContextStart = Math.max(0, runs.length - 8);
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    history.push({ role: "user", content: run.user_message });
    if (run.final_answer) {
      const artifactLine = (run.artifact_ids || []).length
        ? `\nArtifacts: ${(run.artifact_ids || []).join(", ")}`
        : "";
      const fileLine = (run.files || []).length
        ? `\nFiles: ${(run.files || []).map((file) => `${file.filename} (${file.url})`).join("; ")}`
        : "";
      const finalText = index < fullContextStart
        ? [
          run.final_answer.replace(/\s+/g, " ").slice(0, 1800),
          run.final_answer.length > 1800 ? "[older run compacted; use artifact/file ids above for provenance]" : "",
        ].filter(Boolean).join(" ")
        : run.final_answer;
      history.push({
        role: "assistant",
        content: `[Run ${run.id} ${index < fullContextStart ? "compacted summary" : "final answer"}]\n${finalText}${artifactLine}${fileLine}`,
      });
    }
  }
  return history;
}

async function projectArtifacts(projectId: string): Promise<Artifact[]> {
  const storage = getStorage();
  const summaries = await storage.listArtifacts(projectId);
  const artifacts = await Promise.all(summaries.map((artifact) => storage.getArtifact(projectId, artifact.id)));
  return artifacts
    .filter((artifact): artifact is Artifact => !!artifact)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function artifactContextPreview(artifact: Artifact): string {
  const content = isRecord(artifact.content) ? artifact.content : {};
  const preview = JSON.stringify(content, null, 2).slice(0, 20_000);
  return [
    `[Artifact ${artifact.id}] ${artifact.type}: ${artifact.title}`,
    artifact.summary ? `Summary: ${artifact.summary}` : "",
    preview ? `Content preview:\n${preview}` : "",
  ].filter(Boolean).join("\n");
}

async function buildRoutingHistory(
  projectId: string,
  _message: string,
  _docs: ProjectDocument[],
): Promise<Array<{ role: string; content: string }>> {
  const history = await buildRunHistory(projectId);
  const artifacts = await projectArtifacts(projectId);
  if (artifacts.length === 0) return history;
  return [
    ...history,
    {
      role: "assistant",
      content: `Full saved artifact context:\n${artifacts.map(artifactContextPreview).join("\n\n")}`,
    },
  ];
}

async function buildInitialEvaluationState(projectId: string, projectDomain: string): Promise<InitialEvaluationProjectState> {
  const storage = getStorage();
  const [documents, artifactSummaries] = await Promise.all([
    storage.listDocuments(projectId),
    storage.listArtifacts(projectId),
  ]);
  const evaluationArtifacts = await Promise.all(
    artifactSummaries
      .filter((artifact) => artifact.type === "evaluation")
      .map((artifact) => storage.getArtifact(projectId, artifact.id)),
  );
  const hasSuccessfulEvaluationArtifact = evaluationArtifacts.some((artifact) => {
    if (!artifact || !isRecord(artifact.content)) return false;
    if (artifact.content.verdict === "not_ready" || artifact.content.run_state === "debug") return false;
    return isRecord(artifact.content.brief) || isRecord(artifact.content.module_evaluations);
  });
  return {
    hasUploadedDocuments: documents.length > 0,
    hasSuccessfulEvaluationArtifact,
    hasChartableArtifact: artifactSummaries.some((artifact) =>
      ["simulation", "evaluation", "report", "workspace_run", "deep_agent"].includes(artifact.type)
    ),
    hasAnyArtifact: artifactSummaries.length > 0,
    domain: projectDomain,
  };
}


function requestedOutputs(message: string): string[] {
  return requestedFileOutputs(message);
}

const DOCUMENT_BACKED_WORKSPACE_RE =
  /\b(analy[sz]e|assess|evaluate|estimate|calculate|model|simulate|screen|compare|sensitivity|uncertainty|run|export|download|csv|xlsx|json|pdf|table|scenario|exergy|techno-?economic|economic|emissions?|payback|lcoe|lcoh|recoverable|thermal|physics|risk|support|sizing|equipment|measurements?|log|data|stream|flow|temperature|capacity|efficiency)\b/i;

function shouldForceWorkspaceForDocumentRequest(message: string, docs: ProjectDocument[]): boolean {
  if (docs.length === 0) return false;
  if (isAgentIdentityQuestion(message)) return false;
  if (!DOCUMENT_BACKED_WORKSPACE_RE.test(message)) return false;
  if (/\b(one paragraph|short conceptual|define|explain the difference between)\b/i.test(message) && !/\b(this|uploaded|attached|file|document|table|log|csv|pdf)\b/i.test(message)) {
    return false;
  }
  return true;
}

function shouldOverrideDocumentActionWithWorkspace(message: string, docs: ProjectDocument[], action: RoutedAction): boolean {
  if (!shouldForceWorkspaceForDocumentRequest(message, docs)) return false;
  if (action.type === "agent_workspace") return false;
  if (action.type === "deep_agent") {
    return /\b(extract|calculate|calculation|estimate|annual|payback|emissions?|operating[- ]cost|exergy|model|simulate|sensitivity|scenario|export|download|csv|xlsx|json|pdf|table|uploaded|attached|file|document)\b/i.test(message) &&
      !/\b(literature|source-backed scan|scientific review|review outline|hypotheses|external sources?|market scan)\b/i.test(message);
  }
  if (action.type === "deep_research" || action.type === "literature_search") {
    return /\b(export|download|csv|xlsx|json|pdf|model|simulate|calculate|scenario|sensitivity|techno-?economic|payback|lcoe|lcoh)\b/i.test(message);
  }
  return [
    "document_analysis",
    "comprehensive_analysis",
    "evidence_evaluation",
    "environmental_site_analysis",
    "exploratory_analysis",
    "custom_chart",
    "physics_simulation",
    "simulation_run",
    "economics_analysis",
  ].includes(action.type);
}

function forcedWorkspaceAction(message: string, docs: ProjectDocument[], reason: string): RoutedAction {
  const attachments = docs.map((doc) => doc.filename).filter(Boolean);
  const sourceValueContext = renderSalientSourceValuesForPrompt(docs, 18);
  const messageWithAttachments = attachments.length > 0
    ? `${message}\n\n[Attached: ${attachments.join(", ")}]`
    : message;
  return {
    type: "agent_workspace",
    content: "I will run this in the workspace so the uploaded source data, calculations, tables, and limitations stay attached to the result.",
    config: {
      task: [
        messageWithAttachments,
        "",
        "This request depends on uploaded source data and should be answered from a workspace run, not from generic prose.",
        "Extract source values, run any needed calculations or simulations, create readable tables, and state what the data supports and cannot prove.",
        sourceValueContext,
      ].join("\n"),
      question: messageWithAttachments,
      current_attachments: attachments,
      requested_outputs: requestedOutputs(message),
      required_outputs: requestedOutputs(message),
      context: [`Routing safety net: ${reason}`, sourceValueContext].filter(Boolean).join("\n\n"),
      allow_dependency_install: true,
      timeout_ms: 15 * 60_000,
    },
  };
}

function maxToolRecoveryAttempts(): number {
  const raw = Number(getEnvVar("EXERGY_AGENT_TOOL_RECOVERY_ATTEMPTS") || process.env.EXERGY_AGENT_TOOL_RECOVERY_ATTEMPTS || 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(3, Math.trunc(raw)));
}

function actionAttemptTimeoutMs(actionType: ActionType): number {
  const envByAction: Partial<Record<ActionType, string>> = {
    agent_workspace: "EXERGY_AGENT_WORKSPACE_ATTEMPT_TIMEOUT_MS",
    deep_agent: "EXERGY_AGENT_DEEP_AGENT_ATTEMPT_TIMEOUT_MS",
    physics_simulation: "EXERGY_AGENT_PHYSICS_ATTEMPT_TIMEOUT_MS",
    simulation_run: "EXERGY_AGENT_SIMULATION_ATTEMPT_TIMEOUT_MS",
    economics_analysis: "EXERGY_AGENT_ECONOMICS_ATTEMPT_TIMEOUT_MS",
    environmental_site_analysis: "EXERGY_AGENT_ENVIRONMENTAL_ATTEMPT_TIMEOUT_MS",
    literature_search: "EXERGY_AGENT_RESEARCH_ATTEMPT_TIMEOUT_MS",
    deep_research: "EXERGY_AGENT_RESEARCH_ATTEMPT_TIMEOUT_MS",
  };
  const actionEnv = envByAction[actionType];
  const configured =
    (actionEnv ? getEnvVar(actionEnv) || process.env[actionEnv] : "")
    || getEnvVar("EXERGY_AGENT_TOOL_ATTEMPT_TIMEOUT_MS")
    || process.env.EXERGY_AGENT_TOOL_ATTEMPT_TIMEOUT_MS
    || "";
  const raw = configured ? Number(configured) : NaN;
  const fallbackByAction: Partial<Record<ActionType, number>> = {
    agent_workspace: 300_000,
    deep_agent: 240_000,
    physics_simulation: 120_000,
    simulation_run: 120_000,
    economics_analysis: 120_000,
    environmental_site_analysis: 120_000,
    literature_search: 120_000,
    deep_research: 240_000,
    deep_analysis: 180_000,
    scientific_review: 180_000,
    evidence_evaluation: 180_000,
    document_analysis: 180_000,
    comprehensive_analysis: 180_000,
    exploratory_analysis: 120_000,
    custom_chart: 90_000,
  };
  const fallback = fallbackByAction[actionType] || 90_000;
  const maxByAction: Partial<Record<ActionType, number>> = {
    deep_agent: 300_000,
    agent_workspace: 15 * 60_000,
  };
  const max = maxByAction[actionType] || 10 * 60_000;
  if (!Number.isFinite(raw)) return Math.min(fallback, max);
  return Math.max(30_000, Math.min(max, Math.trunc(raw)));
}

function visibleRequestSubject(message: string): string {
  const text = stripAttachmentChrome(message).toLowerCase();
  if (/\b(nmc|lithium|battery|cathode|anode|electrolyte|cycle life)\b/.test(text)) return "battery material readiness";
  if (/\b(waste heat|heat recovery|district heating|thermal|exergy)\b/.test(text)) return "thermal and exergy opportunity";
  if (/\b(capex|opex|npv|irr|lcoe|payback|financial model|economics)\b/.test(text)) return "techno-economic model";
  if (/\b(report|brief|memo|deck|pitch|presentation|spec sheet|schematic)\b/.test(text)) return "deliverable request";
  if (/\b(simulation|physics|solver|model|calculation)\b/.test(text)) return "physics and calculation request";
  if (/\b(research|benchmark|literature|market|competitor)\b/.test(text)) return "research and benchmark request";
  return "technical request";
}

function actionDisplayName(actionType: ActionType): string {
  return actionType.replace(/_/g, " ");
}

function summarizeActionInputs(action: RoutedAction): string {
  const config = action.config || {};
  const attachments = Array.isArray(config.current_attachments)
    ? config.current_attachments.map((value) => cleanString(value)).filter(Boolean)
    : [];
  const outputFormat = cleanString(config.output_format || config.format || config.deliverable_type);
  const requestedOutputs = Array.isArray(config.required_outputs)
    ? config.required_outputs.map((value) => cleanString(value)).filter(Boolean).slice(0, 3)
    : [];
  const namedInputs = [
    attachments.length ? `${attachments.length} uploaded file${attachments.length === 1 ? "" : "s"}` : "",
    outputFormat ? `${outputFormat} output` : "",
    requestedOutputs.length ? `outputs: ${requestedOutputs.join(", ")}` : "",
  ].filter(Boolean);
  return namedInputs.length ? namedInputs.join("; ") : "prompt and saved project context";
}

function friendlyActionLabel(actionType: ActionType): string {
  const labels: Record<string, string> = {
    physics_simulation: "the physics simulation",
    simulation_run: "the simulation",
    agent_workspace: "the workspace analysis",
    evidence_evaluation: "the evidence analysis",
    economics_analysis: "the economic analysis",
    document_analysis: "the document extraction",
    comprehensive_analysis: "the document analysis",
    literature_search: "the literature search",
    deep_research: "the deep research",
    deep_analysis: "the deep analysis",
    scientific_review: "the technical review",
    custom_chart: "the visualization",
    environmental_site_analysis: "the environmental site data collection",
    update_project: "the project context update",
  };
  return labels[actionType] || `the ${actionDisplayName(actionType)}`;
}

function actionStartedMessage(action: RoutedAction): string {
  return `Running ${friendlyActionLabel(action.type)}.`;
}

// Accurate, ordered descriptions of the phases an analysis moves through, used
// to narrate a tool run so the live indicator updates with real activity rather
// than stalling on a single line.
function actionPhaseLines(action: RoutedAction): string[] {
  const label = friendlyActionLabel(action.type);
  const domain = cleanString(action.config?.domain).replace(/_/g, " ");
  return [
    `Running ${label}${domain ? ` for the ${domain} case` : ""}`,
    "Processing the inputs and running the calculations",
    "Checking the results against physical limits",
    "Assembling the findings into a response",
  ];
}

function actionCompletedMessage(action: RoutedAction, artifact: Artifact | null | undefined, files: AgentRunFile[]): string {
  const pieces = [
    artifact?.title ? `created "${artifact.title}"` : "returned a result",
    files.length ? `prepared ${files.length} downloadable file${files.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `${actionDisplayName(action.type)} ${pieces.join(" and ")}.`;
}

function intakeProgressMessage(message: string, documentCount: number): string {
  const subject = visibleRequestSubject(message);
  if (documentCount > 0) {
    return `Reading ${documentCount} uploaded file${documentCount === 1 ? "" : "s"} and mapping the ${subject} to the right workflow.`;
  }
  return `No uploaded files detected; mapping the ${subject} from the prompt and project history.`;
}

function readinessProgressMessage(readiness: ReturnType<typeof buildEnvironmentReadiness>, documentCount: number): string {
  const missingRequired = readiness.checks.filter((check) => check.required && check.status === "missing");
  if (missingRequired.length > 0) {
    return `Runtime setup is missing ${missingRequired.map((check) => check.label).join(", ")} before full tool execution.`;
  }
  if (documentCount > 0) {
    return "Runtime is ready; combining uploaded evidence with the project history.";
  }
  return "Runtime is ready; selecting the analysis path from the prompt and project history.";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  promise.catch(() => {});
  return Promise.race([promise, timed]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function normalizeModelAction(value: unknown, fallbackContent: string): RoutedAction | null {
  if (!isRecord(value)) return null;
  const type = cleanString(value.type) as ActionType;
  if (!isAgentActionType(type)) return null;
  return {
    type,
    config: isRecord(value.config) ? value.config : {},
    content: fallbackContent,
  };
}

function hydrateActionWithRunContext(args: {
  action: RoutedAction;
  run: AgentRun;
  project: Project;
  docs: ProjectDocument[];
  history: Array<{ role: string; content: string }>;
}): RoutedAction {
  const config = { ...args.action.config };
  const attachments = args.docs.map((doc) => doc.filename).filter(Boolean);
  const sourceValueContext = renderSalientSourceValuesForPrompt(args.docs, 18);
  const scenarioMemory = buildScenarioMemory({
    prompt: args.run.user_message,
    documents: args.docs,
    history: args.history,
  });
  if (args.action.type !== "agent_workspace" && args.action.type !== "deep_agent") {
    const existingContext = cleanMultilineString(config.context);
    config.context = [
      existingContext,
      sourceValueContext,
      scenarioMemory.instructions,
    ].filter(Boolean).join("\n\n");
    if (!config.question) config.question = args.run.user_message;
    if (attachments.length > 0 && !config.current_attachments) config.current_attachments = attachments;
    return { ...args.action, config };
  }
  if (args.action.type === "agent_workspace" && !config.task) config.task = args.run.user_message;
  if (!config.question) config.question = args.run.user_message;
  if (args.action.type === "agent_workspace" && !config.requested_outputs) config.requested_outputs = requestedOutputs(args.run.user_message);
  if (args.action.type === "deep_agent" && !config.required_outputs) config.required_outputs = requestedOutputs(args.run.user_message);
  if (attachments.length > 0 && !config.current_attachments) {
    config.current_attachments = attachments;
  }
  const existingContext = cleanMultilineString(config.context);
  const recentContext = args.history
    .slice(-10)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join("\n\n")
    .slice(0, 48_000);
  config.context = [
    existingContext ? `Action context:\n${existingContext}` : "",
    `Project: ${args.project.name}`,
    args.project.description ? `Description: ${args.project.description}` : "",
    args.project.goal ? `Goal: ${args.project.goal}` : "",
    attachments.length ? `Current attachments: ${attachments.join(", ")}` : "",
    sourceValueContext,
    scenarioMemory.instructions,
    recentContext ? `Saved conversation, prior run, artifact, and file context:\n${recentContext}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    ...args.action,
    config,
  };
}

async function routeRun(projectId: string, run: AgentRun, project: Project, docs: ProjectDocument[]): Promise<RouteDecision> {
  const message = stripAttachmentChrome(run.user_message);
  if (isAgentIdentityQuestion(message)) {
    return { kind: "direct", content: PUBLIC_AGENT_IDENTITY_ANSWER };
  }
  const history = await buildRoutingHistory(projectId, message, docs);
  const hasModelKey = !!(getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY"));
  if (!hasModelKey) {
    throw new Error("The Exergy Lab Agent model is not configured, so the agent cannot process this run.");
  }

  const state = await buildInitialEvaluationState(projectId, project.domain || "general");
  const forceWorkspace = shouldForceWorkspaceForDocumentRequest(message, docs);
  const routed = await buildModelRoutedResponse({
    projectId,
    message,
    history,
    project,
    projectDomain: project.domain || "general",
    state,
    storage: getStorage(),
    currentDocuments: docs,
  });
  if (routed && isRecord(routed.action)) {
    const action = normalizeModelAction(routed.action, cleanString(routed.content));
    if (action) {
      if (shouldOverrideDocumentActionWithWorkspace(message, docs, action)) {
        return {
          kind: "action",
          action: hydrateActionWithRunContext({
            action: forcedWorkspaceAction(message, docs, `document_backed_complex_request_overrode_${action.type}`),
            run,
            project,
            docs,
            history,
          }),
        };
      }
      return { kind: "action", action: hydrateActionWithRunContext({ action, run, project, docs, history }) };
    }
  }
  if (forceWorkspace) {
    return {
      kind: "action",
      action: hydrateActionWithRunContext({
        action: forcedWorkspaceAction(message, docs, routed?.type === "response" ? "router_returned_direct_response_for_document_analysis" : "router_returned_no_usable_action_for_document_analysis"),
        run,
        project,
        docs,
        history,
      }),
    };
  }
  if (routed && routed.type === "response" && typeof routed.content === "string" && routed.content.trim()) {
    return { kind: "direct", content: routed.content };
  }
  const directPrompt = [
    `You are ${PUBLIC_AGENT_NAME}, a practical AI agent for energy, science, engineering, environmental, and techno-economic work.`,
    "Never reveal backend provider names, model names, or model-version labels. If asked what model this is, use the public Exergy Lab Agent identity.",
    "The routing response was not usable, so answer the user directly from the full context.",
    "Use normal chat language. Do not mention router failures, internal event names, evidence cards, View Details, Export Report, or schema fields.",
    "Let the presentation fit the user's request. A small question may need only one or two sentences; a complex diligence request may need headings, bullets, tables, or a detailed breakdown. Do not force the same structure every time.",
    "Ask for clarification only when missing information makes a useful answer impossible. Politely refuse only requests that are dangerous to execute or physically impossible as stated, and explain the specific reason.",
    "If tool use would have been helpful but is unavailable, still give the most useful answer possible and clearly state what would require a tool run or source data.",
    "Lead with the answer. Keep any caveats to the one or two that would change the decision, woven into the prose — do not add fixed 'Support and Limits', 'Assumptions', or 'Downloads' sections.",
    ...ANALYSIS_DISCIPLINE_RULES,
    `Project: ${project.name}`,
    project.description ? `Project description: ${project.description}` : "",
    docs.length ? `Current files: ${docs.map((doc) => doc.filename).join(", ")}` : "",
    history.length ? `Full available context:\n${history.map((entry) => `${entry.role}: ${entry.content}`).join("\n\n")}` : "",
    `User request:\n${message}`,
  ].filter(Boolean).join("\n\n");
  const direct = await streamAnswerWithProgress({ projectId, runId: run.id, prompt: directPrompt, temperature: 0.2, maxTokens: 3600 });
  if (typeof direct === "string" && direct.trim()) {
    return { kind: "direct", content: direct };
  }
  throw new Error("The Exergy Lab Agent did not return a usable response.");
}


function planForAction(action: RoutedAction): AgentPlanStep[] {
  const outline = Array.isArray(action.config.plan_outline)
    ? action.config.plan_outline.filter(isRecord).slice(0, 8)
    : [];
  const detailSteps: AgentPlanStep[] = outline.map((item, index) => ({
    step: index + 1,
    title: cleanString(item.title) || `Plan Step ${index + 1}`,
    description: cleanString(item.description),
    action_type: "planning_detail",
    config: {},
    display_only: true,
    status: "pending",
  }));
  const executable: AgentPlanStep = {
    step: detailSteps.length + 1,
    title: action.type === "agent_workspace" && detailSteps.length > 0 ? "Execute Workspace Analysis" : action.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: cleanString(action.content) || "Run the approved workspace analysis with the current context.",
    action_type: action.type,
    config: action.config,
    status: "pending",
  };
  const synthesis: AgentPlanStep = {
    step: detailSteps.length + 2,
    title: "Write Final Answer",
    description: "Summarize the completed results in normal chat language, including what the data can and cannot support.",
    action_type: "synthesis",
    config: {},
    status: "pending",
  };
  return [...detailSteps, executable, synthesis];
}

function defaultSynthesisStep(): AgentPlanStep {
  return {
    step: 1,
    title: "Write Final Answer",
    description: "Summarize the completed results in normal chat language, including what the data can and cannot support.",
    action_type: "synthesis",
    config: {},
    status: "pending",
  };
}

function isExecutablePlanStep(step: AgentPlanStep): boolean {
  return step.action_type !== "synthesis" && step.action_type !== "planning_detail" && !step.display_only;
}

function normalizeApprovedPlanSteps(inputSteps: AgentPlanStep[], existingSteps: AgentPlanStep[] = []): AgentPlanStep[] {
  const submitted = inputSteps.length > 0 ? inputSteps : existingSteps;
  const synthesis = submitted.find((step) => step.action_type === "synthesis")
    || existingSteps.find((step) => step.action_type === "synthesis")
    || defaultSynthesisStep();
  const nonSynthesis = submitted
    .filter((step) => step.action_type !== "synthesis")
    .map((step) => ({ ...step }));
  if (!nonSynthesis.some(isExecutablePlanStep)) {
    const originalExecutable = existingSteps.find(isExecutablePlanStep);
    if (originalExecutable) {
      nonSynthesis.push({ ...originalExecutable });
    }
  }
  return [...nonSynthesis, { ...synthesis }].map((step, index) => ({
    ...step,
    step: index + 1,
    status: "pending",
  }));
}

async function callAction(projectId: string, action: RoutedAction, trigger: "user" | "plan_step" = "user"): Promise<{
  action: Record<string, unknown>;
  artifact: Artifact | null;
  result_summary: string;
}> {
  const payload = await executeProjectAction({
    projectId,
    actionType: action.type,
    input: action.config,
    trigger,
    background: false,
  });
  const incompleteReason = incompleteComputedResultReason(action, payload.artifact, cleanMultilineString(payload.result_summary));
  if (incompleteReason) {
    throw new Error(incompleteReason);
  }
  if (action.type === "agent_workspace" && payload.artifact && isRecord(payload.artifact.content)) {
    const execution = isRecord(payload.artifact.content.execution) ? payload.artifact.content.execution : {};
    const exitCode = execution.exit_code;
    if (typeof exitCode === "number" && exitCode !== 0 && !isUsableLimitedWorkspaceArtifact(payload.artifact)) {
      throw new Error(cleanMultilineString(payload.result_summary) || "The workspace tool completed with limitations instead of a verified executable result.");
    }
  }
  return {
    action: payload.action as unknown as Record<string, unknown>,
    artifact: payload.artifact,
    result_summary: cleanMultilineString(payload.result_summary),
  };
}

function incompleteComputedResultReason(action: RoutedAction, artifact: Artifact | null, resultSummary: string): string | null {
  if (!artifact || !isRecord(artifact.content)) return null;
  const requestText = [
    action.content,
    JSON.stringify(action.config || {}),
  ].join("\n");
  if (!/\b(simulat|model|calculate|estimate|physics|economic|lcoe|lcoh|payback|sensitivity|scenario|table)\b/i.test(requestText)) {
    return null;
  }
  const content = artifact.content;
  const physicsScreens = Array.isArray(content.physics_screens) ? content.physics_screens : null;
  const moduleEvaluations = isRecord(content.module_evaluations) ? Object.keys(content.module_evaluations) : [];
  const summaryText = [
    artifact.summary,
    resultSummary,
    compactDiagnosticText(content, 8000),
  ].join("\n");
  const intakeOnly = content.evidence_level === "intake_only" || content.extraction_status === "partial";
  const noComputedPhysics = physicsScreens !== null && physicsScreens.length === 0 && /no supported physics screen matched|intake-only|first-pass|plain-language/i.test(summaryText);
  const noComputedEconomics = action.type === "economics_analysis" && moduleEvaluations.length === 0 && /missing|not enough|intake-only|no computed/i.test(summaryText);
  if (
    ["physics_simulation", "simulation_run", "economics_analysis"].includes(action.type) &&
    intakeOnly &&
    (noComputedPhysics || noComputedEconomics || /no supported .* matched/i.test(summaryText))
  ) {
    return `${action.type.replace(/_/g, " ")} returned intake-only evidence instead of the requested computed result.`;
  }
  if (
    ["document_analysis", "comprehensive_analysis", "evidence_evaluation", "environmental_site_analysis"].includes(action.type) &&
    /\b(current_attachments|SALIENT SOURCE VALUES|uploaded|attached|file|csv|pdf|document)\b/i.test(requestText) &&
    /\b(first-pass profiling|appears to be|classification|intake-only|bounded preliminary assessment|can support first-pass)\b/i.test(summaryText) &&
    !/\|.*\|/m.test(summaryText)
  ) {
    return `${action.type.replace(/_/g, " ")} returned shallow intake evidence instead of the requested client-ready synthesis.`;
  }
  return null;
}

function failureHistoryText(failures: ToolFailureRecord[]): string {
  return failures
    .map((failure) => {
      return [
        `Attempt ${failure.attempt}: ${failure.action_type}`,
        `Input: ${JSON.stringify(failure.action_config, null, 2).slice(0, 8000)}`,
        failure.action_content ? `Reason for tool use: ${failure.action_content}` : "",
        `Failure: ${failure.error}`,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function hydrateRecoveryActionConfig(args: {
  action: RoutedAction;
  run: AgentRun;
  project: Project | null;
  docs: ProjectDocument[];
  failures: ToolFailureRecord[];
}): RoutedAction {
  const config = { ...args.action.config };
  if (args.action.type === "agent_workspace" || args.action.type === "deep_agent") {
    const attachments = args.docs.map((doc) => doc.filename).filter(Boolean);
    const sourceValueContext = renderSalientSourceValuesForPrompt(args.docs, 18);
    const scenarioMemory = buildScenarioMemory({ prompt: args.run.user_message, documents: args.docs });
    if (args.action.type === "agent_workspace" && !config.task) config.task = args.run.user_message;
    if (!config.question) config.question = args.run.user_message;
    if (args.action.type === "agent_workspace" && !config.requested_outputs) config.requested_outputs = requestedOutputs(args.run.user_message);
    if (args.action.type === "deep_agent" && !config.required_outputs) config.required_outputs = requestedOutputs(args.run.user_message);
    if (attachments.length > 0 && !config.current_attachments) config.current_attachments = attachments;
    if (!config.context) {
      config.context = [
        args.project?.name ? `Project: ${args.project.name}` : "",
        args.project?.description ? `Description: ${args.project.description}` : "",
        args.project?.goal ? `Goal: ${args.project.goal}` : "",
        attachments.length ? `Current attachments: ${attachments.join(", ")}` : "",
        sourceValueContext,
        scenarioMemory.instructions,
        args.failures.length ? `Prior failed tool attempts:\n${failureHistoryText(args.failures).slice(0, 12000)}` : "",
      ].filter(Boolean).join("\n\n");
    }
  }
  return {
    ...args.action,
    config,
    content: args.action.content || "I will try the next best available tool path.",
  };
}

async function chooseRecoveryAfterToolFailure(args: {
  projectId: string;
  runId: string;
  failures: ToolFailureRecord[];
}): Promise<RouteDecision | null> {
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) {
    return null;
  }
  const run = await getStorage().getAgentRun(args.projectId, args.runId);
  if (!run) return null;
  const [project, docs, history, artifacts] = await Promise.all([
    getStorage().getProject(args.projectId),
    resolveRunDocuments(args.projectId, run),
    buildRunHistory(args.projectId),
    projectArtifacts(args.projectId),
  ]);
  const latestFailure = args.failures[args.failures.length - 1];
  if (
    latestFailure?.action_type === "agent_workspace" &&
    /did not complete within|timed out|timeout/i.test(latestFailure.error)
  ) {
    return null;
  }
  if (
    latestFailure &&
    latestFailure.action_type !== "agent_workspace" &&
    (
      /intake-only evidence|requested computed result|shallow intake evidence|client-ready synthesis|no supported .* matched|did not complete within|timed out|timeout/i.test(latestFailure.error) ||
      (docs.length > 0 && ["deep_agent", "physics_simulation", "simulation_run", "economics_analysis", "document_analysis", "comprehensive_analysis", "evidence_evaluation", "environmental_site_analysis"].includes(latestFailure.action_type))
    )
  ) {
    return {
      kind: "action",
      action: hydrateRecoveryActionConfig({
        action: forcedWorkspaceAction(run.user_message, docs, /did not complete within|timed out|timeout/i.test(latestFailure.error) ? "previous_tool_timed_out_for_document_request" : "fixed_tool_returned_intake_only_result"),
        run,
        project,
        docs,
        failures: args.failures,
      }),
    };
  }
  const system = [
    `You are ${PUBLIC_AGENT_NAME}'s recovery controller for a general-purpose AI workspace.`,
    "Never reveal backend provider names, model names, internal model classes, or model-version labels to the user.",
    "A selected tool failed. Decide the next best move from the actual context.",
    "You may choose one corrected tool action, a different tool action, or a direct final response.",
    "Prefer another tool or a corrected retry when it can produce real value. Choose a direct response when another tool is unlikely to help, inputs are missing, or the request can be answered from saved context.",
    "Do not claim a failed tool completed. Do not invent computed values or file outputs. If calculations or exports could not be completed, state the limitation plainly.",
    "Keep all user-facing content natural Markdown. Do not mention internal event names, evidence cards, View Details, Export Report, or schema fields.",
    "Tool registry:",
    formatAgentToolRegistryForPrompt(),
    "Return only JSON with this schema: {\"type\":\"response|action\",\"content\":\"plain language user-facing text\",\"action\":{\"type\":\"allowed_action\",\"config\":{}},\"suggested_followups\":[\"...\",\"...\",\"...\"]}.",
  ].join(" ");
  const user = [
    project?.name ? `PROJECT: ${project.name}` : "",
    project?.description ? `PROJECT DESCRIPTION: ${project.description}` : "",
    project?.goal ? `PROJECT GOAL: ${project.goal}` : "",
    docs.length ? `CURRENT FILES: ${docs.map((doc) => `${doc.filename} (${doc.mime_type || "unknown"})`).join(", ")}` : "CURRENT FILES: none",
    `USER REQUEST:\n${run.user_message}`,
    `TOOL FAILURE HISTORY:\n${failureHistoryText(args.failures).slice(0, 24000)}`,
    history.length ? `SAVED RUN CONTEXT:\n${history.slice(-14).map((entry) => `${entry.role}: ${entry.content}`).join("\n\n").slice(0, 32000)}` : "",
    artifacts.length
      ? `SAVED ARTIFACT CONTEXT:\n${artifacts.slice(-8).map(artifactContextPreview).join("\n\n").slice(0, 36000)}`
      : "",
  ].filter(Boolean).join("\n\n");

  const raw = await callDeepSeekV3(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      jsonMode: true,
      thinking: "disabled",
      temperature: 0.1,
      maxTokens: 2800,
      timeoutMs: 15_000,
    },
  ).catch(() => "");
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const type = cleanString(parsed.type);
  const content = cleanMultilineString(parsed.content);
  if (type === "response" && content) {
    return { kind: "direct", content };
  }
  if (type === "action") {
    const action = normalizeModelAction(parsed.action, content);
    if (!action) return null;
    return {
      kind: "action",
      action: hydrateRecoveryActionConfig({ action, run, project, docs, failures: args.failures }),
    };
  }
  return null;
}

async function synthesizeToolFailureAnswer(args: {
  projectId: string;
  runId: string;
  action: RoutedAction;
  error: unknown;
  failures?: ToolFailureRecord[];
}): Promise<string> {
  const run = await getStorage().getAgentRun(args.projectId, args.runId);
  const project = run ? await getStorage().getProject(args.projectId) : null;
  const history = await buildRunHistory(args.projectId);
  const errorText = args.error instanceof Error ? args.error.message : String(args.error || "Tool execution failed");
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) {
    return [
      "I could not complete the workspace step because the Exergy Lab Agent model is not configured.",
      "",
      "The request and project files are still saved in the workspace. Once the agent model is configured, rerun the request and the agent can continue from the stored context.",
    ].join("\n");
  }
  const prompt = [
    `You are ${PUBLIC_AGENT_NAME}. A tool call failed, but the user still needs a useful answer.`,
    "Never reveal backend provider names, model names, internal model classes, or model-version labels to the user.",
    "Write a polished Markdown answer from the request, available context, action configuration, and error.",
    "Use natural first-person past tense. Say 'I extracted...' or 'I ran...' instead of 'I've already extracted...' or 'I've already run...'.",
    "Do not claim the failed tool completed. Do not expose raw stack traces unless a concise error category is useful.",
    "Give the user practical value: what can be concluded now, what cannot be proven, and the next best path to complete the request.",
    "If the request asked for a calculation or export, explain what blocked it and provide a bounded analysis or table structure where possible.",
    "Do not end by asking permission to try a different approach when a clear next path exists; state the next best path directly.",
    "Do not mention internal route names, evidence cards, View Details, Export Report, or schema fields.",
    "",
    project?.name ? `PROJECT: ${project.name}` : "",
    project?.description ? `PROJECT DESCRIPTION: ${project.description}` : "",
    run?.user_message ? `USER REQUEST:\n${run.user_message}` : "",
    `TOOL SELECTED: ${args.action.type}`,
    `TOOL CONFIG:\n${JSON.stringify(args.action.config, null, 2).slice(0, 10000)}`,
    `ERROR SUMMARY:\n${errorText.slice(0, 4000)}`,
    args.failures?.length ? `ALL TOOL ATTEMPTS:\n${failureHistoryText(args.failures).slice(0, 24000)}` : "",
    history.length ? `RECENT SAVED CONTEXT:\n${history.slice(-12).map((entry) => `${entry.role}: ${entry.content}`).join("\n\n").slice(0, 30000)}` : "",
  ].filter(Boolean).join("\n\n");
  const text = await callDeepSeekV3([{ role: "user", content: prompt }], {
    temperature: 0.2,
    maxTokens: 3600,
    timeoutMs: 15_000,
  }).catch(() => "");
  if (typeof text === "string" && text.trim()) {
    return sanitizeUserFacingAgentText(text);
  }
  return [
    "I could not complete the workspace step, but the run did not lose your request or files.",
    "",
    run?.user_message ? `Requested analysis: ${run.user_message}` : "",
    "",
    "What can be said now: the request needs a tool result before any new calculated or exported values should be treated as complete.",
    "",
    "What cannot be proven yet: the requested calculation, simulation, or file export did not finish successfully in this attempt.",
    "",
    "Best next step: rerun the request with narrower assumptions or provide the missing source values, and I can continue from the saved workspace context.",
  ].join("\n");
}

async function executeActionAttemptInRun(projectId: string, runId: string, action: RoutedAction, trigger: "user" | "plan_step" = "user", attempt = 1, requestedFiles = false): Promise<{
  answer: string;
  artifact: Artifact | null;
  actionId?: string;
  files: AgentRunFile[];
}> {
  await ensureNotCancelled(projectId, runId);
  const toolCallId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await emit(projectId, runId, "tool.started", actionStartedMessage(action), {
    tool_call_id: toolCallId,
    action_type: action.type,
    input: action.config,
    attempt,
  });

  // Narrate the real phases of the tool run on a steady cadence so the user sees
  // movement during a long-running calculation instead of a stalled line.
  const phases = actionPhaseLines(action);
  let phaseIdx = 1;
  const narrator = setInterval(() => {
    void emit(projectId, runId, "progress", phases[Math.min(phaseIdx, phases.length - 1)]).catch(() => {});
    phaseIdx += 1;
  }, 8000);

  try {
    const timeoutMs = actionAttemptTimeoutMs(action.type);
    const payload = await withTimeout(
      callAction(projectId, action, trigger),
      timeoutMs,
      `${action.type.replace(/_/g, " ")} did not complete within ${Math.round(timeoutMs / 1000)} seconds.`,
    );
    clearInterval(narrator);
    await ensureNotCancelled(projectId, runId);
    const actionId = cleanString(payload.action.id);
    const artifact = payload.artifact;
    const summary = addLimitedWorkspaceNotice(
      payload.result_summary || buildActionResultSummary({ actionType: action.type, artifact }),
      artifact,
    );
    const files = downloadableFilesForArtifact(projectId, runId, artifact, actionRequestsVisibleFiles(action));

    await emit(projectId, runId, "tool.completed", actionCompletedMessage(action, artifact, files), {
      tool_call_id: toolCallId,
      action_id: actionId,
      action_type: action.type,
      artifact_id: artifact?.id,
    });
    if (artifact) {
      await emit(projectId, runId, "artifact.created", artifact.summary || artifact.title, {
        artifact_id: artifact.id,
        artifact_type: artifact.type,
        title: artifact.title,
      });
    }
    for (const file of files) {
      await emit(projectId, runId, "file.created", `Created ${file.filename}.`, file as unknown as Record<string, unknown>);
    }
    return {
      answer: appendDownloadLinks(sanitizeUserFacingAgentText(summary), files, requestedFiles),
      artifact,
      actionId,
      files,
    };
  } catch (error) {
    clearInterval(narrator);
    const message = error instanceof Error ? error.message : "Tool run did not finish";
    await emit(projectId, runId, "tool.failed", message, {
      tool_call_id: toolCallId,
      action_type: action.type,
      attempt,
    });
    throw error;
  }
}

async function executeActionInRun(projectId: string, runId: string, action: RoutedAction, trigger: "user" | "plan_step" = "user", requestedFiles = false): Promise<{
  answer: string;
  artifact: Artifact | null;
  actionId?: string;
  files: AgentRunFile[];
}> {
  const failures: ToolFailureRecord[] = [];
  const maxRecovery = maxToolRecoveryAttempts();
  let currentAction = action;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRecovery + 1; attempt += 1) {
    try {
      return await executeActionAttemptInRun(projectId, runId, currentAction, trigger, attempt, requestedFiles);
    } catch (error) {
      if (error instanceof Error && error.message === "Run was cancelled") throw error;
      lastError = error;
      const message = error instanceof Error ? error.message : String(error || "Tool run did not finish");
      failures.push({
        attempt,
        action_type: currentAction.type,
        action_config: currentAction.config,
        action_content: currentAction.content,
        error: message,
      });

      if (attempt > maxRecovery) break;
      await emit(projectId, runId, "progress", "The tool did not finish cleanly; choosing the next recovery step.", {
        failed_action_type: currentAction.type,
        recovery_attempt: attempt,
      });
      const recovery = await chooseRecoveryAfterToolFailure({ projectId, runId, failures }).catch(() => null);
      await ensureNotCancelled(projectId, runId);
      if (recovery?.kind === "action" && recovery.action) {
        currentAction = recovery.action;
        await emit(projectId, runId, "progress", `Trying ${currentAction.type.replace(/_/g, " ")} as the next recovery step.`, {
          action_type: currentAction.type,
          recovery_attempt: attempt,
        });
        continue;
      }
      if (recovery?.kind === "direct" && recovery.content) {
        return {
          answer: sanitizeUserFacingAgentText(recovery.content),
          artifact: null,
          files: [],
        };
      }
      break;
    }
  }

  const answer = await synthesizeToolFailureAnswer({
    projectId,
    runId,
    action: currentAction,
    error: lastError || "Tool execution failed",
    failures,
  });
  return {
    answer,
    artifact: null,
    files: [],
  };
}

async function createExportFilesInRun(args: {
  projectId: string;
  runId: string;
  run: AgentRun;
  project: Project;
  history: Array<{ role: string; content: string }>;
}): Promise<{ answer: string; artifact: Artifact; files: AgentRunFile[] }> {
  await emit(args.projectId, args.runId, "tool.started", "Creating export files.", {
    action_type: "run_export",
  });

  const formats = requestedOutputs(args.run.user_message);
  const wantsCsv = formats.includes("csv");
  const wantsPdf = formats.includes("pdf");
  const wantsJson = formats.includes("json");
  const wantsMarkdown = formats.includes("markdown");
  const context = exportContextText(args.project, args.run, args.history);
  const exportDir = join(RUNTIME_DIR, "projects", `proj_${args.projectId}`, "run_exports", args.runId);
  await mkdir(exportDir, { recursive: true });

  const filesToWrite: Array<{ filename: string; body: string | Buffer }> = [];
  if (wantsMarkdown) {
    filesToWrite.push({
      filename: "run_export.md",
      body: `# ${args.project.name} Export\n\n${context}\n`,
    });
  }
  if (wantsJson) {
    filesToWrite.push({
      filename: "run_export.json",
      body: JSON.stringify({
        project_id: args.projectId,
        run_id: args.runId,
        request: args.run.user_message,
        exported_at: now(),
        context,
        prior_runs: args.history,
      }, null, 2),
    });
  }
  if (wantsCsv) {
    filesToWrite.push({
      filename: "run_export.csv",
      body: [
        "field,value",
        ["project_id", args.projectId].map(csvCell).join(","),
        ["run_id", args.runId].map(csvCell).join(","),
        ["request", args.run.user_message].map(csvCell).join(","),
        ["context", context].map(csvCell).join(","),
      ].join("\n"),
    });
  }
  if (wantsPdf) {
    const pdfLines = context.replace(/\s+/g, " ").match(/.{1,90}(?:\s|$)/g)?.slice(0, 42) || [context.slice(0, 1800)];
    filesToWrite.push({
      filename: "run_export.pdf",
      body: simplePdfBytes([
        `${args.project.name} Export`,
        "",
        ...pdfLines,
      ]),
    });
  }

  const fileRecords: Array<{ filename: string; path: string; bytes: number }> = [];
  for (const file of filesToWrite) {
    const path = join(exportDir, file.filename);
    await writeFile(path, file.body);
    fileRecords.push({
      filename: file.filename,
      path,
      bytes: Buffer.isBuffer(file.body) ? file.body.length : Buffer.byteLength(file.body),
    });
  }

  const artifact = await getStorage().createArtifact(args.projectId, {
    schema_version: 1,
    type: "report",
    title: "Run Export",
    summary: `Created ${fileRecords.map((file) => file.filename).join(", ")} from saved run context.`,
    content: {
      analysis_type: "run_export",
      request: args.run.user_message,
      files: fileRecords,
    },
    source: "ai_synthesis",
    raw: {},
    metadata: {
      run_id: args.runId,
      deterministic: true,
      formats,
    },
    action_id: `run_export_${args.runId}`,
    provenance: { source: "ai_synthesis", deterministic: true },
    pinned: false,
  });
  const files = downloadableFilesForArtifact(args.projectId, args.runId, artifact, true);
  await emit(args.projectId, args.runId, "tool.completed", "Export files created.", {
    action_type: "run_export",
    artifact_id: artifact.id,
  });
  await emit(args.projectId, args.runId, "artifact.created", artifact.summary, {
    artifact_id: artifact.id,
    artifact_type: artifact.type,
    title: artifact.title,
  });
  for (const file of files) {
    await emit(args.projectId, args.runId, "file.created", `Created ${file.filename}.`, file as unknown as Record<string, unknown>);
  }
  return {
    // This is the explicit export deliverable, so the download links belong in
    // the response itself.
    answer: appendDownloadLinks(artifact.summary, files, true),
    artifact,
    files,
  };
}

async function completeRun(projectId: string, runId: string, finalAnswer: string, patch: Partial<AgentRun> = {}): Promise<void> {
  const storage = getStorage();
  const current = await storage.getAgentRun(projectId, runId);
  if (current?.status === "cancelled") return;
  await emit(projectId, runId, "progress", "Checking answer quality before finalizing.");
  const quality = current
    ? await runFinalQualityGate({ projectId, run: current, finalAnswer, patch }).catch((error) => {
      console.warn("[agent-runner] final quality gate failed:", error instanceof Error ? error.message : String(error));
      return null;
    })
    : null;
  const clean = quality?.finalAnswer || sanitizeUserFacingAgentText(finalAnswer);
  const qualityData = quality ? {
    quality_evaluation: quality.qualityEvaluation,
    claim_ledger: quality.claimLedger,
    source_extraction_confidence: quality.sourceExtractionConfidence,
    scenario_reproducibility: quality.scenarioReproducibility,
    quality_gate: {
      repaired: quality.repaired,
      appended_limit_note: quality.appendedLimitNote,
      answer_contract: quality.answerContract,
    },
  } : undefined;
  await emit(projectId, runId, "assistant.message", clean, qualityData);
  const latest = await storage.getAgentRun(projectId, runId);
  if (latest?.status === "cancelled") return;
  await storage.updateAgentRun(projectId, runId, {
    ...patch,
    status: "completed",
    final_answer: clean,
    completed_at: now(),
  });
  await emit(projectId, runId, "run.completed", "Run completed.", {
    final_answer: clean,
    ...(qualityData || {}),
  });
}

async function failRun(projectId: string, runId: string, error: unknown): Promise<void> {
  const message = sanitizeUserFacingAgentText(error instanceof Error ? error.message : "Run failed");
  const run = await getStorage().getAgentRun(projectId, runId);
  if (run?.status === "cancelled") return;
  await getStorage().updateAgentRun(projectId, runId, {
    status: "failed",
    error: message,
    completed_at: now(),
  });
  await emit(projectId, runId, "run.failed", message, { error: message });
}

// Shared technical-reasoning discipline applied to every synthesis path, so
// quality comes from principle rather than per-topic instructions.
const ANALYSIS_DISCIPLINE_RULES: string[] = [
  "Rank and recommend on the quantity that actually drives the decision (useful work, marginal value, the limiting constraint), not on the largest or most prominent number. The bigger headline figure is often not the better option.",
  "When an independent check or a second method disagrees with a reported value by more than roughly a factor of two, treat it as an unresolved discrepancy and say what must be confirmed to settle it. Do not reconcile the gap with an assumed parameter that was not actually supplied.",
  "When a result hinges on a key assumption, name it briefly inline — only the assumptions that would materially change the answer, not an exhaustive list.",
];

async function synthesizePlanFinal(args: {
  run: AgentRun;
  project: Project;
  stepResults: string[];
  files: AgentRunFile[];
}): Promise<string> {
  const base = args.stepResults.filter(Boolean).join("\n\n");
  if (!base.trim()) {
    throw new Error("Approved plan completed without usable tool results.");
  }
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) {
    throw new Error("The Exergy Lab Agent model is not configured, so the agent cannot synthesize the approved plan result.");
  }
  const planText = (args.run.plan || [])
    .map((step) => `${step.step}. ${step.title}: ${step.status || "pending"}`)
    .join("\n");
  const prompt = [
    `Write the final answer for this ${PUBLIC_AGENT_NAME} run.`,
    "Never reveal backend provider names, model names, internal model classes, or model-version labels.",
    "Use normal chat language. Do not mention internal event names, evidence cards, audit labels, View Details, Export Report, or schema fields.",
    "Use natural first-person past tense. Say 'I extracted...' or 'I ran...' instead of 'I've already extracted...' or 'I've already run...'.",
    "Choose the answer format dynamically from the user request and tool results. Use a brief answer, narrative, bullets, headings, tables, or a full technical breakdown only when that format genuinely improves the response.",
    "Do not reuse a fixed heading template. Do not add boilerplate sections just because this is an agent run.",
    "Lead with the answer. Give the user exactly what they asked for, directly and confidently.",
    "Keep caveats minimal and woven into the prose: mention only the one or two limitations that would actually change the decision. Do not enumerate everything that could not be done — credibility comes from a correct, useful answer, not from listing gaps.",
    "Do not add fixed sections such as 'Support and Limits', 'Source-Backed Inputs', 'Assumptions', 'Calculation Basis', or 'Downloads'. Do not include download links unless the user explicitly asked for a file.",
    PROMPT_WANTS_SOURCE_DISCLOSURE_RE.test(args.run.user_message)
      ? "The user asked for sources/provenance, so include concise citations, source names, links, or an evidence trail where useful."
      : "Do not tell the user where evidence came from unless they ask. Do not name uploaded files, APIs, databases, papers, source labels, URLs, citations, or say 'source-backed'. Use tool results as private context and present the answer and data directly.",
    args.run.parent_run_id
      ? "This is a follow-up turn. Answer the specific follow-up directly and conversationally; do not restate earlier structure. If they only want a file, produce it and share the link with a one-line summary."
      : "",
    ...ANALYSIS_DISCIPLINE_RULES,
    `Project: ${args.project.name}`,
    `User request: ${args.run.user_message}`,
    `Approved plan:\n${planText}`,
    `Tool results:\n${base}`,
  ].filter(Boolean).join("\n\n");
  const text = await streamAnswerWithProgress({
    projectId: args.run.project_id,
    runId: args.run.id,
    prompt,
    temperature: 0.2,
    maxTokens: 2200,
  });
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("The Exergy Lab Agent did not return a final synthesis for the approved plan.");
  }
  return appendDownloadLinks(sanitizeUserFacingAgentText(text), args.files, PROMPT_WANTS_FILE_RE.test(args.run.user_message));
}

export async function createAgentRun(projectId: string, input: CreateRunInput): Promise<AgentRun> {
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const explicitDocIds = unique([...(input.document_ids || []), ...(input.current_document_ids || [])]);
  const fallbackDocIds = explicitDocIds.length > 0 ? [] : await latestContextDocumentIds(projectId);
  const run = await storage.createAgentRun(projectId, {
    user_message: input.message,
    attachment_document_ids: explicitDocIds.length > 0 ? explicitDocIds : fallbackDocIds,
    mode: input.mode === "plan" ? "plan" : "implement",
    thinking_level: input.thinking_level === "instant" ? "instant" : "expert",
    parent_run_id: input.parent_run_id,
    plan: input.plan,
    action_ids: [],
    artifact_ids: [],
    files: [],
    status: "queued",
  });
  await emit(projectId, run.id, "run.started", "Run created.", {
    mode: run.mode,
    thinking_level: run.thinking_level,
    attachment_document_ids: run.attachment_document_ids,
  });
  return run;
}

export async function startAgentRun(projectId: string, runId: string): Promise<void> {
  const storage = getStorage();
  const run = await getRunOrThrow(projectId, runId);
  if (TERMINAL_RUN_STATUSES.has(run.status)) return;
  if (run.status === "running") return;
  const project = await storage.getProject(projectId);
  if (!project) throw new Error("Project not found");

  await storage.updateAgentRun(projectId, runId, { status: "running" });

  try {
    const docs = await resolveRunDocuments(projectId, run);
    await emit(projectId, runId, "progress", intakeProgressMessage(run.user_message, docs.length));
    const readiness = buildEnvironmentReadiness();
    await emit(projectId, runId, "progress", readinessProgressMessage(readiness, docs.length), {
      tool_readiness: readiness,
    });
    const decision = run.plan && run.plan.some((step) => step.action_type !== "synthesis" && !step.display_only)
      ? null
      : await routeRun(projectId, run, project, docs);

    if (decision?.kind === "direct") {
      await completeRun(projectId, runId, decision.content || "");
      return;
    }

    if (decision?.kind === "export") {
      const history = await buildRunHistory(projectId);
      const result = await createExportFilesInRun({ projectId, runId, run, project, history });
      await completeRun(projectId, runId, result.answer, {
        artifact_ids: [result.artifact.id],
        files: result.files,
      });
      return;
    }

    if (decision?.kind === "action" && decision.action && run.mode === "plan") {
      const plan = planForAction(decision.action);
      await storage.updateAgentRun(projectId, runId, { status: "waiting_approval", plan });
      await emit(projectId, runId, "plan.created", "I drafted a plan and will wait for approval before running it.", { steps: plan });
      await emit(projectId, runId, "plan.awaiting_approval", "Waiting for plan approval.", { steps: plan });
      return;
    }

    if (decision?.kind === "action" && decision.action) {
      const result = await executeActionInRun(projectId, runId, decision.action, "user", PROMPT_WANTS_FILE_RE.test(run.user_message));
      await completeRun(projectId, runId, result.answer, {
        action_ids: result.actionId ? [result.actionId] : [],
        artifact_ids: result.artifact?.id ? [result.artifact.id] : [],
        files: result.files,
      });
      return;
    }

    await executeApprovedPlan(projectId, runId);
  } catch (error) {
    if (error instanceof Error && error.message === "Run was cancelled") {
      await emit(projectId, runId, "run.cancelled", "Run cancelled.");
      return;
    }
    await failRun(projectId, runId, error);
  }
}

export async function executeApprovedPlan(projectId: string, runId: string): Promise<void> {
  const storage = getStorage();
  const run = await getRunOrThrow(projectId, runId);
  const project = await storage.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const plan = normalizeApprovedPlanSteps(run.plan || [], run.plan || []).map((step) => ({
    ...step,
    status: step.status || "pending",
  }));
  if (plan.length === 0) {
    throw new Error("No approved plan is available for this run");
  }

  await storage.updateAgentRun(projectId, runId, { status: "running", plan });
  await emit(projectId, runId, "plan.updated", "Plan execution started.", { steps: plan });

  const actionIds: string[] = [];
  const artifactIds: string[] = [];
  const files: AgentRunFile[] = [];
  const stepResults: string[] = [];

  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    if (step.display_only || step.action_type === "planning_detail") {
      plan[i] = { ...step, status: "done" };
      await storage.updateAgentRun(projectId, runId, { plan });
      await emit(projectId, runId, "plan.updated", `Planned step complete: ${step.title}`, { steps: plan });
      continue;
    }
    if (step.action_type === "synthesis") continue;

    await ensureNotCancelled(projectId, runId);
    plan[i] = { ...step, status: "running" };
    await storage.updateAgentRun(projectId, runId, { plan });
    await emit(projectId, runId, "plan.updated", `Running step ${i + 1}: ${step.title}`, { steps: plan });
    const result = await executeActionInRun(projectId, runId, {
      type: step.action_type as ActionType,
      config: step.config || {},
      content: step.description || step.title,
    }, "plan_step", PROMPT_WANTS_FILE_RE.test(run.user_message));
    if (result.actionId) actionIds.push(result.actionId);
    if (result.artifact?.id) artifactIds.push(result.artifact.id);
    files.push(...result.files);
    stepResults.push(`Step ${i + 1} - ${step.title}\n${result.answer}`);
    plan[i] = { ...step, status: "done" };
    await storage.updateAgentRun(projectId, runId, { plan, action_ids: actionIds, artifact_ids: artifactIds, files });
    await emit(projectId, runId, "plan.updated", `Step ${i + 1} complete: ${step.title}`, { steps: plan });
  }

  const synthesisIndex = plan.findIndex((step) => step.action_type === "synthesis");
  if (synthesisIndex >= 0) {
    plan[synthesisIndex] = { ...plan[synthesisIndex], status: "running" };
    await storage.updateAgentRun(projectId, runId, { plan });
    await emit(projectId, runId, "plan.updated", "Writing the final answer.", { steps: plan });
  }
  const finalAnswer = await synthesizePlanFinal({ run: { ...run, plan }, project, stepResults, files });
  const completedPlan: AgentPlanStep[] = plan.map((step) => ({
    ...step,
    status: step.status === "failed" ? "failed" : "done",
  }));
  await completeRun(projectId, runId, finalAnswer, {
    plan: completedPlan,
    action_ids: actionIds,
    artifact_ids: artifactIds,
    files,
  });
}

export async function updateAgentRunPlan(projectId: string, runId: string, input: { steps?: AgentPlanStep[]; feedback?: string }): Promise<AgentRun> {
  const storage = getStorage();
  const run = await getRunOrThrow(projectId, runId);
  if (run.status !== "waiting_approval") {
    throw new Error("Plan can only be edited while the run is waiting for approval");
  }
  let steps = normalizeApprovedPlanSteps(
    Array.isArray(input.steps) && input.steps.length > 0 ? input.steps : [],
    run.plan || [],
  );
  const feedback = cleanString(input.feedback);
  if (feedback && steps.length > 0) {
    const targetIndex = steps.findIndex((step) => !step.display_only && step.action_type !== "synthesis");
    const idx = targetIndex >= 0 ? targetIndex : 0;
    steps[idx] = {
      ...steps[idx],
      description: `${steps[idx].description || steps[idx].title}\nUser edit: ${feedback}`.trim(),
      config: {
        ...(steps[idx].config || {}),
        user_plan_edit: feedback,
      },
    };
  }
  await storage.updateAgentRun(projectId, runId, { plan: steps });
  await emit(projectId, runId, "plan.updated", "Plan updated.", { steps });
  return (await getRunOrThrow(projectId, runId));
}

export async function approveAgentRun(projectId: string, runId: string, options: { start?: boolean } = {}): Promise<void> {
  const storage = getStorage();
  const run = await getRunOrThrow(projectId, runId);
  if (run.status !== "waiting_approval") {
    if (run.status === "queued" || run.status === "running") return;
    throw new Error(`Run is ${run.status}, not waiting for approval`);
  }
  if (options.start === false) {
    const steps = normalizeApprovedPlanSteps(run.plan || [], run.plan || []);
    await storage.updateAgentRun(projectId, runId, { status: "queued", plan: steps });
    await emit(projectId, runId, "plan.updated", "Plan approved. Starting execution.", { steps });
    return;
  }
  void startAgentRun(projectId, runId).catch((error) => {
    void failRun(projectId, runId, error);
  });
}

export async function cancelAgentRun(projectId: string, runId: string): Promise<AgentRun> {
  const storage = getStorage();
  const run = await getRunOrThrow(projectId, runId);
  if (!TERMINAL_RUN_STATUSES.has(run.status)) {
    await storage.updateAgentRun(projectId, runId, {
      status: "cancelled",
      completed_at: now(),
    });
    await emit(projectId, runId, "run.cancelled", "Run cancelled.");
  }
  return getRunOrThrow(projectId, runId);
}
