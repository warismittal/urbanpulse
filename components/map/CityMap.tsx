"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { EDGES, MAP_H, MAP_W, NODES, POIS, SECTORS, BLOCK, type PoiKind } from "@/lib/city/model";
import { cn } from "@/lib/utils";

const USE_FILL: Record<string, string> = {
  green: "var(--map-green)",
  water: "var(--map-water)",
  industrial: "var(--map-industrial)",
};

export const POI_GLYPH: Record<PoiKind, { letter: string; color: string }> = {
  hospital: { letter: "H", color: "var(--danger)" },
  police: { letter: "P", color: "var(--info)" },
  fire: { letter: "F", color: "var(--accent)" },
  shelter: { letter: "S", color: "var(--success)" },
};

/**
 * Static SVG base map of the city. Overlays are passed as children and drawn
 * in map units (viewBox 1040 x 800).
 */
export function CityMap({
  children,
  under,
  onMapClick,
  showLabels = true,
  showPois = [],
  highlightSector,
  dimSectors = false,
  className,
  ariaLabel = "City map",
  cursor,
}: {
  children?: React.ReactNode;
  /** Drawn above the ground but below roads (fields, heatmaps). */
  under?: React.ReactNode;
  onMapClick?: (x: number, y: number) => void;
  showLabels?: boolean;
  showPois?: PoiKind[];
  highlightSector?: number | null;
  dimSectors?: boolean;
  className?: string;
  ariaLabel?: string;
  cursor?: "crosshair" | "pointer";
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMapClick || !svgRef.current) return;
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    onMapClick(p.x, p.y);
  };
  const pois = POIS.filter((p) => showPois.includes(p.kind));
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className={cn("block h-auto w-full select-none rounded-card bg-[var(--map-ground)]", cursor === "crosshair" && "cursor-crosshair", cursor === "pointer" && "cursor-pointer", className)}
      role="img"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {SECTORS.map((s) => (
        <rect
          key={s.id}
          x={s.x + 9}
          y={s.y + 9}
          width={BLOCK - 18}
          height={BLOCK - 18}
          rx={6}
          fill={USE_FILL[s.use] ?? "var(--map-block)"}
          opacity={dimSectors ? 0.55 : 1}
        />
      ))}
      {under}
      {EDGES.filter((e) => e.from < e.to).map((e) => {
        const a = NODES[e.from];
        const b = NODES[e.to];
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={e.arterial ? "var(--map-arterial)" : "var(--map-road)"}
            strokeWidth={e.arterial ? 9 : 6}
            strokeLinecap="round"
          />
        );
      })}
      {highlightSector != null ? (
        <rect
          x={SECTORS[highlightSector].x + 6}
          y={SECTORS[highlightSector].y + 6}
          width={BLOCK - 12}
          height={BLOCK - 12}
          rx={8}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={3}
        />
      ) : null}
      {showLabels
        ? SECTORS.map((s) => (
            <text
              key={s.id}
              x={s.x + 16}
              y={s.y + 26}
              fontSize={11}
              fill="var(--muted)"
              style={{ pointerEvents: "none" }}
            >
              {s.name.startsWith("Sector") ? s.number : s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name}
            </text>
          ))
        : null}
      {pois.map((p) => (
        <PoiMarker key={p.id} kind={p.kind} x={p.x} y={p.y} title={p.name} />
      ))}
      {children}
    </svg>
  );
}

export function PoiMarker({ kind, x, y, title, size = 15 }: { kind: PoiKind; x: number; y: number; title?: string; size?: number }) {
  const g = POI_GLYPH[kind];
  return (
    <g transform={`translate(${x},${y})`}>
      {title ? <title>{title}</title> : null}
      <rect x={-size / 2} y={-size / 2} width={size} height={size} rx={4} fill={g.color} stroke="var(--surface)" strokeWidth={2} />
      <text y={4} textAnchor="middle" fontSize={size * 0.68} fontWeight={700} fill="var(--surface)">
        {g.letter}
      </text>
    </g>
  );
}

/**
 * Renders a scalar field (rows x cols, values 0..1 after `normalise`) into an
 * <image> overlay. Colour is a function of the value, alpha fades out at low values.
 */
export function FieldImage({
  field,
  cols,
  rows,
  color,
  opacity = 0.75,
}: {
  field: Float32Array | number[];
  cols: number;
  rows: number;
  color: (v: number) => [number, number, number, number];
  opacity?: number;
}) {
  const [url, setUrl] = useState<string>("");
  const canvas = useMemo(() => (typeof document !== "undefined" ? document.createElement("canvas") : null), []);
  useEffect(() => {
    if (!canvas) return;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      const [r, g, b, a] = color(field[i]);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    setUrl(canvas.toDataURL());
  }, [canvas, field, cols, rows, color]);
  if (!url) return null;
  return <image href={url} x={0} y={0} width={MAP_W} height={MAP_H} opacity={opacity} preserveAspectRatio="none" style={{ imageRendering: "auto", pointerEvents: "none" }} />;
}

/** Map-space grid used by all field layers: 104 x 80 cells (10 units = 50 m each). */
export const FIELD_COLS = 104;
export const FIELD_ROWS = 80;
export const FIELD_CELL = MAP_W / FIELD_COLS; // 10

export function fieldCellCentre(i: number) {
  const c = i % FIELD_COLS;
  const r = Math.floor(i / FIELD_COLS);
  return [c * FIELD_CELL + FIELD_CELL / 2, r * FIELD_CELL + FIELD_CELL / 2] as const;
}
