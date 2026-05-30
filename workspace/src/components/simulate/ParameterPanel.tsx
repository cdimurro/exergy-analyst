"use client";

import type { CellParams } from "@/lib/battery-sim";

interface Props {
  params: CellParams;
  onChange: (key: keyof CellParams, value: number | string) => void;
  onRun: () => void;
  onReset: () => void;
  hasResult: boolean;
}

interface ParamField {
  key: keyof CellParams;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

const SECTIONS: { title: string; fields: ParamField[] }[] = [
  {
    title: "Cell Identification",
    fields: [],
  },
  {
    title: "Electrical",
    fields: [
      { key: "capacity_mAh", label: "Capacity", unit: "mAh", min: 100, max: 10000, step: 50 },
      { key: "nominal_V", label: "Nominal Voltage", unit: "V", min: 1.0, max: 5.0, step: 0.1 },
      { key: "max_V", label: "Max Charge Voltage", unit: "V", min: 2.0, max: 5.0, step: 0.05 },
      { key: "cutoff_V", label: "Cutoff Voltage", unit: "V", min: 1.5, max: 4.0, step: 0.1 },
      { key: "impedance_mOhm", label: "Impedance", unit: "mOhm", min: 5, max: 200, step: 1 },
    ],
  },
  {
    title: "Current Limits",
    fields: [
      { key: "max_charge_A", label: "Max Charge", unit: "A", min: 0.1, max: 50, step: 0.1 },
      { key: "max_discharge_A", label: "Max Discharge", unit: "A", min: 0.1, max: 100, step: 0.1 },
    ],
  },
  {
    title: "Physical",
    fields: [
      { key: "weight_g", label: "Weight", unit: "g", min: 1, max: 500, step: 1 },
      { key: "diameter_mm", label: "Diameter", unit: "mm", min: 5, max: 100, step: 0.1 },
      { key: "height_mm", label: "Height", unit: "mm", min: 10, max: 200, step: 0.1 },
    ],
  },
  {
    title: "Simulation",
    fields: [
      { key: "ambient_temp_C", label: "Ambient Temp", unit: "°C", min: -20, max: 60, step: 1 },
      { key: "cycle_count", label: "Cycles to Model", unit: "", min: 100, max: 10000, step: 100 },
    ],
  },
];

export function ParameterPanel({ params, onChange, onRun, onReset, hasResult }: Props) {
  return (
    <div className="space-y-3 sticky top-4">
      {/* Cell name & chemistry */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
          Cell Name
        </label>
        <input
          type="text"
          value={params.name}
          onChange={(e) => onChange("name", e.target.value)}
          className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
        />
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-3 mb-1">
          Chemistry
        </label>
        <input
          type="text"
          value={params.chemistry}
          onChange={(e) => onChange("chemistry", e.target.value)}
          className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
        />
      </div>

      {/* Parameter sections */}
      {SECTIONS.filter((s) => s.fields.length > 0).map((section) => (
        <div
          key={section.title}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4"
        >
          <h3 className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-3">
            {section.title}
          </h3>
          <div className="space-y-3">
            {section.fields.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[var(--text-secondary)]">
                    {f.label}
                  </label>
                  <span className="text-xs font-mono text-[var(--text-primary)]">
                    {params[f.key] as number}{" "}
                    <span className="text-[var(--text-muted)]">{f.unit}</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={params[f.key] as number}
                  onChange={(e) => onChange(f.key, parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                    bg-[var(--bg-secondary)]
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-3.5
                    [&::-webkit-slider-thumb]:h-3.5
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-[var(--accent-blue)]
                    [&::-webkit-slider-thumb]:shadow-md"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Action buttons */}
      <button
        onClick={onRun}
        className="w-full py-3 rounded-lg font-semibold text-sm
          bg-[var(--accent-green)] text-black
          hover:brightness-110 active:brightness-90
          transition-all shadow-lg shadow-[var(--accent-green)]/20"
      >
        {hasResult ? "Update Simulation" : "Run Simulation"}
      </button>
      <button
        onClick={onReset}
        className="w-full py-2 rounded-lg text-xs
          border border-[var(--border)] text-[var(--text-muted)]
          hover:bg-[var(--bg-hover)] transition-colors"
      >
        Reset to Defaults
      </button>
    </div>
  );
}
