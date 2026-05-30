/**
 * Full-detail view for a ``diligence_deep`` artifact (produced by the
 * Deep DD premium path in Batch C, CC-BE-RLM-0022).
 *
 * Renders the founder-facing brief: executive summary, categorized
 * findings with severity/confidence, cross-document contradictions,
 * risks, gaps, recommended next steps. Premium framing (badge, model
 * trajectory, cost display) makes the "this is a paid, multi-pass
 * analysis" signal visible without being obnoxious.
 *
 * This component is used only inside the expanded artifact/canvas view,
 * not as an injected chat card.
 */

"use client";

import { useMemo } from "react";

type DiligenceSeverity = "informational" | "notable" | "critical";
type DiligenceConfidence = "low" | "medium" | "high";

interface DiligenceFinding {
  claim: string;
  evidence?: string;
  source_doc?: string;
  section_path?: string;
  confidence?: DiligenceConfidence;
  severity?: DiligenceSeverity;
}

interface DiligenceContradiction {
  topic: string;
  positions?: Array<{ doc?: string; section_path?: string; claim?: string }>;
  analysis?: string;
}

interface DeepDiligenceContent {
  question?: string;
  executive_summary?: string;
  findings?: DiligenceFinding[];
  contradictions?: DiligenceContradiction[];
  risks?: string[];
  gaps?: string[];
  recommended_next_steps?: string[];
  source_docs?: Array<{ id: string; filename: string }>;
  n_docs?: number;
  n_sections?: number;
  n_leaf_calls?: number;
  n_synth_calls?: number;
  n_final_calls?: number;
  model_cost_usd?: number;
  fallback_used?: "budget_exceeded" | "depth_exceeded" | null;
  partial_at_stage?: string;
}

const SEVERITY_STYLES: Record<DiligenceSeverity, string> = {
  informational: "bg-slate-100 text-slate-700 border-slate-200",
  notable: "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border-[var(--accent-amber)]/30",
  critical: "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border-red-200",
};

const CONFIDENCE_STYLES: Record<DiligenceConfidence, string> = {
  low: "bg-slate-50 text-slate-600 border-slate-200",
  medium: "bg-sky-50 text-sky-700 border-sky-200",
  high: "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border-[var(--accent-green)]/30",
};

function Chip({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}
    >
      {label}
    </span>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </h3>
        {typeof count === "number" && count > 0 && (
          <span className="text-xs text-slate-500">({count})</span>
        )}
      </div>
      {children}
    </section>
  );
}

export function DeepDiligenceView({
  content,
}: {
  content: Record<string, unknown>;
}) {
  const c = content as DeepDiligenceContent;

  const {
    question,
    executive_summary,
    findings = [],
    contradictions = [],
    risks = [],
    gaps = [],
    recommended_next_steps = [],
    source_docs = [],
    n_docs,
    n_sections,
    n_leaf_calls,
    n_synth_calls,
    n_final_calls,
    model_cost_usd,
    fallback_used,
    partial_at_stage,
  } = c;

  // Group findings by severity (critical first) for the founder audience.
  const orderedFindings = useMemo(() => {
    const order: Record<DiligenceSeverity, number> = {
      critical: 0,
      notable: 1,
      informational: 2,
    };
    return [...findings].sort((a, b) => {
      const sa = order[a.severity ?? "informational"] ?? 2;
      const sb = order[b.severity ?? "informational"] ?? 2;
      return sa - sb;
    });
  }, [findings]);

  // Display helpers: show an em-dash when a count is genuinely missing
  // from the artifact (vs. a real zero) so operators can tell
  // "pipeline didn't report this" from "pipeline ran and produced zero".
  const fmtCount = (n: number | undefined): string =>
    typeof n === "number" ? n.toString() : "—";
  const hasAnyCallCount = [n_leaf_calls, n_synth_calls, n_final_calls].some(
    (v) => typeof v === "number",
  );
  const totalCallsDisplay = hasAnyCallCount
    ? ((n_leaf_calls ?? 0) + (n_synth_calls ?? 0) + (n_final_calls ?? 0)).toString()
    : "—";
  const isPartial = !!fallback_used;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Premium-framed header */}
      <header className="rounded-lg border border-[var(--accent-amber)]/30 bg-gradient-to-br from-amber-50 to-white p-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--accent-amber)]">
            Deep Due Diligence
          </h1>
          <span className="rounded-full bg-[var(--accent-amber)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent-amber)]">
            Premium
          </span>
          {isPartial && (
            <span className="rounded-full bg-[var(--accent-red)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent-red)]">
              Partial — {(fallback_used as string).replace(/_/g, " ")}
            </span>
          )}
        </div>
        {question && (
          <p className="mt-2 text-sm italic text-[var(--accent-amber)]">
            “{question}”
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--accent-amber)]">
          <span>
            <strong>{fmtCount(n_docs ?? (source_docs.length || undefined))}</strong> docs
          </span>
          <span>
            <strong>{fmtCount(n_sections)}</strong> sections
          </span>
          <span>
            <strong>{totalCallsDisplay}</strong> model calls
          </span>
          {typeof model_cost_usd === "number" && (
            <span>
              Spend: <strong>${model_cost_usd.toFixed(3)}</strong>
            </span>
          )}
          {isPartial && partial_at_stage && (
            <span>stopped at: <strong>{partial_at_stage}</strong></span>
          )}
        </div>
      </header>

      {executive_summary && (
        <Section title="Executive Summary">
          <p className="whitespace-pre-line rounded-md bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
            {executive_summary}
          </p>
        </Section>
      )}

      {orderedFindings.length > 0 && (
        <Section title="Findings" count={orderedFindings.length}>
          <ul className="space-y-3">
            {orderedFindings.map((f, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 bg-white p-4"
              >
                <div className="mb-2 flex flex-wrap gap-1">
                  {f.severity && (
                    <Chip
                      label={f.severity}
                      className={SEVERITY_STYLES[f.severity] ?? ""}
                    />
                  )}
                  {f.confidence && (
                    <Chip
                      label={`${f.confidence} confidence`}
                      className={CONFIDENCE_STYLES[f.confidence] ?? ""}
                    />
                  )}
                  {f.source_doc && (
                    <Chip
                      label={f.source_doc}
                      className="bg-white text-slate-600 border-slate-300"
                    />
                  )}
                </div>
                <p className="text-sm font-medium text-slate-900">{f.claim}</p>
                {f.evidence && (
                  <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs italic text-slate-600">
                    “{f.evidence}”
                  </blockquote>
                )}
                {f.section_path && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Source path: {f.section_path}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {contradictions.length > 0 && (
        <Section title="Cross-document contradictions" count={contradictions.length}>
          <ul className="space-y-3">
            {contradictions.map((co, i) => (
              <li
                key={i}
                className="rounded-md border border-red-200 bg-[var(--accent-red)]/10 p-4"
              >
                <p className="text-sm font-semibold text-[var(--accent-red)]">
                  {co.topic}
                </p>
                {co.positions && co.positions.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-[var(--accent-red)]">
                    {co.positions.map((p, j) => (
                      <li key={j}>
                        <strong>{p.doc || "(source)"}</strong>
                        {p.section_path ? ` · ${p.section_path}` : ""}: {p.claim || ""}
                      </li>
                    ))}
                  </ul>
                )}
                {co.analysis && (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--accent-red)]">
                    {co.analysis}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {risks.length > 0 && (
        <Section title="Risks" count={risks.length}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
            {risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {gaps.length > 0 && (
        <Section title="Open gaps" count={gaps.length}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </Section>
      )}

      {recommended_next_steps.length > 0 && (
        <Section title="Recommended next steps" count={recommended_next_steps.length}>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
            {recommended_next_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Section>
      )}

      {source_docs.length > 0 && (
        <Section title="Source documents" count={source_docs.length}>
          <ul className="space-y-1 text-xs text-slate-600">
            {source_docs.map((d) => (
              <li key={d.id}>
                <span className="font-mono">{d.filename}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export default DeepDiligenceView;
