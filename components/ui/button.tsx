"use client";

import React from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buttonClasses,
  type ButtonSize,
  type ButtonVariant,
} from "./button-styles";

export { buttonClasses };
export type { ButtonSize, ButtonVariant };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* Children keep their space so the button never changes width mid-action. */}
      <span className={cn("inline-flex items-center gap-2", loading && "opacity-0")}>{children}</span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}

/** Icon-only button. Always pass a descriptive aria-label. */
export function IconButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-control text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
