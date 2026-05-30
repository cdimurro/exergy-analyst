// @ts-nocheck
"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ComprehensiveView } from "@/components/ingest/ComprehensiveView";
import { BriefDetail } from "@/components/brief/BriefDetail";
import { ExergyResultView } from "@/components/artifacts/ExergyResultView";
import { isComprehensiveExtraction } from "@/lib/ingestion-types";
import { isBriefPayload } from "@/lib/brief-types";

/* ── Icons ────────────────────────────────────────────────── */

function Logo({ size = 28 }) {
  return (
    <div className="shrink-0 rounded-lg bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-cyan)] flex items-center justify-center shadow-lg shadow-[var(--accent-blue)]/20"
      style={{ width: size, height: size }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none">
        <path d="M8 1L3 5v6l5 4 5-4V5L8 1z" fill="white" fillOpacity="0.9"/>
      </svg>
    </div>
  );
}

function IconUpload() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 26V14M20 14l-5 5M20 14l5 5" />
      <path d="M6 26v4a4 4 0 004 4h20a4 4 0 004-4v-4" />
    </svg>
  );
}

/* ── Analyze Page ─────────────────────────────────────────── */

type Stage = "input" | "analyzing" | "results" | "brief";

export default function AnalyzePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("input");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [extraction, setExtraction] = useState<any>(null);
  const [briefData, setBriefData] = useState<any>(null);
  const [artifact, setArtifact] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("Preparing document...");

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      setText("");
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setText("");
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!file && !text.trim()) return;
    setStage("analyzing");
    setError(null);

    // Progress animation
    const steps = [
      "Uploading document...",
      "Extracting text and tables...",
      "Identifying parameters and claims...",
      "Cross-validating against source text...",
      "Finding supported claims and open questions...",
      "Generating comprehensive analysis...",
    ];
    let step = 0;
    const interval = setInterval(() => {
      step = Math.min(step + 1, steps.length - 1);
      setProgress(steps[step]);
    }, 3000);

    try {
      let res: Response;

      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("prompt", "Analyze this uploaded evidence package and return the useful technical conclusion, supported claims, limits, and best next data requests.");
        res = await fetch("/api/analyze", { method: "POST", body: form });
      } else {
        res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            prompt: "Analyze this pasted evidence and return the useful technical conclusion, supported claims, limits, and best next data requests.",
          }),
        });
      }

      clearInterval(interval);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.artifact?.content?.client_summary) {
        setArtifact(data.artifact);
        setExtraction(data.extraction || null);
        setStage("results");
      } else if (data.extraction && isComprehensiveExtraction(data.extraction)) {
        setArtifact(null);
        setExtraction(data.extraction);
        setStage("results");
      } else {
        throw new Error("Analysis did not return structured results");
      }
    } catch (err) {
      clearInterval(interval);
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStage("input");
    }
  }, [file, text]);

  const handleEvaluate = useCallback(async () => {
    if (!extraction) return;
    setStage("analyzing");
    setProgress("Building a structured technical brief...");

    try {
      // Create a project and run evaluation
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: extraction.product_name || extraction.title || "Analysis",
          domain: extraction.detected_domain || "general",
          description: extraction.system_summary || "",
          goal: "Structured technical brief",
        }),
      });
      const project = await projRes.json();

      // Build params from extraction
      const params: Record<string, unknown> = {};
      for (const p of extraction.parameters || []) {
        if (p.value !== null && p.value !== undefined) {
          params[p.name] = p.value;
        }
      }

      // Run evaluation with comprehensive context
      const evalRes = await fetch(`/api/projects/${project.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "evidence_evaluation",
          config: {
            domain: extraction.detected_domain || "general",
            description: extraction.system_summary || extraction.product_name || "",
            device_id: `analyze_${Date.now()}`,
            params,
            brief: true,
            comprehensive_context: extraction,
          },
        }),
      });

      if (!evalRes.ok) throw new Error("Evaluation failed");

      const artifact = await evalRes.json();
      const brief = artifact?.content?.brief;
      if (brief && isBriefPayload(brief)) {
        setBriefData(brief);
        setStage("brief");
      } else {
        throw new Error("No brief generated");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
      setStage("results"); // Go back to results, not input
    }
  }, [extraction]);

  const handleReset = useCallback(() => {
    setStage("input");
    setFile(null);
    setText("");
    setExtraction(null);
    setBriefData(null);
    setArtifact(null);
    setError(null);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-50 h-14 flex items-center justify-between px-6 border-b border-[var(--border)] bg-[var(--bg-primary)]/80 backdrop-blur-xl">
        <button onClick={() => router.push("/")} className="flex items-center gap-2.5 hover:opacity-80">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Exergy Lab</span>
        </button>
        <div className="flex items-center gap-3">
          {stage !== "input" && (
            <button onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--border-mid)]">
              New Analysis
            </button>
          )}
          <button onClick={() => router.push("/")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent-blue)]">
            Projects
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">

        {/* ── INPUT STAGE ────────────────────────────── */}
        {stage === "input" && (
          <div className="animate-fade-in">
            <div className="text-center mb-10">
              <h1 className="text-[32px] font-bold tracking-tight mb-2">
                Analyze a Technology
              </h1>
              <p className="text-[15px] text-[var(--text-muted)] max-w-lg mx-auto">
                Upload a datasheet, technical report, or paste specifications.
                Get a comprehensive analysis with parameters, claims, gaps, and readiness assessment.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-6 p-4 rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 text-[13px] text-[var(--accent-red)]">
                {error}
              </div>
            )}

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !file && fileRef.current?.click()}
              className={`relative rounded-2xl border-2 border-dashed transition-all cursor-pointer mb-6 ${
                dragOver
                  ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/5 scale-[1.01]"
                  : file
                    ? "border-[var(--accent-green)]/50 bg-[var(--accent-green)]/5"
                    : "border-[var(--border-mid)] hover:border-[var(--accent-blue)]/40 hover:bg-[var(--bg-card)]"
              }`}
              style={{ minHeight: 160 }}
            >
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.xlsx,.xls,.docx,.csv,.txt,.json,.zip,.parquet,.h5,.nc,.dxf,.ifc"
                onChange={handleFileSelect} />

              <div className="flex flex-col items-center justify-center py-10 gap-3">
                {file ? (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-[var(--accent-green)]/10 flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" strokeWidth="2" strokeLinecap="round"><path d="M5 12l5 5L20 7"/></svg>
                    </div>
                    <div className="text-center">
                      <div className="text-[15px] font-medium text-[var(--text-primary)]">{file.name}</div>
                      <div className="text-[12px] text-[var(--text-muted)]">{(file.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setFile(null); }}
                      className="text-[12px] text-[var(--text-dim)] hover:text-[var(--accent-red)]">
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-[var(--text-dim)]"><IconUpload /></div>
                    <div className="text-[14px] text-[var(--text-muted)]">
                      Drop a file here or <span className="text-[var(--accent-blue)] font-medium">browse</span>
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)]">
                      PDF, Excel, Word, CSV, JSON, archives, or engineering data files
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Or paste text */}
            {!file && (
              <div className="mb-6">
                <div className="text-[12px] text-[var(--text-dim)] mb-2 text-center">or paste specifications directly</div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste datasheet specs, technical parameters, or product description..."
                  rows={6}
                  className="w-full bg-[var(--bg-card)] border border-[var(--border-mid)] rounded-xl px-4 py-3 text-[14px] placeholder:text-[var(--text-dim)] resize-none focus:border-[var(--accent-blue)]/50 focus:outline-none"
                />
              </div>
            )}

            {/* Analyze button */}
            <button
              onClick={handleAnalyze}
              disabled={!file && !text.trim()}
              className="w-full py-3.5 rounded-xl text-[15px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-cyan)] text-white shadow-lg shadow-[var(--accent-blue)]/20 hover:shadow-[var(--accent-blue)]/30 hover:scale-[1.005] active:scale-[0.995]"
            >
              Analyze Technology
            </button>

            <p className="text-[11px] text-[var(--text-dim)] text-center mt-3">
              Powered by governed OCR + Exergy Lab evaluation engine
            </p>
          </div>
        )}

        {/* ── ANALYZING STAGE ────────────────────────── */}
        {stage === "analyzing" && (
          <div className="animate-fade-in flex flex-col items-center justify-center py-20">
            <div className="relative mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-cyan)] flex items-center justify-center shadow-xl shadow-[var(--accent-blue)]/30 animate-pulse">
                <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1L3 5v6l5 4 5-4V5L8 1z" fill="white" fillOpacity="0.9"/>
                </svg>
              </div>
            </div>
            <div className="text-[16px] font-medium text-[var(--text-primary)] mb-2">
              {progress}
            </div>
            <div className="flex gap-1.5 mt-2">
              <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" style={{ animationDelay: "300ms" }} />
            </div>
            {file && (
              <div className="text-[12px] text-[var(--text-dim)] mt-4">{file.name}</div>
            )}
          </div>
        )}

        {/* ── RESULTS STAGE ──────────────────────────── */}
        {stage === "results" && (artifact || extraction) && (
          <div className="animate-fade-in">
            {/* Action bar */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-[20px] font-bold">
                  {artifact?.title || extraction?.product_name || extraction?.title || "Analysis Results"}
                </h2>
                <p className="text-[13px] text-[var(--text-muted)]">
                  {artifact?.content?.client_summary
                    ? `Client-ready evidence review for ${file?.name || "pasted text"}`
                    : `${extraction?.parameters?.length || 0} parameters extracted from ${file?.name || "pasted text"}`}
                </p>
              </div>
              <div className="flex gap-2">
                {!artifact?.content?.client_summary && (
                  <button onClick={handleEvaluate}
                    className="px-5 py-2.5 rounded-xl text-[13px] font-semibold bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-cyan)] text-white shadow-lg shadow-[var(--accent-blue)]/20 hover:shadow-[var(--accent-blue)]/30">
                    Evaluate Technology
                  </button>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 text-[12px] text-[var(--accent-red)]">
                {error}
              </div>
            )}

            {artifact?.content?.client_summary ? (
              <ExergyResultView content={artifact.content} />
            ) : (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
                <ComprehensiveView
                  extraction={extraction}
                  projectId=""
                  onEvaluate={handleEvaluate}
                />
              </div>
            )}
          </div>
        )}

        {/* ── BRIEF STAGE ────────────────────────────── */}
        {stage === "brief" && briefData && (
          <div className="animate-fade-in">
            {/* Action bar */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-[20px] font-bold">Decision Brief</h2>
                <p className="text-[13px] text-[var(--text-muted)]">
                  Deployment readiness assessment for {extraction?.product_name || "this technology"}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStage("results")}
                  className="px-4 py-2 rounded-lg text-[12px] font-medium text-[var(--text-muted)] border border-[var(--border)] hover:border-[var(--border-mid)]">
                  Back to Extraction
                </button>
                <button onClick={handleReset}
                  className="px-4 py-2 rounded-lg text-[12px] font-medium text-[var(--accent-blue)] border border-[var(--accent-blue)]/30 hover:bg-[var(--accent-blue)]/5">
                  New Analysis
                </button>
              </div>
            </div>

            {/* Brief */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
              <BriefDetail brief={briefData} projectId="" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
