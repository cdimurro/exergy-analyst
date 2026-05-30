// @ts-nocheck
"use client";

/**
 * CollapsibleSection — expandable section wrapper for the assessment canvas.
 *
 * Shows section title with verdict indicator, confidence badge, and
 * expand/collapse toggle. Content renders only when expanded.
 */

import { useState } from "react";
import { verdictColor, SEMANTIC } from "@/lib/chart-theme";

interface CollapsibleSectionProps {
  title: string;
  /** Module verdict — drives muted verdict label text. */
  verdict?: string;
  /** Confidence level (0-1) — shown as percentage. */
  confidence?: number;
  /** Whether section starts expanded. */
  defaultOpen?: boolean;
  /** External control of open state. */
  isOpen?: boolean;
  /** Callback when open state changes. */
  onToggle?: (isOpen: boolean) => void;
  /** Optional subtitle text — shown in header below title. */
  subtitle?: string;
  /** Section number prefix (e.g. "01", "02"). Renders in muted tabular digits. */
  sectionNumber?: string;
  /** Content to render when expanded. */
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  verdict,
  confidence,
  defaultOpen = false,
  isOpen: controlledOpen,
  onToggle,
  subtitle,
  sectionNumber,
  children,
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? internalOpen;

  const handleToggle = () => {
    const next = !isOpen;
    setInternalOpen(next);
    onToggle?.(next);
  };

  const indicatorColor = verdict ? verdictColor(verdict) : SEMANTIC.neutral;

  return (
    <section
      id={`section-${title.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`}
      className="scroll-mt-6"
    >
      {/* Header — inline, no box, just a hairline top divider */}
      <button
        onClick={handleToggle}
        className="w-full py-5 flex items-center gap-3 border-t border-[var(--border)]/60 hover:bg-[var(--bg-hover)]/25 transition-colors text-left group"
      >
        {/* Chevron — subtle, trails at left */}
        <svg
          className={`w-3.5 h-3.5 text-[var(--text-dim)] transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 4 10 8 6 12" />
        </svg>

        {/* Section number (optional) */}
        {sectionNumber && (
          <span className="text-[12px] font-semibold text-[var(--text-dim)] tabular-nums tracking-[0.15em] shrink-0 w-5">
            {sectionNumber}
          </span>
        )}

        {/* Title — document-heading style, larger and tighter */}
        <span className="text-[20px] font-semibold text-[var(--text-primary)] flex-1 min-w-0 leading-snug tracking-[-0.015em]">
          {title}
        </span>

        {/* Verdict label */}
        {verdict && (
          <span
            className="text-[12px] font-semibold shrink-0 uppercase tracking-[0.14em]"
            style={{ color: indicatorColor }}
          >
            {verdict.replace(/_/g, " ")}
          </span>
        )}

        {/* Confidence */}
        {confidence != null && confidence > 0 && (
          <span className="text-[12px] text-[var(--text-dim)] tabular-nums shrink-0">
            {(confidence * 100).toFixed(0)}%
          </span>
        )}
      </button>

      {/* Subtitle */}
      {isOpen && subtitle && (
        <p className="text-[15px] text-[var(--text-dim)] leading-relaxed -mt-2 mb-4 pl-6">
          {subtitle}
        </p>
      )}

      {/* Content — flows directly, no box */}
      {isOpen && (
        <div className="pb-6 space-y-6">
          {children}
        </div>
      )}
    </section>
  );
}
