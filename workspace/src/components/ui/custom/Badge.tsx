"use client";

type Variant = "default" | "success" | "warning" | "danger" | "tier";

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<Variant, string> = {
  default: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]",
  success: "bg-[#1a2e24] text-[var(--accent-secondary)] border-[#2a4a38]",
  warning: "bg-[#2a2618] text-[var(--accent-caution)] border-[#3a3628]",
  danger: "bg-[#2a1a1a] text-[var(--accent-negative)] border-[#3a2828]",
  tier: "bg-[#1a1e2e] text-[var(--accent-primary)] border-[#2a3248]",
};

export function Badge({ variant = "default", children, className = "" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${variantStyles[variant]} ${className}`}>
      {children}
    </span>
  );
}
