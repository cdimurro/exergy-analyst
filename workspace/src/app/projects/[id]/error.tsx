"use client";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080c16] px-6">
      <div className="text-center max-w-md">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/20 flex items-center justify-center mx-auto mb-5 border border-amber-500/30">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3M8 10.5v.5" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Project failed to load</h2>
        <p className="text-sm text-[#8899aa] mb-2">
          {error.message || "An unexpected error occurred while loading this project."}
        </p>
        <p className="text-xs text-[#556677] mb-6">
          This might be a temporary issue. Try again or go back to your projects.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[#2a5580] text-white hover:bg-[#3a6a90] transition-colors"
          >
            Try Again
          </button>
          <a
            href="/projects"
            className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[#1a2a3e] text-[#8899aa] hover:text-white transition-colors"
          >
            Back to Projects
          </a>
        </div>
      </div>
    </div>
  );
}
