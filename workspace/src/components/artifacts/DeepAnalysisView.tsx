// @ts-nocheck
"use client";

/**
 * DeepAnalysisView — Canvas component for deep_analysis artifacts.
 *
 * Renders structured analysis from DeepSeek V4-Pro with expandable sections
 * for findings, risks, opportunities, tradeoffs, and recommended actions.
 */

import { useState } from "react";
import { StatusBadge } from "@/components/ui/custom/StatusBadge";
import { BRAND, SEMANTIC } from "@/lib/chart-theme";

interface DeepAnalysisContent {
  key_findings?: Array<{ finding: string; support?: string }>;
  risks?: Array<{ risk: string; severity?: string; rationale?: string }>;
  opportunities?: Array<{ opportunity: string; potential_impact?: string; rationale?: string }>;
  tradeoffs?: Array<{ parameter_pair?: string; description?: string; optimization_insight?: string }>;
  confidence_assessment?: string;
  recommended_actions?: Array<{ action: string; priority?: string }>;
  reasoning_trace?: string;
}

function ExpandableCard({ title, badge, badgeVariant, children, defaultOpen = false }: {
  title: string; badge?: string; badgeVariant?: "severity" | "impact"; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
            <path d="M3 1l4 4-4 4" />
          </svg>
          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{title}</span>
        </div>
        {badge && <StatusBadge variant={badgeVariant || "severity"} value={badge} size="sm" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h3>
        {count !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function DeepAnalysisView({ content }: { content: DeepAnalysisContent }) {
  if (!content) return null;

  const findings = content.key_findings || [];
  const risks = content.risks || [];
  const opportunities = content.opportunities || [];
  const tradeoffs = content.tradeoffs || [];
  const actions = content.recommended_actions || [];

  return (
    <div className="space-y-6">
      {/* Confidence banner */}
      {content.confidence_assessment && (
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: `${BRAND.blue}20`, backgroundColor: `${BRAND.blue}08` }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: BRAND.blue }}>Confidence Assessment</span>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1 leading-relaxed">{content.confidence_assessment}</p>
        </div>
      )}

      {/* Key Findings — always expanded, plain text when no support detail */}
      {findings.length > 0 && (
        <Section title="Key Findings" count={findings.length}>
          <div className="space-y-2">
            {findings.map((f, i) => {
              const text = typeof f === "string" ? f : f.finding;
              const support = typeof f !== "string" ? f.support : undefined;
              if (!support) {
                // Plain text finding — render directly, no expand/collapse
                return (
                  <div key={i} className="flex gap-2.5 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                    <span className="shrink-0 mt-0.5 text-[11px]" style={{ color: BRAND.blue }}>{i + 1}.</span>
                    <span>{text}</span>
                  </div>
                );
              }
              return (
                <ExpandableCard key={i} title={text} defaultOpen={true}>
                  <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{support}</p>
                </ExpandableCard>
              );
            })}
          </div>
        </Section>
      )}

      {/* Risks */}
      {risks.length > 0 && (
        <Section title="Risks" count={risks.length}>
          <div className="space-y-2">
            {risks.map((r, i) => {
              const sev = (r.severity || "medium").toLowerCase();
              return (
                <ExpandableCard key={i} title={typeof r === "string" ? r : r.risk} badge={typeof r !== "string" ? (r.severity || "Medium") : undefined} badgeVariant="severity" defaultOpen={true}>
                  {typeof r !== "string" && r.rationale && <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{r.rationale}</p>}
                </ExpandableCard>
              );
            })}
          </div>
        </Section>
      )}

      {/* Opportunities */}
      {opportunities.length > 0 && (
        <Section title="Opportunities" count={opportunities.length}>
          <div className="space-y-2">
            {opportunities.map((o, i) => {
              const impact = (o.potential_impact || "medium").toLowerCase();
              return (
                <ExpandableCard key={i} title={typeof o === "string" ? o : o.opportunity} badge={typeof o !== "string" ? (o.potential_impact || "Medium") : undefined} badgeVariant="impact" defaultOpen={true}>
                  {typeof o !== "string" && o.rationale && <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{o.rationale}</p>}
                </ExpandableCard>
              );
            })}
          </div>
        </Section>
      )}

      {/* Tradeoffs */}
      {tradeoffs.length > 0 && (
        <Section title="Tradeoffs" count={tradeoffs.length}>
          <div className="space-y-2">
            {tradeoffs.map((t, i) => (
              <ExpandableCard key={i} title={typeof t === "string" ? t : (t.parameter_pair || `Tradeoff ${i + 1}`)} defaultOpen={true}>
                {t.description && <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-2">{t.description}</p>}
                {t.optimization_insight && (
                  <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2">
                    <span className="text-[10px] font-semibold text-[var(--accent-cyan)] uppercase">Optimization Insight</span>
                    <p className="text-[12px] text-[var(--text-secondary)] mt-1">{t.optimization_insight}</p>
                  </div>
                )}
              </ExpandableCard>
            ))}
          </div>
        </Section>
      )}

      {/* Recommended Actions */}
      {actions.length > 0 && (
        <Section title="Recommended Actions" count={actions.length}>
          <div className="space-y-1.5">
            {actions.map((a, i) => {
              const priority = (a.priority || "medium").toLowerCase();
              const priorityColor = priority === "high" ? BRAND.rose : priority === "medium" ? BRAND.amber : BRAND.teal;
              return (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-[var(--border)] last:border-b-0">
                  <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white mt-0.5"
                    style={{ backgroundColor: priorityColor }}>
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[13px] text-[var(--text-secondary)]">{a.action}</p>
                    {a.priority && <StatusBadge variant="severity" value={a.priority} size="sm" />}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
