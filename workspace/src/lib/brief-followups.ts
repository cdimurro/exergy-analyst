/**
 * Gap-driven followup generation.
 *
 * CC-BE-REFACTOR-0040: the original logic lived inline in
 * `src/app/projects/[id]/page.tsx` (runPlan synthesis success handler)
 * and was replicated line-for-line in `platform-governance.test.ts`.
 * Extracted so the test exercises the real helper and future sites that
 * want gap-driven followups (e.g. chat route, export path) have one
 * place to update.
 */


interface BriefLike {
  ranked_gap_guidance?: Array<Record<string, unknown>> | null;
  baseline_comparisons?: Array<Record<string, unknown>> | null;
}


export function buildGapFollowups(briefData: BriefLike | null | undefined): string[] {
  const gapFollowups: string[] = [];
  if (!briefData) return gapFollowups;

  const gaps = briefData.ranked_gap_guidance;
  if (gaps && gaps.length > 0) {
    const p = (gaps[0] as Record<string, unknown>).parameter;
    if (p) gapFollowups.push(`What would change if I provided ${p} data?`);
  }

  const baselines = briefData.baseline_comparisons;
  if (baselines && baselines.length > 0) {
    const notable = baselines.find(
      (b) => (b as Record<string, unknown>).position === "above" ||
        (b as Record<string, unknown>).position === "below",
    ) as Record<string, unknown> | undefined;
    if (notable && notable.parameter && notable.position) {
      gapFollowups.push(`Why is my ${notable.parameter} ${notable.position} the baseline?`);
    }
  }

  return gapFollowups;
}
