// @ts-nocheck
"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/custom/Button";
import { Input } from "@/components/ui/custom/Input";
import { Card } from "@/components/ui/custom/Card";
/* eslint-disable @next/next/no-img-element */

export default function LoginPage() {
  return <Suspense><LoginContent /></Suspense>;
}

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const verified = params.get("verified") === "true";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email: email.toLowerCase().trim(),
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password. Please try again.");
    } else {
      router.push("/projects");
    }
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="Exergy Lab" className="h-12 w-auto mx-auto mb-4" />
          <h1 className="text-[20px] font-bold text-[var(--text-primary)]">Welcome back</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1">Sign in to your account</p>
        </div>

        {verified && (
          <div className="mb-4 p-3 rounded-lg bg-[#1a2e24] border border-[#2a4a38] text-[13px] text-[var(--accent-secondary)]">
            Email verified successfully. You can now sign in.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[#2a1a1a] border border-[#3a2828] text-[13px] text-[var(--accent-negative)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
          />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Sign In
          </Button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <p className="text-[13px] text-[var(--text-muted)]">
            No account? <Link href="/signup" className="text-[var(--accent-primary)] hover:underline">Sign up</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
