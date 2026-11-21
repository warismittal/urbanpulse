"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface LineSeries {
  name: string;
  values: (number | null)[];
  /** CSS colour, usually var(--series-n). */
  color: string;
  dashed?: boolean;
}

export interface Band {
  lo: (number | null)[];
  hi: (number | null)[];
  color: string;
  label: string;
}

/**
 * Small responsive line chart: 2px lines, recessive grid, crosshair + tooltip,
 * optional uncertainty band and a vertical "now" marker. One y-axis only.
 */
export function LineChart({
  series,
  band,
  xLabels,
  height = 200,
  yMin,
  yMax,
  yFormat = (v) => v.toFixed(0),
  nowIndex,
  thresholds,
  className,
  ariaLabel,
}: {
  series: LineSeries[];
  band?: Band;
  xLabels: string[];
  height?: number;
  yMin?: number;
  yMax?: number;
  yFormat?: (v: number) => string;
  nowIndex?: number;
  thresholds?: { value: number; label: string }[];
  className?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = xLabels.length;
  const pad = { l: 40, r: 12, t: 10, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const [lo, hi] = useMemo(() => {
    const all: number[] = [];
    series.forEach((s) => s.values.forEach((v) => v != null && all.push(v)));
    band?.hi.forEach((v) => v != null && all.push(v));
    band?.lo.forEach((v) => v != null && all.push(v));
    thresholds?.forEach((t) => all.push(t.value));
    const mn = yMin ?? (all.length ? Math.min(...all) : 0);
    const mx = yMax ?? (all.length ? Math.max(...all) : 1);
    return mn === mx ? [mn - 1, mx + 1] : [mn, mx];
  }, [series, band, thresholds, yMin, yMax]);

  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => pad.t + h - ((v - lo) / (hi - lo)) * h;

  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null || Number.isNaN(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const bandPath = useMemo(() => {
    if (!band) return "";
    const idx = band.hi.map((v, i) => (v != null && band.lo[i] != null ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return "";
    const top = idx.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(band.hi[i]!)}`).join("");
    const bottom = [...idx].reverse().map((i) => `L${x(i)},${y(band.lo[i]!)}`).join("");
    return `${top}${bottom}Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, width, lo, hi, n]);

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, k) => lo + ((hi - lo) * k) / ticks);
  const xEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {yTicks.map((t, k) => (
          <g key={k}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xLabels.map((l, i) =>
          i % xEvery === 0 ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {l}
            </text>
          ) : null
        )}
        {thresholds?.map((t) => (
          <g key={t.label}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t.value)} y2={y(t.value)} stroke="var(--hair-strong)" strokeDasharray="3 4" />
            <text x={width - pad.r} y={y(t.value) - 4} textAnchor="end" fontSize={10} fill="var(--muted)">
              {t.label}
            </text>
          </g>
        ))}
        {band && bandPath ? <path d={bandPath} fill={band.color} opacity={0.16} /> : null}
        {nowIndex != null && nowIndex >= 0 && nowIndex < n ? (
          <g>
            <line x1={x(nowIndex)} x2={x(nowIndex)} y1={pad.t} y2={pad.t + h} stroke="var(--hair-control)" strokeWidth={1} />
            <text x={x(nowIndex) + 4} y={pad.t + 10} fontSize={10} fill="var(--muted)">
              now
            </text>
          </g>
        ) : null}
        {series.map((s) => (
          <path
            key={s.name}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={s.dashed ? "5 4" : undefined}
          />
        ))}
        {hover != null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke="var(--muted)" strokeWidth={1} opacity={0.5} />
            {series.map((s) =>
              s.values[hover] != null ? (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ) : null
            )}
          </g>
        ) : null}
        <rect
          x={pad.l}
          y={pad.t}
          width={w}
          height={h}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover != null ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[140px] rounded-control border border-hair bg-overlay px-3 py-2 text-[12px] shadow-pop"
          style={{
            left: Math.min(width - 160, Math.max(0, x(hover) + 10)),
            top: 4,
          }}
        >
          <p className="font-medium text-ink">{xLabels[hover]}</p>
          {series.map((s) =>
            s.values[hover] != null ? (
              <p key={s.name} className="mt-0.5 flex items-center justify-between gap-3 text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="tabular-nums text-ink">{yFormat(s.values[hover]!)}</span>
              </p>
            ) : null
          )}
          {band && band.lo[hover] != null ? (
            <p className="mt-0.5 text-muted">
              {band.label}: {yFormat(band.lo[hover]!)}–{yFormat(band.hi[hover]!)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean; swatch?: "line" | "box" }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted", className)}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.swatch === "box" ? (
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          ) : (
            <svg width="16" height="6" aria-hidden="true">
              <line x1="1" x2="15" y1="3" y2="3" stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? "4 3" : undefined} strokeLinecap="round" />
            </svg>
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function Sparkline({ values, color = "var(--series-1)", height = 28, className }: { values: number[]; color?: string; height?: number; className?: string }) {
  if (values.length < 2) return <div style={{ height }} className={className} />;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const W = 100;
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(2)},${(height - 2 - ((v - mn) / (mx - mn || 1)) * (height - 4)).toFixed(2)}`)
    .join("");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal bar row with a label, used for rankings and breakdowns. */
export function BarRow({
  label,
  value,
  max,
  display,
  color = "var(--series-1)",
  hint,
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  display: string;
  color?: string;
  hint?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="group/bar" title={hint}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className="shrink-0 tabular-nums text-muted">{display}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
