"use client";

import { Button } from "./Button";

interface UpgradePromptProps {
  feature: string;
  message?: string;
  tier?: "plus" | "pro";
}

export function UpgradePrompt({ feature, message, tier = "plus" }: UpgradePromptProps) {
  const price = tier === "pro" ? "$99" : "$19";
  const tierName = tier === "pro" ? "Pro" : "Plus";

  return (
    <div className="rounded-xl border border-[var(--border-mid)] bg-[var(--bg-card)] p-5 text-center">
      <div className="mx-auto mb-3 w-10 h-10 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 1v18M6 5l4-4 4 4" />
        </svg>
      </div>
      <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">
        {feature} requires {tierName}
      </h3>
      <p className="text-[13px] text-[var(--text-muted)] mb-4 max-w-sm mx-auto">
        {message || `Upgrade to ${tierName} (${price}/month) to unlock ${feature.toLowerCase()} and more.`}
      </p>
      <div className="flex items-center justify-center gap-3">
        <Button variant="primary" size="sm" onClick={() => window.location.href = "/pricing"}>
          View Plans
        </Button>
        <Button variant="ghost" size="sm" onClick={() => window.location.href = "/signup"}>
          Sign Up Free
        </Button>
      </div>
    </div>
  );
}
