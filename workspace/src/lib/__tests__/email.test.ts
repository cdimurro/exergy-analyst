import { welcomeFeatureBullets, welcomeIntroParagraph } from "../email";

const bannedOverclaim = /decision-grade|world'?s first|world-first|manufacturing-ready|bankable|deployment-ready/i;
const caveatMarker = /modeled|estimate|estimated|calibrated|pilot|validation|validation-pending|requires/i;

describe("welcome email wording", () => {
  it("does not use unsupported maturity or marketing overclaims", () => {
    expect(welcomeIntroParagraph()).not.toMatch(bannedOverclaim);
    for (const bullet of welcomeFeatureBullets()) {
      expect(bullet).not.toMatch(bannedOverclaim);
    }
  });

  it("caveats the assessment reports bullet", () => {
    const reportsBullet = welcomeFeatureBullets().find((bullet) =>
      /assessment report/i.test(bullet)
    );

    expect(reportsBullet).toBeDefined();
    expect(reportsBullet).toMatch(caveatMarker);
  });
});
