import {
  enforceInitialEvaluationGuardrail,
  type ParsedChatResponse,
} from "@/lib/initial-evaluation-guardrail";

const projectState = {
  hasUploadedDocuments: true,
  hasSuccessfulEvaluationArtifact: false,
  hasChartableArtifact: false,
  domain: "small_modular_nuclear",
};

describe("enforceInitialEvaluationGuardrail", () => {
  it("preserves a pre-evaluation plan and forces grounded evidence intake to run first", () => {
    const parsed: ParsedChatResponse = {
      type: "plan",
      content: "I will run a full due-diligence plan.",
      plan_steps: [
        {
          action_type: "literature_search",
          config: { query: "X-energy Xe-100 benchmarks" },
        },
        {
          action_type: "deep_analysis",
          config: { question: "Assess investment risk." },
        },
      ],
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState);

    expect(result.downgraded).toBe(true);
    expect(result.reason).toBe("pre_evaluation_plan_repaired");
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.action).toBeNull();
    expect(result.parsed.plan_steps?.[0]).toMatchObject({
      step: 1,
      title: "Evidence Intake",
      action_type: "evidence_evaluation",
      config: {
        domain: "small_modular_nuclear",
        description: "X-energy Xe-100 benchmarks",
      },
    });
    expect(result.parsed.plan_steps?.map((s) => s.action_type)).toEqual([
      "evidence_evaluation",
      "literature_search",
      "deep_analysis",
    ]);
    expect(result.parsed.content).toContain("full due-diligence plan");
    expect(result.parsed.initial_evaluation_guardrail).toMatchObject({
      reason: "pre_evaluation_plan_repaired",
      original_type: "plan",
      original_step_action_types: ["literature_search", "deep_analysis"],
    });
  });

  it.each(["deep_analysis", "scientific_review", "evidence_interview"])(
    "downgrades pre-evaluation %s actions",
    (actionType) => {
      const parsed: ParsedChatResponse = {
        type: "action",
        content: "Running deep review.",
        action: {
          type: actionType,
          config: { question: "Find every risk." },
        },
      };

      const result = enforceInitialEvaluationGuardrail(parsed, projectState);

      expect(result.downgraded).toBe(true);
      expect(result.reason).toBe("pre_evaluation_action_blocked");
      expect(result.parsed.action?.type).toBe("evidence_evaluation");
      expect(result.parsed.initial_evaluation_guardrail?.original_action_type).toBe(actionType);
    },
  );

  it.each(["evidence_evaluation", "literature_search", "deep_research", "physics_simulation", "simulation_run", "custom_chart", "exploratory_analysis"])(
    "does not downgrade allowed pre-evaluation %s actions",
    (actionType) => {
      const parsed: ParsedChatResponse = {
        type: "action",
        content: "Running a focused action.",
        action: {
          type: actionType,
          config: { description: "Focused action" },
        },
      };

      const result = enforceInitialEvaluationGuardrail(parsed, projectState);

      expect(result.downgraded).toBe(false);
      expect(result.parsed).toBe(parsed);
    },
  );

  it("does not downgrade a plan when there are no uploaded documents", () => {
    const parsed: ParsedChatResponse = {
      type: "plan",
      content: "Planning a broad assessment.",
      plan_steps: [{ action_type: "deep_analysis", config: {} }],
    };

    const result = enforceInitialEvaluationGuardrail(parsed, {
      hasUploadedDocuments: false,
      hasSuccessfulEvaluationArtifact: false,
      hasChartableArtifact: false,
      domain: "small_modular_nuclear",
    });

    expect(result.downgraded).toBe(false);
    expect(result.parsed).toBe(parsed);
  });

  it("does not downgrade a plan after a successful evaluation exists", () => {
    const parsed: ParsedChatResponse = {
      type: "plan",
      content: "Planning follow-on diligence.",
      plan_steps: [{ action_type: "deep_analysis", config: {} }],
    };

    const result = enforceInitialEvaluationGuardrail(parsed, {
      hasUploadedDocuments: true,
      hasSuccessfulEvaluationArtifact: true,
      hasChartableArtifact: true,
      domain: "small_modular_nuclear",
    });

    expect(result.downgraded).toBe(false);
    expect(result.parsed).toBe(parsed);
  });

  it("keeps an editable plan when the only evaluation artifact failed closed", () => {
    const parsed: ParsedChatResponse = {
      type: "plan",
      content: "",
      plan_steps: [
        {
          title: "Initial Evaluation",
          action_type: "evidence_evaluation",
          config: { description: "Xe-100 investor presentation" },
        },
      ],
    };

    const result = enforceInitialEvaluationGuardrail(parsed, {
      hasUploadedDocuments: true,
      hasSuccessfulEvaluationArtifact: false,
      hasChartableArtifact: false,
      domain: "small_modular_nuclear",
    });

    expect(result.downgraded).toBe(true);
    expect(result.reason).toBe("pre_evaluation_plan_repaired");
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.plan_steps?.[0].action_type).toBe("evidence_evaluation");
    expect(result.parsed.plan_steps?.[0].config?.description).toBe("Xe-100 investor presentation");
  });

  it("does not use assistant apology prose as technology subject", () => {
    const parsed: ParsedChatResponse = {
      type: "plan",
      content: "Sorry - I cannot complete that. Starting grounded evaluation now.",
      plan_steps: [
        {
          action_type: "evidence_evaluation",
          config: { query: "X-energy Xe-100 reactor evaluation" },
        },
      ],
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState);

    expect(result.downgraded).toBe(true);
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.plan_steps?.[0].config?.description).toBe("X-energy Xe-100 reactor evaluation");
  });

  it("falls back to domain-anchored subject when no config description present", () => {
    const parsed: ParsedChatResponse = {
      type: "plan",
      content: "Starting work.",
      plan_steps: [{ action_type: "deep_analysis", config: {} }],
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState);

    expect(result.downgraded).toBe(true);
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.plan_steps?.[0].config?.description).toBe("small modular nuclear uploaded technology evaluation");
  });

  it.each(["response", "question"] as const)("does not downgrade %s responses", (type) => {
    const parsed: ParsedChatResponse = {
      type,
      content: "Direct answer.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState);

    expect(result.downgraded).toBe(false);
    expect(result.parsed).toBe(parsed);
  });

  it("downgrades response with uploaded documents and evaluation intent", () => {
    const parsed: ParsedChatResponse = {
      type: "response",
      content: "Running the STC simulation now.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState, {
      userMessage: "simulate this module performance under STC",
    });

    expect(result.downgraded).toBe(true);
    expect(result.reason).toBe("pre_evaluation_response_blocked");
    expect(result.parsed.action?.type).toBe("evidence_evaluation");
    expect(result.parsed.initial_evaluation_guardrail).toMatchObject({
      reason: "pre_evaluation_response_blocked",
      original_type: "response",
      original_action_type: null,
    });
  });

  it("turns complex evaluation responses into editable grounded plans", () => {
    const parsed: ParsedChatResponse = {
      type: "response",
      content: "Running the full review now.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState, {
      userMessage: "Can you conduct a full techno-economic evaluation?",
    });

    expect(result.downgraded).toBe(true);
    expect(result.reason).toBe("pre_evaluation_plan_repaired");
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.plan_steps).toHaveLength(8);
    expect(result.parsed.plan_steps?.[0].action_type).toBe("evidence_evaluation");
    expect(result.parsed.plan_steps?.some((s) => s.action_type === "exploratory_analysis")).toBe(true);
  });

  it.each(["literature_search", "deep_research"])(
    "downgrades pre-evaluation %s action with evaluation intent",
    (actionType) => {
      const parsed: ParsedChatResponse = {
        type: "action",
        content: "Searching first.",
        action: {
          type: actionType,
          config: { query: "X-energy SMR benchmarks" },
        },
      };

      const result = enforceInitialEvaluationGuardrail(parsed, projectState, {
        userMessage: "is this technology investable and commercially ready?",
      });

      expect(result.downgraded).toBe(true);
      expect(result.reason).toBe("pre_evaluation_action_blocked");
      expect(result.parsed.action?.type).toBe("evidence_evaluation");
      expect(result.parsed.initial_evaluation_guardrail?.original_action_type).toBe(actionType);
    },
  );

  it("does not downgrade response with uploaded documents and no evaluation intent", () => {
    const parsed: ParsedChatResponse = {
      type: "response",
      content: "Exergy is the useful work potential of energy.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState, {
      userMessage: "what is exergy?",
    });

    expect(result.downgraded).toBe(false);
    expect(result.parsed).toBe(parsed);
  });

  it("does not downgrade literature search with uploaded documents and no evaluation intent", () => {
    const parsed: ParsedChatResponse = {
      type: "action",
      content: "Searching the literature.",
      action: {
        type: "literature_search",
        config: { query: "commercial solar panel efficiency" },
      },
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState, {
      userMessage: "what is the most efficient commercial solar panel right now?",
    });

    expect(result.downgraded).toBe(false);
    expect(result.parsed).toBe(parsed);
  });

  it("does not downgrade response with evaluation intent after a successful evaluation exists", () => {
    const parsed: ParsedChatResponse = {
      type: "response",
      content: "Follow-on answer.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(
      parsed,
      { ...projectState, hasSuccessfulEvaluationArtifact: true },
      { userMessage: "evaluate this technology" },
    );

    expect(result.downgraded).toBe(false);
    expect(result.parsed).toBe(parsed);
  });

  it("repairs explicit plan requests into editable follow-on plans after evaluation exists", () => {
    const parsed: ParsedChatResponse = {
      type: "response",
      content: "Running a comprehensive exergy analysis.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(
      parsed,
      { ...projectState, hasSuccessfulEvaluationArtifact: true, domain: "thermochemical_reactor" },
      { userMessage: "Where's the plan you were supposed to create?" },
    );

    expect(result.downgraded).toBe(true);
    expect(result.reason).toBe("explicit_plan_request_repaired");
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.plan_steps?.[0].action_type).toBe("literature_search");
    expect(result.parsed.plan_steps?.map((s) => s.action_type)).toEqual([
      "literature_search",
      "deep_analysis",
      "deep_analysis",
      "deep_analysis",
      "deep_analysis",
      "exploratory_analysis",
      "deep_analysis",
    ]);
    expect(result.parsed.content).toContain("editable execution plan");
  });

  it("replaces model-generated intake-first plans with follow-on plans after evaluation exists", () => {
    const parsed: ParsedChatResponse = {
      type: "plan",
      content: "Running a comprehensive analysis.",
      plan_steps: [
        { action_type: "evidence_evaluation", config: { description: "redo intake" } },
        { action_type: "physics_simulation", config: {} },
      ],
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(
      parsed,
      { ...projectState, hasSuccessfulEvaluationArtifact: true, domain: "thermochemical_reactor" },
      { userMessage: "Where is the plan you were supposed to create?" },
    );

    expect(result.downgraded).toBe(true);
    expect(result.reason).toBe("explicit_plan_request_repaired");
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.plan_steps?.[0].action_type).toBe("literature_search");
    expect(result.parsed.plan_steps?.some((s) => s.action_type === "evidence_evaluation")).toBe(false);
    expect(result.parsed.plan_steps?.some((s) => s.action_type === "physics_simulation")).toBe(false);
  });

  it("repairs explicit plan requests into grounded intake-first plans before evaluation exists", () => {
    const parsed: ParsedChatResponse = {
      type: "response",
      content: "Here is what I will do.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(parsed, projectState, {
      userMessage: "create the plan first",
    });

    expect(result.downgraded).toBe(true);
    expect(result.reason).toBe("explicit_plan_request_repaired");
    expect(result.parsed.type).toBe("plan");
    expect(result.parsed.plan_steps?.[0].action_type).toBe("evidence_evaluation");
  });

  it("does not downgrade response with evaluation intent when no documents are uploaded", () => {
    const parsed: ParsedChatResponse = {
      type: "response",
      content: "Direct answer.",
      plan_steps: null,
      action: null,
    };

    const result = enforceInitialEvaluationGuardrail(
      parsed,
      { ...projectState, hasUploadedDocuments: false },
      { userMessage: "evaluate this technology" },
    );

    expect(result.downgraded).toBe(false);
    expect(result.parsed).toBe(parsed);
  });

  it("throws for malformed parsed responses so callers can log and pass through", () => {
    expect(() =>
      enforceInitialEvaluationGuardrail(null as unknown as ParsedChatResponse, projectState),
    ).toThrow("parsed chat response must be an object");

    expect(() =>
      enforceInitialEvaluationGuardrail({ content: "missing type" } as unknown as ParsedChatResponse, projectState),
    ).toThrow("parsed chat response must include a type");
  });
});
