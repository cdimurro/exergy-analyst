import {
  firstPassYieldNarrativeTone,
  firstPassYieldRowNote,
} from "../AssessmentCanvas";
import fs from "fs";
import path from "path";

const bannedOverclaim = /manufacturing-ready|manufacturing ready|bankable|decision-grade|deployment-ready/i;
const modelMarker = /model|modeled|estimate|estimated/i;
const caveatMarker = /pending|unproven|validation|validated|pilot|not yet|requires/i;

function expectHighBandCaveated(text: string) {
  expect(text).not.toMatch(bannedOverclaim);
  expect(text).toMatch(modelMarker);
  expect(text).toMatch(caveatMarker);
}

describe("AssessmentCanvas first-pass-yield wording", () => {
  it("caveats high-band narrative tone without maturity overclaims", () => {
    expectHighBandCaveated(firstPassYieldNarrativeTone(92));
  });

  it("caveats high-band row note without maturity overclaims", () => {
    expectHighBandCaveated(firstPassYieldRowNote(92));
  });

  it("preserves developing-band wording", () => {
    expect(firstPassYieldNarrativeTone(70)).toBe("a developing");
    expect(firstPassYieldRowNote(70)).toBe("Developing — yield ramp is load-bearing");
  });

  it("preserves early-stage-band wording", () => {
    expect(firstPassYieldNarrativeTone(30)).toBe("an early-stage");
    expect(firstPassYieldRowNote(30)).toBe("Early-stage — expect significant learning");
  });

  it("keeps canvas generated copy free of bankability overclaims", () => {
    const source = fs.readFileSync(path.join(__dirname, "../AssessmentCanvas.tsx"), "utf8");
    expect(source).not.toMatch(/\bbankable\b|\bbankability\b/i);
  });

  it("keeps nature page marketing copy evidence-bounded", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../../app/nature/page.tsx"), "utf8");
    expect(source).not.toMatch(/decision-grade|deployment-ready|bankable|manufacturing-ready/i);
    expect(source).toContain("Evidence-Bounded Diligence");
  });
});
