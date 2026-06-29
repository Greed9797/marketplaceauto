"use client";

import { useEffect, useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

export function HydratedSubmitButton({ disabled, ...props }: ButtonProps) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  return <Button disabled={disabled || !isHydrated} type="submit" {...props} />;
}
