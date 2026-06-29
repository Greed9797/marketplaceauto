import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex min-h-[44px] md:min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-5 py-3 text-sm font-semibold transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--w3-red-bg)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--w3-red)] text-[var(--text-on-red)] hover:bg-[var(--w3-red-hover)]",
        secondary:
          "border border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
        ghost:
          "bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
        destructive:
          "bg-[var(--danger)] text-[var(--text-on-red)] hover:bg-[var(--danger)]",
      },
      size: {
        md: "md:h-10",
        sm: "md:h-9 md:min-h-9 px-3 py-2 text-xs",
        icon: "md:size-10 size-11 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
