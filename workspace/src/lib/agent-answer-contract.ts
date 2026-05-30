import { extractNumericEvidence } from "@/lib/agent-quality-evaluator";
import { buildSalientSourceValues, type SalientSourceValue } from "@/lib/document-evidence";
import type { AgentEvent, AgentRunFile, Artifact, ProjectDocument } from "@/lib/storage/types";

export interface AnswerContractInput {
  prompt: string;
  answer: string;
  documents?: ProjectDocument[];
  artifactTexts?: string[];
  artifacts?: Artifact[];
  files?: AgentRunFile[];
  events?: AgentEvent[];
  followup?: boolean;
}

export interface AnswerContractResult {
  answer: string;
  highStakes: boolean;
  numericOrModeling: boolean;
  supportLimitsAdded: boolean;
  structureAdded: boolean;
  sourceValueTableAdded: boolean;
  scenarioSectionAdded: boolean;
  executionStatus: "verified" | "best_effort" | "not_executed" | "unknown";
  sourceValues: SalientSourceValue[];
}

const HIGH_STAKES_RE =
  /\b(engineer|technical|techno-?economic|financial|finance|screen(?:ing)?|safety|permitting?|permit|emissions?|environmental|compliance|reliability|document-backed|uploaded|attached|file|csv|pdf|scenario|sensitivity|export|analysis|assess|evaluate|model|simulate|calculation|recommend|decision|capex|opex|npv|irr|payback|lcoe|lcoh|lcos|physics|thermal|grid|interconnection|risk)\b/i;

const LOW_STAKES_RE =
  /\b(define|what is|one sentence|briefly explain|conceptual only|no calculation|no files?|no analysis)\b/i;

// A follow-up re-triggers any heavier treatment only when it is itself a new
// modeling/calculation/analysis request — a simple question or a plain
// file-generation ask is answered directly.
const FOLLOWUP_HEAVY_RE =
  /\b(model|simulate|simulation|calculate|recalculate|recompute|compute|scenario|sensitivity|optimi[sz]e|techno-?economic|feasibility|payback|lcoe|lcoh|lcos|npv|irr|sizing|re-?run|full (?:analysis|assessment))\b/i;

const NUMERIC_MODEL_RE =
  /\b(model|simulate|simulation|calculate|calculation|scenario|sensitivity|compare|economic|finance|capex|opex|npv|irr|payback|lcoe|lcoh|lcos|emissions?|co2|performance|efficiency|capacity|throughput|energy|heat|mass|flow|pressure|temperature|cost|price|roi|table)\b/i;

// The answer already acknowledges its own limits, so no extra note is needed.
const ALREADY_HEDGED_RE =
  /\b(best[- ]effort|screening[- ]level|could not (?:be )?verif|did not (?:fully )?(?:verify|finish)|not executed|treat .* as (?:an )?estimate)\b/i;

function clean(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function isHighStakesPrompt(prompt: string, opts: { hasDocuments?: boolean; hasFiles?: boolean; followup?: boolean } = {}): boolean {
  // Judge a follow-up on its own request so heavier handling is not repeated for
  // a simple question or a plain file-generation ask.
  if (opts.followup) return FOLLOWUP_HEAVY_RE.test(prompt);
  if (opts.hasDocuments || opts.hasFiles) return true;
  if (LOW_STAKES_RE.test(prompt) && !NUMERIC_MODEL_RE.test(prompt)) return false;
  return HIGH_STAKES_RE.test(prompt);
}

export function isNumericOrModelingPrompt(prompt: string, answer = ""): boolean {
  if (NUMERIC_MODEL_RE.test(prompt)) return true;
  const numbers = extractNumericEvidence(answer, 20);
  return numbers.length >= 3 && NUMERIC_MODEL_RE.test(answer);
}

function latestToolEventStatus(events: AgentEvent[] = []): "completed" | "failed" | null {
  const toolEvents = events
    .filter((event) => event.type === "tool.completed" || event.type === "tool.failed")
    .sort((a, b) => a.sequence - b.sequence);
  const latest = toolEvents[toolEvents.length - 1];
  if (!latest) return null;
  return latest.type === "tool.completed" ? "completed" : "failed";
}

function executionStatus(input: AnswerContractInput): AnswerContractResult["executionStatus"] {
  const latestToolStatus = latestToolEventStatus(input.events);
  if (latestToolStatus === "completed") return "verified";
  if (latestToolStatus === "failed") return "best_effort";

  const text = [
    input.answer,
    ...(input.artifactTexts || []),
    ...(input.artifacts || []).map((artifact) => JSON.stringify(artifact.content || {})),
  ].join("\n");
  if (/\b(completed_with_limitations|best[- ]effort|tool_execution_completed"?\s*:\s*false|could not complete|did not finish cleanly|exit code [1-9])\b/i.test(text)) {
    return "best_effort";
  }
  if (/\b(workspace|tool|script|simulation|model|calculation)\s+(?:completed|ran|created|generated|executed)|tool_execution_completed"?\s*:\s*true/i.test(text)) {
    return "verified";
  }
  if (/\b(no executable|not executed|did not run|without a tool)\b/i.test(text)) return "not_executed";
  return "unknown";
}

/**
 * Answer-first contract.
 *
 * Credibility comes from a correct, direct answer — not from a fixed scaffold of
 * "Source-Backed Inputs", "Calculation Basis", scenario tables, "Support and
 * Limits", or "Downloads". So this no longer appends any of that structure. The
 * model is trusted to weave the few caveats that actually change the decision
 * into prose. The only thing added here is a single short, honest note when the
 * underlying work could not be verified — because that is about correctness, not
 * a gratuitous list of what was not done.
 */
export function enforceAnswerContract(input: AnswerContractInput): AnswerContractResult {
  const answer0 = clean(input.answer);
  const sourceValues = buildSalientSourceValues(input.documents || [], 18);
  const highStakes = isHighStakesPrompt(input.prompt, {
    hasDocuments: Boolean(input.documents?.length),
    hasFiles: Boolean(input.files?.length),
    followup: input.followup,
  });
  const numericOrModeling = isNumericOrModelingPrompt(input.prompt, answer0);
  const status = executionStatus(input);

  let answer = answer0;
  let supportLimitsAdded = false;
  if ((status === "best_effort" || status === "not_executed") && highStakes && answer0 && !ALREADY_HEDGED_RE.test(answer0)) {
    const note = status === "best_effort"
      ? "_A tool step did not fully verify, so treat the affected numbers as best-effort pending a clean rerun._"
      : "_This is a screening-level estimate; no executable calculation backed it._";
    answer = `${answer0.trimEnd()}\n\n${note}`;
    supportLimitsAdded = true;
  }

  return {
    answer,
    highStakes,
    numericOrModeling,
    supportLimitsAdded,
    structureAdded: false,
    sourceValueTableAdded: false,
    scenarioSectionAdded: false,
    executionStatus: status,
    sourceValues,
  };
}
