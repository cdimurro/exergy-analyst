import { buildPlatformOwnedActionResponse } from "@/lib/chat-evidence-fallback";
import type { ClientResponseBlock } from "@/lib/client-response-blocks";
import type { InitialEvaluationProjectState } from "@/lib/initial-evaluation-guardrail";

const attachmentEvidenceState: InitialEvaluationProjectState = {
  hasUploadedDocuments: true,
  hasSuccessfulEvaluationArtifact: false,
  hasChartableArtifact: false,
  domain: "thermochemical_reactor",
  documentEvidence: {
    sourceLabels: [
      "TEST-REPORT-A (technical_test_report.md)",
      "COST-MODEL-A (cost_model.csv)",
      "OPS-DATA-A (operating_data.csv)",
      "INVESTOR-DECK-A (investor_deck_claims.md)",
    ],
    facts: [
      "[TEST-REPORT-A] Test date: 2026-03-12.",
      "[TEST-REPORT-A] Measured liquid output: 12.4 kg/h.",
      "[COST-MODEL-A] reactor skid: 125000 USD on budgetary quote.",
      "[OPS-DATA-A] run_003 output: 12.4 kg/h at 421 C.",
    ],
    assumptions: [],
    unsupportedClaims: [
      "[INVESTOR-DECK-A] Commercial deployment ready in the current quarter is unsupported.",
      "[INVESTOR-DECK-A] Bankability proven by the test campaign is unsupported.",
    ],
    contradictedClaims: [
      "[CONFLICT-BUNDLE-A] Pilot-ready claim conflicts with bench-scale-only test evidence.",
    ],
    missingInputs: [
      "[COST-MODEL-A] utilization (%) is missing.",
      "[COST-MODEL-A] discount rate (%) is missing.",
      "[TEST-REPORT-A] durability run hours are missing.",
    ],
    nextActions: [
      "[TEST-REPORT-A] Provide repeatability and durability data with source basis.",
    ],
    chartableFields: [
      "[OPS-DATA-A] liquid_output_kg_h from OPS-DATA-A",
      "[OPS-DATA-A] reactor_temperature_c from OPS-DATA-A",
      "[COST-MODEL-A] value from COST-MODEL-A",
    ],
    nonChartableFields: [
      "[INVESTOR-DECK-A] Pilot-ready today.",
      "[OPS-DATA-A] operator_note from OPS-DATA-A",
      "[COST-MODEL-A] notes from COST-MODEL-A",
    ],
    failedExtractions: [
      "[FAILED-DOC-A] failed_extraction_document.txt",
    ],
  },
};

const project = {
  domain: "thermochemical_reactor",
  description: "Generic thermochemical bench test",
  name: "Attachment block validation",
};

type WorkflowOrchestration = {
  reason?: string;
};

function responseBlocks(result: ReturnType<typeof buildPlatformOwnedActionResponse>) {
  return result?.response_blocks as ClientResponseBlock[] | undefined;
}

function workflow(result: ReturnType<typeof buildPlatformOwnedActionResponse>) {
  return result?.workflow_orchestration as WorkflowOrchestration | undefined;
}

describe("attachment response blocks", () => {
  it("returns semantic blocks for attachment-grounded claim reviews", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Compare the uploaded investor deck against the test report and flag unsupported claims.",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.action).toBeNull();
    expect(workflow(result)?.reason).toBe("attachment_claim_review");
    const blocks = responseBlocks(result);
    expect(blocks?.map((block) => block.type)).toEqual([
      "useful_takeaway",
      "evidence_basis",
      "supported_now",
      "not_supported_yet",
      "evidence_needed",
      "recommended_next_action",
    ]);
    expect(blocks?.find((block) => block.type === "not_supported_yet")?.bullets?.join("\n")).toContain(
      "Commercial deployment ready",
    );
    expect(result?.content).toContain("Unsupported or contradicted deck claims");
  });

  it("returns semantic blocks for simple attachment follow-ups", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What chart should I show first?",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_grounded_simple_answer");
    const blocks = responseBlocks(result);
    expect(blocks?.map((block) => block.type)).toEqual([
      "useful_takeaway",
      "chart_package_plan",
      "not_supported_yet",
      "recommended_next_action",
    ]);
    expect(blocks?.find((block) => block.type === "chart_package_plan")?.bullets?.join("\n")).toContain(
      "liquid_output_kg_h",
    );
    expect(blocks?.find((block) => block.type === "not_supported_yet")?.bullets?.join("\n")).toContain(
      "Do not chart as numeric evidence: Pilot-ready today",
    );
    expect(result?.content).toContain("Chartable fields from the attachments");
  });

  it("prioritizes customer-safe summaries over generic conflicting-evidence review", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "The customer deck says the system is ready for commercial deployment, but the test report only shows bench-scale data. Create a customer-safe summary and internal risk note.",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_customer_safe_conflict_summary");
    const blocks = responseBlocks(result);
    expect(blocks?.map((block) => block.type)).toEqual([
      "useful_takeaway",
      "evidence_basis",
      "supported_now",
      "not_supported_yet",
      "evidence_needed",
      "recommended_next_action",
    ]);
    expect(result?.content).toContain("customer version");
    expect(result?.content).toContain("Internal risk note");
    expect(result?.content).toMatch(/commercial deployment/i);
  });

  it("uses conflicting-evidence review only for explicit conflict prompts", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "The customer deck says the system is ready for commercial deployment, but the test report only shows bench-scale data. Create an internal conflict note.",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_conflicting_evidence_review");
  });

  it("keeps status-table contradictions visible ahead of generic test limitations", () => {
    const noisyState: InitialEvaluationProjectState = {
      ...attachmentEvidenceState,
      documentEvidence: {
        ...attachmentEvidenceState.documentEvidence!,
        unsupportedClaims: [
          "[TEST-REPORT-A] No durability run longer than four hours is included.",
          "[TEST-REPORT-A] No repeatability matrix is included.",
          "[TEST-REPORT-A] No independent lab witness signature is included.",
          "[TEST-REPORT-A] No product specification assay is included.",
          "[TEST-REPORT-A] No commercial-scale pilot data is included.",
          "[TEST-REPORT-A] No full mass-balance closure calculation is provided.",
          "[TEST-REPORT-A] No emissions measurements are provided.",
          "[CONFLICT-DECK-A/CONFLICT-REPORT-A] finance-readiness claim deployment is unsupported: CONFLICT-DECK-A; CONFLICT-REPORT-A says finance assumptions missing.",
        ],
        contradictedClaims: [
          "[CONFLICT-DECK-A/CONFLICT-REPORT-A] Commercial deployment ready is contradicted: CONFLICT-DECK-A; CONFLICT-REPORT-A says bench-scale only.",
          "[CONFLICT-DECK-A/CONFLICT-REPORT-A] Pilot-scale validation is contradicted: CONFLICT-DECK-A; CONFLICT-REPORT-A says no pilot-scale operation.",
        ],
      },
    };

    const result = buildPlatformOwnedActionResponse({
      message: "Compare the customer deck conflict map against the technical report. Which claims are supported, unsupported, or contradicted?",
      state: noisyState,
      project,
    });
    const unsupported = responseBlocks(result)?.find((block) => block.type === "not_supported_yet")?.bullets?.join("\n") || "";

    expect(workflow(result)?.reason).toBe("attachment_conflicting_evidence_review");
    expect(unsupported).toContain("Commercial deployment ready is contradicted");
    expect(unsupported).toContain("Pilot-scale validation is contradicted");
    expect(unsupported).toContain("finance-readiness claim deployment is unsupported");
  });

  it("does not let a failed document override unrelated simple external-claim questions", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What claim is safest externally?",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_grounded_simple_answer");
    expect(result?.content).toMatch(/customer|external|claim|bench/i);
  });

  it("answers validation pressure directly from attachment evidence", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Can we say it is validated?",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_grounded_simple_answer");
    expect(result?.content).toContain("not a validation claim");
    expect(result?.content).toContain("Do not say externally");
  });

  it("treats concise memo recommendation questions as direct attachment follow-ups", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What should the memo recommend?",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_grounded_simple_answer");
    expect(result?.content).toContain("recommendation should be");
  });

  it.each([
    ["What should I tell the CEO in one sentence?", "CEO sentence support"],
    ["Is there enough to claim pilot validation?", "No. The evidence supports"],
    ["Can I say this is pilot ready?", "No. The evidence supports"],
    ["What is the board-level takeaway?", "Board risks to keep explicit"],
    ["What are the top three diligence asks?", "Top diligence asks"],
    ["Which claim is most dangerous?", "Most dangerous claim candidates"],
    ["What should legal review before this goes outside?", "Legal review focus"],
    ["What must legal strike from the deck?", "Legal review focus"],
    ["What is the redline for legal?", "Legal review focus"],
    ["What should the data owner fix first?", "Data owner fixes first"],
    ["What data is missing?", "Missing evidence by source"],
    ["Which source should I trust?", "Measured or source-backed facts"],
    ["What is the most defensible metric?", "Metric support"],
    ["What should engineering do next?", "Technical gaps to close"],
    ["What should be removed from the deck?", "Deck claims to remove or rewrite"],
    ["Can I show the operating data?", "Operating fields that can be shown"],
    ["Can this go in a sales deck?", "Keep out of the sales deck"],
    ["What can sales safely say externally right now?", "Sales-safe facts"],
    ["What language should sales avoid?", "Keep out of the sales deck"],
    ["Can sales use this as-is?", "Keep out of the sales deck"],
    ["What can we say in an outbound deck?", "Keep out of the sales deck"],
    ["What cannot be calculated yet?", "Finance inputs still needed"],
    ["Which numbers are still unavailable?", "Finance inputs still needed"],
    ["What should we not calculate yet?", "Finance inputs still needed"],
    ["What proof should I ask for first?", "Proof to request first"],
    ["What should I ask the test owner?", "Proof to request first"],
    ["Using the uploaded files, draft a data-room request list for the technical lead, finance owner, and commercial owner.", "Technical lead requests"],
    ["What evidence would change the recommendation?", "Proof to request first"],
    ["Can we mention the 9.1 kg/h number?", "Metric support"],
    ["Can we mention lower operating cost?", "Finance inputs still needed"],
    ["Can we show this to a lender?", "Finance inputs still needed"],
    ["What should the board not hear?", "Keep internal until proven"],
    ["Create a board message and a customer message from the uploaded evidence without overclaiming.", "Board/internal cautions"],
    ["Write the board version and the customer version in one line each.", "Board/internal cautions"],
    ["What should remain internal until evidence arrives?", "Keep internal until proven"],
    ["What should be excluded from external sharing?", "Keep internal until proven"],
    ["What is the one safe sentence?", "Source basis for the sentence"],
    ["Give me the exact investor-safe sentence.", "investor-safe wording"],
    ["Give me the exact legal-safe sentence.", "Legal-safe sentence"],
    ["What can I say publicly?", "external-safe wording"],
    ["What should not be said publicly?", "Do not say publicly"],
    ["What can go in a sales email?", "sales/outreach wording"],
    ["Write the caveat under the customer slide.", "caution wording"],
    ["Can we say commercial deployment in a press quote?", "Do not say publicly"],
    ["What is the safest external headline?", "external-safe wording"],
    ["What headline would overclaim?", "Do not say publicly"],
    ["What wording should engineering approve?", "source-owner approved wording"],
    ["What is the board-safe version?", "Board-safe sentence"],
    ["What is the sales-safe version?", "sales/outreach wording"],
    ["What is the legal-safe version?", "Legal-safe sentence"],
    ["What can the CEO say publicly in one sentence?", "external-safe wording"],
    ["What should the CEO avoid in public remarks?", "Do not say publicly"],
    ["Give me the public headline and the private caveat.", "caution wording"],
    ["Give me the internal risk sentence.", "external-safe wording"],
    ["Give me the customer email sentence.", "Safe customer-facing facts"],
    ["Give me the board memo sentence.", "Board-safe sentence"],
    ["Give me the investor caveat.", "caution wording"],
    ["What should be redlined before sales uses this?", "Do not say publicly"],
    ["What is the safest sentence for a counterparty?", "external-safe wording"],
    ["What should not go to the counterparty?", "Do not say publicly"],
    ["What can go into a teaser?", "sales/outreach wording"],
    ["What must stay out of the teaser?", "Do not add to the wording"],
    ["What can be used in outreach?", "sales/outreach wording"],
    ["What must be held for diligence only?", "external-safe wording"],
    ["What one line should finance approve?", "source-owner approved wording"],
    ["What one line should the test owner approve?", "source-owner approved wording"],
    ["What is the safest commercial statement?", "external-safe wording"],
    ["What commercial sentence would overstate the evidence?", "Do not say publicly"],
    ["Can we call it proven in customer language?", "Safe customer-facing facts"],
    ["Can we call it finance-ready?", "Do not say publicly"],
    ["What must be removed from the outreach note?", "Do not add to the wording"],
    ["What should the diligence memo say first?", "external-safe wording"],
    ["What should stay in the risk appendix?", "caution wording"],
    ["What can be disclosed externally without numbers?", "external-safe wording"],
    ["What is the exact cautious wording?", "external-safe wording"],
    ["What exact number can I cite?", "Numbers currently safe to cite"],
    ["Can I say the run was below 500 C?", "Temperature support"],
    ["Which attachment should I fix first?", "Highest-value fixes"],
    ["What is the fastest unblock?", "Highest-value fixes"],
    ["What should not be charted?", "Do not chart as numeric evidence"],
    ["What should the y-axis label say?", "Axis-label candidates from chartable fields"],
    ["What should the CEO chart title be?", "Chart wording should be based on these fields"],
    ["What caveat belongs under the chart?", "Chart wording should be based on these fields"],
    ["Which source is most reliable?", "Measured or source-backed facts"],
    ["What metric needs a unit?", "Metrics or fields needing source cleanup"],
    ["Summarize what can go in the diligence data room and what needs redaction or caveating before sharing.", "Needs redaction or caveat before sharing"],
    ["What can go to the data room?", "Commercial owner claims to hold back"],
  ])("answers simple attachment follow-up deterministically: %s", (message, expectedContent) => {
    const result = buildPlatformOwnedActionResponse({
      message,
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(result?.plan_steps).toBeNull();
    expect(workflow(result)?.reason).toBe("attachment_grounded_simple_answer");
    expect(result?.content).toContain(expectedContent);
  });

  it("softens risky raw deck wording in direct external answers", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "Give me the exact investor-safe sentence.",
      state: attachmentEvidenceState,
      project,
    });

    expect(workflow(result)?.reason).toBe("attachment_grounded_simple_answer");
    expect(result?.content).not.toMatch(/\bbankable\b|pilot[\s-]?validated|pilot validation/i);
    expect(result?.content).toContain("finance inputs");
  });

  it("still uses failed-extraction recovery when the user asks about the failed document", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "One of the uploaded documents failed extraction. What can still be done from the other files, and what exactly should we recollect?",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_failed_extraction_recovery");
    expect(result?.content).toMatch(/failed document|recollect|searchable PDF|CSV/i);
  });

  it("uses failed-extraction recovery when the user says extraction failed", () => {
    const result = buildPlatformOwnedActionResponse({
      message: "What can we do from the other files if extraction failed?",
      state: attachmentEvidenceState,
      project,
    });

    expect(result?.type).toBe("response");
    expect(workflow(result)?.reason).toBe("attachment_failed_extraction_recovery");
    expect(responseBlocks(result)?.map((block) => block.type)).toContain("evidence_needed");
  });
});
