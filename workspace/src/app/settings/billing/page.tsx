// @ts-nocheck
"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/custom/Button";
import { Card } from "@/components/ui/custom/Card";
import { Badge } from "@/components/ui/custom/Badge";

export default function BillingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [usage, setUsage] = useState({ chat_messages: 0, analyses: 0, projects: 0 });

  useEffect(() => {
    fetch("/api/billing/usage")
      .then(r => r.json())
      .then(data => setUsage(data))
      .catch(() => {});
  }, []);

  if (status === "loading") return null;
  if (!session) { router.push("/login"); return null; }

  const tier = (session.user as any)?.tier || "free";

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Link href="/settings" className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          Settings
        </Link>
        <span className="text-[var(--text-dim)] mx-2">/</span>
        <span className="text-[13px] text-[var(--text-primary)]">Billing</span>
      </div>

      <h1 className="text-[24px] font-bold text-[var(--text-primary)] mb-6">Billing</h1>

      <div className="space-y-6">
        {/* Current plan */}
        <Card className="p-6">
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-3">Current Plan</h2>
          <div className="flex items-center gap-3 mb-4">
            <Badge variant={tier === "pro" ? "success" : tier === "plus" ? "tier" : "default"}>
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </Badge>
            <span className="text-[14px] text-[var(--text-secondary)]">
              {tier === "free" ? "$0/month" : tier === "plus" ? "$19/month" : "$99/month"}
            </span>
          </div>
          {tier === "free" && (
            <p className="text-[13px] text-[var(--text-muted)] mb-4">
              Upgrade to unlock full extraction, decision briefs, and more.
            </p>
          )}
          <div className="flex gap-3">
            {tier !== "pro" && (
              <Link href="/pricing">
                <Button variant="primary" size="sm">Upgrade Plan</Button>
              </Link>
            )}
          </div>
        </Card>

        {/* Usage */}
        <Card className="p-6">
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-3">Usage This Period</h2>
          <div className="space-y-3">
            <UsageMeter label="AI Messages" used={usage.chat_messages} limit={tier === "free" ? 5 : -1} />
            <UsageMeter label="Analyses" used={usage.analyses} limit={tier === "free" ? 1 : tier === "plus" ? 5 : -1} />
            <UsageMeter label="Projects" used={usage.projects} limit={tier === "free" ? 3 : tier === "plus" ? 50 : -1} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
        <span className="text-[12px] text-[var(--text-muted)]">
          {used} / {unlimited ? "Unlimited" : limit}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--accent-primary)] transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
