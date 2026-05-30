import { readFileSync } from "node:fs";
import { join } from "node:path";

const reportDocumentSource = readFileSync(
  join(__dirname, "../ReportDocument.tsx"),
  "utf8",
);
const generateNarrativesSource = readFileSync(
  join(__dirname, "../generate-narratives.ts"),
  "utf8",
);

describe("ReportDocument copy truthfulness", () => {
  it("does not frame the assessment framework as bankability proof", () => {
    expect(reportDocumentSource).not.toMatch(/economics and bankability/i);
    expect(reportDocumentSource).toMatch(/economics and finance evidence/i);
  });

  it("does not label gated PDF tiers as deployment-ready", () => {
    expect(reportDocumentSource).not.toMatch(/Deployment Ready/i);
    expect(generateNarrativesSource).not.toMatch(/Deployment Ready/i);
    expect(reportDocumentSource).toMatch(/Deployment Candidate/i);
    expect(generateNarrativesSource).toMatch(/Deployment Candidate/i);
  });
});
