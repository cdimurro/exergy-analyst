// General physical-quantity reasoning shared across engineering solvers.
//
// The aim is breadth without per-case patches: encode a few domain-agnostic
// facts about physical quantities — their admissible range, how to aggregate
// them without letting one bad value corrupt the result, how to reconcile two
// independent estimates of the same thing, and when a value is implausible for
// its kind — and let every solver reason from those primitives. A new domain
// then inherits correct handling of impossible inputs, robust averages, and
// "report-don't-rationalize" cross-checks for free.

export type QuantityKind =
  | "absolute_temperature_c" // a real temperature in Celsius: must exceed absolute zero
  | "magnitude" // a non-negative extensive quantity: energy, mass, flow, area, power, count
  | "fraction" // a dimensionless ratio in [0, 1]
  | "percent"; // a ratio expressed in [0, 100]

export const ABSOLUTE_ZERO_C = -273.15;

export interface QuantityVerdict {
  /** The value is physically admissible for its kind. */
  physical: boolean;
  /** Plain reason when not physical; suitable for surfacing as a caveat. */
  reason?: string;
}

/** Decide whether a value is physically admissible for its kind. */
// Reasons are written as predicates that read naturally after the quantity's
// name, e.g. `Source temperature ${reason}` -> "Source temperature is at or
// below absolute zero...".
export function checkQuantity(kind: QuantityKind, value: number): QuantityVerdict {
  if (!Number.isFinite(value)) {
    return { physical: false, reason: "is missing or not a finite number" };
  }
  switch (kind) {
    case "absolute_temperature_c":
      return value > ABSOLUTE_ZERO_C
        ? { physical: true }
        : { physical: false, reason: "is at or below absolute zero, which is physically impossible" };
    case "magnitude":
      return value >= 0
        ? { physical: true }
        : { physical: false, reason: "is negative, which is not physical for an amount of energy, mass, or flow" };
    case "fraction":
      return value >= 0 && value <= 1
        ? { physical: true }
        : { physical: false, reason: "is outside the admissible 0 to 1 range" };
    case "percent":
      return value >= 0 && value <= 100
        ? { physical: true }
        : { physical: false, reason: "is outside the admissible 0 to 100 range" };
  }
}

/** Clamp a value into a closed interval. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Weighted mean that ignores non-finite values and non-positive weights, so a
 * single invalid contributor (a negative or garbage row) cannot corrupt an
 * intensive aggregate such as a delivery-weighted quality factor. Returns null
 * when nothing valid remains to average.
 */
export function robustWeightedMean(pairs: Array<{ weight: number; value: number }>): number | null {
  let weightSum = 0;
  let weighted = 0;
  for (const { weight, value } of pairs) {
    if (!Number.isFinite(weight) || !Number.isFinite(value) || weight <= 0) continue;
    weightSum += weight;
    weighted += weight * value;
  }
  return weightSum > 0 ? weighted / weightSum : null;
}

export interface Reconciliation {
  /** All estimates agree within tolerance. */
  agree: boolean;
  /** Ratio of the largest to the smallest estimate (>= 1), the size of the gap. */
  spread: number;
  min: number;
  max: number;
}

/**
 * Reconcile independent estimates of the same quantity. This is the basis for
 * "report, don't rationalize": when two ways of computing a value disagree by
 * more than the tolerated factor, the disagreement is a finding to surface, not
 * something to explain away with an assumed parameter. `tolerance` is a
 * multiplicative factor (e.g. 2 means a 2x gap is still considered agreement).
 */
export function reconcile(estimates: number[], tolerance = 2): Reconciliation {
  const valid = estimates.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length < 2) {
    const only = valid[0] ?? 0;
    return { agree: true, spread: 1, min: only, max: only };
  }
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const spread = min > 0 ? max / min : Infinity;
  return { agree: spread <= tolerance, spread, min, max };
}

/**
 * Flag a value that sits far outside the typical band for its kind/context —
 * frequently a unit error (e.g. Fahrenheit entered as Celsius). It deliberately
 * does not assert the correct value; it only marks the value as worth
 * confirming, so the caller can keep reasoning while flagging the doubt.
 */
export function outsideTypicalBand(value: number, low: number, high: number): boolean {
  return Number.isFinite(value) && (value < low || value > high);
}
