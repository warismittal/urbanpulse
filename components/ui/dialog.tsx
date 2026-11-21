"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonClasses, type ButtonVariant } from "./button";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: traps focus, closes on Esc, restores focus on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md";
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () => {
      const node = panelRef.current;
      if (!node) return [] as HTMLElement[];
      return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => focusables()[0]?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]">
      <div className="fixed inset-0 bg-scrim backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full rounded-card border border-hair bg-overlay shadow-pop",
          size === "sm" ? "max-w-md" : "max-w-lg"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-hair px-6 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-[17px] font-semibold leading-snug text-ink">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1.5 -mt-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-raised hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {children ? <div className="px-6 py-4">{children}</div> : null}

        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-hair bg-sunken/60 px-6 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Confirmation dialog — the replacement for window.confirm().
 * For irreversible actions, pass `confirmText` to require typed confirmation.
 */
interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  confirmText?: string;
  pending?: boolean;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  // Mounted only while open, so the typed-confirmation field always starts empty.
  if (!props.open) return null;
  return <ConfirmDialogBody {...props} />;
}

function ConfirmDialogBody({
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "primary",
  confirmText,
  pending = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const blocked = Boolean(confirmText) && typed.trim() !== confirmText;

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClasses({ variant: "ghost" })}>
            Cancel
          </button>
          <Button variant={variant} onClick={onConfirm} disabled={blocked} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-muted">
        <div>{message}</div>
        {confirmText ? (
          <div className="space-y-1.5 pt-1">
            <label htmlFor="confirm-typing" className="block text-[13px] font-medium text-ink">
              Type <span className="font-mono text-primary">{confirmText}</span> to confirm
            </label>
            <input
              id="confirm-typing"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="h-10 w-full rounded-control border border-hair-control bg-field px-3 text-sm text-ink transition-colors hover:border-hair-strong focus:border-primary"
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
