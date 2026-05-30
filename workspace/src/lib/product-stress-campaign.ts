import type { ActionType, Artifact, Project, ProjectDocument } from "@/lib/storage/types";

export type ProductStressSurface = "chat" | "action";

export type ProductStressExpectation =
  | { kind: "http_status"; status: number }
  | { kind: "response_type"; response_type: "response" | "plan" | "question" | "action" }
  | { kind: "workflow_reason"; reason: string }
  | { kind: "action_type"; action_type: string }
  | { kind: "first_plan_action"; action_type: string }
  | { kind: "contains_text"; text: string; path?: string }
  | { kind: "forbidden_text"; pattern: string; path?: string }
  | { kind: "artifact_type"; artifact_type: string }
  | { kind: "chart_title"; title: string };

export interface ProductStressPrompt {
  id: string;
  surface: ProductStressSurface;
  message: string;
  action?: {
    type: ActionType;
    input: Record<string, unknown>;
  };
  intent:
    | "editable_plan"
    | "literature"
    | "physics_exergy"
    | "economics"
    | "chart"
    | "evidence_gaps"
    | "report_export"
    | "multi_focus";
  expectations: ProductStressExpectation[];
}

export interface ProductStressInputState {
  documents?: ProjectDocument[];
  artifacts?: Artifact[];
}

export interface ProductStressCase {
  id: string;
  label: string;
  domain: string;
  project: Project;
  reference_fixture_paths: string[];
  notes: string;
  input_state: ProductStressInputState;
  prompts: ProductStressPrompt[];
}

export interface ProductStressExecutionContext {
  caseDef: ProductStressCase;
  prompt: ProductStressPrompt;
  iteration: number;
}

export interface ProductStressRawResult {
  status: number;
  body: Record<string, unknown>;
  elapsed_ms?: number;
}

export interface ProductStressIssue {
  severity: "blocker" | "warning";
  case_id: string;
  prompt_id: string;
  expectation: ProductStressExpectation;
  observed: string;
  acceptance_test_hint: string;
}

export interface ProductStressPromptResult {
  case_id: string;
  prompt_id: string;
  surface: ProductStressSurface;
  intent: ProductStressPrompt["intent"];
  status: number;
  elapsed_ms: number;
  body: Record<string, unknown>;
  issues: ProductStressIssue[];
}

export interface ProductStressCampaignReport {
  campaign_id: string;
  started_at: string;
  completed_at: string;
  elapsed_ms: number;
  requested_timebox_ms: number;
  completed_iterations: number;
  cases_run: string[];
  prompt_results: ProductStressPromptResult[];
  issues: ProductStressIssue[];
  summary: {
    prompts_run: number;
    blockers: number;
    warnings: number;
    passed: boolean;
  };
}

export interface ProductStressCampaignOptions {
  campaign_id?: string;
  cases: ProductStressCase[];
  timebox_ms: number;
  max_iterations?: number;
  executePrompt: (context: ProductStressExecutionContext) => Promise<ProductStressRawResult>;
  now?: () => Date;
}

export const EIGHT_HOUR_TIMEBOX_MS = 8 * 60 * 60 * 1000;

export const PRODUCT_STRESS_ACCEPTANCE_MATRIX = [
  "no_documents",
  "uploaded_documents",
  "partial_or_failed_extraction",
  "literature_only_artifacts",
  "evaluation_artifacts",
  "prose_only_report_artifacts",
  "numeric_chartable_artifacts",
  "economics_followup",
  "physics_exergy_followup",
  "chart_request_with_chartable_data",
  "chart_request_without_chartable_data",
  "report_export_request",
  "multi_focus_request",
] as const;

function valueAtPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split(".").reduce((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const idx = Number(segment);
      return Number.isInteger(idx) ? current[idx] : undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function stringifyObserved(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "<missing>";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function chatResponse(body: Record<string, unknown>): Record<string, unknown> {
  const response = body.response;
  return response && typeof response === "object" && !Array.isArray(response)
    ? response as Record<string, unknown>
    : body;
}

function chartSpecs(body: Record<string, unknown>): Record<string, unknown>[] {
  const artifact = body.artifact;
  const artifactRecord = artifact && typeof artifact === "object" && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : {};
  const content = artifactRecord.content && typeof artifactRecord.content === "object" && !Array.isArray(artifactRecord.content)
    ? artifactRecord.content as Record<string, unknown>
    : {};
  return Array.isArray(content.chart_specs)
    ? content.chart_specs.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function issueFor(
  context: ProductStressExecutionContext,
  expectation: ProductStressExpectation,
  observed: unknown,
): ProductStressIssue {
  return {
    severity: expectation.kind === "forbidden_text" ? "blocker" : "warning",
    case_id: context.caseDef.id,
    prompt_id: context.prompt.id,
    expectation,
    observed: stringifyObserved(observed),
    acceptance_test_hint:
      `Add or update a product stress acceptance test for case ${context.caseDef.id}, prompt ${context.prompt.id}, expectation ${expectation.kind}.`,
  };
}

export function evaluateProductStressResult(
  context: ProductStressExecutionContext,
  result: ProductStressRawResult,
): ProductStressIssue[] {
  const issues: ProductStressIssue[] = [];
  const response = chatResponse(result.body);

  for (const expectation of context.prompt.expectations) {
    if (expectation.kind === "http_status") {
      if (result.status !== expectation.status) {
        issues.push(issueFor(context, expectation, result.status));
      }
      continue;
    }

    if (expectation.kind === "response_type") {
      if (response.type !== expectation.response_type) {
        issues.push(issueFor(context, expectation, response.type));
      }
      continue;
    }

    if (expectation.kind === "workflow_reason") {
      const orchestration = response.workflow_orchestration;
      const reason = orchestration && typeof orchestration === "object" && !Array.isArray(orchestration)
        ? (orchestration as Record<string, unknown>).reason
        : undefined;
      if (reason !== expectation.reason) {
        issues.push(issueFor(context, expectation, reason));
      }
      continue;
    }

    if (expectation.kind === "action_type") {
      const action = response.action;
      const actionType = action && typeof action === "object" && !Array.isArray(action)
        ? (action as Record<string, unknown>).type
        : undefined;
      if (actionType !== expectation.action_type) {
        issues.push(issueFor(context, expectation, actionType));
      }
      continue;
    }

    if (expectation.kind === "first_plan_action") {
      const steps = Array.isArray(response.plan_steps) ? response.plan_steps : [];
      const first = steps[0] && typeof steps[0] === "object" ? steps[0] as Record<string, unknown> : {};
      if (first.action_type !== expectation.action_type) {
        issues.push(issueFor(context, expectation, first.action_type));
      }
      continue;
    }

    if (expectation.kind === "contains_text") {
      const value = stringifyObserved(valueAtPath(result.body, expectation.path));
      if (!value.includes(expectation.text)) {
        issues.push(issueFor(context, expectation, value));
      }
      continue;
    }

    if (expectation.kind === "forbidden_text") {
      const value = stringifyObserved(valueAtPath(result.body, expectation.path));
      if (new RegExp(expectation.pattern, "i").test(value)) {
        issues.push(issueFor(context, expectation, value));
      }
      continue;
    }

    if (expectation.kind === "artifact_type") {
      const artifact = result.body.artifact;
      const artifactType = artifact && typeof artifact === "object" && !Array.isArray(artifact)
        ? (artifact as Record<string, unknown>).type
        : undefined;
      if (artifactType !== expectation.artifact_type) {
        issues.push(issueFor(context, expectation, artifactType));
      }
      continue;
    }

    if (expectation.kind === "chart_title") {
      if (!chartSpecs(result.body).some((spec) => spec.title === expectation.title)) {
        issues.push(issueFor(context, expectation, chartSpecs(result.body).map((spec) => spec.title)));
      }
    }
  }

  return issues;
}

export async function runProductStressCampaign(
  options: ProductStressCampaignOptions,
): Promise<ProductStressCampaignReport> {
  const now = options.now || (() => new Date());
  const startedDate = now();
  const startedAt = startedDate.toISOString();
  const startedMs = startedDate.getTime();
  const deadlineMs = startedMs + options.timebox_ms;
  const maxIterations = Math.max(1, options.max_iterations ?? 1);
  const promptResults: ProductStressPromptResult[] = [];
  const casesRun = new Set<string>();

  let completedIterations = 0;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (now().getTime() >= deadlineMs) break;
    completedIterations += 1;

    for (const caseDef of options.cases) {
      casesRun.add(caseDef.id);
      for (const prompt of caseDef.prompts) {
        if (now().getTime() >= deadlineMs) break;
        const context = { caseDef, prompt, iteration };
        const promptStarted = now().getTime();
        const raw = await options.executePrompt(context);
        const elapsedMs = raw.elapsed_ms ?? Math.max(0, now().getTime() - promptStarted);
        const issues = evaluateProductStressResult(context, raw);
        promptResults.push({
          case_id: caseDef.id,
          prompt_id: prompt.id,
          surface: prompt.surface,
          intent: prompt.intent,
          status: raw.status,
          elapsed_ms: elapsedMs,
          body: raw.body,
          issues,
        });
      }
    }
  }

  const completedDate = now();
  const issues = promptResults.flatMap((result) => result.issues);
  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  return {
    campaign_id: options.campaign_id || `product_stress_${startedAt.replace(/[-:.]/g, "").slice(0, 15)}`,
    started_at: startedAt,
    completed_at: completedDate.toISOString(),
    elapsed_ms: Math.max(0, completedDate.getTime() - startedMs),
    requested_timebox_ms: options.timebox_ms,
    completed_iterations: completedIterations,
    cases_run: Array.from(casesRun),
    prompt_results: promptResults,
    issues,
    summary: {
      prompts_run: promptResults.length,
      blockers,
      warnings,
      passed: issues.length === 0,
    },
  };
}

export function renderProductStressCampaignMarkdown(report: ProductStressCampaignReport): string {
  const lines = [
    `# Product Stress Campaign ${report.campaign_id}`,
    "",
    `Started: ${report.started_at}`,
    `Completed: ${report.completed_at}`,
    `Elapsed ms: ${report.elapsed_ms}`,
    `Requested timebox ms: ${report.requested_timebox_ms}`,
    `Iterations: ${report.completed_iterations}`,
    `Prompts run: ${report.summary.prompts_run}`,
    `Blockers: ${report.summary.blockers}`,
    `Warnings: ${report.summary.warnings}`,
    "",
    "## Cases",
    ...report.cases_run.map((caseId) => `- ${caseId}`),
    "",
    "## Issues",
  ];

  if (report.issues.length === 0) {
    lines.push("- None");
  } else {
    for (const issue of report.issues) {
      lines.push(
        `- ${issue.severity.toUpperCase()} ${issue.case_id}/${issue.prompt_id}: ${issue.expectation.kind} observed ${issue.observed}`,
      );
      lines.push(`  Acceptance test hint: ${issue.acceptance_test_hint}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
