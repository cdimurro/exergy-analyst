import { classifyClientIntent } from "@/lib/client-intent";
import {
  collectBlockTypes,
  createClientResponseBlock,
  renderClientResponseBlocks,
  type ClientResponseBlock,
} from "@/lib/client-response-blocks";
import { buildEvidencePack, rankEvidenceItems, renderEvidencePackItems } from "@/lib/evidence-pack";
import {
  buildFollowOnEvaluationPlan,
  buildPlatformOwnedActionResponse,
  buildPlatformOwnedPlanResponse,
} from "@/lib/chat-evidence-fallback";
import { CLIENT_EXPERIENCE_PROMPT_CORPUS } from "@/lib/product-stress-corpus";
import type { InitialEvaluationProjectState } from "@/lib/initial-evaluation-guardrail";

const sparseState: InitialEvaluationProjectState = {
  hasUploadedDocuments: false,
  hasSuccessfulEvaluationArtifact: false,
  hasChartableArtifact: false,
  hasAnyArtifact: false,
  domain: "general",
  extractionStatus: "none",
  exportReadiness: "blocked",
};

const attachmentState: InitialEvaluationProjectState = {
  ...sparseState,
  hasUploadedDocuments: true,
  extractionStatus: "partial",
  documentEvidence: {
    sourceLabels: [
      "TEST-REPORT-A (technical_test_report.md)",
      "COST-MODEL-A (cost_model.csv)",
      "INVESTOR-DECK-A (investor_deck_claims.md)",
    ],
    facts: [
      "[TEST-REPORT-A] liquid output was 9.1 kg/h during the recorded four-hour bench run.",
      "[COST-MODEL-A] reactor skid: 420000 USD on one bench-demonstration skid.",
    ],
    assumptions: [],
    unsupportedClaims: [
      "[INVESTOR-DECK-A] Product is customer-qualified.",
      "[INVESTOR-DECK-A] Economics show investor-grade returns.",
    ],
    contradictedClaims: [
      "[INVESTOR-DECK-A] The technology is pilot-ready today.",
    ],
    missingInputs: [
      "[CONFLICT-DECK-A/CONFLICT-REPORT-A] Bankable deployment has missing finance assumptions. Owner: finance owner.",
      "[COST-MODEL-A] utilization (percent) is missing.",
      "[COST-MODEL-A] WACC (percent) is missing.",
      "[TEST-REPORT-A] No durability run longer than four hours is included.",
      "[TEST-REPORT-A] No repeatability matrix is included.",
      "[OPS-DATA-A] liquid_output_kg_h for RUN-006 is missing.",
    ],
    nextActions: [],
    chartableFields: [
      "[OPS-DATA-A] liquid_output_kg_h from OPS-DATA-A",
      "[TEST-REPORT-A] Reactor temperature by run.",
    ],
    nonChartableFields: [
      "[INVESTOR-DECK-A] Customer-qualified.",
    ],
    failedExtractions: [],
  },
};

const project = {
  domain: "industrial_heat",
  name: "Industrial heat recovery concept",
  description: "A heat recovery system for industrial process energy.",
};

function intentFor(message: string, state = sparseState, history: Array<{ role: string; content: string }> = []) {
  return classifyClientIntent({ message, state, project, history });
}

function responseBlocks(result: ReturnType<typeof buildPlatformOwnedActionResponse>) {
  return result?.response_blocks as ClientResponseBlock[] | undefined;
}

describe("structured client intent", () => {
  it("classifies report/export prompts with audience, artifact, and sharing context", () => {
    const intent = intentFor("Make this investor-ready without overclaiming.");

    expect(intent.primaryIntent).toBe("report_export");
    expect(intent.audience).toBe("investor");
    expect(intent.artifactRequest).toBe("investor_memo");
    expect(intent.sharingContext).toBe("investor_ready");
    expect(intent.claimBoundaryContext).toBe("unsupported_claims");
    expect(intent.truthfulnessRisk).toBe("high");
  });

  it("classifies chart package prompts as data requirements when values are missing", () => {
    const intent = intentFor("Which charts are blocked and why?");

    expect(intent.primaryIntent).toBe("chart_package");
    expect(intent.chartRequest).toBe("data_requirements");
    expect(intent.missingDataSensitivity).toBe("high");
  });

  it("classifies bankability prompts without implying calculations ran", () => {
    const intent = intentFor("What would unlock NPV or IRR?");

    expect(intent.primaryIntent).toBe("bankability");
    expect(intent.calculationRequest).toBe("finance_metrics");
    expect(intent.truthfulnessRisk).toBe("high");
  });

  it("classifies physics and exergy prompts with solver claim pressure", () => {
    const intent = intentFor("What solver-backed claims can we make about exergy?");

    expect(intent.primaryIntent).toBe("physics_exergy");
    expect(intent.calculationRequest).toBe("exergy_efficiency");
    expect(intent.truthfulnessRisk).toBe("high");
  });

  it("classifies evidence recovery and external sharing separately", () => {
    const intent = intentFor("What evidence is needed before external sharing?");

    expect(intent.primaryIntent).toBe("evidence_recovery");
    expect(intent.sharingContext).toBe("external");
    expect(intent.secondaryIntents).toContain("client_advisory");
  });

  it("preserves multi-turn audience and claim-boundary context", () => {
    const intent = intentFor("Make it customer-safe.", sparseState, [
      { role: "user", content: "What can we say now?" },
      { role: "assistant", content: "Use it only as an investor diligence candidate and avoid unsupported claims." },
    ]);

    expect(intent.primaryIntent).toBe("report_export");
    expect(intent.audience).toBe("customer");
    expect(intent.sharingContext).toBe("customer_safe");
    expect(intent.claimBoundaryContext).toBe("claim_safety");
    expect(intent.followupContext).toBe("inherits_claim_boundary");
  });

  it("preserves anti-jargon style as an orthogonal intent field", () => {
    const intent = intentFor("No platform status. Just tell me what matters.");

    expect(intent.primaryIntent).toBe("client_advisory");
    expect(intent.requestedOutputStyle).toBe("plain_language");
    expect(intent.matchedSignals).toContain("style:plain_language");
  });

  it("classifies complex attachment workflows separately from simple follow-ups", () => {
    const complex = intentFor(
      "I uploaded a test report, operating data table, and investor deck. Build a diligence plan, extract claims, identify charts, and flag unsupported claims.",
      attachmentState,
    );

    expect(complex.workflowMode).toBe("plan_and_execute");
    expect(complex.attachmentGrounded).toBe(true);
    expect(complex.taskKinds).toEqual(expect.arrayContaining([
      "attachment_grounded",
      "evidence_extraction",
      "claim_review",
      "chart_package",
      "multi_artifact_workflow",
    ]));

    const simple = intentFor("What chart should I show first?", attachmentState);

    expect(simple.workflowMode).toBe("direct_answer");
    expect(simple.simpleFollowup).toBe(true);
    expect(simple.taskKinds).toContain("simple_followup");
  });

  it("does not classify claim-review taxonomies as conflicting-evidence workflows", () => {
    const claimReview = intentFor(
      "Compare the uploaded investor deck against the test report. Which claims are supported, unsupported, or contradicted?",
      attachmentState,
    );

    expect(claimReview.conflictingEvidence).toBe(false);
    expect(claimReview.taskKinds).toContain("claim_review");

    const explicitConflict = intentFor(
      "The customer deck says the system is ready for commercial deployment, but the test report only shows bench-scale data.",
      attachmentState,
    );

    expect(explicitConflict.conflictingEvidence).toBe(true);
    expect(explicitConflict.taskKinds).toContain("conflicting_evidence");
  });

  it("keeps narrow plan prompts separate from plan-and-execute attachment workflows", () => {
    const planOnly = intentFor("Create a diligence plan.", attachmentState);

    expect(planOnly.workflowMode).toBe("plan_request");
    expect(planOnly.taskKinds).toContain("attachment_grounded");
    expect(planOnly.taskKinds).not.toContain("claim_review");
    expect(planOnly.taskKinds).not.toContain("chart_package");
  });

  it("maps the maintained client-experience corpus to structured intent families", () => {
    const expectedByGroup = {
      executive_decision: "client_advisory",
      investor_outreach: "report_export",
      customer_safe_summary: "report_export",
      report_export_readiness: "report_export",
      chart_package_planning: "chart_package",
      failed_extraction_recovery: "evidence_recovery",
      bankability_economics: "bankability",
      physics_exergy: "physics_exergy",
      multi_turn_diligence_flow: "chart_package",
      evidence_recovery: "evidence_recovery",
      anti_jargon: "client_advisory",
    } as const;

    for (const spec of CLIENT_EXPERIENCE_PROMPT_CORPUS) {
      const turns = spec.turns || (spec.prompt ? [spec.prompt] : []);
      const prompt = turns[turns.length - 1];
      const history = turns.slice(0, -1).map((content) => ({ role: "user", content }));
      const intent = intentFor(
        prompt,
        spec.group === "failed_extraction_recovery"
          ? { ...sparseState, hasUploadedDocuments: true, extractionStatus: "failed" }
          : sparseState,
        history,
      );

      expect(intent.primaryIntent).toBe(expectedByGroup[spec.group]);
      expect(intent.matchedSignals).toContain(`primary:${expectedByGroup[spec.group]}`);
    }
  });
});

describe("structured client response blocks", () => {
  it("renders answer-first advisory prose without internal labels", () => {
    const draft = {
      blocks: [
        createClientResponseBlock("useful_takeaway", "this can be screened now, but not externally claimed as validated."),
        createClientResponseBlock("supported_now", "the current description defines the use case and diligence priorities."),
        createClientResponseBlock("not_supported_yet", "verified performance, finance readiness, solver-backed physics, or numeric chart values."),
        createClientResponseBlock("recommended_next_action", "collect the source evidence pack and rerun grounded evaluation."),
      ],
    };

    expect(collectBlockTypes(draft)).toEqual([
      "useful_takeaway",
      "supported_now",
      "not_supported_yet",
      "recommended_next_action",
    ]);
    const rendered = renderClientResponseBlocks(draft);
    expect(rendered).toMatch(/^\*\*Useful takeaway:\*\*/);
    expect(rendered).toContain("Recommended next action");
    expect(rendered).not.toMatch(/workflow_reason|response_repair|artifact_state|guardrail|route|acceptance matrix|enum/i);
  });
});

describe("decision-ranked evidence packs", () => {
  it.each(["report", "chart", "bankability", "physics"] as const)(
    "generates a ranked minimum viable evidence pack for %s workflows",
    (workflow) => {
      const pack = buildEvidencePack(workflow);
      const rendered = renderEvidencePackItems(pack);

      expect(pack.length).toBeGreaterThanOrEqual(4);
      expect(pack[0].priority).toBe("critical");
      expect(pack.every((item) => item.whyItMatters && item.decisionUnlocked && item.minimumRequiredDetail)).toBe(true);
      expect(rendered.join("\n")).toMatch(/Decision unlocked:/);
    },
  );

  it("ranks critical evidence ahead of lower-impact requests", () => {
    const ranked = rankEvidenceItems([
      {
        evidenceItem: "Nice-to-have market note",
        whyItMatters: "It helps later positioning.",
        decisionUnlocked: "Follow-up narrative",
        sourceOrOwner: "Commercial owner",
        minimumRequiredDetail: "Market segment",
        priority: "medium",
        workflowContext: "report",
      },
      {
        evidenceItem: "Source-backed performance measurements",
        whyItMatters: "They determine whether the claim can be used.",
        decisionUnlocked: "Initial go/no-go",
        sourceOrOwner: "Test owner",
        minimumRequiredDetail: "Metric, unit, operating regime, duration, and source",
        priority: "critical",
        workflowContext: "report",
      },
    ]);

    expect(ranked[0].evidenceItem).toBe("Source-backed performance measurements");
  });

  it("uses solver-status wording without implying solver backing in evidence packs", () => {
    const rendered = renderEvidencePackItems(buildEvidencePack("physics")).join("\n");

    expect(rendered).toContain("solver-status claims");
    expect(rendered).toContain("Solver-evidence claim boundary");
    expect(rendered).not.toMatch(/solver-backed/i);
  });
});

describe("structured intent routing", () => {
  it("builds an attachment-specific plan-and-execute flow with immediate evidence value", () => {
    const response = buildPlatformOwnedPlanResponse({
      message: "I uploaded a technical test report, operating data table, cost model, and investor deck. Build a diligence plan, extract key claims, identify charts, flag unsupported claims, create a bankability memo, and tell me what to do next.",
      state: {
        ...attachmentState,
        documentEvidence: {
          ...attachmentState.documentEvidence!,
          failedExtractions: ["[FAILED-EXTRACTION-A] failed_extraction_document.txt"],
        },
      },
      project,
    });

    expect(response?.type).toBe("plan");
    expect(response?.workflow_orchestration).toMatchObject({
      reason: "attachment_plan_and_execute_request",
      starts_with_evidence_intake: true,
    });
    expect(response?.content).toContain("attachment-grounded plan-and-execute");
    expect(response?.content).toContain("TEST-REPORT-A");
    expect(response?.content).toContain("INVESTOR-DECK-A");
    expect(response?.content).toContain("pilot-ready");
    expect(response?.content).toContain("WACC");
    expect(response?.response_blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "evidence_basis" }),
      expect.objectContaining({ type: "supported_now" }),
      expect.objectContaining({ type: "not_supported_yet" }),
      expect.objectContaining({ type: "evidence_needed" }),
    ]));
    expect(response?.plan_steps?.map((step) => step.title)).toEqual([
      "Attachment Evidence Intake",
      "Deck Claim Review",
      "Chart Package Specification",
      "Bankability Evidence Review",
      "Client-Safe Output Draft",
      "Failed Extraction Recovery",
      "Grounded Diligence Synthesis",
    ]);
    expect(response?.plan_steps?.[0].action_type).toBe("evidence_evaluation");
    expect(response?.plan_steps?.map((step) => step.action_type)).toContain("exploratory_analysis");
    expect(JSON.stringify(response?.plan_steps)).toMatch(/Do not fabricate chart values/);
    expect(JSON.stringify(response?.plan_steps)).toMatch(/Do not infer missing numeric values/);
  });

  it("keeps follow-on exergy plans conditional instead of precomputed", () => {
    const steps = buildFollowOnEvaluationPlan({
      domain: "industrial_heat",
      description: "Industrial heat recovery concept",
    });
    const serialized = JSON.stringify(steps);
    const technicalStep = steps.find((step) => step.title === "Technical & Exergy Validation");
    const synthesisStep = steps.find((step) => step.title === "Client-Ready Synthesis");

    expect(technicalStep?.description).toContain("whether exergy was computed");
    expect(technicalStep?.config?.question).toContain("whether exergy was computed or remains unavailable");
    expect(synthesisStep?.config?.question).toContain("bounded confidence level");
    expect(serialized).not.toMatch(/Validate the computed exergy result/);
    expect(serialized).not.toMatch(/State the computed exergy result/);
    expect(serialized).not.toMatch(/investment and deployment-readiness view/);
    expect(serialized).not.toMatch(/using validated assumptions/);
    expect(serialized).not.toMatch(/decision-grade exergy map/);
  });

  it("attaches client intent metadata while keeping client-facing prose clean", () => {
    const response = buildPlatformOwnedActionResponse({
      message: "What can I responsibly say outside the company?",
      state: sparseState,
      project,
    });

    expect(response?.workflow_orchestration).toMatchObject({
      reason: "sparse_client_synthesis",
      client_intent: expect.objectContaining({
        primaryIntent: "client_advisory",
        sharingContext: "external",
        truthfulnessRisk: "high",
      }),
    });
    expect(response?.content).toMatch(/Useful takeaway/);
    expect(response?.content).toMatch(/Recommended next action/);
    expect(response?.content).not.toMatch(/workflow_reason|response_repair|artifact_state|guardrail|route|acceptance matrix|enum/i);
    expect(response?.content).not.toMatch(/\b\d+(?:\.\d+)?\s?%|\$[0-9]/);
  });

  it.each([
    ["report_export_request_detected", "Create a report from what we have.", "Next inputs to collect"],
    ["chart_request_needs_source_data", "Build the chart package we should show a CEO.", "Chart package plan"],
    ["adversarial_readiness_request_detected", "Make this investor-ready without caveats.", "What I cannot do"],
    ["evidence_gap_request_needs_source_data", "Rank evidence requests by decision impact.", "Next inputs to collect"],
  ])("renders migrated %s branch through client-readable blocks", (reason, message, expectedLabel) => {
    const response = buildPlatformOwnedActionResponse({
      message,
      state: sparseState,
      project,
    });

    expect(response?.workflow_orchestration).toMatchObject({ reason });
    expect(response?.content).toContain("Useful takeaway");
    expect(response?.content).toContain(expectedLabel);
    expect(response?.content).toContain("Decision unlocked:");
    expect(response?.content).toContain("Recommended next action");
    expect(response?.content).not.toMatch(/workflow_reason|response_repair|artifact_state|guardrail|route|acceptance matrix|enum/i);
  });

  it("renders failed extraction chart and economics recovery as structured prose", () => {
    const response = buildPlatformOwnedActionResponse({
      message: "Extraction failed. Which charts are blocked and what finance inputs do we need?",
      state: {
        ...sparseState,
        hasUploadedDocuments: true,
        extractionStatus: "failed",
      },
      project,
    });

    expect(response?.workflow_orchestration).toMatchObject({
      reason: "failed_extraction_chart_economics_recovery",
      extraction_status: "failed",
    });
    expect(response?.content).toContain("The useful recovery takeaway");
    expect(response?.content).toContain("Next inputs to collect");
    expect(response?.content).toContain("Decision unlocked:");
    expect(response?.content).toContain("Next required actions");
    expect(response?.content).not.toMatch(/\bcomputed from the failed extraction as [0-9]/i);
  });

  it("answers simple attachment follow-ups directly from fixture evidence", () => {
    const response = buildPlatformOwnedActionResponse({
      message: "What chart should I show first?",
      state: attachmentState,
      project,
    });

    expect(response?.type).toBe("response");
    expect(response?.action).toBeNull();
    expect(response?.plan_steps).toBeNull();
    expect(response?.workflow_orchestration).toMatchObject({
      reason: "attachment_grounded_simple_answer",
    });
    expect(response?.content).toMatch(/bench operating-output chart/i);
    expect(response?.content).toMatch(/liquid_output_kg_h|Reactor temperature/i);
    expect(response?.content).not.toMatch(/workflow_reason|response_repair|artifact_state|guardrail|route|acceptance matrix|enum/i);
  });

  it("reviews unsupported deck claims against attachment evidence without provider help", () => {
    const response = buildPlatformOwnedActionResponse({
      message: "Compare the uploaded investor deck against the test report. Which claims are supported, unsupported, or contradicted?",
      state: attachmentState,
      project,
    });

    expect(response?.type).toBe("response");
    expect(response?.action).toBeNull();
    expect(response?.workflow_orchestration).toMatchObject({
      reason: "attachment_claim_review",
    });
    expect(response?.content).toMatch(/pilot-ready/i);
    expect(response?.content).toMatch(/customer-qualified|investor-grade returns/i);
    expect(response?.content).toMatch(/9.1 kg\/h|420000 USD/i);
    expect(response?.content).not.toMatch(/\bcomputed\b.*\bIRR\b|\bcomputed\b.*\bNPV\b/i);
  });

  it("does not let unrelated conflicting evidence override chart, bankability, or physics attachment requests", () => {
    const chart = buildPlatformOwnedActionResponse({
      message: "Use the attached operating data to make the CEO chart package. Which charts can be made now?",
      state: attachmentState,
      project,
    });
    expect(chart?.workflow_orchestration).toMatchObject({ reason: "attachment_chart_package" });

    const bankability = buildPlatformOwnedActionResponse({
      message: "Use the attached cost model to create a bankability memo. What cannot be calculated?",
      state: attachmentState,
      project,
    });
    expect(bankability?.workflow_orchestration).toMatchObject({ reason: "attachment_bankability_review" });
    expect(bankability?.content).toMatch(/NPV, IRR, payback/i);
    const financeBlock = responseBlocks(bankability)?.find((block) => block.type === "evidence_needed");
    expect(financeBlock?.bullets?.[0]).toMatch(/COST-MODEL-A.*utilization/i);
    expect(financeBlock?.bullets?.[1]).toMatch(/COST-MODEL-A.*WACC/i);

    const financeFollowup = buildPlatformOwnedActionResponse({
      message: "What should finance provide next?",
      state: attachmentState,
      project,
    });
    const financeFollowupFacts = responseBlocks(financeFollowup)?.find((block) => block.type === "supported_now");
    const financeFollowupGaps = responseBlocks(financeFollowup)?.find((block) => block.type === "evidence_needed");
    expect(financeFollowup?.workflow_orchestration).toMatchObject({ reason: "attachment_grounded_simple_answer" });
    expect(financeFollowupFacts?.bullets?.join("\n")).toMatch(/COST-MODEL-A|420000 USD/i);
    expect(financeFollowupGaps?.bullets?.[0]).toMatch(/COST-MODEL-A.*utilization/i);
    expect(financeFollowupGaps?.bullets?.[1]).toMatch(/COST-MODEL-A.*WACC/i);

    const physics = buildPlatformOwnedActionResponse({
      message: "Use the uploaded test report to assess the physics claims. What solver-backed claims can we make?",
      state: attachmentState,
      project,
    });
    expect(physics?.workflow_orchestration).toMatchObject({ reason: "attachment_physics_review" });
    expect(physics?.content).toMatch(/not supported|not solver-backed|solver-backed confidence/i);
    const measurementBlock = responseBlocks(physics)?.find((block) => block.type === "evidence_needed");
    expect(measurementBlock?.bullets?.[0]).toMatch(/TEST-REPORT-A.*durability|durability.*technical test owner/i);
    expect(measurementBlock?.bullets?.slice(0, 2).join("\n")).not.toMatch(/WACC|utilization|finance/i);
  });
});
