/**
 * Gate 2: Evaluation Result Validation — post-CLI check.
 *
 * Scans evaluation results for impossible values. Adds validation_issues[]
 * to the result and sets validation_valid = false if hard blocks found.
 * NEVER modifies the actual score, verdicts, or metrics.
 */

import type { ValidationDecision } from "./physics-rules";
import { VALID_VERDICTS } from "./physics-rules";
import { checkValue, walkNumericFields, logValidation } from "./core";

export interface EvaluationValidationResult {
  validation_valid: boolean;
  validation_issues: string[];
  decisions: ValidationDecision[];
}

export function validateEvaluation(
  result: Record<string, unknown>,
): EvaluationValidationResult {
  const issues: string[] = [];
  const decisions: ValidationDecision[] = [];

  // Check score field
  const score = result.score;
  if (score !== undefined && score !== null) {
    if (typeof score !== "number") {
      issues.push(`score is not a number: ${typeof score}`);
    } else {
      const d = checkValue("composite_score", score);
      if (d) {
        decisions.push(d);
        issues.push(`score ${score}: ${d.message}`);
      }
    }
  }

  // Check module verdicts
  const mods = result.module_evaluations as Record<string, Record<string, unknown>> | undefined;
  if (mods && typeof mods === "object") {
    for (const [modName, modData] of Object.entries(mods)) {
      if (!modData || typeof modData !== "object") continue;
      const verdict = modData.verdict;
      if (typeof verdict === "string" && !VALID_VERDICTS.has(verdict)) {
        issues.push(`${modName}: invalid verdict "${verdict}"`);
        decisions.push({
          tier: "hard_block",
          rule_id: "invalid_verdict",
          field: `${modName}.verdict`,
          value: verdict,
          message: `Invalid verdict: ${verdict}`,
        });
      }
      // Check confidence
      const conf = modData.confidence_0_1;
      if (typeof conf === "number") {
        const d = checkValue("confidence_0_1", conf);
        if (d) {
          decisions.push({ ...d, field: `${modName}.confidence_0_1` });
          issues.push(`${modName}: confidence ${conf} out of [0,1]`);
        }
      }
    }
  }

  // Recursive NaN/Infinity scan (sampled for performance)
  walkNumericFields(result, (path, value) => {
    if (!Number.isFinite(value)) {
      issues.push(`${path}: non-finite value ${value}`);
      decisions.push({
        tier: "hard_block",
        rule_id: "finite_number",
        field: path,
        value,
        message: "Non-finite value (NaN or Infinity)",
      });
    }
  });

  const valid = issues.length === 0;

  if (!valid) {
    for (const issue of issues) {
      logValidation({
        timestamp: new Date().toISOString(),
        layer: "evaluation",
        tier: "hard_block",
        rule_id: "evaluation_check",
        field: "result",
        value: null,
        message: issue,
      });
    }
  }

  return { validation_valid: valid, validation_issues: issues, decisions };
}
