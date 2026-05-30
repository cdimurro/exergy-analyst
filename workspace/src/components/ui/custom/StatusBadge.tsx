"use client";

/**
 * StatusBadge — unified badge system for the Exergy Lab workspace.
 *
 * Replaces ad-hoc inline badge implementations across all view components
 * with a single consistent component.
 */

import { BRAND, SEMANTIC } from "@/lib/chart-theme";

// ── Types ────────────────────────────────────────────────────

type BadgeVariant =
  | "verdict"
  | "severity"
  | "impact"
  | "credibility"
  | "evidence"
  | "tier"
  | "custom";

type BadgeSize = "sm" | "md" | "lg";

interface StatusBadgeProps {
  variant: BadgeVariant;
  value: string;
  size?: BadgeSize;
  className?: string;
}

// ── Color Mappings ───────────────────────────────────────────

const VERDICT_CONFIG: Record<string, { label: string; color: string }> = {
  pass:          { label: "Strong",       color: BRAND.teal },
  fail:          { label: "Concern",      color: BRAND.rose },
  conditional:   { label: "Directional",  color: BRAND.amber },
  blocked:       { label: "Needs Data",   color: SEMANTIC.neutral },
  not_evaluated: { label: "Not Evaluated",color: SEMANTIC.neutral },
};

const SEVERITY_CONFIG: Record<string, { color: string }> = {
  critical:      { color: BRAND.rose },
  high:          { color: BRAND.rose },
  "medium-high": { color: BRAND.amber },
  medium:        { color: BRAND.amber },
  low:           { color: BRAND.teal },
};

const IMPACT_CONFIG: Record<string, { color: string }> = {
  high:          { color: BRAND.teal },
  "medium-high": { color: BRAND.cyan },
  medium:        { color: BRAND.blue },
  low:           { color: SEMANTIC.neutral },
};

const CREDIBILITY_CONFIG: Record<string, { label: string; color: string }> = {
  C3: { label: "Calibrated simulation",  color: BRAND.teal },
  C2: { label: "Provisional simulation", color: BRAND.blue },
  C1: { label: "Uncalibrated model",     color: BRAND.amber },
  C0: { label: "Baseline comparison",    color: SEMANTIC.neutral },
};

const EVIDENCE_CONFIG: Record<string, { color: string }> = {
  strong:   { color: BRAND.teal },
  moderate: { color: BRAND.blue },
  weak:     { color: BRAND.amber },
};

const TIER_CONFIG: Record<string, { label: string; color: string }> = {
  deploy:      { label: "Ready for Deployment", color: BRAND.teal },
  conditional: { label: "Needs More Evidence",  color: BRAND.amber },
  caution:     { label: "Significant Concerns",  color: BRAND.rose },
  not_ready:   { label: "Not Ready",             color: BRAND.rose },
};

// ── Size Config ──────────────────────────────────────────────

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "text-[9px] px-1.5 py-0.5",
  md: "text-[10px] px-2 py-0.5",
  lg: "text-[11px] px-3 py-1",
};

// ── Component ────────────────────────────────────────────────

function getConfig(variant: BadgeVariant, value: string): { label: string; color: string } {
  const v = value.toLowerCase().trim();
  switch (variant) {
    case "verdict":
      return VERDICT_CONFIG[v] || { label: value, color: SEMANTIC.neutral };
    case "severity":
      return { label: value, color: SEVERITY_CONFIG[v]?.color || SEMANTIC.neutral };
    case "impact":
      return { label: value, color: IMPACT_CONFIG[v]?.color || SEMANTIC.neutral };
    case "credibility":
      return CREDIBILITY_CONFIG[value] || { label: value, color: SEMANTIC.neutral };
    case "evidence":
      return { label: value, color: EVIDENCE_CONFIG[v]?.color || SEMANTIC.neutral };
    case "tier":
      return TIER_CONFIG[v] || { label: value, color: SEMANTIC.neutral };
    case "custom":
    default:
      return { label: value, color: SEMANTIC.neutral };
  }
}

export function StatusBadge({ variant, value, size = "md", className = "" }: StatusBadgeProps) {
  const { label, color } = getConfig(variant, value);

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold uppercase tracking-wider whitespace-nowrap ${SIZE_CLASSES[size]} ${className}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
      }}
    >
      {label}
    </span>
  );
}

/** Compact colored dot + optional label for inline use. */
export function StatusDot({ color, label, className = "" }: {
  color: string;
  label?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {label && <span className="text-[11px] text-[var(--text-muted)]">{label}</span>}
    </span>
  );
}
