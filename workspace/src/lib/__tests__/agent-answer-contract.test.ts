import { enforceAnswerContract } from "@/lib/agent-answer-contract";
import { buildDocumentEvidenceDigest } from "@/lib/document-evidence";
import type { Artifact, ProjectDocument } from "@/lib/storage/types";

function docWithEvidence(): ProjectDocument {
  const digest = buildDocumentEvidenceDigest(
    "equipment.csv",
    Buffer.from([
      "source_label,line_item,category,value,unit,basis,notes",
      "UTILITY-A,compressor_A,power,620,kW,nameplate,inlet filter fouling suspected",
      "UTILITY-A,pump_B,power,74,kW,metered,throttled valve 45 percent",
      "UTILITY-A,refrigeration_C,power,710,kW,metered,high condensing temp",
    ].join("\n")),
    "text/csv",
  );
  return {
    id: "doc-equipment",
    filename: "equipment.csv",
    mime_type: "text/csv",
    size_bytes: 100,
    status: "uploaded",
    uploaded_at: "2026-05-01T00:00:00.000Z",
    extraction_result: { document_evidence: digest },
  };
}

describe("agent answer contract (answer-first)", () => {
  it("does not append scaffolding to a verified high-stakes modeling answer", () => {
    const answer = "I found compressor_A at 620 kW, pump_B at 74 kW, and refrigeration_C at 710 kW.";
    const result = enforceAnswerContract({
      prompt: "Analyze this compressor, pump, and refrigeration utility log and rank efficiency opportunities.",
      answer,
      documents: [docWithEvidence()],
      artifactTexts: ["workspace simulation completed"],
    });

    expect(result.highStakes).toBe(true);
    expect(result.numericOrModeling).toBe(true);
    expect(result.executionStatus).toBe("verified");
    // Answer-first: the answer is returned as-is, with no forced sections.
    expect(result.answer).toBe(answer);
    expect(result.answer).not.toContain("## Source-Backed Input Summary");
    expect(result.answer).not.toContain("## Calculation Basis");
    expect(result.answer).not.toContain("## Support and Limits");
    expect(result.answer).not.toContain("## Scenario Reproducibility");
    expect(result.answer).not.toMatch(/^Downloads$/m);
  });

  it("adds a single short honest note when execution was not verified", () => {
    const artifact: Artifact = {
      id: "art-limited",
      schema_version: 1,
      type: "workspace_run",
      title: "Workspace",
      summary: "Best-effort report.",
      content: {
        execution: { exit_code: 1 },
        results: { completed_with_limitations: true, tool_execution_completed: false },
      },
      source: "ai_synthesis",
      raw: {},
      metadata: {},
      action_id: "act-1",
      provenance: { source: "ai_synthesis", deterministic: false },
      created_at: "2026-05-01T00:00:00.000Z",
      pinned: false,
    };

    const result = enforceAnswerContract({
      prompt: "Build a client-ready risk memo from this uploaded case.",
      answer: "I created a risk memo from the uploaded case.",
      documents: [docWithEvidence()],
      artifacts: [artifact],
    });

    expect(result.executionStatus).toBe("best_effort");
    expect(result.supportLimitsAdded).toBe(true);
    expect(result.answer).toContain("best-effort");
    // It is one short note, not a Support-and-Limits table.
    expect(result.answer).not.toContain("## Support and Limits");
    expect(result.answer).not.toContain("| What the data supports |");
  });

  it("does not duplicate the note when the answer already hedges", () => {
    const artifact: Artifact = {
      id: "art-limited-2",
      schema_version: 1,
      type: "workspace_run",
      title: "Workspace",
      summary: "Best-effort report.",
      content: { results: { tool_execution_completed: false } },
      source: "ai_synthesis",
      raw: {},
      metadata: {},
      action_id: "act-2",
      provenance: { source: "ai_synthesis", deterministic: false },
      created_at: "2026-05-01T00:00:00.000Z",
      pinned: false,
    };
    const answer = "Here is the estimate. Treat it as a best-effort screening-level result pending a clean rerun.";
    const result = enforceAnswerContract({
      prompt: "Run a techno-economic model from this uploaded note.",
      answer,
      documents: [docWithEvidence()],
      artifacts: [artifact],
    });
    expect(result.supportLimitsAdded).toBe(false);
    expect(result.answer).toBe(answer);
  });

  it("keeps simple follow-ups light and untouched", () => {
    const question = enforceAnswerContract({
      prompt: "Thanks — why is the kiln the best stream to start with?",
      answer: "Because it has the highest recoverable useful work for its temperature.",
      documents: [docWithEvidence()],
      followup: true,
    });
    expect(question.highStakes).toBe(false);
    expect(question.answer).toBe("Because it has the highest recoverable useful work for its temperature.");

    const fileRequest = enforceAnswerContract({
      prompt: "Can you export that ranking as a CSV file and give me the link?",
      answer: "Here is the CSV export of the ranking.",
      documents: [docWithEvidence()],
      followup: true,
    });
    expect(fileRequest.highStakes).toBe(false);
    expect(fileRequest.answer).not.toContain("## Support and Limits");
  });
});
