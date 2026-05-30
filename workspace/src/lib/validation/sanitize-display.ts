/**
 * Gate 4: Display Sanitization — pre-render, UI only.
 *
 * Creates a display-safe copy with clamping, URL blocking, and annotations.
 * ONLY layer that modifies values — and only in the display copy, never stored data.
 */

export interface DisplayAnnotation {
  field: string;
  message: string;
  original_value: unknown;
  display_value: unknown;
}

export interface SanitizedDisplay {
  annotations: DisplayAnnotation[];
  has_validation_issues: boolean;
  validation_banner: string | null;
}

const BLOCKED_URL_SCHEMES = /^(javascript|data|blob|vbscript):/i;

/**
 * Check if a URL is safe for display.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (BLOCKED_URL_SCHEMES.test(trimmed)) return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  // Relative URLs without scheme are safe
  if (!trimmed.includes(":")) return true;
  return false;
}

/**
 * Escape HTML entities in a string.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Clamp a number to a display range.
 */
export function clampForDisplay(value: number, min: number, max: number): { clamped: number; was_clamped: boolean } {
  if (!Number.isFinite(value)) return { clamped: 0, was_clamped: true };
  if (value < min) return { clamped: min, was_clamped: true };
  if (value > max) return { clamped: max, was_clamped: true };
  return { clamped: value, was_clamped: false };
}

/**
 * Analyze an artifact/brief for display safety.
 * Returns annotations for any values that need visual indicators.
 * Does NOT modify the original data.
 */
export function analyzeForDisplay(
  data: Record<string, unknown>,
): SanitizedDisplay {
  const annotations: DisplayAnnotation[] = [];
  const validationIssues = data.validation_issues as string[] | undefined;
  const validationValid = data.validation_valid as boolean | undefined;

  // Check composite_score display range.
  // CC-BE-0113b: schema changed from 0-1 fraction to 0-100 display
  // scale; the clamp range tracks the schema invariant. Pre-0113 a
  // legitimate 0.534 would pass clampForDisplay(score, 0, 1); post-
  // 0113b the same semantic value is 53.4 and must pass
  // clampForDisplay(score, 0, 100).
  const score = data.composite_score;
  if (typeof score === "number") {
    const { clamped, was_clamped } = clampForDisplay(score, 0, 100);
    if (was_clamped) {
      annotations.push({
        field: "composite_score",
        message: `Score ${score} clamped to ${clamped} for display`,
        original_value: score,
        display_value: clamped,
      });
    }
  }

  // Check confidence display range
  const conf = data.avg_module_confidence;
  if (typeof conf === "number") {
    const { clamped, was_clamped } = clampForDisplay(conf, 0, 1);
    if (was_clamped) {
      annotations.push({
        field: "avg_module_confidence",
        message: `Confidence ${conf} clamped to ${clamped} for display`,
        original_value: conf,
        display_value: clamped,
      });
    }
  }

  // Build validation banner
  let banner: string | null = null;
  if (validationValid === false && validationIssues && validationIssues.length > 0) {
    banner = `${validationIssues.length} validation issue(s) detected. Some values may not be accurate.`;
  }

  return {
    annotations,
    has_validation_issues: validationValid === false,
    validation_banner: banner,
  };
}
