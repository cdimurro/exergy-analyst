import { NextRequest } from "next/server";
import type { Action, Artifact, Project, ProjectDocument } from "@/lib/storage/types";
import { POST } from "@/app/api/projects/[id]/actions/route";
import { getProjectUploadPaths, runExergyWorkspaceAgent } from "@/lib/exergy-agent";

const project: Project = {
  id: "project-action",
  name: "Current attachment project",
  description: "",
  goal: "",
  domain: "general",
  created_at: "2026-05-23T00:00:00.000Z",
  updated_at: "2026-05-23T00:00:00.000Z",
};

const documents: ProjectDocument[] = [
  {
    id: "doc_current",
    filename: "current unfamiliar deck.pdf",
    mime_type: "application/pdf",
    size_bytes: 100,
    status: "uploaded",
    uploaded_at: "2026-05-23T00:00:00.000Z",
  },
  {
    id: "doc_old",
    filename: "old unrelated report.pdf",
    mime_type: "application/pdf",
    size_bytes: 100,
    status: "uploaded",
    uploaded_at: "2026-05-23T00:00:00.000Z",
  },
  {
    text: "Parser sidecar records can appear in local document lists.",
    parser: "Gemini Flash vision",
    status: "extracted",
  } as unknown as ProjectDocument,
];

let createdArtifact: Artifact | null = null;
let storedAction: Action | null = null;

const mockStorage = {
  getProject: jest.fn(async () => project),
  listDocuments: jest.fn(async () => documents),
  listArtifacts: jest.fn(async () => []),
  createAction: jest.fn(async (_projectId: string, action: Omit<Action, "id" | "created_at">): Promise<Action> => {
    storedAction = {
      ...action,
      id: "act_current",
      created_at: "2026-05-23T00:00:01.000Z",
    };
    return storedAction;
  }),
  getAction: jest.fn(async () => storedAction),
  updateAction: jest.fn(async (_projectId: string, _actionId: string, patch: Partial<Action>) => {
    if (storedAction) storedAction = { ...storedAction, ...patch };
  }),
  getArtifact: jest.fn(async (_projectId: string, artifactId: string) =>
    createdArtifact?.id === artifactId ? createdArtifact : null
  ),
  createArtifact: jest.fn(async (_projectId: string, artifact: Omit<Artifact, "id" | "created_at">): Promise<Artifact> => {
    createdArtifact = {
      ...artifact,
      id: "art_current",
      created_at: "2026-05-23T00:00:02.000Z",
    };
    return createdArtifact;
  }),
};

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(() => mockStorage),
}));

jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn(() => undefined),
  RUNTIME_DIR: "/tmp/exergy-action-route-test",
  DEEPSEEK_API_URL: "https://example.invalid",
  callDeepSeekV3: jest.fn(),
  callQwen36Plus: jest.fn(),
  callGLM51: jest.fn(),
}));

jest.mock("@/lib/debug-log", () => ({
  logDebug: jest.fn(),
}));

jest.mock("@/lib/exergy-agent", () => {
  const actual = jest.requireActual("@/lib/exergy-agent");
  return {
    ...actual,
    getProjectUploadPaths: jest.fn(async () => ["/runtime/current unfamiliar deck.pdf"]),
    runExergyWorkspaceAgent: jest.fn(async () => ({
      executive_answer: "The current uploaded deck was analyzed.",
      memo_markdown: "# Client Analysis Memo\n\n## Bottom Line\nThe current uploaded deck was analyzed.",
      detected_use_cases: ["document-review"],
      files: [
        {
          filename: "current unfamiliar deck.pdf",
          file_type: "pdf",
          size_bytes: 100,
          size_label: "100 B",
          parser_status: "test parser",
          summary: "PDF text extracted",
          detected_use_cases: ["document-review"],
        },
      ],
      stages: [],
      tool_calls: [],
      physics_screens: [],
      top_insights: [
        {
          title: "Current file analyzed",
          evidence: "Only the referenced attachment was passed to the agent.",
          recommendation: "Use the current attachment scope.",
          support: "observed",
        },
      ],
      limitations: [],
      next_actions: [],
      confidence: "screening_grade",
    })),
  };
});

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/projects/project-action/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "evidence_evaluation",
      config: {
        question: "Analyze this deck.\n\n[Attached: current unfamiliar deck.pdf]",
        description: "Analyze this deck.\n\n[Attached: current unfamiliar deck.pdf]",
        current_attachments: ["current unfamiliar deck.pdf"],
      },
    }),
  });
}

describe("actions route current attachment scoping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdArtifact = null;
    storedAction = null;
  });

  it("passes only the referenced current attachment to the universal agent", async () => {
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: "project-action" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.artifact.summary).toBe("The current uploaded deck was analyzed.");
    expect(getProjectUploadPaths).toHaveBeenCalledWith("project-action", ["current unfamiliar deck.pdf"]);
    expect(runExergyWorkspaceAgent).toHaveBeenCalledWith(
      expect.stringContaining("Uploaded files: current unfamiliar deck.pdf"),
      ["/runtime/current unfamiliar deck.pdf"],
      expect.any(Number),
    );
    expect(runExergyWorkspaceAgent).toHaveBeenCalledWith(
      expect.not.stringContaining("old unrelated report.pdf"),
      expect.any(Array),
      expect.any(Number),
    );
    expect((runExergyWorkspaceAgent as jest.Mock).mock.calls[0][2]).toBeGreaterThanOrEqual(4 * 60_000);
    expect(createdArtifact?.metadata.prompt).toContain("[Attached: current unfamiliar deck.pdf]");
  });

  it("fails visibly instead of returning a recovery artifact when the agent runtime errors", async () => {
    (runExergyWorkspaceAgent as jest.Mock).mockRejectedValueOnce(new Error("python runtime unavailable"));

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: "project-action" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Action could not complete");
    expect(body.detail).toContain("python runtime unavailable");
    expect(mockStorage.updateAction).toHaveBeenCalledWith("project-action", "act_current", expect.objectContaining({
      status: "failed",
      error: "python runtime unavailable",
    }));
    expect(createdArtifact).toBeNull();
  });
});
