import { NextRequest } from "next/server";

import { POST } from "@/app/api/projects/[id]/export/route";

const project = {
  id: "diag-project",
  name: "Diagnostic Project",
  description: "Debug export coverage.",
  goal: "Troubleshoot rendered chat state.",
  domain: "district_heating",
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

const document = {
  id: "doc_1",
  filename: "retrofit-note.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
  status: "ready",
  uploaded_at: "2026-05-25T00:01:00.000Z",
  extraction_result: {
    text: "Waste heat source temperature is 88 C. Installed cost is 6.4 million USD. CSV row values include 32,18,16.9.",
  },
};

const artifact = {
  id: "art_1",
  schema_version: 1,
  type: "workspace_run",
  title: "Workspace Result",
  summary: "Computed result.",
  content: { report_markdown: "Computed result used 88 C and 6.4 million USD." },
  source: "ai_synthesis",
  raw: {},
  metadata: {},
  action_id: "act_1",
  provenance: { source: "ai_synthesis", deterministic: false },
  created_at: "2026-05-25T00:02:00.000Z",
  pinned: false,
};

const action = {
  id: "act_1",
  project_id: "diag-project",
  type: "agent_workspace",
  status: "completed",
  trigger: "user",
  input: { task: "Analyze attached PDF" },
  artifact_id: "art_1",
  created_at: "2026-05-25T00:02:00.000Z",
  completed_at: "2026-05-25T00:03:00.000Z",
};

const run = {
  id: "run_1",
  project_id: "diag-project",
  user_message: "Analyze this file and create a concise decision readout.",
  attachment_document_ids: ["doc_1"],
  mode: "implement",
  thinking_level: "expert",
  status: "completed",
  final_answer: "The project looks attractive at 42.7 MW. View Details for more.",
  action_ids: ["act_1"],
  artifact_ids: ["art_1"],
  files: [],
  created_at: "2026-05-25T00:02:00.000Z",
  updated_at: "2026-05-25T00:03:00.000Z",
  completed_at: "2026-05-25T00:03:00.000Z",
};

const events = [
  {
    id: "evt_1",
    project_id: "diag-project",
    run_id: "run_1",
    sequence: 1,
    type: "run.started",
    message: "Run created.",
    data: {},
    created_at: "2026-05-25T00:02:00.000Z",
  },
  {
    id: "evt_2",
    project_id: "diag-project",
    run_id: "run_1",
    sequence: 2,
    type: "assistant.message",
    message: "Different server event text.",
    data: {},
    created_at: "2026-05-25T00:03:00.000Z",
  },
  {
    id: "evt_3",
    project_id: "diag-project",
    run_id: "run_1",
    sequence: 3,
    type: "run.completed",
    message: "Run completed.",
    data: { final_answer: run.final_answer },
    created_at: "2026-05-25T00:03:00.000Z",
  },
];

const mockStorage = {
  getProject: jest.fn(async () => project),
  listArtifacts: jest.fn(async () => [{
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    summary: artifact.summary,
    source: artifact.source,
    created_at: artifact.created_at,
    pinned: artifact.pinned,
  }]),
  getArtifact: jest.fn(async () => artifact),
  listDocuments: jest.fn(async () => [document]),
  listActions: jest.fn(async () => [action]),
  listAgentRuns: jest.fn(async () => [run]),
  listAgentEvents: jest.fn(async () => events),
};

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(() => mockStorage),
}));

jest.mock("@/lib/agent-run-queue", () => ({
  resumeRunnableAgentRuns: jest.fn(async () => undefined),
}));

jest.mock("@/lib/debug-log", () => ({
  getDebugLog: jest.fn(() => [{
    ts: "2026-05-25T00:04:00.000Z",
    category: "llm",
    event: "mock call",
    details: { api_key: "should-redact", model: "mock" },
  }]),
  getDebugSummary: jest.fn(() => ({ total_events: 1, llm_calls: 1 })),
}));

jest.mock("@/lib/environment-readiness", () => ({
  buildEnvironmentReadiness: jest.fn(() => ({
    overall: "ready",
    checks: [{ id: "llm", label: "Primary agent model", status: "ready", message: "ready", required: true }],
  })),
}));

describe("project diagnostic export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes diagnostics for UI reconstruction and suspicious final answers", async () => {
    const req = new NextRequest("http://localhost/api/projects/diag-project/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "assistant",
            runId: "run_1",
            content: "Client rendered stale content.",
          },
          {
            role: "assistant",
            runId: "run_missing",
            content: "This message has no server run.",
          },
        ],
        client_snapshot: {
          active_run_ids: ["run_missing"],
          client_errors: [{ context: "render", message: "mock render issue" }],
        },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "diag-project" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("Diagnostic_Project_diagnostic_export.json");

    const body = await res.json();
    expect(body.export_type).toBe("diagnostic_project_export");
    expect(body.diagnostics.schema_version).toBe(2);
    expect(body.diagnostics.tool_health.overall).toBe("ready");
    expect(body.diagnostics.ui_reconstruction.server_rendered_messages).toHaveLength(2);
    expect(body.diagnostics.ui_reconstruction.client_vs_server.unknown_client_run_ids).toEqual(["run_missing"]);

    const issueCodes = body.diagnostics.issues.map((issue: { code: string }) => issue.code);
    expect(issueCodes).toEqual(expect.arrayContaining([
      "client_references_unknown_run_id",
      "client_server_message_mismatch",
      "forbidden_legacy_phrase_in_final_answer",
      "answer_numbers_not_seen_in_sources",
    ]));
    const numberIssue = body.diagnostics.issues.find((issue: { code: string }) => issue.code === "answer_numbers_not_seen_in_sources");
    expect(numberIssue.details.diagnostic_reason).toMatch(/numeric-equivalent/i);
    expect(numberIssue.details).toHaveProperty("computed_value_tokens_seen_in_artifacts");
    expect(body.diagnostics.run_diagnostics[0].quality_evaluation).toBeTruthy();
    expect(body.diagnostics.run_diagnostics[0].claim_ledger).toBeTruthy();
    expect(body.diagnostics.run_diagnostics[0].source_alignment.source_number_like_tokens).not.toContain("321816.9");
    expect(body.diagnostics.run_diagnostics[0].source_extraction_confidence).toHaveLength(1);
    expect(JSON.stringify(body.diagnostics.debug_log.events)).toContain("[redacted]");
  });
});
