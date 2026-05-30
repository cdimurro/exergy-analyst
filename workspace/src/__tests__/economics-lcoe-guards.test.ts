/**
 * CC-BE-FIX-0012: finance-math guards in EconomicsExplorer.computeLCOE.
 *
 * The discount factor `(1 + discount_rate)^y` collapses to zero at
 * discount_rate == -1 and goes negative below that. Without a guard,
 * the LCOE formula silently produces poisoned numbers (NaN, negative,
 * or unboundedly large) that downstream cost displays would render as
 * if they were valid results.
 *
 * These tests pin the guard behavior directly against the pure
 * `computeLCOE` function. Component-level tests for the surfaced
 * fetch-error posture in SensitivityTornado live separately because
 * @testing-library/react is not installed in this workspace; the
 * error-surfacing behavior there mirrors SimulationPlayground which
 * has been in production since prior commits.
 */

import { computeLCOE, MIN_DISCOUNT_RATE } from "../lib/economics";

const REALISTIC_PARAMS = {
  capex_per_kw: 800,
  opex_per_kw_year: 10,
  discount_rate: 0.08,
  lifetime_years: 25,
  capacity_factor: 0.20,
  degradation_rate: 0.005,
  electricity_price: 0.10,
  capacity_kw: 1000,
};

describe("computeLCOE discount_rate guard (CC-BE-FIX-0012)", () => {
  test("rejects discount_rate = -1 (divide-by-zero in discount factor)", () => {
    const result = computeLCOE({ ...REALISTIC_PARAMS, discount_rate: -1 });
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/discount_rate/);
    expect(result.lcoe).toBe(0);
    expect(result.annualCosts).toEqual([]);
  });

  test("rejects discount_rate below -1 (negative discount factor)", () => {
    const result = computeLCOE({ ...REALISTIC_PARAMS, discount_rate: -1.5 });
    expect(result.error).toBeDefined();
  });

  test("rejects NaN discount_rate", () => {
    const result = computeLCOE({ ...REALISTIC_PARAMS, discount_rate: NaN });
    expect(result.error).toBeDefined();
  });

  test("rejects Infinity discount_rate", () => {
    const result = computeLCOE({ ...REALISTIC_PARAMS, discount_rate: Infinity });
    expect(result.error).toBeDefined();
  });

  test("accepts discount_rate just above the minimum", () => {
    const result = computeLCOE({ ...REALISTIC_PARAMS, discount_rate: MIN_DISCOUNT_RATE + 0.1 });
    expect(result.error).toBeUndefined();
    expect(Number.isFinite(result.lcoe)).toBe(true);
  });

  test("accepts zero discount_rate (undiscounted cash flow)", () => {
    const result = computeLCOE({ ...REALISTIC_PARAMS, discount_rate: 0 });
    expect(result.error).toBeUndefined();
    expect(result.lcoe).toBeGreaterThan(0);
  });

  test("accepts realistic 8% discount rate and produces positive LCOE", () => {
    const result = computeLCOE(REALISTIC_PARAMS);
    expect(result.error).toBeUndefined();
    expect(result.lcoe).toBeGreaterThan(0);
    expect(result.lcoe).toBeLessThan(10); // LCOE in $/kWh, realistic range
    expect(result.annualCosts).toHaveLength(25);
  });

  test("totalCapex is calculated even when guard fires", () => {
    // Even in an error state, the caller may want to display the fixed
    // CAPEX (which doesn't depend on discount_rate). The error result
    // surfaces it rather than blanking the whole payload.
    const result = computeLCOE({ ...REALISTIC_PARAMS, discount_rate: -1 });
    expect(result.totalCapex).toBe(REALISTIC_PARAMS.capex_per_kw * REALISTIC_PARAMS.capacity_kw);
  });

  test("guard threshold surfaced as exported constant for UI reuse", () => {
    expect(typeof MIN_DISCOUNT_RATE).toBe("number");
    expect(MIN_DISCOUNT_RATE).toBeLessThan(0);
    expect(MIN_DISCOUNT_RATE).toBeGreaterThan(-1);
  });
});

describe("computeLCOE sanity invariants", () => {
  test("annualCosts length matches lifetime_years when valid", () => {
    for (const yrs of [5, 10, 25, 50]) {
      const r = computeLCOE({ ...REALISTIC_PARAMS, lifetime_years: yrs });
      expect(r.annualCosts).toHaveLength(yrs);
    }
  });

  test("NPV = totalRevenue - totalCapex - totalOpex (definition)", () => {
    const r = computeLCOE(REALISTIC_PARAMS);
    expect(r.npv).toBeCloseTo(r.totalRevenue - r.totalCapex - r.totalOpex, 6);
  });
});
