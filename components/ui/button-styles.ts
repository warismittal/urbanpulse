import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger-outline";
export type ButtonSize = "sm" | "md";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-[background-color,border-color,color,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-hover active:brightness-95",
  secondary:
    "border border-hair bg-transparent text-ink hover:border-hair-strong hover:bg-surface-raised active:bg-sunken",
  ghost: "text-muted hover:bg-surface-raised hover:text-ink active:bg-sunken",
  "danger-outline":
    "border border-danger/60 bg-transparent text-danger hover:border-danger hover:bg-danger-soft active:bg-danger-soft active:brightness-95",
};

// 40px is the minimum comfortable touch target; sm stays at 36px only inside
// rows that are themselves 48px tall.
const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
};

/**
 * Shared button recipe. Kept free of "use client" so server components (the
 * 404 page) can use it for links that look like buttons.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(base, variantClasses[variant], sizeClasses[size], className);
}
