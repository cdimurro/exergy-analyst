/**
 * Gate 5: Agent Claims Annotation — read-only analysis of agent text.
 *
 * Extracts number+unit pairs from narrative text and checks against physics rules.
 * Returns annotations as metadata — the content string is NEVER modified.
 *
 * Excludes: quoted text, hypotheticals, comparisons, cited sources.
 */

export interface ClaimAnnotation {
  start: number;
  end: number;
  original: string;
  rule_id: string;
  message: string;
}

export interface ClaimsResult {
  clean: boolean;
  annotations: ClaimAnnotation[];
}

// Patterns to extract number+unit pairs
const PERCENTAGE_RE = /(\d+(?:\.\d+)?)\s*%/g;
const TEMPERATURE_C_RE = /(-?\d+(?:\.\d+)?)\s*°C\b/g;
const TEMPERATURE_K_RE = /(-?\d+(?:\.\d+)?)\s*K\b/g;
const POWER_RE = /(-?\d+(?:\.\d+)?)\s*(?:kW|MW|GW|W)\b/g;
const ENERGY_DENSITY_RE = /(\d+(?:\.\d+)?)\s*Wh\/kg\b/g;
const CYCLE_LIFE_RE = /(-?\d+(?:\.\d+)?)\s*cycles?\b/g;

// Context patterns that indicate the number is NOT an authoritative claim
const EXCLUSION_CONTEXTS = [
  /["'][^"']*$/,                    // Inside quotes
  /compared\s+to\s+/i,             // Comparison context
  /\bvs\.?\s+/i,                   // "vs" comparison
  /relative\s+to\s+/i,             // Relative comparison
  /\b(?:could|would|might|if)\s+/i,// Hypothetical
  /\[\d+\]\s*$/,                   // After citation marker
  /baseline\s+(?:of\s+)?/i,        // Baseline reference
  /typical(?:ly)?\s+/i,            // "typically X%"
];

function isExcludedContext(text: string, matchIndex: number): boolean {
  // Check the 60 characters before the match for exclusion patterns
  const before = text.slice(Math.max(0, matchIndex - 60), matchIndex);
  return EXCLUSION_CONTEXTS.some(p => p.test(before));
}

export function annotateAgentClaims(content: string): ClaimsResult {
  if (!content || typeof content !== "string") return { clean: true, annotations: [] };

  const annotations: ClaimAnnotation[] = [];

  // Check percentages > 100%
  let match: RegExpExecArray | null;
  PERCENTAGE_RE.lastIndex = 0;
  while ((match = PERCENTAGE_RE.exec(content)) !== null) {
    const value = parseFloat(match[1]);
    if (value > 100 && !isExcludedContext(content, match.index)) {
      // Check if this is likely an efficiency claim (look for "efficiency" nearby)
      const context = content.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).toLowerCase();
      if (context.includes("efficiency") || context.includes("conversion") || context.includes("yield") || context.includes("recovery")) {
        annotations.push({
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          rule_id: "efficiency_cap",
          message: `${value}% exceeds physical limit of 100% for efficiency`,
        });
      }
    }
  }

  // Check temperatures below absolute zero (Celsius)
  TEMPERATURE_C_RE.lastIndex = 0;
  while ((match = TEMPERATURE_C_RE.exec(content)) !== null) {
    const value = parseFloat(match[1]);
    if (value < -273.15 && !isExcludedContext(content, match.index)) {
      annotations.push({
        start: match.index,
        end: match.index + match[0].length,
        original: match[0],
        rule_id: "absolute_zero_celsius",
        message: `${value}°C is below absolute zero (-273.15°C)`,
      });
    }
  }

  // Check temperatures below 0 K
  TEMPERATURE_K_RE.lastIndex = 0;
  while ((match = TEMPERATURE_K_RE.exec(content)) !== null) {
    const value = parseFloat(match[1]);
    if (value < 0 && !isExcludedContext(content, match.index)) {
      annotations.push({
        start: match.index,
        end: match.index + match[0].length,
        original: match[0],
        rule_id: "absolute_zero_kelvin",
        message: `${value} K is below absolute zero`,
      });
    }
  }

  // Check negative power output
  POWER_RE.lastIndex = 0;
  while ((match = POWER_RE.exec(content)) !== null) {
    const value = parseFloat(match[1]);
    if (value < 0 && !isExcludedContext(content, match.index)) {
      const context = content.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).toLowerCase();
      if (context.includes("output") || context.includes("generat") || context.includes("produc") || context.includes("capacity")) {
        annotations.push({
          start: match.index, end: match.index + match[0].length, original: match[0],
          rule_id: "negative_power",
          message: `Negative power output (${match[0]}) is physically impossible`,
        });
      }
    }
  }

  // Check impossible energy density (>600 Wh/kg is beyond any known chemistry)
  ENERGY_DENSITY_RE.lastIndex = 0;
  while ((match = ENERGY_DENSITY_RE.exec(content)) !== null) {
    const value = parseFloat(match[1]);
    if (value > 600 && !isExcludedContext(content, match.index)) {
      annotations.push({
        start: match.index, end: match.index + match[0].length, original: match[0],
        rule_id: "impossible_energy_density",
        message: `${value} Wh/kg exceeds any known battery chemistry (practical limit ~500 Wh/kg)`,
      });
    }
  }

  // Check negative cycle life
  CYCLE_LIFE_RE.lastIndex = 0;
  while ((match = CYCLE_LIFE_RE.exec(content)) !== null) {
    const value = parseFloat(match[1]);
    if (value < 0 && !isExcludedContext(content, match.index)) {
      annotations.push({
        start: match.index, end: match.index + match[0].length, original: match[0],
        rule_id: "negative_cycle_life",
        message: `Negative cycle life (${match[0]}) is physically impossible`,
      });
    }
  }

  return {
    clean: annotations.length === 0,
    annotations,
  };
}
