import {
  SYSTEM_PROMPT,
  buildCall1Prompt,
  buildCall2Prompt,
  buildCall3Prompt,
  buildCall4Prompt,
} from "../generate-narratives";

const brief = {
  readiness_tier: "strong",
  evidence_strength: "strong",
  validation_valid: true,
  solver_surface_status: "confirmed",
  spec_compliance: { verdict: "pass" },
  module_summary: [],
  caveats: [],
} as any;

const ctx = {
  name: "Synthetic process",
  goal: "Assess readiness",
  domain: "industrial heat",
};

const prompts = [
  SYSTEM_PROMPT,
  buildCall1Prompt(brief, ctx),
  buildCall2Prompt(brief),
  buildCall3Prompt(brief),
  buildCall4Prompt(brief),
];

const bannedOverclaim = /investment-ready|investment ready|commercialization-ready|commercialization ready|proven economics|validated at scale|breakthrough|bankable|manufacturing-ready|manufacturing ready|decision-grade|deployment-ready/i;
const caveatMarker = /modeled|model-pending|validation-pending|pending|not yet validated|pilot validation/i;

describe("PDF narrative prompt overclaim guards", () => {
  it("does not emit banned maturity phrases in prompt builders", () => {
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(bannedOverclaim);
    }
  });

  it("covers buildCall1Prompt executive and technology-profile overclaims", () => {
    expect(buildCall1Prompt(brief, ctx)).not.toMatch(bannedOverclaim);
  });

  it("covers buildCall4Prompt integration and recommendations overclaims", () => {
    expect(buildCall4Prompt(brief)).not.toMatch(bannedOverclaim);
  });

  it("keeps economics and manufacturing instructions caveated", () => {
    const economics = buildCall2Prompt(brief);
    const manufacturing = buildCall3Prompt(brief);

    expect(economics).toMatch(caveatMarker);
    expect(manufacturing).toMatch(caveatMarker);
  });

  it("keeps the economics and manufacturing topics present", () => {
    expect(buildCall2Prompt(brief)).toMatch(/economic/i);
    expect(buildCall3Prompt(brief)).toMatch(/manufacturing/i);
  });
});
