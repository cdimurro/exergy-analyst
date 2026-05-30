/**
 * Unit tests for deep-diligence.ts — the Batch C premium pipeline.
 *
 * Uses a stubbed RLMRouter (via injectable backend) so tests are
 * hermetic and fast. Covers:
 *   - Sectioner: header-split, preamble, no-heading fallback
 *   - Pipeline: leaf → synth → final orchestration + final-brief shape
 *   - Cost estimation
 *   - Fallback to partial brief on BudgetExceededError
 */

import {
  estimateDeepDiligenceCost,
  runDeepDiligence,
  sectionDocument,
  type DiligenceDocInput,
} from "../deep-diligence";
import { RLMRouter, type BackendFn, type RLMRole } from "../rlm-router";

// ---------------------------------------------------------------------------
// Sectioner
// ---------------------------------------------------------------------------

test("sectionDocument: empty input produces one placeholder section", () => {
  const sections = sectionDocument("");
  expect(sections).toHaveLength(1);
  expect(sections[0].body).toBe("");
  expect(sections[0].heading).toBe("(empty)");
});

test("sectionDocument: no headings falls back to paragraph chunking", () => {
  const sections = sectionDocument("Some text without any headings at all.\n\nSecond para.");
  expect(sections).toHaveLength(1);
  expect(sections[0].heading).toBe("(no headings)");
  expect(sections[0].body).toContain("Some text");
});

test("sectionDocument: headings split + preserve hierarchy", () => {
  const md = [
    "# Top",
    "",
    "Top-level content with some bulk to survive any merging.",
    "",
    "## Details",
    "",
    "Detail section body long enough not to be merged.",
    "",
    "### Sub",
    "",
    "Sub-subsection content that the pipeline will treat as its own leaf.",
    "",
    "## Results",
    "",
    "Results section body with measured numbers.",
  ].join("\n");
  const sections = sectionDocument(md);
  const paths = sections.map((s) => s.headingPath.join(" > "));
  expect(paths).toEqual([
    "Top",
    "Top > Details",
    "Top > Details > Sub",
    "Top > Results",
  ]);
});

test("sectionDocument: preamble before first heading emitted as its own section", () => {
  const md = "Preamble paragraph with enough length.\n\n# First\n\nFirst body content here.";
  const sections = sectionDocument(md);
  expect(sections[0].heading).toBe("(preamble)");
  expect(sections[0].body).toContain("Preamble");
  expect(sections[1].heading).toBe("First");
});

test("sectionDocument: long section splits into parts", () => {
  const longBody = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ` + "x".repeat(500)).join("\n\n");
  const md = `# Big\n\n${longBody}`;
  const sections = sectionDocument(md, 2000);
  const big = sections.filter((s) => s.headingPath[0] === "Big");
  expect(big.length).toBeGreaterThan(1);
  // Each chunk labelled with part indicator
  expect(big[0].heading).toMatch(/Big \[part 1\//);
});

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

test("estimateDeepDiligenceCost grows with document count", () => {
  const oneDoc: DiligenceDocInput[] = [{ name: "a.pdf", text: "x".repeat(20_000) }];
  const twoDocs: DiligenceDocInput[] = [
    { name: "a.pdf", text: "x".repeat(20_000) },
    { name: "b.pdf", text: "x".repeat(20_000) },
  ];
  const c1 = estimateDeepDiligenceCost(oneDoc);
  const c2 = estimateDeepDiligenceCost(twoDocs);
  expect(c2).toBeGreaterThan(c1);
  expect(c1).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Pipeline — happy path
// ---------------------------------------------------------------------------

function makeScriptedBackend(): {
  backend: BackendFn;
  calls: Array<{ role: RLMRole; promptChars: number }>;
} {
  const calls: Array<{ role: RLMRole; promptChars: number }> = [];
  const backend: BackendFn = async (role, messages, _opts) => {
    const prompt = messages.map((m) => m.content).join("\n");
    calls.push({ role, promptChars: prompt.length });
    if (role === "leaf") {
      return JSON.stringify({
        claims: [
          {
            claim: "Temperature is 850 C",
            evidence: "Stack operates at 850 C",
            confidence: "high",
            severity: "notable",
          },
        ],
        risks: ["degradation risk"],
        open_questions: ["what is long-term degradation?"],
      });
    }
    if (role === "synth") {
      return JSON.stringify({
        doc_summary: "Doc summary.",
        findings: [
          {
            claim: "Temperature 850 C",
            evidence: "quote",
            section_path: "Operating Data",
            confidence: "high",
            severity: "notable",
          },
        ],
        internal_contradictions: [],
        risks: ["risk A"],
        open_questions: ["q A"],
      });
    }
    // final
    return JSON.stringify({
      executive_summary: "3-sentence summary of findings.",
      findings: [
        {
          claim: "Temperature 850 C",
          evidence: "quote",
          source_doc: "a.pdf",
          section_path: "Operating Data",
          confidence: "high",
          severity: "notable",
        },
      ],
      contradictions: [
        {
          topic: "Operating temperature",
          positions: [{ doc: "a.pdf", section_path: "x", claim: "850 C" }],
          analysis: "A vs B analysis",
        },
      ],
      risks: ["risk 1"],
      gaps: ["gap 1"],
      recommended_next_steps: ["step 1"],
    });
  };
  return { backend, calls };
}

test("runDeepDiligence: happy path exercises leaf → synth → final once each", async () => {
  const { backend, calls } = makeScriptedBackend();
  const router = new RLMRouter({ backend, maxUsdBudget: 100, maxDepth: 3 });
  const result = await runDeepDiligence(
    {
      question: "Is the plant at scale readiness?",
      docs: [{ name: "a.pdf", text: "# Operating Data\n\nStack operates at 850 C." }],
    },
    { router },
  );

  expect(result.fallback_used).toBeNull();
  expect(result.executive_summary).toContain("3-sentence");
  expect(result.findings).toHaveLength(1);
  expect(result.contradictions).toHaveLength(1);
  expect(result.recommended_next_steps).toEqual(["step 1"]);

  // One leaf per section + one synth per doc + one final
  const rolesCalled = calls.map((c) => c.role);
  expect(rolesCalled.filter((r) => r === "leaf").length).toBe(1);
  expect(rolesCalled.filter((r) => r === "synth").length).toBe(1);
  expect(rolesCalled.filter((r) => r === "final").length).toBe(1);

  expect(result.n_docs).toBe(1);
  expect(result.n_leaf_calls).toBe(1);
  expect(result.n_synth_calls).toBe(1);
  expect(result.n_final_calls).toBe(1);
  expect(result.model_cost_usd).toBeGreaterThan(0);
  expect(result.trajectory).toHaveLength(3);
});

test("runDeepDiligence: multiple docs → one synth per doc, one final total", async () => {
  const { backend, calls } = makeScriptedBackend();
  const router = new RLMRouter({ backend, maxUsdBudget: 100 });
  const result = await runDeepDiligence(
    {
      question: "Compare the plants",
      docs: [
        { name: "a.pdf", text: "# Section A\n\nContent A here." },
        { name: "b.pdf", text: "# Section B\n\nContent B here." },
      ],
    },
    { router },
  );
  expect(result.n_docs).toBe(2);
  const rolesCalled = calls.map((c) => c.role);
  expect(rolesCalled.filter((r) => r === "synth").length).toBe(2);
  expect(rolesCalled.filter((r) => r === "final").length).toBe(1);
  expect(result.fallback_used).toBeNull();
});

// ---------------------------------------------------------------------------
// Pipeline — budget fallback
// ---------------------------------------------------------------------------

test("runDeepDiligence: budget exceeded returns partial brief with fallback flag", async () => {
  const { backend } = makeScriptedBackend();
  // Tiny budget — first call will blow it
  const router = new RLMRouter({ backend, maxUsdBudget: 0.0000001 });
  const result = await runDeepDiligence(
    {
      question: "test",
      docs: [{ name: "a.pdf", text: "# A\n\nSome content." }],
    },
    { router },
  );
  expect(result.fallback_used).toBe("budget_exceeded");
  expect(result.executive_summary).toContain("Budget");
  // Partial results: may have aggregated findings from whatever stages completed
  expect(result.n_leaf_calls + result.n_synth_calls + result.n_final_calls).toBeGreaterThanOrEqual(0);
});

test("runDeepDiligence: final model's curation does not silently drop per-doc findings", async () => {
  // Leaf + synth both produce a finding. Final model returns a SHORTER
  // curated list. per_doc_findings must still carry the original.
  const synthFinding = {
    claim: "per-doc finding that final omits",
    evidence: "quote",
    section_path: "x",
    confidence: "medium" as const,
    severity: "notable" as const,
  };
  const finalFinding = {
    claim: "final's single curated finding",
    evidence: "quote2",
    source_doc: "a.pdf",
    section_path: "y",
    confidence: "high" as const,
    severity: "critical" as const,
  };
  const backend: BackendFn = async (role) => {
    if (role === "leaf") {
      return JSON.stringify({
        claims: [{ claim: "c", evidence: "e", confidence: "high", severity: "notable" }],
        risks: [], open_questions: [],
      });
    }
    if (role === "synth") {
      return JSON.stringify({
        findings: [synthFinding],
        internal_contradictions: [],
        risks: ["synth-risk"],
        open_questions: ["synth-gap"],
      });
    }
    return JSON.stringify({
      executive_summary: "summary",
      findings: [finalFinding],
      contradictions: [],
      risks: ["final-risk"],
      gaps: ["final-gap"],
      recommended_next_steps: ["next"],
    });
  };
  const router = new RLMRouter({ backend, maxUsdBudget: 100 });
  const result = await runDeepDiligence(
    { question: "q", docs: [{ name: "a.pdf", text: "# S\n\nBody." }] },
    { router },
  );
  // Curated findings come from final
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0].claim).toBe("final's single curated finding");
  // Per-doc findings preserved for audit — the synth-stage claim still present
  expect(result.per_doc_findings).toHaveLength(1);
  expect(result.per_doc_findings[0].claim).toBe("per-doc finding that final omits");
  // Per-doc risks/gaps also preserved
  expect(result.per_doc_risks).toContain("synth-risk");
  expect(result.per_doc_gaps).toContain("synth-gap");
});

test("runDeepDiligence: unparseable final JSON returns aggregated partial brief", async () => {
  const calls: Array<{ role: RLMRole }> = [];
  const backend: BackendFn = async (role, _messages, _opts) => {
    calls.push({ role });
    if (role === "leaf") {
      return JSON.stringify({
        claims: [{ claim: "X", evidence: "Y", confidence: "high", severity: "notable" }],
        risks: ["leaf risk"],
        open_questions: ["leaf q"],
      });
    }
    if (role === "synth") {
      return JSON.stringify({
        findings: [
          {
            claim: "synth claim",
            evidence: "synth quote",
            section_path: "x",
            confidence: "medium",
            severity: "notable",
          },
        ],
        internal_contradictions: [],
        risks: ["synth risk"],
        open_questions: ["synth q"],
      });
    }
    return "totally garbled not json output";
  };
  const router = new RLMRouter({ backend, maxUsdBudget: 100 });
  const result = await runDeepDiligence(
    {
      question: "q",
      docs: [{ name: "a.pdf", text: "# Section\n\nContent of section." }],
    },
    { router },
  );
  expect(result.fallback_used).toBeNull(); // no budget/depth error
  expect(result.executive_summary).toContain("no parseable output");
  // Aggregated partial findings preserved from per-doc synths
  expect(result.findings.length).toBeGreaterThan(0);
  expect(result.findings[0].source_doc).toBe("a.pdf");
});
