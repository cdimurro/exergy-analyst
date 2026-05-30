import {
  checkQuantity,
  clamp,
  outsideTypicalBand,
  reconcile,
  robustWeightedMean,
} from "@/lib/physical-reasoning";

describe("physical-reasoning core", () => {
  it("validates quantity domains", () => {
    expect(checkQuantity("absolute_temperature_c", 25).physical).toBe(true);
    expect(checkQuantity("absolute_temperature_c", -300).physical).toBe(false);
    expect(checkQuantity("magnitude", -5).physical).toBe(false);
    expect(checkQuantity("fraction", 1.5).physical).toBe(false);
    expect(checkQuantity("magnitude", Number.NaN).physical).toBe(false);
  });

  it("clamps and bands", () => {
    expect(clamp(1.7, 0, 1)).toBe(1);
    expect(clamp(-0.2, 0, 1)).toBe(0);
    expect(outsideTypicalBand(5000, -273.15, 3000)).toBe(true);
    expect(outsideTypicalBand(720, -273.15, 3000)).toBe(false);
  });

  it("robust weighted mean ignores invalid contributors", () => {
    expect(robustWeightedMean([{ weight: 1000, value: 0.5 }, { weight: -500, value: 0.99 }])).toBe(0.5);
    expect(robustWeightedMean([])).toBeNull();
  });

  it("reconcile flags large spread, tolerates small", () => {
    expect(reconcile([100, 105]).agree).toBe(true);
    const big = reconcile([100, 2000]);
    expect(big.agree).toBe(false);
    expect(big.spread).toBe(20);
  });
});
