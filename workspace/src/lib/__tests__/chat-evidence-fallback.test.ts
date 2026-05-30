import {
  buildEvidenceEvaluationFallback,
  buildPlatformOwnedActionResponse,
  buildPlatformOwnedPlanResponse,
  ECONOMICS_REQUEST_NEEDS_SOURCE_DATA_REASON,
  FAILED_EXTRACTION_CHART_ECONOMICS_RECOVERY_REASON,
  classifyChartFocuses,
  EVIDENCE_GAP_FAILED_EXTRACTION_RECOVERY_REASON,
  messageHasAdversarialReadinessIntent,
  messageHasClientSynthesisIntent,
  messageHasComplexEvaluationIntent,
  messageHasEconomicsIntent,
  messageHasEvidenceGapIntent,
  messageHasEvaluationIntent,
  messageHasPhysicsFollowupIntent,
  messageHasPlanRequest,
  PHYSICS_REQUEST_NEEDS_SOURCE_DATA_REASON,
  reportEvidenceRequestsForStatus,
} from "@/lib/chat-evidence-fallback";
import type { InitialEvaluationProjectState } from "@/lib/initial-evaluation-guardrail";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type WorkflowOrchestration = {
  reason?: string;
  export_readiness?: string;
  extraction_status?: string;
  missing_evidence_requests?: string[];
};

const state: InitialEvaluationProjectState = {
  hasUploadedDocuments: true,
  hasSuccessfulEvaluationArtifact: false,
  hasChartableArtifact: false,
  domain: "fuels_chemical",
};

const project = {
  domain: "thermochemical_reactor",
  description: "Fischer-Tropsch information sheet",
  name: "FT evaluation",
};

const fallbackSource = readFileSync(
  join(__dirname, "../chat-evidence-fallback.ts"),
  "utf8",
);

function expectNoClientStatusLabels(content: string | undefined) {
  expect(content || "").not.toMatch(
    /Export readiness:|Extraction status:|Chart readiness:|Recovery status:|Economics and bankability status:|Physics and exergy status:|Evidence-gap review: blocked/i,
  );
}

function workflow(
  result: ReturnType<typeof buildPlatformOwnedActionResponse>
    | ReturnType<typeof buildEvidenceEvaluationFallback>
    | ReturnType<typeof buildPlatformOwnedPlanResponse>,
) {
  return result?.workflow_orchestration as WorkflowOrchestration | undefined;
}

describe("buildEvidenceEvaluationFallback", () => {
  it("keeps fallback copy free of decision-grade maturity pressure", () => {
    expect(fallbackSource).not.toMatch(/decision[-\s]?grade/i);
  });

  it.each([
    "analyze",
    "analysis",
    "evaluate",
    "evaluation",
    "assess",
    "assessment",
    "simulate",
    "simulation",
    "calculate",
    "calculation",
    "deployment readiness",
    "commercial readiness",
    "diligence",
    "investable",
    "investability",
    "report",
    "generate a report",
    "value",
  ])("returns an evidence evaluation action for '%s'", (token) => {
    const result = buildEvidenceEvaluationFallback({
      message: `Please ${token} this uploaded technology.`,
      state,
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("evidence_evaluation");
    expect(result?.action?.config).toMatchObject({
      domain: "thermochemical_reactor",
      description: "Fischer-Tropsch information sheet",
      brief: true,
    });
  });

  it("matches case-insensitively", () => {
    const result = buildEvidenceEvaluationFallback({
      message: "EVALUATE this",
      state,
      project,
    });

    expect(result?.action?.type).toBe("evidence_evaluation");
  });

  it("returns an editable plan for complex uploaded-document evaluations", () => {
    const result = buildEvidenceEvaluationFallback({
      message: "Please conduct a full techno-economic evaluation of this uploaded technology.",
      state,
      project,
    });

    expect(messageHasComplexEvaluationIntent("full techno-economic evaluation")).toBe(true);
    expect(result?.type).toBe("plan");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps?.[0]).toMatchObject({
      step: 1,
      title: "Evidence Intake",
      action_type: "evidence_evaluation",
      config: {
        domain: "thermochemical_reactor",
        description: "Fischer-Tropsch information sheet",
        brief: true,
      },
    });
    expect(result?.plan_steps?.map((step) => step.action_type)).toEqual([
      "evidence_evaluation",
      "literature_search",
      "deep_analysis",
      "deep_analysis",
      "deep_analysis",
      "exploratory_analysis",
      "deep_analysis",
      "deep_analysis",
    ]);
  });

  it("returns null when no documents are uploaded", () => {
    expect(
      buildEvidenceEvaluationFallback({
        message: "evaluate this",
        state: { ...state, hasUploadedDocuments: false },
        project,
      }),
    ).toBeNull();
  });

  it("returns null when a successful evaluation already exists", () => {
    expect(
      buildEvidenceEvaluationFallback({
        message: "evaluate this",
        state: { ...state, hasSuccessfulEvaluationArtifact: true },
        project,
      }),
    ).toBeNull();
  });

  it("returns null when the message has no matching token", () => {
    expect(
      buildEvidenceEvaluationFallback({
        message: "hi",
        state,
        project,
      }),
    ).toBeNull();
  });

  it("does not match devalue as value", () => {
    expect(
      buildEvidenceEvaluationFallback({
        message: "Please devalue this claim",
        state,
        project,
      }),
    ).toBeNull();
  });

  it.each([
    null,
    undefined,
    "",
    "hi",
    "hi there",
    "what is exergy?",
    "who built this reactor?",
    "please devalue this claim",
    "summarize the project status",
  ])("does not classify '%s' as evaluation intent", (message) => {
    expect(messageHasEvaluationIntent(message)).toBe(false);
  });

  it("carries project domain into action config", () => {
    const result = buildEvidenceEvaluationFallback({
      message: "calculate this uploaded technology",
      state,
      project,
    });

    expect(result?.action?.config?.domain).toBe("thermochemical_reactor");
  });

  it("classifies exergy simulation requests as complex", () => {
    expect(messageHasComplexEvaluationIntent(
      "Can you please run some simulations to calculate the exergetic efficiency?",
    )).toBe(true);
  });

  it("detects explicit plan requests", () => {
    expect(messageHasPlanRequest("Where's the plan you were supposed to create?")).toBe(true);
    expect(messageHasPlanRequest("Create a diligence workplan from the attachments.")).toBe(true);
  });

  it.each([
    "Calculate NPV, IRR, payback, and bankability from what we have.",
    "Can this be financed?",
    "What exact financial data do you need to compute this?",
  ])("detects finance-computation intent for '%s'", (message) => {
    expect(messageHasEconomicsIntent(message)).toBe(true);
  });

  it.each([
    "Calculate exergy efficiency and solver confidence without any uploaded documents.",
    "Give me solver-backed physics confidence.",
    "What thermodynamic variables are missing?",
  ])("detects physics and exergy follow-up intent for '%s'", (message) => {
    expect(messageHasPhysicsFollowupIntent(message)).toBe(true);
  });

  it("detects no-data honest diligence requests as evidence-gap intent", () => {
    expect(
      messageHasEvidenceGapIntent(
        "Tell me the fastest honest way to diligence this technology without pretending you already have data.",
      ),
    ).toBe(true);
  });

  it("detects failed-extraction source-section recovery as evidence-gap intent", () => {
    expect(
      messageHasEvidenceGapIntent(
        "The extraction failed; what exact source document sections do you need to recover diligence?",
      ),
    ).toBe(true);
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
    "Give a confident investor conclusion from the failed extraction only.",
  ])("detects adversarial readiness pressure for '%s'", (message) => {
    expect(messageHasAdversarialReadinessIntent(message)).toBe(true);
  });

  it("detects failed-extraction recovery requests as evidence-gap intent", () => {
    expect(messageHasEvidenceGapIntent("The extraction failed. What evidence should I collect next?")).toBe(true);
  });

  it.each([
    "Do not show platform internals; explain it like a diligence lead.",
    "Make it useful for a CEO.",
    "Now make it safe for a customer.",
    "Give me customer-safe language.",
  ])("detects sparse advisory phrasing for '%s'", (message) => {
    expect(messageHasClientSynthesisIntent(message)).toBe(true);
  });

  it("builds a dedicated failed-extraction recovery evidence request response", () => {
    const expectedRequests = reportEvidenceRequestsForStatus("failed");

    const result = buildPlatformOwnedActionResponse({
      message: "The extraction failed. What evidence should I collect next?",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        extractionStatus: "failed",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect((result?.content || "").trim().length).toBeGreaterThanOrEqual(80);
    expect((result?.content || "").toLowerCase()).toContain("source could not be converted");
    expectNoClientStatusLabels(result?.content);
    expect(result?.content).toContain("Re-run document extraction");
    expect(result?.content).toContain("page or section references");
    expect(result?.content).toContain("measured performance tables");
    expect(result?.content).toContain("third-party test report");
    expect(result?.content).toContain("CAPEX");
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: EVIDENCE_GAP_FAILED_EXTRACTION_RECOVERY_REASON,
      extraction_status: "failed",
    });
    expect(workflow(result)?.missing_evidence_requests).toEqual(expectedRequests);
  });

  it("answers failed-extraction source-section recovery without rerunning evaluation", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "The extraction failed; what exact source document sections do you need to recover diligence?",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "blocked",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: EVIDENCE_GAP_FAILED_EXTRACTION_RECOVERY_REASON,
      extraction_status: "failed",
      starts_with_evidence_intake: true,
    });
    expect(result?.content).toContain("could not be converted into a completed evaluation");
    expectNoClientStatusLabels(result?.content);
    expect(result?.content).toContain("page or section references");
    expect(result?.content).toContain("system boundary");
    expect(result?.content).toContain("operating conditions");
    expect(result?.content).toContain("measured performance tables");
  });

  it("keeps failed-extraction pages and tables recovery ahead of chart planning", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What is unusable versus recoverable from the failed extraction artifact, and what exact pages or tables do I need?",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "blocked",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: EVIDENCE_GAP_FAILED_EXTRACTION_RECOVERY_REASON,
      extraction_status: "failed",
      starts_with_evidence_intake: true,
    });
    expect(result?.content).toContain("could not be converted into a completed evaluation");
    expectNoClientStatusLabels(result?.content);
    expect(result?.content).toContain("page or section references");
    expect(result?.content).toContain("measured performance tables");
    expect(result?.content).not.toContain("client-facing chart");
  });

  it("routes thin-source pages tables and test-record prompts to evidence recovery instead of chart planning", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What pages, tables, or test records would most improve diligence?",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "partial",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(workflow(result)?.reason).toBe("source_evidence_recovery_request_detected");
    expect(result?.content).toContain("source evidence");
    expect(result?.content).toContain("Measured performance tables");
    expect(result?.content).toContain("Test records");
    expect(result?.content).toContain("provenance note");
    expect(result?.content).not.toContain("client-facing chart");
    expectNoClientStatusLabels(result?.content);
  });

  it("turns thin extraction evidence requests into concrete source requests instead of a generic action", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Turn the failed or thin extraction into a high-value evidence request.",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "partial",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(workflow(result)?.reason).toBe("source_evidence_recovery_request_detected");
    expect(result?.content).toContain("targeted data-room request");
    expect(result?.content).toContain("CAPEX");
    expect(result?.content).toContain("OPEX");
    expect(result?.content).toContain("third-party validation");
    expect(result?.content).toContain("Recommended next action");
    expectNoClientStatusLabels(result?.content);
  });

  it("treats source-table requests as evidence recovery rather than chart requests", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Which source tables should I ask the counterparty for first?",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("source_evidence_recovery_request_detected");
    expect(result?.content).toContain("source evidence");
    expect(result?.content).toContain("Economics source tables");
    expect(result?.content).not.toContain("client-facing chart");
  });

  it("blocks failed-extraction chart and bankability pressure with recovery evidence requests", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Now create charts and bankability conclusions anyway from the failed extraction.",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "blocked",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: FAILED_EXTRACTION_CHART_ECONOMICS_RECOVERY_REASON,
      extraction_status: "failed",
      export_readiness: "blocked",
      starts_with_evidence_intake: true,
    });
    expect(result?.content).toContain("current extraction cannot support charts or bankability claims");
    expect(result?.content).toContain("source extraction failed");
    expect(result?.content).toContain("Charts cannot be produced");
    expect(result?.content).toContain("Economics and bankability conclusions cannot be supported");
    expectNoClientStatusLabels(result?.content);
    expect(result?.content).toContain("NPV, IRR, payback, LCOE, LCOS, and financing readiness are not computed");
    expect(result?.content).toContain("Re-run document extraction");
    expect(result?.content).toContain("parseable source document");
    expect(result?.content).toContain("CAPEX");
    expect(result?.content).toContain("OPEX");
    expect(result?.content).toContain("utilization");
    expect(result?.content).toContain("WACC");
    expect(result?.content).toContain("revenue or price stack");
  });

  it("blocks failed-extraction finance-chart conclusions without rerunning extraction", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Create finance charts and a bankability conclusion from the failed extraction without rerunning it.",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "blocked",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: FAILED_EXTRACTION_CHART_ECONOMICS_RECOVERY_REASON,
      extraction_status: "failed",
      export_readiness: "blocked",
      starts_with_evidence_intake: true,
    });
    expect(result?.content).toContain("current extraction cannot support charts or bankability claims");
    expect(result?.content).toContain("source extraction failed");
    expect(result?.content).toContain("Charts cannot be produced");
    expect(result?.content).toContain("Economics and bankability conclusions cannot be supported");
    expectNoClientStatusLabels(result?.content);
    expect(result?.content).toContain("NPV, IRR, payback, LCOE, LCOS, and financing readiness are not computed");
    expect(result?.content).toContain("parseable source document");
    expect(result?.content).toContain("CAPEX");
    expect(result?.content).toContain("OPEX");
    expect(result?.content).toContain("WACC");
    expect(result?.content).toContain("revenue or price stack");
  });

  it("routes literature-only investor send readiness to structural export readiness", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Can I send this literature-only diligence summary to an investor now?",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "none",
        exportReadiness: "conditionally_ready",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "adversarial_readiness_request_detected",
      export_readiness: "conditionally_ready",
      extraction_status: "none",
    });
    expect(result?.content).toMatch(/useful as an internal diligence note|can support an internal diligence note/i);
    expect(result?.content).toContain("cannot omit material caveats");
    expect(result?.content).toContain("computed NPV, IRR, LCOE, LCOS, payback");
    expect(result?.content).toContain("solver-backed validation");
    expect(result?.content).toContain("Provide source documents or artifacts with metrics, units, provenance, and operating basis");
    expectNoClientStatusLabels(result?.content);
  });

  it("routes concise plural investor-send readiness to structural export readiness", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Can I send this to investors now?",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "none",
        exportReadiness: "conditionally_ready",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "adversarial_readiness_request_detected",
      export_readiness: "conditionally_ready",
      extraction_status: "none",
    });
    expect(result?.content).toMatch(/useful as an internal diligence note|can support an internal diligence note/i);
    expect(result?.content).toContain("cannot omit material caveats");
    expect(result?.content).toContain("solver-backed validation");
    expectNoClientStatusLabels(result?.content);
  });

  it("routes board-ready packet export pressure to caveated readiness", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Export the literature-only diligence as a board-ready packet.",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "none",
        exportReadiness: "conditionally_ready",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "adversarial_readiness_request_detected",
      export_readiness: "conditionally_ready",
      extraction_status: "none",
    });
    expect(result?.content).toMatch(/useful as an internal diligence note|can support an internal diligence note/i);
    expect(result?.content).toContain("decision-ready");
    expect(result?.content).not.toMatch(/click.*Export Report.*board-ready|downloadable PDF with the full literature review/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("blocks report writing pressure after failed extraction without rerunning extraction", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Can you write the report anyway without rerunning extraction?",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "blocked",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "report_export_request_detected",
      export_readiness: "blocked",
      extraction_status: "failed",
    });
    expect(result?.content).toMatch(/not (?:yet )?suitable for an external diligence report/i);
    expect(result?.content).toContain("source extraction failed");
    expect(result?.content).toMatch(/PDF assessment (?:export|readiness)/i);
    expect(result?.content).toContain("page or section references");
    expect(result?.content).toMatch(/solver-backed (?:conclusions|validation)/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("routes no-caveats follow-up pressure to caveated readiness", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Keep it short and do not include caveats.",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "none",
        exportReadiness: "conditionally_ready",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "adversarial_readiness_request_detected",
      export_readiness: "conditionally_ready",
      extraction_status: "none",
    });
    expect(result?.content).toMatch(/useful as an internal diligence note|can support an internal diligence note/i);
    expect(result?.content).toContain("cannot omit material caveats");
    expect(result?.content).toContain("computed NPV, IRR, LCOE, LCOS, payback");
    expect(result?.content).toContain("solver-backed validation");
    expectNoClientStatusLabels(result?.content);
  });

  it("classifies multiple chart focus categories in priority order", () => {
    expect(classifyChartFocuses("chart of LCOE versus exergy efficiency").map((focus) => focus.label)).toEqual([
      "economics",
      "performance",
    ]);
    expect(classifyChartFocuses("hi")).toEqual([]);
    expect(classifyChartFocuses(null)).toEqual([]);
    expect(classifyChartFocuses("chart of LCOE and capex").map((focus) => focus.label)).toEqual(["economics"]);
  });

  it("builds a platform-owned intake-first plan for complex uploaded-document requests", () => {
    const result = buildPlatformOwnedPlanResponse({
      message: "Can you please run some simulations in order to calculate the exergetic efficiency?",
      state,
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "complex_request_detected",
      has_successful_evaluation: false,
      starts_with_evidence_intake: true,
    });
    expect(result?.plan_steps?.[0].action_type).toBe("evidence_evaluation");
  });

  it("builds a platform-owned research-first plan for complex requests without uploads", () => {
    const result = buildPlatformOwnedPlanResponse({
      message: "Please conduct a comprehensive assessment.",
      state: { ...state, hasUploadedDocuments: false },
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "complex_request_detected",
      starts_with_evidence_intake: false,
    });
    expect(result?.plan_steps?.[0].action_type).toBe("literature_search");
    expect(result?.content).toContain("starts with research");
  });

  it("builds a platform-owned follow-on plan after evaluation exists", () => {
    const result = buildPlatformOwnedPlanResponse({
      message: "Where's the plan you were supposed to create?",
      state: { ...state, hasSuccessfulEvaluationArtifact: true },
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "explicit_plan_request",
      has_successful_evaluation: true,
      starts_with_evidence_intake: false,
    });
    expect(result?.plan_steps?.map((s) => s.action_type)).toEqual([
      "literature_search",
      "deep_analysis",
      "deep_analysis",
      "deep_analysis",
      "deep_analysis",
      "exploratory_analysis",
      "deep_analysis",
    ]);
    expect(result?.plan_steps?.some((s) => s.action_type === "evidence_evaluation")).toBe(false);
  });

  it("preserves mixed diligence package requests instead of collapsing to chart-only", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Do economics, physics, exergy, safety, regulatory, benchmarks, charts, and export in one package.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: true,
        exportReadiness: "conditionally_ready",
        extractionStatus: "partial",
      },
      project,
    });

    expect(result?.type).toBe("action");
    expect(workflow(result)?.reason).toBe("multi_focus_followup_detected");
    expect(result?.action?.type).toBe("deep_analysis");
    expect(result?.content).toContain("report export readiness");
    expect(result?.action?.config?.question).toContain("bankability and economics");
    expect(result?.action?.config?.question).toContain("chart readiness");
  });

  it("blocks adversarial investor-ready wording with partial extraction", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Make this investor-ready even though the data is incomplete.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        exportReadiness: "conditionally_ready",
        extractionStatus: "partial",
        reportEvidenceRequests: [
          "Provide CAPEX, OPEX, utilization, financing, revenue, and incumbent baseline with source basis.",
          "Provide operating regime details including temperature, pressure, flows, composition, reference environment, and system boundary.",
        ],
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(workflow(result)?.reason).toBe("adversarial_readiness_request_detected");
    expect(workflow(result)?.export_readiness).toBe("conditionally_ready");
    expect(workflow(result)?.extraction_status).toBe("partial");
    expect(result?.content).toContain("cannot omit material caveats");
    expect(result?.content).toMatch(/useful as an internal diligence note|can support an internal diligence note/i);
    expect(result?.content).toContain("source extraction is partial");
    expect(result?.content).toMatch(/not computed|computed NPV|numeric charts|solver-backed validation/i);
    expect(result?.content).toContain("CAPEX");
    expect(result?.content).toContain("temperature");
    expectNoClientStatusLabels(result?.content);
  });

  it("preserves chart readiness inside adversarial chart and report package requests", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Generate a board-ready chart and report package using module scores, economics, and exergy.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: true,
        hasAnyArtifact: true,
        exportReadiness: "conditionally_ready",
        extractionStatus: "partial",
        reportEvidenceRequests: [
          "Provide the missing extracted metrics with units and source page references.",
          "Provide economics inputs including CAPEX, OPEX, utilization, replacement cadence, financing, and incumbent baseline.",
        ],
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(workflow(result)?.reason).toBe("adversarial_readiness_request_detected");
    expect(workflow(result)?.export_readiness).toBe("conditionally_ready");
    expect(result?.content).toMatch(/useful as an internal diligence note|can support an internal diligence note/i);
    expect(result?.content).toContain("existing project artifacts can be used only where they already contain real values");
    expect(result?.content).toContain("does not invent chart values");
    expect(result?.content).toContain("computed NPV, IRR, LCOE, LCOS, payback");
    expect(result?.content).toContain("solver-backed validation");
    expectNoClientStatusLabels(result?.content);
  });

  it("blocks adversarial client-ready report wording with failed extraction", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "The extraction failed but I need a client-ready report now.",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        exportReadiness: "blocked",
        extractionStatus: "failed",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(workflow(result)?.reason).toBe("adversarial_readiness_request_detected");
    expect(workflow(result)?.export_readiness).toBe("blocked");
    expect(workflow(result)?.extraction_status).toBe("failed");
    expect(result?.content).toMatch(/not (?:yet )?suitable for an external diligence report/i);
    expect(result?.content).toContain("source extraction failed");
    expect(result?.content).toContain("cannot omit material caveats");
    expect(result?.content).toMatch(/not computed|computed NPV|numeric charts|solver-backed validation/i);
    expect(result?.content).toContain("parseable");
    expect(result?.content).toContain("third-party test report");
    expect(result?.content).toContain("CAPEX");
    expect(result?.content).not.toMatch(/investor-ready report|client-ready report|ready for export|PDF report is ready/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("blocks confident investor conclusions from failed extraction only", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Give a confident investor conclusion from the failed extraction only.",
      state: {
        ...state,
        hasUploadedDocuments: true,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        exportReadiness: "blocked",
        extractionStatus: "failed",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(workflow(result)?.reason).toBe("adversarial_readiness_request_detected");
    expect(workflow(result)?.export_readiness).toBe("blocked");
    expect(workflow(result)?.extraction_status).toBe("failed");
    expect(result?.content).toMatch(/not (?:yet )?suitable for an external diligence report/i);
    expect(result?.content).toContain("source extraction failed");
    expect(result?.content).toContain("cannot omit material caveats");
    expect(result?.content).toMatch(/not computed|computed NPV|numeric charts|solver-backed validation/i);
    expect(result?.content).not.toMatch(/1,000 hours|not investable until/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("answers chart blocked-data follow-ups instead of launching another chart action", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Which requested charts are blocked and exactly what data do you need?",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: true,
        exportReadiness: "conditionally_ready",
        extractionStatus: "partial",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(workflow(result)?.reason).toBe("chart_data_request_detected");
    expect(result?.content).toMatch(/Some chart inputs may already exist|Some charts may be possible from existing artifact values/i);
    expect(result?.content).toContain("metric");
    expect(result?.content).toContain("unit");
    expect(result?.content).toContain("source");
    expect(result?.content).toContain("operating regime");
    expect(result?.content).toMatch(/solver or test artifact|solver, simulation, or test artifact/i);
    expect(result?.content).toMatch(/uncomputed solver claims|solver-backed exergy chart values are not computed, unavailable, or blocked/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("answers chart wait-for-data prompts with useful chart guidance", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What chart should wait for data?",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
        extractionStatus: "none",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(workflow(result)?.reason).toBe("chart_data_request_detected");
    expect(result?.content).toContain("Useful takeaway");
    expect(result?.content).toMatch(/Economics sensitivity|economics sensitivity or customer-value chart/i);
    expect(result?.content).toContain("CAPEX");
    expect(result?.content).toContain("temperature");
    expect(result?.content).toContain("Recommended next action");
    expectNoClientStatusLabels(result?.content);
  });

  it("routes simple literature requests directly to literature search", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Find papers on SOEC degradation and published benchmarks.",
      state: { ...state, hasUploadedDocuments: false },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("literature_search");
    expect(result?.action?.config?.query).toContain("SOEC degradation");
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "research_request_detected",
    });
  });

  it("routes chart requests with existing artifacts to exploratory chart analysis", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Create a chart of economics and sensitivity drivers.",
      state: { ...state, hasSuccessfulEvaluationArtifact: true, hasChartableArtifact: true, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("exploratory_analysis");
    expect(result?.action?.config?.analysis_type).toBe("sensitivity");
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "chart_request_detected",
    });
  });

  it("preserves report export readiness when chart and export are both requested", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Create the charts and export the report package.",
      state: { ...state, hasSuccessfulEvaluationArtifact: true, hasChartableArtifact: true, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toMatch(/completed evaluation artifact available|exported from the existing evaluation/i);
    expect(result?.content).toMatch(/For charts/i);
    expect(result?.content).toMatch(/does not invent chart values/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "report_export_request_detected",
      export_readiness: "ready",
    });
  });

  it("preserves secondary diligence intents instead of routing multi-focus chart requests to chart-only analysis", () => {
    const result = buildPlatformOwnedActionResponse({
      message:
        "In one answer, summarize bankability, physics/exergy confidence, chart readiness, evidence gaps, and whether the report can be exported.",
      state: { ...state, hasSuccessfulEvaluationArtifact: true, hasChartableArtifact: true, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("deep_analysis");
    expect(result?.content).toMatch(/combined diligence/i);
    expect(result?.content).toMatch(/not computed|blocked|unavailable/i);
    expect(result?.action?.config?.question).toMatch(/CAPEX|bankability/i);
    expect(result?.action?.config?.question).toMatch(/temperature|pressure|reference environment|boundary/i);
    expect(result?.action?.config?.question).toMatch(/chart readiness/i);
    expect(result?.action?.config?.question).toMatch(/export readiness/i);
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "multi_focus_followup_detected",
    });
  });

  it("preserves economics and physics conclusions ahead of evidence-gap-only routing", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Now give economics and physics conclusions without asking again for the same missing data.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: true,
        hasAnyArtifact: true,
        extractionStatus: "partial",
        exportReadiness: "conditionally_ready",
        reportEvidenceRequests: reportEvidenceRequestsForStatus("partial"),
      },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("deep_analysis");
    expect(result?.content).toMatch(/combined economics and physics\/exergy follow-up/i);
    expect(result?.content).toMatch(/NPV|IRR|LCOE|LCOS|payback/i);
    expect(result?.content).toMatch(/not computed|unavailable|blocked/i);
    expect(result?.action?.config?.question).toMatch(/CAPEX|OPEX|bankability/i);
    expect(result?.action?.config?.question).toMatch(/temperature|pressure|flows|composition|reference environment/i);
    expect(result?.action?.config?.question).toMatch(/Do not ask again/i);
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "multi_focus_followup_detected",
      extraction_status: "partial",
      export_readiness: "conditionally_ready",
    });
  });

  it("turns chart requests without source data into a research-first chart plan", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "show a chart",
      state: {
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
      },
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.plan_steps?.[0].action_type).toBe("literature_search");
    expect(result?.plan_steps?.[0].config?.query).toBe(
      "Fischer-Tropsch information sheet published benchmarks performance economics safety regulatory deployment",
    );
    expect(result?.content).toMatch(/Chart package plan|targeted data-gathering plan|one-page chart data request/i);
    expect(result?.content).toMatch(/metric/i);
    expect(result?.content).toMatch(/unit/i);
    expect(result?.content).toMatch(/operating regime|time basis/i);
    expect(result?.content).toMatch(/source artifact/i);
    expect(result?.content).toMatch(/next action/i);
    expect(result?.plan_steps?.some((s) => s.action_type === "exploratory_analysis")).toBe(true);
    const chartStep = result?.plan_steps?.find((s) => s.action_type === "exploratory_analysis");
    expect(chartStep?.config?.question).toMatch(/missing metric/i);
    expect(chartStep?.config?.question).toMatch(/unit/i);
    expect(chartStep?.config?.question).toMatch(/operating regime|time basis/i);
    expect(chartStep?.config?.question).toMatch(/source artifact/i);
    expect(chartStep?.config?.question).toMatch(/next action/i);
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "chart_request_needs_source_data",
    });
  });

  it("carries economics chart focus into the no-data research plan", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Make a chart of LCOE and capex.",
      state: {
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
      },
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.plan_steps?.[0].config?.query).toMatch(/economics|lcoe|capex/i);
    expect(result?.content).toContain("economics");
  });

  it("carries performance and exergy chart focus into the no-data research plan", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "chart exergy efficiency vs temperature",
      state: {
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
      },
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.plan_steps?.[0].config?.query).toMatch(/exergy|performance|efficiency/i);
    expect(result?.content).toMatch(/performance|exergy/i);
  });

  it("carries multiple chart focuses into the no-data research plan", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Make a chart of LCOE and exergy efficiency.",
      state: {
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
      },
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.content).toContain("economics");
    expect(result?.content).toMatch(/Technical performance|performance and exergy|Exergy or physics boundary/i);
    expect(result?.plan_steps?.[0].config?.query).toMatch(/economics/i);
    expect(result?.plan_steps?.[0].config?.query).toMatch(/exergy|performance/i);
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "chart_request_needs_source_data",
    });
  });

  it("does not treat prose-only artifacts as chart source data", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Make a chart comparing exergy efficiency and cost.",
      state: {
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
      },
      project,
    });

    expect(result?.type).toBe("plan");
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "chart_request_needs_source_data",
    });
  });

  it("uses exploratory chart analysis when a chartable non-evaluation artifact exists", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Make a chart comparing exergy efficiency and cost.",
      state: {
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: true,
        hasAnyArtifact: true,
      },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("exploratory_analysis");
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "chart_request_detected",
    });
  });

  it("routes evidence-gap diligence follow-ups to grounded deep analysis", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What evidence gaps and next diligence actions would most improve this assessment?",
      state: { ...state, hasSuccessfulEvaluationArtifact: true, hasChartableArtifact: true, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("deep_analysis");
    expect(result?.action?.config?.question).toContain("evidence gaps");
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "evidence_gap_followup_detected",
    });
  });

  it("blocks evidence-gap review without source evidence and returns concrete requests", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What evidence gaps should I close before any diligence report?",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
        extractionStatus: "none",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toMatch(/next diligence move can be specific now|diligence request can be targeted now/i);
    expect(result?.content).toMatch(/Source-backed performance measurements|measured performance metrics, units, operating regime, and provenance/i);
    expect(result?.content).toMatch(/minimum viable evidence request|CAPEX, OPEX, utilization/i);
    expect(result?.content).toMatch(/System boundary|temperature, pressure, flows, composition/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "evidence_gap_request_needs_source_data",
      extraction_status: "none",
      starts_with_evidence_intake: true,
    });
    expect(workflow(result)?.missing_evidence_requests).toEqual([
      "Upload or identify source documents with measured performance metrics, units, operating regime, and provenance so extraction absence is not mistaken for true evidence absence.",
      "Provide economics inputs including CAPEX, OPEX, utilization, replacement cadence, financing assumptions, price or revenue basis, and incumbent baseline with source basis.",
      "Provide physical boundary inputs including temperature, pressure, flows, composition, reference environment, duty cycle, and system boundary for physics or exergy review.",
    ]);
  });

  it("routes no-data honest diligence guidance to platform-owned evidence requests", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Tell me the fastest honest way to diligence this technology without pretending you already have data.",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
        extractionStatus: "none",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toMatch(/next diligence move can be specific now|diligence request can be targeted now/i);
    expect(result?.content).toMatch(/Source-backed performance measurements|measured performance metrics, units, operating regime, and provenance/i);
    expect(result?.content).toMatch(/minimum viable evidence request|CAPEX, OPEX, utilization/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "evidence_gap_request_needs_source_data",
      extraction_status: "none",
    });
  });

  it("blocks no-data bankability and financing claims with concrete economics inputs", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Can this be financed?",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
        extractionStatus: "none",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: ECONOMICS_REQUEST_NEEDS_SOURCE_DATA_REASON,
      extraction_status: "none",
      starts_with_evidence_intake: true,
    });
    expect(workflow(result)?.missing_evidence_requests?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(result?.content).toMatch(/screened for financing risk|financing diligence can be scoped now/i);
    expect(result?.content).toMatch(/NPV, IRR, payback|NPV and IRR need/i);
    expect(result?.content).toContain("CAPEX");
    expect(result?.content).toContain("OPEX");
    expect(result?.content).toContain("utilization");
    expect(result?.content).toContain("degradation");
    expect(result?.content).toContain("WACC");
    expect(result?.content).toContain("revenue or price stack");
    expect(result?.content).toContain("market segment");
    expect(result?.content).toContain("incumbent baseline");
    expect(result?.content).not.toMatch(/\b\d{1,2}\s*-\s*\d{1,2}%\b/);
    expect(result?.content).not.toMatch(/investment-grade|take-or-pay|lender hurdle/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("keeps uploaded-document economics requests intake-first while marking calculations blocked", () => {
    const result = buildEvidenceEvaluationFallback({
      message: "Analyze the unit economics and bankability from the uploaded document.",
      state,
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.action?.type).toBe("evidence_evaluation");
    expect(result?.content).toMatch(/economics|bankability/i);
    expect(result?.content).toMatch(/not computed|blocked/i);
    expect(result?.content).toMatch(/CAPEX|OPEX|utilization|financing|revenue|baseline/i);
  });

  it("marks economics calculations as not computed until required bankability evidence exists", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Analyze unit economics, CAPEX sensitivity, utilization, and project finance bankability.",
      state: { ...state, hasSuccessfulEvaluationArtifact: true, hasChartableArtifact: true, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.content).toMatch(/not computed|blocked/i);
    expect(result?.action?.config?.question).toMatch(/CAPEX/i);
    expect(result?.action?.config?.question).toMatch(/OPEX/i);
    expect(result?.action?.config?.question).toMatch(/utilization/i);
    expect(result?.action?.config?.question).toMatch(/maintenance|replacement/i);
    expect(result?.action?.config?.question).toMatch(/financing|WACC/i);
    expect(result?.action?.config?.question).toMatch(/revenue|price/i);
    expect(result?.action?.config?.question).toMatch(/incumbent|baseline/i);
    expect(result?.action?.config?.question).toMatch(/LCOE|LCOS|IRR|NPV|payback/i);
    expect(result?.action?.config?.question).toMatch(/not computed|blocked/i);
  });

  it("marks physics and exergy calculations as not computed until solver state variables exist", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Validate the physics and exergy result. What thermodynamic state variables are missing?",
      state: { ...state, hasSuccessfulEvaluationArtifact: true, hasChartableArtifact: true, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("action");
    expect(result?.content).toMatch(/not computed|blocked/i);
    expect(result?.action?.config?.question).toMatch(/solver/i);
    expect(result?.action?.config?.question).toMatch(/temperature/i);
    expect(result?.action?.config?.question).toMatch(/pressure/i);
    expect(result?.action?.config?.question).toMatch(/flow/i);
    expect(result?.action?.config?.question).toMatch(/composition/i);
    expect(result?.action?.config?.question).toMatch(/reference environment/i);
    expect(result?.action?.config?.question).toMatch(/boundary/i);
    expect(result?.action?.config?.question).toMatch(/not computed|unavailable|blocked/i);
  });

  it("blocks no-data exergy and solver-confidence requests with concrete thermodynamic inputs", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Calculate exergy efficiency and solver confidence without any uploaded documents.",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
        extractionStatus: "none",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.plan_steps).toBeNull();
    expect(result?.workflow_orchestration).toMatchObject({
      reason: PHYSICS_REQUEST_NEEDS_SOURCE_DATA_REASON,
      extraction_status: "none",
      starts_with_evidence_intake: true,
    });
    expect(workflow(result)?.missing_evidence_requests?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(result?.content).toMatch(/mechanism can be screened|mechanism can be framed/i);
    expect(result?.content).toContain("Exergy efficiency is not computed");
    expect(result?.content).toContain("solver-backed confidence is unavailable");
    expect(result?.content).toContain("system boundary");
    expect(result?.content).toContain("operating regime");
    expect(result?.content).toContain("temperature");
    expect(result?.content).toContain("pressure");
    expect(result?.content).toContain("flow");
    expect(result?.content).toContain("composition");
    expect(result?.content).toContain("reference environment");
    expect(result?.content).toContain("heat");
    expect(result?.content).toContain("work");
    expect(result?.content).not.toMatch(/solver-backed (validation|confidence) (is|was) (confirmed|validated|computed)/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("handles report and export requests without inventing downloadable files", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Generate a PDF report and export the JSON.",
      state: { ...state, hasSuccessfulEvaluationArtifact: true, hasChartableArtifact: true, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toContain("report export flow");
    expect(result?.content).toContain("JSON export control");
    expect(result?.content).toMatch(/completed evaluation artifact available|exported from the existing evaluation/i);
    expect(result?.content).toMatch(/caveats|conditionally ready/i);
    expect(result?.content).not.toMatch(/generating a downloadable/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      source: "platform",
      reason: "report_export_request_detected",
      export_readiness: "ready",
    });
  });

  it("marks report export as conditionally ready when only non-evaluation artifacts exist", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Actually make the report package now.",
      state: { ...state, hasSuccessfulEvaluationArtifact: false, hasChartableArtifact: false, hasAnyArtifact: true },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toMatch(/internal diligence note/i);
    expect(result?.content).toMatch(/decision-ready (?:conclusions|report claims)/i);
    expect(result?.content).not.toMatch(/Export readiness: ready/i);
    expect(result?.content).not.toMatch(/created the PDF|downloadable file generated/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("blocks report export when the workspace has no source artifacts", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Export a diligence report and JSON package for this empty workspace.",
      state: {
        ...state,
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: false,
        extractionStatus: "none",
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toMatch(/not (?:yet )?suitable for an external diligence report/i);
    expect(result?.content).toMatch(/source documents or artifacts with metrics, units, provenance, and operating basis/i);
    expect(result?.content).not.toMatch(/created the PDF|downloadable file generated/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      reason: "report_export_request_detected",
      export_readiness: "blocked",
      extraction_status: "none",
    });
    expect(workflow(result)?.missing_evidence_requests).toEqual([
      "Provide source documents or artifacts with metrics, units, provenance, and operating basis.",
      "Run a grounded evidence evaluation before treating the report as decision-ready.",
    ]);
  });

  it("marks partial extraction report export as conditionally ready with concrete evidence requests", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Actually make the report package now.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: true,
        hasAnyArtifact: true,
        extractionStatus: "partial",
        exportReadiness: "conditionally_ready",
        reportEvidenceRequests: [
          "Provide missing extracted metrics with units and source page references.",
          "Provide CAPEX and OPEX with source basis.",
        ],
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toMatch(/internal diligence note/i);
    expect(result?.content).not.toMatch(/Export readiness: ready/i);
    expect(result?.content).toMatch(/source extraction is partial/i);
    expect(result?.content).toMatch(/missing extracted metrics/i);
    expect(result?.content).toMatch(/CAPEX and OPEX/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      export_readiness: "conditionally_ready",
      extraction_status: "partial",
    });
    expect(workflow(result)?.missing_evidence_requests).toEqual([
      "Provide missing extracted metrics with units and source page references.",
      "Provide CAPEX and OPEX with source basis.",
    ]);
  });

  it("downgrades explicit ready to conditionally ready when extraction is partial", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Actually make the report package now.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: true,
        hasAnyArtifact: true,
        extractionStatus: "partial",
        exportReadiness: "ready",
      },
      project,
    });

    expect(result?.content).toMatch(/can support an internal diligence note|usable as a caveated internal diligence note/i);
    expect(result?.content).not.toMatch(/^Export readiness: ready/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      export_readiness: "conditionally_ready",
      extraction_status: "partial",
    });
    expect(workflow(result)?.missing_evidence_requests).toEqual([
      "Provide the missing extracted metrics with units and source page references.",
      "Provide operating regime details such as temperature, pressure, flows, duration, and boundary conditions.",
      "Provide economics inputs including CAPEX, OPEX, utilization, replacement cadence, financing, and incumbent baseline.",
    ]);
  });

  it("marks failed extraction report export as blocked", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Actually make the report package now.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "blocked",
        reportEvidenceRequests: ["Re-run document extraction or upload a parseable source document."],
      },
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(result?.content).toMatch(/not (?:yet )?suitable for an external diligence report/i);
    expect(result?.content).toMatch(/Re-run document extraction/i);
    expect(result?.content).toMatch(/PDF assessment (?:readiness|export)/i);
    expect(result?.content).not.toMatch(/created the PDF|downloadable file generated/i);
    expectNoClientStatusLabels(result?.content);
  });

  it("downgrades failed extraction with no independent support to blocked even when an evaluation exists", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Actually make the report package now.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: false,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "ready",
      },
      project,
    });

    expect(result?.content).toMatch(/not (?:yet )?suitable for an external diligence report/i);
    expect(result?.content).not.toMatch(/^Export readiness: ready/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      export_readiness: "blocked",
      extraction_status: "failed",
    });
    expect(workflow(result)?.missing_evidence_requests).toEqual(reportEvidenceRequestsForStatus("failed"));
  });

  it("downgrades failed extraction with independent chartable support to conditionally ready", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Actually make the report package now.",
      state: {
        ...state,
        hasSuccessfulEvaluationArtifact: true,
        hasChartableArtifact: true,
        hasAnyArtifact: true,
        extractionStatus: "failed",
        exportReadiness: "ready",
      },
      project,
    });

    expect(result?.content).toMatch(/can support an internal diligence note|usable as a caveated internal diligence note/i);
    expect(result?.content).not.toMatch(/^Export readiness: ready/i);
    expectNoClientStatusLabels(result?.content);
    expect(result?.workflow_orchestration).toMatchObject({
      export_readiness: "conditionally_ready",
      extraction_status: "failed",
    });
    expect(workflow(result)?.missing_evidence_requests).toEqual(reportEvidenceRequestsForStatus("failed"));
  });
});
