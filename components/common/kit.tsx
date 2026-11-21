"use client";

import React from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn, clockLabel } from "@/lib/utils";
import { SPEEDS, useSim } from "@/lib/sim/runtime";
import { congestionLevel } from "@/lib/sim/traffic";

/** Headline number with a label and one line of context. No chart. */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-hair bg-surface px-4 py-3.5", className)}>
      <p className="flex items-center gap-1.5 text-[12px] text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span
          className={cn(
            "font-display text-[26px] font-semibold leading-8 tracking-[-0.01em] tabular-nums",
            tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-danger" : "text-ink"
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-[13px] text-muted">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-0.5 text-[12px] leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}

export function LiveBadge({ label = "Live", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 text-[12px] font-medium leading-6 text-danger", className)}>
      <span className="live-dot h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
      {label}
    </span>
  );
}

const FLOW_VAR = { free: "var(--flow-free)", moderate: "var(--flow-moderate)", heavy: "var(--flow-heavy)", jam: "var(--flow-jam)" } as const;

export function flowColor(c: number) {
  return FLOW_VAR[congestionLevel(c).id];
}

/** Congestion status: dot + words, never colour alone. */
export function FlowChip({ value, className }: { value: number; className?: string }) {
  const lvl = congestionLevel(value);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] text-muted", className)}>
      <span className="h-2 w-2 rounded-full" style={{ background: FLOW_VAR[lvl.id] }} aria-hidden="true" />
      {lvl.label}
    </span>
  );
}

export function FlowLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted", className)}>
      {(["free", "moderate", "heavy", "jam"] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full" style={{ background: FLOW_VAR[k] }} />
          {k === "free" ? "Free flow" : k === "moderate" ? "Moderate" : k === "heavy" ? "Heavy" : "Jammed"}
        </span>
      ))}
    </div>
  );
}

/** Simulation clock, play/pause and speed. Shared by every live module. */
export function SimControls({ className }: { className?: string }) {
  const { sim, runtime } = useSim();
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="inline-flex h-9 items-center gap-2 rounded-control border border-hair bg-surface px-3 text-[13px]">
        <span className="text-muted">City time</span>
        <span className="font-semibold tabular-nums text-ink">{clockLabel(sim.t)}</span>
      </span>
      <button
        type="button"
        onClick={() => runtime.setPaused(!runtime.paused)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-hair text-ink transition-colors hover:border-hair-strong hover:bg-surface-raised"
        aria-label={runtime.paused ? "Resume simulation" : "Pause simulation"}
        title={runtime.paused ? "Resume" : "Pause"}
      >
        {runtime.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </button>
      <div className="inline-flex h-9 items-center rounded-control border border-hair p-0.5" role="group" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => runtime.setSpeed(s)}
            aria-pressed={runtime.speed === s}
            className={cn(
              "h-full rounded-[4px] px-2.5 text-[12px] tabular-nums transition-colors",
              runtime.speed === s ? "bg-primary-soft font-medium text-primary" : "text-muted hover:text-ink"
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => runtime.reset()}
        className="inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-[12px] text-muted transition-colors hover:bg-surface-raised hover:text-ink"
        title="Restart the city at 07:25"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset
      </button>
    </div>
  );
}

export function WarmupNotice() {
  const { runtime } = useSim();
  if (!runtime.warmingUp) return null;
  return (
    <div className="mb-4 rounded-card border border-hair bg-surface px-4 py-3 text-[13px] text-muted">
      Warming up the city — simulating the early-morning build-up ({Math.round(runtime.warmupProgress * 100)}%)…
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-sunken">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${runtime.warmupProgress * 100}%` }} />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: { id: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap items-center rounded-control border border-hair p-0.5", className)} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-[4px] px-2.5 text-[12px] transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5",
            value === o.id ? "bg-primary-soft font-medium text-primary" : "text-muted hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint ? <span className="block text-[12px] leading-5 text-muted">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-hair-strong"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-[left]",
            checked ? "left-[18px]" : "left-0.5"
          )}
        />
      </button>
    </label>
  );
}

export function Panel({ title, action, children, className, bodyClassName, description }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; description?: React.ReactNode }) {
  return (
    <section className={cn("rounded-card border border-hair bg-surface", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hair px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-sans text-[14px] font-semibold leading-5 tracking-normal text-ink">{title}</h2>
          {description ? <p className="text-[12px] leading-5 text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
