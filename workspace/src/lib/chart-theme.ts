/**
 * Exergy Lab Chart Theme — unified visual identity for all data visualizations.
 *
 * Every chart, graph, and data display component imports from this file.
 * No component should hardcode chart colors, tooltip styles, or grid strokes.
 *
 * Brand: cool teal-blue primary, warm amber-red accents, designed for dark
 * backgrounds (#0b0e1a to #1a2038).
 */

// ── Brand Palette ────────────────────────────────────────────

/** Unified brand palette. Every semantic color in the app maps to one of
 * these — there are no alternate greens, reds, or golds. Mirrored in CSS
 * custom properties at src/app/globals.css (--accent-*). */
export const BRAND = {
  teal:   "#4db8a4",   // --accent-green — positive / pass / success
  blue:   "#5b8dd9",   // --accent-blue  — info / candidate
  purple: "#8878b8",   // --accent-purple
  amber:  "#e6a23c",   // --accent-amber — warning / conditional
  rose:   "#d4646a",   // --accent-red   — negative / fail / danger
  cyan:   "#45a5c2",   // --accent-cyan
  // Aliases for backward compatibility — map to the canonical palette so
  // series charts never introduce a second shade of green or red.
  sage:   "#4db8a4",   // alias → teal (was #8bb86e — caused two greens)
  coral:  "#d4646a",   // alias → rose (was #d4846a — caused two reds)
} as const;

/** Ordered series colors for multi-series charts. */
export const SERIES_COLORS = [
  BRAND.teal,
  BRAND.blue,
  BRAND.purple,
  BRAND.amber,
  BRAND.rose,
  BRAND.cyan,
  BRAND.sage,
  BRAND.coral,
];

// ── Semantic Colors ──────────────────────────────────────────

export const SEMANTIC = {
  positive: BRAND.teal,
  warning:  BRAND.amber,
  negative: BRAND.rose,
  neutral:  "#607590",
  info:     BRAND.blue,
} as const;

/** Score gauge color based on value (0–100). */
export function scoreColor(score: number): string {
  if (score >= 60) return BRAND.teal;
  if (score >= 30) return BRAND.amber;
  return BRAND.rose;
}

/** Verdict → color mapping. */
export function verdictColor(verdict: string): string {
  switch (verdict) {
    case "pass":        return BRAND.teal;
    case "fail":        return BRAND.rose;
    case "conditional": return BRAND.amber;
    case "blocked":     return SEMANTIC.neutral;
    default:            return SEMANTIC.neutral;
  }
}

// ── Chart Chrome ─────────────────────────────────────────────

export const CHART_GRID = {
  stroke: "rgba(42, 53, 85, 0.6)",
  strokeDasharray: "3 3",
} as const;

export const CHART_AXIS = {
  tick: { fill: "#607590", fontSize: 10 },
  label: { fill: "#4a5a70", fontSize: 10 },
} as const;

export const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "#1a2038",
    border: "1px solid #2a3558",
    borderRadius: "10px",
    fontSize: "11px",
    color: "#f2f4fa",
    padding: "8px 12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  },
} as const;

export const CHART_LEGEND = {
  wrapperStyle: { fontSize: 11, color: "#b8c4dc" },
} as const;

export const CHART_MARGIN = { top: 5, right: 20, bottom: 5, left: 10 } as const;

/** Standard chart heights by context. */
export const CHART_HEIGHT = {
  inline: 240,
  card: 280,
  canvas: 400,
} as const;

// ── Module Names ─────────────────────────────────────────────

export const MODULE_SHORT_NAMES: Record<string, string> = {
  "Physics & Causal Validity":    "Physics",
  "Performance & Durability":     "Performance",
  "Economics & Bankability":      "Economics",
  "Safety & Resilience":          "Safety",
  "Regulatory & Permitting":      "Regulatory",
  "Manufacturing & Supply Chain": "Manufacturing",
  "Environmental & Circularity":  "Environmental",
  "Scalability & Deployment":     "Scalability",
  "System Integration":           "Integration",
  "Novelty & Strategic Value":    "Strategic Value",
};

/** Module short names in canonical display order. */
export const MODULE_ORDER = [
  "Physics",
  "Performance",
  "Economics",
  "Safety",
  "Regulatory",
  "Manufacturing",
  "Environmental",
  "Scalability",
  "Integration",
  "Strategic Value",
];
