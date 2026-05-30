/**
 * Format physics metric values for human-readable display.
 *
 * Converts raw SI units (Kelvin, Pascals, Watts) to conventional
 * engineering units (Celsius, MPa, MW/kW, bar).
 */

export function fmtVal(k: string, v: number): string {
  // Reactivity coefficients (must precede _k suffix check since pcm_per_k ends in _k)
  if (k.includes("pcm_per_k")) return `${v.toFixed(2)} pcm/K`;
  if (k === "reactivity_margin_pcm") return `${v.toFixed(0)} pcm`;

  // Temperature: any key ending in _k (except figure_of_merit_zt)
  if (k.endsWith("_k") && !k.includes("figure_of_merit")) return `${(v - 273.15).toFixed(0)} \u00B0C`;

  // Pressure: Pascals → MPa
  if (k.endsWith("_pa") && v > 1e5) return `${(v / 1e6).toFixed(2)} MPa`;
  if (k.endsWith("_pa")) return `${v.toFixed(0)} Pa`;

  // Power: Watts → MW or kW (net_power_w gets MWe suffix)
  if (k === "net_power_w") return `${(v / 1e6).toFixed(1)} MWe`;
  if (k === "gross_power_w") return `${(v / 1e6).toFixed(1)} MWt`;
  if (k.endsWith("_w") && Math.abs(v) > 1e6) return `${(v / 1e6).toFixed(1)} MW`;
  if (k.endsWith("_w") && Math.abs(v) > 1e3) return `${(v / 1e3).toFixed(1)} kW`;
  if (k.endsWith("_w")) return `${v.toFixed(1)} W`;

  // Pressure: bar suffix
  if (k.endsWith("_bar")) return `${v.toFixed(1)} bar`;

  // Exergy metrics (second-law analysis) — must precede generic efficiency check
  if (k === "exergetic_efficiency" || k === "first_law_efficiency" || k === "destruction_ratio") return `${(v * 100).toFixed(1)}%`;
  if (k === "quality_factor") return v.toFixed(3);
  if (k === "quality_gap") return `${(v * 100).toFixed(1)} pp`;
  if (k.includes("exergy") && k.endsWith("_Wh")) return `${v.toFixed(1)} Wh`;

  // Efficiency / fraction
  if (k.includes("efficiency") || k.includes("carnot")) return `${v.toFixed(1)}%`;
  if (k.includes("decay_heat_fraction")) return `${(v * 100).toFixed(2)}%`;

  // Linear heat rate
  if (k.includes("heat_rate")) return `${(v / 1000).toFixed(1)} kW/m`;

  // Specific named metrics
  if (k === "pressure_drop_kpa") return `${v.toFixed(1)} kPa`;
  if (k === "hot_channel_factor") return v.toFixed(2);

  // Default
  return v < 10 ? v.toFixed(3) : v.toFixed(1);
}
