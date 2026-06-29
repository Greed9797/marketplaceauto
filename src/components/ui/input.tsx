import * as React from "react";

import { cn } from "@/lib/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, id, ...props }, ref) => {
    const inputId = id ?? props.name;

    return (
      <label className="grid gap-2 text-[var(--text-primary)]">
        {label ? (
          <span className="text-caption text-[var(--text-tertiary)]">{label}</span>
        ) : null}
        <input
          id={inputId}
          className={cn(
            "h-10 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition duration-200 placeholder:text-[var(--text-tertiary)] focus:border-[var(--w3-red)] focus:ring-[3px] focus:ring-[var(--w3-red-bg)] disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]",
            className,
          )}
          ref={ref}
          {...props}
        />
      </label>
    );
  },
);
Input.displayName = "Input";

export { Input };
