"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { Avatar } from "@/components/ui/custom/Avatar";
import { Badge } from "@/components/ui/custom/Badge";

interface UserMenuProps {
  name: string;
  email: string;
  tier: string;
}

export function UserMenu({ name, email, tier }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const tierVariant = tier === "pro" ? "success" : tier === "plus" ? "tier" : "default";

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
        <Avatar name={name} size={30} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--border-mid)] bg-[var(--bg-card)] shadow-lg overflow-hidden z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <div className="text-[13px] font-medium text-[var(--text-primary)]">{name}</div>
            <div className="text-[11px] text-[var(--text-muted)]">{email}</div>
            <Badge variant={tierVariant} className="mt-1.5">
              {tier.charAt(0).toUpperCase() + tier.slice(1)}
            </Badge>
          </div>

          {/* Links */}
          <div className="py-1.5">
            <MenuLink href="/projects" label="My Projects" onClick={() => setOpen(false)} />
            <MenuLink href="/settings" label="Settings" onClick={() => setOpen(false)} />
            <MenuLink href="/settings/billing" label="Billing" onClick={() => setOpen(false)} />
            {tier === "pro" && (
              <MenuLink href="/settings/vault" label="Memory Vault" onClick={() => setOpen(false)} />
            )}
          </div>

          {/* Sign out */}
          <div className="border-t border-[var(--border)] py-1.5">
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="w-full text-left px-4 py-2 text-[13px] text-[var(--text-muted)] hover:text-[var(--accent-negative)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, label, onClick }: { href: string; label: string; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-4 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
    >
      {label}
    </Link>
  );
}
