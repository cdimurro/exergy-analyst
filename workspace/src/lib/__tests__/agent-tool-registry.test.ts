import {
  AGENT_TOOL_REGISTRY,
  ALLOWED_AGENT_ACTIONS,
  formatAgentToolRegistryForPrompt,
  isAgentActionType,
} from "@/lib/agent-tool-registry";

describe("agent tool registry", () => {
  it("describes every action exposed to the model router", () => {
    expect(AGENT_TOOL_REGISTRY.length).toBeGreaterThanOrEqual(10);
    for (const tool of AGENT_TOOL_REGISTRY) {
      expect(tool.type).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.whenToUse).toMatch(/\w/);
      expect(tool.produces).toMatch(/\w/);
      expect(tool.inputHint).toMatch(/\w/);
      expect(ALLOWED_AGENT_ACTIONS.has(tool.type)).toBe(true);
    }
  });

  it("validates known action types and rejects arbitrary strings", () => {
    expect(isAgentActionType("evidence_evaluation")).toBe(true);
    expect(isAgentActionType("economics_analysis")).toBe(true);
    expect(isAgentActionType("unknown_tool")).toBe(false);
    expect(isAgentActionType(null)).toBe(false);
  });

  it("renders a prompt-ready registry without domain-specific overfitting", () => {
    const prompt = formatAgentToolRegistryForPrompt();

    expect(prompt).toContain("evidence_evaluation");
    expect(prompt).toContain("physics_simulation");
    expect(prompt).toContain("economics_analysis");
    expect(prompt).toContain("environmental_site_analysis");
    expect(prompt).toContain("deep_agent");
    expect(prompt).toContain("agent_workspace");
    expect(prompt).toContain("generated code");
    expect(prompt).toContain("current research");
  });

  it("keeps executable modelling requests on the general workspace path", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "model-router.ts"), "utf-8");

    expect(source).toContain("function requiresWorkspaceExecution");
    expect(source).toContain("const explicitToolSelection = [");
    expect(source).toContain("!explicitToolSelection && requiresWorkspaceExecution(args.message)");
  });
});
