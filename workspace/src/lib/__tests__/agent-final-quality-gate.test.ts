import { runFinalQualityGate } from "@/lib/agent-final-quality-gate";
import type { AgentEvent, AgentRun, Artifact, Project, ProjectDocument } from "@/lib/storage/types";

const project: Project = {
  id: "project_quality",
  name: "Quality Project",
  description: "Quality gate test",
  goal: "Reliable answers",
  domain: "general",
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

const run: AgentRun = {
  id: "run_quality",
  project_id: project.id,
  user_message: "Build an economic model and recommend whether to proceed.",
  attachment_document_ids: ["doc_1"],
  mode: "implement",
  thinking_level: "expert",
  status: "running",
  action_ids: ["act_1"],
  artifact_ids: ["art_1"],
  files: [],
  created_at: "2026-05-25T00:01:00.000Z",
  updated_at: "2026-05-25T00:01:00.000Z",
};

const document: ProjectDocument = {
  id: "doc_1",
  filename: "case.md",
  mime_type: "text/markdown",
  size_bytes: 100,
  status: "extracted",
  uploaded_at: "2026-05-25T00:00:00.000Z",
  extraction_result: {
    text: "Capacity is 77 MWe. Capacity factor is 92 percent. CAPEX is 7500 USD/kWe.",
  },
};

const artifact: Artifact = {
  id: "art_1",
  schema_version: 1,
  type: "workspace_run",
  title: "Workspace Run",
  summary: "Calculated LCOE.",
  content: {
    results: {
      annual_generation_mwh: 620000,
      lcoe_usd_mwh: 118,
    },
  },
  source: "ai_synthesis",
  raw: {},
  metadata: {},
  action_id: "act_1",
  provenance: { source: "ai_synthesis", deterministic: false },
  created_at: "2026-05-25T00:02:00.000Z",
  pinned: false,
};

const events: AgentEvent[] = [
  {
    id: "evt_1",
    project_id: project.id,
    run_id: run.id,
    sequence: 1,
    type: "run.started",
    message: "Run created.",
    data: {},
    created_at: "2026-05-25T00:01:00.000Z",
  },
];

const mockStorage = {
  getProject: jest.fn(async () => project),
  listDocuments: jest.fn(async () => [document]),
  getArtifact: jest.fn(async () => artifact),
  listAgentEvents: jest.fn(async () => events),
};

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(() => mockStorage),
}));

jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn(() => undefined),
  callDeepSeekV3: jest.fn(),
}));

describe("final quality gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps the answer as-is and produces persisted diagnostics without forcing scaffolding", async () => {
    const answer = "I extracted 77 MWe and 92 percent. I calculated annual generation as 620,000 MWh and LCOE as 118 USD/MWh.";
    const result = await runFinalQualityGate({
      projectId: project.id,
      run,
      finalAnswer: answer,
      patch: { files: [] },
    });

    // Answer-first: no forced Support-and-Limits scaffolding is appended.
    expect(result.finalAnswer).not.toContain("Support and Limits");
    expect(result.finalAnswer).not.toContain("Calculation execution");
    expect(result.appendedLimitNote).toBe(false);
    expect(result.finalAnswer).toContain("620,000 MWh");
    // Diagnostics are still computed and persisted.
    expect(result.answerContract.highStakes).toBe(true);
    expect(result.qualityEvaluation.score).toBeGreaterThan(0);
    expect(result.claimLedger.summary.total_claims).toBeGreaterThan(0);
    expect(result.sourceExtractionConfidence[0].filename).toBe("case.md");
  });
});
