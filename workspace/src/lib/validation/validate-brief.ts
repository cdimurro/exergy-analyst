/**
 * Gate 3: Brief Validation — post-brief-generation check.
 *
 * Checks required fields, enum validity, numeric ranges.
 * Adds validation_issues[] to brief. NEVER modifies truth values.
 */

import type { ValidationDecision } from "./physics-rules";
import { VALID_READINESS_TIERS, VALID_VERDICTS } from "./physics-rules";
import { checkValue, logValidation } from "./core";

const BRIEF_REQUIRED_KEYS = [
  "brief_id", "device_id", "domain", "headline", "readiness_tier",
  "composite_score", "module_summary", "key_strengths", "key_concerns",
  "caveats", "next_actions", "calibration_tier", "contract_version",
];

export interface BriefValidationResult {
  validation_valid: boolean;
  validation_issues: string[];
  decisions: ValidationDecision[];
}

export function validateBrief(
  brief: Record<string, unknown>,
): BriefValidationResult {
  const issues: string[] = [];
  const decisions: ValidationDecision[] = [];

  // Required keys
  for (const key of BRIEF_REQUIRED_KEYS) {
    if (!(key in brief)) {
      issues.push(`missing required key: ${key}`);
    }
  }

  // Readiness tier enum
  const tier = brief.readiness_tier;
  if (typeof tier === "string" && !VALID_READINESS_TIERS.has(tier)) {
    issues.push(`invalid readiness_tier: "${tier}"`);
    decisions.push({
      tier: "hard_block", rule_id: "invalid_enum",
      field: "readiness_tier", value: tier,
      message: `readiness_tier "${tier}" not in valid set`,
    });
  }

  // Composite score (fraction)
  if (typeof brief.composite_score === "number") {
    const d = checkValue("composite_score", brief.composite_score as number);
    if (d) {
      decisions.push(d);
      issues.push(`composite_score ${brief.composite_score}: ${d.message}`);
    }
  }

  // Avg module confidence (fraction)
  if (typeof brief.avg_module_confidence === "number") {
    const d = checkValue("avg_module_confidence", brief.avg_module_confidence as number);
    if (d) {
      decisions.push(d);
      issues.push(`avg_module_confidence ${brief.avg_module_confidence}: ${d.message}`);
    }
  }

  // Module summary verdicts
  const modules = brief.module_summary;
  if (Array.isArray(modules)) {
    for (const mod of modules) {
      if (mod && typeof mod === "object" && "verdict" in mod) {
        const v = (mod as Record<string, unknown>).verdict;
        if (typeof v === "string" && !VALID_VERDICTS.has(v)) {
          issues.push(`module "${(mod as any).module_name}": invalid verdict "${v}"`);
        }
      }
      if (mod && typeof mod === "object" && "confidence" in mod) {
        const c = (mod as Record<string, unknown>).confidence;
        if (typeof c === "number" && (c < 0 || c > 1)) {
          issues.push(`module "${(mod as any).module_name}": confidence ${c} outside [0,1]`);
        }
      }
    }

    // Module count consistency
    const passing = brief.modules_passing as number || 0;
    const conditional = brief.modules_conditional as number || 0;
    const failing = brief.modules_failing as number || 0;
    const blocked = brief.modules_blocked as number || 0;
    const total = passing + conditional + failing + blocked;
    if (total > 0 && total !== modules.length && modules.length > 0) {
      issues.push(`module count mismatch: ${total} (sum) vs ${modules.length} (array length)`);
    }
  }

  // truth_agreement_pct (percentage)
  if (typeof brief.truth_agreement_pct === "number") {
    const d = checkValue("truth_agreement_pct", brief.truth_agreement_pct as number);
    if (d) {
      decisions.push(d);
      issues.push(`truth_agreement_pct ${brief.truth_agreement_pct}: ${d.message}`);
    }
  }

  const valid = issues.length === 0;

  if (!valid) {
    for (const issue of issues.slice(0, 5)) {
      logValidation({
        timestamp: new Date().toISOString(),
        layer: "brief",
        tier: "hard_block",
        rule_id: "brief_check",
        field: "brief",
        value: null,
        message: issue,
      });
    }
  }

  return { validation_valid: valid, validation_issues: issues, decisions };
}
