import { evaluateIntakeGate } from "@/lib/evidence-intake-gate";

describe("evaluateIntakeGate", () => {
  it("does not fail closed when there are no uploaded documents", () => {
    const result = evaluateIntakeGate({
      uploadedDocCount: 0,
      intakeFailures: [],
      evidencePathsUsed: [],
      evidenceFileSizesBytes: [],
      evalResultRunState: "client_grade",
      evalResultVerdict: "pass",
      evalResultSolverConfirmed: true,
    });

    expect(result.failClosed).toBe(false);
  });

  it("fails closed when the only uploaded document has an intake failure", () => {
    const result = evaluateIntakeGate({
      uploadedDocCount: 1,
      intakeFailures: [{ filename: "deck.pdf", error: "timed out" }],
      evidencePathsUsed: [],
      evidenceFileSizesBytes: [],
      evalResultRunState: "client_grade",
      evalResultVerdict: "pass",
      evalResultSolverConfirmed: true,
    });

    expect(result.failClosed).toBe(true);
    expect(result.gate0ValidationIssue).toMatch(/^\[Gate 0\] /);
  });

  it("fails closed when all uploaded documents are failed or thin evidence", () => {
    const result = evaluateIntakeGate({
      uploadedDocCount: 2,
      intakeFailures: [{ filename: "failed.pdf", error: "parse failed" }],
      evidencePathsUsed: ["runtime/evidence/thin_evidence.json"],
      evidenceFileSizesBytes: [499],
      evalResultRunState: "client_grade",
      evalResultVerdict: "pass",
      evalResultSolverConfirmed: true,
    });

    expect(result.failClosed).toBe(true);
  });

  it("does not fail closed when at least one uploaded document produced usable evidence", () => {
    const result = evaluateIntakeGate({
      uploadedDocCount: 2,
      intakeFailures: [{ filename: "failed.pdf", error: "parse failed" }],
      evidencePathsUsed: ["runtime/evidence/usable_evidence.json"],
      evidenceFileSizesBytes: [500],
      evalResultRunState: "client_grade",
      evalResultVerdict: "pass",
      evalResultSolverConfirmed: true,
    });

    expect(result.failClosed).toBe(false);
  });

  it("fails closed when an uploaded document has no failure and no evidence path", () => {
    const result = evaluateIntakeGate({
      uploadedDocCount: 1,
      intakeFailures: [],
      evidencePathsUsed: [],
      evidenceFileSizesBytes: [],
      evalResultRunState: "client_grade",
      evalResultVerdict: "pass",
      evalResultSolverConfirmed: true,
    });

    expect(result.failClosed).toBe(true);
  });

  it("returns downgrade fields when failing closed", () => {
    const result = evaluateIntakeGate({
      uploadedDocCount: 1,
      intakeFailures: [{ filename: "deck.pdf", error: "timed out" }],
      evidencePathsUsed: [],
      evidenceFileSizesBytes: [],
      evalResultRunState: "client_grade",
      evalResultVerdict: "pass",
      evalResultSolverConfirmed: true,
    });

    expect(result.downgradedRunState).toBe("debug");
    expect(result.downgradedVerdict).toBe("not_ready");
    expect(result.downgradedSolverConfirmed).toBe(false);
  });

  it("does not return downgrade fields when not failing closed", () => {
    const result = evaluateIntakeGate({
      uploadedDocCount: 1,
      intakeFailures: [],
      evidencePathsUsed: ["runtime/evidence/usable_evidence.json"],
      evidenceFileSizesBytes: [800],
      evalResultRunState: "client_grade",
      evalResultVerdict: "pass",
      evalResultSolverConfirmed: true,
    });

    expect(result.failClosed).toBe(false);
    expect(result.downgradedRunState).toBeUndefined();
    expect(result.downgradedVerdict).toBeUndefined();
    expect(result.downgradedSolverConfirmed).toBeUndefined();
  });
});
