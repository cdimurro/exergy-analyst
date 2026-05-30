// @ts-nocheck
"use client";

/**
 * Create New Project page — uses the same ProjectCreator as the homepage.
 * This page is accessible from "My Projects" → "Create New Project".
 */

import { ProjectCreator } from "@/components/ProjectCreator";

export default function NewProjectPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center px-4 sm:px-6 py-12 bg-[#080c16]">
      <div className="w-full max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-[28px] font-bold text-[var(--text-primary)] mb-2">Create New Project</h1>
          <p className="text-[14px] text-[var(--text-muted)]">
            Upload a document, describe a technology, or ask a question.
          </p>
        </div>

        <ProjectCreator variant="hero" />
      </div>
    </div>
  );
}
