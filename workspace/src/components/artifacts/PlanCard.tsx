"use client";

/**
 * Inline plan card with milestone tracking.
 * Replaces the old static pipeline bar.
 */

interface PlanStep {
  step: number;
  title: string;
  description: string;
  action_type: string;
  config: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
}

interface PlanCardProps {
  steps: PlanStep[];
  onRun?: () => void;
  onEdit?: () => void;
}

const STATUS_CONFIG = {
  pending: { dot: "bg-[var(--text-dim)]", text: "text-[var(--text-muted)]", label: "" },
  running: { dot: "bg-[var(--accent-blue)] animate-pulse", text: "text-[var(--accent-blue)]", label: "Running" },
  done: { dot: "bg-[var(--accent-green)]", text: "text-[var(--accent-green)]", label: "Done" },
  failed: { dot: "bg-[var(--accent-red)]", text: "text-[var(--accent-red)]", label: "Failed" },
};

export function PlanCard({ steps, onRun, onEdit }: PlanCardProps) {
  const allPending = steps.every(s => s.status === "pending");
  const allDone = steps.every(s => s.status === "done");
  const running = steps.some(s => s.status === "running");

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">{allDone ? "✅" : running ? "⏳" : "📋"}</span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {allDone ? "Plan Complete" : running ? "Executing Plan..." : "Execution Plan"}
          </span>
        </div>
        <span className="text-[11px] text-[var(--text-muted)]">{steps.length} steps</span>
      </div>

      {/* Steps */}
      <div className="divide-y divide-[var(--border)]">
        {steps.map(s => {
          const cfg = STATUS_CONFIG[s.status];
          return (
            <div key={s.step} className="px-4 py-2.5 flex items-start gap-3">
              <div className={`shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${cfg.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] font-medium ${s.status === "done" ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>
                    {s.title}
                  </span>
                  {cfg.label && (
                    <span className={`text-[10px] font-medium ${cfg.text}`}>{cfg.label}</span>
                  )}
                </div>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5 truncate">{s.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {allPending && (onRun || onEdit) && (
        <div className="px-4 py-2.5 border-t border-[var(--border)] flex gap-2">
          {onRun && (
            <button onClick={onRun}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-muted)] transition-colors">
              Run Plan
            </button>
          )}
          {onEdit && (
            <button onClick={onEdit}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border)] transition-colors">
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
