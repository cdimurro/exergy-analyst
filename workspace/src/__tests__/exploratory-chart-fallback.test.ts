import { NextRequest } from "next/server";
import type { Action, Artifact, ArtifactSummary, Project } from "@/lib/storage/types";
import { POST } from "@/app/api/projects/[id]/actions/route";
import { callQwen36Plus } from "@/lib/backend";

const project: Project = {
  id: "project-chart",
  name: "Chart fallback project",
  description: "Fischer-Tropsch evaluation",
  goal: "Investor diligence",
  domain: "fuels_chemical",
  created_at: "2026-04-29T00:00:00.000Z",
  updated_at: "2026-04-29T00:00:00.000Z",
};

const evaluation: Artifact = {
  id: "art_eval",
  schema_version: 1,
  type: "evaluation",
  title: "Evidence Evaluation: FT system",
  summary: "Score: 0.71 across 10 modules.",
  content: {
    module_evaluations: {
      physics: { verdict: "conditional", score_0_100: 74, confidence_0_1: 0.68 },
      economics: { verdict: "conditional", score_0_100: 61, confidence_0_1: 0.52 },
    },
    exergy_metrics: {
      exergetic_efficiency: 0.5368,
      first_law_efficiency: 0.51,
      quality_factor: 0.95,
    },
    brief: {
      ranked_gap_guidance: [
        { parameter: "CAPEX", impact: "high", why_it_matters: "Dominates financing risk." },
      ],
    },
  },
  source: "canonical_engine",
  raw: {},
  metadata: {},
  action_id: "act_old",
  provenance: { source: "canonical_engine", deterministic: true },
  created_at: "2026-04-29T00:00:00.000Z",
  pinned: false,
};

const proseOnlyReport: Artifact = {
  id: "art_prose",
  schema_version: 1,
  type: "report",
  title: "Literature Synthesis: qualitative findings",
  summary: "Qualitative synthesis without extracted numeric data.",
  content: {
    artifact_lane: "exploratory",
    analysis_type: "comparison",
    analysis_summary: "The available sources discuss deployment risk but do not provide extracted numeric series.",
    key_insights: ["Independent economics and exergy values were not found in the current artifacts."],
  },
  source: "ai_synthesis",
  raw: {},
  metadata: {},
  action_id: "act_old_prose",
  provenance: { source: "ai_synthesis", deterministic: false },
  created_at: "2026-04-29T00:00:00.000Z",
  pinned: false,
};

let createdArtifact: Artifact | null = null;
let sourceArtifacts: Artifact[] = [evaluation];

const mockStorage = {
  getProject: jest.fn(async () => project),
  listDocuments: jest.fn(async () => []),
  listArtifacts: jest.fn(async (): Promise<ArtifactSummary[]> => sourceArtifacts.map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    summary: artifact.summary,
    source: artifact.source,
    created_at: artifact.created_at,
    pinned: artifact.pinned,
  }))),
  getArtifact: jest.fn(async (_projectId: string, artifactId: string) =>
    sourceArtifacts.find((artifact) => artifact.id === artifactId) || null,
  ),
  createAction: jest.fn(async (_projectId: string, action: Omit<Action, "id" | "created_at">): Promise<Action> => ({
    ...action,
    id: "act_chart",
    created_at: "2026-04-29T00:00:01.000Z",
  })),
  updateAction: jest.fn(async () => undefined),
  createArtifact: jest.fn(async (_projectId: string, artifact: Omit<Artifact, "id" | "created_at">): Promise<Artifact> => {
    createdArtifact = {
      ...artifact,
      id: "art_chart",
      created_at: "2026-04-29T00:00:02.000Z",
    };
    return createdArtifact;
  }),
};

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(() => mockStorage),
}));

jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn(() => undefined),
  RUNTIME_DIR: "/tmp/exergy-test-runtime",
  DEEPSEEK_API_URL: "https://example.invalid",
  callDeepSeekV3: jest.fn(),
  callQwen36Plus: jest.fn(),
  callGLM51: jest.fn(),
}));

jest.mock("@/lib/debug-log", () => ({
  logDebug: jest.fn(),
}));

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/projects/project-chart/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "exploratory_analysis",
      input: {
        question: "Create charts for module scores, exergy, and economics gaps.",
        analysis_type: "comparison",
      },
    }),
  });
}

describe("exploratory chart fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdArtifact = null;
    sourceArtifacts = [evaluation];
    jest.mocked(callQwen36Plus).mockRejectedValue(new Error("model unavailable"));
  });

  it("generates chart specs from existing artifacts when the model path fails", async () => {
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: "project-chart" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.artifact.type).toBe("report");
    expect(body.artifact.content.source_artifact_count).toBe(1);
    expect(body.artifact.content.chart_specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Module Scorecard", chart_type: "bar" }),
        expect.objectContaining({ title: "Thermodynamic Quality Metrics", chart_type: "bar" }),
        expect.objectContaining({ title: "Highest-Impact Evidence Gaps", chart_type: "table" }),
      ]),
    );
    expect(createdArtifact?.summary).toContain("Generated chart-ready views");
  });

  it("returns a targeted data-gathering plan when artifacts lack numeric chart data", async () => {
    sourceArtifacts = [proseOnlyReport];

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: "project-chart" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.artifact.type).toBe("report");
    expect(body.artifact.content.chart_specs).toEqual([
      expect.objectContaining({
        chart_type: "table",
        title: "Targeted Data-Gathering Plan for Charting",
      }),
    ]);
    expect(body.artifact.content.chart_specs[0].data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidence_request: expect.stringMatching(/cost|CAPEX|OPEX|price/i) }),
        expect.objectContaining({ evidence_request: expect.stringMatching(/efficiency|yield|throughput/i) }),
      ]),
    );
    expect(body.artifact.content.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("No numeric evaluation, simulation, economics, or gap data was available to chart."),
      ]),
    );
    expect(createdArtifact?.summary).toContain("No chartable numeric data was found");
  });
});
