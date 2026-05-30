import {
  buildClaimLedger,
  buildSourceExtractionConfidence,
  evaluateScenarioReproducibility,
} from "@/lib/agent-claim-ledger";
import type { ProjectDocument } from "@/lib/storage/types";

describe("agent claim ledger", () => {
  it("separates source-backed, calculated, assumed, and unsupported numeric claims", () => {
    const ledger = buildClaimLedger({
      sourceTexts: ["The uploaded note says capacity is 77 MWe and capacity factor target is 92 percent."],
      artifactTexts: ["The workspace calculated annual generation as 620,000 MWh and LCOE as 118 USD/MWh."],
      finalAnswer: [
        "I extracted 77 MWe and 92 percent from the uploaded note.",
        "I calculated annual generation as 620,000 MWh and LCOE as 118 USD/MWh.",
        "Assumption: project life is 40 years.",
        "The project will cost 42 USD/MWh.",
      ].join("\n"),
    });

    expect(ledger.summary.total_claims).toBeGreaterThanOrEqual(4);
    expect(ledger.summary.support_counts.source).toBeGreaterThanOrEqual(1);
    expect(ledger.summary.support_counts.tool_output).toBeGreaterThanOrEqual(1);
    expect(ledger.summary.support_counts.assumption).toBeGreaterThanOrEqual(1);
    expect(ledger.summary.unsupported_numeric_claims).toBeGreaterThanOrEqual(1);
  });

  it("scores document extraction confidence from text, values, and table-like lines", () => {
    const docs: ProjectDocument[] = [
      {
        id: "doc_1",
        filename: "technical.pdf",
        mime_type: "application/pdf",
        size_bytes: 1000,
        status: "extracted",
        uploaded_at: "2026-05-25T00:00:00.000Z",
        extraction_result: {
          text: [
            "Capacity 77 MWe.",
            "CAPEX 7500 USD/kWe.",
            "O&M 135 USD/kW-year.",
            "| case | value |",
            "| base | 92 percent |",
          ].join("\n"),
        },
      },
      {
        id: "doc_2",
        filename: "scan.pdf",
        mime_type: "application/pdf",
        size_bytes: 1000,
        status: "extracted",
        uploaded_at: "2026-05-25T00:00:00.000Z",
        extraction_result: {},
      },
    ];

    const diagnostics = buildSourceExtractionConfidence(docs);

    expect(diagnostics[0].confidence).toMatch(/medium|high/);
    expect(diagnostics[1].confidence).toBe("none");
    expect(diagnostics[1].issues.join(" ")).toContain("No parser-readable");
  });

  it("scores text upload evidence digests as parser-readable source context", () => {
    const docs: ProjectDocument[] = [
      {
        id: "doc_text",
        filename: "smr_deployment_case.md",
        mime_type: "text/markdown",
        size_bytes: 1000,
        status: "uploaded",
        uploaded_at: "2026-05-25T00:00:00.000Z",
        extraction_result: {
          document_evidence: {
            source_label: "SMR-DEPLOYMENT-CASE",
            source_labels: ["SMR-DEPLOYMENT-CASE"],
            filename: "smr_deployment_case.md",
            content_type: "text",
            facts: [],
            assumptions: [],
            unsupported_claims: [],
            contradicted_claims: [],
            missing_inputs: ["No licensed schedule is available."],
            next_actions: [],
            chartable_fields: [],
            non_chartable_fields: [],
            failed_extraction: false,
            preview: [
              "Net electrical capacity: 77 MWe.",
              "Capacity factor target: 92 percent.",
              "Overnight CAPEX: 7,500 USD/kWe.",
              "Fixed O&M: 135 USD/kW-year.",
            ].join("\n"),
          },
        },
      },
    ];

    const diagnostics = buildSourceExtractionConfidence(docs);

    expect(diagnostics[0].confidence).toMatch(/medium|high/);
    expect(diagnostics[0].numeric_value_count).toBeGreaterThanOrEqual(4);
    expect(diagnostics[0].salient_values?.map((item) => item.raw)).toEqual(expect.arrayContaining(["77", "92", "7,500", "135"]));
    expect(diagnostics[0].issues.join(" ")).not.toContain("No parser-readable");
  });

  it("flags weak scenario reproducibility when changed inputs are not visible", () => {
    const result = evaluateScenarioReproducibility({
      prompt: "Rerun the model with electricity price 50% lower and all other assumptions constant.",
      finalAnswer: "The economics improve materially.",
      artifactTexts: [],
    });

    expect(result.required).toBe(true);
    expect(result.score).toBeLessThan(75);
    expect(result.checks.some((check) => check.status === "warn")).toBe(true);
  });

  it("does not require scenario reproducibility for base calculations with change metrics", () => {
    const result = evaluateScenarioReproducibility({
      prompt: "Calculate annual electricity use, gas displaced, emissions change, operating-cost change, payback, and temperature limitations.",
      finalAnswer: "The emissions change is -862 tCO2/year and operating-cost change is -9,125 USD/year.",
      artifactTexts: [],
    });

    expect(result.required).toBe(false);
    expect(result.score).toBeNull();
  });

  it("passes scenario reproducibility when changed inputs, constants, base case, formulas, table, and drift check are visible", () => {
    const result = evaluateScenarioReproducibility({
      prompt: "Rerun the model with electricity price 50% lower and all other assumptions constant.",
      finalAnswer: [
        "Changed input: electricity price reduced by 50%. Held constant: all other assumptions from the base case.",
        "| Scenario | Electricity price | NPV result |",
        "|---|---:|---:|",
        "| Base case | 70 USD/MWh | -1.0 MUSD |",
        "| Lower-price case | 35 USD/MWh | 0.2 MUSD |",
        "Formula: NPV = discounted cash flow less CAPEX.",
        "Assumption drift check: only changed electricity price; production basis, CAPEX, and utilization are unchanged.",
      ].join("\n"),
      artifactTexts: ["workspace artifact art_base and art_scenario"],
    });

    expect(result.required).toBe(true);
    expect(result.score).toBe(100);
  });

  it("accepts explicit scenario bullets that say an input changed to a new value", () => {
    const result = evaluateScenarioReproducibility({
      prompt: "Rerun with conservative COP 2.25 and hold all other assumptions constant.",
      finalAnswer: [
        "### Scenario Reproducibility",
        "- Base case: COP 2.65, gas price 8.40 USD/MMBtu, base CAPEX.",
        "- Conservative COP: COP changed to 2.25; gas price and CAPEX unchanged.",
        "- Model basis: same formula as base case.",
        "- Assumption drift check: no other assumptions changed.",
        "| Scenario | COP | NPV |",
        "|---|---:|---:|",
        "| Base case | 2.65 | -27.0 MUSD |",
        "| Conservative COP | 2.25 | -31.9 MUSD |",
      ].join("\n"),
      artifactTexts: ["workspace result"],
    });

    expect(result.required).toBe(true);
    expect(result.checks.find((check) => check.id === "changed_inputs_visible")?.status).toBe("pass");
    expect(result.score).toBe(100);
  });
});
