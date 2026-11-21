"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Native select with a custom chevron, so it looks the same in every browser. */
export function Select({ className, invalid, children, ...props }: SelectProps) {
  return (
    <span className={cn("relative block w-full", className)}>
      <select
        className={cn(
          "h-10 w-full appearance-none rounded-control border bg-field pl-3 pr-9 text-[14px] text-ink transition-colors duration-150",
          "hover:border-hair-strong hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-55",
          invalid ? "border-danger" : "border-hair-control"
        )}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </span>
  );
}

export function SelectField({
  label,
  id,
  helper,
  error,
  children,
  className,
}: {
  label: string;
  id: string;
  helper?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <Select id={id} invalid={Boolean(error)}>
        {children}
      </Select>
      {error ? (
        <p className="text-[12px] font-medium text-danger">{error}</p>
      ) : helper ? (
        <p className="text-[12px] text-muted">{helper}</p>
      ) : null}
    </div>
  );
}
