"use client";

import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, className = "", id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s/g, "-");
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-[13px] font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full bg-[var(--bg-secondary)] border rounded-lg px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] transition-all focus:outline-none ${
            error
              ? "border-[var(--accent-negative)] focus:border-[var(--accent-negative)]"
              : "border-[var(--border)] focus:border-[var(--accent-primary)]"
          } ${className}`}
          {...props}
        />
        {error && <p className="text-[12px] text-[var(--accent-negative)]">{error}</p>}
        {helper && !error && <p className="text-[12px] text-[var(--text-dim)]">{helper}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
