// @ts-nocheck
"use client";

import { CollapsibleSection } from "@/components/canvas/CollapsibleSection";

export interface AgentActivityEntry {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "running" | "done" | "failed" | "info";
  actionType?: string;
  step?: number;
  timestamp: string;
  durationMs?: number;
  artifactTitle?: string;
}

interface PlanStepLike {
  step: number;
  title: string;
  description?: string;
  action_type?: string;
  status?: "pending" | "running" | "done" | "failed";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function durationLabel(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function statusColor(status: AgentActivityEntry["status"] | PlanStepLike["status"]): string {
  if (status === "done") return "var(--accent-green)";
  if (status === "running") return "var(--accent-blue)";
  if (status === "failed") return "var(--accent-red)";
  return "var(--text-dim)";
}

function statusLabel(status?: string): string {
  if (!status) return "Pending";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ActivityRow({ event }: { event: AgentActivityEntry }) {
  const duration = durationLabel(event.durationMs);
  return (
    <div className="flex gap-3 border-t border-[var(--border)]/45 py-3 first:border-t-0">
      <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusColor(event.status) }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[15px] font-medium leading-snug text-[var(--text-primary)]">{event.title}</p>
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-dim)]">
            {duration && <span className="tabular-nums">{duration}</span>}
            <span>{formatTime(event.timestamp)}</span>
          </div>
        </div>
        {event.detail && (
          <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-secondary)]">{event.detail}</p>
        )}
        {(event.actionType || event.artifactTitle) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {event.actionType && (
              <span className="rounded-md border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--text-muted)]">
                {event.actionType.replace(/_/g, " ")}
              </span>
            )}
            {event.artifactTitle && (
              <span className="rounded-md border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--text-muted)]">
                {event.artifactTitle}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanStepRow({ step }: { step: PlanStepLike }) {
  return (
    <div className="flex gap-4 border-t border-[var(--border)]/45 py-3 first:border-t-0">
      <span className="w-7 shrink-0 text-[12px] font-medium tabular-nums text-[var(--text-dim)]">
        {String(step.step).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[15px] font-medium leading-snug text-[var(--text-primary)]">{step.title}</p>
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: statusColor(step.status) }}>
            {statusLabel(step.status)}
          </span>
        </div>
        {step.description && (
          <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-secondary)]">{step.description}</p>
        )}
        {step.action_type && (
          <span className="mt-2 inline-flex rounded-md border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--text-muted)]">
            {step.action_type.replace(/_/g, " ")}
          </span>
        )}
      </div>
    </div>
  );
}

export function AgentThinkingPanel({
  events = [],
  plan = [],
  title = "Agent Process",
}: {
  events?: AgentActivityEntry[];
  plan?: PlanStepLike[];
  title?: string;
}) {
  const completed = events.filter((event) => event.status === "done").length;
  const failed = events.filter((event) => event.status === "failed").length;
  const running = events.find((event) => event.status === "running");
  const sortedEvents = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return (
    <div className="space-y-6">
      <header className="border-b border-[var(--border)]/60 pb-5">
        <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-[var(--text-dim)]">Process Log</p>
        <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)]">{title}</h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
          This panel shows the visible work plan, tool calls, file handling, calculations, and synthesis steps the agent used for this response.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--text-muted)]">
            {events.length} events
          </span>
          <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--text-muted)]">
            {completed} completed
          </span>
          {failed > 0 && (
            <span className="rounded-md border border-[var(--accent-red)]/40 px-2.5 py-1 text-[12px] text-[var(--accent-red)]">
              {failed} failed
            </span>
          )}
          {running && (
            <span className="rounded-md border border-[var(--accent-blue)]/40 px-2.5 py-1 text-[12px] text-[var(--accent-blue)]">
              Running: {running.title}
            </span>
          )}
        </div>
      </header>

      {plan.length > 0 && (
        <CollapsibleSection title="Execution Plan" sectionNumber="01" defaultOpen>
          <div>
            {plan.map((step) => <PlanStepRow key={`${step.step}-${step.title}`} step={step} />)}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Activity Timeline" sectionNumber={plan.length > 0 ? "02" : "01"} defaultOpen>
        {sortedEvents.length > 0 ? (
          <div>
            {sortedEvents.map((event) => <ActivityRow key={event.id} event={event} />)}
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
            No process events were recorded for this response.
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="How To Read This" sectionNumber={plan.length > 0 ? "03" : "02"}>
        <div className="space-y-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          <p>Running events show work currently underway. Completed events show tool calls or synthesis steps that finished and often include the resulting artifact title.</p>
          <p>When the agent cannot compute a value, the process log should show whether the missing piece was file extraction, missing numeric inputs, unavailable external data, or a calculation limit.</p>
        </div>
      </CollapsibleSection>
    </div>
  );
}
