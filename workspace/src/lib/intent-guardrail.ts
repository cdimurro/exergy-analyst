/**
 * Intent guardrail — deterministic post-LLM check that the action chosen
 * matches the user's actual intent.
 *
 * Background
 * ----------
 * CC-BE-WS-0034 Batch D added prompt-level intent classification so the
 * LLM would route a "what's the most efficient solar panel right now?"
 * question to literature_search instead of a 7-step techno-economic
 * evaluation pipeline.  But prompts are advisory — the LLM can still
 * pick the wrong tool.  This module enforces the boundary in code:
 *
 *   1. Classify the user's intent from their most recent message
 *      (keyword + structural cues, fully deterministic).
 *   2. Check whether the LLM's chosen action is permitted under that
 *      intent.
 *   3. If not, downgrade the action to one that fits — usually a
 *      literature_search or a direct response — instead of running an
 *      expensive multi-step pipeline against the user's wishes.
 *
 * Design rationale
 * ----------------
 * Keyword-based classification is intentionally simple.  We're not
 * trying to be smart; we're trying to catch obvious mismatches like
 * "what's the most efficient X" → evidence_evaluation, which the
 * Canadian-Solar workspace export demonstrated as a real failure mode.
 * The guardrail rewrites rather than rejects so the user still gets a
 * useful response, just one matched to their question.
 *
 * Telemetry: every downgrade emits a guardrail_downgrade log entry so
 * we can measure how often the LLM strays.
 */

import {
  messageHasChartIntent,
  messageHasComplexEvaluationIntent,
  messageHasEvidenceGapIntent,
  messageHasEconomicsIntent,
  messageHasClientSynthesisIntent,
  messageHasAdversarialReadinessIntent,
  messageHasPhysicsFollowupIntent,
  messageHasPlanRequest,
  messageHasReportExportIntent,
  messageHasResearchIntent,
} from "@/lib/chat-evidence-fallback";

export {
  messageHasChartIntent,
  messageHasComplexEvaluationIntent,
  messageHasEvidenceGapIntent,
  messageHasEconomicsIntent,
  messageHasClientSynthesisIntent,
  messageHasAdversarialReadinessIntent,
  messageHasPhysicsFollowupIntent,
  messageHasPlanRequest,
  messageHasReportExportIntent,
  messageHasResearchIntent,
} from "@/lib/chat-evidence-fallback";

export type UserIntent =
  | "factual_comparative"   // "what's the most efficient X", "compare X to Y"
  | "research"              // "find papers on X", "what does the literature say"
  | "simulation"            // "run a sim with these params", "simulate X at Y"
  | "tea_assessment"        // "evaluate this", "is this ready", "assess deployment"
  | "document_generation"   // "make a chart", "generate a brief", "export a report"
  | "followup"              // "explain that", "why is X so low?", "what does this mean"
  | "unclear";              // can't tell — let the LLM judge

export interface IntentClassification {
  intent: UserIntent;
  matched_keywords: string[];
  /**
   * Confidence 0-1.  Currently always 1.0 for keyword matches and 0
   * for "unclear".  We don't probabilistically blend — we either matched
   * a strong signal or we didn't.
   */
  confidence: number;
}

export type WorkspaceIntentLabel =
  | "initial_plan"
  | "literature_search"
  | "exploratory_analysis"
  | "deep_analysis_economics"
  | "deep_analysis_physics"
  | "deep_analysis_evidence_gaps"
  | "client_synthesis"
  | "chart_request_with_data"
  | "chart_request_without_data"
  | "report_export_request"
  | "general_chat";

export interface WorkspaceIntentContext {
  has_uploaded_doc: boolean;
  has_prior_evaluation: boolean;
  prior_artifacts: number;
}

export interface WorkspaceIntentClassification {
  label: WorkspaceIntentLabel;
  matched_keywords: string[];
  confidence: number;
}

/* ── Keyword tables ──────────────────────────────────────────── */

// Phrases that strongly indicate a comparative / market / superlative ask.
// Tested against lowercase message.
const COMPARATIVE_PATTERNS: RegExp[] = [
  /\bwhat['']?s? the (most|best|cheapest|highest|lowest|leading|top) /,
  /\bwhich (company|panel|battery|inverter|technology|product|model|brand) (is|has|leads|wins) /,
  /\b(compare|comparison|versus|\bvs\b|how does .* compare)/,
  /\bmarket leader/,
  /\bmost efficient/,
  /\btop \d+ /,
  /\branking|ranked\b/,
  /\bstate of the (art|market)\b/,
];

const RESEARCH_PATTERNS: RegExp[] = [
  /\b(find|search for|look up|pull up|locate) (papers|research|literature|studies|articles)\b/,
  /\bwhat does the literature say\b/,
  /\bpublished (data|results|benchmarks)\b/,
  /\bacademic (papers|sources|literature)\b/,
];

const SIMULATION_PATTERNS: RegExp[] = [
  /\brun (a |the |this )?simulation\b/,
  /\bsimulate (a |this |the )?(panel|stack|cell|module|battery|inverter)/,
  /\bwhat['']?s? the (pmax|voc|isc|efficiency|fill factor|power output) (at|for|with) /,
  /\bsweep (irradiance|temperature|voltage)\b/,
];

const TEA_PATTERNS: RegExp[] = [
  /\b(evaluate|evaluat\w+|assess|assessment) (this|the |my |our )/,
  /\bdeployment readiness\b/,
  /\b(is|are) (this|these|it) (ready|investable|deployable|commercial)\b/,
  /\btechno[\s-]?economic (analysis|assessment|evaluation)\b/,
  /\bdue diligence\b/,
  /\bfull (analysis|assessment|evaluation|review)\b/,
  /\b(comprehensive|thorough|complete) (analysis|assessment|evaluation|review)\b/,
  /\binvestment thesis\b/,
];

const DOCUMENT_GEN_PATTERNS: RegExp[] = [
  /\b(make|create|generate|build|draw) (me )?(a |the |me a )?(chart|graph|plot|figure|visualization|table)\b/,
  /\b(make|generate|create|export|download|build) (me )?(a |the |me a )?(report|brief|pdf|document|summary|one[\s-]?pager)\b/,
];

const FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(why|what does that|what does this) /,
  /\bexplain (that|this|the )/,
  /\b(tell me more|elaborate|expand on|go deeper)\b/,
  /\bwhat (about|did you mean) /,
];

const SHORT_FOLLOWUP_REGEX = /^[a-z\s,.?!'"-]{1,80}\?$/i;  // short clarifying questions

/* ── Classifier ─────────────────────────────────────────────── */

/**
 * Classify the user's intent from their message text.  Returns "unclear"
 * if no strong signal — caller should defer to the LLM in that case.
 *
 * Multiple categories may match (e.g., "compare AIKO and Maxeon papers"
 * has both comparative and research signals); we resolve ties by priority:
 *
 *   tea_assessment > simulation > document_generation > research > comparative > followup
 *
 * because the more-specialized intent should win over the broader one.
 * Document generation comes before comparative because "generate a chart
 * of X vs Y" should route to chart-creation, not to a market comparison.
 * If a user says "evaluate this technology vs Tesla", they want a real
 * evaluation, not just a comparison.
 */
export function classifyUserIntent(message: string): IntentClassification {
  const text = (message || "").toLowerCase().trim();
  if (!text) return { intent: "unclear", matched_keywords: [], confidence: 0 };

  const matches: { intent: UserIntent; keywords: string[] }[] = [];

  const matchOne = (
    intent: UserIntent,
    patterns: RegExp[],
  ): { intent: UserIntent; keywords: string[] } | null => {
    const kws: string[] = [];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) kws.push(m[0]);
    }
    return kws.length > 0 ? { intent, keywords: kws } : null;
  };

  const r1 = matchOne("tea_assessment", TEA_PATTERNS);
  if (r1) matches.push(r1);
  const r2 = matchOne("simulation", SIMULATION_PATTERNS);
  if (r2) matches.push(r2);
  // document_generation BEFORE comparative — "generate a chart of X vs Y"
  // is chart creation, not a market comparison.
  const r3 = matchOne("document_generation", DOCUMENT_GEN_PATTERNS);
  if (r3) matches.push(r3);
  const r4 = matchOne("research", RESEARCH_PATTERNS);
  if (r4) matches.push(r4);
  const r5 = matchOne("factual_comparative", COMPARATIVE_PATTERNS);
  if (r5) matches.push(r5);
  const r6 = matchOne("followup", FOLLOWUP_PATTERNS);
  if (r6) matches.push(r6);

  if (matches.length > 0) {
    return { intent: matches[0].intent, matched_keywords: matches[0].keywords, confidence: 1.0 };
  }

  // Short clarifying question → followup
  if (SHORT_FOLLOWUP_REGEX.test(text) && text.length < 80) {
    return { intent: "followup", matched_keywords: ["short-question"], confidence: 0.6 };
  }

  return { intent: "unclear", matched_keywords: [], confidence: 0 };
}

export function classifyWorkspaceIntent(
  message: string,
  context: WorkspaceIntentContext,
): WorkspaceIntentClassification {
  const text = (message || "").trim();
  const lower = text.toLowerCase();
  if (!text) {
    return { label: "general_chat", matched_keywords: [], confidence: 0 };
  }

  const hasPlanRequest = messageHasPlanRequest(text);
  const hasComplexEvaluationIntent = messageHasComplexEvaluationIntent(text);
  const hasChartIntent = messageHasChartIntent(text);
  const hasReportExportIntent = messageHasReportExportIntent(text);
  const multiFocusFollowupSignals = [
    messageHasEconomicsIntent(text),
    messageHasPhysicsFollowupIntent(text),
    messageHasEvidenceGapIntent(text),
    hasReportExportIntent,
  ].filter(Boolean).length;
  const hasAssessmentFrame =
    /\b(comprehensive|thorough|complete|full)\s+(analysis|assessment|evaluation|review)\b/i.test(text)
    || /\b(assess|assessment|evaluate|evaluation|deployment readiness|techno[\s-]?economic assessment|techno[\s-]?economic evaluation)\b/i.test(text);
  const hasAutonomousWorkflowFrame =
    /\b(full|comprehensive|complete|thorough|deep)\s+(analysis|assessment|evaluation|review|diligence|study)\b/i.test(text)
    || /\bdue\s+diligence\b/i.test(text)
    || /\binvestment\s+thesis\b/i.test(text)
    || /\brun\s+everything\b/i.test(text)
    || /\btechno[\s-]?economic\s+study\b/i.test(text);

  if (hasPlanRequest || (hasComplexEvaluationIntent && hasAssessmentFrame)) {
    return {
      label: "initial_plan",
      matched_keywords: [hasPlanRequest ? "plan_request" : "complex_request"],
      confidence: 1,
    };
  }

  if (messageHasAdversarialReadinessIntent(text)) {
    return {
      label: "report_export_request",
      matched_keywords: ["adversarial_readiness"],
      confidence: 1,
    };
  }

  if (hasReportExportIntent) {
    return {
      label: "report_export_request",
      matched_keywords: [lower.match(/\b(report|pdf|json|brief|packet|deck|document|summary|one[\s-]?pager|export|download)\b/i)?.[0] || "report"],
      confidence: 1,
    };
  }

  if (
    hasChartIntent &&
    context.has_prior_evaluation &&
    multiFocusFollowupSignals >= 2 &&
    /\b(in one package|one package|package|export|diligence|readiness|synthesis|in one answer)\b/i.test(text)
  ) {
    return {
      label: "deep_analysis_economics",
      matched_keywords: ["multi_focus_package"],
      confidence: 1,
    };
  }

  if (
    hasChartIntent &&
    messageHasEvidenceGapIntent(text) &&
    /\b(blocked|missing|what\s+data|data\s+do\s+you\s+need|need\s+for\s+(?:the\s+)?charts?)\b/i.test(text)
  ) {
    return {
      label: "deep_analysis_evidence_gaps",
      matched_keywords: ["chart_data_request"],
      confidence: 1,
    };
  }

  if (hasChartIntent) {
    return {
      label: context.prior_artifacts > 0 || context.has_prior_evaluation
        ? "chart_request_with_data"
        : "chart_request_without_data",
      matched_keywords: [lower.match(/\b(chart|graph|plot|visuali[sz]ation|figure|dashboard|table)\b/i)?.[0] || "chart"],
      confidence: 1,
    };
  }

  if (hasAutonomousWorkflowFrame) {
    return {
      label: "initial_plan",
      matched_keywords: ["complex_request"],
      confidence: 1,
    };
  }

  if (messageHasEvidenceGapIntent(text)) {
    if (
      context.has_prior_evaluation &&
      messageHasEconomicsIntent(text) &&
      messageHasPhysicsFollowupIntent(text)
    ) {
      return {
        label: "deep_analysis_economics",
        matched_keywords: ["multi_focus_followup"],
        confidence: 1,
      };
    }
    return {
      label: "deep_analysis_evidence_gaps",
      matched_keywords: [lower.match(/\b(evidence\s+gaps?|data\s+gaps?|missing\s+(?:data|evidence|inputs?)|next\s+diligence|diligence\s+actions?)\b/i)?.[0] || "evidence gaps"],
      confidence: 1,
    };
  }

  if (!context.has_uploaded_doc && messageHasEconomicsIntent(text)) {
    return {
      label: "deep_analysis_economics",
      matched_keywords: [lower.match(/\b(economics?|bankability|cost\s+model|unit\s+economics|lcoe|lcos|lcof|npv|irr|payback|capex|opex|breakeven|project\s+finance|financial\s+(?:data|model|inputs?)|financ(?:e|ed|ing|eable)|lend(?:er|able|ing)|debt|wacc|offtake|revenue|price\s+stack)\b/i)?.[0] || "economics"],
      confidence: 1,
    };
  }

  if (!context.has_uploaded_doc && messageHasPhysicsFollowupIntent(text)) {
    return {
      label: "deep_analysis_physics",
      matched_keywords: [lower.match(/\b(physics|simulate|simulation|solver|model|exergy|second[\s-]?law|efficiency|performance|thermodynamic\s+(?:state\s+)?variables?)\b/i)?.[0] || "physics"],
      confidence: 1,
    };
  }

  if (context.has_prior_evaluation && messageHasEconomicsIntent(text)) {
    return {
      label: "deep_analysis_economics",
      matched_keywords: [lower.match(/\b(economics?|bankability|cost\s+model|unit\s+economics|lcoe|lcos|lcof|npv|irr|payback|capex|opex|breakeven|project\s+finance|financial\s+(?:data|model|inputs?)|financ(?:e|ed|ing|eable)|lend(?:er|able|ing)|debt|wacc|offtake|revenue|price\s+stack)\b/i)?.[0] || "economics"],
      confidence: 1,
    };
  }

  if (context.has_prior_evaluation && messageHasPhysicsFollowupIntent(text)) {
    return {
      label: "deep_analysis_physics",
      matched_keywords: [lower.match(/\b(physics|simulate|simulation|solver|model|exergy|second[\s-]?law|efficiency|performance)\b/i)?.[0] || "physics"],
      confidence: 1,
    };
  }

  if (messageHasClientSynthesisIntent(text)) {
    return {
      label: "client_synthesis",
      matched_keywords: ["client_synthesis"],
      confidence: 1,
    };
  }

  if (messageHasResearchIntent(text)) {
    return {
      label: "literature_search",
      matched_keywords: [lower.match(/\b(papers?|literature|studies|research|benchmarks?)\b/i)?.[0] || "literature"],
      confidence: 1,
    };
  }

  if (context.has_prior_evaluation && /\b(patterns?|trade[\s-]?offs?|sensitivity|compare all|what stands out)\b/i.test(text)) {
    return {
      label: "exploratory_analysis",
      matched_keywords: [lower.match(/\b(patterns?|trade[\s-]?offs?|sensitivity|compare all|what stands out)\b/i)?.[0] || "exploratory"],
      confidence: 0.8,
    };
  }

  return { label: "general_chat", matched_keywords: [], confidence: 0 };
}

/* ── Action policy ──────────────────────────────────────────── */

/**
 * Action types currently emitted by the chat route.  Keep in sync with
 * the action handlers in actions/route.ts.
 */
export type ActionType =
  | "evidence_evaluation"
  | "physics_simulation"
  | "simulation_run"
  | "literature_search"
  | "deep_analysis"
  | "economics_analysis"
  | "custom_chart"
  | "exploratory_analysis"
  | "environmental_site_analysis"
  | "evidence_interview"
  | "scientific_review"
  | "deep_agent"
  | "agent_workspace";

const ALLOWED_BY_INTENT: Record<UserIntent, Set<ActionType | "response">> = {
  // Comparative questions get a literature search at most.  No TEA, no deep
  // analysis, no simulation.
  factual_comparative: new Set(["literature_search", "response"]),
  research:            new Set(["literature_search", "response"]),
  simulation:          new Set(["physics_simulation", "simulation_run", "response"]),
  // Full assessment unlocks everything.
  tea_assessment:      new Set([
    "evidence_evaluation", "physics_simulation", "simulation_run",
    "literature_search", "deep_analysis", "economics_analysis", "evidence_interview",
    "scientific_review", "custom_chart", "exploratory_analysis",
    "environmental_site_analysis", "deep_agent", "agent_workspace", "response",
  ]),
  document_generation: new Set(["custom_chart", "exploratory_analysis", "deep_agent", "agent_workspace", "response"]),
  followup:            new Set(["response"]),
  // When intent is unclear, allow anything — the LLM has more context than
  // the keyword classifier.
  unclear:             new Set([
    "evidence_evaluation", "physics_simulation", "simulation_run",
    "literature_search", "deep_analysis", "economics_analysis", "evidence_interview",
    "scientific_review", "custom_chart", "exploratory_analysis",
    "environmental_site_analysis", "deep_agent", "agent_workspace", "response",
  ]),
};

/**
 * For each intent that doesn't permit the LLM's chosen action, what's the
 * best-fit substitute?  Used by ``enforceIntentGuardrail`` to downgrade
 * rather than reject.
 */
const DOWNGRADE_TO: Record<UserIntent, ActionType | "response"> = {
  factual_comparative: "literature_search",
  research:            "literature_search",
  simulation:          "response",  // can't safely guess sim params
  tea_assessment:      "response",  // already permits everything; never reached
  document_generation: "response",
  followup:            "response",
  unclear:             "response",
};

/* ── Enforcement ────────────────────────────────────────────── */

/**
 * Shape of the parsed LLM response we operate on.  Loose ``unknown`` typing
 * because the underlying ``parsed`` value comes from JSON.parse and shapes
 * vary with response type.
 */
export interface ParsedLLMResponse {
  type: "response" | "plan" | "question" | "action";
  content: string;
  plan_steps?: Array<{ action_type?: string; config?: Record<string, unknown> }> | null;
  action?: { type?: string; config?: Record<string, unknown> } | null;
  suggested_followups?: string[];
  intent_guardrail?: {
    classified_intent: UserIntent;
    matched_keywords: string[];
    original_action_type: string;
    downgraded_to: string;
    reason: string;
  };
}

export interface GuardrailResult {
  parsed: ParsedLLMResponse;
  downgraded: boolean;
  classification: IntentClassification;
}

/**
 * Apply the intent guardrail to a parsed LLM response.
 *
 * Returns the (possibly modified) parsed response plus telemetry about
 * the classification and whether a downgrade happened.  Caller logs.
 */
export function enforceIntentGuardrail(
  userMessage: string,
  parsed: ParsedLLMResponse,
): GuardrailResult {
  const classification = classifyUserIntent(userMessage);

  // No guardrail action when intent is unclear — defer to LLM.
  if (classification.intent === "unclear" || classification.confidence < 0.5) {
    return { parsed, downgraded: false, classification };
  }

  const allowed = ALLOWED_BY_INTENT[classification.intent];

  // Type "response" with no action is always fine.
  if (parsed.type === "response" && !parsed.action && !parsed.plan_steps?.length) {
    return { parsed, downgraded: false, classification };
  }

  // Type "question" is also always fine — clarifying questions don't run tools.
  if (parsed.type === "question") {
    return { parsed, downgraded: false, classification };
  }

  const chosenAction = parsed.action?.type as ActionType | undefined;
  const chosenSteps = parsed.plan_steps?.map(s => s.action_type as ActionType).filter(Boolean) ?? [];

  // Action case
  if (parsed.type === "action" && chosenAction && !allowed.has(chosenAction)) {
    return downgrade(parsed, classification, chosenAction);
  }

  // Plan case — if ANY step is disallowed, we treat the whole plan as a
  // mismatch.  Plans are by definition multi-step heavy work; a comparative
  // question should never trigger one.
  if (parsed.type === "plan" && chosenSteps.length > 0) {
    const disallowedSteps = chosenSteps.filter(s => !allowed.has(s));
    if (disallowedSteps.length > 0) {
      return downgrade(parsed, classification, `plan(${chosenSteps.join(",")})`);
    }
  }

  return { parsed, downgraded: false, classification };
}

function downgrade(
  parsed: ParsedLLMResponse,
  classification: IntentClassification,
  originalActionType: string,
): GuardrailResult {
  const target = DOWNGRADE_TO[classification.intent];
  const reason =
    `User intent classified as ${classification.intent} ` +
    `(matched: ${classification.matched_keywords.slice(0, 2).join(", ") || "n/a"}); ` +
    `LLM picked ${originalActionType} which is not appropriate for this intent. ` +
    `Downgrading to ${target}.`;

  if (target === "response") {
    return {
      parsed: {
        type: "response",
        content: parsed.content || "Let me answer that directly.",
        plan_steps: null,
        action: null,
        suggested_followups: parsed.suggested_followups,
        intent_guardrail: {
          classified_intent: classification.intent,
          matched_keywords: classification.matched_keywords,
          original_action_type: originalActionType,
          downgraded_to: target,
          reason,
        },
      },
      downgraded: true,
      classification,
    };
  }

  // Substitute action — typically literature_search for a comparative/research
  // intent that the LLM tried to escalate.  Preserve the user's question as
  // the search query when possible.
  return {
    parsed: {
      type: "action",
      content: parsed.content || `Searching the literature for relevant findings.`,
      plan_steps: null,
      action: {
        type: target,
        config: {
          // Best-effort query construction; the action handler can pull from
          // the user's recent message if needed.
          query: parsed.action?.config?.query || "",
        },
      },
      suggested_followups: parsed.suggested_followups,
      intent_guardrail: {
        classified_intent: classification.intent,
        matched_keywords: classification.matched_keywords,
        original_action_type: originalActionType,
        downgraded_to: target,
        reason,
      },
    },
    downgraded: true,
    classification,
  };
}
