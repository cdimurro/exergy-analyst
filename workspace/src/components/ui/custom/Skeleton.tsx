"use client";

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className = "", width, height }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--bg-elevated)] ${className}`}
      style={{ width, height }}
    />
  );
}
