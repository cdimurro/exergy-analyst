"use client";

/**
 * TRLGauge — horizontal 9-segment Technology Readiness Level indicator.
 *
 * Segments colored by development phase:
 *   TRL 1–3 (purple): Research
 *   TRL 4–6 (amber):  Development
 *   TRL 7–9 (teal):   Deployment
 */

import { BRAND, SEMANTIC } from "@/lib/chart-theme";

interface TRLGaugeProps {
  level: number;    // 1–9
  className?: string;
}

const PHASES = [
  { range: [1, 3], label: "Research",    color: BRAND.purple },
  { range: [4, 6], label: "Development", color: BRAND.amber },
  { range: [7, 9], label: "Deployment",  color: BRAND.teal },
] as const;

function segmentStyle(
  index: number,
  currentLevel: number,
): { bg: string; opacity: number } {
  const segTRL = index + 1;
  if (segTRL > currentLevel) return { bg: SEMANTIC.neutral, opacity: 0.12 };
  const phase = PHASES.find((p) => segTRL >= p.range[0] && segTRL <= p.range[1]);
  const isActive = segTRL === currentLevel;
  return {
    bg: phase?.color || SEMANTIC.neutral,
    opacity: isActive ? 1 : 0.55,
  };
}

export function TRLGauge({ level, className = "" }: TRLGaugeProps) {
  const trl = Math.max(1, Math.min(9, Math.round(level)));

  return (
    <div className={className}>
      {/* Segments */}
      <div className="flex gap-[3px] relative pt-6">
        {Array.from({ length: 9 }, (_, i) => {
          const { bg, opacity } = segmentStyle(i, trl);
          const isActive = i + 1 === trl;
          return (
            <div key={i} className="flex-1 relative">
              <div
                className="h-3.5 rounded-sm transition-all duration-500"
                style={{
                  backgroundColor: bg,
                  opacity,
                  boxShadow: isActive ? `0 0 10px ${bg}40` : "none",
                }}
              />
              {/* Active marker */}
              {isActive && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: bg, color: "white" }}
                  >
                    TRL {trl}
                  </span>
                </div>
              )}
              {/* Segment number */}
              <span
                className="block text-center text-[7px] mt-1 font-mono"
                style={{ color: i + 1 <= trl ? bg : "var(--text-dim)", opacity: i + 1 <= trl ? 0.7 : 0.3 }}
              >
                {i + 1}
              </span>
            </div>
          );
        })}
      </div>

      {/* Phase labels */}
      <div className="flex mt-1">
        {PHASES.map((phase) => (
          <div key={phase.label} className="flex-1 text-center">
            <span
              className="text-[8px] uppercase tracking-wider font-medium"
              style={{
                color: trl >= phase.range[0] ? phase.color : "var(--text-dim)",
                opacity: trl >= phase.range[0] ? 0.7 : 0.35,
              }}
            >
              {phase.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
