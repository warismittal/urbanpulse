"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/** Underline tabs with roving focus and arrow-key navigation. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  ariaLabel = "Sections",
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (index: number, direction: number) => {
    if (items.length === 0) return;
    const next = (index + direction + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex h-14 items-stretch gap-6 overflow-x-auto border-b border-hair [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                refs.current[0]?.focus();
                onChange(items[0].id);
              } else if (event.key === "End") {
                event.preventDefault();
                const last = items.length - 1;
                refs.current[last]?.focus();
                onChange(items[last].id);
              }
            }}
            className={cn(
              "relative flex h-14 shrink-0 items-center gap-2 whitespace-nowrap text-[14px] transition-colors duration-150",
              "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:content-['']",
              active
                ? "font-medium text-ink after:bg-primary"
                : "text-muted after:bg-transparent hover:text-ink"
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span className="text-[13px] font-normal tabular-nums text-muted">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
