"use client";

import React, { useEffect, useRef, useState } from "react";
import { CAMERA_NODES, EDGES, MAP_H, MAP_W, NODES, POIS, SECTORS, BLOCK, METRES_PER_UNIT } from "@/lib/city/model";
import { getSim } from "@/lib/sim/runtime";
import { INSET, congestionLevel, edgePoint } from "@/lib/sim/traffic";
import { cssVar } from "@/lib/utils";

export interface TrafficLayers {
  heat: boolean;
  vehicles: boolean;
  signals: boolean;
  cameras: boolean;
}

interface Palette {
  ground: string;
  block: string;
  green: string;
  water: string;
  industrial: string;
  road: string;
  arterial: string;
  car: string;
  bus: string;
  truck: string;
  flow: string[];
  muted: string;
  ink: string;
  danger: string;
  primary: string;
  surface: string;
}

function readPalette(): Palette {
  return {
    ground: cssVar("--map-ground"),
    block: cssVar("--map-block"),
    green: cssVar("--map-green"),
    water: cssVar("--map-water"),
    industrial: cssVar("--map-industrial"),
    road: cssVar("--map-road"),
    arterial: cssVar("--map-arterial"),
    car: cssVar("--ink"),
    bus: cssVar("--series-1"),
    truck: cssVar("--muted"),
    flow: [cssVar("--flow-free"), cssVar("--flow-moderate"), cssVar("--flow-heavy"), cssVar("--flow-jam")],
    muted: cssVar("--muted"),
    ink: cssVar("--ink"),
    danger: cssVar("--danger"),
    primary: cssVar("--primary"),
    surface: cssVar("--surface"),
  };
}

const LEVEL_INDEX = { free: 0, moderate: 1, heavy: 2, jam: 3 } as const;

/**
 * Live canvas view of the whole network: roads coloured by congestion,
 * every vehicle as a dot, signal heads at each junction, ambulances flashing.
 */
export function TrafficCanvas({
  layers,
  selectedNode,
  onPickNode,
  onPickPoint,
  pickMode,
  className,
}: {
  layers: TrafficLayers;
  selectedNode?: number | null;
  onPickNode?: (node: number) => void;
  onPickPoint?: (x: number, y: number) => void;
  pickMode?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layersRef = useRef(layers);
  const selRef = useRef(selectedNode);
  const [hover, setHover] = useState<{ x: number; y: number; edge: number } | null>(null);
  const hoverRef = useRef<number | null>(null);

  useEffect(() => {
    layersRef.current = layers;
    selRef.current = selectedNode;
  }, [layers, selectedNode]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let palette = readPalette();
    let frame = 0;
    let scale = 1;

    const resize = () => {
      const w = wrap.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      scale = w / MAP_W;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(MAP_H * scale * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${MAP_H * scale}px`;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const mo = new MutationObserver(() => (palette = readPalette()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    const draw = () => {
      raf = requestAnimationFrame(draw);
      frame++;
      const sim = getSim();
      const L = layersRef.current;
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      for (const s of SECTORS) {
        ctx.fillStyle = s.use === "green" ? palette.green : s.use === "water" ? palette.water : s.use === "industrial" ? palette.industrial : palette.block;
        roundRect(ctx, s.x + 9, s.y + 9, BLOCK - 18, BLOCK - 18, 6);
        ctx.fill();
      }
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillStyle = palette.muted;
      ctx.globalAlpha = 0.8;
      for (const s of SECTORS) ctx.fillText(s.name.startsWith("Sector") ? String(s.number) : s.name, s.x + 15, s.y + 24);
      ctx.globalAlpha = 1;

      // Roads, then congestion on each carriageway.
      ctx.lineCap = "round";
      for (const e of EDGES) {
        if (e.from > e.to) continue;
        const a = NODES[e.from];
        const b = NODES[e.to];
        ctx.strokeStyle = e.arterial ? palette.arterial : palette.road;
        ctx.lineWidth = e.arterial ? 11 : 8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      if (L.heat) {
        ctx.lineCap = "butt";
        for (const e of EDGES) {
          const c = sim.congestion[e.id];
          const lvl = congestionLevel(c).id;
          const [x1, y1] = edgePoint(e.id, INSET, e.arterial ? 3.2 : 2.2);
          const [x2, y2] = edgePoint(e.id, e.length - INSET, e.arterial ? 3.2 : 2.2);
          ctx.strokeStyle = palette.flow[LEVEL_INDEX[lvl]];
          ctx.globalAlpha = sim.blocked[e.id] ? 1 : 0.35 + Math.min(0.6, c);
          ctx.lineWidth = e.arterial ? 4 : 3;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // Blocked roads.
      for (const e of EDGES) {
        if (!sim.blocked[e.id]) continue;
        const [x, y] = edgePoint(e.id, e.length / 2, 3);
        ctx.fillStyle = palette.danger;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = palette.surface;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3);
        ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3);
        ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
      }

      // Hospitals for context.
      for (const p of POIS) {
        if (p.kind !== "hospital") continue;
        ctx.fillStyle = palette.danger;
        roundRect(ctx, p.x - 7, p.y - 7, 14, 14, 3);
        ctx.fill();
        ctx.fillStyle = palette.surface;
        ctx.fillRect(p.x - 1.5, p.y - 4.5, 3, 9);
        ctx.fillRect(p.x - 4.5, p.y - 1.5, 9, 3);
      }

      if (L.vehicles) {
        const veh = sim.vehicles;
        ctx.globalAlpha = 0.9;
        for (let i = 0; i < veh.length; i++) {
          const v = veh[i];
          if (!v || !v.alive || v.kind === 3) continue;
          const lane = EDGES[v.edge].lanes > 1 && v.id % 2 ? 5.2 : 3.2;
          const [x, y] = edgePoint(v.edge, v.s, EDGES[v.edge].arterial ? lane : 2.4);
          ctx.fillStyle = v.kind === 1 ? palette.bus : v.kind === 2 ? palette.truck : palette.car;
          const sz = v.kind === 0 ? 1.7 : 2.6;
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
        ctx.globalAlpha = 1;
      }

      if (L.signals) {
        for (const n of NODES) {
          if (!sim.signalised[n.id]) continue;
          const amber = sim.amber[n.id] > 0;
          const vGreen = !amber && sim.phase[n.id] === 0;
          const hGreen = !amber && sim.phase[n.id] === 1;
          const col = (g: boolean) => (amber ? palette.flow[1] : g ? palette.flow[0] : palette.flow[3]);
          ctx.fillStyle = col(vGreen);
          ctx.fillRect(n.x - 1.5, n.y - 8, 3, 3);
          ctx.fillRect(n.x - 1.5, n.y + 5, 3, 3);
          ctx.fillStyle = col(hGreen);
          ctx.fillRect(n.x - 8, n.y - 1.5, 3, 3);
          ctx.fillRect(n.x + 5, n.y - 1.5, 3, 3);
          if (sim.preemptUntil[n.id] > sim.tick) {
            ctx.strokeStyle = palette.danger;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(n.x, n.y, 12 + (frame % 20) / 3, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      if (L.cameras) {
        for (const c of CAMERA_NODES) {
          const n = NODES[c.node];
          ctx.strokeStyle = palette.primary;
          ctx.lineWidth = selRef.current === c.node ? 3 : 1.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, selRef.current === c.node ? 16 : 13, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Ambulances, route ahead highlighted.
      for (const m of sim.missions) {
        if (m.arrivedAt !== undefined) continue;
        const v = sim.vehicles[m.vehicle];
        if (!v?.alive) continue;
        ctx.strokeStyle = palette.danger;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        const [sx, sy] = edgePoint(v.edge, v.s, 0);
        ctx.moveTo(sx, sy);
        for (let k = (v.routeIdx ?? 0); k < m.route.length; k++) {
          const e = EDGES[m.route[k]];
          ctx.lineTo(NODES[e.to].x, NODES[e.to].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const pick = NODES[m.pickupNode];
        if (m.pickedUpAt === undefined) {
          ctx.fillStyle = palette.danger;
          ctx.beginPath();
          ctx.arc(pick.x, pick.y, 5 + (frame % 30) / 6, 0, Math.PI * 2);
          ctx.globalAlpha = 0.4;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const [x, y] = edgePoint(v.edge, v.s, 2.5);
        const flash = Math.floor(frame / 8) % 2 === 0;
        ctx.fillStyle = flash ? palette.danger : palette.surface;
        ctx.strokeStyle = palette.danger;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Hover highlight.
      const he = hoverRef.current;
      if (he != null) {
        const [x1, y1] = edgePoint(he, INSET, 3);
        const [x2, y2] = edgePoint(he, EDGES[he].length - INSET, 3);
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const toMap = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = MAP_W / rect.width;
    return [(e.clientX - rect.left) * k, (e.clientY - rect.top) * k] as const;
  };

  const onMove = (e: React.MouseEvent) => {
    const [mx, my] = toMap(e);
    let best = -1;
    let bestD = 9;
    for (const ed of EDGES) {
      const [x1, y1] = edgePoint(ed.id, INSET, 3);
      const [x2, y2] = edgePoint(ed.id, ed.length - INSET, 3);
      const d = distToSeg(mx, my, x1, y1, x2, y2);
      if (d < bestD) (bestD = d), (best = ed.id);
    }
    hoverRef.current = best >= 0 ? best : null;
    const rect = canvasRef.current!.getBoundingClientRect();
    setHover(best >= 0 ? { x: e.clientX - rect.left, y: e.clientY - rect.top, edge: best } : null);
  };

  const onClick = (e: React.MouseEvent) => {
    const [mx, my] = toMap(e);
    if (pickMode && onPickPoint) {
      onPickPoint(mx, my);
      return;
    }
    if (!onPickNode) return;
    let best = -1;
    let bestD = 22;
    for (const n of NODES) {
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d < bestD) (bestD = d), (best = n.id);
    }
    if (best >= 0) onPickNode(best);
  };

  const sim = getSim();
  const he = hover ? EDGES[hover.edge] : null;

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        className={pickMode ? "block cursor-crosshair rounded-card" : "block cursor-pointer rounded-card"}
        onMouseMove={onMove}
        onMouseLeave={() => {
          hoverRef.current = null;
          setHover(null);
        }}
        onClick={onClick}
        role="img"
        aria-label="Live traffic map. Roads are coloured by congestion; dots are vehicles."
      />
      {hover && he ? (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-control border border-hair bg-overlay px-3 py-2 text-[12px] shadow-pop"
          style={{ left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 600) - 230), top: hover.y + 14 }}
        >
          <p className="font-medium text-ink">{he.name}</p>
          <p className="text-muted">
            {he.dir === "h" ? (NODES[he.to].x > NODES[he.from].x ? "Eastbound" : "Westbound") : NODES[he.to].y > NODES[he.from].y ? "Southbound" : "Northbound"} ·{" "}
            {he.lanes} lane{he.lanes > 1 ? "s" : ""} · {(he.length * METRES_PER_UNIT) / 1000} km
          </p>
          <p className="mt-1 flex justify-between text-muted">
            <span>Congestion</span>
            <span className="text-ink">
              {congestionLevel(sim.congestion[he.id]).label} ({Math.round(sim.congestion[he.id] * 100)}%)
            </span>
          </p>
          <p className="flex justify-between text-muted">
            <span>Vehicles / queued</span>
            <span className="tabular-nums text-ink">
              {sim.edgeCount[he.id]} / {sim.edgeStopped[he.id]}
            </span>
          </p>
          <p className="flex justify-between text-muted">
            <span>Mean speed</span>
            <span className="tabular-nums text-ink">{Math.round(sim.edgeSpeed[he.id] * METRES_PER_UNIT * 3.6)} km/h</span>
          </p>
          {sim.blocked[he.id] ? <p className="mt-1 font-medium text-danger">Closed — incident</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
