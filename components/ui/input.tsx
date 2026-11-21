"use client";

import React from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const controlBase =
  "w-full rounded-control border bg-field text-[14px] text-ink transition-colors duration-150 placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-55";
const controlIdle = "border-hair-control hover:border-hair-strong";
const controlError = "border-danger";

/** Label + control + helper or inline error. Every input goes through this. */
export function Field({
  label,
  htmlFor,
  helper,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          className="flex items-start gap-1 text-[12px] font-medium leading-5 text-danger"
        >
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : helper ? (
        <p id={htmlFor ? `${htmlFor}-helper` : undefined} className="text-[12px] leading-5 text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      className={cn(controlBase, "h-10 px-3", invalid ? controlError : controlIdle, className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        controlBase,
        "resize-none py-2.5 leading-relaxed",
        invalid ? controlError : controlIdle,
        className
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label
      className={cn(
        "inline-flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink",
        className
      )}
    >
      <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" {...props} />
      <span>{label}</span>
    </label>
  );
}
