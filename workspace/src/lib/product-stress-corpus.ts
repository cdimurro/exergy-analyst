import type { Artifact, Project, ProjectDocument } from "@/lib/storage/types";
import type { ProductStressCase, ProductStressPrompt } from "@/lib/product-stress-campaign";

const CREATED_AT = "2026-04-29T00:00:00.000Z";

export type ClientExperiencePromptGroup =
  | "executive_decision"
  | "investor_outreach"
  | "customer_safe_summary"
  | "report_export_readiness"
  | "chart_package_planning"
  | "failed_extraction_recovery"
  | "bankability_economics"
  | "physics_exergy"
  | "multi_turn_diligence_flow"
  | "evidence_recovery"
  | "anti_jargon";

export interface ClientExperiencePromptSpec {
  id: string;
  group: ClientExperiencePromptGroup;
  prompt?: string;
  turns?: string[];
  expected_qualities: string[];
}

export const CLIENT_EXPERIENCE_PROMPT_GROUPS: ClientExperiencePromptGroup[] = [
  "executive_decision",
  "investor_outreach",
  "customer_safe_summary",
  "report_export_readiness",
  "chart_package_planning",
  "failed_extraction_recovery",
  "bankability_economics",
  "physics_exergy",
  "multi_turn_diligence_flow",
  "evidence_recovery",
  "anti_jargon",
];

const DEFAULT_CLIENT_QUALITIES = [
  "answer_first",
  "uses_available_context",
  "states_supported_now",
  "identifies_unsupported_claims",
  "gives_concrete_next_action",
  "avoids_internal_jargon",
] as const;

export const CLIENT_EXPERIENCE_PROMPT_CORPUS: ClientExperiencePromptSpec[] = [
  {
    id: "executive_decision_sparse",
    group: "executive_decision",
    prompt: "What should an executive decide from the current workspace?",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "states_decision_implication",
      "prioritizes_highest_risk_unknowns",
    ],
  },
  {
    id: "investor_memo_sparse",
    group: "investor_outreach",
    prompt: "Make this investor-ready without overstating the evidence.",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "separates_diligence_candidate_from_investment_ready_case",
      "names_finance_and_validation_evidence_needed",
    ],
  },
  {
    id: "customer_safe_summary_sparse",
    group: "customer_safe_summary",
    prompt: "Make this safe to send to a customer.",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "avoids_confidential_or_unverified_claims",
      "uses_plain_external_language",
    ],
  },
  {
    id: "report_export_readiness_sparse",
    group: "report_export_readiness",
    prompt: "Create a client-ready report from what we have.",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "distinguishes_internal_note_from_external_report",
      "does_not_claim_new_file_generation",
    ],
  },
  {
    id: "chart_package_no_numeric_data",
    group: "chart_package_planning",
    prompt: "Build a chart package for a decision-maker from the current evidence.",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "lists_chart_type_metric_unit_source_and_decision_value",
      "does_not_invent_chart_values",
    ],
  },
  {
    id: "failed_extraction_recovery",
    group: "failed_extraction_recovery",
    prompt: "The extraction failed. What is recoverable, and what should I collect next?",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "distinguishes_unusable_from_recoverable",
      "requests_parseable_source_records",
    ],
  },
  {
    id: "bankability_without_numbers",
    group: "bankability_economics",
    prompt: "Is this bankable from what we have, and what would unlock NPV or IRR?",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "names_visible_financing_risks",
      "explains_inputs_needed_for_calculations",
      "does_not_fabricate_finance_metrics",
    ],
  },
  {
    id: "physics_exergy_sparse",
    group: "physics_exergy",
    prompt: "What can we say about exergy and mechanism plausibility without solver results?",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "frames_qualitative_mechanism_screen",
      "lists_governing_quantities_and_boundaries",
      "does_not_imply_solver_ran",
    ],
  },
  {
    id: "multi_turn_investor_customer_chart_flow",
    group: "multi_turn_diligence_flow",
    turns: [
      "What can we say now?",
      "Make it investor-ready.",
      "Make it customer-safe.",
      "What charts can I show?",
    ],
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "preserves_prior_supported_and_unsupported_claims",
      "preserves_audience_shift",
      "keeps_chart_plan_truthful",
    ],
  },
  {
    id: "ranked_evidence_recovery",
    group: "evidence_recovery",
    prompt: "Rank the evidence requests by decision impact and give me the minimum viable evidence pack.",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "ranks_requests_by_decision_impact",
      "explains_why_each_item_matters",
      "offers_minimum_viable_evidence_pack",
    ],
  },
  {
    id: "anti_jargon_ceo",
    group: "anti_jargon",
    prompt: "No platform status. Explain this like a diligence lead talking to a CEO.",
    expected_qualities: [
      ...DEFAULT_CLIENT_QUALITIES,
      "uses_plain_client_readable_language",
      "omits_machine_status_terms",
    ],
  },
];

export function stressProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id || "stress-project",
    name: overrides.name || "Generic energy technology",
    description: overrides.description || "Generic energy technology diligence case",
    goal: overrides.goal || "Investor diligence",
    domain: overrides.domain || "general",
    created_at: overrides.created_at || CREATED_AT,
    updated_at: overrides.updated_at || CREATED_AT,
  };
}

export function stressDocument(filename: string): ProjectDocument {
  return {
    id: `doc_${filename.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
    filename,
    mime_type: "application/pdf",
    size_bytes: 1024,
    status: "uploaded",
    uploaded_at: CREATED_AT,
  };
}

export function stressEvaluationArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: overrides.id || "art_eval_stress",
    schema_version: 1,
    type: "evaluation",
    title: overrides.title || "Evidence Evaluation",
    summary: overrides.summary || "Score: 0.71 across 10 modules. 2 caveats.",
    content: overrides.content || {
      domain: "fuels_chemical",
      score: 0.71,
      evidence_level: "moderate",
      module_evaluations: {
        physics: { verdict: "conditional", score_0_100: 74, confidence_0_1: 0.67 },
        economics: { verdict: "conditional", score_0_100: 61, confidence_0_1: 0.52 },
      },
      exergy_metrics: {
        exergetic_efficiency: 0.5368,
        first_law_efficiency: 0.51,
        quality_factor: 0.95,
      },
      brief: {
        readiness_tier: "conditional",
        composite_score: 71,
        ranked_gap_guidance: [
          { parameter: "CAPEX", impact: "high", why_it_matters: "Dominates bankability." },
          { parameter: "Measured efficiency", impact: "high", why_it_matters: "Needed for physics confidence." },
        ],
      },
    },
    source: "canonical_engine",
    raw: overrides.raw || {},
    metadata: overrides.metadata || {},
    action_id: overrides.action_id || "act_eval_stress",
    provenance: overrides.provenance || { source: "canonical_engine", deterministic: true },
    created_at: overrides.created_at || CREATED_AT,
    pinned: overrides.pinned ?? false,
  };
}

export function failedExtractionArtifact(): Artifact {
  return stressEvaluationArtifact({
    id: "art_failed_extraction",
    title: "Evidence Evaluation: failed extraction",
    summary: "Could not extract usable parameters from the uploaded document.",
    content: {
      verdict: "not_ready",
      run_state: "debug",
      evidence_level_metadata: { n_parameters_fused: 0 },
      brief: {
        headline: "Uploaded document did not provide enough structured evidence to score.",
        required_next_inputs: ["CAPEX", "measured efficiency", "independent test report"],
      },
    },
    metadata: { gate0_validation_issue: true },
  });
}

export function literatureOnlyArtifact(): Artifact {
  return {
    id: "art_literature_only",
    schema_version: 1,
    type: "research",
    title: "Literature Review",
    summary: "Qualitative literature synthesis without extracted numeric series.",
    content: {
      analysis_summary: "Published sources discuss durability and integration risk, but no numeric values were extracted.",
      findings: [
        { text: "Durability remains a key uncertainty." },
        { text: "Integration depends on heat and carbon management." },
      ],
    },
    source: "ai_synthesis",
    raw: {},
    metadata: {},
    action_id: "act_literature_only",
    provenance: { source: "ai_synthesis", deterministic: false },
    created_at: CREATED_AT,
    pinned: false,
  };
}

const CHAT_FORBIDDEN_LEAK_EXPECTATIONS = [
  { kind: "forbidden_text", pattern: "View Details|Export Report|Use as a triage note|What Is Supported|Do Not Claim Yet|Best Next Data Requests|Open the process details|Outputs collected|\\.mineru\\.(?:md|json)|Uploaded Files|Extracted Numeric Inputs|I don't see a previous question|Point me to the heat-pump rating table|\\bAction failed\\b|did not return a result|Analysis complete\\. I summarized the available results", path: "response.content" },
] as const;

const ACTION_SUMMARY_FORBIDDEN_LEAK_EXPECTATIONS = [
  { kind: "forbidden_text", pattern: "View Details|Export Report|Use as a triage note|What Is Supported|Do Not Claim Yet|Best Next Data Requests|Open the process details|Outputs collected|\\.mineru\\.(?:md|json)|Uploaded Files|Extracted Numeric Inputs|I don't see a previous question|Point me to the heat-pump rating table|\\bAction failed\\b|did not return a result|Analysis complete\\. I summarized the available results", path: "result_summary" },
] as const;

export const DEFAULT_PRODUCT_STRESS_PROMPTS: Record<string, ProductStressPrompt> = {
  editablePlan: {
    id: "editable_plan_full_tea",
    surface: "chat",
    intent: "editable_plan",
    message: "Run a comprehensive techno-economic assessment with physics validation, economics, charts, and client-ready synthesis.",
    expectations: [
      { kind: "http_status", status: 200 },
      { kind: "response_type", response_type: "plan" },
      { kind: "workflow_reason", reason: "complex_request_detected" },
      { kind: "first_plan_action", action_type: "evidence_evaluation" },
      ...CHAT_FORBIDDEN_LEAK_EXPECTATIONS,
    ],
  },
  chartNoData: {
    id: "chart_without_data",
    surface: "chat",
    intent: "chart",
    message: "Make a chart comparing exergy efficiency, cost, and deployment risk.",
    expectations: [
      { kind: "http_status", status: 200 },
      { kind: "response_type", response_type: "plan" },
      { kind: "workflow_reason", reason: "chart_request_needs_source_data" },
      { kind: "forbidden_text", pattern: "generating a downloadable|computed chart", path: "response.content" },
      ...CHAT_FORBIDDEN_LEAK_EXPECTATIONS,
    ],
  },
  chartWithData: {
    id: "chart_with_data",
    surface: "chat",
    intent: "chart",
    message: "Make a chart comparing exergy efficiency, cost, and deployment risk.",
    expectations: [
      { kind: "http_status", status: 200 },
      { kind: "response_type", response_type: "action" },
      { kind: "workflow_reason", reason: "chart_request_detected" },
      { kind: "action_type", action_type: "exploratory_analysis" },
      ...CHAT_FORBIDDEN_LEAK_EXPECTATIONS,
    ],
  },
  evidenceGaps: {
    id: "evidence_gaps",
    surface: "chat",
    intent: "evidence_gaps",
    message: "What evidence gaps and next diligence actions would most improve this assessment?",
    expectations: [
      { kind: "http_status", status: 200 },
      { kind: "response_type", response_type: "action" },
      { kind: "workflow_reason", reason: "evidence_gap_followup_detected" },
      { kind: "action_type", action_type: "deep_analysis" },
      ...CHAT_FORBIDDEN_LEAK_EXPECTATIONS,
    ],
  },
  reportExport: {
    id: "report_export",
    surface: "chat",
    intent: "report_export",
    message: "Generate a PDF report and export the JSON.",
    expectations: [
      { kind: "http_status", status: 200 },
      { kind: "response_type", response_type: "response" },
      { kind: "contains_text", text: "report export flow", path: "response.content" },
      { kind: "contains_text", text: "JSON export control", path: "response.content" },
      { kind: "forbidden_text", pattern: "generating a downloadable", path: "response.content" },
      ...CHAT_FORBIDDEN_LEAK_EXPECTATIONS,
    ],
  },
  exploratoryNoNumericAction: {
    id: "exploratory_no_numeric_action",
    surface: "action",
    intent: "chart",
    message: "Create charts for module scores, exergy, and economics gaps.",
    action: {
      type: "exploratory_analysis",
      input: {
        question: "Create charts for module scores, exergy, and economics gaps.",
        analysis_type: "comparison",
      },
    },
    expectations: [
      { kind: "http_status", status: 200 },
      { kind: "artifact_type", artifact_type: "report" },
      { kind: "chart_title", title: "Targeted Data-Gathering Plan for Charting" },
      { kind: "contains_text", text: "No chartable numeric data was found", path: "artifact.content.analysis_summary" },
      ...ACTION_SUMMARY_FORBIDDEN_LEAK_EXPECTATIONS,
    ],
  },
};

export const DEFAULT_PRODUCT_STRESS_CASES: ProductStressCase[] = [
  {
    id: "oxeon_uploaded_documents",
    label: "OxEon-style uploaded document diligence",
    domain: "fuels_chemical",
    project: stressProject({
      id: "stress-oxeon",
      name: "OxEon SOEC+FT",
      description: "OxEon solid oxide electrolysis and Fischer-Tropsch fuel synthesis system",
      domain: "fuels_chemical",
    }),
    reference_fixture_paths: [
      "docs/PTL_RESEARCH_REPORT_2026-04.md",
      "config/calibration/reference_devices_provisional/oxeon_soec_ft.yaml",
    ],
    notes: "Representative uploaded-document comprehensive diligence state.",
    input_state: {
      documents: [stressDocument("OxEonEnergy-FTSystem_Rev1.pdf")],
      artifacts: [],
    },
    prompts: [DEFAULT_PRODUCT_STRESS_PROMPTS.editablePlan],
  },
  {
    id: "xenergy_failed_extraction",
    label: "X-energy-style failed extraction chart request",
    domain: "small_modular_nuclear",
    project: stressProject({
      id: "stress-xenergy",
      name: "X-energy Xe-100 HTGR",
      description: "High-temperature gas-cooled reactor with TRISO fuel and helium coolant",
      domain: "small_modular_nuclear",
    }),
    reference_fixture_paths: [
      "config/calibration/reference_devices/xenergy_xe100_htgr.yaml",
      "config/domain_schemas/nuclear_fission.yaml",
    ],
    notes: "Representative failed-extraction state; chart requests must ask for data.",
    input_state: {
      artifacts: [failedExtractionArtifact()],
    },
    prompts: [DEFAULT_PRODUCT_STRESS_PROMPTS.chartNoData],
  },
  {
    id: "eden_literature_only",
    label: "EDEN-style qualitative artifact chart request",
    domain: "waste_to_fuels",
    project: stressProject({
      id: "stress-eden",
      name: "EDEN waste-to-fuels composite",
      description: "Waste-to-fuels diligence case with qualitative literature artifacts only",
      domain: "waste_to_fuels",
    }),
    reference_fixture_paths: [
      "docs/WTF_CALIBRATION_STATUS.md",
      "tests/fixtures/demo_lock/eden_invariants.json",
    ],
    notes: "Representative literature-only state; chart requests must not invent numeric values.",
    input_state: {
      artifacts: [literatureOnlyArtifact()],
    },
    prompts: [
      DEFAULT_PRODUCT_STRESS_PROMPTS.chartNoData,
      DEFAULT_PRODUCT_STRESS_PROMPTS.exploratoryNoNumericAction,
    ],
  },
  {
    id: "fischer_tropsch_evaluation",
    label: "Fischer-Tropsch evaluation follow-ups",
    domain: "fuels_chemical",
    project: stressProject({
      id: "stress-ft",
      name: "Fischer-Tropsch reactor",
      description: "Fischer-Tropsch synthesis reactor with evaluation artifacts",
      domain: "fuels_chemical",
    }),
    reference_fixture_paths: [
      "config/domain_schemas/fischer_tropsch_reactor.yaml",
      "config/calibration/reference_devices/sasol_slurry_ft.yaml",
    ],
    notes: "Representative evaluated state for chart, evidence-gap, and export follow-ups.",
    input_state: {
      artifacts: [stressEvaluationArtifact()],
    },
    prompts: [
      DEFAULT_PRODUCT_STRESS_PROMPTS.chartWithData,
      DEFAULT_PRODUCT_STRESS_PROMPTS.evidenceGaps,
      DEFAULT_PRODUCT_STRESS_PROMPTS.reportExport,
    ],
  },
];
