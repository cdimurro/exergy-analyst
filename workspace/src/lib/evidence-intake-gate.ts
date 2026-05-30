export interface IntakeFailure {
  filename: string;
  error: string;
}

export interface IntakeGateInput {
  uploadedDocCount: number;
  intakeFailures: IntakeFailure[];
  evidencePathsUsed: string[];
  evidenceFileSizesBytes: number[];
  evalResultRunState: string | undefined;
  evalResultVerdict: string | undefined;
  evalResultSolverConfirmed: boolean | undefined;
}

export interface IntakeGateResult {
  failClosed: boolean;
  reason: string | null;
  gate0ValidationIssue: string | null;
  downgradedRunState: string | undefined;
  downgradedVerdict: string | undefined;
  downgradedSolverConfirmed: boolean | undefined;
  intakeFailureCaveat: string | null;
}

const MIN_USABLE_EVIDENCE_BYTES = 500;

function countUsableEvidenceFiles(
  evidencePathsUsed: string[],
  evidenceFileSizesBytes: number[],
): number {
  return evidencePathsUsed.reduce((count, path, index) => {
    if (!path) return count;
    const size = evidenceFileSizesBytes[index] ?? 0;
    return size >= MIN_USABLE_EVIDENCE_BYTES ? count + 1 : count;
  }, 0);
}

export function evaluateIntakeGate(input: IntakeGateInput): IntakeGateResult {
  const emptyResult: IntakeGateResult = {
    failClosed: false,
    reason: null,
    gate0ValidationIssue: null,
    downgradedRunState: undefined,
    downgradedVerdict: undefined,
    downgradedSolverConfirmed: undefined,
    intakeFailureCaveat: null,
  };

  if (input.uploadedDocCount <= 0) {
    return emptyResult;
  }

  const usableEvidenceCount = countUsableEvidenceFiles(
    input.evidencePathsUsed,
    input.evidenceFileSizesBytes,
  );
  if (usableEvidenceCount > 0) {
    return emptyResult;
  }

  const failedNames = input.intakeFailures
    .map((failure) => failure.filename)
    .filter((filename) => filename.trim().length > 0);
  const failureScope = failedNames.length > 0
    ? ` Uploaded files affected: ${failedNames.join(", ")}.`
    : "";
  const reason =
    "Uploaded documents did not produce usable extracted evidence for this assessment.";

  return {
    failClosed: true,
    reason,
    gate0ValidationIssue: `[Gate 0] ${reason}${failureScope}`,
    downgradedRunState: "debug",
    downgradedVerdict: "not_ready",
    downgradedSolverConfirmed: false,
    intakeFailureCaveat:
      "Uploaded documents could not be used as evidence for this assessment. Treat this output as an intake failure, not a technology evaluation.",
  };
}
