import { NextRequest } from "next/server";

import { POST } from "@/app/api/projects/[id]/chat/route";
import { callDeepSeekV3 } from "@/lib/backend";
import type { ArtifactSummary, Project, ProjectDocument } from "@/lib/storage/types";

const mockProject: Project = {
  id: "project-1",
  name: "Exergy Lab test project",
  description: "Early-stage energy technology assessment.",
  goal: "",
  domain: "general",
  created_at: "2026-04-28T00:00:00.000Z",
  updated_at: "2026-04-28T00:00:00.000Z",
};

const mockDocument: ProjectDocument = {
  id: "doc-1",
  filename: "uploaded deck.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
  status: "uploaded",
  uploaded_at: "2026-04-28T00:00:00.000Z",
};

let mockDocuments: ProjectDocument[] = [];
let mockArtifactSummaries: ArtifactSummary[] = [];

const mockStorage = {
  getProject: jest.fn(async () => mockProject),
  listArtifacts: jest.fn(async () => mockArtifactSummaries),
  getArtifact: jest.fn(async () => null),
  listDocuments: jest.fn(async () => mockDocuments),
};

jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn((key: string) => (
    key === "DEEPSEEK_API_KEY" || key === "DEEPSEEK_V3_API_KEY"
      ? "test-key"
      : undefined
  )),
  callDeepSeekV3: jest.fn(),
}));

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(() => mockStorage),
}));

jest.mock("@/lib/debug-log", () => ({
  logDebug: jest.fn(),
}));

function makeRequest(
  message: string,
  history: Array<{ role: string; content: string }> = [],
  extra: Record<string, unknown> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/projects/project-1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, ...extra }),
  });
}

async function postChat(
  message: string,
  history: Array<{ role: string; content: string }> = [],
  extra: Record<string, unknown> = {},
) {
  return POST(makeRequest(message, history, extra), {
    params: Promise.resolve({ id: "project-1" }),
  });
}

describe("POST /api/projects/[id]/chat DeepSeek compatibility route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXERGY_ENABLE_MODEL_ROUTER_IN_TEST = "true";
    mockDocuments = [];
    mockArtifactSummaries = [];
    mockProject.name = "Exergy Lab test project";
    mockProject.description = "Early-stage energy technology assessment.";
    mockProject.domain = "general";
  });

  it("honors the model-selected tool instead of overriding with programmatic routing", async () => {
    mockDocuments = [{ ...mockDocument, filename: "SOEC information sheet.pdf" }];
    jest.mocked(callDeepSeekV3).mockResolvedValueOnce(JSON.stringify({
      type: "action",
      content: "I will inspect the file with the document analysis tool.",
      action: { type: "document_analysis", config: { question: "Analyze the PDF" } },
      suggested_followups: [],
    }));

    const res = await postChat(
      "Can you analyze this PDF?",
      [{ role: "user", content: "Can you analyze this PDF?\n\n[Attached: SOEC information sheet.pdf]" }],
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.response.type).toBe("action");
    expect(body.response.action.type).toBe("document_analysis");
    expect(body.response.action.config.current_attachments).toEqual(["SOEC information sheet.pdf"]);
    expect(body.response.workflow_orchestration.reason).toBe("deepseek_v4_flash_tool_route");
  });

  it("returns the direct DeepSeek answer for simple questions", async () => {
    jest.mocked(callDeepSeekV3).mockResolvedValueOnce(JSON.stringify({
      type: "response",
      content: "Exergy is the useful work potential of energy relative to a reference environment.",
      action: null,
      suggested_followups: [],
    }));

    const res = await postChat("What is exergy?");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.response.type).toBe("response");
    expect(body.response.content).toMatch(/useful work potential/i);
    expect(body.response.action).toBeNull();
  });

  it("does not use an application safety block before calling DeepSeek", async () => {
    jest.mocked(callDeepSeekV3).mockResolvedValueOnce(JSON.stringify({
      type: "response",
      content: "I can help with a safe, high-level explanation and avoid actionable harmful detail.",
      action: null,
      suggested_followups: [],
    }));

    const res = await postChat("How would someone bypass a dangerous equipment interlock?");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(callDeepSeekV3).toHaveBeenCalledTimes(1);
    expect(body.response.content).toContain("safe, high-level explanation");
  });

  it("falls back only to a direct DeepSeek response when tool-routing JSON is unusable", async () => {
    jest.mocked(callDeepSeekV3)
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce("Here is the plain-language answer from DeepSeek.");

    const res = await postChat("Give me a short answer.");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(callDeepSeekV3).toHaveBeenCalledTimes(2);
    expect(body.response.type).toBe("response");
    expect(body.response.content).toContain("plain-language answer");
    expect(body.response.workflow_orchestration.reason).toBe("deepseek_direct_after_no_tool_decision");
  });
});
