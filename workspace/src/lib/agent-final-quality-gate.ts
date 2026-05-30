import { evaluateAgentQuality, type AgentQualityEvaluationResult } from "@/lib/agent-quality-evaluator";
import { enforceAnswerContract, type AnswerContractResult } from "@/lib/agent-answer-contract";
import {
  buildClaimLedger,
  buildSourceExtractionConfidence,
  documentTextForDiagnostics,
  evaluateScenarioReproducibility,
  type ClaimLedgerResult,
  type ScenarioReproducibilityResult,
  type SourceExtractionDiagnostic,
} from "@/lib/agent-claim-ledger";
import { renderSalientSourceValuesForPrompt } from "@/lib/document-evidence";
import { sanitizeUserFacingAgentText, PUBLIC_AGENT_NAME } from "@/lib/agent-output";
import { callDeepSeekV3, getEnvVar } from "@/lib/backend";
import { getStorage } from "@/lib/storage";
import type { AgentEvent, AgentRun, AgentRunFile, Artifact, Project, ProjectDocument } from "@/lib/storage/types";

export interface FinalQualityGateResult {
  finalAnswer: string;
  repaired: boolean;
  appendedLimitNote: boolean;
  qualityEvaluation: AgentQualityEvaluationResult;
  claimLedger: ClaimLedgerResult;
  sourceExtractionConfidence: SourceExtractionDiagnostic[];
  scenarioReproducibility: ScenarioReproducibilityResult;
  answerContract: Omit<AnswerContractResult, "answer">;
}

const FILE_REQUEST_RE = /\b(export|download|save|convert|csv|xlsx|excel|spreadsheet|pdf|json|markdown|md|file)\b/i;
const TOOL_REQUEST_RE = /\b(simulat|model|calculate|run|analy[sz]e|export|download|research|literature|environmental|economic|physics|solver)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactText(value: unknown, max = 24_000): string {
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

function artifactText(artifact: Artifact | null | undefined): string {
  if (!artifact) return "";
  return [
    artifact.title,
    artifact.summary,
    compactText(artifact.content, 32_000),
    compactText(artifact.metadata, 8_000),
  ].filter(Boolean).join("\n\n");
}

function latestRunCompletedDiagnostics(events: AgentEvent[]): Partial<FinalQualityGateResult> {
  const completed = [...events].reverse().find((event) => event.type === "run.completed" && isRecord(event.data));
  const data = completed?.data || {};
  return {
    qualityEvaluation: isRecord(data.quality_evaluation) ? data.quality_evaluation as unknown as AgentQualityEvaluationResult : undefined,
    claimLedger: isRecord(data.claim_ledger) ? data.claim_ledger as unknown as ClaimLedgerResult : undefined,
    sourceExtractionConfidence: Array.isArray(data.source_extraction_confidence) ? data.source_extraction_confidence as SourceExtractionDiagnostic[] : undefined,
    scenarioReproducibility: isRecord(data.scenario_reproducibility) ? data.scenario_reproducibility as unknown as ScenarioReproducibilityResult : undefined,
  };
}

function shouldRepair(evaluation: AgentQualityEvaluationResult): boolean {
  return evaluation.findings.some((finding) =>
    (finding.severity === "blocker" && finding.type !== "quality_missing_requested_artifact") ||
    finding.type === "quality_malformed_markdown_table" ||
    finding.type === "quality_unsupported_source_number"
  );
}

function fallbackRepairForBlockers(answer: string, evaluation: AgentQualityEvaluationResult): string {
  const blockers = evaluation.findings.filter((finding) => finding.severity === "blocker");
  if (blockers.length === 0) return answer;
  const notes = blockers.map((finding) => `- ${finding.detail}`);
  return [
    answer.trimEnd(),
    "",
    "## Important Limit",
    "",
    "I found an output quality issue before finalizing this answer:",
    ...notes,
    "",
    "Treat the affected part of the result as incomplete until the missing output or placeholder is corrected.",
  ].join("\n");
}

async function repairAnswerWithModel(args: {
  project: Project | null;
  run: AgentRun;
  answer: string;
  sourceTexts: string[];
  artifactTexts: string[];
  evaluation: AgentQualityEvaluationResult;
  claimLedger: ClaimLedgerResult;
}): Promise<string | null> {
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) return null;
  const findingLines = args.evaluation.findings
    .filter((finding) => finding.severity !== "info")
    .map((finding, index) => `Issue ${index + 1}: ${finding.detail}`);
  // A detected-then-rationalized anomaly is rewritten in place: the draft should
  // state the discrepancy is unresolved and what must be confirmed, rather than
  // reconciling it with an unsupplied parameter. This keeps the answer's length
  // and structure intact while removing the false reassurance.
  args.claimLedger.anomaly_flags.forEach((flag, index) => {
    findingLines.push(
      `Anomaly ${index + 1}: ${flag.reason} Rewrite the relevant sentence to say the discrepancy is unresolved and what must be confirmed, without adding a new section or heading. Offending text: "${flag.text}"`,
    );
  });
  const findings = findingLines.join("\n");
  const prompt = [
    `You are ${PUBLIC_AGENT_NAME}'s final answer quality editor.`,
    "Rewrite the answer only if needed to fix the listed quality issues.",
    "Do not add new facts, new numbers, new files, or claims that are not present in source context, tool artifacts, or the draft answer.",
    "Return only the repaired final answer. Do not describe the edit, quality check, warning, or draft answer.",
    "Preserve the draft's useful presentation style. Fix malformed Markdown tables when present, but do not add tables, headings, or sections unless needed to repair a listed quality issue.",
    "Use natural first-person past tense, for example 'I extracted' or 'I ran'. Do not say 'I've already'.",
    "For high-stakes outputs, make support and limits clear in whatever format best fits the answer; do not force a fixed section heading.",
    "Do not reveal model names, provider names, internal event names, claim ledgers, evidence cards, quality finding names, or schema labels.",
    "",
    args.project ? `Project: ${args.project.name}` : "",
    `User request:\n${args.run.user_message}`,
    findings ? `Quality issues to repair:\n${findings}` : "",
    args.sourceTexts.length ? `Source context:\n${args.sourceTexts.join("\n\n").slice(0, 36_000)}` : "Source context: none.",
    args.artifactTexts.length ? `Tool/artifact context:\n${args.artifactTexts.join("\n\n").slice(0, 36_000)}` : "Tool/artifact context: none.",
    `Draft answer:\n${args.answer}`,
  ].filter(Boolean).join("\n\n");

  const repaired = await callDeepSeekV3([{ role: "user", content: prompt }], {
    temperature: 0.1,
    maxTokens: 5200,
    timeoutMs: 20_000,
  }).catch(() => "");
  return typeof repaired === "string" && repaired.trim()
    ? sanitizeUserFacingAgentText(repaired)
    : null;
}

export async function runFinalQualityGate(args: {
  projectId: string;
  run: AgentRun;
  finalAnswer: string;
  patch?: Partial<AgentRun>;
}): Promise<FinalQualityGateResult> {
  const storage = getStorage();
  const [project, allDocs, events] = await Promise.all([
    storage.getProject(args.projectId),
    storage.listDocuments(args.projectId),
    storage.listAgentEvents(args.projectId, args.run.id).catch(() => []),
  ]);
  const prior = latestRunCompletedDiagnostics(events);
  if (
    prior.qualityEvaluation &&
    prior.claimLedger &&
    prior.sourceExtractionConfidence &&
    prior.scenarioReproducibility &&
    sanitizeUserFacingAgentText(args.finalAnswer) === args.run.final_answer
  ) {
    return {
      finalAnswer: sanitizeUserFacingAgentText(args.finalAnswer),
      repaired: false,
      appendedLimitNote: false,
      qualityEvaluation: prior.qualityEvaluation,
      claimLedger: prior.claimLedger,
      sourceExtractionConfidence: prior.sourceExtractionConfidence,
      scenarioReproducibility: prior.scenarioReproducibility,
      answerContract: {
        highStakes: false,
        numericOrModeling: false,
        supportLimitsAdded: false,
        structureAdded: false,
        sourceValueTableAdded: false,
        scenarioSectionAdded: false,
        executionStatus: "unknown",
        sourceValues: [],
      },
    };
  }

  const attachmentIds = new Set(args.run.attachment_document_ids || []);
  const docs = allDocs.filter((doc) => attachmentIds.has(doc.id));
  const artifactIds = Array.from(new Set([...(args.run.artifact_ids || []), ...(args.patch?.artifact_ids || [])]));
  const artifacts = (await Promise.all(artifactIds.map((artifactId) => storage.getArtifact(args.projectId, artifactId))))
    .filter((artifact): artifact is Artifact => !!artifact);
  const sourceTexts = [
    args.run.user_message,
    renderSalientSourceValuesForPrompt(docs, 18),
    ...docs.map(documentTextForDiagnostics),
  ].filter((text) => text.trim());
  const artifactTexts = artifacts.map(artifactText).filter((text) => text.trim());
  const files = [
    ...(args.run.files || []),
    ...((args.patch?.files || []) as AgentRunFile[]),
  ];

  let clean = sanitizeUserFacingAgentText(args.finalAnswer);
  const contracted = enforceAnswerContract({
    prompt: args.run.user_message,
    answer: clean,
    documents: docs,
    artifactTexts,
    artifacts,
    files,
    events,
    followup: Boolean(args.run.parent_run_id),
  });
  clean = sanitizeUserFacingAgentText(contracted.answer);

  let qualityEvaluation = evaluateAgentQuality({
    prompt: args.run.user_message,
    finalAnswer: clean,
    sourceTexts: [...sourceTexts, ...artifactTexts],
    files,
    events,
    requiresTool: TOOL_REQUEST_RE.test(args.run.user_message) || artifactTexts.length > 0,
    requiresFiles: FILE_REQUEST_RE.test(args.run.user_message),
    followup: Boolean(args.run.parent_run_id),
  });
  let claimLedger = buildClaimLedger({ finalAnswer: clean, sourceTexts, artifactTexts });
  const sourceExtractionConfidence = buildSourceExtractionConfidence(docs);
  let scenarioReproducibility = evaluateScenarioReproducibility({
    prompt: args.run.user_message,
    finalAnswer: clean,
    artifactTexts,
  });

  let repaired = false;
  if (shouldRepair(qualityEvaluation) || claimLedger.anomaly_flags.length > 0) {
    const modelRepair = await repairAnswerWithModel({
      project,
      run: args.run,
      answer: clean,
      sourceTexts,
      artifactTexts,
      evaluation: qualityEvaluation,
      claimLedger,
    });
    if (modelRepair) {
      clean = sanitizeUserFacingAgentText(modelRepair);
      repaired = true;
    } else {
      clean = sanitizeUserFacingAgentText(fallbackRepairForBlockers(clean, qualityEvaluation));
    }
    clean = sanitizeUserFacingAgentText(enforceAnswerContract({
      prompt: args.run.user_message,
      answer: clean,
      documents: docs,
      artifactTexts,
      artifacts,
      files,
      events,
      followup: Boolean(args.run.parent_run_id),
    }).answer);
    qualityEvaluation = evaluateAgentQuality({
      prompt: args.run.user_message,
      finalAnswer: clean,
      sourceTexts: [...sourceTexts, ...artifactTexts],
      files,
      events,
      requiresTool: TOOL_REQUEST_RE.test(args.run.user_message) || artifactTexts.length > 0,
      requiresFiles: FILE_REQUEST_RE.test(args.run.user_message),
      followup: Boolean(args.run.parent_run_id),
    });
    claimLedger = buildClaimLedger({ finalAnswer: clean, sourceTexts, artifactTexts });
    scenarioReproducibility = evaluateScenarioReproducibility({
      prompt: args.run.user_message,
      finalAnswer: clean,
      artifactTexts,
    });
  }

  return {
    finalAnswer: clean,
    repaired,
    appendedLimitNote: contracted.supportLimitsAdded,
    qualityEvaluation,
    claimLedger,
    sourceExtractionConfidence,
    scenarioReproducibility,
    answerContract: {
      highStakes: contracted.highStakes,
      numericOrModeling: contracted.numericOrModeling,
      supportLimitsAdded: contracted.supportLimitsAdded,
      structureAdded: contracted.structureAdded,
      sourceValueTableAdded: contracted.sourceValueTableAdded,
      scenarioSectionAdded: contracted.scenarioSectionAdded,
      executionStatus: contracted.executionStatus,
      sourceValues: contracted.sourceValues,
    },
  };
}
