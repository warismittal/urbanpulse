import React from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger" | "info";

/** Soft tint only: a chip is a label, not another bordered box. */
const toneClasses: Record<ChipTone, string> = {
  neutral: "bg-surface-raised text-muted",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/** Small labelled chip. Status is never colour-only: it always carries words. */
export function Chip({
  tone = "neutral",
  className,
  icon,
  children,
}: {
  tone?: ChipTone;
  className?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 text-[12px] font-medium leading-6",
        toneClasses[tone],
        className
      )}
    >
      {icon ? <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span> : null}
      {children}
    </span>
  );
}

/** Skill / requirement tag. */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center whitespace-nowrap rounded-[6px] bg-surface-raised px-3 text-[13px] leading-5 text-ink group-hover/card:bg-surface group-hover/row:bg-surface",
        className
      )}
    >
      {children}
    </span>
  );
}

const DOT_TONES: Record<ChipTone, string> = {
  neutral: "bg-muted",
  primary: "bg-primary",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

function Dot({ tone }: { tone: ChipTone }) {
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_TONES[tone])} aria-hidden="true" />;
}

/** Quiet dot-and-word status, used inside dense rows. Never colour-only. */
export function StatusDot({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] leading-5 text-muted">
      <Dot tone={tone} />
      {children}
    </span>
  );
}
