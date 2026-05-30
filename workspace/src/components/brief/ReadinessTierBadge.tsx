"use client";

/**
 * Readiness tier badge for Decision Brief header.
 */

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  deploy: {
    label: "Ready for Deployment",
    color: "var(--accent-green)",
    bg: "var(--accent-green)",
  },
  conditional: {
    label: "Conditional",
    color: "var(--accent-amber)",
    bg: "var(--accent-amber)",
  },
  caution: {
    label: "Significant Concerns",
    color: "var(--accent-red)",
    bg: "var(--accent-red)",
  },
  not_ready: {
    label: "Not Ready",
    color: "#991b1b",
    bg: "#991b1b",
  },
};

interface ReadinessTierBadgeProps {
  tier: string;
  large?: boolean;
}

export function ReadinessTierBadge({ tier, large }: ReadinessTierBadgeProps) {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.not_ready;

  if (large) {
    return (
      <div
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm"
        style={{ backgroundColor: `color-mix(in srgb, ${config.bg} 20%, transparent)`, color: config.color }}
      >
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        {config.label}
      </div>
    );
  }

  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${config.bg} 20%, transparent)`, color: config.color }}
    >
      {config.label}
    </span>
  );
}
