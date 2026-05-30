"use client";

import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantStyles: Record<Variant, string> = {
  primary: "bg-[var(--accent-primary)] text-white hover:bg-[#5d7192]",
  secondary: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-mid)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]",
  ghost: "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]",
  danger: "bg-[var(--accent-negative)] text-white hover:bg-[#7a4e4e]",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-4 py-2 text-[16px]",
  md: "px-4 py-2 text-[13px]",
  lg: "px-6 py-2.5 text-[14px]",
};

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, children, className = "", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all ${variantStyles[variant]} ${sizeStyles[size]} ${disabled || loading ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${className}`}
        {...props}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
