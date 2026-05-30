"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080c16] px-6">
      <div className="text-center max-w-md">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-600/20 flex items-center justify-center mx-auto mb-5 border border-red-500/30">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3M8 10.5v.5" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-[#8899aa] mb-6">
          An unexpected error occurred. This has been logged and we&apos;re looking into it.
        </p>
        <button
          onClick={reset}
          className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[#2a5580] text-white hover:bg-[#3a6a90] transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
