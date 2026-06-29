import { cn } from "@/lib/utils/cn";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-[var(--bg-elevated)]", className)}
      {...props}
    />
  );
}
