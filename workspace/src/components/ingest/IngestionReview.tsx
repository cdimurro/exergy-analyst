"use client";

import { useState, useCallback } from "react";
import type { IngestionPacket, ExtractionField, IngestionVerdict } from "@/lib/ingestion-types";
import { MVP_DOMAINS } from "@/lib/ingestion-types";
import { formatCompositeScore } from "@/lib/canonical-score";

interface IngestionReviewProps {
  packet: IngestionPacket;
  projectId: string;
  onEvaluated?: (brief: Record<string, unknown>) => void;
  comprehensiveContext?: Record<string, unknown>;
}

function confidenceColor(c: number): string {
  if (c >= 0.7) return "var(--accent-green, #22c55e)";
  if (c >= 0.4) return "var(--accent-yellow, #eab308)";
  return "var(--accent-red, #ef4444)";
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    valid: "var(--accent-green)",
    warning: "#eab308",
    error: "#ef4444",
    unknown: "#6b7280",
  };
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 4,
        color: "#fff",
        backgroundColor: colors[status] || "#6b7280",
      }}
    >
      {status}
    </span>
  );
}

function verdictBadge(verdict: IngestionVerdict) {
  const map: Record<string, { label: string; bg: string }> = {
    accepted: { label: "Ready for Review", bg: "var(--accent-green)" },
    needs_review: { label: "Needs Review", bg: "#eab308" },
    rejected: { label: "Extraction Failed", bg: "#ef4444" },
  };
  const v = map[verdict] || map.needs_review;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        color: "#fff",
        backgroundColor: v.bg,
      }}
    >
      {v.label}
    </span>
  );
}

export function IngestionReview({ packet, projectId, onEvaluated, comprehensiveContext }: IngestionReviewProps) {
  const [fields, setFields] = useState<ExtractionField[]>(packet.fields);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluated, setEvaluated] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [briefData, setBriefData] = useState<Record<string, unknown> | null>(null);

  const updateField = useCallback((idx: number, newValue: string) => {
    setFields((prev) => {
      const next = [...prev];
      const f = { ...next[idx] };
      // Try parse as number
      const num = parseFloat(newValue);
      f.value = isNaN(num) ? (newValue || null) : num;
      f.user_edited = true;
      f.validation_status = "valid"; // user override clears validation
      f.validation_message = "";
      next[idx] = f;
      return next;
    });
  }, []);

  const handleEvaluate = useCallback(async () => {
    setEvaluating(true);
    setEvalError(null);

    // Build params dict from reviewed fields
    const params: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.value !== null && f.validation_status !== "error") {
        params[f.name] = f.value;
      }
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "evidence_evaluation",
          config: {
            domain: packet.detected_domain,
            description: `${packet.commercial_name || packet.detected_domain} — ingested from ${packet.source_type}`,
            device_id: packet.packet_id,
            params,
            brief: true,
            comprehensive_context: comprehensiveContext || undefined,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const artifact = await res.json();
      const brief = artifact?.content?.brief;
      if (brief) {
        setBriefData(brief);
        onEvaluated?.(brief);
      }
      setEvaluated(true);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  }, [fields, packet, projectId, onEvaluated]);

  const domainInfo = MVP_DOMAINS[packet.detected_domain];
  const nValid = fields.filter(
    (f) => f.value !== null && f.validation_status !== "error",
  ).length;
  const nTotal = fields.length;

  return (
    <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, color: "var(--text-primary, #e4e4e7)" }}>
      {/* Header */}
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border-dim, #333)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Datasheet Ingestion Review</span>
          {verdictBadge(packet.extraction_verdict)}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary, #a1a1aa)", lineHeight: 1.6 }}>
          <div>
            <strong>Domain:</strong> {domainInfo?.display_name || packet.detected_domain}
            <span style={{ marginLeft: 8, fontSize: 10, color: confidenceColor(packet.domain_confidence) }}>
              ({Math.round(packet.domain_confidence * 100)}% confidence)
            </span>
          </div>
          {packet.commercial_name && <div><strong>Product:</strong> {packet.commercial_name}</div>}
          {packet.manufacturer && <div><strong>Manufacturer:</strong> {packet.manufacturer}</div>}
          {packet.technology_family && <div><strong>Technology:</strong> {packet.technology_family}</div>}
          <div><strong>Source:</strong> {packet.source_type}{packet.source_filename ? ` — ${packet.source_filename}` : ""}</div>
          <div><strong>Fields:</strong> {nValid}/{nTotal} extracted</div>
        </div>
      </div>

      {/* Validation issues summary */}
      {(packet.validation_errors.length > 0 || packet.validation_warnings.length > 0) && (
        <div style={{ marginBottom: 12, padding: 8, borderRadius: 6, backgroundColor: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)" }}>
          {packet.validation_errors.map((e, i) => (
            <div key={`e${i}`} style={{ fontSize: 11, color: "#ef4444", marginBottom: 2 }}>
              {e.field_name}: {e.message}
            </div>
          ))}
          {packet.validation_warnings.map((w, i) => (
            <div key={`w${i}`} style={{ fontSize: 11, color: "#eab308", marginBottom: 2 }}>
              {w.field_name}: {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Fields table */}
      <div style={{ marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-dim, #333)", textAlign: "left" }}>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Parameter</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Value</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Unit</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Conf</th>
              <th style={{ padding: "4px 8px", fontWeight: 500 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, idx) => (
              <tr key={f.name} style={{ borderBottom: "1px solid var(--border-dim, #222)" }}>
                <td style={{ padding: "4px 8px" }}>
                  <span title={f.source_text || undefined}>{f.label || f.name}</span>
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <input
                    type="text"
                    value={f.value !== null ? String(f.value) : ""}
                    onChange={(e) => updateField(idx, e.target.value)}
                    placeholder="—"
                    style={{
                      width: "100%",
                      maxWidth: 120,
                      padding: "2px 4px",
                      fontSize: 12,
                      fontFamily: "inherit",
                      backgroundColor: f.user_edited ? "rgba(59,130,246,0.1)" : "transparent",
                      border: `1px solid ${f.user_edited ? "rgba(59,130,246,0.3)" : "var(--border-dim, #333)"}`,
                      borderRadius: 3,
                      color: "inherit",
                    }}
                  />
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary, #a1a1aa)" }}>{f.unit}</td>
                <td style={{ padding: "4px 8px" }}>
                  <span style={{ color: confidenceColor(f.confidence) }}>
                    {f.confidence > 0 ? `${Math.round(f.confidence * 100)}%` : "—"}
                  </span>
                </td>
                <td style={{ padding: "4px 8px" }}>{statusBadge(f.validation_status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Source text preview */}
      {packet.source_text_preview && (
        <details style={{ marginBottom: 12, fontSize: 11, color: "var(--text-secondary, #a1a1aa)" }}>
          <summary style={{ cursor: "pointer", marginBottom: 4 }}>Source text preview</summary>
          <pre style={{ whiteSpace: "pre-wrap", padding: 8, backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 4, maxHeight: 150, overflow: "auto" }}>
            {packet.source_text_preview}
          </pre>
        </details>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {!evaluated && (
          <button
            onClick={handleEvaluate}
            disabled={evaluating || nValid < 2 || packet.extraction_verdict === "rejected"}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: "none",
              cursor: evaluating || nValid < 2 ? "not-allowed" : "pointer",
              backgroundColor: evaluating ? "#6b7280" : "var(--accent-blue, #3b82f6)",
              color: "#fff",
              opacity: nValid < 2 || packet.extraction_verdict === "rejected" ? 0.5 : 1,
            }}
          >
            {evaluating ? "Evaluating..." : `Evaluate (${nValid} params)`}
          </button>
        )}
        {evaluated && !evalError && (
          <span style={{ fontSize: 12, color: "var(--accent-green)", fontWeight: 600 }}>
            Evaluation complete — brief generated
          </span>
        )}
        {evalError && (
          <span style={{ fontSize: 12, color: "#ef4444" }}>
            {evalError}
          </span>
        )}
      </div>

      {/* Brief preview after evaluation */}
      {briefData && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 6, border: "1px solid var(--border-dim, #333)", backgroundColor: "rgba(0,0,0,0.15)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Decision Brief Generated</div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <div><strong>Headline:</strong> {(briefData.headline as string) || "—"}</div>
            <div><strong>Readiness:</strong> {(briefData.readiness_tier as string) || "—"}</div>
            <div><strong>Score:</strong> {typeof briefData.composite_score === "number" ? formatCompositeScore(briefData.composite_score, "inline") : "—"}</div>
            {Array.isArray(briefData.key_strengths) && briefData.key_strengths.length > 0 && (
              <div><strong>Strengths:</strong> {(briefData.key_strengths as string[]).slice(0, 3).join("; ")}</div>
            )}
            {Array.isArray(briefData.key_concerns) && briefData.key_concerns.length > 0 && (
              <div><strong>Concerns:</strong> {(briefData.key_concerns as string[]).slice(0, 3).join("; ")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
