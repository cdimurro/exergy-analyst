import { shouldAutoRunPlanForRequest } from "@/lib/agent-workflow-policy";

const steps = [
  { action_type: "evidence_evaluation" },
  { action_type: "literature_search" },
  { action_type: "deep_analysis" },
];

describe("agent workflow policy", () => {
  it("auto-runs multi-step analytical work", () => {
    expect(
      shouldAutoRunPlanForRequest(
        "Conduct a comprehensive environmental and economic analysis of these files.",
        steps,
      ),
    ).toBe(true);
  });

  it("auto-runs short plans when the user asks the agent to do work", () => {
    expect(
      shouldAutoRunPlanForRequest(
        "Simulate this process and compare the economics.",
        [
          { action_type: "physics_simulation" },
          { action_type: "economics_analysis" },
        ],
      ),
    ).toBe(true);
  });

  it("does not auto-run when the user explicitly asks for plan-only review", () => {
    expect(
      shouldAutoRunPlanForRequest(
        "Just show me the plan first and wait for my approval.",
        steps,
      ),
    ).toBe(false);
  });
});
