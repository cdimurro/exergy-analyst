import { evaluateExpectedContext } from "@/lib/expected-context-evaluator";

describe("expected context evaluator", () => {
  it("accepts synonym coverage instead of keyword-only matching", () => {
    const checks = evaluateExpectedContext({
      answer: "All other assumptions were held constant while COP changed to 2.7.",
      expectedTerms: ["unchanged"],
      prompt: "Rerun the case with COP changed and all other inputs unchanged.",
    });

    expect(checks[0]).toMatchObject({ status: "covered" });
    expect(checks[0].reason).toMatch(/synonym/i);
  });

  it("downgrades irrelevant expected tokens that are absent from prompt and source", () => {
    const checks = evaluateExpectedContext({
      answer: "The answer focuses on grid hosting capacity.",
      expectedTerms: ["compressor"],
      prompt: "Assess EV depot interconnection.",
      sourceTexts: ["hosting capacity 5.5 MW"],
    });

    expect(checks[0]).toMatchObject({ status: "irrelevant" });
  });

  it("still flags real missing expected context", () => {
    const checks = evaluateExpectedContext({
      answer: "The memo covers load and demand charges.",
      expectedTerms: ["permits"],
      prompt: "Include permits and interconnection risks.",
      sourceTexts: ["wetland setback requires permit review"],
    });

    expect(checks[0]).toMatchObject({ status: "missing" });
    expect(checks[0].reason).toMatch(/relevant/i);
  });
});
