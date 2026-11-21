"use client";

import React, { useEffect, useRef, useState } from "react";
import { EDGES, NETWORK, NODES } from "@/lib/city/model";
import { getSim } from "@/lib/sim/runtime";
import { cvCongestion, detectAtNode, type Detection } from "@/lib/sim/vision";
import { cssVar } from "@/lib/utils";

const RADIUS = 30;

/**
 * Junction camera with a detector overlay: bounding boxes, class + confidence,
 * stop-line queue counts per approach. Rendered at ~12 fps like a real feed.
 */
export function CameraFeed({ node, name, onStats }: { node: number; name: string; onStats?: (s: ReturnType<typeof cvCongestion>) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const statsRef = useRef(onStats);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    statsRef.current = onStats;
  }, [onStats]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const W = 480;
    const H = 360;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    let frame = 0;
    let lastFps = performance.now();
    let frames = 0;
    const n = NODES[node];
    const k = H / (RADIUS * 2);
    const ox = W / 2 - n.x * k;
    const oy = H / 2 - n.y * k;
    const primary = cssVar("--primary", "#8ccba5");
    const danger = cssVar("--danger", "#f08a80");
    const timer = window.setInterval(() => {
      frame++;
      frames++;
      const sim = getSim();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Camera image: greyscale tarmac, kerbs and lane paint.
      ctx.fillStyle = "#1b1d1c";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#2a2d2b";
      for (const eid of [...NETWORK.inEdges[node], ...NETWORK.outEdges[node]]) {
        const e = EDGES[eid];
        const a = NODES[e.from];
        const b = NODES[e.to];
        const half = (e.arterial ? 7 : 5) * k;
        if (e.dir === "h") ctx.fillRect(Math.min(a.x, b.x) * k + ox, n.y * k + oy - half, Math.abs(b.x - a.x) * k, half * 2);
        else ctx.fillRect(n.x * k + ox - half, Math.min(a.y, b.y) * k + oy, half * 2, Math.abs(b.y - a.y) * k);
      }
      ctx.strokeStyle = "#8a8f8b";
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W / 2 - 7 * k, H / 2);
      ctx.moveTo(W / 2 + 7 * k, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H / 2 - 7 * k);
      ctx.moveTo(W / 2, H / 2 + 7 * k);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);
      // Stop lines.
      ctx.strokeStyle = "#d8dcd8";
      ctx.lineWidth = 2;
      const sl = 7 * k;
      ctx.beginPath();
      ctx.moveTo(W / 2 - sl, H / 2 - sl);
      ctx.lineTo(W / 2, H / 2 - sl);
      ctx.moveTo(W / 2, H / 2 + sl);
      ctx.lineTo(W / 2 + sl, H / 2 + sl);
      ctx.moveTo(W / 2 - sl, H / 2);
      ctx.lineTo(W / 2 - sl, H / 2 + sl);
      ctx.moveTo(W / 2 + sl, H / 2 - sl);
      ctx.lineTo(W / 2 + sl, H / 2);
      ctx.stroke();

      const dets: Detection[] = detectAtNode(sim, node, RADIUS, frame);
      const truth: { x: number; y: number; a: number; kind: number; id: number }[] = [];
      // Real vehicles (the "pixels").
      for (const eid of [...NETWORK.inEdges[node], ...NETWORK.outEdges[node]]) {
        const e = EDGES[eid];
        for (const vid of sim.edgeQ[eid]) {
          const v = sim.vehicles[vid];
          const lane = e.lanes > 1 && v.id % 2 ? 5.2 : 3.2;
          const a = NODES[e.from];
          const b = NODES[e.to];
          const dx = (b.x - a.x) / e.length;
          const dy = (b.y - a.y) / e.length;
          const off = e.arterial ? lane : 2.4;
          const x = a.x + dx * v.s + dy * off;
          const y = a.y + dy * v.s - dx * off;
          if (Math.abs(x - n.x) > RADIUS + 2 || Math.abs(y - n.y) > RADIUS + 2) continue;
          truth.push({ x, y, a: Math.atan2(dy, dx), kind: v.kind, id: v.id });
        }
      }
      for (const t of truth) {
        ctx.save();
        ctx.translate(t.x * k + ox, t.y * k + oy);
        ctx.rotate(t.a);
        const len = (t.kind === 1 || t.kind === 2 ? 2.2 : 1.25) * k;
        const wid = (t.kind === 1 || t.kind === 2 ? 0.95 : 0.8) * k;
        ctx.fillStyle = t.kind === 3 ? "#f3f3f3" : t.kind === 1 ? "#c9a33a" : t.kind === 2 ? "#7d8a96" : ["#b9bdb9", "#6d7a8c", "#8f5b4e", "#d9d9d4"][t.id % 4];
        ctx.fillRect(-len / 2, -wid / 2, len, wid);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(-len / 6, -wid / 2 + 1, len / 3, wid - 2);
        ctx.restore();
      }
      // Detector overlay.
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      for (const d of dets) {
        const big = d.cls === "bus" || d.cls === "truck";
        const horiz = Math.abs(Math.cos(d.angle)) > 0.5;
        const bw = (horiz ? (big ? 2.5 : 1.55) : big ? 1.25 : 1.05) * k;
        const bh = (horiz ? (big ? 1.25 : 1.05) : big ? 2.5 : 1.55) * k;
        const x = d.x * k + ox - bw / 2;
        const y = d.y * k + oy - bh / 2;
        ctx.strokeStyle = d.cls === "ambulance" ? danger : d.stopped ? "#f2c14e" : primary;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(x, y, bw, bh);
        if (dets.length < 22 || d.cls !== "car") {
          const label = `${d.cls} ${d.conf.toFixed(2)}`;
          const tw = ctx.measureText(label).width + 6;
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fillRect(x, y - 12, tw, 12);
          ctx.fillStyle = "#111";
          ctx.fillText(label, x + 3, y - 3);
        }
      }
      const stats = cvCongestion(dets, node, RADIUS);
      statsRef.current?.(stats);
      // HUD.
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, 22);
      ctx.fillStyle = "#e8e8e3";
      ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(`CAM ${String(node).padStart(2, "0")} · ${name.toUpperCase()}`, 8, 15);
      const ts = new Date(sim.t * 1000).toISOString().slice(11, 19);
      ctx.fillText(`${ts}  f${frame}`, W - 120, 15);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, H - 22, W, 22);
      ctx.fillStyle = "#e8e8e3";
      ctx.fillText(
        `det ${stats.count}  queued N${stats.queue.N} S${stats.queue.S} E${stats.queue.E} W${stats.queue.W}  occ ${(stats.occupancy * 100).toFixed(0)}%`,
        8,
        H - 7
      );
      const now = performance.now();
      if (now - lastFps > 1000) {
        setFps(frames);
        frames = 0;
        lastFps = now;
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [node, name]);

  return (
    <div>
      <canvas ref={ref} className="block aspect-[4/3] w-full rounded-control bg-black" aria-label={`Camera ${name} with vehicle detections`} />
      <p className="mt-1.5 text-[11px] text-muted">
        {fps} fps · YOLO-style detector (simulated) · boxes: <span className="text-primary">moving</span>, <span className="text-warning">stationary</span>,{" "}
        <span className="text-danger">emergency</span>
      </p>
    </div>
  );
}
