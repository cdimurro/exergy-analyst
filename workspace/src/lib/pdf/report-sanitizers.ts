export function isClientFacingGateResult(gate: Record<string, unknown>): boolean {
  const text = `${String(gate.gate_name || "")} ${String(gate.detail || "")}`.toLowerCase();
  // Claim-hygiene/rationalization gates are useful internally, but phrases like
  // "banned claims registered" read like product failures in a customer report.
  return !/\b(banned claims?|rationalization check|claim hygiene|internal claim)\b/.test(text);
}

export function clientFacingFinding(text: string): string {
  return text
    .replace(/\bBanned claims?:?[^.;\n]*(?:[.;]|$)/gi, "")
    .replace(/\b\d+\s+banned claims? registered\b[.;]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function hasPresentExergyMetric(brief: Record<string, unknown>): boolean {
  const thermo = brief.thermodynamic_quality;
  const thermoRecord = thermo && typeof thermo === "object" && !Array.isArray(thermo)
    ? thermo as Record<string, unknown>
    : {};

  return [
    brief.second_law_efficiency,
    brief.exergy_ceiling,
    brief.exergy_headroom,
    brief.exergy_quality_factor,
    thermoRecord.second_law_efficiency,
    thermoRecord.first_law_efficiency,
    thermoRecord.exergy_ceiling,
    thermoRecord.exergy_headroom,
    thermoRecord.quality_factor,
  ].some((value) => numericValue(value) !== null);
}

export function removeContradictoryUnavailableMetricPhrases(
  text: string,
  brief: Record<string, unknown>,
): string {
  if (!text || !hasPresentExergyMetric(brief)) return text;
  const unavailableExergySentence =
    /(?:^|(?<=[.!?]\s))[^.!?\n]*\b(?:exergy|exergetic|second[\s-]?law|thermodynamic quality)\b[^.!?\n]*\b(?:unavailable|not available|not provided|unknown|could not be calculated|cannot be calculated|was not calculated)\b[^.!?\n]*[.!?]/gi;

  return text
    .replace(unavailableExergySentence, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasDurableSolverArtifact(artifact: unknown): boolean {
  if (!isRecord(artifact)) return false;
  return Boolean(
    artifact.solver_name
    && artifact.solver_version
    && (artifact.artifact_uri || artifact.artifact_sha256),
  );
}

export function hasStructuredSolverBacking(brief: Record<string, unknown>): boolean {
  const physicsEvaluation = isRecord(brief.physics_evaluation) ? brief.physics_evaluation : {};
  const artifacts = Array.isArray(physicsEvaluation.solver_artifacts)
    ? physicsEvaluation.solver_artifacts
    : [];
  if (
    physicsEvaluation.solver_status === "solver_backed"
    && artifacts.some(hasDurableSolverArtifact)
  ) {
    return true;
  }

  const physicsSolver = isRecord(brief.physics_solver) ? brief.physics_solver : {};
  return physicsSolver.status === "ran" && physicsSolver.concordance_gate === "confirmed";
}

function hasStructuredExergyValidation(brief: Record<string, unknown>): boolean {
  const physicsEvaluation = isRecord(brief.physics_evaluation) ? brief.physics_evaluation : {};
  return physicsEvaluation.exergy_status === "computed" && hasStructuredSolverBacking(brief);
}

function isCaveatedUnsupportedClaim(sentence: string): boolean {
  return /\b(?:not|cannot|can't|without|until|pending|requires?|required|blocked|unavailable|unsupported|not yet|does not|do not|must not)\b/i.test(sentence);
}

function replaceUnsupportedClaimSentences(
  text: string,
  pattern: RegExp,
  replacement: string,
): string {
  const sentencePattern = /(?:^|(?<=[.!?]\s))[^.!?\n]*(?:[.!?]|$)/g;
  return text.replace(sentencePattern, (sentence) => {
    pattern.lastIndex = 0;
    if (!pattern.test(sentence)) return sentence;
    pattern.lastIndex = 0;
    if (isCaveatedUnsupportedClaim(sentence)) return sentence;
    return replacement;
  });
}

export function sanitizeUnsupportedMaturityClaims(
  text: string,
  brief: Record<string, unknown>,
): string {
  if (!text) return text;
  let sanitized = text;
  sanitized = replaceUnsupportedClaimSentences(
    sanitized,
    /\b(?:bankable|bankability|project[-\s]?finance[-\s]?ready|lender[-\s]?ready|investor[-\s]?grade returns?)\b/gi,
    "The current evidence does not establish bankability; finance readiness depends on sourced CAPEX, OPEX, utilization, revenue, financing, and operating-history inputs.",
  );
  sanitized = replaceUnsupportedClaimSentences(
    sanitized,
    /\b(?:decision[-\s]?grade|customer[-\s]?ready|deployment[-\s]?ready|commercially ready|commercial readiness)\b/gi,
    "The current evidence supports a bounded diligence view, not a final external-readiness conclusion.",
  );

  if (!hasStructuredSolverBacking(brief)) {
    sanitized = replaceUnsupportedClaimSentences(
      sanitized,
      /\b(?:solver[-\s]?backed|calibrated simulation|validated by simulation|simulation[-\s]?validated|physics proven)\b/gi,
      "Solver-backed validation is not established in the structured artifacts; treat the result as a bounded assessment until durable solver evidence exists.",
    );
  }
  if (!hasStructuredExergyValidation(brief)) {
    sanitized = replaceUnsupportedClaimSentences(
      sanitized,
      /\b(?:exergy[-\s]?validated|validated exergy|computed exergy|exergy computation confirms)\b/gi,
      "Exergy validation is not established without computed exergy status plus durable solver-backed artifact support.",
    );
  }

  return sanitized
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
