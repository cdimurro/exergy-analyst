"use client";

/**
 * Verdict badge for module assessment results.
 * Maps verdict string to color-coded badge using workspace design tokens.
 */

const VERDICT_STYLES: Record<string, string> = {
  pass: "bg-[var(--accent-green)]/20 text-[var(--accent-green)] border-[var(--accent-green)]/30",
  conditional: "bg-[var(--accent-amber)]/20 text-[var(--accent-amber)] border-[var(--accent-amber)]/30",
  fail: "bg-[var(--accent-red)]/20 text-[var(--accent-red)] border-[var(--accent-red)]/30",
  blocked: "bg-[var(--text-dim)]/10 text-[var(--text-dim)] border-[var(--text-dim)]/20",
  not_evaluated: "bg-[var(--text-dim)]/10 text-[var(--text-dim)] border-[var(--text-dim)]/20",
};

interface VerdictBadgeProps {
  verdict: string;
  compact?: boolean;
}

export function VerdictBadge({ verdict, compact }: VerdictBadgeProps) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.blocked;
  const label = verdict.replace("_", " ");

  if (compact) {
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${style}`}>
        {label}
      </span>
    );
  }

  return (
    <span className={`inline-block px-3 py-1 rounded-md text-sm font-semibold border ${style}`}>
      {label}
    </span>
  );
}
