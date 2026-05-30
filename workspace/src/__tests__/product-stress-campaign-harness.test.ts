import { NextRequest } from "next/server";
import { POST as chatPOST } from "@/app/api/projects/[id]/chat/route";
import { POST as actionPOST } from "@/app/api/projects/[id]/actions/route";
import {
  EIGHT_HOUR_TIMEBOX_MS,
  evaluateProductStressResult,
  renderProductStressCampaignMarkdown,
  runProductStressCampaign,
  type ProductStressExecutionContext,
  type ProductStressRawResult,
} from "@/lib/product-stress-campaign";
import { DEFAULT_PRODUCT_STRESS_CASES } from "@/lib/product-stress-corpus";
import type { Action, Artifact, ArtifactSummary, Project, ProjectDocument } from "@/lib/storage/types";
import { callDeepSeekV3, callQwen36Plus } from "@/lib/backend";

let currentProject: Project;
let currentDocuments: ProjectDocument[];
let currentArtifacts: Artifact[];
let createdArtifacts: Artifact[];

const mockStorage = {
  getProject: jest.fn(async () => currentProject),
  listDocuments: jest.fn(async () => currentDocuments),
  listArtifacts: jest.fn(async (): Promise<ArtifactSummary[]> => currentArtifacts.map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    summary: artifact.summary,
    source: artifact.source,
    parent_id: artifact.parent_id,
    created_at: artifact.created_at,
    pinned: artifact.pinned,
  }))),
  getArtifact: jest.fn(async (_projectId: string, artifactId: string) =>
    currentArtifacts.find((artifact) => artifact.id === artifactId) || null,
  ),
  createAction: jest.fn(async (_projectId: string, action: Omit<Action, "id" | "created_at">): Promise<Action> => ({
    ...action,
    id: `act_${createdArtifacts.length + 1}`,
    created_at: "2026-04-29T00:00:01.000Z",
  })),
  updateAction: jest.fn(async () => undefined),
  createArtifact: jest.fn(async (_projectId: string, artifact: Omit<Artifact, "id" | "created_at">): Promise<Artifact> => {
    const created = {
      ...artifact,
      id: `art_created_${createdArtifacts.length + 1}`,
      created_at: "2026-04-29T00:00:02.000Z",
    };
    createdArtifacts.push(created);
    currentArtifacts = [created, ...currentArtifacts];
    return created;
  }),
};

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(() => mockStorage),
}));

jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn((key: string) => {
    if (key === "DEEPSEEK_API_KEY") return "test-key";
    if (key === "RUNTIME_DIR") return "/tmp/exergy-product-stress-test";
    return undefined;
  }),
  RUNTIME_DIR: "/tmp/exergy-product-stress-test",
  DEEPSEEK_API_URL: "https://example.invalid",
  shouldEscalateToThinking: jest.fn(() => false),
  callDeepSeekV3: jest.fn(),
  callQwen36Plus: jest.fn(),
  callGLM51: jest.fn(),
}));

jest.mock("@/lib/debug-log", () => ({
  logDebug: jest.fn(),
}));

function applyCaseState(context: ProductStressExecutionContext) {
  currentProject = context.caseDef.project;
  currentDocuments = context.caseDef.input_state.documents || [];
  currentArtifacts = [...(context.caseDef.input_state.artifacts || [])];
  createdArtifacts = [];
}

async function executePrompt(context: ProductStressExecutionContext): Promise<ProductStressRawResult> {
  applyCaseState(context);
  const started = Date.now();

  if (context.prompt.surface === "chat") {
    const res = await chatPOST(
      new NextRequest(`http://localhost/api/projects/${context.caseDef.project.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: context.prompt.message, history: [] }),
      }),
      { params: Promise.resolve({ id: context.caseDef.project.id }) },
    );
    return { status: res.status, body: await res.json(), elapsed_ms: Date.now() - started };
  }

  if (!context.prompt.action) {
    throw new Error(`Action prompt ${context.prompt.id} missing action config`);
  }
  const res = await actionPOST(
    new NextRequest(`http://localhost/api/projects/${context.caseDef.project.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: context.prompt.action.type,
        input: context.prompt.action.input,
      }),
    }),
    { params: Promise.resolve({ id: context.caseDef.project.id }) },
  );
  return { status: res.status, body: await res.json(), elapsed_ms: Date.now() - started };
}

describe("product stress campaign harness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(callQwen36Plus).mockRejectedValue(new Error("model unavailable"));
  });

  it("defines the real multi-hour campaign timebox constant", () => {
    expect(EIGHT_HOUR_TIMEBOX_MS).toBe(28_800_000);
  });

  it("runs the default stress corpus through actual workspace chat and actions route handlers", async () => {
    const report = await runProductStressCampaign({
      campaign_id: "test_product_stress",
      cases: DEFAULT_PRODUCT_STRESS_CASES,
      timebox_ms: EIGHT_HOUR_TIMEBOX_MS,
      max_iterations: 1,
      executePrompt,
    });
    expect(report.summary).toMatchObject({
      prompts_run: 7,
      blockers: 0,
      warnings: 0,
      passed: true,
    });
    expect(report.cases_run).toEqual([
      "oxeon_uploaded_documents",
      "xenergy_failed_extraction",
      "eden_literature_only",
      "fischer_tropsch_evaluation",
    ]);
    expect(report.requested_timebox_ms).toBe(EIGHT_HOUR_TIMEBOX_MS);
    expect(renderProductStressCampaignMarkdown(report)).toContain("## Issues\n- None");
    expect(callDeepSeekV3).not.toHaveBeenCalled();
  });

  it("turns failed expectations into actionable acceptance-test hints", () => {
    const context = {
      caseDef: DEFAULT_PRODUCT_STRESS_CASES[0],
      prompt: DEFAULT_PRODUCT_STRESS_CASES[0].prompts[0],
      iteration: 0,
    };

    const issues = evaluateProductStressResult(context, {
      status: 200,
      body: {
        response: {
          type: "response",
          content: "I will run the analysis now.",
        },
      },
    });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].acceptance_test_hint).toContain("Add or update a product stress acceptance test");
    expect(issues.map((issue) => issue.prompt_id)).toContain("editable_plan_full_tea");
  });
});
