"use client";

type Variant = "default" | "elevated" | "interactive";

interface CardProps {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

const variantStyles: Record<Variant, string> = {
  default: "bg-[var(--bg-card)] border border-[var(--border)]",
  elevated: "bg-[var(--bg-elevated)] border border-[var(--border-mid)] shadow-md",
  interactive: "bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-mid)] hover:bg-[var(--bg-elevated)] cursor-pointer transition-all",
};

export function Card({ variant = "default", className = "", children, onClick }: CardProps) {
  return (
    <div
      className={`rounded-xl ${variantStyles[variant]} ${className}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
