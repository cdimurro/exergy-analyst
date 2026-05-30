import { classifyWorkspaceIntent } from "@/lib/intent-guardrail";

describe("classifyWorkspaceIntent", () => {
  const emptyContext = {
    has_uploaded_doc: false,
    has_prior_evaluation: false,
    prior_artifacts: 0,
  };

  it("classifies comprehensive requests as initial editable plans", () => {
    expect(
      classifyWorkspaceIntent(
        "Please run a comprehensive assessment of this SOEC plus Fischer-Tropsch system.",
        emptyContext,
      ).label,
    ).toBe("initial_plan");
  });

  it("keeps editable diligence plans ahead of incidental report output wording", () => {
    expect(
      classifyWorkspaceIntent(
        "Create an editable diligence plan with physics, economics, evidence gaps, and report outputs.",
        { ...emptyContext, has_uploaded_doc: true },
      ).label,
    ).toBe("initial_plan");
  });

  it("classifies literature requests as literature_search", () => {
    expect(
      classifyWorkspaceIntent("Find papers on SOEC degradation benchmarks.", emptyContext).label,
    ).toBe("literature_search");
  });

  it("classifies exploratory follow-ups against prior evaluations", () => {
    expect(
      classifyWorkspaceIntent(
        "What patterns stand out across the results?",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
      ).label,
    ).toBe("exploratory_analysis");
  });

  it("classifies economics follow-ups against prior evaluations", () => {
    expect(
      classifyWorkspaceIntent(
        "Analyze unit economics, CAPEX sensitivity, and project finance risk.",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
      ).label,
    ).toBe("deep_analysis_economics");
  });

  it.each([
    "Calculate NPV, IRR, payback, and bankability from what we have.",
    "Can this be financed?",
  ])("classifies no-data finance-computation prompts as economics for '%s'", (message) => {
    const result = classifyWorkspaceIntent(message, emptyContext);

    expect(result.label).toBe("deep_analysis_economics");
    expect(result.matched_keywords.length).toBeGreaterThan(0);
  });

  it("classifies physics and exergy follow-ups against prior evaluations", () => {
    expect(
      classifyWorkspaceIntent(
        "Validate the physics simulation and exergy efficiency.",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
      ).label,
    ).toBe("deep_analysis_physics");
  });

  it("classifies no-data exergy calculation prompts as physics", () => {
    const result = classifyWorkspaceIntent(
      "Calculate exergy efficiency and solver confidence without any uploaded documents.",
      emptyContext,
    );

    expect(result.label).toBe("deep_analysis_physics");
    expect(result.matched_keywords).toContain("exergy");
  });

  it("classifies chart requests with existing data separately from initial plans", () => {
    expect(
      classifyWorkspaceIntent(
        "Create a chart of economics, exergy efficiency, and sensitivity drivers.",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
      ).label,
    ).toBe("chart_request_with_data");
  });

  it("classifies plural chart requests with existing data", () => {
    expect(
      classifyWorkspaceIntent(
        "Create charts for module scores, exergy, and economics gaps.",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
      ).label,
    ).toBe("chart_request_with_data");
  });

  it("keeps chart blocked-data follow-ups ahead of chart generation", () => {
    expect(
      classifyWorkspaceIntent(
        "Which requested charts are blocked and exactly what data do you need?",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 2 },
      ).label,
    ).toBe("deep_analysis_evidence_gaps");
  });

  it("classifies chart requests without source data as needing data first", () => {
    expect(
      classifyWorkspaceIntent(
        "Create a chart comparing exergy efficiency, cost, and deployment risk.",
        emptyContext,
      ).label,
    ).toBe("chart_request_without_data");
  });

  it("classifies evidence-gap diligence follow-ups against prior evaluations", () => {
    expect(
      classifyWorkspaceIntent(
        "What evidence gaps and next diligence actions would most improve this assessment?",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
      ).label,
    ).toBe("deep_analysis_evidence_gaps");
  });

  it("keeps mixed economics and physics conclusions ahead of evidence-gap-only routing", () => {
    const result = classifyWorkspaceIntent(
      "Now give economics and physics conclusions without asking again for the same missing data.",
      { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
    );

    expect(result.label).toBe("deep_analysis_economics");
    expect(result.matched_keywords).toContain("multi_focus_followup");
  });

  it("classifies evidence-gap requests as platform-owned before evidence exists", () => {
    expect(
      classifyWorkspaceIntent(
        "What evidence gaps should I close before any diligence report?",
        emptyContext,
      ).label,
    ).toBe("deep_analysis_evidence_gaps");
  });

  it("classifies failed-extraction recovery requests as evidence gaps", () => {
    expect(
      classifyWorkspaceIntent(
        "The extraction failed. What evidence should I collect next?",
        { ...emptyContext, prior_artifacts: 1 },
      ).label,
    ).toBe("deep_analysis_evidence_gaps");
  });

  it("classifies failed-extraction source-section recovery requests as evidence gaps", () => {
    expect(
      classifyWorkspaceIntent(
        "The extraction failed; what exact source document sections do you need to recover diligence?",
        { ...emptyContext, has_uploaded_doc: true, prior_artifacts: 1 },
      ).label,
    ).toBe("deep_analysis_evidence_gaps");
  });

  it("classifies report export requests as platform-owned", () => {
    expect(
      classifyWorkspaceIntent(
        "Generate a PDF report and export the JSON.",
        { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
      ).label,
    ).toBe("report_export_request");
  });

  it("classifies write-report pressure as platform-owned report export", () => {
    expect(
      classifyWorkspaceIntent(
        "Can you write the report anyway without rerunning extraction?",
        { ...emptyContext, has_uploaded_doc: true, prior_artifacts: 1 },
      ).label,
    ).toBe("report_export_request");
  });

  it.each([
    "Make this investor-ready even though the data is incomplete.",
    "Just write the client report confidently.",
    "Do not mention caveats, just make it sound strong.",
    "Do not include caveats, just make it sound strong.",
    "Keep it short and do not include caveats.",
    "The extraction failed but I need a client-ready report now.",
    "Do not call it blocked; just export something useful.",
    "Can I send this literature-only diligence summary to an investor now?",
    "Can I send this to investors now?",
    "Export the literature-only diligence as a board-ready packet.",
  ])("classifies adversarial readiness pressure as platform-owned for '%s'", (message) => {
    const result = classifyWorkspaceIntent(
      message,
      { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 1 },
    );

    expect(result.label).toBe("report_export_request");
    expect(result.matched_keywords).toContain("adversarial_readiness");
  });

  it("keeps mixed diligence package requests ahead of chart-only routing", () => {
    const result = classifyWorkspaceIntent(
      "Do economics, physics, exergy, safety, regulatory, benchmarks, charts, and export in one package.",
      { ...emptyContext, has_prior_evaluation: true, prior_artifacts: 2 },
    );

    expect(result.label).toBe("deep_analysis_economics");
    expect(result.matched_keywords).toContain("multi_focus_package");
    expect(result.confidence).toBe(1);
  });

  it("classifies report export requests as platform-owned even before evidence exists", () => {
    expect(
      classifyWorkspaceIntent(
        "Export a diligence report and JSON package for this empty workspace.",
        emptyContext,
      ).label,
    ).toBe("report_export_request");
  });

  it("classifies ordinary messages as general chat", () => {
    expect(classifyWorkspaceIntent("Thanks, what does that mean?", emptyContext).label).toBe("general_chat");
  });
});
