"use client";

import { EvalCard } from "@/components/artifacts/EvalCard";
import { ResearchCard } from "@/components/artifacts/ResearchCard";

interface InlineResultCardProps {
  artifact: Record<string, unknown>;
  onOpenCanvas?: (content: "brief") => void;
}

export function InlineResultCard({ artifact, onOpenCanvas }: InlineResultCardProps) {
  const type = typeof artifact.type === "string" ? artifact.type : "";

  if (type === "evaluation" || type === "simulation") {
    return <EvalCard artifact={artifact} onOpenCanvas={onOpenCanvas} />;
  }

  if (type === "research" || type === "deep_research") {
    return <ResearchCard artifact={artifact} />;
  }

  const title = typeof artifact.title === "string" ? artifact.title : "Result";
  const summary = typeof artifact.summary === "string" ? artifact.summary : "The run completed and produced an artifact.";

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
      <div className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">{summary}</p>
    </div>
  );
}

export default InlineResultCard;
