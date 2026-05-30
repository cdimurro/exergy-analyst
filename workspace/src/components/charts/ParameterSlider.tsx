// @ts-nocheck
"use client";

/**
 * ParameterSlider — interactive parameter adjustment for what-if exploration.
 *
 * Renders a slider with current value display and range labels.
 * Calls onChange on every adjustment so parent charts update in real time.
 * Clean, minimal design — no colored badges.
 */

import { useState, useCallback } from "react";

interface ParameterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

export function ParameterSlider({
  label, value, min, max, step = 1, unit = "", onChange,
}: ParameterSliderProps) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-[12px] text-[var(--text-secondary)] w-40 shrink-0 truncate">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #3d9e8c ${((value - min) / (max - min)) * 100}%, #2a3555 ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
      <span className="text-[12px] font-mono text-[var(--text-primary)] w-20 text-right tabular-nums">
        {typeof value === "number" ? (value % 1 === 0 ? value : value.toFixed(1)) : value}{unit && ` ${unit}`}
      </span>
    </div>
  );
}

/**
 * InteractiveScenario — wraps multiple sliders with a live-updating chart.
 *
 * Accepts a set of adjustable parameters and a render function for the chart.
 * Parent provides the initial values and the chart rendering logic.
 */

interface AdjustableParam {
  key: string;
  label: string;
  initial: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

interface InteractiveScenarioProps {
  title: string;
  params: AdjustableParam[];
  renderChart: (values: Record<string, number>) => React.ReactNode;
}

export function InteractiveScenario({ title, params, renderChart }: InteractiveScenarioProps) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of params) init[p.key] = p.initial;
    return init;
  });

  const handleChange = useCallback((key: string, val: number) => {
    setValues(prev => ({ ...prev, [key]: val }));
  }, []);

  const handleReset = useCallback(() => {
    const init: Record<string, number> = {};
    for (const p of params) init[p.key] = p.initial;
    setValues(init);
  }, [params]);

  const hasChanges = params.some(p => values[p.key] !== p.initial);

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-[var(--border)]">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-dim)]">{title}</p>
        {hasChanges && (
          <button
            onClick={handleReset}
            className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      <div className="px-4 py-3">
        {renderChart(values)}
      </div>
      <div className="px-4 py-2.5 border-t border-[var(--border)] space-y-0.5">
        {params.map(p => (
          <ParameterSlider
            key={p.key}
            label={p.label}
            value={values[p.key]}
            min={p.min}
            max={p.max}
            step={p.step || 1}
            unit={p.unit}
            onChange={(v) => handleChange(p.key, v)}
          />
        ))}
      </div>
    </div>
  );
}
