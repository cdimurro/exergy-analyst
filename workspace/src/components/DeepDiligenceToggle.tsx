/**
 * Deep Diligence toggle — premium-tier opt-in for cross-document DD.
 *
 * Renders a premium-framed card that:
 *   1. Accepts a DD question from the user.
 *   2. Shows an upfront cost estimate derived from selected-doc sizes.
 *   3. Lets the user tune the USD budget + recursion depth.
 *   4. Submits a `deep_diligence` action to /api/projects/[id]/actions
 *      with the three-tier RLM pipeline underneath.
 *
 * The component degrades gracefully:
 *   - If no docs are selected → disabled submit with clear copy.
 *   - If the server-side budget ceiling trips, the returned artifact
 *     carries `fallback_used = "budget_exceeded"` and the result
 *     surface treats it as a partial brief, not an error.
 *
 * Deliberately self-contained — no new ui-kit components, no global
 * state, no network calls beyond the single POST to the shared actions
 * dispatcher.
 */

"use client";

import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Client-side cost estimator
// ---------------------------------------------------------------------------

// Mirrored from lib/rlm-router.ts so the estimate here stays aligned
// with the server. If server pricing changes, update both sides.
const CLIENT_PRICING = {
  leaf: { inputPerMillion: 0.30, outputPerMillion: 0.50 }, // DeepSeek V4-Flash
  synth: { inputPerMillion: 0.50, outputPerMillion: 3.00 }, // Qwen 3.6 Plus
  final: { inputPerMillion: 0.95, outputPerMillion: 3.15 }, // GLM-5.1
} as const;

function costUsd(role: "leaf" | "synth" | "final", inputTokens: number, outputTokens: number) {
  const p = CLIENT_PRICING[role];
  return (
    (inputTokens * p.inputPerMillion) / 1_000_000 +
    (outputTokens * p.outputPerMillion) / 1_000_000
  );
}

const SECTION_MAX_CHARS = 8000;
const CHARS_PER_TOKEN = 4;
// A PDF page averages ~3 KB of extracted text. size_bytes is a decent
// upper bound on char count since compression offsets some overhead.
const CHARS_PER_BYTE = 1.0;

interface SelectedDoc {
  id: string;
  filename: string;
  /** Bytes of the uploaded file. Used as a coarse char-count proxy. */
  sizeBytes?: number;
  /** Exact extracted-text length if known. Overrides sizeBytes. */
  textLength?: number;
}

function estimateTotalChars(docs: SelectedDoc[]): number {
  return docs.reduce((sum, d) => {
    if (typeof d.textLength === "number") return sum + d.textLength;
    if (typeof d.sizeBytes === "number") return sum + Math.round(d.sizeBytes * CHARS_PER_BYTE);
    return sum + 20_000; // rough default when neither is known
  }, 0);
}

function estimateCost(docs: SelectedDoc[]): { low: number; high: number; sections: number } {
  if (docs.length === 0) return { low: 0, high: 0, sections: 0 };
  const totalChars = estimateTotalChars(docs);
  const sections = Math.max(docs.length, Math.ceil(totalChars / SECTION_MAX_CHARS));

  // One leaf per section (DeepSeek), one synth per doc (Qwen), one final (GLM)
  const leafInput = sections * (SECTION_MAX_CHARS + 2000) / CHARS_PER_TOKEN;
  const leafOutput = sections * 2000;
  const synthInput = docs.length * 20_000 / CHARS_PER_TOKEN;
  const synthOutput = docs.length * 3000;
  const finalInput = Math.min(40_000, docs.length * 3000 + 2000) / CHARS_PER_TOKEN;
  const finalOutput = 4000;

  const low =
    costUsd("leaf", leafInput, leafOutput * 0.6) +
    costUsd("synth", synthInput, synthOutput * 0.6) +
    costUsd("final", finalInput, finalOutput * 0.6);
  const high =
    costUsd("leaf", leafInput, leafOutput) +
    costUsd("synth", synthInput, synthOutput) +
    costUsd("final", finalInput, finalOutput);
  return { low, high, sections };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DeepDiligenceToggleProps {
  projectId: string;
  selectedDocs: SelectedDoc[];
  /** Optional starting question. */
  defaultQuestion?: string;
  /** Callback fired when the action completes. */
  onComplete?: (artifactId: string) => void;
  /** Callback fired on submit error. */
  onError?: (message: string) => void;
  /** Hard cap on USD budget the user can request. */
  maxAllowedBudgetUsd?: number;
}

export function DeepDiligenceToggle({
  projectId,
  selectedDocs,
  defaultQuestion = "",
  onComplete,
  onError,
  maxAllowedBudgetUsd = 2.00,
}: DeepDiligenceToggleProps) {
  const [question, setQuestion] = useState(defaultQuestion);
  const [budgetUsd, setBudgetUsd] = useState(0.50);
  const [maxDepth, setMaxDepth] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ artifact_id: string; cost: number; fallback: string | null } | null>(null);

  const est = useMemo(() => estimateCost(selectedDocs), [selectedDocs]);

  const canSubmit =
    !submitting &&
    selectedDocs.length > 0 &&
    question.trim().length >= 10 &&
    budgetUsd > 0 &&
    budgetUsd <= maxAllowedBudgetUsd;

  const willOverrun = est.high > budgetUsd;

  async function handleSubmit() {
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "deep_diligence",
          input: {
            question,
            document_ids: selectedDocs.map((d) => d.id),
            max_usd: budgetUsd,
            max_depth: maxDepth,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Deep DD failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      const artifact = data.artifact || data;
      const fallback = (artifact?.content?.fallback_used as string | null) ?? null;
      const cost = (artifact?.content?.model_cost_usd as number) ?? 0;
      const artifactId = (artifact?.id as string) || "";
      setResult({ artifact_id: artifactId, cost, fallback });
      onComplete?.(artifactId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--accent-amber)]">Deep Diligence</h3>
            <span className="rounded-full bg-[var(--accent-amber)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent-amber)]">
              Premium
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--accent-amber)]">
            Multi-pass recursive analysis across every selected document.
            Cross-doc contradiction detection + cited findings.
          </p>
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-slate-700">
          Diligence question
        </label>
        <textarea
          className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          rows={2}
          placeholder="What do you need verified across these documents?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Docs</label>
          <div className="text-lg font-semibold text-slate-800">{selectedDocs.length}</div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Est. sections</label>
          <div className="text-lg font-semibold text-slate-800">{est.sections}</div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Est. cost</label>
          <div
            className={`text-lg font-semibold ${willOverrun ? "text-[var(--accent-red)]" : "text-slate-800"}`}
            title={`Range: $${est.low.toFixed(3)} – $${est.high.toFixed(3)}`}
          >
            ${est.low.toFixed(2)}–${est.high.toFixed(2)}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Budget cap</label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-slate-500">$</span>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max={maxAllowedBudgetUsd}
              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={budgetUsd}
              onChange={(e) => setBudgetUsd(Math.max(0.05, Number(e.target.value) || 0))}
            />
          </div>
        </div>
      </div>

      <details className="mb-3 text-xs text-slate-600">
        <summary className="cursor-pointer select-none font-medium">Advanced</summary>
        <div className="mt-2">
          <label className="mb-1 block">Max recursion depth</label>
          <input
            type="number"
            min="1"
            max="6"
            className="w-16 rounded-md border border-slate-300 px-2 py-1"
            value={maxDepth}
            onChange={(e) => setMaxDepth(Math.max(1, Math.min(6, Number(e.target.value) || 3)))}
          />
        </div>
      </details>

      {willOverrun && (
        <div className="mb-3 rounded-md bg-[var(--accent-amber)]/10 p-2 text-xs text-[var(--accent-amber)]">
          Estimated cost exceeds your budget cap. The pipeline will gracefully
          degrade to a partial brief if the ceiling is reached.
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md bg-[var(--accent-red)]/10 p-2 text-sm text-[var(--accent-red)]">
          {error}
        </div>
      )}

      {result && (
        <div className="mb-3 rounded-md bg-[var(--accent-green)]/10 p-3 text-sm text-[var(--accent-green)]">
          <div className="font-medium">
            {result.fallback
              ? `Partial brief returned (${result.fallback.replace(/_/g, " ")})`
              : "Brief ready"}
          </div>
          <div className="text-xs">Spend: ${result.cost.toFixed(3)}</div>
        </div>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className={`w-full rounded-md px-4 py-2 text-sm font-medium text-white transition ${
          canSubmit
            ? "bg-[var(--accent-amber)]/10 hover:bg-[var(--accent-amber)]/10"
            : "cursor-not-allowed bg-slate-300"
        }`}
      >
        {submitting
          ? "Running Deep Diligence…"
          : selectedDocs.length === 0
            ? "Select at least one document"
            : question.trim().length < 10
              ? "Enter a diligence question"
              : `Run Deep Diligence (${selectedDocs.length} docs)`}
      </button>
    </div>
  );
}

export default DeepDiligenceToggle;
