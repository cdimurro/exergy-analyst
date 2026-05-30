// @ts-nocheck
"use client";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { CollapsibleSection } from "@/components/canvas/CollapsibleSection";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
}

export function WorkspaceRunView({
  content,
  projectId,
  artifactId,
}: {
  content: Record<string, unknown>;
  projectId?: string;
  artifactId?: string;
}) {
  const execution = asRecord(content.execution);
  const sandbox = asRecord(content.sandbox);
  const files = asArray(content.files);
  const steps = asArray(content.process_steps);
  const securityFindings = Array.isArray(content.security_findings) ? content.security_findings as string[] : [];
  const report = typeof content.report_markdown === "string" ? content.report_markdown : "";
  const code = typeof content.generated_code === "string" ? content.generated_code : "";
  const stdout = typeof execution.stdout === "string" ? execution.stdout : "";
  const stderr = typeof execution.stderr === "string" ? execution.stderr : "";
  const requirements = Array.isArray(execution.requirements) ? execution.requirements as string[] : [];

  return (
    <div className="space-y-6">
      <header className="border-b border-[var(--border)]/60 pb-5">
        <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-[var(--text-dim)]">Agent Workspace</p>
        <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)]">
          {String(content.task || "Workspace run")}
        </h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
          This run created a project-local workspace, generated code, executed it, and collected the output files below.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--text-muted)]">
            Sandbox: {String(sandbox.mode || "local restricted").replace(/_/g, " ")}
          </span>
          <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--text-muted)]">
            Network: {sandbox.network ? "enabled" : "disabled"}
          </span>
          <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--text-muted)]">
            Memory: {String(sandbox.memoryMb || "limited")} MB
          </span>
        </div>
        {securityFindings.length > 0 && (
          <div className="mt-4 rounded-lg border border-[var(--accent-red)]/35 bg-[var(--accent-red)]/8 p-3">
            <p className="text-[14px] font-medium text-[var(--accent-red)]">Generated code was blocked by sandbox policy.</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px] text-[var(--text-secondary)]">
              {securityFindings.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          </div>
        )}
      </header>

      {report && (
        <CollapsibleSection title="Report" sectionNumber="01" defaultOpen>
          <div className="prose prose-invert max-w-none">
            <MarkdownRenderer content={report} />
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Run Steps" sectionNumber="02" defaultOpen>
        <div>
          {steps.map((step, index) => (
            <div key={index} className="flex gap-3 border-t border-[var(--border)]/45 py-3 first:border-t-0">
              <span className="w-7 shrink-0 text-[12px] font-medium tabular-nums text-[var(--text-dim)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="text-[15px] font-medium text-[var(--text-primary)]">{String(step.title || "Step")}</p>
                {step.detail && <p className="mt-1 text-[15px] text-[var(--text-secondary)]">{String(step.detail)}</p>}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Output Files" sectionNumber="03" defaultOpen>
        {files.length > 0 ? (
          <div className="space-y-2">
            {files.map((file, index) => (
              <div key={index} className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/35 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[15px] font-medium text-[var(--text-primary)]">{String(file.filename || "output")}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[var(--text-dim)]">{Math.max(1, Math.round(Number(file.bytes || 0) / 1024))} KB</span>
                    {projectId && artifactId && file.path && (
                      <a
                        href={`/api/projects/${projectId}/artifacts/${artifactId}/files?path=${encodeURIComponent(String(file.path))}`}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--text-muted)] transition-colors hover:border-[var(--accent-blue)]/50 hover:text-[var(--accent-blue)]"
                      >
                        Download
                      </a>
                    )}
                  </div>
                </div>
                {file.preview && (
                  <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-black/20 p-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
                    {String(file.preview).slice(0, 4000)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-[var(--text-secondary)]">No output files were collected.</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Generated Code" sectionNumber="04">
        <pre className="max-h-[520px] overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-4 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {code || "No generated code recorded."}
        </pre>
      </CollapsibleSection>

      <CollapsibleSection title="Execution Logs" sectionNumber="05">
        <div className="space-y-3">
          {requirements.length > 0 && (
            <p className="text-[15px] text-[var(--text-secondary)]">
              Dependencies requested: {requirements.join(", ")}
            </p>
          )}
          <pre className="max-h-72 overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-4 text-[12px] leading-relaxed text-[var(--text-muted)]">
            {[stdout && `STDOUT\n${stdout}`, stderr && `STDERR\n${stderr}`].filter(Boolean).join("\n\n") || "No logs were emitted."}
          </pre>
        </div>
      </CollapsibleSection>
    </div>
  );
}
