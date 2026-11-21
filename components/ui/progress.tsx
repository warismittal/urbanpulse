import React from "react";
import { cn } from "@/lib/utils";

/** Linear progress in mint, used for seat fill and wizard steps. */
export function Progress({
  value,
  max = 100,
  label,
  className,
  tone = "success",
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
  tone?: "success" | "primary";
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300 ease-out",
          tone === "success" ? "bg-success" : "bg-primary"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Segmented seat meter: one block per seat, so "3 of 4 seats filled" is legible
 * at a glance without reading the number.
 */
export function SeatBar({
  taken,
  seats,
  className,
}: {
  taken: number;
  seats: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex gap-1", className)}
      role="img"
      aria-label={`${taken} of ${seats} seats filled`}
    >
      {Array.from({ length: seats }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "h-1 flex-1 rounded-[6px] transition-colors duration-200",
            index < taken ? "bg-primary" : "bg-hair"
          )}
        />
      ))}
    </div>
  );
}
