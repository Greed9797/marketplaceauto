import * as React from "react";

import { cn } from "@/lib/utils/cn";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <section
      className={cn(
        "rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm transition-shadow duration-200 hover:shadow-md",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("mb-5 flex items-center justify-between gap-4", className)} ref={ref} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      className={cn("text-caption text-[var(--text-tertiary)]", className)}
      ref={ref}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div className={cn(className)} ref={ref} {...props} />,
);
CardContent.displayName = "CardContent";

export { Card, CardContent, CardHeader, CardTitle };
