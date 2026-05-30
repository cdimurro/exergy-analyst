"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();
  // Hide footer on workspace pages — workspace has its own full-height layout
  if (pathname?.match(/^\/projects\/[^/]+$/)) return null;

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-primary)]">
      <div className="w-full px-6 sm:px-10 lg:px-16 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="text-[20px] font-semibold text-[var(--text-primary)] mb-3">Exergy Lab</div>
            <p className="text-[16px] text-[var(--text-muted)] leading-relaxed max-w-lg mb-4">
              Evaluate any energy technology across the dimensions that determine commercial success.
              Purpose-built for scientists, engineers, researchers, founders and investors.
            </p>
            <p className="text-[14px] text-white">
              A new engine for accelerating energy innovation and scientific discovery.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-[14px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Product</h4>
            <div className="space-y-3">
              <FooterLink href="/features">Features</FooterLink>
              <FooterLink href="/pricing">Pricing</FooterLink>
              <FooterLink href="/">Create Project</FooterLink>
              <FooterLink href="/blog">Blog</FooterLink>
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-[14px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Company</h4>
            <div className="space-y-3">
              <FooterLink href="/about">About</FooterLink>
              <FooterLink href="/contact">Contact</FooterLink>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block text-[16px] text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors">
      {children}
    </Link>
  );
}
