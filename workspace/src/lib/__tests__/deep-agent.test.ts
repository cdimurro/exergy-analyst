jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn(() => ""),
  callDeepSeekV3: jest.fn(),
}));

import {
  executeDeepAgent,
  shouldUseDeepAgent,
  type DeepAgentPlanStep,
} from "@/lib/deep-agent";
import type { Artifact } from "@/lib/storage/types";

function artifactFor(step: DeepAgentPlanStep): Artifact {
  return {
    id: `art_${step.step_id}`,
    schema_version: 1,
    type: step.tool_type === "agent_workspace" ? "workspace_run" : step.tool_type === "deep_research" ? "deep_research" : "evaluation",
    title: `${step.title} Result`,
    summary: `${step.title} completed with source-backed outputs.`,
    content: {
      analysis_type: step.tool_type,
      final_answer: `${step.title} final answer.`,
      report_markdown: step.tool_type === "agent_workspace" ? "## Results\n\nCalculated scenario values and wrote report.md." : undefined,
      files: step.tool_type === "agent_workspace"
        ? [{ filename: "report.md", path: "/tmp/report.md", bytes: 1200 }]
        : [],
      client_summary: {
        supported_claims: [{ claim: `${step.title} produced a checked result.` }],
        computed_metrics: [{ label: "Example metric", value: "12.5", unit: "MW" }],
      },
    },
    source: step.tool_type === "physics_simulation" || step.tool_type === "economics_analysis" ? "canonical_engine" : "ai_synthesis",
    raw: {},
    metadata: {},
    action_id: "act_1",
    provenance: { source: "ai_synthesis", deterministic: false },
    created_at: new Date().toISOString(),
    pinned: false,
  };
}

describe("deep agent", () => {
  it("detects complex multi-tool requests without domain-specific routing", () => {
    expect(shouldUseDeepAgent(
      "Run a state of the art research scan, physics simulation, economic model, environmental assessment, and client-ready PDF.",
    )).toBe(true);
    expect(shouldUseDeepAgent("What is exergy?")).toBe(false);
  });

  it("builds a durable multi-tool result and continues after a failed step", async () => {
    const result = await executeDeepAgent({
      project: { id: "p1", name: "Project", description: "", goal: "", domain: "general", created_at: "", updated_at: "" },
      question: "Run deep research, simulate the physics, build economics, and create a PDF report.",
      requiredOutputs: ["pdf"],
      executeTool: async (step) => {
        if (step.tool_type === "physics_simulation") {
          throw new Error("solver unavailable");
        }
        const artifact = artifactFor(step);
        return {
          status: "completed",
          summary: artifact.summary,
          action_id: "act_1",
          artifact,
        };
      },
    });

    expect(result.plan.map((step) => step.tool_type)).toContain("agent_workspace");
    expect(result.tool_runs.some((run) => run.status === "failed")).toBe(true);
    expect(result.tool_runs.some((run) => run.status === "completed")).toBe(true);
    expect(result.evidence_ledger.length).toBeGreaterThan(0);
    expect(result.verification.map((finding) => finding.type)).toContain("tool_failures_present");
    expect(result.final_answer).toContain("What the Data Supports");
  });
});
