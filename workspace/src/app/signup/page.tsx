// @ts-nocheck
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/custom/Button";
import { Input } from "@/components/ui/custom/Input";
import { Card } from "@/components/ui/custom/Card";
/* eslint-disable @next/next/no-img-element */

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email.toLowerCase().trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create account.");
        setLoading(false);
        return;
      }

      router.push("/verify-email?email=" + encodeURIComponent(email));
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="Exergy Lab" className="h-12 w-auto mx-auto mb-4" />
          <h1 className="text-[20px] font-bold text-[var(--text-primary)]">Create your account</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1">Start evaluating energy technologies</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[#2a1a1a] border border-[#3a2828] text-[13px] text-[var(--accent-negative)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Full Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
          <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" required />
          <Input label="Confirm Password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm your password" required />

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Create Account
          </Button>
        </form>

        <p className="mt-4 text-[11px] text-[var(--text-dim)] text-center leading-relaxed">
          By creating an account, you agree to our terms of service.
          We uphold the highest levels of privacy and security.
          Your documents and conversations are encrypted and never shared.
        </p>

        <p className="mt-4 text-[13px] text-[var(--text-muted)] text-center">
          Already have an account? <Link href="/login" className="text-[var(--accent-primary)] hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}
