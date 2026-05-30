/**
 * Policy layer that maps catalog entries to deterministic consequences.
 *
 * The catalog stores classifications (severity, priority). This module
 * turns them into verdict ceilings, confidence caps, and filtered lists.
 * Keep all stage-dependent logic here so catalog entries stay declarative.
 */

import {
  PRIORITY_ORDER,
  STAGE_ORDER,
  type BriefType,
  type CatalogDomain,
  type ModuleOwner,
  type RedFlagSeverity,
  type Stage,
  type VerdictCeiling,
} from "./types";

/**
 * Semantic version of the prompt catalog (rationalizations + red-flags).
 *
 * Bump this when adding, removing, or materially reclassifying entries in
 * ``rationalizations.ts`` or ``red-flags.ts``. Pure copy edits to the
 * prompt strings that do not change selection or severity do not require
 * a bump. Surfaced as provenance so prompt changes are traceable across
 * briefs and the AI-review artifact. CC-BE-ISH-0004.
 */
export const CATALOG_VERSION = "1.0.0";

/**
 * Semantic version of the consequence-mapping policy in this module.
 *
 * Bump this when ``ceilingForStage``, ``applyModuleConfidenceCap``,
 * ``LLM_ONLY_CONFIDENCE_CAP``, or ``LLM_ONLY_MODULES`` change in a way
 * that can shift a verdict for the same catalog entry. Additions that
 * are strictly advisory do not require a bump. CC-BE-ISH-0004.
 */
export const POLICY_VERSION = "1.0.0";

/**
 * Modules where production evidence typically flows through governed
 * retrieval + LLM reasoning rather than a deterministic simulator:
 * Regulatory (M5), Manufacturing (M6), Novelty (M10).
 *
 * When the reasoning path is LLM-only (no hard-evidence artifacts), the
 * module-level confidence cap applies.
 */
export const LLM_ONLY_MODULES: readonly ModuleOwner[] = [
  "regulatory",
  "manufacturing",
  "novelty",
] as const;

/**
 * Canonical cap for LLM-only reasoning paths in the LLM-only modules.
 * Catalog entries may declare looser default_confidence_cap values (up to
 * 0.7) — those are internal heuristics. The module-level cap is the hard
 * ceiling on surfaced confidence when no non-LLM evidence is present.
 */
export const LLM_ONLY_CONFIDENCE_CAP = 0.55;

/**
 * Map a red-flag severity + stage to the ceiling the policy layer enforces.
 *
 * Rationale: the catalog surfaces evidence problems; the consequence scales
 * with maturity. A "blocker" at discovery is informational because the
 * evidence could still arrive; at deployment diligence the same signal is
 * a veto.
 */
export function ceilingForStage(
  severity: RedFlagSeverity,
  stage: Stage,
): VerdictCeiling {
  if (stage === "discovery") {
    return "none";
  }
  if (stage === "pilot_diligence") {
    return severity === "blocker" ? "conditional" : "none";
  }
  // deployment_diligence
  return severity === "blocker" ? "blocked" : "conditional";
}

/** Applies at or after the declared earliest stage. */
export function stageApplies(appliesFrom: Stage, current: Stage): boolean {
  return STAGE_ORDER[current] >= STAGE_ORDER[appliesFrom];
}

/** True if a catalog entry is in-scope for the given domain (entry or generic). */
export function domainApplies(
  entryDomains: readonly CatalogDomain[],
  current: CatalogDomain,
): boolean {
  return entryDomains.includes(current) || entryDomains.includes("generic");
}

/** True if a catalog entry is loaded for the given brief type. */
export function briefTypeApplies(
  entryBriefTypes: readonly BriefType[],
  current: BriefType,
): boolean {
  return entryBriefTypes.includes(current);
}

/** Context used to select which catalog entries are injected into a prompt. */
export interface SelectionContext {
  domain: CatalogDomain;
  stage: Stage;
  brief_type: BriefType;
}

/**
 * Stable sort: by priority (critical first), then by key for determinism.
 * Snapshot tests depend on this order.
 */
export function sortByPriorityThenKey<
  T extends { key: string; priority: "critical" | "high" | "medium" },
>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Apply the module-level confidence cap when reasoning is LLM-only.
 *
 * The catalog's default_confidence_cap is a per-flag heuristic (can be up
 * to 0.7). This function is the enforcement point: for LLM-only modules
 * (M5, M6, M10) with no non-LLM evidence, surfaced confidence must not
 * exceed LLM_ONLY_CONFIDENCE_CAP regardless of catalog heuristics.
 */
export function applyModuleConfidenceCap(
  moduleOwner: ModuleOwner,
  proposedCap: number,
  hasNonLLMEvidence: boolean,
): number {
  if (LLM_ONLY_MODULES.includes(moduleOwner) && !hasNonLLMEvidence) {
    return Math.min(proposedCap, LLM_ONLY_CONFIDENCE_CAP);
  }
  return proposedCap;
}

/**
 * Map a project-domain string (engine-native, sometimes aliased) to the
 * catalog's CatalogDomain. Unknown or general domains fall back to
 * "generic" so generic entries still apply.
 */
export function catalogDomainFromProjectDomain(domain: string): CatalogDomain {
  const d = domain.toLowerCase();
  if (d === "battery" || d === "battery_ecm") return "battery";
  if (d === "pv" || d === "pv_iv") return "pv";
  if (d === "inverter" || d === "inverter_dc_ac") return "inverter";
  if (d === "waste_to_fuels" || d === "wtf") return "waste_to_fuels";
  if (d === "power_to_liquid" || d === "ptl") return "power_to_liquid";
  return "generic";
}

/**
 * Count flags where status is unresolved. Used for the computed
 * unresolved_red_flag_count field on DeviceDecisionBrief.
 */
export function countUnresolved(
  flags: readonly { status: "unresolved" | "cleared" }[],
): number {
  return flags.filter((f) => f.status === "unresolved").length;
}

/**
 * Count unresolved flags whose severity is blocker. Used for the computed
 * blocker_red_flag_count field on DeviceDecisionBrief.
 */
export function countUnresolvedBlockers(
  flags: readonly {
    status: "unresolved" | "cleared";
    severity: RedFlagSeverity;
  }[],
): number {
  return flags.filter((f) => f.status === "unresolved" && f.severity === "blocker").length;
}
