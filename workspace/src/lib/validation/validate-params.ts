/**
 * Gate 1: Parameter Validation — pre-flight check before params reach evaluation engine.
 *
 * Hard-blocks impossible values. Returns sanitized params with blocked values removed.
 * Never silently fixes values — if efficiency=150, it's removed, not clamped.
 */

import type { ValidationDecision } from "./physics-rules";
import { checkValue, logValidation } from "./core";

export interface ParamValidationResult {
  valid: boolean;
  decisions: ValidationDecision[];
  blocked_fields: string[];
  sanitized_params: Record<string, unknown>;
}

export function validateParams(
  params: Record<string, unknown>,
): ParamValidationResult {
  const decisions: ValidationDecision[] = [];
  const blocked: string[] = [];
  const sanitized = { ...params };

  for (const [key, value] of Object.entries(params)) {
    // Only validate numeric values
    if (typeof value !== "number") continue;

    const decision = checkValue(key, value);
    if (decision) {
      decisions.push(decision);
      if (decision.tier === "hard_block") {
        blocked.push(key);
        delete sanitized[key];
        logValidation({
          timestamp: new Date().toISOString(),
          layer: "params",
          tier: decision.tier,
          rule_id: decision.rule_id,
          field: key,
          value,
          message: decision.message,
        });
      }
    }
  }

  return {
    valid: blocked.length === 0,
    decisions,
    blocked_fields: blocked,
    sanitized_params: sanitized,
  };
}
