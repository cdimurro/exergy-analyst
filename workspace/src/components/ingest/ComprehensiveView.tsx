"use client";

import { useState, useCallback } from "react";
import type {
  ComprehensiveExtraction,
  ExtractedParameterFull,
  InformationGap,
  PerformanceClaim,
  TableData,
} from "@/lib/ingestion-types";

interface ComprehensiveViewProps {
  extraction: ComprehensiveExtraction;
  projectId: string;
  onEvaluate?: () => void;
}

function confidenceBadge(c: string) {
  const colors: Record<string, string> = {
    stated: "var(--accent-green)", demonstrated: "var(--accent-green)",
    derived: "var(--accent-blue)", claimed: "var(--accent-amber)",
    inferred: "#f97316", unverified: "#ef4444",
  };
  return (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, color: "#fff", backgroundColor: colors[c] || "#6b7280" }}>
      {c}
    </span>
  );
}

function importanceBadge(imp: string) {
  const colors: Record<string, string> = { critical: "#ef4444", high: "#f97316", medium: "var(--accent-amber)" };
  return (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, color: "#fff", backgroundColor: colors[imp] || "#6b7280" }}>
      {imp}
    </span>
  );
}

function evidenceBadge(e: string) {
  const colors: Record<string, string> = { peer_reviewed: "var(--accent-green)", third_party: "var(--accent-blue)", demonstrated: "var(--accent-blue)", self_reported: "var(--accent-amber)" };
  return (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, color: "#fff", backgroundColor: colors[e] || "#6b7280" }}>
      {e.replace("_", " ")}
    </span>
  );
}

function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "1px solid var(--border-dim, #333)" }}
      >
        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {count !== undefined && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>({count})</span>}
      </div>
      {open && <div style={{ paddingTop: 6 }}>{children}</div>}
    </div>
  );
}

export function ComprehensiveView({ extraction: e, projectId, onEvaluate }: ComprehensiveViewProps) {
  const nUnverified = e.parameters.filter(p => p.confidence === "unverified").length;

  return (
    <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-primary, #e4e4e7)" }}>
      {/* Header */}
      <div style={{ marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid var(--border-mid, #444)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{e.product_name || e.title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary, #a1a1aa)", lineHeight: 1.6 }}>
          {e.company && <span><strong>Company:</strong> {e.company} &nbsp;</span>}
          <span><strong>Domain:</strong> {e.detected_domain} &nbsp;</span>
          <span><strong>Type:</strong> {e.document_type} &nbsp;</span>
          {e.trl_estimate && <span><strong>TRL:</strong> {e.trl_estimate}</span>}
        </div>
        {e.system_summary && (
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
            {e.system_summary}
          </div>
        )}
      </div>

      {/* Validation banner */}
      {nUnverified > 0 && (
        <div style={{ marginBottom: 10, padding: 6, borderRadius: 4, backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11 }}>
          {nUnverified} parameter(s) could not be verified against document text — review before trusting.
        </div>
      )}

      {/* Parameters */}
      <Section title="Parameters" count={e.parameters.length} defaultOpen={true}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-dim, #333)", textAlign: "left" }}>
              <th style={{ padding: "3px 6px" }}>Name</th>
              <th style={{ padding: "3px 6px" }}>Value</th>
              <th style={{ padding: "3px 6px" }}>Unit</th>
              <th style={{ padding: "3px 6px" }}>Confidence</th>
              <th style={{ padding: "3px 6px" }}>Category</th>
            </tr>
          </thead>
          <tbody>
            {e.parameters.map((p, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-dim, #222)" }}>
                <td style={{ padding: "3px 6px" }} title={p.context}>{p.name}</td>
                <td style={{ padding: "3px 6px", fontWeight: 500 }}>{String(p.value ?? "—")}</td>
                <td style={{ padding: "3px 6px", color: "var(--text-secondary)" }}>{p.unit}</td>
                <td style={{ padding: "3px 6px" }}>{confidenceBadge(p.confidence)}</td>
                <td style={{ padding: "3px 6px", color: "var(--text-secondary)" }}>{p.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Performance Claims */}
      {e.performance_claims.length > 0 && (
        <Section title="Performance Claims" count={e.performance_claims.length} defaultOpen={true}>
          {e.performance_claims.map((c, i) => (
            <div key={i} style={{ marginBottom: 6, padding: "4px 6px", borderLeft: "2px solid var(--accent-blue, #3b82f6)" }}>
              <div>{c.claim} {c.value && <span style={{ color: "var(--text-secondary)" }}>— {c.value}</span>}</div>
              <div style={{ marginTop: 2 }}>{evidenceBadge(c.evidence)}</div>
            </div>
          ))}
        </Section>
      )}

      {/* Cost Data */}
      {e.cost_data.length > 0 && (
        <Section title="Cost Data" count={e.cost_data.length}>
          {e.cost_data.map((c, i) => (
            <div key={i} style={{ padding: "2px 6px" }}>
              <strong>{c.name}:</strong> {String(c.value)} {c.unit}
            </div>
          ))}
          {e.economic_summary && <div style={{ marginTop: 4, color: "var(--text-secondary)", padding: "2px 6px" }}>{e.economic_summary}</div>}
        </Section>
      )}

      {/* Tables */}
      {e.tables.length > 0 && (
        <Section title="Tables" count={e.tables.length} defaultOpen={false}>
          {e.tables.map((t, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>{t.title}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                {t.headers.length > 0 && (
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-dim, #333)" }}>
                      {t.headers.map((h, j) => <th key={j} style={{ padding: "2px 4px", textAlign: "left" }}>{h}</th>)}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {t.rows.slice(0, 20).map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: "1px solid var(--border-dim, #222)" }}>
                      {row.map((cell, ci) => <td key={ci} style={{ padding: "2px 4px" }}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Section>
      )}

      {/* Information Gaps */}
      {e.information_gaps.length > 0 && (
        <Section title="Information Gaps" count={e.information_gaps.length} defaultOpen={true}>
          {e.information_gaps.map((g, i) => (
            <div key={i} style={{ marginBottom: 4, padding: "3px 6px", display: "flex", alignItems: "center", gap: 6 }}>
              {importanceBadge(g.importance)}
              <span style={{ color: "var(--text-secondary)" }}>{g.category}:</span>
              <span>{g.description}</span>
            </div>
          ))}
        </Section>
      )}

      {/* Architecture / Operating Modes */}
      {(e.architecture || e.operating_modes.length > 0) && (
        <Section title="Architecture" defaultOpen={false}>
          {e.architecture && <div style={{ marginBottom: 6, lineHeight: 1.5 }}>{e.architecture}</div>}
          {e.operating_modes.length > 0 && (
            <div>
              <strong>Operating Modes:</strong>{" "}
              {e.operating_modes.join(", ")}
            </div>
          )}
          {e.operating_conditions && <div style={{ marginTop: 4 }}><strong>Conditions:</strong> {e.operating_conditions}</div>}
        </Section>
      )}

      {/* Regulatory / Safety */}
      {(e.regulatory_status || e.safety_claims.length > 0 || e.certifications.length > 0) && (
        <Section title="Regulatory & Safety" defaultOpen={false}>
          {e.regulatory_status && <div style={{ marginBottom: 4 }}><strong>Status:</strong> {e.regulatory_status}</div>}
          {e.certifications.length > 0 && <div style={{ marginBottom: 4 }}><strong>Certifications:</strong> {e.certifications.join(", ")}</div>}
          {e.safety_claims.map((s, i) => <div key={i} style={{ padding: "1px 6px", color: "var(--text-secondary)" }}>- {s}</div>)}
        </Section>
      )}

      {/* TRL */}
      {e.trl_estimate && (
        <Section title="Technology Readiness" defaultOpen={false}>
          <div><strong>TRL Estimate:</strong> {e.trl_estimate}</div>
          {e.trl_evidence && <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>{e.trl_evidence}</div>}
          {e.demonstrated_scale && <div style={{ marginTop: 4 }}><strong>Demonstrated:</strong> {e.demonstrated_scale}</div>}
          {e.target_scale && <div><strong>Target:</strong> {e.target_scale}</div>}
        </Section>
      )}

      {/* Footer */}
      <div style={{ marginTop: 16, paddingTop: 8, borderTop: "1px solid var(--border-dim, #333)", fontSize: 10, color: "var(--text-secondary)" }}>
        Model: {e.extraction_model} | Source: {e.source_type} | Confidence: {Math.round(e.confidence_overall * 100)}%
        {onEvaluate && (
          <button
            onClick={onEvaluate}
            style={{ marginLeft: 12, padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 4, border: "none", cursor: "pointer", backgroundColor: "var(--accent-blue, #3b82f6)", color: "#fff" }}
          >
            Evaluate Technology
          </button>
        )}
      </div>
    </div>
  );
}
