// @ts-nocheck
"use client";

/**
 * ScientificReviewView — Canvas component for scientific_review artifacts.
 *
 * Renders parameter plausibility assessment with per-parameter review table,
 * overall assessment badge, concerns, and suggestions.
 */

interface ScientificReviewContent {
  plausibility_assessment?: string;
  parameter_reviews?: Array<{
    parameter?: string;
    claimed_value?: string | number;
    typical_range?: string;
    assessment?: string;
    reasoning?: string;
  }>;
  overall_confidence?: string;
  concerns?: string[];
  suggestions?: string[];
}

import { BRAND, SEMANTIC } from "@/lib/chart-theme";

const ASSESSMENT_STYLES: Record<string, { color: string; label: string }> = {
  plausible:    { color: BRAND.teal,  label: "Plausible" },
  reasonable:   { color: BRAND.teal,  label: "Plausible" },
  questionable: { color: BRAND.amber, label: "Questionable" },
  uncertain:    { color: BRAND.amber, label: "Uncertain" },
  implausible:  { color: BRAND.rose,  label: "Implausible" },
  unrealistic:  { color: BRAND.rose,  label: "Implausible" },
};

function getAssessmentStyle(assessment: string) {
  const key = assessment.toLowerCase().trim();
  for (const [k, v] of Object.entries(ASSESSMENT_STYLES)) {
    if (key.includes(k)) return v;
  }
  return { color: "var(--text-muted)", label: assessment };
}

export function ScientificReviewView({ content }: { content: ScientificReviewContent }) {
  if (!content) return null;

  const reviews = content.parameter_reviews || [];
  const overall = content.plausibility_assessment || "";
  const overallStyle = getAssessmentStyle(overall);

  return (
    <div className="space-y-6">
      {/* Overall Assessment Banner */}
      <div className="rounded-xl border px-5 py-4" style={{ borderColor: `color-mix(in srgb, ${overallStyle.color} 30%, transparent)` }}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Overall Plausibility</span>
            <h3 className="text-[18px] font-bold mt-1" style={{ color: overallStyle.color }}>
              {overallStyle.label}
            </h3>
          </div>
          {content.overall_confidence && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Confidence: {content.overall_confidence}
            </span>
          )}
        </div>
        {overall && overall.length > 30 && (
          <p className="text-[13px] text-[var(--text-secondary)] mt-2 leading-relaxed">{overall}</p>
        )}
      </div>

      {/* Parameter Review Table */}
      {reviews.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">Parameter Assessment</h3>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[var(--bg-elevated)]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Parameter</th>
                    <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Claimed</th>
                    <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Typical Range</th>
                    <th className="px-3 py-2.5 text-left text-[var(--text-primary)] font-semibold text-[10px] uppercase tracking-wider">Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r, i) => {
                    const style = getAssessmentStyle(r.assessment || "");
                    return (
                      <tr key={i} className="border-b border-[var(--border)] last:border-b-0 group">
                        <td className="px-3 py-2.5 text-[var(--text-primary)] font-medium">
                          {(r.parameter || "").replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)] font-mono text-[11px]">
                          {r.claimed_value ?? "-"}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-muted)] text-[11px]">
                          {r.typical_range || "-"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                            style={{ backgroundColor: `color-mix(in srgb, ${style.color} 12%, transparent)`, color: style.color }}>
                            {style.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Expandable reasoning for each parameter */}
            {reviews.some(r => r.reasoning) && (
              <div className="border-t border-[var(--border)] px-4 py-3 space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">Detailed Reasoning</span>
                {reviews.filter(r => r.reasoning).map((r, i) => (
                  <div key={i} className="py-1">
                    <span className="text-[11px] font-medium text-[var(--text-primary)]">{(r.parameter || "").replace(/_/g, " ")}:</span>
                    <span className="text-[11px] text-[var(--text-muted)] ml-1">{r.reasoning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Concerns */}
      {content.concerns && content.concerns.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">Concerns</h3>
          <ul className="space-y-1.5">
            {content.concerns.map((c, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                <span className="shrink-0 mt-0.5" style={{ color: BRAND.rose }}>!</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {content.suggestions && content.suggestions.length > 0 && (
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2">Suggestions</h3>
          <ul className="space-y-1.5">
            {content.suggestions.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                <span className="shrink-0 mt-0.5" style={{ color: BRAND.blue }}>-</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
