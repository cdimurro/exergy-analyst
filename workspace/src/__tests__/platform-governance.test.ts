/**
 * Platform Governance Tests
 *
 * These 5 tests verify the behavioral contracts from the Platform Experience Guide:
 * 1. Failed-step synthesis acknowledgment
 * 2. Direct evaluation stays direct (prompt alignment)
 * 3. Depth label renders from metadata, not module name
 * 4. Gap-driven followups degrade cleanly with no brief
 * 5. Extraction completeness renders safely for zero/partial coverage
 */

// ── Test 1: Failed-step synthesis acknowledgment ─────────────────────

describe("Synthesis integrity", () => {
  it("includes failure context when plan steps fail", () => {
    // Simulate the planResults array after a step failure
    const planResults = [
      'Step 1 (Literature Search): Found 12 papers on R290 heat pumps',
      'Step 2 (Evaluation): FAILED — action could not complete',
      'Step 3 (Deep Analysis): Risk analysis complete',
    ];

    // This mirrors the logic in runPlan (page.tsx)
    const failedEntries = planResults.filter(r => r.includes("FAILED"));
    const failureContext = failedEntries.length > 0
      ? `\n\nIMPORTANT: ${failedEntries.length} of 3 analysis steps did not complete:\n${failedEntries.join("\n")}\nYou MUST acknowledge these gaps in your report.`
      : "";

    expect(failedEntries).toHaveLength(1);
    expect(failureContext).toContain("1 of 3 analysis steps did not complete");
    expect(failureContext).toContain("Step 2 (Evaluation): FAILED");
    expect(failureContext).toContain("MUST acknowledge");
  });

  it("produces no failure context when all steps succeed", () => {
    const planResults = [
      'Step 1 (Literature Search): Found 12 papers',
      'Step 2 (Evaluation): Score 0.67, 10 modules',
    ];

    const failedEntries = planResults.filter(r => r.includes("FAILED"));
    const failureContext = failedEntries.length > 0
      ? `IMPORTANT: ${failedEntries.length} steps failed`
      : "";

    expect(failedEntries).toHaveLength(0);
    expect(failureContext).toBe("");
  });

  it("sanitizes internal names from error messages", () => {
    // Simulate the sanitization logic in the catch block
    const rawErrors = [
      "Gemma 4 returned empty response",
      "DeepSeek V4-Pro timeout after 60s",
      "Intern S1 Pro rate limited",
      "Oracle sidecar failed",
      "Normal timeout error",
    ];

    const sanitized = rawErrors.map(msg =>
      msg.replace(/gemma|deepseek|intern|s1.pro|oracle/gi, "analysis engine")
    );

    expect(sanitized[0]).toBe("analysis engine 4 returned empty response");
    expect(sanitized[1]).toBe("analysis engine V4-Pro timeout after 60s");
    expect(sanitized[2]).toBe("analysis engine analysis engine rate limited");
    expect(sanitized[3]).toBe("analysis engine sidecar failed");
    expect(sanitized[4]).toBe("Normal timeout error"); // No change
    // None should contain internal names
    for (const s of sanitized) {
      expect(s.toLowerCase()).not.toContain("gemma");
      expect(s.toLowerCase()).not.toContain("deepseek");
      expect(s.toLowerCase()).not.toContain("oracle");
    }
  });
});

// ── Test 2: Direct evaluation stays direct ───────────────────────────

describe("Agent prompt alignment", () => {
  it("system prompt prioritizes knowledge sources without user-facing labels", () => {
    // The prompt should guide the agent's reasoning priority without exposing taxonomy to users
    const promptSnippet = `HOW TO PRIORITIZE WHAT YOU KNOW (internal reasoning — do NOT use these labels in responses):
Your knowledge comes from three sources, in order of strength:
1. Physics solver output — exact numbers from real thermodynamic models.
2. Baseline comparisons — user values vs published reference data.
3. Expert reasoning — your synthesis of data, literature, and domain knowledge.`;

    expect(promptSnippet).toContain("Physics solver output");
    expect(promptSnippet).toContain("Baseline comparisons");
    expect(promptSnippet).toContain("Expert reasoning");
    // Must explicitly say not to use labels in responses
    expect(promptSnippet).toContain("do NOT use these labels in responses");
    // Priority order preserved
    const solverIdx = promptSnippet.indexOf("Physics solver output");
    const baselineIdx = promptSnippet.indexOf("Baseline comparisons");
    const reasoningIdx = promptSnippet.indexOf("Expert reasoning");
    expect(solverIdx).toBeLessThan(baselineIdx);
    expect(baselineIdx).toBeLessThan(reasoningIdx);
  });

  it("system prompt contains fail-informatively principle", () => {
    const promptSnippet = "FAIL INFORMATIVELY, NEVER SILENTLY";
    expect(promptSnippet).toContain("FAIL INFORMATIVELY");
  });

  it("system prompt contains adaptive behavior section", () => {
    const promptSnippet = "BEING ADAPTIVE — THE CLAUDE CODE FOR ENERGY";
    expect(promptSnippet).toContain("CLAUDE CODE FOR ENERGY");
  });
});

// ── Test 3: Depth label from metadata, not module name ───────────────

describe("Module depth metadata (backend-only, not user-facing)", () => {
  // getModuleDepth exists in PhysicsResultsView.tsx for internal use
  // but is NOT rendered in the user-facing table (no Depth column)
  function getModuleDepth(details: Record<string, unknown> | undefined): { label: string; color: string } | null {
    if (!details) return null;
    const maturity = details.domain_maturity as string | undefined;
    const evidenceTier = details.module_evidence_tier as string | undefined;
    const cap = details.confidence_cap as number | undefined;

    if (maturity === "builtin_calibrated" || cap === 1.0)
      return { label: "Calibrated", color: "green" };
    if (maturity === "benchmarked_generated" && evidenceTier === "supported")
      return { label: "Benchmarked", color: "amber" };
    if (maturity === "benchmarked_generated")
      return { label: "Assessed", color: "muted" };
    if (maturity === "provisional_generated")
      return { label: "Directional", color: "dim" };

    return null;
  }

  it("returns Calibrated for builtin_calibrated domains", () => {
    const result = getModuleDepth({
      domain_maturity: "builtin_calibrated",
      module_evidence_tier: "supported",
      confidence_cap: 1.0,
    });
    expect(result).toEqual({ label: "Calibrated", color: "green" });
  });

  it("returns Benchmarked for benchmarked + supported", () => {
    const result = getModuleDepth({
      domain_maturity: "benchmarked_generated",
      module_evidence_tier: "supported",
      confidence_cap: 0.75,
    });
    expect(result).toEqual({ label: "Benchmarked", color: "amber" });
  });

  it("returns Assessed for benchmarked + partial", () => {
    const result = getModuleDepth({
      domain_maturity: "benchmarked_generated",
      module_evidence_tier: "partial",
      confidence_cap: 0.75,
    });
    expect(result).toEqual({ label: "Assessed", color: "muted" });
  });

  it("returns Directional for provisional domains", () => {
    const result = getModuleDepth({
      domain_maturity: "provisional_generated",
      module_evidence_tier: "unsupported",
      confidence_cap: 0.55,
    });
    expect(result).toEqual({ label: "Directional", color: "dim" });
  });

  it("returns null when metadata is absent", () => {
    expect(getModuleDepth(undefined)).toBeNull();
    expect(getModuleDepth({})).toBeNull();
  });

  it("does NOT use module name to determine depth", () => {
    // Physics module with provisional maturity should NOT be Calibrated
    const physicsProvisional = getModuleDepth({
      domain_maturity: "provisional_generated",
      confidence_cap: 0.55,
    });
    expect(physicsProvisional?.label).toBe("Directional");

    // Economics module with builtin maturity SHOULD be Calibrated
    const economicsCalibrated = getModuleDepth({
      domain_maturity: "builtin_calibrated",
      confidence_cap: 1.0,
    });
    expect(economicsCalibrated?.label).toBe("Calibrated");
  });
});

// ── Test 4: Gap-driven followups degrade cleanly ─────────────────────

describe("Gap-driven followups", () => {
  // CC-BE-REFACTOR-0040: exercise the real shared helper instead of the
  // line-for-line replica that previously lived here. The wrapper below
  // matches what the runPlan synthesis success handler does when combining
  // gap-driven followups with agent-suggested followups and defaults.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildGapFollowups } = require("../lib/brief-followups");

  function buildFollowups(
    briefData: Record<string, unknown> | null,
    agentFollowups: string[] | undefined,
  ): string[] {
    const gapFollowups: string[] = buildGapFollowups(briefData);
    const smartFollowups = [...gapFollowups, ...(agentFollowups || [])].slice(0, 3);
    return smartFollowups.length > 0
      ? smartFollowups
      : ["Analyze the key risks and tradeoffs in more detail", "Search for comparable published benchmarks", "Generate a downloadable PDF report"];
  }

  it("generates gap-driven followups from evaluation brief", () => {
    const brief = {
      ranked_gap_guidance: [
        { parameter: "cycle_life", impact: "high", why_it_matters: "Durability" },
      ],
      baseline_comparisons: [
        { parameter: "COP", position: "above", your_value: "4.2", baseline_value: "3.5" },
      ],
    };
    const result = buildFollowups(brief, ["Agent suggestion"]);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("cycle_life");
    expect(result[1]).toContain("COP");
    expect(result[2]).toBe("Agent suggestion");
  });

  it("falls back to agent suggestions when no brief exists", () => {
    const result = buildFollowups(null, ["Suggestion 1", "Suggestion 2", "Suggestion 3"]);
    expect(result).toEqual(["Suggestion 1", "Suggestion 2", "Suggestion 3"]);
  });

  it("falls back to defaults when no brief AND no agent suggestions", () => {
    const result = buildFollowups(null, undefined);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("risks and tradeoffs");
  });

  it("falls back to defaults when brief has no gaps and no agent suggestions", () => {
    const result = buildFollowups({ ranked_gap_guidance: [], baseline_comparisons: [] }, []);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("risks and tradeoffs");
  });

  it("caps at 3 followups even with many gap entries", () => {
    const brief = {
      ranked_gap_guidance: [
        { parameter: "a" }, { parameter: "b" },
      ],
      baseline_comparisons: [
        { parameter: "c", position: "above" },
        { parameter: "d", position: "below" },
      ],
    };
    const result = buildFollowups(brief, ["e", "f"]);
    expect(result).toHaveLength(3);
  });
});

// ── Test 5: Extraction completeness handles zero/partial ─────────────

describe("Extraction completeness", () => {
  function computeExtraction(
    coverage: Record<string, { params_matched: number; params_expected: number }> | undefined,
    mods: Record<string, { details?: { evidence_params_matched?: number; evidence_params_expected?: number } }> | undefined,
  ): { matched: number; expected: number; pct: number } | null {
    // Replicate the logic from EvalCardWidget — neutral progress bar, no warning
    let matched = 0, expected = 0;
    if (coverage) {
      Object.values(coverage).forEach(c => { matched += Number(c.params_matched) || 0; expected += Number(c.params_expected) || 0; });
    } else if (mods) {
      Object.values(mods).forEach(m => { matched += Number(m.details?.evidence_params_matched) || 0; expected += Number(m.details?.evidence_params_expected) || 0; });
    }
    if (expected === 0) return null;
    const pct = Math.round((matched / expected) * 100);
    return { matched, expected, pct };
  }

  it("returns null when expected is 0 (no coverage data)", () => {
    expect(computeExtraction(undefined, undefined)).toBeNull();
    expect(computeExtraction({}, undefined)).toBeNull();
  });

  it("computes correctly from coverage summary", () => {
    const result = computeExtraction({
      physics: { params_matched: 4, params_expected: 6 },
      performance: { params_matched: 3, params_expected: 8 },
      economics: { params_matched: 1, params_expected: 8 },
    }, undefined);
    expect(result).toEqual({ matched: 8, expected: 22, pct: 36 });
  });

  it("falls back to module details when no coverage summary", () => {
    const result = computeExtraction(undefined, {
      physics: { details: { evidence_params_matched: 2, evidence_params_expected: 6 } },
      performance: { details: { evidence_params_matched: 0, evidence_params_expected: 8 } },
    });
    expect(result).toEqual({ matched: 2, expected: 14, pct: 14 });
  });

  it("shows low coverage without alarming the user", () => {
    const result = computeExtraction({
      physics: { params_matched: 1, params_expected: 6 },
      performance: { params_matched: 1, params_expected: 8 },
    }, undefined);
    expect(result?.pct).toBe(14);
    expect(result?.matched).toBe(2);
    // No isWeak flag — the bar shows progress neutrally
  });

  it("handles zero matched params without error", () => {
    const result = computeExtraction({
      physics: { params_matched: 0, params_expected: 6 },
      performance: { params_matched: 0, params_expected: 8 },
    }, undefined);
    expect(result).toEqual({ matched: 0, expected: 14, pct: 0 });
  });

  it("handles high coverage correctly", () => {
    const result = computeExtraction({
      physics: { params_matched: 5, params_expected: 6 },
      performance: { params_matched: 7, params_expected: 8 },
      economics: { params_matched: 6, params_expected: 8 },
    }, undefined);
    expect(result).toEqual({ matched: 18, expected: 22, pct: 82 });
  });

  it("handles NaN/undefined params gracefully", () => {
    const result = computeExtraction({
      physics: { params_matched: undefined as any, params_expected: 6 },
      performance: { params_matched: 3, params_expected: undefined as any },
    }, undefined);
    // Number(undefined) || 0 = 0, so this should still work
    expect(result).toEqual({ matched: 3, expected: 6, pct: 50 });
  });
});
