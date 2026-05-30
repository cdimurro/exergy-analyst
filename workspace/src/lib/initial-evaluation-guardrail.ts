import {
  buildFollowOnEvaluationPlan,
  buildGroundedEvaluationPlan,
  messageHasComplexEvaluationIntent,
  messageHasEvaluationIntent,
  messageHasPlanRequest,
} from "@/lib/chat-evidence-fallback";

export interface InitialEvaluationProjectState {
  hasUploadedDocuments: boolean;
  hasSuccessfulEvaluationArtifact: boolean;
  hasChartableArtifact: boolean;
  hasAnyArtifact?: boolean;
  domain?: string;
  extractionStatus?: "none" | "complete" | "partial" | "failed" | "unknown";
  exportReadiness?: "ready" | "conditionally_ready" | "blocked";
  reportEvidenceRequests?: string[];
  documentEvidence?: AttachmentEvidenceSummary;
}

export interface AttachmentEvidenceSummary {
  sourceLabels: string[];
  facts: string[];
  assumptions: string[];
  unsupportedClaims: string[];
  contradictedClaims: string[];
  missingInputs: string[];
  nextActions: string[];
  chartableFields: string[];
  nonChartableFields: string[];
  failedExtractions: string[];
}

export interface PlanStep {
  step?: number;
  title?: string;
  description?: string;
  action_type?: string;
  config?: Record<string, unknown> | null;
  status?: string;
}

export interface ParsedChatResponse {
  type: "response" | "plan" | "question" | "action";
  content?: string;
  plan_steps?: PlanStep[] | null;
  action?: { type?: string; config?: Record<string, unknown> | null } | null;
  suggested_followups?: string[];
  initial_evaluation_guardrail?: {
    reason: InitialEvaluationGuardrailReason;
    original_type: string;
    original_action_type: string | null;
    original_step_action_types: string[];
  };
  [key: string]: unknown;
}

export interface InitialEvaluationGuardrailResult {
  parsed: ParsedChatResponse;
  downgraded: boolean;
  reason: InitialEvaluationGuardrailReason | null;
}

export type InitialEvaluationGuardrailReason =
  | "pre_evaluation_plan_blocked"
  | "pre_evaluation_plan_repaired"
  | "pre_evaluation_action_blocked"
  | "pre_evaluation_response_blocked"
  | "explicit_plan_request_repaired";

const BLOCKED_PRE_EVALUATION_ACTIONS = new Set([
  "deep_analysis",
  "economics_analysis",
  "scientific_review",
  "evidence_interview",
]);

const INTENT_BLOCKED_PRE_EVALUATION_ACTIONS = new Set([
  "literature_search",
  "deep_research",
]);

function assertParsedResponse(parsed: ParsedChatResponse): void {
  if (!parsed || typeof parsed !== "object") {
    throw new TypeError("parsed chat response must be an object");
  }
  if (typeof parsed.type !== "string") {
    throw new TypeError("parsed chat response must include a type");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstPlanStep(parsed: ParsedChatResponse): PlanStep | null {
  if (!Array.isArray(parsed.plan_steps) || parsed.plan_steps.length === 0) {
    return null;
  }
  return parsed.plan_steps[0] || null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function descriptionForEvaluation(
  parsed: ParsedChatResponse,
  projectState: InitialEvaluationProjectState,
): string {
  const firstStep = firstPlanStep(parsed);
  const firstStepConfig = isRecord(firstStep?.config) ? firstStep.config : {};
  const actionConfig = isRecord(parsed.action?.config) ? parsed.action.config : {};
  const projectDomain = stringFrom(projectState.domain);

  return (
    stringFrom(firstStepConfig.description) ||
    stringFrom(firstStepConfig.query) ||
    stringFrom(actionConfig.description) ||
    stringFrom(actionConfig.query) ||
    stringFrom(actionConfig.question) ||
    (projectDomain
      ? `${projectDomain.replace(/_/g, " ")} uploaded technology evaluation`
      : "Uploaded technology evaluation")
  );
}

function configForEvaluation(
  parsed: ParsedChatResponse,
  projectState: InitialEvaluationProjectState,
): Record<string, unknown> {
  const firstStepConfig = isRecord(firstPlanStep(parsed)?.config)
    ? (firstPlanStep(parsed)?.config as Record<string, unknown>)
    : {};
  const actionConfig = isRecord(parsed.action?.config) ? parsed.action.config : {};
  const params =
    isRecord(firstStepConfig.params) ? firstStepConfig.params
      : isRecord(actionConfig.params) ? actionConfig.params
        : undefined;

  const config: Record<string, unknown> = {
    domain:
      stringFrom(projectState.domain) ||
      stringFrom(firstStepConfig.domain) ||
      stringFrom(actionConfig.domain) ||
      "general",
    description: descriptionForEvaluation(parsed, projectState),
    brief: typeof firstStepConfig.brief === "boolean" ? firstStepConfig.brief : true,
  };

  if (params) {
    config.params = params;
  }

  return config;
}

function originalStepActionTypes(parsed: ParsedChatResponse): string[] {
  if (!Array.isArray(parsed.plan_steps)) return [];
  return parsed.plan_steps
    .map((step) => step?.action_type)
    .filter((actionType): actionType is string => typeof actionType === "string" && actionType.length > 0);
}

function downgradeToInitialEvaluation(
  parsed: ParsedChatResponse,
  projectState: InitialEvaluationProjectState,
  reason: InitialEvaluationGuardrailReason,
): InitialEvaluationGuardrailResult {
  const originalActionType = parsed.action?.type || null;
  return {
    parsed: {
      ...parsed,
      type: "action",
      content:
        "Starting with a grounded evidence evaluation of the uploaded documents. Deeper due-diligence steps will only be useful after the evidence extraction succeeds.",
      plan_steps: null,
      action: {
        type: "evidence_evaluation",
        config: configForEvaluation(parsed, projectState),
      },
      initial_evaluation_guardrail: {
        reason,
        original_type: parsed.type,
        original_action_type: originalActionType,
        original_step_action_types: originalStepActionTypes(parsed),
      },
    },
    downgraded: true,
    reason,
  };
}

function hasInitialEvidenceEvaluationStep(parsed: ParsedChatResponse): boolean {
  const step = firstPlanStep(parsed);
  return step?.action_type === "evidence_evaluation";
}

function stepWithDisplayDefaults(step: PlanStep, idx: number): PlanStep {
  const defaultTitles = [
    "Evidence Intake",
    "Literature & Benchmark Research",
    "Technical Validation",
    "Economics & Bankability",
    "Risk & Deployment Review",
    "Investment & Readiness Synthesis",
  ];
  return {
    ...step,
    step: idx + 1,
    title: stringFrom(step.title) || defaultTitles[idx] || `Analysis Step ${idx + 1}`,
    description:
      stringFrom(step.description) ||
      (
        step.action_type === "evidence_evaluation"
          ? "Verify the uploaded documents can produce usable evidence before deeper diligence."
          : step.action_type === "literature_search"
            ? "Search published benchmarks, reference cases, and competing approaches."
            : "Analyze the prior findings and convert them into decision-useful diligence."
      ),
    status: step.status || "pending",
  };
}

function repairPlanWithInitialEvaluation(
  parsed: ParsedChatResponse,
  projectState: InitialEvaluationProjectState,
): InitialEvaluationGuardrailResult {
  const existingSteps = Array.isArray(parsed.plan_steps) ? parsed.plan_steps : [];
  const evaluationConfig = configForEvaluation(parsed, projectState);
  const firstStep =
    hasInitialEvidenceEvaluationStep(parsed)
      ? { ...existingSteps[0], config: { ...evaluationConfig, ...(existingSteps[0]?.config || {}) } }
      : {
        action_type: "evidence_evaluation",
        config: evaluationConfig,
      };
  const remainingSteps = hasInitialEvidenceEvaluationStep(parsed)
    ? existingSteps.slice(1)
    : existingSteps.filter((step) => step?.action_type !== "evidence_evaluation");
  const repairedSteps = [firstStep, ...remainingSteps].map(stepWithDisplayDefaults);

  return {
    parsed: {
      ...parsed,
      type: "plan",
      content:
        stringFrom(parsed.content) ||
        "The plan starts with evidence intake so uploaded documents produce usable evidence before later steps build on those results.",
      plan_steps: repairedSteps,
      action: null,
      initial_evaluation_guardrail: {
        reason: "pre_evaluation_plan_repaired",
        original_type: parsed.type,
        original_action_type: parsed.action?.type || null,
        original_step_action_types: originalStepActionTypes(parsed),
      },
    },
    downgraded: true,
    reason: "pre_evaluation_plan_repaired",
  };
}

function buildPlanFromEvaluationIntent(
  parsed: ParsedChatResponse,
  projectState: InitialEvaluationProjectState,
): InitialEvaluationGuardrailResult {
  const config = configForEvaluation(parsed, projectState);
  const planSteps = buildGroundedEvaluationPlan({
    domain: stringFrom(config.domain) || "general",
    description: stringFrom(config.description) || "Uploaded technology evaluation",
  }).map(stepWithDisplayDefaults);

  return {
    parsed: {
      ...parsed,
      type: "plan",
      content:
        "I will start with evidence intake, then use those results for benchmark research, technical validation, economics, risk review, and final synthesis.",
      plan_steps: planSteps,
      action: null,
      initial_evaluation_guardrail: {
        reason: "pre_evaluation_plan_repaired",
        original_type: parsed.type,
        original_action_type: parsed.action?.type || null,
        original_step_action_types: originalStepActionTypes(parsed),
      },
    },
    downgraded: true,
    reason: "pre_evaluation_plan_repaired",
  };
}

function buildPlanFromExplicitPlanRequest(
  parsed: ParsedChatResponse,
  projectState: InitialEvaluationProjectState,
): InitialEvaluationGuardrailResult {
  const config = configForEvaluation(parsed, projectState);
  const description = stringFrom(config.description) || "Uploaded technology evaluation";
  const domain = stringFrom(config.domain) || "general";
  const planSource = projectState.hasSuccessfulEvaluationArtifact
    ? buildFollowOnEvaluationPlan({ domain, description })
    : buildGroundedEvaluationPlan({ domain, description });
  const planSteps = planSource.map(stepWithDisplayDefaults);

  return {
    parsed: {
      ...parsed,
      type: "plan",
      content:
        "Here is the editable execution plan. Review or change it before running the follow-on analysis.",
      plan_steps: planSteps,
      action: null,
      initial_evaluation_guardrail: {
        reason: "explicit_plan_request_repaired",
        original_type: parsed.type,
        original_action_type: parsed.action?.type || null,
        original_step_action_types: originalStepActionTypes(parsed),
      },
    },
    downgraded: true,
    reason: "explicit_plan_request_repaired",
  };
}

export function enforceInitialEvaluationGuardrail(
  parsed: ParsedChatResponse,
  projectState: InitialEvaluationProjectState,
  options: { userMessage?: string | null } = {},
): InitialEvaluationGuardrailResult {
  assertParsedResponse(parsed);

  const hasExplicitPlanRequest = messageHasPlanRequest(options.userMessage);
  const hasStructuredPlan = parsed.type === "plan" && Array.isArray(parsed.plan_steps) && parsed.plan_steps.length > 0;
  if (hasExplicitPlanRequest && (!hasStructuredPlan || projectState.hasSuccessfulEvaluationArtifact)) {
    return buildPlanFromExplicitPlanRequest(parsed, projectState);
  }

  if (!projectState.hasUploadedDocuments || projectState.hasSuccessfulEvaluationArtifact) {
    return { parsed, downgraded: false, reason: null };
  }

  if (parsed.type === "plan") {
    return repairPlanWithInitialEvaluation(parsed, projectState);
  }

  const hasEvaluationIntent = messageHasEvaluationIntent(options.userMessage);
  const hasComplexEvaluationIntent = messageHasComplexEvaluationIntent(options.userMessage);
  const actionType = parsed.type === "action" ? parsed.action?.type : null;

  if (actionType === "evidence_evaluation") {
    return { parsed, downgraded: false, reason: null };
  }

  if (hasComplexEvaluationIntent && (parsed.type === "response" || parsed.type === "action")) {
    return buildPlanFromEvaluationIntent(parsed, projectState);
  }

  if (parsed.type === "response" && hasEvaluationIntent) {
    return downgradeToInitialEvaluation(parsed, projectState, "pre_evaluation_response_blocked");
  }

  if (parsed.type === "action") {
    if (
      typeof actionType === "string" &&
      (
        BLOCKED_PRE_EVALUATION_ACTIONS.has(actionType) ||
        (hasEvaluationIntent && INTENT_BLOCKED_PRE_EVALUATION_ACTIONS.has(actionType))
      )
    ) {
      return downgradeToInitialEvaluation(parsed, projectState, "pre_evaluation_action_blocked");
    }
  }

  return { parsed, downgraded: false, reason: null };
}
