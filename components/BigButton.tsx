"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "success" | "warning" | "ghost";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-[var(--color-primary)] text-[var(--color-primary-fg)] active:bg-[var(--color-primary-active)]",
  secondary:
    "bg-[var(--color-chip-bg)] text-[var(--color-fg)] border-2 border-[var(--color-border)] active:opacity-80",
  success: "bg-[var(--color-success)] text-[var(--color-success-fg)] active:opacity-90",
  warning:
    "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-2 border-[var(--color-warning-border)] active:opacity-80",
  ghost: "bg-transparent text-[var(--color-fg-muted)] underline underline-offset-4",
};

interface BigButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

// 全站统一的大按钮：≥88px 高、字号 ≥20px，满足 PROJECT.md §9 的可点区硬指标。
export function BigButton({
  variant = "primary",
  className = "",
  children,
  disabled,
  ...rest
}: BigButtonProps) {
  return (
    <button
      className={`tap-target focus-ring w-full rounded-2xl px-6 text-[22px] font-semibold leading-snug transition-opacity disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
