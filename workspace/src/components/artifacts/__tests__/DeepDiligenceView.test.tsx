/**
 * @jest-environment jsdom
 *
 * Component tests for the Deep DD premium full-detail view.
 * Opts into jsdom via the directive above. Standard jest config
 * uses node; component tests mount React through RTL and need DOM.
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { DeepDiligenceView } from "../DeepDiligenceView";


function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    question: "Is the pathway bankable?",
    executive_summary: "Three-sentence summary of the findings.",
    findings: [
      {
        claim: "Yield claim exceeds literature",
        evidence: "Paper p.4 cites 78% — literature band is 55-65%",
        source_doc: "whitepaper.pdf",
        section_path: "Technology > Yield",
        severity: "critical",
        confidence: "high",
      },
      {
        claim: "CAPEX unspecified",
        evidence: "",
        source_doc: "website.txt",
        severity: "notable",
        confidence: "medium",
      },
    ],
    contradictions: [
      {
        topic: "Feedstock scale",
        positions: [
          { doc: "website.txt", section_path: "Scale", claim: "20 MTA planned" },
          { doc: "paper.pdf", section_path: "Scale", claim: "2 MTA demonstrated" },
        ],
        analysis: "Website claim is a roadmap target, not demonstrated.",
      },
    ],
    risks: ["Feedstock contamination risk under scale-up"],
    gaps: ["No published operating-hour data"],
    recommended_next_steps: ["Request unit-operation test logs"],
    source_docs: [
      { id: "d1", filename: "whitepaper.pdf" },
      { id: "d2", filename: "website.txt" },
    ],
    n_docs: 2,
    n_sections: 8,
    n_leaf_calls: 8,
    n_synth_calls: 2,
    n_final_calls: 1,
    model_cost_usd: 0.18,
    fallback_used: null as string | null,
    ...overrides,
  };
}


// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------


test("renders executive summary, question, and premium header", () => {
  render(<DeepDiligenceView content={makeContent()} />);
  expect(screen.getByText("Deep Due Diligence")).toBeInTheDocument();
  expect(screen.getByText("Premium")).toBeInTheDocument();
  expect(screen.getByText(/Is the pathway bankable/)).toBeInTheDocument();
  expect(screen.getByText(/Three-sentence summary/)).toBeInTheDocument();
});


test("renders findings sorted by severity (critical first)", () => {
  render(<DeepDiligenceView content={makeContent()} />);
  const claims = screen.getAllByText(/Yield claim exceeds literature|CAPEX unspecified/);
  expect(claims).toHaveLength(2);
  // Critical severity appears before notable in DOM order
  const allText = document.body.textContent || "";
  const criticalIdx = allText.indexOf("Yield claim exceeds literature");
  const notableIdx = allText.indexOf("CAPEX unspecified");
  expect(criticalIdx).toBeGreaterThan(-1);
  expect(notableIdx).toBeGreaterThan(-1);
  expect(criticalIdx).toBeLessThan(notableIdx);
});


test("renders contradictions section when contradictions present", () => {
  render(<DeepDiligenceView content={makeContent()} />);
  expect(screen.getByText(/Cross-document contradictions/i)).toBeInTheDocument();
  expect(screen.getByText("Feedstock scale")).toBeInTheDocument();
});


test("renders em-dash for missing counts instead of zero", () => {
  // Omit n_docs / n_sections / model call counts entirely.
  const bare = makeContent({
    n_docs: undefined,
    n_sections: undefined,
    n_leaf_calls: undefined,
    n_synth_calls: undefined,
    n_final_calls: undefined,
    source_docs: [],
  });
  render(<DeepDiligenceView content={bare} />);
  // At least two "—" should appear in the header (docs + sections + calls).
  const emDashes = screen.getAllByText("—", { exact: true });
  expect(emDashes.length).toBeGreaterThanOrEqual(2);
});


test("renders partial badge when fallback_used is set", () => {
  const partial = makeContent({ fallback_used: "budget_exceeded" });
  render(<DeepDiligenceView content={partial} />);
  expect(screen.getByText(/budget exceeded/i)).toBeInTheDocument();
});


test("safely handles empty content without crashing", () => {
  render(<DeepDiligenceView content={{}} />);
  expect(screen.getByText("Deep Due Diligence")).toBeInTheDocument();
});


test("renders recommended next steps as a numbered list", () => {
  render(<DeepDiligenceView content={makeContent()} />);
  expect(screen.getByText("Request unit-operation test logs")).toBeInTheDocument();
});
