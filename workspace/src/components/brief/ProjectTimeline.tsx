"use client";

/**
 * ProjectTimeline — vertical timeline of project artifacts.
 *
 * Shows artifacts chronologically with type-specific icons, lineage
 * connections, and compact summaries. Supports selection state for
 * integration with the Canvas panel.
 */

import { BRAND, SEMANTIC } from "@/lib/chart-theme";

interface TimelineArtifact {
  id: string;
  type: string;
  title: string;
  summary?: string;
  created_at: string;
  source?: string;
  parent_id?: string;
  lineage_note?: string;
}

interface ProjectTimelineProps {
  artifacts: TimelineArtifact[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  className?: string;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  simulation:        { icon: "\u26A1", color: BRAND.teal,       label: "Simulation" },
  evaluation:        { icon: "\u25C9", color: BRAND.blue,       label: "Evaluation" },
  research:          { icon: "\u25C8", color: BRAND.purple,     label: "Research" },
  deep_analysis:     { icon: "\u25C6", color: BRAND.amber,      label: "Deep Analysis" },
  scientific_review: { icon: "\u25C7", color: BRAND.cyan,       label: "Scientific Review" },
  comparison:        { icon: "\u229E", color: BRAND.sage,       label: "Comparison" },
  report:            { icon: "\u25A3", color: SEMANTIC.neutral,  label: "Report" },
  document_extraction: { icon: "\u25A4", color: BRAND.coral,    label: "Document" },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000)   return "Just now";
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function ProjectTimeline({
  artifacts,
  onSelect,
  selectedId,
  className = "",
}: ProjectTimelineProps) {
  if (!artifacts?.length) return null;

  const sorted = [...artifacts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className={`space-y-0 ${className}`}>
      {sorted.map((artifact, i) => {
        const config = TYPE_CONFIG[artifact.type] || TYPE_CONFIG.report;
        const isSelected = artifact.id === selectedId;
        const isLast = i === sorted.length - 1;

        return (
          <div key={artifact.id} className="flex gap-3">
            {/* Timeline connector */}
            <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] shrink-0 transition-all"
                style={{
                  backgroundColor: isSelected
                    ? `color-mix(in srgb, ${config.color} 22%, transparent)`
                    : "var(--bg-elevated)",
                  border: `1.5px solid ${isSelected ? config.color : "var(--border)"}`,
                  boxShadow: isSelected ? `0 0 8px ${config.color}25` : "none",
                }}
              >
                <span style={{ color: config.color }}>{config.icon}</span>
              </div>
              {!isLast && (
                <div
                  className="w-px flex-1 min-h-[16px]"
                  style={{
                    backgroundColor: artifact.parent_id ? config.color : "var(--border)",
                    opacity: artifact.parent_id ? 0.35 : 0.2,
                  }}
                />
              )}
            </div>

            {/* Content */}
            <div
              className={`flex-1 pb-4 ${onSelect ? "cursor-pointer group" : ""}`}
              onClick={() => onSelect?.(artifact.id)}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-[9px] font-semibold uppercase tracking-wider"
                  style={{ color: config.color }}
                >
                  {config.label}
                </span>
                <span className="text-[9px] text-[var(--text-dim)]">
                  {formatTimestamp(artifact.created_at)}
                </span>
              </div>
              <p
                className={`text-[13px] font-medium leading-snug transition-colors ${
                  isSelected
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
                }`}
              >
                {artifact.title}
              </p>
              {artifact.summary && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2 leading-relaxed">
                  {artifact.summary}
                </p>
              )}
              {artifact.lineage_note && (
                <span className="inline-flex items-center gap-1 mt-1 text-[9px] text-[var(--text-dim)]">
                  <span style={{ color: config.color }}>&#x2191;</span>
                  {artifact.lineage_note}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
