import React from "react";
import { cn } from "@/lib/utils";

/** Skeleton block. Compose page-level skeletons from these. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[6px] bg-surface-raised", className)} aria-hidden="true" />;
}

/** Placeholder rows matching the compact Discover list. */
export function RowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <li
          key={index}
          className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-4 border-b border-hair px-4 py-4 last:border-b-0"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-4 w-16" />
        </li>
      ))}
    </ul>
  );
}

/** Placeholder cards matching the Groups grid. */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-card border border-hair bg-surface p-6">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-5 w-48" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
          <Skeleton className="mt-4 h-7 w-full" />
          <div className="mt-6 flex items-center gap-3 border-t border-hair pt-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="ml-auto h-9 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder rows matching the Requests inbox. */
export function InboxSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <li
          key={index}
          className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 border-b border-hair py-6 last:border-b-0 md:grid-cols-[40px_minmax(0,1fr)_auto]"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2.5">
            <Skeleton className="h-3.5 w-64" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Skeleton className="hidden h-9 w-60 md:block" />
        </li>
      ))}
    </ul>
  );
}
