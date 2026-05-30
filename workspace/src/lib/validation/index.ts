/**
 * Runtime Validation Layer — public API.
 *
 * All exports are wrapped in failSafe() to prevent validation
 * bugs from crashing the application.
 */

export type { ValidationTier, ValidationDecision, HardRule } from "./physics-rules";
export { HARD_RULES, EXACT_FIELD_RULES, EXCLUDED_FROM_PATTERNS, PATTERN_RULES, VALID_VERDICTS, VALID_READINESS_TIERS } from "./physics-rules";
export { classifyField, checkValue, walkNumericFields, logValidation } from "./core";
export { failSafe } from "./core";

// Gate 1
export type { ParamValidationResult } from "./validate-params";
import { validateParams as _validateParams } from "./validate-params";
import { failSafe } from "./core";
export const validateParams = failSafe(
  _validateParams,
  (params) => ({ valid: true, decisions: [], blocked_fields: [], sanitized_params: params }),
  "params",
);

// Gate 2
export type { EvaluationValidationResult } from "./validate-evaluation";
import { validateEvaluation as _validateEvaluation } from "./validate-evaluation";
export const validateEvaluation = failSafe(
  _validateEvaluation,
  () => ({ validation_valid: true, validation_issues: ["validation_unavailable"], decisions: [] }),
  "evaluation",
);

// Gate 3
export type { BriefValidationResult } from "./validate-brief";
import { validateBrief as _validateBrief } from "./validate-brief";
export const validateBrief = failSafe(
  _validateBrief,
  () => ({ validation_valid: true, validation_issues: ["validation_unavailable"], decisions: [] }),
  "brief",
);

// Gate 4
export type { DisplayAnnotation, SanitizedDisplay } from "./sanitize-display";
export { isSafeUrl, escapeHtml, clampForDisplay, analyzeForDisplay } from "./sanitize-display";

// Gate 5
export type { ClaimAnnotation, ClaimsResult } from "./annotate-claims";
import { annotateAgentClaims as _annotateAgentClaims } from "./annotate-claims";
export const annotateAgentClaims = failSafe(
  _annotateAgentClaims,
  () => ({ clean: true, annotations: [] }),
  "claims",
);
