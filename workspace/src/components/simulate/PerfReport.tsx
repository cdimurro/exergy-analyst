"use client";

import type { PerformanceGrade } from "@/lib/battery-sim";

const GRADE_STYLES: Record<string, string> = {
  "A+": "bg-[var(--accent-green)]/20 text-[var(--accent-green)] border-[var(--accent-green)]/30",
  A: "bg-[var(--accent-green)]/15 text-[var(--accent-green)] border-[var(--accent-green)]/20",
  B: "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] border-[var(--accent-blue)]/20",
  C: "bg-[var(--accent-amber)]/15 text-[var(--accent-amber)] border-[var(--accent-amber)]/20",
  D: "bg-[var(--accent-red)]/15 text-[var(--accent-red)] border-[var(--accent-red)]/20",
  F: "bg-[var(--accent-red)]/25 text-[var(--accent-red)] border-[var(--accent-red)]/30",
};

interface Props {
  grades: PerformanceGrade[];
  overall: string;
}

export function PerfReport({ grades, overall }: Props) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Performance Report Card</h3>
        <div
          className={`px-4 py-2 rounded-lg text-lg font-black border ${GRADE_STYLES[overall] ?? GRADE_STYLES.C}`}
        >
          {overall}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {grades.map((g) => (
          <div
            key={g.category}
            className="rounded-lg border border-[var(--border)]/50 bg-[var(--bg-secondary)] p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {g.category}
                </div>
                <div className="text-sm font-medium mt-1">{g.metric}</div>
              </div>
              <div
                className={`px-2 py-1 rounded text-sm font-black border ${GRADE_STYLES[g.grade] ?? GRADE_STYLES.C}`}
              >
                {g.grade}
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold">
                {g.value}
                <span className="text-xs font-normal text-[var(--text-muted)] ml-1">
                  {g.unit}
                </span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                {g.benchmark}
              </div>
            </div>
            {/* Grade bar */}
            <div className="mt-2 h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  g.grade === "A+" || g.grade === "A"
                    ? "bg-[var(--accent-green)]"
                    : g.grade === "B"
                      ? "bg-[var(--accent-blue)]"
                      : g.grade === "C"
                        ? "bg-[var(--accent-amber)]"
                        : "bg-[var(--accent-red)]"
                }`}
                style={{
                  width: `${
                    g.grade === "A+"
                      ? 100
                      : g.grade === "A"
                        ? 85
                        : g.grade === "B"
                          ? 65
                          : g.grade === "C"
                            ? 45
                            : g.grade === "D"
                              ? 25
                              : 10
                  }%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
