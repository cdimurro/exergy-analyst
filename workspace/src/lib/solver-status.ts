/**
 * CC-BE-GOV-0110: truthful solver status rendering.
 * CC-BE-0112: capability-mismatch refusal label.
 *
 * Shared helpers that translate the engine-side telemetry landed by
 * CC-BE-GOV-0105..0107 into the single public vocabulary the workspace
 * chat prompt (CC-BE-GOV-0108) and artifact summaries render:
 *
 *   - "calibrated simulation"                     — solver ran with confirmed concordance
 *   - "engineering estimate"                      — solver ran but concordance is partial
 *   - "not computed"                              — no solver backing (unavailable /
 *                                                   validation_failed / dispatch_error /
 *                                                   not_registered / not_run / missing)
 *   - "blocked"                                   — hard_fail / promotion_blocked / solver veto
 *   - "unavailable"                               — platform has no applicable path
 *                                                   (reserved; use sparingly)
 *   - "not applicable to this technology family"  — a solver IS registered for this
 *                                                   domain, but the candidate's
 *                                                   declared axes (e.g., coolant_type)
 *                                                   fall outside the solver's
 *                                                   CapabilitySpec. Distinct from
 *                                                   "blocked" (a hard failure) and
 *                                                   "not computed" (no solver was
 *                                                   attempted): this says "solver
 *                                                   attempted, solver declined with
 *                                                   a specific mismatched-axis reason."
 *
 * Evaluations can carry multiple signals at once (e.g. a mock sidecar
 * run that still has ``physics_solver.status === "ran"``). The helpers
 * here apply a strict precedence:
 *
 *   0. blocked         (explicit hard_fail OR promotion_blocked always wins;
 *                       otherwise solver veto)
 *   1. not applicable  (status === "not_applicable" — solver declined candidate)
 *   2. mock/demo       (forces "engineering estimate" at best, with a
 *                       visible mock label — never "calibrated")
 *   3. solver-backed   (status === "ran" + confirmed concordance)
 *   4. screening       (status === "ran" + caveat concordance)
 *   5. not computed    (every other status, incl. missing payload)
 *
 * Consumers must read the exported helpers rather than re-implementing
 * the precedence locally — that's the lock against the Codex-identified
 * credibility-tier contradiction.
 */

export type SolverStatus =
  | "ran"
  | "unavailable"
  | "validation_failed"
  | "dispatch_error"
  | "not_registered"
  | "not_run"
  | "not_applicable";

export type MethodologyLabel =
  | "calibrated simulation"
  | "engineering estimate"
  | "not computed"
  | "blocked"
  | "unavailable"
  | "not applicable to this technology family";

export interface SolverStatusInput {
  physics_evaluation?: {
    verdict?: string;
    solver_status?: string;
    truth_tier?: string;
    hard_fail?: boolean;
    exergy_status?: string;
    status_reason?: string;
    solver_artifacts?: unknown[];
  } | null;
  physics_solver?: {
    status?: string;
    concordance_gate?: string;
    concordance?: number;
    // CC-BE-0112: capability-mismatch detail. Populated when the
    // solver declined the candidate (status === "not_applicable").
    // ``solver_veto_reason`` is a short human string naming the
    // mismatched axis; ``veto_detail`` exposes the structured parts
    // so renderers can re-compose the user-facing message.
    solver_veto_reason?: string;
    veto_detail?: {
      axis?: string;
      observed?: string;
      allowed?: string[];
    };
  } | null;
  hard_fail?: boolean;
  promotion_blocked?: boolean;
  solver_veto_reason?: string;
  mock_sidecar?: boolean;
}

/** The subset of SolverStatus values that indicate the solver ran AND
 * produced usable output. Anything else is "not solver-backed". */
export const SOLVER_BACKED_STATUSES: ReadonlySet<string> = new Set(["ran"]);

/** The subset of SolverStatus values we recognize as explicit failure
 * modes (as opposed to "never attempted"). Used for caveat strings. */
export const SOLVER_FAILURE_STATUSES: ReadonlySet<string> = new Set([
  "unavailable",
  "validation_failed",
  "dispatch_error",
]);

/** Return true iff the solver declined to evaluate the candidate
 * because the candidate's declared axes (coolant, moderator, fuel form,
 * etc.) fell outside the solver's CapabilitySpec. CC-BE-0112: this is
 * semantically distinct from "blocked" — no hard rule fired; the solver
 * simply is not designed for this technology family. The appropriate
 * user-facing message is a specific "not applicable to this technology
 * family" with the mismatched-axis detail, not a generic "blocked". */
export function isNotApplicable(input: SolverStatusInput): boolean {
  if (input.physics_evaluation?.solver_status) {
    return input.physics_evaluation.solver_status === "not_applicable";
  }
  return input.physics_solver?.status === "not_applicable";
}

/** Return true iff the evaluation is blocked (veto / hard_fail /
 * promotion_blocked). Blocked runs MUST NOT be rendered with readiness
 * or promising language; the renderer here keeps that contract single-
 * sourced.
 *
 * CC-BE-0112: ``not_applicable`` is explicitly excluded — it is a scope
 * mismatch, not a hard failure. Callers that need to exclude every
 * non-solver-backed state should use
 * ``!isBlocked(input) && !isNotApplicable(input)`` (or
 * ``allowsPositiveReadinessLanguage`` which already combines both). */
export function isBlocked(input: SolverStatusInput): boolean {
  if (input.hard_fail === true) return true;
  if (input.promotion_blocked === true) return true;
  if (isNotApplicable(input)) return false;
  const pe = input.physics_evaluation;
  if (pe) return pe.hard_fail === true || pe.verdict === "blocked";
  if (input.solver_veto_reason && input.solver_veto_reason.length > 0) return true;
  const gate = input.physics_solver?.concordance_gate;
  if (typeof gate === "string" && gate === "veto") return true;
  return false;
}

/** Return true iff the evaluation used mock/demo solver validation.
 * Mock-backed runs cap out at "engineering estimate" even if the solver
 * technically ran — a mock cannot claim calibration. */
export function isMockBacked(input: SolverStatusInput): boolean {
  return input.mock_sidecar === true;
}

/** Return true iff ``physics_solver.status === "ran"`` AND no blocking
 * condition applies. This is the only state where UI may use
 * "simulated", "computed", or "calibrated" language. */
export function isSolverBacked(input: SolverStatusInput): boolean {
  if (isBlocked(input)) return false;
  const pe = input.physics_evaluation;
  if (pe) {
    return pe.solver_status === "solver_backed"
      && Array.isArray(pe.solver_artifacts)
      && pe.solver_artifacts.length > 0;
  }
  const status = input.physics_solver?.status;
  return typeof status === "string" && SOLVER_BACKED_STATUSES.has(status);
}

export function allowsExergyValidatedLanguage(input: SolverStatusInput): boolean {
  const pe = input.physics_evaluation;
  return pe?.exergy_status === "computed" && isSolverBacked(input);
}

/** Primary renderer: map the governance telemetry onto the public
 * vocabulary from the chat prompt. Caller should treat the returned
 * label as final — do not re-map in consumer code.
 *
 * CC-BE-0112 keeps ``not_applicable`` distinct from generic solver veto,
 * but V0B hardens the higher-order safety rule: explicit legacy
 * hard_fail / promotion_blocked signals render as blocked even when a
 * solver also declined on applicability grounds. Callers that want both
 * the label AND the specific mismatched-axis detail should also call
 * ``renderNotApplicableDetail`` or read
 * ``input.physics_solver?.solver_veto_reason`` directly. */
export function renderMethodology(input: SolverStatusInput): MethodologyLabel {
  if (isBlocked(input)) return "blocked";
  if (isNotApplicable(input)) return "not applicable to this technology family";
  const pe = input.physics_evaluation;
  if (pe) {
    if (pe.solver_status === "solver_backed") {
      return pe.truth_tier === "reference_solver_concordance"
        ? "calibrated simulation"
        : "engineering estimate";
    }
    if (pe.solver_status === "parametric_only") return "engineering estimate";
    return "not computed";
  }
  const ps = input.physics_solver;
  const status = ps?.status;
  // Mock/demo: even when the solver technically ran, we refuse
  // "calibrated" — mock validation cannot claim calibration.
  if (isMockBacked(input)) {
    return status === "ran" ? "engineering estimate" : "not computed";
  }
  if (typeof status !== "string") {
    // No status payload at all — pre-0107 report, treat as unknown.
    return "not computed";
  }
  if (status === "ran") {
    const gate = ps?.concordance_gate;
    if (gate === "confirmed") return "calibrated simulation";
    if (gate === "caveat") return "engineering estimate";
    // Status "ran" with no gate / unknown gate: downgrade to an engineering estimate
    // rather than silently inflating to calibrated.
    return "engineering estimate";
  }
  // All other statuses (unavailable / validation_failed /
  // dispatch_error / not_registered / not_run) → no solver backing.
  return "not computed";
}

/** Return true iff positive readiness / "promising" language is allowed.
 * Blocks every state that must fail closed: hard_fail, promotion_blocked,
 * solver veto, AND solver-declined (not_applicable). CC-BE-0112: a
 * solver that refused the candidate for capability reasons cannot
 * justify positive readiness language — no physics was evaluated. */
export function allowsPositiveReadinessLanguage(
  input: SolverStatusInput,
): boolean {
  return !isBlocked(input) && !isNotApplicable(input);
}

/** Produce a short human caveat string when the evaluation cannot claim
 * solver backing. Returns null when the run was legitimately solver-
 * backed. Caller is responsible for prepending / appending to the
 * existing caveats list. */
export function renderNoBackingCaveat(
  input: SolverStatusInput,
): string | null {
  if (isBlocked(input)) {
    const reason = input.solver_veto_reason
      || (input.promotion_blocked ? "promotion_blocked" : "hard_fail");
    return `Result is blocked (${reason}); not solver-backed.`;
  }
  // CC-BE-0112: capability-mismatch next. The user wants specific
  // information ("not applicable to this technology family because
  // coolant=helium is not in the LWR solver's accepted set"), not a
  // generic "blocked" caveat that leaves them guessing what was
  // blocked or why. Explicit legacy blocking signals are handled above.
  if (isNotApplicable(input)) {
    const reason = input.physics_solver?.solver_veto_reason
      || "no applicable solver for this technology family";
    return (
      `Not applicable to this technology family (${reason}); ` +
      `no solver backing.`
    );
  }
  if (isMockBacked(input)) {
    return "Mock/demo validation — not solver-backed.";
  }
  if (isSolverBacked(input)) return null;
  const status = input.physics_solver?.status;
  if (typeof status === "string" && SOLVER_FAILURE_STATUSES.has(status)) {
    return `Physics solver ${status.replace(/_/g, " ")}; result not solver-backed.`;
  }
  if (status === "not_registered") {
    return "No family physics solver registered for this domain; result not solver-backed.";
  }
  // Missing / not_run / unknown → terse "not computed".
  return "Physics solver did not run; result not computed.";
}

/** Structured detail for "not applicable to this technology family"
 * — exposes axis name, observed value, and the allowed set so
 * consumers (PDF narrative, chat prose) can present the specific
 * mismatch the solver rejected on. Returns null when the evaluation
 * is not in the not-applicable state. CC-BE-0112. */
export function renderNotApplicableDetail(
  input: SolverStatusInput,
): { axis?: string; observed?: string; allowed?: string[]; reason?: string } | null {
  if (!isNotApplicable(input)) return null;
  const ps = input.physics_solver;
  return {
    axis: ps?.veto_detail?.axis,
    observed: ps?.veto_detail?.observed,
    allowed: ps?.veto_detail?.allowed,
    reason: ps?.solver_veto_reason,
  };
}
