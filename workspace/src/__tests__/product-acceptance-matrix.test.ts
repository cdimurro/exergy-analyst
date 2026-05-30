import { NextRequest, NextResponse } from "next/server";

import type { AgentEvent, AgentRun, Artifact, Project, ProjectDocument } from "@/lib/storage/types";
import { POST as createRunPost } from "@/app/api/projects/[id]/runs/route";
import { GET as getRun } from "@/app/api/projects/[id]/runs/[runId]/route";
import { POST as approveRunPost } from "@/app/api/projects/[id]/runs/[runId]/approve/route";
import { POST as updatePlanPost } from "@/app/api/projects/[id]/runs/[runId]/plan/route";
import { POST as cancelRunPost } from "@/app/api/projects/[id]/runs/[runId]/cancel/route";
import { GET as exportProjectGet } from "@/app/api/projects/[id]/export/route";
import { createAgentRun } from "@/lib/agent-runner";
import { buildDocumentEvidenceDigest } from "@/lib/document-evidence";
import { callDeepSeekV3, getEnvVar } from "@/lib/backend";

const mockProject: Project = {
  id: "project-acceptance",
  name: "Industrial heat retrofit",
  description: "District heating waste heat recovery project with uploaded operating data.",
  goal: "Create exergy-aware decision briefs.",
  domain: "district_heating",
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

let mockRuns: AgentRun[] = [];
let mockEvents: Record<string, AgentEvent[]> = {};
let mockDocuments: ProjectDocument[] = [];
let mockArtifacts: Artifact[] = [];
let mockActionBodies: Record<string, unknown>[] = [];
let counter = 1;

function timestamp(): string {
  return new Date(2026, 4, 25, 13, 0, counter++).toISOString();
}

function resetState() {
  mockRuns = [];
  mockEvents = {};
  mockDocuments = [];
  mockArtifacts = [];
  mockActionBodies = [];
  counter = 1;
  jest.clearAllMocks();
  process.env.EXERGY_ENABLE_MODEL_ROUTER_IN_TEST = "true";
  jest.mocked(getEnvVar).mockImplementation((key: string) => {
    if (key === "DEEPSEEK_API_KEY" || key === "DEEPSEEK_V3_API_KEY") return "test-key";
    if (key === "RUNTIME_DIR") return "/tmp/exergy-agent-run-tests";
    return undefined;
  });
  jest.mocked(callDeepSeekV3).mockImplementation(async (messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
    const joined = messages.map((message) => message.content || "").join("\n");
    if (options?.jsonMode) {
      if (/What is exergy/i.test(joined)) {
        return JSON.stringify({
          type: "response",
          content: "Exergy is the useful work potential of energy relative to a reference environment.",
          action: null,
          suggested_followups: [],
        });
      }
      return JSON.stringify({
        type: "action",
        content: "I will run this through the workspace tool.",
        action: {
          type: "agent_workspace",
          config: {
            plan_outline: [
              { step: 1, title: "Read Context", description: "Review the request, files, prior runs, and artifacts." },
              { step: 2, title: "Run Analysis", description: "Build the requested model or export from the saved context." },
            ],
          },
        },
        suggested_followups: [],
      });
    }
    return "Final synthesized answer from the completed workspace run.";
  });
}

const mockStorage = {
  getProject: jest.fn(async () => mockProject),
  listDocuments: jest.fn(async () => mockDocuments),
  listArtifacts: jest.fn(async () => mockArtifacts.map((artifact) => ({
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
    mockArtifacts.find((artifact) => artifact.id === artifactId) || null
  ),
  createArtifact: jest.fn(async (_projectId: string, input: Omit<Artifact, "id" | "created_at">) => {
    const artifact: Artifact = {
      ...input,
      id: `art_created_${counter++}`,
      created_at: timestamp(),
    };
    mockArtifacts.push(artifact);
    return artifact;
  }),
  listActions: jest.fn(async () => []),
  createAgentRun: jest.fn(async (projectId: string, input: Omit<AgentRun, "id" | "project_id" | "status" | "created_at" | "updated_at"> & { status?: AgentRun["status"] }) => {
    const run: AgentRun = {
      ...input,
      id: `run_${counter++}`,
      project_id: projectId,
      status: input.status || "queued",
      created_at: timestamp(),
      updated_at: timestamp(),
    };
    mockRuns.push(run);
    mockEvents[run.id] = [];
    return run;
  }),
  getAgentRun: jest.fn(async (_projectId: string, runId: string) =>
    mockRuns.find((run) => run.id === runId) || null
  ),
  listAgentRuns: jest.fn(async () => mockRuns),
  updateAgentRun: jest.fn(async (_projectId: string, runId: string, patch: Partial<AgentRun>) => {
    mockRuns = mockRuns.map((run) =>
      run.id === runId ? { ...run, ...patch, updated_at: patch.updated_at || timestamp() } : run
    );
  }),
  appendAgentEvent: jest.fn(async (projectId: string, runId: string, input: Omit<AgentEvent, "id" | "project_id" | "run_id" | "sequence" | "created_at">) => {
    const prior = mockEvents[runId] || [];
    const event: AgentEvent = {
      ...input,
      id: `evt_${counter++}`,
      project_id: projectId,
      run_id: runId,
      sequence: prior.length + 1,
      created_at: timestamp(),
    };
    mockEvents[runId] = [...prior, event];
    return event;
  }),
  listAgentEvents: jest.fn(async (_projectId: string, runId: string) => mockEvents[runId] || []),
};

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(() => mockStorage),
}));

jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn(() => undefined),
  callDeepSeekV3: jest.fn(),
  RUNTIME_DIR: "/tmp/exergy-agent-run-tests",
}));

jest.mock("@/lib/debug-log", () => ({
  logDebug: jest.fn(),
  getDebugLog: jest.fn(() => []),
  getDebugSummary: jest.fn(() => ({ total_events: 0, by_type: {} })),
}));

jest.mock("@/lib/project-action-dispatcher", () => ({
  executeProjectAction: jest.fn(async ({ projectId, actionType, input }: { projectId: string; actionType: string; input: Record<string, unknown> }) => {
    mockActionBodies.push({ type: actionType, input });
    const type = String(actionType || "agent_workspace");
    const isWorkspace = type === "agent_workspace";
    const requested = new Set(Array.isArray(input.requested_outputs) ? input.requested_outputs.map(String) : []);
    const task = String(input.task || input.question || "");
    if (/\bjson\b/i.test(task)) requested.add("json");
    if (/\b(pdf|memo|report)\b/i.test(task)) requested.add("pdf");
    if (/\bcsv\b/i.test(task)) requested.add("csv");
    const files = [
      {
        filename: "decision_brief.csv",
        path: "/home/chris/exergy-analyst/runtime/projects/proj_project-acceptance/decision_brief.csv",
        bytes: 512,
      },
      ...(requested.has("json") ? [{
        filename: "assumptions_ledger.json",
        path: "/home/chris/exergy-analyst/runtime/projects/proj_project-acceptance/assumptions_ledger.json",
        bytes: 256,
      }] : []),
      ...(requested.has("pdf") ? [{
        filename: "client_memo.pdf",
        path: "/home/chris/exergy-analyst/runtime/projects/proj_project-acceptance/client_memo.pdf",
        bytes: 1024,
      }] : []),
      ...(requested.has("markdown") ? [{
        filename: "client_memo.md",
        path: "/home/chris/exergy-analyst/runtime/projects/proj_project-acceptance/client_memo.md",
        bytes: 1024,
      }] : []),
    ];
    const artifact: Artifact = {
      id: `art_${counter++}`,
      schema_version: 1,
      type: isWorkspace ? "workspace_run" : "evaluation",
      title: isWorkspace ? "Workspace Techno-Economic Run" : "Evidence Analysis",
      summary: isWorkspace
        ? "Techno-economic workspace run completed with bounded assumptions."
        : "Uploaded evidence analysis completed with bounded findings.",
      content: isWorkspace
        ? {
          analysis_type: "agent_workspace",
          report_markdown: [
            "# Workspace Decision Brief",
            "",
            "## Source-Backed Inputs",
            "",
            "| Input | Value | Unit |",
            "|---|---:|---|",
            "| compressor_A power | 620 | kW |",
            "| pump_B power | 74 | kW |",
            "| refrigeration_C power | 710 | kW |",
            "",
            "## Results",
            "",
            "| Opportunity | Priority | Basis |",
            "|---|---|---|",
            "| refrigeration_C | High | 710 kW and high condensing temperature |",
            "| compressor_A | Medium | 620 kW and inlet filter fouling |",
            "",
            "Formula: annual exposure = power kW x operating hours / 1000.",
            "",
            "## Support and Limits",
            "",
            "The uploaded data supports screening-level prioritization. It does not prove field performance, ROI, compliance, safety, or final design without measured operating profiles and validation.",
          ].join("\n"),
          results: { tool_execution_completed: true, summary: "Workspace run completed." },
          files,
        }
        : {
          client_summary: {
            decision: "Evidence analysis complete",
            conclusion: "The uploaded file can support a bounded preliminary assessment.",
            supported_claims: [{ claim: "A file was analyzed.", evidence: "Uploaded document context." }],
            not_proven: ["It does not prove economics, operating performance, or deployment readiness."],
            data_requests: [{ request: "temperature profile, flow rate, reference environment, CAPEX, OPEX" }],
          },
        },
      source: "ai_synthesis",
      raw: {},
      metadata: { action_type: type },
      action_id: `act_${counter++}`,
      provenance: { source: "ai_synthesis", deterministic: false },
      created_at: timestamp(),
      pinned: false,
    };
    mockArtifacts.push(artifact);
    return {
      action: { id: artifact.action_id, project_id: projectId, type, status: "completed", artifact_id: artifact.id, input },
      artifact,
      result_summary: isWorkspace
        ? String((artifact.content as Record<string, unknown>).report_markdown)
        : "Evidence analysis complete.\nBasis: A file was analyzed.\nImportant limit: It does not prove economics, operating performance, or deployment readiness.",
    };
  }),
  POST: jest.fn(async (request: NextRequest) => {
    const body = await request.json();
    mockActionBodies.push(body);
    const type = String(body.type || "agent_workspace");
    const isWorkspace = type === "agent_workspace";
    const artifact: Artifact = {
      id: `art_${counter++}`,
      schema_version: 1,
      type: isWorkspace ? "workspace_run" : "evaluation",
      title: isWorkspace ? "Workspace Techno-Economic Run" : "Evidence Analysis",
      summary: isWorkspace
        ? "Techno-economic workspace run completed with bounded assumptions."
        : "Uploaded evidence analysis completed with bounded findings.",
      content: isWorkspace
        ? {
          analysis_type: "agent_workspace",
          report_markdown: [
            "Techno-economic workspace run completed with bounded assumptions.",
            "",
            "Basis: the run used the uploaded/current project context and produced a structured result.",
            "Important limit: this is not proof of field performance without measured operating data, temperature boundaries, and source-backed costs.",
          ].join("\n"),
          files: [
            {
              filename: "decision_brief.csv",
              path: "/home/chris/exergy-analyst/runtime/projects/proj_project-acceptance/decision_brief.csv",
              bytes: 512,
            },
          ],
        }
        : {
          client_summary: {
            decision: "Evidence analysis complete",
            conclusion: "The uploaded file can support a bounded preliminary assessment.",
            supported_claims: [{ claim: "A file was analyzed.", evidence: "Uploaded document context." }],
            not_proven: ["It does not prove economics, operating performance, or deployment readiness."],
            data_requests: [{ request: "temperature profile, flow rate, reference environment, CAPEX, OPEX" }],
          },
        },
      source: "ai_synthesis",
      raw: {},
      metadata: { action_type: type },
      action_id: `act_${counter++}`,
      provenance: { source: "ai_synthesis", deterministic: false },
      created_at: timestamp(),
      pinned: false,
    };
    mockArtifacts.push(artifact);
    return NextResponse.json({
      action: { id: artifact.action_id, type, status: "completed", artifact_id: artifact.id },
      artifact,
      result_summary: isWorkspace
        ? String((artifact.content as Record<string, unknown>).report_markdown)
        : "Evidence analysis complete.\nBasis: A file was analyzed.\nImportant limit: It does not prove economics, operating performance, or deployment readiness.",
    });
  }),
}));

function runRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/projects/project-acceptance/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createRun(body: Record<string, unknown>) {
  const response = await createRunPost(runRequest(body), {
    params: Promise.resolve({ id: "project-acceptance" }),
  });
  return { response, body: await response.json() };
}

async function snapshot(runId: string) {
  const response = await getRun(
    new NextRequest(`http://localhost/api/projects/project-acceptance/runs/${runId}`),
    { params: Promise.resolve({ id: "project-acceptance", runId }) },
  );
  return { response, body: await response.json() };
}

async function waitForRun(runId: string, expected?: string) {
  let last = await snapshot(runId);
  for (let i = 0; i < 20; i += 1) {
    const status = last.body.run?.status;
    if (expected ? status === expected : ["completed", "failed", "cancelled", "waiting_approval"].includes(status)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    last = await snapshot(runId);
  }
  return last;
}

function doc(id: string, filename: string, mime: string, text: string): ProjectDocument {
  const digest = buildDocumentEvidenceDigest(filename, Buffer.from(text), mime);
  return {
    id,
    filename,
    mime_type: mime,
    size_bytes: text.length,
    status: "uploaded",
    uploaded_at: "2026-05-25T00:00:00.000Z",
    extraction_result: digest ? { document_evidence: digest } : {},
  };
}

async function diagnosticExport() {
  const response = await exportProjectGet(
    new NextRequest("http://localhost/api/projects/project-acceptance/export"),
    { params: Promise.resolve({ id: "project-acceptance" }) },
  );
  return response.json();
}

describe("product acceptance matrix: durable server-owned agent runs", () => {
  beforeEach(resetState);

  it("creates one durable run id for every user request and replays events from server state", async () => {
    const { response, body } = await createRun({
      message: "What is exergy?",
      mode: "implement",
      thinking_level: "instant",
    });

    expect(response.status).toBe(202);
    expect(body.run.id).toMatch(/^run_/);

    const saved = await waitForRun(body.run.id, "completed");
    expect(saved.body.run.status).toBe("completed");
    expect(saved.body.run.final_answer).toMatch(/useful work potential/i);
    expect(saved.body.events.map((event: AgentEvent) => event.type)).toEqual(expect.arrayContaining([
      "run.started",
      "assistant.message",
      "run.completed",
    ]));
  });

  it("runs complex techno-economic work server-side and creates a downloadable file artifact", async () => {
    const { body } = await createRun({
      message: "Build a techno-economic model for this waste heat project and export the decision table as CSV.",
      mode: "implement",
      thinking_level: "expert",
    });
    const saved = await waitForRun(body.run.id, "completed");

    expect(mockActionBodies).toHaveLength(1);
    expect(mockActionBodies[0].type).toBe("agent_workspace");
    expect(saved.body.run.status).toBe("completed");
    expect(saved.body.run.final_answer).toContain("Download decision_brief.csv");
    expect(saved.body.events.map((event: AgentEvent) => event.type)).toEqual(expect.arrayContaining([
      "tool.started",
      "tool.completed",
      "artifact.created",
      "file.created",
      "run.completed",
    ]));
  });

  it("plan mode persists visible steps and does not execute until approval", async () => {
    const { body } = await createRun({
      message: "Build a techno-economic model and export CSV.",
      mode: "plan",
      thinking_level: "expert",
    });
    const planned = await waitForRun(body.run.id, "waiting_approval");

    expect(planned.body.run.status).toBe("waiting_approval");
    expect(planned.body.run.plan.length).toBeGreaterThanOrEqual(2);
    expect(mockActionBodies).toHaveLength(0);
    expect(planned.body.events.map((event: AgentEvent) => event.type)).toContain("plan.awaiting_approval");

    const editedSteps = planned.body.run.plan.map((step: NonNullable<AgentRun["plan"]>[number]) =>
      step.action_type === "agent_workspace"
        ? { ...step, title: "Run Approved CSV Export", config: { ...step.config, approved_revision: true } }
        : step
    );
    const planUpdate = await updatePlanPost(
      new NextRequest(`http://localhost/api/projects/project-acceptance/runs/${body.run.id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: editedSteps }),
      }),
      { params: Promise.resolve({ id: "project-acceptance", runId: body.run.id }) },
    );
    expect(planUpdate.status).toBe(200);

    await approveRunPost(
      new NextRequest(`http://localhost/api/projects/project-acceptance/runs/${body.run.id}/approve`, { method: "POST" }),
      { params: Promise.resolve({ id: "project-acceptance", runId: body.run.id }) },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completed = await waitForRun(body.run.id, "completed");

    expect(completed.body.run.status).toBe("completed");
    expect(completed.body.run.plan.some((step: NonNullable<AgentRun["plan"]>[number]) => step.title === "Run Approved CSV Export")).toBe(true);
    expect(mockActionBodies[0].input).toMatchObject({ approved_revision: true });
  });

  it("follow-up runs use prior final answers, artifacts, files, and document ids from server state", async () => {
    const first = await createRun({
      message: "Build a techno-economic model and export CSV.",
      mode: "implement",
      thinking_level: "expert",
    });
    await waitForRun(first.body.run.id, "completed");

    const second = await createRun({
      message: "Use that same result and export the table again as CSV.",
      mode: "implement",
      thinking_level: "expert",
    });
    const saved = await waitForRun(second.body.run.id, "completed");

    expect(saved.body.run.final_answer).toContain("Download decision_brief.csv");
    expect(saved.body.run.files[0].url).toContain("/api/projects/project-acceptance/artifacts/");
    expect(saved.body.events.map((event: AgentEvent) => event.type)).toContain("file.created");
  });

  it("uploaded files attach by document id instead of chat text", async () => {
    mockDocuments = [{
      id: "doc_heat_1",
      filename: "heat-meter.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      status: "uploaded",
      uploaded_at: "2026-05-25T00:00:00.000Z",
    }];

    const { body } = await createRun({
      message: "Analyze this file",
      document_ids: ["doc_heat_1"],
      mode: "implement",
      thinking_level: "expert",
    });
    await waitForRun(body.run.id, "completed");

    expect(mockActionBodies[0].type).toBe("agent_workspace");
    expect((mockActionBodies[0].input as Record<string, unknown>).current_attachments).toEqual(["heat-meter.csv"]);
    expect(body.run.attachment_document_ids).toEqual(["doc_heat_1"]);
  });

  it("cancels queued or running runs durably", async () => {
    const run = await createAgentRun("project-acceptance", {
      message: "What is exergy?",
      mode: "plan",
      thinking_level: "instant",
    });
    const cancelResponse = await cancelRunPost(
      new NextRequest(`http://localhost/api/projects/project-acceptance/runs/${run.id}/cancel`, { method: "POST" }),
      { params: Promise.resolve({ id: "project-acceptance", runId: run.id }) },
    );
    const cancelBody = await cancelResponse.json();

    expect(cancelResponse.status).toBe(200);
    expect(cancelBody.run.status).toBe("cancelled");
    expect(cancelBody.events.map((event: AgentEvent) => event.type)).toContain("run.cancelled");
  });

  it("normal chat content does not leak legacy audit or evidence-card language", async () => {
    const { body } = await createRun({
      message: "Build a techno-economic model and export CSV.",
      mode: "implement",
      thinking_level: "expert",
    });
    const saved = await waitForRun(body.run.id, "completed");

    expect(saved.body.run.final_answer).not.toMatch(
      /View Details|Export Report|Screening|What Is Supported|Do Not Claim Yet|Best Next Data Requests|Outputs collected|\.mineru\.(?:md|json)|Point me to the heat-pump rating table/i,
    );
  });

  it("replays a mini uploaded-file production readiness campaign through run APIs", async () => {
    mockDocuments = [
      doc("doc_equipment", "utility_equipment_log.csv", "text/csv", [
        "source_label,line_item,category,value,unit,basis,notes",
        "UTILITY-A,compressor_A,power,620,kW,nameplate,inlet filter fouling suspected",
        "UTILITY-A,pump_B,power,74,kW,metered,throttled valve 45 percent",
        "UTILITY-A,refrigeration_C,power,710,kW,metered,high condensing temp",
      ].join("\n")),
      doc("doc_heatpump", "heat_pump_brief.pdf", "application/pdf", "%PDF-1.4\nstream\nBT (Heat pump COP 3.1 at 45 degC supply. Installed CAPEX 4.6 million USD.) Tj ET\nendstream"),
      doc("doc_tea", "techno_economic_case.md", "text/markdown", [
        "Source label: TEA-A",
        "Supported by this report: CAPEX is 64 million USD.",
        "Supported by this report: electricity cost is 68 USD/MWh.",
        "Supported by this report: availability is 91 percent.",
      ].join("\n")),
    ];

    const equipment = await createRun({
      message: "Analyze this compressor, pump, and refrigeration utility table. Rank efficiency opportunities and identify missing measurements.",
      document_ids: ["doc_equipment"],
      mode: "implement",
      thinking_level: "expert",
    });
    const equipmentRun = await waitForRun(equipment.body.run.id, "completed");
    expect(mockActionBodies.at(-1)?.type).toBe("agent_workspace");
    expect(equipmentRun.body.run.final_answer).toContain("Support and Limits");
    expect(equipmentRun.body.run.final_answer).toMatch(/\|.*compressor_A.*\|/);
    expect(equipmentRun.body.run.final_answer).toMatch(/\|.*refrigeration_C.*\|/);
    expect(equipmentRun.body.run.files.length).toBeGreaterThan(0);

    const heatPump = await createRun({
      message: "Use the simple PDF heat-pump brief for a compact client-ready screening memo.",
      document_ids: ["doc_heatpump"],
      mode: "implement",
      thinking_level: "expert",
    });
    const heatPumpRun = await waitForRun(heatPump.body.run.id, "completed");
    expect(heatPumpRun.body.run.final_answer).toContain("Support and Limits");
    expect(heatPumpRun.body.run.final_answer).not.toMatch(/quality_|claim ledger|\{[a-z_]+}/i);

    const tea = await createRun({
      message: "Build a techno-economic case from the Markdown source and export the decision table as CSV.",
      document_ids: ["doc_tea"],
      mode: "implement",
      thinking_level: "expert",
    });
    const teaRun = await waitForRun(tea.body.run.id, "completed");
    expect(teaRun.body.run.final_answer).toContain("Download decision_brief.csv");
    expect(teaRun.body.run.final_answer).toContain("Support and Limits");
    expect(teaRun.body.run.final_answer).toMatch(/Source-Backed Inputs[\s\S]*\|\s*(Input|Source value)\s*\|\s*Value\s*\|/i);

    const scenario = await createRun({
      message: "Now rerun with electricity cost reduced by 50% while holding all other assumptions constant. Compare to the base case.",
      document_ids: ["doc_tea"],
      parent_run_id: tea.body.run.id,
      mode: "implement",
      thinking_level: "expert",
    });
    const scenarioRun = await waitForRun(scenario.body.run.id, "completed");
    expect(scenarioRun.body.run.final_answer).toMatch(/Changed inputs|Scenario Reproducibility/i);
    expect(scenarioRun.body.run.final_answer).toMatch(/Held constants|all other/i);
    expect(scenarioRun.body.run.final_answer).toMatch(/Assumption drift/i);
    expect(scenarioRun.body.run.final_answer).toMatch(/\|.*Scenario|Requirement.*\|/);

    const exportRun = await createRun({
      message: "Export the assumptions ledger as JSON and a client memo as Markdown or PDF.",
      document_ids: ["doc_tea"],
      mode: "implement",
      thinking_level: "expert",
    });
    const exported = await waitForRun(exportRun.body.run.id, "completed");
    expect(exported.body.run.files.some((file: { filename: string }) => file.filename.endsWith(".json"))).toBe(true);
    expect(exported.body.run.files.some((file: { filename: string }) => /\.(md|pdf)$/i.test(file.filename))).toBe(true);

    const diagnostics = await diagnosticExport();
    const runDiagnostic = diagnostics.diagnostics.run_diagnostics.find((entry: { run_id: string }) => entry.run_id === equipment.body.run.id);
    expect(diagnostics.diagnostics.production_readiness.level).toMatch(/ready_for_external_client_testing|controlled_pilot_only/);
    expect(runDiagnostic.source_extraction_confidence[0].salient_values.length).toBeGreaterThanOrEqual(3);
    expect(runDiagnostic.quality_evaluation.findings.map((finding: { type: string }) => finding.type)).not.toContain("quality_unresolved_template_placeholder");
  });
});
