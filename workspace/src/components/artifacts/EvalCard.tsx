"use client";

/**
 * Inline evaluation result card — user-facing, not an internal scorecard.
 *
 * Shows contextual content based on what the evaluation actually found:
 * - If real findings exist: strengths, concerns, next steps, and "View Report"
 * - If minimal evidence: what data to provide (no "View Report" — nothing to view)
 * - If no brief at all: error state
 */

import { isBriefPayload } from "@/lib/brief-types";
import type { DeviceDecisionBrief } from "@/lib/brief-types";

interface EvalCardProps {
  artifact: Record<string, unknown>;
  onOpenCanvas?: (content: "brief") => void;
}

export function EvalCard({ artifact, onOpenCanvas }: EvalCardProps) {
  const content = artifact.content as Record<string, unknown> | undefined;
  const brief = content?.brief as DeviceDecisionBrief | null;
  const caveats = (content?.caveats as string[]) || [];

  if (!brief || !isBriefPayload(brief)) {
    // No brief — show what we can
    const error = (artifact.raw as Record<string, unknown>)?.error as string;
    return (
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
        <div className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">
          {error ? "Evaluation incomplete" : "Evaluation processing"}
        </div>
        <p className="text-[13px] text-[var(--text-secondary)]">
          {error || "The evaluation ran but did not produce a detailed brief. Try providing more specific parameters."}
        </p>
        {caveats.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {caveats.slice(0, 3).map((c, i) => (
              <li key={i} className="text-[12px] text-[var(--text-muted)]">- {c}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const briefAny = brief as unknown as Record<string, unknown>;
  const evidenceLevel = briefAny.evidence_level as string | undefined;
  const guidance = briefAny.module_unlock_guidance as Record<string, Record<string, unknown>> | undefined;
  const strengths = brief.key_strengths || [];
  const concerns = brief.key_concerns || [];
  const actions = brief.next_actions || [];

  // Determine if we have enough substance for a detailed report
  const hasSubstantiveFindings = strengths.length > 0 || concerns.length > 0 ||
    (brief.module_summary || []).some(m => m.verdict === "pass" || m.verdict === "fail" ||
      (m.key_detail && !m.key_detail.includes("No evidence")));

  // ── Minimal evidence: guidance only, no report button ──────────
  if (evidenceLevel === "minimal" && guidance && Object.keys(guidance).length > 0) {
    const blocked = Object.entries(guidance).filter(([, g]) => g.status === "blocked");

    return (
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <div className="text-[13px] font-semibold text-[var(--text-primary)]">Technology Identified</div>
          <p className="text-[12px] text-[var(--text-muted)] mt-1">
            We identified the technology domain but need more data for a full assessment. Here is what would help:
          </p>
        </div>
        <div className="px-4 py-3 space-y-1.5">
          {blocked.slice(0, 5).map(([name, g]) => {
            const params = (g.unlock_by_providing as string[]) || [];
            return (
              <div key={name} className="flex items-start gap-2 text-[12px]">
                <span className="text-[var(--text-dim)] shrink-0 mt-0.5">-</span>
                <div>
                  <span className="text-[var(--text-muted)] font-medium">{(g.description as string) || name}</span>
                  {params.length > 0 && (
                    <span className="text-[var(--text-dim)]"> — provide {params.slice(0, 3).join(", ")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── No real findings: tell user what to provide ────────────────
  if (!hasSubstantiveFindings) {
    return (
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <div className="text-[13px] font-semibold text-[var(--text-primary)]">Evaluation Ran</div>
          <p className="text-[12px] text-[var(--text-muted)] mt-1">
            The assessment completed but the available data was too limited to produce specific findings.
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[13px] text-[var(--text-secondary)]">
            To get a more useful assessment, provide specific technical parameters like efficiency, operating temperature, cost, capacity, or degradation rate. You can also upload a technical datasheet or research paper.
          </p>
          {actions.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-blue)] mb-1.5">Suggested Next Steps</div>
              <ol className="space-y-1">
                {actions.slice(0, 3).map((a, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-[var(--text-secondary)]">
                    <span className="text-[var(--accent-blue)] shrink-0 font-mono text-[11px]">{i + 1}.</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Substantive findings: show strengths/concerns + report button ──
  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">Assessment Complete</div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {strengths.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-green)] mb-1.5">Strengths</div>
            <ul className="space-y-1">
              {strengths.slice(0, 3).map((s, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                  <span className="text-[var(--accent-green)] shrink-0 mt-0.5 font-bold">+</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {concerns.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-amber)] mb-1.5">Concerns</div>
            <ul className="space-y-1">
              {concerns.slice(0, 3).map((c, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                  <span className="text-[var(--accent-amber)] shrink-0 mt-0.5 font-bold">!</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {actions.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-blue)] mb-1.5">Next Steps</div>
            <ol className="space-y-1">
              {actions.slice(0, 3).map((a, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                  <span className="text-[var(--accent-blue)] shrink-0 font-mono text-[11px] mt-0.5">{i + 1}.</span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Only show report button when there are real findings */}
      {onOpenCanvas && (
        <div className="px-4 py-2.5 border-t border-[var(--border)]">
          <button
            onClick={() => onOpenCanvas("brief")}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/20 transition-colors"
          >
            View Detailed Report
          </button>
        </div>
      )}
    </div>
  );
}
