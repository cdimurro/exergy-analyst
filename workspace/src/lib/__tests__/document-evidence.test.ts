import {
  buildDocumentEvidenceDigest,
  buildSalientSourceValues,
  renderSalientSourceValuesTable,
  summarizeDocumentEvidence,
} from "@/lib/document-evidence";
import type { ProjectDocument } from "@/lib/storage/types";

describe("document evidence digestion", () => {
  function minimalPdf(text: string): Buffer {
    const safeText = text.replace(/[\\()]/g, (match) => `\\${match}`);
    const stream = `BT /F1 10 Tf 50 760 Td (${safeText}) Tj ET`;
    const objects = [
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
      "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    ];
    return Buffer.from(`%PDF-1.4\n${objects.join("\n")}\n%%EOF`, "latin1");
  }

  it("extracts parser-readable text from simple text PDFs", () => {
    const digest = buildDocumentEvidenceDigest(
      "heat_pump_retrofit_brief.pdf",
      minimalPdf("Heat pump COP 3.1 at 45 degC supply. Installed CAPEX 4.6 million USD."),
      "application/pdf",
    );

    expect(digest?.preview).toContain("Heat pump COP 3.1");
    expect(digest?.preview).toContain("Installed CAPEX 4.6 million USD");
  });

  it("builds salient source values from simple PDF evidence", () => {
    const digest = buildDocumentEvidenceDigest(
      "heat_pump_retrofit_brief.pdf",
      minimalPdf("Heat pump COP 3.1 at 45 degC supply. Installed CAPEX 4.6 million USD."),
      "application/pdf",
    );
    const docs: ProjectDocument[] = [{
      id: "doc-pdf",
      filename: "heat_pump_retrofit_brief.pdf",
      mime_type: "application/pdf",
      size_bytes: 10,
      status: "uploaded",
      uploaded_at: "2026-05-01T00:00:00.000Z",
      extraction_result: { document_evidence: digest },
    }];

    const values = buildSalientSourceValues(docs);

    expect(values.map((item) => item.raw)).toEqual(expect.arrayContaining(["3.1", "45", "4.6"]));
    expect(renderSalientSourceValuesTable(values)).toContain("Source value");
  });

  it("extracts source-labeled facts, unsupported claims, missing inputs, and chartable fields from text", () => {
    const text = [
      "Source label: `TEST-REPORT-A`",
      "Supported by this report: liquid output was 9.1 kg/h during the recorded four-hour bench run.",
      "No durability run longer than four hours is included.",
      "Chartable fields:",
      "- Reactor temperature by run.",
      "- Liquid output by run.",
    ].join("\n");

    const digest = buildDocumentEvidenceDigest("technical_test_report.md", Buffer.from(text), "text/markdown");

    expect(digest?.source_label).toBe("TEST-REPORT-A");
    expect(digest?.facts.join("\n")).toMatch(/9.1 kg\/h/);
    expect(digest?.missing_inputs.join("\n")).toMatch(/No durability run/i);
    expect(digest?.chartable_fields.join("\n")).toMatch(/Reactor temperature/i);
  });

  it("extracts numeric CSV fields without treating missing finance inputs as calculations", () => {
    const csv = [
      "source_label,line_item,category,value,unit,basis,notes",
      "COST-MODEL-A,reactor skid,capex,420000,USD,one skid,budgetary quote",
      "COST-MODEL-A,WACC,missing,,percent,finance basis,Required before NPV or IRR",
    ].join("\n");

    const digest = buildDocumentEvidenceDigest("cost_model.csv", Buffer.from(csv), "text/csv");

    expect(digest?.source_label).toBe("COST-MODEL-A");
    expect(digest?.facts.join("\n")).toMatch(/reactor skid: 420000 USD/);
    expect(digest?.missing_inputs.join("\n")).toMatch(/WACC/);
    expect(digest?.missing_inputs.join("\n")).toMatch(/Owner: finance owner/);
    expect(digest?.chartable_fields).toContain("value from COST-MODEL-A");
  });

  it("builds salient source values from CSV evidence", () => {
    const digest = buildDocumentEvidenceDigest(
      "utility_equipment_log.csv",
      Buffer.from([
        "source_label,line_item,category,value,unit,basis,notes",
        "UTILITY-A,compressor_A,power,620,kW,nameplate,inlet filter fouling suspected",
        "UTILITY-A,pump_B,power,74,kW,metered,throttled valve 45 percent",
        "UTILITY-A,refrigeration_C,power,710,kW,metered,high condensing temp",
      ].join("\n")),
      "text/csv",
    );
    const docs: ProjectDocument[] = [{
      id: "doc-csv",
      filename: "utility_equipment_log.csv",
      mime_type: "text/csv",
      size_bytes: 10,
      status: "uploaded",
      uploaded_at: "2026-05-01T00:00:00.000Z",
      extraction_result: { document_evidence: digest },
    }];

    const table = renderSalientSourceValuesTable(buildSalientSourceValues(docs));

    expect(table).toContain("compressor_A");
    expect(table).toContain("620");
    expect(table).toContain("refrigeration_C");
  });

  it("builds salient source values from Markdown evidence", () => {
    const digest = buildDocumentEvidenceDigest(
      "techno_economic_case.md",
      Buffer.from([
        "Source label: TEA-A",
        "Supported by this report: CAPEX is 64 million USD.",
        "Supported by this report: electricity cost is 68 USD/MWh.",
        "Supported by this report: availability is 91 percent.",
      ].join("\n")),
      "text/markdown",
    );
    const docs: ProjectDocument[] = [{
      id: "doc-md",
      filename: "techno_economic_case.md",
      mime_type: "text/markdown",
      size_bytes: 10,
      status: "uploaded",
      uploaded_at: "2026-05-01T00:00:00.000Z",
      extraction_result: { document_evidence: digest },
    }];

    const values = buildSalientSourceValues(docs);

    expect(values.map((item) => item.raw)).toEqual(expect.arrayContaining(["64", "68", "91"]));
    expect(values.map((item) => item.label)).not.toContain("Source label");
  });

  it("does not treat source label years as salient engineering values", () => {
    const digest = buildDocumentEvidenceDigest(
      "district_heating_case.md",
      Buffer.from([
        "Source labels: DH-CASE-2026 COST-CASE-2026 PERMIT-CASE-2026",
        "Annual district-heating offtake demand: 92,000 MWh/year.",
        "Peak thermal delivery requirement: 22 MWth.",
      ].join("\n")),
      "text/markdown",
    );
    const docs: ProjectDocument[] = [{
      id: "doc-md-labels",
      filename: "district_heating_case.md",
      mime_type: "text/markdown",
      size_bytes: 10,
      status: "uploaded",
      uploaded_at: "2026-05-01T00:00:00.000Z",
      extraction_result: { document_evidence: digest },
    }];

    const table = renderSalientSourceValuesTable(buildSalientSourceValues(docs));

    expect(table).toContain("92,000");
    expect(table).toContain("22");
    expect(table).not.toMatch(/\| Source labels? \| -?2026/i);
  });

  it("does not turn Markdown missing-input headings into missing values", () => {
    const digest = buildDocumentEvidenceDigest(
      "case.md",
      Buffer.from([
        "## Missing inputs and limits",
        "- No interconnection study is available.",
        "- No measured hourly profile is provided.",
      ].join("\n")),
      "text/markdown",
    );

    expect(digest?.missing_inputs.join("\n")).toContain("No interconnection study");
    expect(digest?.missing_inputs.join("\n")).not.toContain("## Missing inputs and limits");
  });

  it("detects missing numeric cells in wide operating CSVs without marking every row missing", () => {
    const csv = [
      "source_label,run_id,timestamp,feed_rate_kg_h,reactor_temp_c,liquid_output_kg_h,notes",
      "OPS-DATA-A,RUN-001,2026-03-14T09:00:00Z,17.8,479,8.9,steady",
      "OPS-DATA-A,RUN-002,2026-03-14T10:00:00Z,,482,9.1,feed rate cell missing",
      "OPS-DATA-A,RUN-003,2026-03-14T11:00:00Z,18.0,484,,liquid output sensor flagged invalid",
    ].join("\n");

    const digest = buildDocumentEvidenceDigest("operating_data.csv", Buffer.from(csv), "text/csv");
    const missing = digest?.missing_inputs.join("\n") || "";

    expect(digest?.source_label).toBe("OPS-DATA-A");
    expect(digest?.chartable_fields).toContain("feed_rate_kg_h from OPS-DATA-A");
    expect(digest?.chartable_fields).toContain("liquid_output_kg_h from OPS-DATA-A");
    expect(missing).toContain("feed_rate_kg_h for RUN-002 is missing. Owner: technical test owner.");
    expect(missing).toContain("liquid_output_kg_h for RUN-003 is missing. Owner: technical test owner.");
    expect(missing).not.toContain("RUN-001 is missing");
  });

  it("summarizes only source-labeled fixture evidence for chat grounding", () => {
    const digest = buildDocumentEvidenceDigest(
      "investor_deck_claims.md",
      Buffer.from("Source label: `INVESTOR-DECK-A`\nThe technology is pilot-ready today.\nEvidence expectation: contradicted by TEST-REPORT-A."),
      "text/markdown",
    );
    const docs: ProjectDocument[] = [{
      id: "doc-1",
      filename: "investor_deck_claims.md",
      mime_type: "text/markdown",
      size_bytes: 10,
      status: "uploaded",
      uploaded_at: "2026-05-01T00:00:00.000Z",
      extraction_result: { document_evidence: digest },
    }];

    const summary = summarizeDocumentEvidence(docs);

    expect(summary?.sourceLabels).toEqual(["INVESTOR-DECK-A (investor_deck_claims.md)"]);
    expect(summary?.contradictedClaims.join("\n")).toMatch(/INVESTOR-DECK-A/);
  });

  it("does not promote deck evidence-expectation annotations into known facts", () => {
    const digest = buildDocumentEvidenceDigest(
      "investor_deck_claims.md",
      Buffer.from([
        "Source label: `INVESTOR-DECK-A`",
        "The system has demonstrated 9.1 kg/h liquid output.",
        "Evidence expectation: supported by TEST-REPORT-A for one four-hour bench run.",
        "Evidence expectation: unsupported; no durability run longer than four hours is included.",
      ].join("\n")),
      "text/markdown",
    );

    expect(digest?.facts.join("\n")).not.toMatch(/Evidence expectation/i);
    expect(digest?.unsupported_claims.join("\n")).toMatch(/no durability run longer than four hours/i);
    expect(digest?.unsupported_claims.join("\n")).not.toMatch(/Evidence expectation|unsupported;/i);
    expect(digest?.missing_inputs.join("\n")).not.toMatch(/Evidence expectation|unsupported;/i);
    expect(digest?.missing_inputs.join("\n")).toMatch(/No durability run longer than four hours is included\. Owner: technical test owner\./);
  });

  it("cleans contradicted evidence-expectation annotations without losing the contradiction", () => {
    const digest = buildDocumentEvidenceDigest(
      "investor_deck_claims.md",
      Buffer.from([
        "Source label: `INVESTOR-DECK-A`",
        "The system is pilot-ready today.",
        "Evidence expectation: contradicted by TEST-REPORT-A, which says bench-scale only and no pilot data.",
      ].join("\n")),
      "text/markdown",
    );

    expect(digest?.contradicted_claims.join("\n")).toContain("Contradicted by TEST-REPORT-A");
    expect(digest?.contradicted_claims.join("\n")).not.toMatch(/Evidence expectation/i);
  });

  it("ranks measured facts ahead of operating row notes in evidence summaries", () => {
    const reportDigest = buildDocumentEvidenceDigest(
      "technical_test_report.md",
      Buffer.from([
        "Source label: `TEST-REPORT-A`",
        "Test date: 2026-03-14",
        "Measured liquid output was 9.1 kg/h during the recorded four-hour bench run.",
      ].join("\n")),
      "text/markdown",
    );
    const opsDigest = buildDocumentEvidenceDigest(
      "operating_data.csv",
      Buffer.from([
        "source_label,run_id,timestamp,liquid_output_kg_h,notes",
        "OPS-DATA-A,RUN-001,2026-03-14T09:00:00Z,8.9,startup stabilized after 20 minutes",
      ].join("\n")),
      "text/csv",
    );
    const docs: ProjectDocument[] = [
      {
        id: "doc-ops",
        filename: "operating_data.csv",
        mime_type: "text/csv",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: opsDigest },
      },
      {
        id: "doc-report",
        filename: "technical_test_report.md",
        mime_type: "text/markdown",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: reportDigest },
      },
    ];

    const summary = summarizeDocumentEvidence(docs);

    expect(summary?.facts[0]).toContain("TEST-REPORT-A");
    expect(summary?.facts[0]).toContain("9.1 kg/h");
    expect(summary?.facts.join("\n")).toContain("RUN-001 note");
  });

  it("does not treat deck claim numbers as chartable data fields", () => {
    const deckDigest = buildDocumentEvidenceDigest(
      "investor_deck_claims.md",
      Buffer.from([
        "Source label: `INVESTOR-DECK-A`",
        "Chartable deck claims:",
        "- Claimed liquid output of 9.1 kg/h.",
        "- Claimed operating temperature below 500 C.",
      ].join("\n")),
      "text/markdown",
    );
    const opsDigest = buildDocumentEvidenceDigest(
      "operating_data.csv",
      Buffer.from([
        "source_label,run_id,timestamp,liquid_output_kg_h,reactor_temp_c",
        "OPS-DATA-A,RUN-001,2026-03-14T09:00:00Z,8.9,479",
      ].join("\n")),
      "text/csv",
    );
    const docs: ProjectDocument[] = [
      {
        id: "doc-deck",
        filename: "investor_deck_claims.md",
        mime_type: "text/markdown",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: deckDigest },
      },
      {
        id: "doc-ops",
        filename: "operating_data.csv",
        mime_type: "text/csv",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: opsDigest },
      },
    ];

    const summary = summarizeDocumentEvidence(docs);

    expect(summary?.chartableFields.join("\n")).not.toMatch(/INVESTOR-DECK-A|Claimed liquid output|Claimed operating temperature/);
    expect(summary?.chartableFields).toContain("[OPS-DATA-A] liquid_output_kg_h from OPS-DATA-A");
    expect(summary?.chartableFields).toContain("[OPS-DATA-A] reactor_temp_c from OPS-DATA-A");
  });

  it("ranks operating output chart fields ahead of generic cost values", () => {
    const costDigest = buildDocumentEvidenceDigest(
      "cost_model.csv",
      Buffer.from([
        "source_label,line_item,category,value,unit,basis,notes",
        "COST-MODEL-A,reactor skid,capex,420000,USD,one skid,budgetary quote",
      ].join("\n")),
      "text/csv",
    );
    const opsDigest = buildDocumentEvidenceDigest(
      "operating_data.csv",
      Buffer.from([
        "source_label,run_id,timestamp,feed_rate_kg_h,reactor_temp_c,liquid_output_kg_h,gas_output_kg_h",
        "OPS-DATA-A,RUN-001,2026-03-14T09:00:00Z,17.8,479,8.9,2.5",
      ].join("\n")),
      "text/csv",
    );
    const docs: ProjectDocument[] = [
      {
        id: "doc-cost",
        filename: "cost_model.csv",
        mime_type: "text/csv",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: costDigest },
      },
      {
        id: "doc-ops",
        filename: "operating_data.csv",
        mime_type: "text/csv",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: opsDigest },
      },
    ];

    const chartableFields = summarizeDocumentEvidence(docs)?.chartableFields || [];

    expect(chartableFields.indexOf("[OPS-DATA-A] liquid_output_kg_h from OPS-DATA-A")).toBeLessThan(
      chartableFields.indexOf("[COST-MODEL-A] value from COST-MODEL-A"),
    );
    expect(chartableFields.slice(0, 3).join("\n")).toMatch(/liquid_output_kg_h|gas_output_kg_h/);
  });

  it("retains cost-model finance gaps when larger evidence bundles have many missing inputs", () => {
    const noisyDocs: ProjectDocument[] = Array.from({ length: 30 }, (_, index) => {
      const digest = buildDocumentEvidenceDigest(
        `supporting_note_${index}.md`,
        Buffer.from([
          `Source label: NOTE-${index}`,
          `No auxiliary evidence ${index} is provided.`,
        ].join("\n")),
        "text/markdown",
      );
      return {
        id: `doc-note-${index}`,
        filename: `supporting_note_${index}.md`,
        mime_type: "text/markdown",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: digest },
      };
    });
    const costDigest = buildDocumentEvidenceDigest(
      "cost_model.csv",
      Buffer.from([
        "source_label,line_item,category,value,unit,basis,notes",
        "COST-MODEL-A,utilization,missing,,percent,annual operating basis,Required before annual economics or payback",
        "COST-MODEL-A,WACC,missing,,percent,finance basis,Required before NPV or IRR",
      ].join("\n")),
      "text/csv",
    );

    const summary = summarizeDocumentEvidence([
      ...noisyDocs,
      {
        id: "doc-cost",
        filename: "cost_model.csv",
        mime_type: "text/csv",
        size_bytes: 10,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
        extraction_result: { document_evidence: costDigest },
      },
    ]);

    expect(summary?.missingInputs.join("\n")).toContain("[COST-MODEL-A] utilization");
    expect(summary?.missingInputs.join("\n")).toContain("[COST-MODEL-A] WACC");
  });

  it("preserves multiple source labels from conflicting evidence bundles", () => {
    const digest = buildDocumentEvidenceDigest(
      "conflicting_evidence_bundle.md",
      Buffer.from([
        "Source labels: `CONFLICT-DECK-A`, `CONFLICT-REPORT-A`",
        "Testing is limited to a bench-scale module.",
        "The system is ready for commercial deployment.",
        "Conflict map:",
        "| Claim | Deck source | Technical source | Status |",
        "| --- | --- | --- | --- |",
        "| Commercial deployment ready | CONFLICT-DECK-A | CONFLICT-REPORT-A says bench-scale only | Contradicted |",
        "| Bankable deployment | CONFLICT-DECK-A | CONFLICT-REPORT-A says finance assumptions missing | Unsupported |",
        "| Four-hour bench operation | Not emphasized | CONFLICT-REPORT-A | Supported |",
      ].join("\n")),
      "text/markdown",
    );
    const docs: ProjectDocument[] = [{
      id: "doc-1",
      filename: "conflicting_evidence_bundle.md",
      mime_type: "text/markdown",
      size_bytes: 10,
      status: "uploaded",
      uploaded_at: "2026-05-01T00:00:00.000Z",
      extraction_result: { document_evidence: digest },
    }];

    const summary = summarizeDocumentEvidence(docs);

    expect(digest?.source_label).toBe("CONFLICT-DECK-A");
    expect(digest?.source_labels).toEqual(["CONFLICT-DECK-A", "CONFLICT-REPORT-A"]);
    expect(summary?.sourceLabels).toEqual([
      "CONFLICT-DECK-A (conflicting_evidence_bundle.md)",
      "CONFLICT-REPORT-A (conflicting_evidence_bundle.md)",
    ]);
    expect(summary?.facts.join("\n")).toContain("Four-hour bench operation is supported");
    expect(summary?.unsupportedClaims.join("\n")).toContain("Bankable deployment is unsupported");
    expect(summary?.contradictedClaims.join("\n")).toContain("Commercial deployment ready is contradicted");
    expect(summary?.contradictedClaims.join("\n")).not.toMatch(/Source labels/i);
    expect(summary?.missingInputs.join("\n")).not.toContain("| Bankable deployment |");
  });
});
