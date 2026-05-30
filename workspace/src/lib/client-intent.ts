import type { InitialEvaluationProjectState } from "@/lib/initial-evaluation-guardrail";

export type ClientPrimaryIntent =
  | "client_advisory"
  | "report_export"
  | "chart_package"
  | "bankability"
  | "physics_exergy"
  | "evidence_recovery"
  | "research"
  | "evaluation_plan"
  | "general";

export type ClientAudience =
  | "executive"
  | "board"
  | "investor"
  | "customer"
  | "lender"
  | "sales"
  | "internal"
  | "technical"
  | "unknown";

export type ClientArtifactRequest =
  | "none"
  | "report"
  | "memo"
  | "diligence_note"
  | "investor_memo"
  | "customer_summary"
  | "one_pager"
  | "deck"
  | "pdf_export"
  | "json_export";

export type ClientChartRequest = "none" | "package_plan" | "data_requirements" | "generate_from_artifacts";
export type ClientCalculationRequest = "none" | "finance_metrics" | "solver_validation" | "exergy_efficiency" | "chart_values";
export type ClientEvidenceState = "no_docs" | "docs_no_eval" | "failed_extraction" | "partial_extraction" | "evaluation_ready" | "chartable_artifact";
export type ClientExtractionState = NonNullable<InitialEvaluationProjectState["extractionStatus"]>;
export type ClientSharingContext = "none" | "external" | "customer_safe" | "investor_ready" | "internal_only" | "data_room";
export type ClientClaimBoundaryContext = "neutral" | "claim_safety" | "unsupported_claims" | "adversarial_readiness";
export type ClientFollowupContext = "none" | "inherits_audience" | "inherits_claim_boundary" | "inherits_artifact" | "inherits_evidence_request";
export type ClientOutputStyle = "default" | "plain_language" | "one_paragraph" | "memo" | "board_language";
export type ClientMissingDataSensitivity = "low" | "medium" | "high";
export type ClientTruthfulnessRisk = "low" | "medium" | "high";
export type ClientWorkflowMode = "direct_answer" | "plan_request" | "plan_and_execute";
export type ClientTaskKind =
  | "direct_answer"
  | "evidence_extraction"
  | "claim_review"
  | "report_memo_generation"
  | "chart_package"
  | "bankability_economics"
  | "physics_exergy_review"
  | "multi_artifact_workflow"
  | "attachment_grounded"
  | "conflicting_evidence"
  | "simple_followup";

export interface ClientIntent {
  primaryIntent: ClientPrimaryIntent;
  secondaryIntents: ClientPrimaryIntent[];
  audience: ClientAudience;
  artifactRequest: ClientArtifactRequest;
  chartRequest: ClientChartRequest;
  calculationRequest: ClientCalculationRequest;
  evidenceState: ClientEvidenceState;
  extractionState: ClientExtractionState;
  sharingContext: ClientSharingContext;
  claimBoundaryContext: ClientClaimBoundaryContext;
  domainHint: string | null;
  followupContext: ClientFollowupContext;
  requestedOutputStyle: ClientOutputStyle;
  missingDataSensitivity: ClientMissingDataSensitivity;
  truthfulnessRisk: ClientTruthfulnessRisk;
  workflowMode: ClientWorkflowMode;
  taskKinds: ClientTaskKind[];
  attachmentGrounded: boolean;
  conflictingEvidence: boolean;
  simpleFollowup: boolean;
  matchedSignals: string[];
}

export interface ClassifyClientIntentArgs {
  message: string | null | undefined;
  state: InitialEvaluationProjectState;
  project?: {
    domain?: string | null;
    description?: string | null;
    name?: string | null;
  } | null;
  history?: Array<{ role?: string; content?: string }> | null;
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function pushSignal(signals: string[], condition: boolean, signal: string): void {
  if (condition) signals.push(signal);
}

function evidenceStateFor(state: InitialEvaluationProjectState): ClientEvidenceState {
  if (state.hasChartableArtifact) return "chartable_artifact";
  if (state.hasSuccessfulEvaluationArtifact) return "evaluation_ready";
  if (state.extractionStatus === "failed") return "failed_extraction";
  if (state.extractionStatus === "partial") return "partial_extraction";
  if (state.hasUploadedDocuments) return "docs_no_eval";
  return "no_docs";
}

function extractionStateFor(state: InitialEvaluationProjectState): ClientExtractionState {
  return state.extractionStatus || "none";
}

function classifyAudience(text: string, inherited: ClientAudience): ClientAudience {
  if (has(text, /\b(board|directors?)\b/i)) return "board";
  if (has(text, /\b(ceo|executive|leadership)\b/i)) return "executive";
  if (has(text, /\b(investor|investment\s+committee|ic\b|fundraise|partner\s+update)\b/i)) return "investor";
  if (has(text, /\b(lender|bank|debt|credit\s+committee|project\s+finance)\b/i)) return "lender";
  if (has(text, /\b(customer|client|buyer|counterparty)\b/i)) return "customer";
  if (has(text, /\b(sales|outbound|commercial\s+team)\b/i)) return "sales";
  if (has(text, /\b(technical\s+lead|engineering|scientist|solver|physics)\b/i)) return "technical";
  if (has(text, /\b(internal|diligence\s+team|private|inside)\b/i)) return "internal";
  return inherited;
}

function classifyArtifactRequest(text: string): ClientArtifactRequest {
  if (has(text, /\bjson\s+export\b/i)) return "json_export";
  if (has(text, /\b(pdf|export\s+report|download\s+report)\b/i)) return "pdf_export";
  if (has(text, /\b(investor\s+memo|investor[\s-]?ready|investor[\s-]?safe)\b/i)) return "investor_memo";
  if (has(text, /\b(customer[\s-]?safe\s+(summary|memo|report|version|one[\s-]?pager)|make\s+(?:it|this)\s+customer[\s-]?safe|safe\s+(?:for|to\s+send\s+to)\s+(?:a\s+)?customer)\b/i)) return "customer_summary";
  if (has(text, /\bone[\s-]?pager\b/i)) return "one_pager";
  if (has(text, /\b(deck|slide|packet)\b/i)) return "deck";
  if (has(text, /\bdiligence\s+(memo|note)\b/i)) return "diligence_note";
  if (has(text, /\bmemo\b/i)) return "memo";
  if (has(text, /\b(report|brief|document)\b/i)) return "report";
  return "none";
}

function classifyChartRequest(text: string, state: InitialEvaluationProjectState): ClientChartRequest {
  if (!has(text, /\b(charts?|graphs?|plots?|visuali[sz]ations?|figures?|dashboards?|tables?)\b/i)) {
    return "none";
  }
  if (has(text, /\b(blocked|missing|what\s+data|which\s+charts?|data\s+owner|owner\s+should|input|wait\s+for\s+data|blocked\s+and\s+why)\b/i)) {
    return "data_requirements";
  }
  if (state.hasChartableArtifact || state.hasSuccessfulEvaluationArtifact) {
    return "generate_from_artifacts";
  }
  return "package_plan";
}

function classifyCalculationRequest(text: string): ClientCalculationRequest {
  if (has(text, /\b(npv|irr|payback|lcoe|lcos|lcof|bankability|bankable|finance|financial|economics?|cost\s+model|capex|opex|wacc)\b/i)) {
    return "finance_metrics";
  }
  if (has(text, /\b(exergy|second[\s-]?law|exergetic)\b/i)) return "exergy_efficiency";
  if (has(text, /\b(solver|simulate|simulation|model[-\s]?backed|solver[-\s]?backed)\b/i)) return "solver_validation";
  if (has(text, /\b(chart|graph|plot|figure)\b.*\b(value|metric|number|data)\b/i)) return "chart_values";
  return "none";
}

function classifySharingContext(text: string): ClientSharingContext {
  if (has(text, /\b(customer[\s-]?safe|safe\s+for\s+(?:a\s+)?customer|sent\s+to\s+(?:a\s+)?customer)\b/i)) return "customer_safe";
  if (has(text, /\b(investor[\s-]?ready|investor[\s-]?safe|send\s+to\s+investors?|investor\s+outreach)\b/i)) return "investor_ready";
  if (has(text, /\b(data[\s-]?room|diligence\s+room)\b/i)) return "data_room";
  if (has(text, /\b(stay\s+(?:private|internal|inside)|remain\s+internal|internal[\s-]?only|hold\s+back)\b/i)) return "internal_only";
  if (has(text, /\b(outside|external|externally|publicly|share|send|customer|client|counterparty|sales)\b/i)) return "external";
  return "none";
}

function classifyClaimBoundary(text: string): ClientClaimBoundaryContext {
  if (has(text, /\b(what\s+not\s+to\s+claim|should\s+not\s+(?:claim|say)|avoid\s+claiming|unsupported\s+claims?|overclaim(?:ing)?|claim\s+boundary|responsibly\s+say|safe\s+to\s+say|what\s+is\s+safe)\b/i)) {
    return "unsupported_claims";
  }
  if (has(text, /\b(without\s+caveats|do\s+not\s+(?:mention|include)\s+caveats|confident|bullish|ready\s+for\s+project\s+finance|investor[\s-]?ready|lender[\s-]?ready)\b/i)) {
    return "adversarial_readiness";
  }
  if (has(text, /\b(customer[\s-]?safe|investor[\s-]?safe|safe\s+version|safe\s+for|responsibly\s+say)\b/i)) {
    return "claim_safety";
  }
  return "neutral";
}

function classifyStyle(text: string): ClientOutputStyle {
  if (has(text, /\b(one\s+careful\s+paragraph|one\s+paragraph|single\s+paragraph)\b/i)) return "one_paragraph";
  if (has(text, /\b(board\s+language|board[-\s]?level)\b/i)) return "board_language";
  if (has(text, /\b(memo|diligence\s+note|report\s+outline)\b/i)) return "memo";
  if (has(text, /\b(no\s+platform|no\s+workflow|without\s+platform\s+words|plain\s+english|no\s+internal\s+status|practical\s+recommendation|just\s+tell\s+me\s+what\s+matters|diligence\s+lead)\b/i)) {
    return "plain_language";
  }
  return "default";
}

function classifyPrimary(text: string, args: {
  artifactRequest: ClientArtifactRequest;
  chartRequest: ClientChartRequest;
  calculationRequest: ClientCalculationRequest;
  sharingContext: ClientSharingContext;
  claimBoundaryContext: ClientClaimBoundaryContext;
}): ClientPrimaryIntent {
  if (has(text, /\b(plan|work[\s-]?plan|execution\s+plan|editable\s+plan)\b/i)) return "evaluation_plan";
  if (has(text, /\b(literature|papers?|published\s+(?:data|benchmark|evidence)|research|sources?)\b/i)) return "research";
  if (args.chartRequest !== "none") return "chart_package";
  if (args.artifactRequest !== "none" && has(text, /\b(report|memo|diligence\s+note|brief|one[\s-]?pager|deck|pdf|json|export|client[\s-]?ready|investor[\s-]?ready|customer[\s-]?safe|safe\s+to\s+send|safe\s+for\s+(?:a\s+)?customer)\b/i)) {
    return "report_export";
  }
  if (has(text, /\b(evidence|data\s+room|source\s+(?:pages?|tables?|sections?)|test\s+records?|minimum\s+viable\s+evidence|collect|request|what\s+should\s+(?:i|we)\s+ask|extraction\s+(?:failed|did\s+not\s+work|didn't\s+work)|rank\s+evidence)\b/i)) {
    return "evidence_recovery";
  }
  if (args.calculationRequest === "finance_metrics") return "bankability";
  if (args.calculationRequest === "exergy_efficiency" || args.calculationRequest === "solver_validation") return "physics_exergy";
  if (args.sharingContext !== "none" || args.claimBoundaryContext !== "neutral") return "client_advisory";
  if (has(text, /\b(takeaway|what\s+can\s+(?:i|we)\s+say|what\s+matters|decision|recommendation|ceo|board|executive)\b/i)) {
    return "client_advisory";
  }
  return "general";
}

function isAttachmentGroundedRequest(text: string, state: InitialEvaluationProjectState): boolean {
  return !!state.hasUploadedDocuments || has(text, /\b(uploaded|attached|attachments?|files?|documents?|deck|test\s+report|cost\s+model|operating\s+data|data\s+table|evidence\s+bundle)\b/i);
}

function isConflictingEvidenceRequest(text: string, state: InitialEvaluationProjectState): boolean {
  void state;
  return has(text, /\b(conflict(?:ing)?(?:\s+evidence)?|conflict\s+map|contradict(?:ed|ion|ory)?\s+evidence|deck\s+says|but\s+the\s+test\s+report)\b/i);
}

function isSimpleFollowup(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 12) return false;
  const conciseMemoRecommendation = has(text, /\bwhat\s+should\s+(?:the\s+)?(?:memo|brief|report)\s+recommend\b/i);
  return /^(can|what|which|is|are|should|could|would|do|does)\b/i.test(text) &&
    (conciseMemoRecommendation ||
      !has(text, /\b(build|create|make|compare|extract|review|memo|package|plan-and-execute|plan\s+and\s+execute|diligence\s+plan)\b/i));
}

function classifyWorkflowMode(text: string, taskKinds: ClientTaskKind[], simpleFollowup: boolean): ClientWorkflowMode {
  if (simpleFollowup) return "direct_answer";
  const substantiveTaskCount = taskKinds.filter((kind) =>
    kind !== "attachment_grounded" &&
    kind !== "direct_answer" &&
    kind !== "simple_followup"
  ).length;
  if (
    taskKinds.includes("multi_artifact_workflow") ||
    substantiveTaskCount >= 3 ||
    has(text, /\b(plan-and-execute|plan\s+and\s+execute)\b/i) ||
    (substantiveTaskCount > 0 &&
      has(text, /\b(build|create|compare|extract|review|flag|tell me what to do next)\b/i) &&
      taskKinds.includes("attachment_grounded"))
  ) {
    return "plan_and_execute";
  }
  if (has(text, /\b(plan|work[\s-]?plan|diligence\s+plan|execution\s+plan|workflow)\b/i)) return "plan_request";
  return "direct_answer";
}

function classifyTaskKinds(args: {
  text: string;
  primaryIntent: ClientPrimaryIntent;
  chartRequest: ClientChartRequest;
  calculationRequest: ClientCalculationRequest;
  artifactRequest: ClientArtifactRequest;
  attachmentGrounded: boolean;
  conflictingEvidence: boolean;
  simpleFollowup: boolean;
}): ClientTaskKind[] {
  const kinds: ClientTaskKind[] = [];
  if (args.simpleFollowup) kinds.push("simple_followup", "direct_answer");
  if (args.attachmentGrounded) kinds.push("attachment_grounded");
  if (args.conflictingEvidence) kinds.push("conflicting_evidence");
  if (has(args.text, /\b(extract|key claims?|what can be charted|source labels?|evidence)\b/i)) kinds.push("evidence_extraction");
  if (has(args.text, /\b(unsupported|contradicted|supported|claim review|compare\b.*\bdeck|flag\b.*\bclaims?)\b/i)) kinds.push("claim_review");
  if (args.artifactRequest !== "none" || args.primaryIntent === "report_export" || has(args.text, /\b(memo|report|summary|deck|one[\s-]?pager)\b/i)) kinds.push("report_memo_generation");
  if (args.chartRequest !== "none") kinds.push("chart_package");
  if (args.primaryIntent === "bankability" || args.calculationRequest === "finance_metrics") kinds.push("bankability_economics");
  if (args.primaryIntent === "physics_exergy" || args.calculationRequest === "exergy_efficiency" || args.calculationRequest === "solver_validation") kinds.push("physics_exergy_review");
  if (has(args.text, /\b(test\s+report|operating\s+data|cost\s+model|investor\s+deck|customer\s+deck|these\s+files|from\s+the\s+files|bundle)\b/i)) kinds.push("multi_artifact_workflow");
  return Array.from(new Set(kinds));
}

function secondaryIntents(primary: ClientPrimaryIntent, text: string, chartRequest: ClientChartRequest, calculationRequest: ClientCalculationRequest): ClientPrimaryIntent[] {
  const values: ClientPrimaryIntent[] = [];
  if (primary !== "chart_package" && chartRequest !== "none") values.push("chart_package");
  if (primary !== "bankability" && calculationRequest === "finance_metrics") values.push("bankability");
  if (primary !== "physics_exergy" && (calculationRequest === "exergy_efficiency" || calculationRequest === "solver_validation")) values.push("physics_exergy");
  if (primary !== "report_export" && has(text, /\b(report|memo|brief|deck|export)\b/i)) values.push("report_export");
  if (primary !== "evidence_recovery" && has(text, /\b(evidence|data\s+room|source|test\s+records?|collect|request)\b/i)) values.push("evidence_recovery");
  if (primary !== "client_advisory" && has(text, /\b(external|customer|investor|board|ceo|overclaim|safe\s+to\s+say|responsibly)\b/i)) values.push("client_advisory");
  return Array.from(new Set(values));
}

function inferFollowup(history: Array<{ role?: string; content?: string }> | null | undefined): {
  context: ClientFollowupContext;
  audience: ClientAudience;
} {
  if (!history?.length) return { context: "none", audience: "unknown" };
  const recentText = history
    .slice(-6)
    .map((turn) => turn.content || "")
    .join(" ")
    .toLowerCase();
  const audience = classifyAudience(recentText, "unknown");
  if (has(recentText, /\b(evidence|data\s+room|source|collect|request)\b/i)) {
    return { context: "inherits_evidence_request", audience };
  }
  if (has(recentText, /\b(report|memo|deck|one[\s-]?pager)\b/i)) {
    return { context: "inherits_artifact", audience };
  }
  if (has(recentText, /\b(external|customer[\s-]?safe|investor[\s-]?safe|overclaim|unsupported)\b/i)) {
    return { context: "inherits_claim_boundary", audience };
  }
  if (audience !== "unknown") return { context: "inherits_audience", audience };
  return { context: "none", audience: "unknown" };
}

export function classifyClientIntent(args: ClassifyClientIntentArgs): ClientIntent {
  const text = (args.message || "").replace(/\s+/g, " ").trim();
  const followup = inferFollowup(args.history);
  const evidenceState = evidenceStateFor(args.state);
  const extractionState = extractionStateFor(args.state);
  const artifactRequest = classifyArtifactRequest(text);
  const chartRequest = classifyChartRequest(text, args.state);
  const calculationRequest = classifyCalculationRequest(text);
  const sharingContext = classifySharingContext(text);
  const claimBoundaryContext = classifyClaimBoundary(text);
  const requestedOutputStyle = classifyStyle(text);
  const audience = classifyAudience(text, followup.audience);
  const primaryIntent = classifyPrimary(text, {
    artifactRequest,
    chartRequest,
    calculationRequest,
    sharingContext,
    claimBoundaryContext,
  });
  const attachmentGrounded = isAttachmentGroundedRequest(text, args.state);
  const conflictingEvidence = isConflictingEvidenceRequest(text, args.state);
  const simpleFollowup = isSimpleFollowup(text);
  const taskKinds = classifyTaskKinds({
    text,
    primaryIntent,
    chartRequest,
    calculationRequest,
    artifactRequest,
    attachmentGrounded,
    conflictingEvidence,
    simpleFollowup,
  });
  const workflowMode = classifyWorkflowMode(text, taskKinds, simpleFollowup);
  const signals: string[] = [];
  pushSignal(signals, primaryIntent !== "general", `primary:${primaryIntent}`);
  pushSignal(signals, audience !== "unknown", `audience:${audience}`);
  pushSignal(signals, artifactRequest !== "none", `artifact:${artifactRequest}`);
  pushSignal(signals, chartRequest !== "none", `chart:${chartRequest}`);
  pushSignal(signals, calculationRequest !== "none", `calculation:${calculationRequest}`);
  pushSignal(signals, sharingContext !== "none", `sharing:${sharingContext}`);
  pushSignal(signals, claimBoundaryContext !== "neutral", `claim_boundary:${claimBoundaryContext}`);
  pushSignal(signals, requestedOutputStyle !== "default", `style:${requestedOutputStyle}`);
  pushSignal(signals, followup.context !== "none", `followup:${followup.context}`);
  pushSignal(signals, workflowMode !== "direct_answer", `workflow:${workflowMode}`);
  pushSignal(signals, attachmentGrounded, "attachment_grounded");
  pushSignal(signals, conflictingEvidence, "conflicting_evidence");
  for (const kind of taskKinds) pushSignal(signals, true, `task:${kind}`);

  const highRisk =
    evidenceState !== "evaluation_ready" &&
    evidenceState !== "chartable_artifact" &&
    (sharingContext !== "none" ||
      claimBoundaryContext !== "neutral" ||
      calculationRequest !== "none" ||
      primaryIntent === "report_export" ||
      primaryIntent === "chart_package");
  const missingDataSensitivity: ClientMissingDataSensitivity =
    evidenceState === "failed_extraction" || calculationRequest !== "none" || chartRequest !== "none"
      ? "high"
      : evidenceState === "no_docs" || evidenceState === "docs_no_eval"
        ? "medium"
        : "low";
  const truthfulnessRisk: ClientTruthfulnessRisk =
    claimBoundaryContext === "adversarial_readiness" || highRisk
      ? "high"
      : sharingContext !== "none" || missingDataSensitivity === "medium"
        ? "medium"
        : "low";

  return {
    primaryIntent,
    secondaryIntents: secondaryIntents(primaryIntent, text, chartRequest, calculationRequest),
    audience,
    artifactRequest,
    chartRequest,
    calculationRequest,
    evidenceState,
    extractionState,
    sharingContext,
    claimBoundaryContext,
    domainHint: args.project?.domain || args.state.domain || null,
    followupContext: followup.context,
    requestedOutputStyle,
    missingDataSensitivity,
    truthfulnessRisk,
    workflowMode,
    taskKinds,
    attachmentGrounded,
    conflictingEvidence,
    simpleFollowup,
    matchedSignals: signals,
  };
}
