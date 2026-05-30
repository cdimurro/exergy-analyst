/**
 * Open Circuit Voltage (OCV) models per chemistry.
 *
 * Each function maps SOC (0–1) → voltage (V).
 * Piecewise-linear fits calibrated to published literature curves.
 * Used by the Tier 0 preview simulation engine only.
 */

import type { ChemistryKey } from "./chemistry-defaults";

/** LFP: flat plateau ~3.2V, steep at extremes. */
export function lfpOCV(soc: number): number {
  const s = Math.max(0, Math.min(1, soc));
  if (s < 0.05) return 2.50 + 6.0 * s;          // 2.50 → 2.80
  if (s < 0.12) return 2.80 + 3.57 * (s - 0.05); // 2.80 → 3.05
  if (s < 0.88) return 3.05 + 0.263 * (s - 0.12); // 3.05 → 3.25 (flat)
  if (s < 0.95) return 3.25 + 4.29 * (s - 0.88);  // 3.25 → 3.55
  return 3.55 + 2.0 * (s - 0.95);                  // 3.55 → 3.65
}

/** NMC (523/622/811): sigmoid from 3.0 to 4.2V. */
export function nmcOCV(soc: number): number {
  const s = Math.max(0, Math.min(1, soc));
  if (s < 0.03) return 3.00 + 5.0 * s;            // 3.00 → 3.15
  if (s < 0.10) return 3.15 + 4.29 * (s - 0.03);  // 3.15 → 3.45
  if (s < 0.30) return 3.45 + 1.50 * (s - 0.10);  // 3.45 → 3.75
  if (s < 0.80) return 3.75 + 0.50 * (s - 0.30);  // 3.75 → 4.00 (gradual)
  if (s < 0.95) return 4.00 + 1.00 * (s - 0.80);  // 4.00 → 4.15
  return 4.15 + 1.00 * (s - 0.95);                 // 4.15 → 4.20
}

/** LMO: distinct plateau around 4.0V, steeper drop. */
export function lmoOCV(soc: number): number {
  const s = Math.max(0, Math.min(1, soc));
  if (s < 0.05) return 3.00 + 6.0 * s;            // 3.00 → 3.30
  if (s < 0.15) return 3.30 + 4.0 * (s - 0.05);   // 3.30 → 3.70
  if (s < 0.50) return 3.70 + 0.86 * (s - 0.15);  // 3.70 → 4.00
  if (s < 0.85) return 4.00 + 0.29 * (s - 0.50);  // 4.00 → 4.10 (flat)
  if (s < 0.95) return 4.10 + 0.50 * (s - 0.85);  // 4.10 → 4.15
  return 4.15 + 1.00 * (s - 0.95);                 // 4.15 → 4.20
}

/** LTO: very flat ~2.3V, narrow voltage range. */
export function ltoOCV(soc: number): number {
  const s = Math.max(0, Math.min(1, soc));
  if (s < 0.05) return 1.50 + 14.0 * s;            // 1.50 → 2.20
  if (s < 0.10) return 2.20 + 2.0 * (s - 0.05);    // 2.20 → 2.30
  if (s < 0.90) return 2.30 + 0.0625 * (s - 0.10);  // 2.30 → 2.35 (very flat)
  if (s < 0.95) return 2.35 + 6.0 * (s - 0.90);     // 2.35 → 2.65
  return 2.65 + 3.0 * (s - 0.95);                    // 2.65 → 2.80
}

/** Dispatch OCV function by chemistry key. */
export function getOCVFunction(chemistry: ChemistryKey): (soc: number) => number {
  switch (chemistry) {
    case "lfp":    return lfpOCV;
    case "nmc":    return nmcOCV;
    case "nmc811": return nmcOCV;  // NMC-811 uses same OCV shape as NMC
    case "nca":    return nmcOCV;  // NCA similar to NMC
    case "lmo":    return lmoOCV;
    case "lto":    return ltoOCV;
    default:       return nmcOCV;  // fallback
  }
}
