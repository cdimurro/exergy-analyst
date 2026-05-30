import { extractNumericEvidence } from "@/lib/agent-quality-evaluator";
import {
  buildSalientSourceValues,
  renderSalientSourceValuesTable,
  type SalientSourceValue,
} from "@/lib/document-evidence";
import { requiresScenarioReproducibilityPrompt } from "@/lib/scenario-reproducibility";
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

const NUMERIC_MODEL_RE =
  /\b(model|simulate|simulation|calculate|calculation|scenario|sensitivity|compare|economic|finance|capex|opex|npv|irr|payback|lcoe|lcoh|lcos|emissions?|co2|performance|efficiency|capacity|throughput|energy|heat|mass|flow|pressure|temperature|cost|price|roi|table)\b/i;

const SUPPORT_LIMITS_HEADING_RE = /^#{1,3}\s+Support (?:and|&) Limits\b/im;
const TABLE_RE = /^\s*\|.+\|\s*$/m;
const BASIS_RE = /\b(formula|equation|calculated as|calculation basis|model basis|derived from|computed as|=)\b/i;
const DOWNLOADS_HEADING_RE = /^downloads\s*$/i;

function clean(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function isHighStakesPrompt(prompt: string, opts: { hasDocuments?: boolean; hasFiles?: boolean; followup?: boolean } = {}): boolean {
  if (opts.hasDocuments || opts.hasFiles || opts.followup) return true;
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

function hadRecoveredToolFailure(input: AnswerContractInput): boolean {
  const events = input.events || [];
  const latestCompletedSequence = [...events].reverse().find((event) => event.type === "tool.completed")?.sequence ?? null;
  if (latestCompletedSequence === null) return false;
  return events.some((event) => event.type === "tool.failed" && event.sequence < latestCompletedSequence);
}

function missingInputs(documents: ProjectDocument[] = []): string[] {
  const values = documents.flatMap((doc) => {
    const digest = doc.extraction_result?.document_evidence;
    if (!digest || typeof digest !== "object" || Array.isArray(digest)) return [];
    const missing = (digest as { missing_inputs?: unknown }).missing_inputs;
    return Array.isArray(missing) ? missing.filter((item): item is string => typeof item === "string") : [];
  });
  return Array.from(new Set(values.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, 4);
}

function supportLimitsSection(input: AnswerContractInput, values: SalientSourceValue[], status: AnswerContractResult["executionStatus"]): string {
  const missing = missingInputs(input.documents);
  const hasDocs = Boolean(input.documents?.length);
  const hasFiles = Boolean(input.files?.length);
  const dataSupport = hasDocs
    ? `A screening-level answer using the uploaded source evidence${values.length ? `, including ${values.slice(0, 4).map((item) => `${item.label} ${item.raw}${item.unit ? ` ${item.unit}` : ""}`).join("; ")}` : ""}.`
    : hasFiles
      ? "A bounded answer from the completed tool outputs and generated files."
      : "A bounded answer from the provided prompt and available workspace context.";
  const resultStatus =
    status === "verified" && hadRecoveredToolFailure(input) ? "Verified after recovery: final executable/tool output completed; earlier failed attempts are not treated as final results."
      : status === "verified" ? "Verified executable/tool output was available for the answer."
      : status === "best_effort" ? "Best-effort: useful output was preserved, but executable verification did not fully pass."
        : status === "not_executed" ? "Screening-level only: no executable calculation was completed."
          : "Screening-level unless a referenced artifact explicitly verifies the calculation.";
  return [
    "## Support and Limits",
    "",
    "| Item | Status |",
    "|---|---|",
    `| What the data supports | ${dataSupport.replace(/\|/g, "/")} |`,
    "| What it does not prove | Field performance, safety, permitting approval, financeability, compliance, reliability, or commercial readiness without independent validation. |",
    `| Missing inputs | ${(missing.length ? missing.join("; ") : "Site-specific measurements, boundary conditions, validation data, and decision-owner assumptions may still be needed.").replace(/\|/g, "/")} |`,
    `| Result status | ${resultStatus} |`,
    `| Calculation execution | ${status.replace(/_/g, " ")} |`,
  ].join("\n");
}

function supportLimitsContractComplete(answer: string): boolean {
  if (!SUPPORT_LIMITS_HEADING_RE.test(answer)) return false;
  const required = [
    /\bwhat the data supports\b/i,
    /\bwhat it does not prove\b/i,
    /\bmissing inputs?\b/i,
    /\bresult status\b/i,
    /\bcalculation execution\b/i,
  ];
  return required.every((pattern) => pattern.test(answer));
}

function supportLimitsSectionCount(answer: string): number {
  return answer.match(/^#{1,3}\s+Support (?:and|&) Limits\b/gim)?.length || 0;
}

function supportLimitsStatusConflicts(answer: string, status: AnswerContractResult["executionStatus"]): boolean {
  if (!SUPPORT_LIMITS_HEADING_RE.test(answer)) return false;
  if (status === "verified") {
    return /\b(executable verification did not fully pass|not executed|no executable calculation was completed)\b/i.test(answer);
  }
  if (status === "best_effort") {
    return /\bcalculations executed successfully\s*:\s*yes\b|\bverified executable\/tool output was available\b/i.test(answer);
  }
  return false;
}

function stripSupportLimitsSections(answer: string): string {
  const lines = answer.split("\n");
  const kept: string[] = [];
  let skipping = false;
  let skippedAny = false;
  for (const line of lines) {
    if (/^#{1,3}\s+Support (?:and|&) Limits\b/i.test(line)) {
      skipping = true;
      skippedAny = true;
      continue;
    }
    if (skipping) {
      if (/^#{1,3}\s+\S/.test(line) || DOWNLOADS_HEADING_RE.test(line.trim())) {
        skipping = false;
        kept.push(line);
      }
      continue;
    }
    kept.push(line);
  }
  return skippedAny ? kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() : answer;
}

function appendSupportLimitsSection(answer: string, section: string): string {
  const lines = answer.split("\n");
  const downloadsIndex = lines.findIndex((line) => DOWNLOADS_HEADING_RE.test(line.trim()));
  if (downloadsIndex < 0) return [answer.trimEnd(), section].filter(Boolean).join("\n\n");
  const before = lines.slice(0, downloadsIndex).join("\n").trimEnd();
  const after = lines.slice(downloadsIndex).join("\n").trimStart();
  return [before, section, after].filter(Boolean).join("\n\n");
}

function keyValuesTable(answer: string): string {
  const values = extractNumericEvidence(answer, 8);
  if (values.length === 0) return "";
  return [
    "## Key Values",
    "",
    "| Value | Unit | Context |",
    "|---:|---|---|",
    ...values.map((item) => `| ${item.raw} | ${item.unit || "-"} | ${item.context.replace(/\|/g, "/").slice(0, 130)} |`),
  ].join("\n");
}

function calculationBasisSection(answer: string): string {
  if (BASIS_RE.test(answer)) return "";
  return [
    "## Calculation Basis",
    "",
    "| Element | Basis |",
    "|---|---|",
    "| Source values | Taken from the uploaded evidence or stated prompt inputs where available. |",
    "| Derived values | Computed by the selected tool or from explicit arithmetic shown in the answer; treat as screening-level unless execution is marked verified. |",
    "| Assumptions | Kept separate from source values and should be replaced with measured or contract values before decisions. |",
  ].join("\n");
}

function scenarioSection(answer: string): string {
  if (/\b(changed inputs?|held[- ]constant|unchanged|assumption drift|base[- ]case|prior run)\b/i.test(answer) && /\|.*(?:scenario|case|base|changed|constant).*\|/i.test(answer)) {
    return "";
  }
  return [
    "## Scenario Reproducibility",
    "",
    "| Requirement | Status |",
    "|---|---|",
    "| Changed inputs | State the changed variable(s) explicitly in the scenario table. |",
    "| Held constants | All other assumptions should remain fixed unless listed as changed. |",
    "| Base reference | Compare against the prior/base run or source case used for the original result. |",
    "| Assumption drift check | Re-check that production basis, utilization, boundaries, and prices did not change unintentionally. |",
  ].join("\n");
}

export function enforceAnswerContract(input: AnswerContractInput): AnswerContractResult {
  let answer = clean(input.answer);
  const sourceValues = buildSalientSourceValues(input.documents || [], 18);
  const highStakes = isHighStakesPrompt(input.prompt, {
    hasDocuments: Boolean(input.documents?.length),
    hasFiles: Boolean(input.files?.length),
    followup: input.followup,
  });
  const numericOrModeling = isNumericOrModelingPrompt(input.prompt, answer);
  const status = executionStatus(input);
  let supportLimitsAdded = false;
  let structureAdded = false;
  let sourceValueTableAdded = false;
  let scenarioSectionAdded = false;

  const additions: string[] = [];
  if (numericOrModeling && !TABLE_RE.test(answer)) {
    const table = keyValuesTable(answer);
    if (table) {
      additions.push(table);
      structureAdded = true;
    }
  }
  if (numericOrModeling && sourceValues.length > 0 && !/\b(source-backed inputs?|source values?|input summary)\b/i.test(answer)) {
    additions.push(["## Source-Backed Input Summary", "", renderSalientSourceValuesTable(sourceValues, 10)].join("\n"));
    sourceValueTableAdded = true;
    structureAdded = true;
  }
  if (numericOrModeling) {
    const basis = calculationBasisSection(answer);
    if (basis) {
      additions.push(basis);
      structureAdded = true;
    }
  }
  if (requiresScenarioReproducibilityPrompt(input.prompt)) {
    const scenario = scenarioSection(answer);
    if (scenario) {
      additions.push(scenario);
      scenarioSectionAdded = true;
      structureAdded = true;
    }
  }
  if (additions.length) {
    answer = [answer, ...additions].join("\n\n");
  }
  const needsSupportLimitsRepair = highStakes && (
    !supportLimitsContractComplete(answer) ||
    supportLimitsSectionCount(answer) > 1 ||
    supportLimitsStatusConflicts(answer, status)
  );
  if (needsSupportLimitsRepair) {
    answer = appendSupportLimitsSection(
      stripSupportLimitsSections(answer),
      supportLimitsSection(input, sourceValues, status),
    );
    supportLimitsAdded = true;
  }
  return {
    answer,
    highStakes,
    numericOrModeling,
    supportLimitsAdded,
    structureAdded,
    sourceValueTableAdded,
    scenarioSectionAdded,
    executionStatus: status,
    sourceValues,
  };
}
