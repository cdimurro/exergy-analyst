// @ts-nocheck
"use client";

/**
 * ResearchDetailView — Canvas component for expanded research artifacts.
 *
 * Shows all findings (not just first 3), competitive landscape,
 * identified gaps, and full citations with URLs.
 */

interface ResearchContent {
  executive_summary?: string;
  findings?: Array<{ statement: string; source?: string; evidence_strength?: string }>;
  competitive_landscape?: Array<{ approach: string; best_result?: string; maturity?: string; key_player?: string }>;
  identified_gaps?: string[];
  suggested_followups?: string[];
  query?: string;
  paper_count?: number;
}

const STRENGTH_COLORS: Record<string, string> = {
  strong: "var(--accent-green)",
  moderate: "var(--accent-blue)",
  weak: "var(--accent-amber)",
  limited: "var(--accent-amber)",
};

export function ResearchDetailView({ content }: { content: ResearchContent }) {
  if (!content) return null;

  const findings = content.findings || [];
  const landscape = content.competitive_landscape || [];
  const gaps = content.identified_gaps || [];
  const followups = content.suggested_followups || [];

  return (
    <div className="space-y-6">
      {/* Query context */}
      {content.query && (
        <div className="text-[11px] text-[var(--text-dim)]">
          Research query: {content.query}
          {content.paper_count !== undefined && ` | ${content.paper_count} sources reviewed`}
        </div>
      )}

      {/* Executive Summary */}
      {content.executive_summary && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">Executive Summary</h3>
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{content.executive_summary}</p>
        </div>
      )}

      {/* All Findings */}
      {findings.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">Findings</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">{findings.length}</span>
          </div>
          <div className="space-y-2">
            {findings.map((f, i) => {
              const strength = (f.evidence_strength || "").toLowerCase();
              const strengthColor = STRENGTH_COLORS[strength] || "var(--text-muted)";
              return (
                <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
                  <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{f.statement}</p>
                  <div className="flex items-center gap-3 mt-2">
                    {f.source && (
                      <span className="text-[10px] text-[var(--text-dim)]">{f.source}</span>
                    )}
                    {f.evidence_strength && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: `color-mix(in srgb, ${strengthColor} 12%, transparent)`, color: strengthColor }}>
                        {f.evidence_strength}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Competitive Landscape */}
      {landscape.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">Competitive Landscape</h3>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[var(--bg-elevated)]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Approach</th>
                    <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Best Result</th>
                    <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Maturity</th>
                    {landscape.some(l => l.key_player) && (
                      <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Key Player</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {landscape.map((l, i) => (
                    <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-3 py-2.5 text-[var(--text-primary)] font-medium">{l.approach}</td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{l.best_result || "-"}</td>
                      <td className="px-3 py-2.5 text-[var(--text-muted)]">{l.maturity || "-"}</td>
                      {landscape.some(l => l.key_player) && (
                        <td className="px-3 py-2.5 text-[var(--text-muted)]">{l.key_player || "-"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Identified Gaps */}
      {gaps.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">Research Gaps</h3>
          <ul className="space-y-1.5">
            {gaps.map((g, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                <span className="shrink-0 text-[var(--accent-amber)] mt-0.5">?</span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggested Follow-ups */}
      {followups.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">Suggested Follow-ups</h3>
          <ul className="space-y-1.5">
            {followups.map((f, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                <span className="shrink-0 text-[var(--accent-blue)] font-bold mt-0.5">{i + 1}.</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
