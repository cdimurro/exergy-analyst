/**
 * Shared types for the prompt catalogs (rationalizations, red flags) and
 * the policy layer that maps catalog entries to deterministic consequences.
 *
 * These catalogs are policy infrastructure, not just prompt text. The types
 * here are the vocabulary the engine and the workspace both agree on.
 */

/** Energy domains covered by the catalog entries. */
export type CatalogDomain =
  | "battery"
  | "pv"
  | "inverter"
  | "waste_to_fuels"
  | "power_to_liquid"
  | "generic";

/**
 * Diligence stages. Consequences escalate with stage: a concern that is
 * informational at discovery may be a hard block at deployment diligence.
 */
export type Stage = "discovery" | "pilot_diligence" | "deployment_diligence";

/** Brief types that can load catalog entries. */
export type BriefType = "research" | "diligence" | "decision";

/**
 * Canonical 10-module framework from CLAUDE.md. Red flags and
 * rationalizations are assigned a module owner so Physics and Regulatory
 * concerns can be routed to their respective module evaluators.
 */
export type ModuleOwner =
  | "physics"
  | "performance"
  | "economics"
  | "safety"
  | "regulatory"
  | "manufacturing"
  | "environmental"
  | "scalability"
  | "system_integration"
  | "novelty";

/** Priority for prompt-token budgeting and ordering. */
export type Priority = "critical" | "high" | "medium";

/**
 * Red-flag severity as declared in the catalog. This is the worst-case
 * classification; the policy layer maps it to a VerdictCeiling per stage.
 */
export type RedFlagSeverity = "caution" | "blocker";

/**
 * Deterministic consequence applied to the module verdict.
 *
 *   "none"         caveat only, no verdict effect
 *   "conditional"  module verdict cannot be better than "conditional"
 *   "blocked"      module verdict becomes "blocked"; populates veto_concerns
 *
 * Values align with ModuleVerdictSummary.verdict in brief-types.ts.
 */
export type VerdictCeiling = "none" | "conditional" | "blocked";

/** Ordered list used for stable sorting by priority. */
export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

/** Ordered list used for stage comparison (later stages >= earlier). */
export const STAGE_ORDER: Record<Stage, number> = {
  discovery: 0,
  pilot_diligence: 1,
  deployment_diligence: 2,
};
