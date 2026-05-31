import {
  PUBLIC_AGENT_NAME,
  isAgentIdentityQuestion,
  sanitizeUserFacingAgentText,
} from "@/lib/agent-output";

describe("agent output sanitizer", () => {
  it("removes old report-card UI labels from chat-facing text", () => {
    const text = sanitizeUserFacingAgentText([
      "Result: Use as a triage note.",
      "Screening",
      "What Is Supported",
      "The document contains a process-flow description.",
      "Do Not Claim Yet",
      "This does not prove economics.",
      "View Details",
      "Export Report",
    ].join("\n"));

    expect(text).toContain("The document contains a process-flow description.");
    expect(text).toContain("This does not prove economics.");
    expect(text).not.toMatch(/Screening|What Is Supported|Do Not Claim Yet|View Details|Export Report/i);
  });

  it("rewrites audit headings into plain language", () => {
    const text = sanitizeUserFacingAgentText([
      "**Result:** Analysis complete.",
      "What the data can support: extracted PV module parameters.",
      "What it cannot prove yet: measured annual yield.",
      "Next decision: run a site-specific model.",
    ].join("\n"));

    expect(text).toContain("Analysis complete.");
    expect(text).toContain("Basis: extracted PV module parameters.");
    expect(text).toContain("Important limit: measured annual yield.");
    expect(text).toContain("Next, run a site-specific model.");
    expect(text).not.toContain("**Result:**");
  });

  it("normalizes workspace report chrome before chat persistence", () => {
    const text = sanitizeUserFacingAgentText([
      "# Analysis Run",
      "",
      "## Direct Answer",
      "The calculation completed.",
    ].join("\n"));

    expect(text).not.toContain("# Analysis Run");
    expect(text).not.toContain("## Direct Answer");
    expect(text).toContain("## Executive Summary");
  });

  it("hides internal audit vocabulary from user-facing text", () => {
    const text = sanitizeUserFacingAgentText([
      "Claim status: supported.",
      "Hidden residuals: model residual table.",
      "Identified sets: bounded posterior set.",
      "Unsupported claims: commercial readiness.",
      "Supported claims: measured output.",
    ].join("\n"));

    expect(text).not.toMatch(/claim status|hidden residual|identified sets|unsupported claims|supported claims/i);
    expect(text).not.toContain("model residual table");
    expect(text).not.toContain("bounded posterior set");
    expect(text).toContain("Language to avoid");
    expect(text).toContain("supported statements");
    expect(text).not.toMatch(/source-backed/i);
  });

  it("removes final-quality repair preambles and private finding labels", () => {
    const text = sanitizeUserFacingAgentText([
      "The draft answer is essentially correct, but the `quality_unsupported_source_number` warning points to a harmless value.",
      "I rephrased that sentence and no other changes are needed.",
      "",
      "---",
      "",
      "# Geothermal Report",
      "The calculation completed with source-backed inputs.",
    ].join("\n"));

    expect(text).toContain("# Geothermal Report");
    expect(text).toContain("The calculation completed with supported inputs.");
    expect(text).not.toMatch(/source-backed/i);
    expect(text).not.toMatch(/draft answer|quality_unsupported_source_number|warning points|rephrased/i);
  });

  it("drops unresolved template placeholder lines from chat-facing reports", () => {
    const text = sanitizeUserFacingAgentText([
      "# Microgrid Report",
      "- Peak load: {peak_load_mw} MW",
      "- Diesel fuel consumption: {annual_diesel_fuel_L:.0f} L/yr",
      "| Metric | Value |",
      "|---|---|",
      "| PV generation | 61670 MWh/yr |",
    ].join("\n"));

    expect(text).toContain("# Microgrid Report");
    expect(text).toContain("| PV generation | 61670 MWh/yr |");
    expect(text).not.toMatch(/\{peak_load_mw\}|\{annual_diesel_fuel_L/);
  });

  it("rewrites provider/model self-identification to the public agent identity", () => {
    const text = sanitizeUserFacingAgentText("I am analysis engine V4 Flash, an AI assistant for energy work.");

    expect(text).toContain(`I’m the ${PUBLIC_AGENT_NAME}`);
    expect(text).not.toMatch(/deepseek|v4|flash|analysis engine/i);
  });

  it("polishes unnatural already-prefaced first-person phrasing", () => {
    const text = sanitizeUserFacingAgentText("I've already extracted the key parameters and I've already run the model.");

    expect(text).toContain("I extracted the key parameters and I ran the model.");
    expect(text).not.toMatch(/I've already|I’ve already/i);
  });

  it("repairs escaped newlines and control characters from generated workspace reports", () => {
    const text = sanitizeUserFacingAgentText("## Results\\n| Case | Value |\\n|---|---|\\n| Base | 1 |\\nEquation: \frac{dT}{dt}\ttext");

    expect(text).toContain("## Results\n| Case | Value |");
    expect(text).not.toContain("\\n|");
    expect(text).not.toMatch(/[\x00-\x08\x0B\x0E-\x1F\x7F]/);
  });

  it("adds a missing markdown table separator row for generated reports", () => {
    const text = sanitizeUserFacingAgentText("| Case | Value |\n| Base | 1 |");

    expect(text).toContain("| Case | Value |\n| --- | --- |\n| Base | 1 |");
  });

  it("repairs markdown table separator rows with the wrong column count", () => {
    const text = sanitizeUserFacingAgentText("| Metric | Value |\n|---|---|---|\n| Gas price | 7.20 |");

    expect(text).toContain("| Metric | Value |\n| --- | --- |\n| Gas price | 7.20 |");
    expect(text).not.toContain("|---|---|---|");
  });

  it("detects public identity questions", () => {
    expect(isAgentIdentityQuestion("Which AI model is this?")).toBe(true);
    expect(isAgentIdentityQuestion("What model are you?")).toBe(true);
    expect(isAgentIdentityQuestion("What can you help me with?")).toBe(true);
    expect(isAgentIdentityQuestion("Can you explain exergy?")).toBe(false);
  });
});
