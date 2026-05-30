"use client";

/**
 * Inline research finding summary card.
 */

import { useState } from "react";

interface ResearchCardProps {
  artifact: Record<string, unknown>;
}

export function ResearchCard({ artifact }: ResearchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const content = artifact.content as Record<string, unknown> | undefined;
  if (!content) return null;

  const summary = (content.executive_summary as string) || "";
  const findings = (content.findings as Array<Record<string, unknown>>) || [];
  const query = (content.query as string) || "";

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm">📚</span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            Research{query ? `: ${query.slice(0, 50)}${query.length > 50 ? "..." : ""}` : " Complete"}
          </span>
        </div>
        {summary && (
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{summary}</p>
        )}
      </div>

      {/* Findings */}
      {findings.length > 0 && (
        <div className="px-4 py-2.5">
          <div className="text-[11px] text-[var(--text-muted)] mb-2">
            {findings.length} finding{findings.length !== 1 ? "s" : ""}
          </div>
          {(expanded ? findings : findings.slice(0, 3)).map((f, i) => (
            <div key={i} className="py-1.5 border-b border-[var(--border)] last:border-b-0">
              <p className="text-[13px] text-[var(--text-secondary)]">{f.statement as string}</p>
              {f.source ? (
                <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{String(f.source)}</p>
              ) : null}
            </div>
          ))}
          {findings.length > 3 && (
            <button onClick={() => setExpanded(!expanded)}
              className="mt-2 text-[11px] text-[var(--accent-blue)] hover:underline">
              {expanded ? "Show less" : `Show all ${findings.length} findings`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
