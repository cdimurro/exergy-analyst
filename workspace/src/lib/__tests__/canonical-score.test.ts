/**
 * Canonical composite-score formatting (TypeScript) — CC-BE-0113b.
 *
 * Mirrors tests/test_breakthrough/test_score_canonical.py. Pins the
 * contract that `formatCompositeScore(score_0_100, context)` produces
 * consistent channel-specific strings from a 0-100 input, with defensive
 * clamping and exhaustive context handling.
 *
 * The X-energy Xe-100 report produced three divergent renders ("0.5/100"
 * / "53" / "0.534") from the same underlying score because the brief
 * schema stored 0-1 without documenting the scale. Post-0113b the
 * schema is 0-100 and every workspace consumer passes through this
 * helper — these tests are the regression lock.
 */

import { formatCompositeScore, type ScoreContext } from "@/lib/canonical-score";

describe("formatCompositeScore", () => {
  it("json: fixed two decimals", () => {
    expect(formatCompositeScore(53.417, "json")).toBe("53.42");
    expect(formatCompositeScore(0, "json")).toBe("0.00");
    expect(formatCompositeScore(100, "json")).toBe("100.00");
  });

  it("narrative: one decimal with /100 suffix", () => {
    expect(formatCompositeScore(53.417, "narrative")).toBe("53.4/100");
    expect(formatCompositeScore(0, "narrative")).toBe("0.0/100");
    expect(formatCompositeScore(100, "narrative")).toBe("100.0/100");
  });

  it("gauge: integer only, no decimals", () => {
    expect(formatCompositeScore(53.417, "gauge")).toBe("53");
    expect(formatCompositeScore(0, "gauge")).toBe("0");
    expect(formatCompositeScore(100, "gauge")).toBe("100");
    // Half-integer rounding matches Math.round (tie goes toward +∞).
    expect(formatCompositeScore(53.5, "gauge")).toBe("54");
  });

  it("inline: one decimal, no suffix", () => {
    expect(formatCompositeScore(53.417, "inline")).toBe("53.4");
    expect(formatCompositeScore(0, "inline")).toBe("0.0");
    expect(formatCompositeScore(100, "inline")).toBe("100.0");
  });

  it.each([
    ["json", "0.00"],
    ["narrative", "0.0/100"],
    ["gauge", "0"],
    ["inline", "0.0"],
  ] as const)(
    "negative input clamps to zero (%s)",
    (ctx, expected) => {
      expect(formatCompositeScore(-5, ctx)).toBe(expected);
    },
  );

  it.each([
    ["json", "100.00"],
    ["narrative", "100.0/100"],
    ["gauge", "100"],
    ["inline", "100.0"],
  ] as const)(
    "above-100 clamps to 100 (%s)",
    (ctx, expected) => {
      expect(formatCompositeScore(150, ctx)).toBe(expected);
    },
  );

  it.each([
    ["json", "0.00"],
    ["narrative", "0.0/100"],
    ["gauge", "0"],
    ["inline", "0.0"],
  ] as const)(
    "non-finite input (NaN / Infinity) is treated as zero (%s)",
    (ctx, expected) => {
      expect(formatCompositeScore(NaN, ctx)).toBe(expected);
      expect(formatCompositeScore(Infinity, ctx)).toBe(expected);
      expect(formatCompositeScore(-Infinity, ctx)).toBe(expected);
    },
  );

  it("unknown context throws", () => {
    expect(() =>
      formatCompositeScore(50, "percent" as unknown as ScoreContext),
    ).toThrow(/unknown score context/);
  });

  it("single score renders consistently across all channels", () => {
    // Pre-0113 divergence: the same 0.534 rendered as "0.5/100" /
    // "53" / "0.534". Post-0113b the input is 0-100 and all channels
    // present the same underlying number.
    const score = 53.42;
    expect(formatCompositeScore(score, "json")).toBe("53.42");
    expect(formatCompositeScore(score, "narrative")).toBe("53.4/100");
    expect(formatCompositeScore(score, "gauge")).toBe("53");
    expect(formatCompositeScore(score, "inline")).toBe("53.4");
    // No channel produces "0.53" or "0.5" — the pre-0113 failure mode.
  });

  it("types: ScoreContext union is exhaustive", () => {
    // Compile-time check the four context members are all valid.
    const contexts: ScoreContext[] = ["json", "narrative", "gauge", "inline"];
    for (const c of contexts) {
      expect(typeof formatCompositeScore(50, c)).toBe("string");
    }
  });
});
