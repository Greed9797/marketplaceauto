import * as React from "react";

import { cn } from "@/lib/utils/cn";

type BadgeTone = "neutral" | "info" | "success" | "danger" | "warning";

const toneClasses: Record<BadgeTone, string> = {
  neutral:
    "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
  info: "border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)]",
  success:
    "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]",
  danger: "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]",
  warning:
    "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small pill for status/platform labels, styled with design-system tokens. */
export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
