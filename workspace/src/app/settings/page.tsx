// @ts-nocheck
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/custom/Button";
import { Input } from "@/components/ui/custom/Input";
import { Card } from "@/components/ui/custom/Card";
import { Badge } from "@/components/ui/custom/Badge";

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");

  if (status === "loading") return null;
  if (!session) {
    router.push("/login");
    return null;
  }

  const user = session.user as any;
  const tier = user?.tier || "free";

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-[24px] font-bold text-[var(--text-primary)] mb-6">Account Settings</h1>

      <div className="space-y-6">
        {/* Profile */}
        <Card className="p-6">
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">Profile</h2>
          <div className="space-y-4">
            <Input label="Name" value={name || user?.name || ""} onChange={(e) => setName(e.target.value)} />
            <Input label="Email" value={user?.email || ""} disabled helper="Email cannot be changed" />
            <div>
              <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Account Tier</label>
              <Badge variant={tier === "pro" ? "success" : tier === "plus" ? "tier" : "default"}>
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
              </Badge>
              {tier !== "pro" && (
                <Link href="/pricing" className="ml-3 text-[12px] text-[var(--accent-primary)] hover:underline">
                  Upgrade
                </Link>
              )}
            </div>
          </div>
        </Card>

        {/* Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/settings/billing">
            <Card variant="interactive" className="p-5">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">Billing</h3>
              <p className="text-[13px] text-[var(--text-muted)]">Manage your subscription and payment method</p>
            </Card>
          </Link>
          <Link href="/settings/vault">
            <Card variant="interactive" className="p-5">
              <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">Memory Vault</h3>
              <p className="text-[13px] text-[var(--text-muted)]">
                {tier === "pro" ? "Store business context for AI analysis" : "Available on Pro plan"}
              </p>
            </Card>
          </Link>
        </div>

        {/* Privacy reminder */}
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <rect x="3" y="8" width="12" height="8" rx="1.5" />
              <path d="M5 8V6a4 4 0 018 0v2" />
            </svg>
            <div>
              <p className="text-[13px] text-[var(--text-secondary)]">
                We uphold the highest levels of privacy and security.
              </p>
              <p className="text-[12px] text-[var(--text-dim)] mt-1">
                Your documents and conversations are encrypted at rest and never stored in our database in plaintext.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
