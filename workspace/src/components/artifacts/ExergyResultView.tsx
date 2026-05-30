// @ts-nocheck
"use client";

import { BRAND } from "@/lib/chart-theme";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { sanitizeUserFacingAgentText } from "@/lib/agent-output";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clean(value: unknown): string {
  return sanitizeUserFacingAgentText(String(value || ""));
}

function MetricCard({ metric }: { metric: Record<string, unknown> }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/45 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">
        {clean(metric.label || "Metric")}
      </div>
      <div className="mt-1 text-[22px] font-semibold text-[var(--text-primary)] tabular-nums">
        {String(metric.value || "-")}
      </div>
      {metric.note && (
        <div className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {clean(metric.note)}
        </div>
      )}
    </div>
  );
}

function EvidenceRow({ item, index }: { item: Record<string, unknown>; index: number }) {
  const support = clean(String(item.support || "computed").replace(/_/g, " "));
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">
            {index + 1}. {clean(item.claim || item.title || "Finding")}
          </div>
          {item.evidence && (
            <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] leading-relaxed">
              {clean(item.evidence)}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: BRAND.teal, backgroundColor: `${BRAND.teal}18` }}>
          {support}
        </span>
      </div>
      {item.recommendation && (
        <p className="mt-2 text-[13px] text-[var(--text-muted)] leading-relaxed">
          Next: {clean(item.recommendation)}
        </p>
      )}
    </div>
  );
}

function DataRequestRow({ item, index }: { item: Record<string, unknown>; index: number }) {
  return (
    <div className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
        style={{ backgroundColor: BRAND.blue }}>
        {index + 1}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">
          {clean(item.kind || "Data request")}
        </div>
        <p className="mt-1 text-[14px] text-[var(--text-primary)] leading-relaxed">
          {clean(item.request || item)}
        </p>
        {item.why_it_matters && (
          <p className="mt-1 text-[13px] text-[var(--text-muted)] leading-relaxed">
            Why it matters: {clean(item.why_it_matters)}
          </p>
        )}
      </div>
    </div>
  );
}

function ActionRow({ item, index }: { item: Record<string, unknown>; index: number }) {
  return (
    <div className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
        style={{ backgroundColor: BRAND.teal }}>
        {index + 1}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">
          {clean(item.kind || "Recommended action")}
        </div>
        <p className="mt-1 text-[14px] text-[var(--text-primary)] leading-relaxed">
          {clean(item.action || item)}
        </p>
        {item.why_it_matters && (
          <p className="mt-1 text-[13px] text-[var(--text-muted)] leading-relaxed">
            Why it matters: {clean(item.why_it_matters)}
          </p>
        )}
      </div>
    </div>
  );
}

function PriorityRecommendation({ item }: { item: Record<string, unknown> }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-5 py-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-dim)] font-medium">
        If You Fund One Follow-Up
      </div>
      <h3 className="mt-2 text-[18px] font-semibold text-[var(--text-primary)] leading-snug">
        {clean(item.title || "Validate the highest-impact opportunity first")}
      </h3>
      {item.rationale && (
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">
          {clean(item.rationale)}
        </p>
      )}
      {item.evidence_needed && (
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Evidence needed: {clean(item.evidence_needed)}
        </p>
      )}
    </section>
  );
}

export function ExergyResultView({ content }: { content: Record<string, unknown> }) {
  const summary = isRecord(content.client_summary) ? content.client_summary : {};
  const metrics = list(summary.computed_metrics);
  const supported = list(summary.supported_claims);
  const notProven = list(summary.not_proven).filter((item) => typeof item === "string");
  const recommendedActions = list(summary.recommended_actions);
  const dataRequests = list(summary.data_requests);
  const priorityRecommendation = isRecord(summary.priority_recommendation) ? summary.priority_recommendation : null;
  const reviewedFiles = list(summary.reviewed_files);
  const trace = list(summary.analysis_trace);
  const memo = String(content.memo_markdown || "");

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-5 py-4">
        <h2 className="text-[24px] font-semibold tracking-tight text-[var(--text-primary)] leading-tight">
          {clean(summary.decision || "Analysis complete")}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          {clean(summary.conclusion || content.executive_summary || "The analysis completed, but no conclusion was supplied.")}
        </p>
        {summary.client_warning && (
          <p className="mt-3 border-l-2 pl-3 text-[13px] leading-relaxed text-[var(--text-muted)]"
            style={{ borderColor: BRAND.amber }}>
            {clean(summary.client_warning)}
          </p>
        )}
      </section>

      {metrics.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">Computed Results</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {metrics.map((metric, index) => (
              <MetricCard key={index} metric={isRecord(metric) ? metric : { label: "Metric", value: String(metric) }} />
            ))}
          </div>
        </section>
      )}

      {supported.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">Findings</h3>
          <div className="space-y-2">
            {supported.map((item, index) => (
              <EvidenceRow key={index} item={isRecord(item) ? item : { claim: String(item) }} index={index} />
            ))}
          </div>
        </section>
      )}

      {notProven.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">Open Items</h3>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
            <ul className="space-y-2">
              {notProven.map((item, index) => (
                <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: BRAND.amber }} />
                  <span>{clean(item)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {priorityRecommendation && (
        <PriorityRecommendation item={priorityRecommendation} />
      )}

      {recommendedActions.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">Next Steps</h3>
          <div className="space-y-2">
            {recommendedActions.slice(0, 5).map((item, index) => (
              <ActionRow key={index} item={isRecord(item) ? item : { action: String(item) }} index={index} />
            ))}
          </div>
        </section>
      )}

      {dataRequests.length > 0 && (
        <section>
          <h3 className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">Helpful Data</h3>
          <div className="space-y-2">
            {dataRequests.slice(0, 5).map((item, index) => (
              <DataRequestRow key={index} item={isRecord(item) ? item : { request: String(item) }} index={index} />
            ))}
          </div>
        </section>
      )}

      {(reviewedFiles.length > 0 || trace.length > 0) && (
        <section className="grid gap-3 md:grid-cols-2">
          {reviewedFiles.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Files Reviewed</h3>
              <div className="mt-2 space-y-2">
                {reviewedFiles.map((file, index) => (
                  <div key={index} className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                    <span className="text-[var(--text-secondary)]">{String(file.filename || "file")}</span>
                    {file.parser_status ? ` - ${String(file.parser_status)}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          {trace.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Processing Trace</h3>
              <div className="mt-2 space-y-2">
                {trace.map((stage, index) => (
                  <div key={index} className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                    <span className="text-[var(--text-secondary)]">{String(stage.name || `Stage ${index + 1}`)}</span>
                    {stage.summary ? ` - ${String(stage.summary)}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {memo && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-5 py-4">
          <h3 className="mb-3 text-[14px] font-semibold text-[var(--text-primary)]">Full Memo</h3>
          <MarkdownRenderer content={memo} />
        </section>
      )}
    </div>
  );
}
