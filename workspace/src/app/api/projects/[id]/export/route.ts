import { NextRequest, NextResponse } from "next/server";

import { buildClaimLedger, buildSourceExtractionConfidence, documentTextForDiagnostics, evaluateScenarioReproducibility } from "@/lib/agent-claim-ledger";
import { isHighStakesPrompt } from "@/lib/agent-answer-contract";
import { resumeRunnableAgentRuns } from "@/lib/agent-run-queue";
import { evaluateAgentQuality } from "@/lib/agent-quality-evaluator";
import { getDebugLog, getDebugSummary } from "@/lib/debug-log";
import { buildEnvironmentReadiness } from "@/lib/environment-readiness";
import { getStorage } from "@/lib/storage";
import type { Action, AgentEvent, AgentRun, Artifact, ProjectDocument } from "@/lib/storage/types";

type DiagnosticSeverity = "info" | "warn" | "error";

interface DiagnosticIssue {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  run_id?: string;
  details?: Record<string, unknown>;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);
const FORBIDDEN_CHAT_PHRASES = [
  "View Details",
  "Export Report",
  "Screening",
  "What Is Supported",
  "Do Not Claim Yet",
  "Best Next Data Requests",
  "Outputs collected",
  ".mineru.md",
  ".mineru.json",
  "Point me to the heat-pump rating table",
  "evidence card",
  "claim label",
];

function hasForbiddenChatPhrase(text: string, phrase: string): boolean {
  if (phrase.toLowerCase() === "screening") {
    return /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?Screening(?:\*\*)?\s*:?\s*(?:\n|$)/i.test(text);
  }
  return text.toLowerCase().includes(phrase.toLowerCase());
}

const LIMIT_LANGUAGE_RE = /\b(can(?:not|'t)?\s+(?:support|prove|show|confirm)|not\s+(?:prove|supported|validated)|cannot\s+prove|data\s+(?:support|supports|does\s+not)|limit|gap|missing|uncertain|assumption|would\s+improve\s+confidence)\b/i;

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactText(value: unknown, max = 12000): string {
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

function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth limit]";
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => redactDiagnosticValue(item, depth + 1));
  if (!isRecord(value)) {
    if (typeof value === "string") {
      return value.length > 24000 ? `${value.slice(0, 24000)}...[truncated ${value.length - 24000} chars]` : value;
    }
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(api[_-]?key|token|secret|password|authorization|cookie|session)/i.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactDiagnosticValue(item, depth + 1);
    }
  }
  return out;
}

function roleCounts(messages: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    const role = isRecord(message) && typeof message.role === "string" ? message.role : "unknown";
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

function eventCounts(events: AgentEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
  return counts;
}

function latestProgress(events: AgentEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (
      event.type === "progress" ||
      event.type === "tool.started" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed" ||
      event.type === "plan.updated"
    ) {
      return event.message;
    }
  }
  return undefined;
}

function userVisibleRunContent(run: AgentRun, events: AgentEvent[]): string {
  if (run.final_answer) return run.final_answer;
  if (run.status === "waiting_approval") {
    return [...events].reverse().find((event) => event.type === "plan.created")?.message
      || "I drafted a plan and will wait for approval before running it.";
  }
  if (run.status === "failed") return run.error || "The run failed.";
  if (run.status === "cancelled") return "Run cancelled.";
  return latestProgress(events) || "Reading the request and workspace context.";
}

function serverRenderedMessages(runs: AgentRun[], eventsByRun: Map<string, AgentEvent[]>): Array<Record<string, unknown>> {
  return runs.flatMap((run) => {
    const events = eventsByRun.get(run.id) || [];
    const active = ACTIVE_RUN_STATUSES.has(run.status);
    return [
      {
        id: `${run.id}_user`,
        role: "user",
        content: run.user_message,
        ts: run.created_at,
        runId: run.id,
      },
      {
        id: `${run.id}_assistant`,
        role: "assistant",
        content: active ? "" : userVisibleRunContent(run, events),
        ts: run.updated_at || run.created_at,
        runId: run.id,
        loading: active,
        loadingText: active ? latestProgress(events) : undefined,
        plan: Array.isArray(run.plan) ? run.plan.map((step) => ({
          step: step.step,
          title: step.title,
          action_type: step.action_type,
          display_only: step.display_only === true,
          status: step.status,
        })) : undefined,
      },
    ];
  });
}

function numberLikeTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/(?:\$|USD\s*)?\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:million|billion|k|m|mw|kw|mwh|kwh|gwh|c|kg\/s|usd|mmbtu|btu\/kwh|ppm|%|years?|hrs?|hours?)?\b/gi)) {
    const token = match[0]
      .toLowerCase()
      .replace(/usd\s*/g, "$")
      .replace(/,/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^\d{4}$/.test(token)) continue;
    if (token.length >= 2) tokens.add(token);
  }
  return Array.from(tokens).slice(0, 80);
}

function numberTokenValue(token: string): number | null {
  const normalized = token
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\b(?:mw|kw|mwh|kwh|gwh|c|kg\/s|usd|mmbtu|btu\/kwh|ppm|%|years?|hrs?|hours?)\b/g, "")
    .trim();
  const match = normalized.match(/^-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  if (/\bbillion\b/i.test(token)) return value * 1_000_000_000;
  if (/\bmillion\b/i.test(token)) return value * 1_000_000;
  if (/\bk\b/i.test(token) && !/\bkw|kwh|kg\b/i.test(token)) return value * 1_000;
  return value;
}

function numericValues(tokens: string[]): number[] {
  return tokens
    .map(numberTokenValue)
    .filter((value): value is number => value !== null);
}

function hasNumericEquivalent(token: string, candidates: number[]): boolean {
  const value = numberTokenValue(token);
  if (value === null) return false;
  return candidates.some((candidate) => {
    const tolerance = Math.max(0.05, Math.abs(candidate) * 0.001);
    return Math.abs(candidate - value) <= tolerance;
  });
}

function documentDiagnosticText(doc: ProjectDocument): string {
  const likelyText = documentTextForDiagnostics(doc);
  return likelyText || compactText(doc.extraction_result || {}, 20000);
}

function artifactDiagnosticText(artifact: Artifact | null | undefined): string {
  if (!artifact) return "";
  return [
    artifact.title,
    artifact.summary,
    compactText(artifact.content, 30000),
    compactText(artifact.metadata, 8000),
  ].filter(Boolean).join("\n\n");
}

function pushIssue(
  issues: DiagnosticIssue[],
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  run_id?: string,
): void {
  issues.push({ severity, code, message, ...(run_id ? { run_id } : {}), ...(details ? { details } : {}) });
}

function buildIssueTriage(issues: DiagnosticIssue[]): Record<string, unknown> {
  const productBlockers = issues.filter((issue) => issue.severity === "error");
  const evaluatorFalsePositiveSignals = issues.filter((issue) =>
    /false_positive|expected_context_false_positive|answer_numbers_not_seen_in_sources/.test(issue.code)
  );
  const activeUnresolvedRisks = issues.filter((issue) =>
    issue.severity === "warn" && !/artifact_action_not_in_action_storage/.test(issue.code)
  );
  return {
    product_blockers: productBlockers.map((issue) => ({ code: issue.code, run_id: issue.run_id, message: issue.message })),
    active_unresolved_risks: activeUnresolvedRisks.map((issue) => ({ code: issue.code, run_id: issue.run_id, message: issue.message })),
    evaluator_false_positives_or_heuristics: evaluatorFalsePositiveSignals.map((issue) => ({ code: issue.code, run_id: issue.run_id, message: issue.message })),
    fixed_and_verified_issues: "See campaign report fix_applied and verification_after_fix fields for historical issue annotations; diagnostic export reports current project state only.",
    historical_campaign_warnings: "Historical warnings are not suppressed or rewritten by diagnostics.",
  };
}

function diagnoseToolPairs(events: AgentEvent[], runId: string, issues: DiagnosticIssue[]): Array<Record<string, unknown>> {
  const started = new Map<string, AgentEvent>();
  const ended = new Set<string>();
  for (const event of events) {
    const toolCallId = isRecord(event.data) && typeof event.data.tool_call_id === "string"
      ? event.data.tool_call_id
      : `sequence_${event.sequence}`;
    if (event.type === "tool.started") started.set(toolCallId, event);
    if (event.type === "tool.completed" || event.type === "tool.failed") ended.add(toolCallId);
  }
  for (const [toolCallId, event] of started.entries()) {
    if (!ended.has(toolCallId)) {
      pushIssue(issues, "warn", "tool_started_without_terminal_event", "A tool started but did not emit tool.completed or tool.failed.", {
        tool_call_id: toolCallId,
        event_sequence: event.sequence,
        action_type: isRecord(event.data) ? event.data.action_type : undefined,
      }, runId);
    }
  }
  return Array.from(started.entries()).map(([toolCallId, event]) => ({
    tool_call_id: toolCallId,
    started_sequence: event.sequence,
    action_type: isRecord(event.data) ? event.data.action_type : undefined,
    completed_or_failed: ended.has(toolCallId),
  }));
}

function latestCompletedEventData(events: AgentEvent[]): Record<string, unknown> {
  const event = [...events].reverse().find((candidate) => candidate.type === "run.completed" && isRecord(candidate.data));
  return isRecord(event?.data) ? event.data : {};
}

function buildRunDiagnostic(args: {
  run: AgentRun;
  events: AgentEvent[];
  documentsById: Map<string, ProjectDocument>;
  artifactsById: Map<string, Artifact>;
  actionsById: Map<string, Action>;
  issues: DiagnosticIssue[];
}): Record<string, unknown> {
  const { run, events, documentsById, artifactsById, actionsById, issues } = args;
  const runStarted = events.some((event) => event.type === "run.started");
  const assistantMessages = events.filter((event) => event.type === "assistant.message");
  const completedEvents = events.filter((event) => event.type === "run.completed");
  const failedEvents = events.filter((event) => event.type === "run.failed" || event.type === "tool.failed");
  const completedData = latestCompletedEventData(events);
  const actionIds = Array.isArray(run.action_ids) ? run.action_ids : [];
  const artifactIds = Array.isArray(run.artifact_ids) ? run.artifact_ids : [];
  const attachmentIds = Array.isArray(run.attachment_document_ids) ? run.attachment_document_ids : [];
  const attachedDocuments = attachmentIds.map((docId) => documentsById.get(docId)).filter(Boolean) as ProjectDocument[];
  const artifactTexts = artifactIds.map((artifactId) => artifactDiagnosticText(artifactsById.get(artifactId))).filter(Boolean);

  if (!runStarted) {
    pushIssue(issues, "warn", "missing_run_started_event", "Run has no run.started event.", { status: run.status }, run.id);
  }
  if (run.status === "completed" && !run.final_answer) {
    pushIssue(issues, "error", "completed_run_missing_final_answer", "Run is completed but has no persisted final_answer.", undefined, run.id);
  }
  if (run.status === "completed" && completedEvents.length === 0) {
    pushIssue(issues, "error", "completed_run_missing_completed_event", "Run is completed but has no run.completed event.", undefined, run.id);
  }
  if (run.final_answer && assistantMessages.length === 0) {
    pushIssue(issues, "warn", "final_answer_without_assistant_message_event", "Run has a final answer but no assistant.message event.", undefined, run.id);
  }
  if (run.status === "failed") {
    pushIssue(issues, "error", "run_failed", run.error || "Run failed without a saved error message.", undefined, run.id);
  }
  if (run.status === "waiting_approval" && (!Array.isArray(run.plan) || run.plan.length === 0)) {
    pushIssue(issues, "error", "approval_wait_without_plan", "Run is waiting for approval but has no persisted plan.", undefined, run.id);
  }
  if (ACTIVE_RUN_STATUSES.has(run.status) && events.length <= 1) {
    pushIssue(issues, "warn", "active_run_without_progress", "Run is active but has little or no progress history.", undefined, run.id);
  }

  for (const actionId of actionIds) {
    if (!actionsById.has(actionId)) {
      pushIssue(issues, "warn", "run_references_missing_action", "Run references an action id that is not in server action storage.", { action_id: actionId }, run.id);
    }
  }
  for (const artifactId of artifactIds) {
    if (!artifactsById.has(artifactId)) {
      pushIssue(issues, "warn", "run_references_missing_artifact", "Run references an artifact id that is not in server artifact storage.", { artifact_id: artifactId }, run.id);
    }
  }
  for (const docId of attachmentIds) {
    if (!documentsById.has(docId)) {
      pushIssue(issues, "error", "run_references_missing_document", "Run references an attachment document id that is not in server document storage.", { document_id: docId }, run.id);
    }
  }

  const userAskedAboutAttachment = /\b(this|attached|uploaded)\s+(file|pdf|document|spreadsheet|deck|note)\b|\banaly[sz]e\s+this\s+file\b/i.test(run.user_message);
  if (userAskedAboutAttachment && attachmentIds.length === 0) {
    pushIssue(issues, "warn", "file_request_without_document_ids", "User asked about an uploaded/current file, but the run has no attachment document ids.", undefined, run.id);
  }
  const docsWithoutText = attachedDocuments.filter((doc) => !documentDiagnosticText(doc).trim());
  if (userAskedAboutAttachment && docsWithoutText.length > 0) {
    pushIssue(issues, "warn", "attached_document_without_extracted_text", "One or more attached documents have no extracted text preview in storage.", {
      filenames: docsWithoutText.map((doc) => doc.filename),
    }, run.id);
  }

  const finalAnswer = run.final_answer || "";
  for (const phrase of FORBIDDEN_CHAT_PHRASES) {
    if (hasForbiddenChatPhrase(finalAnswer, phrase)) {
      pushIssue(issues, "error", "forbidden_legacy_phrase_in_final_answer", "Final answer contains a legacy/internal UI phrase.", { phrase }, run.id);
    }
  }
  if (isHighStakesPrompt(run.user_message, { hasDocuments: attachmentIds.length > 0, hasFiles: (run.files || []).length > 0, followup: Boolean(run.parent_run_id) }) && finalAnswer && !LIMIT_LANGUAGE_RE.test(finalAnswer)) {
    pushIssue(issues, "warn", "high_stakes_answer_missing_limits_language", "High-stakes answer may not state what the data can support or cannot prove.", undefined, run.id);
  }

  const sourceOnlyText = [
    run.user_message,
    ...attachedDocuments.map(documentDiagnosticText),
  ].join("\n\n").toLowerCase();
  const artifactOnlyText = artifactIds.map((artifactId) => artifactDiagnosticText(artifactsById.get(artifactId))).join("\n\n").toLowerCase();
  const evidenceText = [
    sourceOnlyText,
    ...artifactIds.map((artifactId) => artifactDiagnosticText(artifactsById.get(artifactId))),
  ].join("\n\n").toLowerCase();
  const sourceNumberTokens = new Set(numberLikeTokens(evidenceText));
  const sourceOnlyNumberTokens = new Set(numberLikeTokens(sourceOnlyText));
  const artifactNumberTokens = new Set(numberLikeTokens(artifactOnlyText));
  const sourceNumberValues = numericValues(Array.from(sourceOnlyNumberTokens));
  const artifactNumberValues = numericValues(Array.from(artifactNumberTokens));
  const evidenceNumberValues = numericValues(Array.from(sourceNumberTokens));
  const answerNumberTokens = numberLikeTokens(finalAnswer);
  const computedNumberTokens = answerNumberTokens
    .filter((token) => !sourceOnlyNumberTokens.has(token) && !hasNumericEquivalent(token, sourceNumberValues))
    .filter((token) => artifactNumberTokens.has(token) || hasNumericEquivalent(token, artifactNumberValues))
    .slice(0, 25);
  const unsupportedNumberTokens = answerNumberTokens
    .filter((token) =>
      !sourceNumberTokens.has(token) &&
      !hasNumericEquivalent(token, evidenceNumberValues) &&
      !artifactNumberTokens.has(token) &&
      !hasNumericEquivalent(token, artifactNumberValues)
    )
    .slice(0, 25);
  if (unsupportedNumberTokens.length > 0 && finalAnswer) {
    pushIssue(issues, "info", "answer_numbers_not_seen_in_sources", "Final answer includes number-like tokens that were not matched to uploaded sources or referenced artifacts after numeric-equivalence checks. Computed values found in artifacts are listed separately so this diagnostic is not treated as a hallucination finding by itself.", {
      tokens: unsupportedNumberTokens,
      computed_value_tokens_seen_in_artifacts: computedNumberTokens,
      diagnostic_reason: "Exact source text, referenced artifact text, and numeric-equivalent forms were checked. Remaining tokens may still be valid if they are derived only in prose, but should be reviewed.",
    }, run.id);
  }

  const sourceTexts = [
    run.user_message,
    ...attachedDocuments.map(documentDiagnosticText),
  ].filter((text) => text.trim());
  const qualityEvaluation = isRecord(completedData.quality_evaluation)
    ? completedData.quality_evaluation
    : evaluateAgentQuality({
      prompt: run.user_message,
      finalAnswer,
      sourceTexts: [...sourceTexts, ...artifactTexts],
      files: run.files || [],
      events,
      requiresTool: actionIds.length > 0 || artifactIds.length > 0 || isHighStakesPrompt(run.user_message, { hasDocuments: attachmentIds.length > 0, hasFiles: (run.files || []).length > 0, followup: Boolean(run.parent_run_id) }),
      requiresFiles: /\b(export|download|save|convert|csv|xlsx|excel|spreadsheet|pdf|json|markdown|md|file)\b/i.test(run.user_message),
    });
  const claimLedger = isRecord(completedData.claim_ledger)
    ? completedData.claim_ledger
    : buildClaimLedger({ finalAnswer, sourceTexts, artifactTexts });
  const sourceExtractionConfidence = Array.isArray(completedData.source_extraction_confidence)
    ? completedData.source_extraction_confidence
    : buildSourceExtractionConfidence(attachedDocuments);
  const scenarioReproducibility = isRecord(completedData.scenario_reproducibility)
    ? completedData.scenario_reproducibility
    : evaluateScenarioReproducibility({ prompt: run.user_message, finalAnswer, artifactTexts });

  if (
    isRecord(claimLedger)
    && isRecord(claimLedger.summary)
    && typeof claimLedger.summary.unsupported_numeric_claims === "number"
    && claimLedger.summary.unsupported_numeric_claims > 0
  ) {
    pushIssue(issues, "warn", "claim_ledger_unsupported_numeric_claims", "The private claim ledger found numeric claims without source, tool-output, calculation, or assumption support.", {
      unsupported_numeric_claims: claimLedger.summary.unsupported_numeric_claims,
    }, run.id);
  }
  const weakExtractions = Array.isArray(sourceExtractionConfidence)
    ? sourceExtractionConfidence.filter((entry) => isRecord(entry) && (entry.confidence === "none" || entry.confidence === "low"))
    : [];
  if (userAskedAboutAttachment && weakExtractions.length > 0) {
    pushIssue(issues, "warn", "weak_source_extraction_confidence", "One or more attached documents have weak extraction confidence; answers may miss tables, scanned text, or source values.", {
      documents: weakExtractions.map((entry) => ({
        filename: entry.filename,
        confidence: entry.confidence,
        issues: entry.issues,
      })),
    }, run.id);
  }
  if (
    isRecord(scenarioReproducibility)
    && scenarioReproducibility.required === true
    && typeof scenarioReproducibility.score === "number"
    && scenarioReproducibility.score < 75
  ) {
    pushIssue(issues, "warn", "scenario_reproducibility_weak", "Scenario or sensitivity answer may not expose changed inputs, held-constant assumptions, tables, and calculation basis clearly enough.", {
      score: scenarioReproducibility.score,
      checks: scenarioReproducibility.checks,
    }, run.id);
  }

  const fileIssues = (run.files || []).filter((file) => !file.url || !file.filename || !file.mime_type);
  if (fileIssues.length > 0) {
    pushIssue(issues, "warn", "run_file_missing_download_metadata", "One or more run files are missing filename, MIME type, or download URL.", {
      files: fileIssues,
    }, run.id);
  }

  const toolCalls = diagnoseToolPairs(events, run.id, issues);
  const startedAt = Date.parse(run.created_at);
  const completedAt = run.completed_at ? Date.parse(run.completed_at) : Number.NaN;
  const durationMs = Number.isFinite(startedAt) && Number.isFinite(completedAt) ? completedAt - startedAt : null;

  return {
    run_id: run.id,
    status: run.status,
    mode: run.mode,
    thinking_level: run.thinking_level,
    created_at: run.created_at,
    updated_at: run.updated_at,
    completed_at: run.completed_at || null,
    duration_ms: durationMs,
    user_message_preview: compactText(run.user_message, 1500),
    final_answer_preview: compactText(run.final_answer || "", 3000),
    has_final_answer: !!run.final_answer,
    has_plan: Array.isArray(run.plan) && run.plan.length > 0,
    plan_steps: Array.isArray(run.plan)
      ? run.plan.map((step) => ({
        step: step.step,
        title: step.title,
        action_type: step.action_type,
        display_only: step.display_only === true,
        status: step.status,
      }))
      : [],
    attachment_document_ids: attachmentIds,
    attached_documents: attachedDocuments.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      status: doc.status,
      mime_type: doc.mime_type,
      size_bytes: doc.size_bytes,
      extracted_text_chars: documentDiagnosticText(doc).length,
      extraction_keys: Object.keys(doc.extraction_result || {}),
    })),
    action_ids: actionIds,
    artifact_ids: artifactIds,
    files: run.files || [],
    event_counts: eventCounts(events),
    latest_progress: latestProgress(events) || null,
    failed_events: failedEvents.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      message: event.message,
      data: redactDiagnosticValue(event.data),
    })),
    tool_calls: toolCalls,
    source_alignment: {
      answer_number_like_tokens: answerNumberTokens,
      source_number_like_tokens: Array.from(sourceNumberTokens).slice(0, 80),
      answer_numbers_not_seen_in_sources: unsupportedNumberTokens,
      answer_numbers_classified_as_computed_from_artifacts: computedNumberTokens,
    },
    quality_evaluation: redactDiagnosticValue(qualityEvaluation),
    claim_ledger: redactDiagnosticValue(claimLedger),
    source_extraction_confidence: redactDiagnosticValue(sourceExtractionConfidence),
    scenario_reproducibility: redactDiagnosticValue(scenarioReproducibility),
  };
}

function buildClientDiagnostics(args: {
  clientMessages: unknown[] | null;
  clientSnapshot: unknown;
  serverMessages: Array<Record<string, unknown>>;
  runIds: Set<string>;
  issues: DiagnosticIssue[];
}): Record<string, unknown> {
  const clientMessages = Array.isArray(args.clientMessages) ? args.clientMessages : [];
  const clientRunIds = clientMessages
    .filter(isRecord)
    .map((message) => typeof message.runId === "string" ? message.runId : typeof message.run_id === "string" ? message.run_id : "")
    .filter(Boolean);
  const unknownClientRunIds = Array.from(new Set(clientRunIds.filter((runId) => !args.runIds.has(runId))));
  if (unknownClientRunIds.length > 0) {
    pushIssue(args.issues, "warn", "client_references_unknown_run_id", "Client chat state references run ids that are not present in server run storage.", {
      run_ids: unknownClientRunIds,
    });
  }

  const serverAssistantByRun = new Map<string, string>();
  for (const message of args.serverMessages) {
    if (message.role === "assistant" && typeof message.runId === "string" && typeof message.content === "string") {
      serverAssistantByRun.set(message.runId, message.content);
    }
  }
  const contentMismatches: Array<Record<string, unknown>> = [];
  for (const message of clientMessages.filter(isRecord)) {
    const runId = typeof message.runId === "string" ? message.runId : typeof message.run_id === "string" ? message.run_id : "";
    if (!runId || message.role !== "assistant" || typeof message.content !== "string") continue;
    const serverContent = serverAssistantByRun.get(runId);
    if (serverContent && serverContent.trim() !== message.content.trim()) {
      contentMismatches.push({
        run_id: runId,
        client_content_preview: compactText(message.content, 1000),
        server_content_preview: compactText(serverContent, 1000),
      });
    }
  }
  if (contentMismatches.length > 0) {
    pushIssue(args.issues, "warn", "client_server_message_mismatch", "Client-rendered assistant content differs from server-reconstructed run content.", {
      mismatches: contentMismatches.slice(0, 8),
    });
  }

  return {
    client_messages_supplied: Array.isArray(args.clientMessages),
    client_message_count: clientMessages.length,
    client_role_counts: roleCounts(clientMessages),
    server_message_count: args.serverMessages.length,
    server_role_counts: roleCounts(args.serverMessages),
    unknown_client_run_ids: unknownClientRunIds,
    content_mismatches: contentMismatches,
    client_snapshot: redactDiagnosticValue(args.clientSnapshot || null),
  };
}

async function buildExportPayload(
  projectId: string,
  clientMessages: unknown[] | null,
  clientSnapshot: unknown,
): Promise<Record<string, unknown> | null> {
  await resumeRunnableAgentRuns(projectId);
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  if (!project) return null;

  const [artifactSummaries, documents, actions, runs] = await Promise.all([
    storage.listArtifacts(projectId),
    storage.listDocuments(projectId),
    storage.listActions(projectId),
    storage.listAgentRuns(projectId),
  ]);

  const artifacts = (await Promise.all(
    artifactSummaries.map((artifact) => storage.getArtifact(projectId, artifact.id)),
  )).filter(Boolean) as Artifact[];
  const runEvents = await Promise.all(
    runs.map(async (run) => ({
      run_id: run.id,
      events: await storage.listAgentEvents(projectId, run.id),
    })),
  );
  const eventsByRun = new Map(runEvents.map((entry) => [entry.run_id, entry.events]));
  const documentsById = new Map(documents.map((doc) => [doc.id, doc]));
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const actionsById = new Map(actions.map((action) => [action.id, action]));
  const issues: DiagnosticIssue[] = [];
  const renderedMessages = serverRenderedMessages(runs, eventsByRun);
  const runIds = new Set(runs.map((run) => run.id));

  const runDiagnostics = runs.map((run) => buildRunDiagnostic({
    run,
    events: eventsByRun.get(run.id) || [],
    documentsById,
    artifactsById,
    actionsById,
    issues,
  }));

  const clientDiagnostics = buildClientDiagnostics({
    clientMessages,
    clientSnapshot,
    serverMessages: renderedMessages,
    runIds,
    issues,
  });

  const failedActions = actions.filter((action) => action.status === "failed");
  for (const action of failedActions) {
    pushIssue(issues, "error", "action_failed", action.error || "Action failed without a saved error message.", {
      action_id: action.id,
      action_type: action.type,
      artifact_id: action.artifact_id,
    });
  }
  const orphanArtifacts = artifacts.filter((artifact) => artifact.action_id && !actionsById.has(artifact.action_id));
  if (orphanArtifacts.length > 0) {
    pushIssue(issues, "info", "artifact_action_not_in_action_storage", "Some artifacts reference action ids that are not present in action storage. This can be expected for run-owned exports, but can also explain missing UI provenance.", {
      artifact_ids: orphanArtifacts.map((artifact) => artifact.id),
      action_ids: orphanArtifacts.map((artifact) => artifact.action_id),
    });
  }

  const issueCounts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {});
  const debugEvents = getDebugLog();
  const toolHealth = buildEnvironmentReadiness();
  const messages = renderedMessages.length > 0
    ? renderedMessages
    : (Array.isArray(clientMessages) ? clientMessages : []);

  return {
    exported_at: now(),
    exergy_lab_version: "1.0",
    export_type: "diagnostic_project_export",
    diagnostic_readme: [
      "This file is intended for troubleshooting workspace rendering and agent behavior.",
      "Start with diagnostics.health and diagnostics.issues.",
      "Use diagnostics.ui_reconstruction to compare server-owned run content against the browser snapshot.",
      "Use diagnostics.run_diagnostics[].source_alignment as a heuristic only: computed values may be absent from source files but present in tool artifacts.",
    ],
    project,
    artifacts,
    documents,
    actions,
    runs,
    run_events: runEvents,
    messages,
    diagnostics: {
      schema_version: 2,
      generated_at: now(),
      tool_health: toolHealth,
      production_readiness: toolHealth.production_readiness,
      health: {
        project_id: projectId,
        run_count: runs.length,
        active_run_count: runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).length,
        waiting_approval_run_count: runs.filter((run) => run.status === "waiting_approval").length,
        failed_run_count: runs.filter((run) => run.status === "failed").length,
        completed_run_count: runs.filter((run) => run.status === "completed").length,
        terminal_run_count: runs.filter((run) => TERMINAL_RUN_STATUSES.has(run.status)).length,
        document_count: documents.length,
        artifact_count: artifacts.length,
        action_count: actions.length,
        failed_action_count: failedActions.length,
        issue_counts: issueCounts,
        latest_run: runs.length > 0 ? {
          id: runs[runs.length - 1].id,
          status: runs[runs.length - 1].status,
          updated_at: runs[runs.length - 1].updated_at,
        } : null,
      },
      issues,
      issue_triage: buildIssueTriage(issues),
      ui_reconstruction: {
        server_rendered_messages: renderedMessages,
        client_vs_server: clientDiagnostics,
      },
      run_diagnostics: runDiagnostics,
      document_diagnostics: documents.map((doc) => ({
        id: doc.id,
        filename: doc.filename,
        status: doc.status,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        uploaded_at: doc.uploaded_at,
        extraction_keys: Object.keys(doc.extraction_result || {}),
        extraction_text_preview: compactText(documentDiagnosticText(doc), 3000),
      })),
      action_diagnostics: actions.map((action) => ({
        id: action.id,
        type: action.type,
        status: action.status,
        trigger: action.trigger,
        artifact_id: action.artifact_id || null,
        parent_artifact_id: action.parent_artifact_id || null,
        created_at: action.created_at,
        completed_at: action.completed_at || null,
        error: action.error || null,
        input_preview: redactDiagnosticValue(action.input || {}),
      })),
      artifact_diagnostics: artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        summary: artifact.summary,
        action_id: artifact.action_id,
        created_at: artifact.created_at,
        content_keys: isRecord(artifact.content) ? Object.keys(artifact.content) : [],
        metadata: redactDiagnosticValue(artifact.metadata || {}),
      })),
      debug_log: {
        summary: getDebugSummary(),
        events: redactDiagnosticValue(debugEvents.slice(-250)),
      },
    },
  };
}

function exportResponse(payload: Record<string, unknown>, projectName: string): NextResponse {
  const filename = `${projectName.replace(/[^a-z0-9]/gi, "_")}_diagnostic_export.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const payload = await buildExportPayload(id, null, null);
  if (!payload) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return exportResponse(payload, (payload.project as { name: string }).name);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let clientMessages: unknown[] | null = null;
  let clientSnapshot: unknown = null;
  try {
    const body = await request.json();
    if (body && Array.isArray(body.messages)) clientMessages = body.messages;
    if (body && "client_snapshot" in body) clientSnapshot = body.client_snapshot;
  } catch (error) {
    console.warn(
      `[export] POST body parse failed for project ${id}; falling back to server-only diagnostics:`,
      error instanceof Error ? error.message : String(error),
    );
  }
  const payload = await buildExportPayload(id, clientMessages, clientSnapshot);
  if (!payload) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return exportResponse(payload, (payload.project as { name: string }).name);
}
