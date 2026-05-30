// @ts-nocheck
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/custom/Card";
import { Button } from "@/components/ui/custom/Button";
/* eslint-disable @next/next/no-img-element */

export default function VerifyEmailPage() {
  return <Suspense><VerifyContent /></Suspense>;
}

function VerifyContent() {
  const params = useSearchParams();
  const email = params.get("email") || "your email";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm p-8 text-center">
        <img src="/logo.png" alt="Exergy Lab" className="h-6 w-auto mx-auto mb-4" />

        <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-[var(--bg-elevated)] flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 5l10 8 10-8" />
          </svg>
        </div>

        <h1 className="text-[20px] font-bold text-[var(--text-primary)] mb-2">Check your email</h1>
        <p className="text-[14px] text-[var(--text-muted)] leading-relaxed mb-6">
          We sent a verification link to <span className="text-[var(--text-secondary)]">{email}</span>.
          Click the link in the email to activate your account.
        </p>

        <p className="text-[12px] text-[var(--text-dim)] mb-6">
          Did not receive it? Check your spam folder.
        </p>

        <Link href="/login">
          <Button variant="secondary" size="md">Back to Sign In</Button>
        </Link>
      </Card>
    </div>
  );
}
