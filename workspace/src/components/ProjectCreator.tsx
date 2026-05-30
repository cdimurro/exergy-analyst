// @ts-nocheck
"use client";

/**
 * ProjectCreator — shared project creation interface.
 *
 * Used on the homepage (/) and /projects/new. Creates a project, uploads
 * files, and redirects to the workspace with the initial query.
 *
 * Looks like ChatGPT's main input: centered, large textarea, file upload,
 * prominent send button.
 */

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import domainCatalog from "@/lib/domain-catalog.generated.json";

function detectDomain(text: string): string {
  const textLower = text.toLowerCase().replace(/[-_]/g, " ");
  for (const d of (domainCatalog as any).domains) {
    for (const kw of d.keywords) {
      if (textLower.includes(kw.toLowerCase().replace(/[-_]/g, " "))) return d.id;
    }
  }
  return "general";
}

function IconSend() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2v14M9 2L4 7M9 2l5 5" />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round">
      <path d="M15.3 8.5l-6.8 6.8a4 4 0 01-5.7-5.7L9.6 2.8a2.66 2.66 0 013.77 3.77L6.6 13.3a1.33 1.33 0 01-1.88-1.88l6.2-6.2" />
    </svg>
  );
}

interface ProjectCreatorProps {
  /** Pre-filled description text */
  initialDescription?: string;
  /** Whether to show the full hero header or just the input */
  variant?: "hero" | "compact";
}

export function ProjectCreator({ initialDescription = "", variant = "hero" }: ProjectCreatorProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState(initialDescription);
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const captured = Array.from(fileList);
    setFiles((prev) => [...prev, ...captured]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = useCallback(async () => {
    const desc = description.trim();
    if (!desc && files.length === 0) return;

    setCreating(true);
    try {
      const projectName = files[0]?.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") || desc.slice(0, 60) || "New Project";
      const domain = detectDomain(projectName + " " + desc);

      // Create project
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, description: desc, goal: "", domain }),
      });
      const project = await res.json();

      // Upload all files
      const uploadedNames: string[] = [];
      const uploadedIds: string[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const upRes = await fetch(`/api/projects/${project.id}/documents`, { method: "POST", body: form });
        if (upRes.ok) {
          const doc = await upRes.json().catch(() => null);
          uploadedNames.push(file.name);
          if (doc?.id) uploadedIds.push(doc.id);
        }
      }

      // Build initial query — user's own description only
      const attachSuffix = uploadedNames.length > 0 ? `\n\n[Attached: ${uploadedNames.join(", ")}]` : "";
      const query = (desc || "Analyze this technology") + attachSuffix;

      const runRes = await fetch(`/api/projects/${project.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          document_ids: uploadedIds,
          mode: "implement",
          thinking_level: "expert",
        }),
      });

      router.push(
        runRes.ok
          ? `/projects/${project.id}`
          : `/projects/${project.id}?q=${encodeURIComponent(query)}`,
      );
    } catch {
      setCreating(false);
    }
  }, [description, files, router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends. Shift+Enter keeps the normal textarea newline behavior.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!creating && (description.trim().length > 0 || files.length > 0)) {
        handleSubmit();
      }
    }
  };

  const canSubmit = description.trim().length > 0 || files.length > 0;

  return (
    <div className={variant === "hero" ? "w-full max-w-3xl mx-auto" : "w-full"}>
      {/* File input removed from here — embedded directly in the toolbar label below */}
      {/* Main input card */}
      <div
        className={`relative rounded-2xl border overflow-hidden transition-all ${
          dragOver
            ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/5 shadow-[0_0_30px_rgba(91,141,217,0.15)]"
            : "border-[var(--border)] bg-[var(--bg-card)] shadow-xl shadow-black/20"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Exergy Lab..."
          rows={4}
          disabled={creating}
          className="w-full bg-transparent px-5 pt-5 pb-2 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] resize-none focus:outline-none focus:ring-0 disabled:opacity-50 leading-relaxed"
          style={{ minHeight: "120px", maxHeight: "300px" }}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = Math.min(t.scrollHeight, 300) + "px";
          }}
        />

        {/* Attached files */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-2">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[12px] text-[var(--text-primary)]"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M7 1H3.5A1.5 1.5 0 002 2.5v7A1.5 1.5 0 003.5 11h5A1.5 1.5 0 0010 9.5V4L7 1z" stroke="currentColor" strokeWidth="1" />
                </svg>
                <span className="truncate max-w-[180px]">{f.name}</span>
                <span className="text-[10px] text-[var(--text-dim)]">{(f.size / 1024).toFixed(0)} KB</span>
                <button
                  onClick={() => removeFile(i)}
                  className="text-[var(--text-dim)] hover:text-[var(--text-primary)] ml-0.5 text-sm leading-none"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div
              className="relative flex h-10 items-center gap-2 px-3 rounded-xl text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer select-none overflow-hidden"
            >
              <IconPaperclip />
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.csv,.xlsx,.xls,.docx,.doc,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,.xml,.yaml,.yml,.md,.pptx,.rtf,.tsv,.parquet"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
              />
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit || creating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-[#4a6a8a] to-[#3a7a6a] hover:from-[#5a7a9a] hover:to-[#4a8a7a] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
          >
            {creating ? (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                  <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Creating...
              </>
            ) : (
              <>
                <IconSend />
                Send
              </>
            )}
          </button>
        </div>
      </div>

      {/* Drop zone hint */}
      {dragOver && (
        <div className="mt-2 text-center text-[12px] text-[var(--accent-blue)] animate-fade-in-fast">
          Drop files to attach
        </div>
      )}
    </div>
  );
}
