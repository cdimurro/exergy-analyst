"use client";

/**
 * ScoreGauge — circular progress ring for composite scores.
 *
 * SVG-based with smooth fill animation on mount. Color transitions:
 *   Green (≥60) — technology looks promising
 *   Amber (30–59) — more evidence needed
 *   Red (<30) — significant concerns
 */

import { useEffect, useState } from "react";
import { scoreColor } from "@/lib/chart-theme";

interface ScoreGaugeProps {
  score: number;         // 0–100
  size?: number;         // px, default 140
  strokeWidth?: number;  // px, default 10
  label?: string;        // e.g. "Composite Score"
  animated?: boolean;    // default true
}

export function ScoreGauge({
  score,
  size = 140,
  strokeWidth = 10,
  label,
  animated = true,
}: ScoreGaugeProps) {
  const [mounted, setMounted] = useState(!animated);
  useEffect(() => {
    if (animated) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
  }, [animated]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = Math.max(0, Math.min(100, score));
  const offset = circumference - (normalizedScore / 100) * circumference;
  const color = scoreColor(normalizedScore);
  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
            strokeOpacity={0.25}
          />
          {/* Subtle glow track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth + 6}
            strokeOpacity={mounted ? 0.06 : 0}
            strokeDasharray={circumference}
            strokeDashoffset={mounted ? offset : circumference}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1.2s ease-out, stroke-opacity 0.8s ease" }}
          />
          {/* Progress ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={mounted ? offset : circumference}
            style={{
              transition: "stroke-dashoffset 1.2s ease-out, stroke 0.6s ease",
              filter: `drop-shadow(0 0 4px ${color}50)`,
            }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold leading-none"
            style={{ fontSize: size * 0.26, color }}
          >
            {Math.round(normalizedScore)}
          </span>
          <span
            className="text-[var(--text-dim)] leading-none mt-0.5"
            style={{ fontSize: size * 0.095 }}
          >
            / 100
          </span>
        </div>
      </div>
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-dim)]">
          {label}
        </span>
      )}
    </div>
  );
}
