/**
 * @jest-environment jsdom
 *
 * CC-BE-UX-0033: regression tests against blank-state panels in BriefDetail.
 * Two panels previously rendered even when their backing data was absent:
 *   1. Key Findings grid — rendered a zero-card grid when `founder_insights`
 *      was present but every displayed value was an empty string.
 *   2. Technical Assessment card — rendered unconditionally, showing a zero
 *      score gauge and a bare "Evaluated 10 dimensions" line.
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { BriefDetail } from "../BriefDetail";


function makeBrief(overrides: Record<string, unknown> = {}): any {
  return {
    commercial_name: "Test Tech",
    readiness_tier: "conditional",
    headline: "Conditional assessment",
    evidence_level: "partial",
    composite_score: 0,
    module_summary: [],
    modules_passing: 0,
    modules_failing: 0,
    modules_blocked: 0,
    next_actions: [],
    ranked_gap_guidance: [],
    recommendations: [],
    baseline_comparisons: [],
    founder_insights: {},
    ...overrides,
  };
}


test("omits Key Findings grid when founder_insights fields are all empty strings", () => {
  const brief = makeBrief({
    founder_insights: {
      top_commercial_bottleneck: "",
      sellable_market: "",
      strongest_claim: "",
      weakest_claim: "",
    },
  });
  render(<BriefDetail brief={brief} />);
  expect(screen.queryByText("Top Bottleneck")).not.toBeInTheDocument();
  expect(screen.queryByText("Market Position")).not.toBeInTheDocument();
  expect(screen.queryByText("Strongest Signal")).not.toBeInTheDocument();
  expect(screen.queryByText("Weakest Signal")).not.toBeInTheDocument();
});


test("omits Technical Assessment card when composite score is 0 and module_summary is empty", () => {
  const brief = makeBrief({ composite_score: 0, module_summary: [] });
  render(<BriefDetail brief={brief} />);
  expect(screen.queryByText("Technical Assessment")).not.toBeInTheDocument();
});


test("renders Key Findings when at least one founder_insights field has content", () => {
  const brief = makeBrief({
    founder_insights: {
      top_commercial_bottleneck: "Durability data gap at cycle 500",
      sellable_market: "",
      strongest_claim: "",
      weakest_claim: "",
    },
  });
  render(<BriefDetail brief={brief} />);
  expect(screen.getByText("Top Bottleneck")).toBeInTheDocument();
  expect(screen.getByText(/Durability data gap/)).toBeInTheDocument();
});


test("renders Technical Assessment when module_summary is populated even if composite score is 0", () => {
  const brief = makeBrief({
    composite_score: 0,
    module_summary: [
      { module_id: "physics", module_name: "Physics", verdict: "pass", key_detail: "ok", score: 0.8 },
    ],
  });
  render(<BriefDetail brief={brief} />);
  expect(screen.getByText("Technical Assessment")).toBeInTheDocument();
});


test("renders Technical Assessment when composite score is positive", () => {
  const brief = makeBrief({ composite_score: 0.72, module_summary: [] });
  render(<BriefDetail brief={brief} />);
  expect(screen.getByText("Technical Assessment")).toBeInTheDocument();
});


test("renders Source Evidence and first headline fact for facts_extracted digest", () => {
  render(
    <BriefDetail
      brief={makeBrief()}
      evidenceDigest={{
        digest_status: "facts_extracted",
        headline_facts: ["electric power mwe: 80 MWe"],
        confidence_tier_summary: { preliminary: 1 },
        actionable_caveats: [],
      }}
    />,
  );
  expect(screen.getByText("Source Evidence")).toBeInTheDocument();
  expect(screen.getByText("electric power mwe: 80 MWe")).toBeInTheDocument();
  expect(screen.queryByText(/Confidence:/)).not.toBeInTheDocument();
});


test("does not render Source Evidence when evidenceDigest is undefined", () => {
  render(<BriefDetail brief={makeBrief()} />);
  expect(screen.queryByText("Source Evidence")).not.toBeInTheDocument();
});


test("does not render Source Evidence for no_extracted_facts digest", () => {
  render(
    <BriefDetail
      brief={makeBrief()}
      evidenceDigest={{
        digest_status: "no_extracted_facts",
        actionable_caveats: [{ severity: "blocker", message: "No facts", suggested_action: "Upload a datasheet" }],
      }}
    />,
  );
  expect(screen.queryByText("Source Evidence")).not.toBeInTheDocument();
});


test("renders suggested action from warning caveat for partial extraction digest", () => {
  render(
    <BriefDetail
      brief={makeBrief()}
      evidenceDigest={{
        digest_status: "partial_extraction",
        headline_facts: ["factory fabrication claimed"],
        confidence_tier_summary: { moderate: 1 },
        actionable_caveats: [
          { severity: "warning", message: "Claims need corroboration.", suggested_action: "Upload independent test data." },
        ],
      }}
    />,
  );
  expect(screen.getByText(/Upload independent test data/)).toBeInTheDocument();
});


test("sanitizes internal model names in Source Evidence headline facts", () => {
  render(
    <BriefDetail
      brief={makeBrief()}
      evidenceDigest={{
        digest_status: "facts_extracted",
        headline_facts: ["deepseek extracted a reactor claim"],
        confidence_tier_summary: { moderate: 1 },
        actionable_caveats: [],
      }}
    />,
  );
  expect(screen.getByText("analysis engine extracted a reactor claim")).toBeInTheDocument();
  expect(screen.queryByText(/deepseek/i)).not.toBeInTheDocument();
});
