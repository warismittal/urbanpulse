import React from "react";
import { cn } from "@/lib/utils";

/**
 * Card: one layer of elevation only. In dark mode the lift comes from a lighter
 * surface plus a hairline border, never a heavy shadow.
 */
export function Card({
  className,
  children,
  as: Tag = "section",
  interactive = false,
}: {
  className?: string;
  children: React.ReactNode;
  as?: "section" | "div" | "article" | "li";
  interactive?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "rounded-card border border-hair bg-surface shadow-card",
        interactive &&
          "group/card transition-colors duration-150 ease-out hover:border-hair-strong hover:bg-surface-raised",
        className
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4 p-6", className)}>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold leading-[26px] text-ink">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-prose text-[13px] leading-5 text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-6 py-4", className)}>{children}</div>;
}

/** Standard page opening: title, one optional line of context, one action. */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-8 pb-6", className)}
    >
      <div className="min-w-0 max-w-[640px]">
        <h1 className="text-[32px] leading-[40px] text-ink">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-[560px] text-[15px] leading-6 text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** Quiet sub-heading used inside cards instead of a second Card wrapper. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("eyebrow", className)}>{children}</p>;
}
