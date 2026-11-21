import React from "react";
import { Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClasses } from "./button-styles";

/**
 * Empty state: an icon, one line of explanation and the next step.
 * Deliberately flat — no illustration, no medallion, no marketing copy.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  description?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-card border border-dashed border-hair-strong/60 bg-surface/60 px-6 py-12 text-center",
        className
      )}
    >
      {Icon ? <Icon className="mb-3 h-5 w-5 text-muted" /> : null}
      <p className="font-display text-[16px] font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-6">
          {action.href ? (
            <a href={action.href} className={buttonClasses({ variant: "secondary" })}>
              {action.label}
            </a>
          ) : (
            <button type="button" onClick={action.onClick} className={buttonClasses({ variant: "secondary" })}>
              {action.label}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function InlineNote({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "danger" | "info" | "success";
  className?: string;
}) {
  const tones = {
    neutral: "border-hair bg-sunken text-muted",
    info: "border-primary/25 bg-primary-soft text-ink",
    success: "border-success/25 bg-success-soft text-success",
    warning: "border-warning/30 bg-warning-soft text-warning",
    danger: "border-danger/30 bg-danger-soft text-danger",
  } as const;

  const Icon = tone === "warning" ? TriangleAlert : tone === "info" ? Info : null;

  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-control border px-3 py-2 text-[13px] leading-relaxed",
        tones[tone],
        className
      )}
    >
      {Icon ? <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
