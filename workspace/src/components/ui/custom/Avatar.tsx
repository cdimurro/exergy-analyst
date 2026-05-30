"use client";

interface AvatarProps {
  name?: string;
  size?: number;
  className?: string;
}

export function Avatar({ name = "", size = 32, className = "" }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  return (
    <div
      className={`flex items-center justify-center rounded-full bg-[var(--bg-elevated)] border border-[var(--border-mid)] text-[var(--text-muted)] font-medium shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
