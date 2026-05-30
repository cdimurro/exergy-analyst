"use client";

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onRetry, onDismiss }: ErrorBannerProps) {
  return (
    <div className="mx-4 my-3 px-4 py-3 rounded-xl bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 flex items-center gap-3">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" className="shrink-0">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3M8 10.5v.5" />
      </svg>
      <span className="text-sm text-[var(--accent-red)] flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs font-medium text-[var(--accent-red)] hover:text-[var(--accent-red)] px-2 py-1 rounded-lg hover:bg-[var(--accent-red)]/10 transition-colors"
        >
          Retry
        </button>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-xs text-[#556677] hover:text-[#8899aa] px-1"
          aria-label="Dismiss"
        >
          &times;
        </button>
      )}
    </div>
  );
}
