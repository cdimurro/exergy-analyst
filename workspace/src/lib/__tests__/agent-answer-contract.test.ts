import { enforceAnswerContract } from "@/lib/agent-answer-contract";
import { buildDocumentEvidenceDigest } from "@/lib/document-evidence";
import type { AgentEvent, Artifact, ProjectDocument } from "@/lib/storage/types";

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

describe("agent answer contract", () => {
  it("adds support limits, source values, table structure, and calculation basis for high-stakes uploaded modelling answers", () => {
    const result = enforceAnswerContract({
      prompt: "Analyze this compressor, pump, and refrigeration utility log and rank efficiency opportunities.",
      answer: "I found compressor_A at 620 kW, pump_B at 74 kW, and refrigeration_C at 710 kW.",
      documents: [docWithEvidence()],
      artifactTexts: ["workspace tool_execution_completed true"],
    });

    expect(result.highStakes).toBe(true);
    expect(result.numericOrModeling).toBe(true);
    expect(result.answer).toContain("## Source-Backed Input Summary");
    expect(result.answer).toContain("## Calculation Basis");
    expect(result.answer).toContain("## Support and Limits");
    expect(result.answer).toContain("Calculation execution");
    expect(result.answer).toContain("verified");
  });

  it("labels nonzero executable outputs as best-effort in support limits", () => {
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
      prompt: "Export a client-ready risk memo from this uploaded case.",
      answer: "I created a risk memo from the uploaded case.",
      documents: [docWithEvidence()],
      artifacts: [artifact],
    });

    expect(result.executionStatus).toBe("best_effort");
    expect(result.answer).toContain("best effort");
    expect(result.answer).toContain("executable verification did not fully pass");
  });

  it("adds the structured support contract when an existing limits heading is incomplete", () => {
    const result = enforceAnswerContract({
      prompt: "Run a geothermal physics and economic screening model from this uploaded note.",
      answer: [
        "# Geothermal Result",
        "",
        "## Support and Limits",
        "- This screening uses constant reservoir temperature.",
        "- No well test or scaling chemistry was provided.",
      ].join("\n"),
      documents: [docWithEvidence()],
    });

    expect(result.supportLimitsAdded).toBe(true);
    expect(result.answer).toContain("| What the data supports |");
    expect(result.answer).toContain("| What it does not prove |");
    expect(result.answer).toContain("| Missing inputs |");
    expect(result.answer).toContain("| Calculation execution |");
  });

  it("replaces duplicate support sections with one normalized status block", () => {
    const events: AgentEvent[] = [
      {
        id: "evt-1",
        project_id: "project",
        run_id: "run",
        sequence: 1,
        type: "tool.failed",
        message: "workspace timed out",
        data: {},
        created_at: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "evt-2",
        project_id: "project",
        run_id: "run",
        sequence: 2,
        type: "tool.completed",
        message: "workspace completed",
        data: {},
        created_at: "2026-05-01T00:01:00.000Z",
      },
    ];
    const result = enforceAnswerContract({
      prompt: "Run a document-backed techno-economic model and export a PDF.",
      answer: [
        "# Result",
        "",
        "## Support and Limits",
        "- Calculations executed successfully: Yes",
        "",
        "Downloads",
        "- [Download report.md](#)",
        "",
        "## Support and Limits",
        "| Item | Status |",
        "|---|---|",
        "| Result status | Best-effort: useful output was preserved, but executable verification did not fully pass. |",
      ].join("\n"),
      documents: [docWithEvidence()],
      files: [{ filename: "report.md", mime_type: "text/markdown", run_id: "run", url: "/file/report.md" }],
      events,
    });

    expect(result.executionStatus).toBe("verified");
    expect(result.answer.match(/^## Support and Limits/gm)).toHaveLength(1);
    expect(result.answer).toContain("Verified after recovery");
    expect(result.answer).not.toContain("executable verification did not fully pass");
    expect(result.answer).toContain("Downloads");
  });

  it("adds scenario reproducibility requirements for changed-input follow-ups", () => {
    const result = enforceAnswerContract({
      prompt: "Now rerun with electricity price reduced by 50% and hold all other assumptions constant.",
      answer: "The lower electricity price improves the case.",
      documents: [docWithEvidence()],
      followup: true,
    });

    expect(result.answer).toContain("## Scenario Reproducibility");
    expect(result.answer).toContain("Changed inputs");
    expect(result.answer).toContain("Held constants");
    expect(result.answer).toContain("Assumption drift");
  });

  it("does not add scenario reproducibility for ordinary change metrics", () => {
    const result = enforceAnswerContract({
      prompt: "Extract the key values and calculate annual electricity use, emissions change, operating-cost change, payback, and exergy limitations.",
      answer: "The annual electricity use is 2,516 MWh and the emissions change is lower by 862 tCO2/year.",
      documents: [docWithEvidence()],
    });

    expect(result.scenarioSectionAdded).toBe(false);
    expect(result.answer).not.toContain("## Scenario Reproducibility");
  });
});
