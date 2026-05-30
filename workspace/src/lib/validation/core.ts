/**
 * Core validation utilities — shared across all gates.
 */

import {
  type ValidationTier,
  type ValidationDecision,
  HARD_RULES,
  EXACT_FIELD_RULES,
  EXCLUDED_FROM_PATTERNS,
  PATTERN_RULES,
} from "./physics-rules";

// ── Field Classification ─────────────────────────────────────

/**
 * Classify a field name to determine which physics rule applies.
 * Resolution order: exact match → exclusion check → pattern match → null.
 * finite_number is always applied separately (not returned here).
 */
export function classifyField(fieldName: string): string | null {
  // Step 1: Exact match (highest priority)
  const lower = fieldName.toLowerCase();
  if (EXACT_FIELD_RULES[lower]) return EXACT_FIELD_RULES[lower];
  if (EXACT_FIELD_RULES[fieldName]) return EXACT_FIELD_RULES[fieldName];

  // Step 2: Exclusion check
  for (const excl of EXCLUDED_FROM_PATTERNS) {
    if (lower === excl.toLowerCase() || lower.includes(excl.toLowerCase())) {
      return null; // Excluded from pattern matching
    }
  }

  // Step 3: Pattern match
  for (const { pattern, rule } of PATTERN_RULES) {
    if (pattern.test(fieldName)) return rule;
  }

  return null;
}

/**
 * Validate a single numeric value against the appropriate physics rule.
 * Always checks finite_number. Additionally checks the field-specific rule.
 */
export function checkValue(
  field: string,
  value: number,
): ValidationDecision | null {
  // Always check finite
  if (!HARD_RULES.finite_number.check(value)) {
    return {
      tier: "hard_block",
      rule_id: "finite_number",
      field,
      value,
      message: HARD_RULES.finite_number.message,
    };
  }

  // Check field-specific rule
  const ruleId = classifyField(field);
  if (ruleId && HARD_RULES[ruleId]) {
    const rule = HARD_RULES[ruleId];
    if (!rule.check(value)) {
      return {
        tier: "hard_block",
        rule_id: ruleId,
        field,
        value,
        message: rule.message,
      };
    }
  }

  return null; // pass
}

// ── Recursive Numeric Walker ─────────────────────────────────

/**
 * Walk all numeric fields in a nested object/array structure.
 * Calls visitor(path, value) for every number found.
 */
export function walkNumericFields(
  obj: unknown,
  visitor: (path: string, value: number) => void,
  prefix: string = "",
): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === "number") {
    visitor(prefix || "root", obj);
    return;
  }

  if (Array.isArray(obj)) {
    // For large arrays (e.g., discharge curves), sample rather than walk all
    const step = obj.length > 100 ? Math.floor(obj.length / 20) : 1;
    for (let i = 0; i < obj.length; i += step) {
      walkNumericFields(obj[i], visitor, `${prefix}[${i}]`);
    }
    return;
  }

  if (typeof obj === "object") {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof val === "number") {
        visitor(path, val);
      } else if (typeof val === "object" && val !== null) {
        walkNumericFields(val, visitor, path);
      }
    }
  }
}

// ── Fail-Safe Wrapper ────────────────────────────────────────

/**
 * Wrap a validation function so it never crashes the application.
 * If the wrapped function throws, returns fallthrough result with
 * a "validation_unavailable" issue logged.
 */
export function failSafe<TIn, TOut>(
  fn: (input: TIn) => TOut,
  fallthrough: (input: TIn) => TOut,
  layerName: string,
): (input: TIn) => TOut {
  return (input: TIn): TOut => {
    try {
      return fn(input);
    } catch (err) {
      console.error(`[VALIDATION] ${layerName} layer error:`, err);
      return fallthrough(input);
    }
  };
}

// ── Logging ──────────────────────────────────────────────────

export interface ValidationLogEntry {
  timestamp: string;
  layer: string;
  tier: ValidationTier;
  rule_id: string;
  field: string;
  value: unknown;
  message: string;
}

export function logValidation(entry: ValidationLogEntry): void {
  const prefix = entry.tier === "hard_block" ? "[VALIDATION BLOCK]" : "[VALIDATION]";
  console.warn(
    `${prefix} ${entry.layer}/${entry.rule_id}: ${entry.field}=${JSON.stringify(entry.value)} — ${entry.message}`,
  );
}
