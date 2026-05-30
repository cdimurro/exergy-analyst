"use client";

import { useState } from "react";
import Link from "next/link";
/* eslint-disable @next/next/no-img-element */
import { Button } from "@/components/ui/custom/Button";
import { UserMenu } from "./UserMenu";

function useOptionalSession() {
  try {
    const { useSession } = require("next-auth/react");
    const result = useSession();
    return result;
  } catch {
    return { data: null, status: "unauthenticated" as const };
  }
}

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "My Projects", href: "/projects" },
  { label: "Blog", href: "/blog" },
  { label: "Contact", href: "/contact" },
];

export function Navbar() {
  const { data: session, status } = useOptionalSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 h-16 border-b border-[var(--border)] bg-[var(--bg-primary)]/85 backdrop-blur-xl">
      <div className="w-full h-full flex items-center justify-between px-6 sm:px-10 lg:px-16">
        {/* Left — Logo */}
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="Exergy Lab" className="h-10 w-auto" style={{ filter: "drop-shadow(0 0 2px rgba(255,255,255,0.2))" }} />
        </Link>

        {/* Center — Nav links (desktop) */}
        <nav className="hidden md:flex items-center gap-15">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[16px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right — Auth */}
        <div className="flex items-center gap-3">
          {status === "loading" ? (
            <div className="w-20 h-8 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
          ) : session?.user ? (
            <>
              <Link href="/">
                <Button variant="primary" size="sm">New Project</Button>
              </Link>
              <UserMenu
                name={session.user.name || ""}
                email={session.user.email || ""}
                tier={(session.user as any).tier || "free"}
              />
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">Log In</Button>
              </Link>
              <Link href="/signup">
                <Button variant="primary" size="sm">Sign Up</Button>
              </Link>
            </>
          )}

          {/* Mobile menu button */}
          <button
            className="md:hidden p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {mobileOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <><path d="M3 5h14" /><path d="M3 10h14" /><path d="M3 15h14" /></>}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3 space-y-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block text-[14px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] py-1.5"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
