/**
 * Canonical composite-score formatting (TypeScript mirror).
 *
 * CC-BE-0113b. Mirrors `breakthrough_engine/score_canonical.py` so
 * workspace consumers (PDF narrative, chart gauge, PTL brief view)
 * use the same vocabulary and scale assumptions as the Python brief
 * generators. Same pattern as `workspace/src/lib/solver-status.ts`
 * ↔ `breakthrough_engine/brief_truthfulness.py` (landed CC-BE-GOV-0110).
 *
 * The brief's `composite_score` field is now stored on 0-100 scale at
 * the schema boundary (see `DeviceDecisionBrief.composite_score` Field
 * validator). Consumers MUST read that field directly and pass it
 * through `formatCompositeScore` — no `* 100` multiplication, no
 * inline `.toFixed()`-with-"/100"-suffix. Inline format strings in
 * consumer code are the drift vector 0113b closes.
 *
 * Before 0113b the workspace carried three divergent renders of the
 * same underlying value (a reactor assessment report reproduced this):
 *
 *   PDF narrative: `0.5/100`   (missing × 100 on a 0-1 field)
 *   Visual gauge:  `53`        (correct × 100 on a 0-1 field)
 *   JSON export:   `0.534`     (raw 0-1 field)
 *
 * Post-0113b all three channels read a 0-100 field and format it via
 * this module, producing a single consistent numeric value.
 */

export type ScoreContext = "json" | "narrative" | "gauge" | "inline";

/**
 * Render a composite score for a specific output channel. Every
 * workspace consumer that displays a composite score should call this.
 *
 * @param score_0_100 — composite score on 0-100 scale. Values outside
 *   [0, 100] are clamped before formatting.
 * @param context — "json" | "narrative" | "gauge" | "inline". Unknown
 *   contexts throw.
 */
export function formatCompositeScore(
  score_0_100: number,
  context: ScoreContext,
): string {
  const n = Number.isFinite(score_0_100) ? score_0_100 : 0;
  const clamped = Math.max(0, Math.min(100, n));
  switch (context) {
    case "json":
      return clamped.toFixed(2);
    case "narrative":
      return `${clamped.toFixed(1)}/100`;
    case "gauge":
      return String(Math.round(clamped));
    case "inline":
      return clamped.toFixed(1);
    default: {
      // Exhaustiveness check — a `ScoreContext` union member we
      // didn't handle would surface here at the type level.
      const exhaustive: never = context;
      throw new Error(`unknown score context: ${exhaustive as string}`);
    }
  }
}
