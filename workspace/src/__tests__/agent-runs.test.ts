import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

import type {
  AgentEvent,
  AgentRun,
  Artifact,
  Project,
  ProjectDocument,
} from "@/lib/storage/types";
import {
  approveAgentRun,
  cancelAgentRun,
  createAgentRun,
  startAgentRun,
  updateAgentRunPlan,
} from "@/lib/agent-runner";
import { callDeepSeekV3, getEnvVar } from "@/lib/backend";

const mockProject: Project = {
  id: "project-runs",
  name: "Run Test Project",
  description: "Industrial waste heat recovery assessment.",
  goal: "Decision brief",
  domain: "district_heating",
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
};

let mockRuns: AgentRun[] = [];
let mockEvents: Record<string, AgentEvent[]> = {};
let mockDocuments: ProjectDocument[] = [];
let mockArtifacts: Artifact[] = [];
let mockActionBodies: Record<string, unknown>[] = [];
let mockActionFailure: Error | null = null;
let mockActionFailureQueue: Error[] = [];
let mockIntakeOnlyPhysics = false;
let mockLimitedWorkspaceExit = false;
let mockShallowEvidence = false;
let idCounter = 1;

function now(): string {
  return new Date(2026, 4, 25, 12, 0, idCounter++).toISOString();
}

function soecWorkspaceArtifact(id: string, powerPrice: number, variableCost: number, margin: number, breakeven: number): Artifact {
  return {
    id,
    schema_version: 1,
    type: "workspace_run",
    title: `SOEC workspace ${id}`,
    summary: "SOEC/FT model complete.",
    content: {
      results: {
        soec_ft_physics_model: {
          basis: {
            product_kg_per_bbl: 124.0,
            h2_stoich_kg_per_bbl: 35.7,
            co_stoich_kg_per_bbl: 248.0,
            stoich_stack_mwh_per_bbl: 1.76,
          },
          case_defs: {
            base: {
              power_price: powerPrice,
            },
          },
          performance_rows: [{
            label: "Base case / measured-data target",
            bpd: 25,
            capacity_factor: 0.9,
            carbon_to_liquid_eff: 0.65,
            electricity_intensity_mwh_per_bbl: 3.39,
            average_mw: 3.53,
            capex_musd: 45.0,
            product_price_usd_per_bbl: 350,
            electricity_price_usd_per_mwh: powerPrice,
            electricity_cost_usd_per_bbl: powerPrice * 3.39,
            variable_cost_usd_per_bbl: variableCost,
            contribution_margin_usd_per_bbl: margin,
            breakeven_product_price_usd_per_bbl: breakeven,
          }],
          input_overrides: {
            changed: powerPrice !== 45,
            reference_power_price: 45,
            requested_power_price: powerPrice,
          },
        },
      },
    },
    source: "ai_synthesis",
    raw: {},
    metadata: { action_type: "agent_workspace" },
    action_id: `act_${id}`,
    provenance: { source: "ai_synthesis", deterministic: true },
    created_at: now(),
    pinned: false,
  };
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
      id: `art_created_${idCounter++}`,
      created_at: now(),
    };
    mockArtifacts.push(artifact);
    return artifact;
  }),
  listActions: jest.fn(async () => []),
  createAgentRun: jest.fn(async (projectId: string, input: Omit<AgentRun, "id" | "project_id" | "status" | "created_at" | "updated_at"> & { status?: AgentRun["status"] }) => {
    const timestamp = now();
    const run: AgentRun = {
      ...input,
      id: `run_${idCounter++}`,
      project_id: projectId,
      status: input.status || "queued",
      created_at: timestamp,
      updated_at: timestamp,
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
      run.id === runId ? { ...run, ...patch, updated_at: patch.updated_at || now() } : run
    );
  }),
  appendAgentEvent: jest.fn(async (projectId: string, runId: string, input: Omit<AgentEvent, "id" | "project_id" | "run_id" | "sequence" | "created_at">) => {
    const existing = mockEvents[runId] || [];
    const event: AgentEvent = {
      ...input,
      id: `evt_${idCounter++}`,
      project_id: projectId,
      run_id: runId,
      sequence: existing.length + 1,
      created_at: now(),
    };
    mockEvents[runId] = [...existing, event];
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
}));

jest.mock("@/lib/environment-readiness", () => ({
  buildEnvironmentReadiness: jest.fn(() => ({
    overall: "ready",
    checks: [{ id: "llm", label: "Primary agent model", status: "ready", message: "ready", required: true }],
  })),
}));

jest.mock("@/lib/project-action-dispatcher", () => ({
  executeProjectAction: jest.fn(async ({ projectId, actionType, input }: { projectId: string; actionType: string; input: Record<string, unknown> }) => {
    mockActionBodies.push({ type: actionType, input });
    if (mockActionFailureQueue.length > 0) {
      throw mockActionFailureQueue.shift();
    }
    if (mockActionFailure) throw mockActionFailure;
    const type = String(actionType || "agent_workspace");
    const intakeOnlyPhysics = mockIntakeOnlyPhysics && type === "physics_simulation";
    const shallowEvidence = mockShallowEvidence && type === "evidence_evaluation";
    const artifact: Artifact = {
      id: `art_${mockActionBodies.length}`,
      schema_version: 1,
      type: type === "agent_workspace" ? "workspace_run" : "evaluation",
      title: type === "agent_workspace" ? "Workspace Run" : "Tool Result",
      summary: type === "agent_workspace" ? "Workspace result complete." : "Tool result complete.",
      content: type === "agent_workspace"
        ? {
          analysis_type: "agent_workspace",
          report_markdown: mockLimitedWorkspaceExit
            ? "## Best-Effort Workspace Report\n\nThe executable calculation could not complete, but this report preserves the extracted source facts and bounded estimates with limitations."
            : "Workspace result complete.\n\nThe calculation produced the requested export.",
          results: mockLimitedWorkspaceExit
            ? {
              summary: "Best-effort answer produced after workspace execution could not complete.",
              completed_with_limitations: true,
              tool_execution_completed: false,
            }
            : undefined,
          execution: mockLimitedWorkspaceExit ? { exit_code: 1 } : undefined,
          files: [
            {
              filename: "result.csv",
              path: "/home/chris/exergy-analyst/runtime/projects/proj_project-runs/result.csv",
              bytes: 42,
            },
          ],
        }
        : shallowEvidence
          ? {
            client_summary: {
              decision: "The table can support first-pass profiling.",
              conclusion: "The table can support first-pass profiling.",
              supported_claims: [],
              not_proven: ["This profile does not prove causality, ROI, or equipment condition."],
            },
          }
        : intakeOnlyPhysics
          ? {
            evidence_level: "intake_only",
            extraction_status: "partial",
            physics_screens: [],
            memo_markdown: "No supported physics screen matched this upload yet.",
          }
        : {
          client_summary: {
            decision: "Tool result complete",
            conclusion: "The tool returned a bounded result.",
            supported_claims: [{ claim: "Result was computed.", evidence: "Mock tool output." }],
            not_proven: ["This is not field validation."],
          },
        },
      source: "ai_synthesis",
      raw: {},
      metadata: { action_type: type },
      action_id: `act_${mockActionBodies.length}`,
      provenance: { source: "ai_synthesis", deterministic: false },
      created_at: "2026-05-25T00:00:00.000Z",
      pinned: false,
    };
    mockArtifacts.push(artifact);
    return {
      action: { id: artifact.action_id, status: "completed", artifact_id: artifact.id, type, project_id: projectId, input },
      artifact,
      result_summary: type === "agent_workspace"
        ? mockLimitedWorkspaceExit
          ? "## Best-Effort Workspace Report\n\nThe executable calculation could not complete, but this report preserves the extracted source facts and bounded estimates with limitations."
          : "Workspace result complete.\n\nThe calculation produced the requested export."
        : shallowEvidence
          ? "The table can support first-pass profiling."
        : intakeOnlyPhysics
          ? "No supported physics screen matched this upload yet."
        : "Tool result complete.\nBasis: Result was computed.\nImportant limit: This is not field validation.",
    };
  }),
  POST: jest.fn(async (request: NextRequest) => {
    const body = await request.json();
    mockActionBodies.push(body);
    const type = String(body.type || "agent_workspace");
    const artifact: Artifact = {
      id: `art_${mockActionBodies.length}`,
      schema_version: 1,
      type: type === "agent_workspace" ? "workspace_run" : "evaluation",
      title: type === "agent_workspace" ? "Workspace Run" : "Tool Result",
      summary: type === "agent_workspace" ? "Workspace result complete." : "Tool result complete.",
      content: type === "agent_workspace"
        ? {
          analysis_type: "agent_workspace",
          report_markdown: "Workspace result complete.\n\nThe calculation produced the requested export.",
          files: [
            {
              filename: "result.csv",
              path: "/home/chris/exergy-analyst/runtime/projects/proj_project-runs/result.csv",
              bytes: 42,
            },
          ],
        }
        : {
          client_summary: {
            decision: "Tool result complete",
            conclusion: "The tool returned a bounded result.",
            supported_claims: [{ claim: "Result was computed.", evidence: "Mock tool output." }],
            not_proven: ["This is not field validation."],
          },
        },
      source: "ai_synthesis",
      raw: {},
      metadata: { action_type: type },
      action_id: `act_${mockActionBodies.length}`,
      provenance: { source: "ai_synthesis", deterministic: false },
      created_at: "2026-05-25T00:00:00.000Z",
      pinned: false,
    };
    mockArtifacts.push(artifact);
    return NextResponse.json({
      action: { id: artifact.action_id, status: "completed", artifact_id: artifact.id, type },
      artifact,
      result_summary: type === "agent_workspace"
        ? "Workspace result complete.\n\nThe calculation produced the requested export."
        : "Tool result complete.\nBasis: Result was computed.\nImportant limit: This is not field validation.",
    });
  }),
}));

describe("durable agent runs", () => {
  it("does not prematurely abandon long workspace actions at the old 180 second boundary", () => {
    const source = readFileSync(join(__dirname, "..", "lib", "agent-runner.ts"), "utf-8");

    expect(source).toContain("agent_workspace: 300_000");
    expect(source).toContain("latestFailure?.action_type === \"agent_workspace\"");
    expect(source).toContain("return null");
  });

  beforeEach(() => {
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
    mockRuns = [];
    mockEvents = {};
    mockDocuments = [];
    mockArtifacts = [];
    mockActionBodies = [];
    mockActionFailure = null;
    mockActionFailureQueue = [];
    mockIntakeOnlyPhysics = false;
    mockLimitedWorkspaceExit = false;
    mockShallowEvidence = false;
    idCounter = 1;
  });

  it("creates a durable run and first event", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Analyze this file",
      document_ids: ["doc_1"],
      mode: "implement",
      thinking_level: "expert",
    });

    expect(run.id).toMatch(/^run_/);
    expect(run.project_id).toBe("project-runs");
    expect(run.attachment_document_ids).toEqual(["doc_1"]);
    expect(mockEvents[run.id][0]).toMatchObject({ type: "run.started", run_id: run.id });
  });

  it("direct answers persist final answer and run.completed", async () => {
    const run = await createAgentRun("project-runs", {
      message: "What is exergy?",
      mode: "implement",
      thinking_level: "instant",
    });
    await startAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.status).toBe("completed");
    expect(saved?.final_answer).toMatch(/useful work potential/i);
    expect(mockEvents[run.id].map((event) => event.type)).toContain("run.completed");
  });

  it("answers identity questions with the public Exergy Lab Agent identity", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Which AI model is this?",
      mode: "implement",
      thinking_level: "instant",
    });
    await startAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.status).toBe("completed");
    expect(saved?.final_answer).toMatch(/Exergy Lab Agent/i);
    expect(saved?.final_answer).not.toMatch(/deepseek|v4|flash|analysis engine/i);
    expect(callDeepSeekV3).not.toHaveBeenCalled();
  });

  it("does not restart a run that is already marked running", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Analyze this file",
      mode: "implement",
      thinking_level: "expert",
    });
    await mockStorage.updateAgentRun("project-runs", run.id, { status: "running" });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies).toHaveLength(0);
    expect(mockEvents[run.id].map((event) => event.type)).toEqual(["run.started"]);
  });

  it("tool actions emit tool, artifact, file, and completion events", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Export the latest analysis as CSV",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);

    const eventTypes = mockEvents[run.id].map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      "tool.started",
      "tool.completed",
      "artifact.created",
      "file.created",
      "run.completed",
    ]));
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.files?.[0]?.url).toContain("/api/projects/project-runs/artifacts/");
    expect(saved?.final_answer).toContain("Download result.csv");
  });

  it("keeps the chat run useful when a selected tool fails", async () => {
    mockActionFailure = new Error("Generated workspace code failed with exit code 1: helper signature mismatch");
    jest.mocked(callDeepSeekV3).mockImplementation(async (messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
      const joined = messages.map((message) => message.content || "").join("\n");
      if (options?.jsonMode) {
        if (/TOOL FAILURE HISTORY/i.test(joined)) {
          return JSON.stringify({
            type: "response",
            content: [
              "## Best Available Answer",
              "The workspace tool did not complete, so I will not claim a completed calculation.",
              "Useful next step: rerun with the corrected helper contract.",
            ].join("\n"),
            action: null,
            suggested_followups: [],
          });
        }
        return JSON.stringify({
          type: "action",
          content: "I will run this through the workspace tool.",
          action: { type: "agent_workspace", config: { task: "Build the model" } },
          suggested_followups: [],
        });
      }
      return "Unexpected non-JSON fallback.";
    });

    const run = await createAgentRun("project-runs", {
      message: "Build an economic model and export CSV",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    const eventTypes = mockEvents[run.id].map((event) => event.type);
    expect(eventTypes).toContain("tool.failed");
    expect(eventTypes).toContain("run.completed");
    expect(saved?.status).toBe("completed");
    expect(saved?.final_answer).toMatch(/workspace tool did not complete/i);
    expect(mockActionBodies).toHaveLength(1);
  });

  it("preserves limited workspace artifacts and files when execution fails after producing a report", async () => {
    mockLimitedWorkspaceExit = true;

    const run = await createAgentRun("project-runs", {
      message: "Build an economic model and export CSV",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    const eventTypes = mockEvents[run.id].map((event) => event.type);
    expect(eventTypes).toContain("tool.completed");
    expect(eventTypes).toContain("artifact.created");
    expect(eventTypes).toContain("file.created");
    expect(eventTypes).not.toContain("tool.failed");
    expect(saved?.status).toBe("completed");
    expect(saved?.artifact_ids).toHaveLength(1);
    expect(saved?.files?.[0]?.filename).toBe("result.csv");
    expect(saved?.final_answer).toContain("Calculation limitation");
    expect(saved?.final_answer).toContain("Download result.csv");
  });

  it("tries a model-selected alternate tool after one tool fails", async () => {
    mockActionFailureQueue = [new Error("Physics solver could not assemble inputs")];
    jest.mocked(callDeepSeekV3).mockImplementation(async (messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
      const joined = messages.map((message) => message.content || "").join("\n");
      if (options?.jsonMode && /TOOL FAILURE HISTORY/i.test(joined)) {
        return JSON.stringify({
          type: "action",
          content: "The fixed solver did not have enough structured inputs, so I will use the workspace tool to run the analysis from context.",
          action: {
            type: "agent_workspace",
            config: { task: "Recover by building the model in the workspace from the saved context." },
          },
          suggested_followups: [],
        });
      }
      if (options?.jsonMode) {
        return JSON.stringify({
          type: "action",
          content: "I will start with the physics solver.",
          action: {
            type: "physics_simulation",
            config: { description: "Run the requested numeric model." },
          },
          suggested_followups: [],
        });
      }
      return "Final synthesized answer from the completed workspace run.";
    });

    const run = await createAgentRun("project-runs", {
      message: "Run a physics simulation and export a CSV",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    const eventTypes = mockEvents[run.id].map((event) => event.type);
    expect(mockActionBodies.map((body) => body.type)).toEqual(["physics_simulation", "agent_workspace"]);
    expect(eventTypes).toContain("tool.failed");
    expect(eventTypes).toContain("tool.completed");
    expect(saved?.status).toBe("completed");
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("recovers to workspace when a fixed physics tool returns intake-only evidence", async () => {
    mockIntakeOnlyPhysics = true;
    jest.mocked(callDeepSeekV3).mockImplementation(async (messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
      const joined = messages.map((message) => message.content || "").join("\n");
      if (options?.jsonMode && /USER REQUEST/i.test(joined)) {
        return JSON.stringify({
          type: "action",
          content: "I will start with the fixed physics tool.",
          action: {
            type: "physics_simulation",
            config: { description: "Run a thermal runaway simulation from the uploaded pack notes." },
          },
          suggested_followups: [],
        });
      }
      return "Final synthesized answer from the completed workspace run.";
    });

    const run = await createAgentRun("project-runs", {
      message: "Run a physics-based screening simulation for thermal runaway risk using the values in this prompt: cell heat release 420 kJ, pack mass 380 kg, ambient 25 C.",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies.map((body) => body.type)).toEqual(["physics_simulation", "agent_workspace"]);
    expect(mockEvents[run.id].map((event) => event.type)).toContain("tool.failed");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("routes uploaded-file sensitivity simulations to the workspace tool", async () => {
    mockDocuments = [{
      id: "doc_soec",
      filename: "oxeon SOEC info sheet rev2.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "uploaded",
      uploaded_at: "2026-05-25T00:00:00.000Z",
    }];
    const run = await createAgentRun("project-runs", {
      message: "Analyze this pdf and run physics simulations for a 20 year sensitivity analysis",
      document_ids: ["doc_soec"],
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    expect(String((mockActionBodies[0]?.input as Record<string, unknown>)?.task)).toContain("20 year sensitivity analysis");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.status).toBe("completed");
    expect(saved?.final_answer).toContain("Workspace result complete.\n\nThe calculation produced");
  });

  it("forces uploaded numeric analysis through workspace when router tries direct prose", async () => {
    mockDocuments = [{
      id: "doc_log",
      filename: "furnace_exhaust_partial_log.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      status: "uploaded",
      uploaded_at: "2026-05-25T00:00:00.000Z",
    }];
    jest.mocked(callDeepSeekV3).mockImplementation(async (_messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
      if (options?.jsonMode) {
        return JSON.stringify({
          type: "response",
          content: "The table can support first-pass profiling.",
          action: null,
          suggested_followups: [],
        });
      }
      return "Final synthesized answer from the completed workspace run.";
    });

    const run = await createAgentRun("project-runs", {
      message: "Can this furnace exhaust stream support a waste-heat recovery project? The log is incomplete; screen what can be done and what measurements are needed.",
      document_ids: ["doc_log"],
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    const input = mockActionBodies[0]?.input as Record<string, unknown>;
    expect(String(input.task)).toContain("furnace exhaust stream");
    expect(String(input.current_attachments)).toContain("furnace_exhaust_partial_log.csv");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("overrides shallow document tools for uploaded numeric analysis requests", async () => {
    mockDocuments = [{
      id: "doc_utility",
      filename: "utility_equipment_log.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      status: "uploaded",
      uploaded_at: "2026-05-25T00:00:00.000Z",
    }];
    jest.mocked(callDeepSeekV3).mockImplementation(async (_messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
      if (options?.jsonMode) {
        return JSON.stringify({
          type: "action",
          content: "I will extract evidence from the document.",
          action: { type: "evidence_evaluation", config: { question: "Profile equipment opportunities." } },
          suggested_followups: [],
        });
      }
      return "Final synthesized answer from the completed workspace run.";
    });

    const run = await createAgentRun("project-runs", {
      message: "Analyze this compressor, pump, and refrigeration utility log. Rank efficiency opportunities and identify what measurements are missing.",
      document_ids: ["doc_utility"],
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    const input = mockActionBodies[0]?.input as Record<string, unknown>;
    expect(String(input.task)).toContain("compressor, pump, and refrigeration");
    expect(String(input.context)).toContain("document_backed_complex_request_overrode_evidence_evaluation");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("uses bounded workspace execution instead of deep-agent routing for uploaded document calculations", async () => {
    mockDocuments = [{
      id: "doc_heat_pump",
      filename: "heat_pump_retrofit_brief.pdf",
      mime_type: "application/pdf",
      size_bytes: 2048,
      status: "uploaded",
      uploaded_at: "2026-05-25T00:00:00.000Z",
    }];
    jest.mocked(callDeepSeekV3).mockImplementation(async (_messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
      if (options?.jsonMode) {
        return JSON.stringify({
          type: "action",
          content: "I will use the deeper multi-tool agent.",
          action: { type: "deep_agent", config: { task: "Extract and calculate heat-pump retrofit values." } },
          suggested_followups: [],
        });
      }
      return "Final synthesized answer from the completed workspace run.";
    });

    const run = await createAgentRun("project-runs", {
      message: "Extract the key values from this heat-pump retrofit brief and calculate annual electricity use, gas displaced, emissions change, operating-cost change, payback, and exergy-relevant temperature limitations.",
      document_ids: ["doc_heat_pump"],
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    const input = mockActionBodies[0]?.input as Record<string, unknown>;
    expect(String(input.context)).toContain("document_backed_complex_request_overrode_deep_agent");
    expect(String(input.task)).toContain("heat-pump retrofit brief");
  });

  it("recovers to workspace when a fixed evidence tool returns terse profiling text", async () => {
    mockShallowEvidence = true;
    mockDocuments = [{
      id: "doc_utility",
      filename: "utility_equipment_log.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      status: "uploaded",
      uploaded_at: "2026-05-25T00:00:00.000Z",
    }];
    jest.mocked(callDeepSeekV3).mockImplementation(async (_messages: Array<{ role?: string; content?: string }>, options?: Record<string, unknown>) => {
      if (options?.jsonMode) {
        return JSON.stringify({
          type: "action",
          content: "I will use evidence evaluation.",
          action: { type: "evidence_evaluation", config: { question: "Analyze the uploaded table and rank efficiency opportunities." } },
          suggested_followups: [],
        });
      }
      return "Final synthesized answer from the completed workspace run.";
    });

    const run = await createAgentRun("project-runs", {
      message: "Analyze this uploaded utility table and rank efficiency opportunities.",
      document_ids: ["doc_utility"],
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies.map((body) => body.type)).toEqual(["agent_workspace"]);
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("routes prior scenario comparisons through the workspace with saved artifact context", async () => {
    mockArtifacts = [
      soecWorkspaceArtifact("art_original", 45, 274, 76, 1384),
      soecWorkspaceArtifact("art_lower_power", 22.5, 198, 152, 1308),
    ];
    const run = await createAgentRun("project-runs", {
      message: "Compare the results from the 50% lower electricity prices to the original results",
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    expect(String((mockActionBodies[0].input as Record<string, unknown>).task)).toContain("Compare the results");
    expect(String((mockActionBodies[0].input as Record<string, unknown>).context)).toContain("art_original");
    expect(String((mockActionBodies[0].input as Record<string, unknown>).context)).toContain("art_lower_power");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).toContain("Workspace result complete");
    expect(saved?.artifact_ids?.length).toBe(1);
  });

  it("runs a new SOEC scenario when the follow-up asks to rerun and compare changed assumptions", async () => {
    mockDocuments = [{
      id: "doc_soec",
      filename: "oxeon SOEC info sheet rev2.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "uploaded",
      uploaded_at: "2026-05-25T00:00:00.000Z",
    }];
    mockArtifacts = [soecWorkspaceArtifact("art_original", 45, 274, 76, 1384)];
    const run = await createAgentRun("project-runs", {
      message: "Now rerun the same SOEC-to-FT model as a scenario analysis with electricity price reduced by 50% from the base case, while holding all other base-case assumptions constant. Compare the original base case to the 50% lower-electricity-price case.",
      document_ids: ["doc_soec"],
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    const task = String((mockActionBodies[0]?.input as Record<string, unknown>)?.task || "");
    expect(task).toContain("electricity price reduced by 50%");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).not.toContain("Scenario Integrity Check");
    expect(saved?.artifact_ids?.length).toBe(1);
  });

  it("routes prior calculation explanations through the workspace with artifact context", async () => {
    mockArtifacts = [soecWorkspaceArtifact("art_original", 45, 274, 76, 1384)];
    const run = await createAgentRun("project-runs", {
      message: "Explain how you calculated those numbers and what assumptions you made",
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    expect(String((mockActionBodies[0].input as Record<string, unknown>).task)).toContain("Explain how you calculated");
    expect(String((mockActionBodies[0].input as Record<string, unknown>).context)).toContain("art_original");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("routes saved scenario difference questions through the workspace instead of hard-coded prose", async () => {
    mockArtifacts = [
      soecWorkspaceArtifact("art_original", 45, 274, 76, 1384),
      soecWorkspaceArtifact("art_lower_power", 22.5, 198, 152, 1308),
    ];
    const run = await createAgentRun("project-runs", {
      message: "Explain the difference between the two scenarios and explain why the results are different.",
      mode: "implement",
      thinking_level: "expert",
    });

    await startAgentRun("project-runs", run.id);

    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    expect(String((mockActionBodies[0].input as Record<string, unknown>).context)).toContain("art_lower_power");
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("plan mode waits for approval and does not execute tools", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Build a techno-economic model and export CSV",
      mode: "plan",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.status).toBe("waiting_approval");
    expect(saved?.plan?.length).toBeGreaterThanOrEqual(2);
    expect(mockActionBodies).toHaveLength(0);
    expect(mockEvents[run.id].map((event) => event.type)).toContain("plan.awaiting_approval");
  });

  it("persists edited plan steps and approval executes those steps", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Build a techno-economic model and export CSV",
      mode: "plan",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);
    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    const edited = (saved?.plan || []).map((step) =>
      step.action_type === "agent_workspace"
        ? { ...step, title: "Run Edited Workspace Model", config: { ...step.config, edited_flag: true } }
        : step
    );

    await updateAgentRunPlan("project-runs", run.id, { steps: edited });
    await approveAgentRun("project-runs", run.id);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const completed = await mockStorage.getAgentRun("project-runs", run.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.plan?.some((step) => step.title === "Run Edited Workspace Model")).toBe(true);
    expect(mockActionBodies[0]?.input).toMatchObject({ edited_flag: true });
  });

  it("follow-ups include previous run context for export files", async () => {
    const first = await createAgentRun("project-runs", {
      message: "Export the latest analysis as CSV",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", first.id);

    const followup = await createAgentRun("project-runs", {
      message: "Now export that same result as CSV again",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", followup.id);

    const saved = await mockStorage.getAgentRun("project-runs", followup.id);
    expect(saved?.final_answer).toContain("Download result.csv");
    expect(saved?.files?.[0]?.url).toContain("/api/projects/project-runs/artifacts/");
    expect(mockEvents[followup.id].map((event) => event.type)).toContain("file.created");
  });

  it("routes scale-up follow-ups from prior run context through the workspace", async () => {
    const first = await createAgentRun("project-runs", {
      message: "Simulate this PV module",
      mode: "implement",
      thinking_level: "expert",
    });
    await mockStorage.updateAgentRun("project-runs", first.id, {
      status: "completed",
      final_answer: "CS3W-MS PV module result. Peak power: 400 W STC; about 363 W temperature-adjusted. Average daily generation: 1.903 kWh/day per module, or about 694.7 kWh/year. Exergy factor: 0.931.",
    });

    const followup = await createAgentRun("project-runs", {
      message: "Now scale this up to 1,000,000 of these modules. What power output would that get me and what inverter would you recommend?",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", followup.id);

    const saved = await mockStorage.getAgentRun("project-runs", followup.id);
    expect(mockActionBodies[0]).toMatchObject({ type: "agent_workspace" });
    expect(String((mockActionBodies[0].input as Record<string, unknown>).context)).toContain("Peak power: 400 W");
    expect(saved?.status).toBe("completed");
    expect(saved?.final_answer).toContain("Workspace result complete");
  });

  it("cancellation persists cancelled status and event", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Build a techno-economic model",
      mode: "implement",
      thinking_level: "expert",
    });
    await cancelAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.status).toBe("cancelled");
    expect(mockEvents[run.id].map((event) => event.type)).toContain("run.cancelled");
  });

  it("does not overwrite a run cancelled during final answer finalization", async () => {
    const run = await createAgentRun("project-runs", {
      message: "What is exergy?",
      mode: "implement",
      thinking_level: "instant",
    });
    const appendImplementation = mockStorage.appendAgentEvent.getMockImplementation();
    mockStorage.appendAgentEvent.mockImplementation(async (projectId, runId, input) => {
      if (!appendImplementation) throw new Error("appendAgentEvent mock missing");
      const event = await appendImplementation(projectId, runId, input);
      if (input.type === "assistant.message") {
        await mockStorage.updateAgentRun(projectId, runId, {
          status: "cancelled",
          completed_at: now(),
        });
      }
      return event;
    });

    await startAgentRun("project-runs", run.id);

    const saved = await mockStorage.getAgentRun("project-runs", run.id);
    expect(saved?.status).toBe("cancelled");
    expect(saved?.final_answer).toBeUndefined();
    expect(mockEvents[run.id].map((event) => event.type)).not.toContain("run.completed");
  });

  it("does not leak forbidden legacy chat phrases in final answers", async () => {
    const run = await createAgentRun("project-runs", {
      message: "Export the latest analysis as CSV",
      mode: "implement",
      thinking_level: "expert",
    });
    await startAgentRun("project-runs", run.id);
    const saved = await mockStorage.getAgentRun("project-runs", run.id);

    expect(saved?.final_answer || "").not.toMatch(/View Details|Export Report|Screening|Do Not Claim Yet|Best Next Data Requests|Outputs collected|mineru|Point me to the heat-pump rating table/i);
  });
});
