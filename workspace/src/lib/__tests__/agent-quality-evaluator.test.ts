import {
  evaluateAgentQuality,
  extractNumericEvidence,
} from "@/lib/agent-quality-evaluator";

describe("agent quality evaluator", () => {
  it("extracts numeric evidence with engineering units", () => {
    const values = extractNumericEvidence("Module power 440 W, SEC 3.4 kWh/m3, water 20,000 m3/day.");

    expect(values.map((item) => `${item.raw} ${item.unit}`)).toEqual(
      expect.arrayContaining(["440 W", "3.4 kWh", "20,000 m3/day"]),
    );
  });

  it("flags source-backed numbers that are not present in the source", () => {
    const result = evaluateAgentQuality({
      prompt: "Simulate the module.",
      finalAnswer: "Module data extracted from datasheet: STC Power = 550 W. Daily AC = 3.4 kWh.",
      sourceTexts: ["Canadian Solar module power class 440 W STC. Temperature coefficient -0.37 percent per degC."],
      requiresTool: true,
    });

    expect(result.findings.map((item) => item.type)).toContain("quality_unsupported_source_number");
    expect(result.score).toBeLessThan(100);
  });

  it("passes source value retention when the answer uses uploaded values", () => {
    const result = evaluateAgentQuality({
      prompt: "Prepare a decision brief.",
      finalAnswer: "The source lists 8.4 MW thermal, 6,300 hours/year, 5.8 million USD CAPEX, and 7.20 USD/MMBtu gas.",
      sourceTexts: ["Available waste heat: 8.4 MW thermal. Annual availability: 6,300 hours per year. Installed CAPEX: 5.8 million USD. Gas price: 7.20 USD/MMBtu."],
      requiresTool: true,
    });

    expect(result.source_value_coverage).toBeGreaterThan(0.7);
    expect(result.findings.map((item) => item.type)).not.toContain("quality_low_source_value_coverage");
  });

  it("builds independent calculation probes for simple engineering checks", () => {
    const result = evaluateAgentQuality({
      prompt: "Calculate desalination energy.",
      finalAnswer: "Daily energy is 68.0 MWh/day.",
      sourceTexts: ["Plant product water: 20,000 m3/day. Specific energy consumption: 3.4 kWh/m3 product water."],
      requiresTool: true,
    });

    expect(result.calculation_probes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "flow_times_specific_energy_kwh_day",
        expected: 68000,
        found: true,
      }),
    ]));
  });

  it("flags unresolved placeholders and malformed tables", () => {
    const result = evaluateAgentQuality({
      prompt: "Return a table.",
      finalAnswer: "# Results\n\n{table_md}\n\n| Metric | Value |\n|---|---|---|\n| A | 1 |",
      sourceTexts: [],
      requiresTool: true,
    });

    expect(result.findings.map((item) => item.type)).toEqual(expect.arrayContaining([
      "quality_unresolved_template_placeholder",
      "quality_malformed_markdown_table",
    ]));
  });

  it("checks requested artifact integrity", () => {
    const result = evaluateAgentQuality({
      prompt: "Create a CSV.",
      finalAnswer: "I created the CSV.",
      sourceTexts: [],
      requiresTool: true,
      requiresFiles: true,
      files: [{ filename: "results.csv" }],
    });

    expect(result.findings.map((item) => item.type)).toEqual(expect.arrayContaining([
      "quality_incomplete_file_artifact",
    ]));
  });

  it("does not treat clearly tool-backed best-effort answers as shallow manual fallbacks", () => {
    const result = evaluateAgentQuality({
      prompt: "Run the uploaded-file model and create a report.",
      finalAnswer: "This is a best-effort analysis. Downloads are attached, and the workspace created the report from verified source values.",
      sourceTexts: ["CAPEX 4.6 million USD. COP 3.1."],
      requiresTool: true,
      files: [{ filename: "report.md", url: "/download/report.md", mime_type: "text/markdown" }],
      events: [{ type: "tool.completed" }, { type: "file.created" }],
    });

    expect(result.findings.map((item) => item.type)).not.toContain("quality_tool_fallback_answer");
  });
});
