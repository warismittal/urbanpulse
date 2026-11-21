"use client";

import React, { useEffect, useRef } from "react";
import { H, W, type Scene } from "@/lib/sim/surveillance";

/** Draws one CCTV scene with detector boxes and the rule overlay. */
export function SceneCanvas({ scene, large = false, className }: { scene: Scene; large?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const scale = large ? 5 : 2.2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * scale * dpr;
    canvas.height = H * scale * dpr;
    let raf = 0;
    let lastDraw = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < (large ? 40 : 110)) return;
      lastDraw = now;
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      background(ctx, scene);
      // Rule overlay.
      const z = scene.zone;
      if (z) {
        const col = z.color === "danger" ? "rgba(240,90,80," : z.color === "warn" ? "rgba(240,190,60," : "rgba(110,170,240,";
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = `${col}0.95)`;
        ctx.fillStyle = `${col}0.13)`;
        ctx.setLineDash([3, 2]);
        if (z.kind === "rect") {
          const [[x1, y1], [x2, y2]] = z.pts;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        } else if (z.kind === "poly") {
          ctx.beginPath();
          z.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(z.pts[0][0], z.pts[0][1]);
          ctx.lineTo(z.pts[1][0], z.pts[1][1]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = `${col}1)`;
        ctx.font = "600 4px Inter, system-ui, sans-serif";
        ctx.fillText(z.label, z.pts[0][0] + 1.5, z.pts[0][1] - 1.5);
      }
      if (scene.heat) {
        for (let i = 0; i < scene.heat.length; i++) {
          const v = Math.min(1, scene.heat[i] / 1.5);
          if (v < 0.08) continue;
          ctx.fillStyle = `rgba(${200 + v * 40},${170 - v * 140},40,${0.12 + v * 0.4})`;
          ctx.fillRect((i % 8) * (W / 8), Math.floor(i / 8) * (H / 6), W / 8, H / 6);
        }
      }
      // Objects ("pixels").
      for (const o of scene.objects) {
        ctx.save();
        ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
        if (o.angle) ctx.rotate(o.angle);
        ctx.fillStyle = o.color;
        if (o.kind === "person") {
          ctx.beginPath();
          ctx.arc(0, 0, 1.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.beginPath();
          ctx.arc(0, 0, 0.8, 0, Math.PI * 2);
          ctx.fill();
        } else if (o.kind === "bag" || o.kind === "garbage") {
          ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
        } else {
          ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
          ctx.fillStyle = "rgba(20,25,30,0.55)";
          if (o.w > o.h) ctx.fillRect(-o.w / 6, -o.h / 2 + 1, o.w / 3, o.h - 2);
          else ctx.fillRect(-o.w / 2 + 1, -o.h / 6, o.w - 2, o.h / 3);
        }
        ctx.restore();
      }
      // Detector boxes.
      ctx.font = "600 3.4px Inter, system-ui, sans-serif";
      for (const d of scene.dets) {
        const color = d.alert ? "#f0645a" : d.label === "person" ? "#7fb5ef" : d.label === "garbage" || d.label === "backpack" ? "#f2c14e" : "#8ccba5";
        ctx.strokeStyle = color;
        ctx.lineWidth = d.alert ? 0.8 : 0.45;
        const pad = d.label === "person" ? 0.8 : 0.6;
        ctx.strokeRect(d.x - pad, d.y - pad, d.w + pad * 2, d.h + pad * 2);
        const crowded = scene.rule === "crowd";
        if (!crowded || d.alert) {
          const label = d.note ? d.note : `${d.label} ${d.conf.toFixed(2)}`;
          const tw = ctx.measureText(label).width + 2;
          ctx.fillStyle = color;
          ctx.fillRect(d.x - pad, d.y - pad - 4.4, tw, 4.4);
          ctx.fillStyle = "#111";
          ctx.fillText(label, d.x - pad + 1, d.y - pad - 1.1);
        }
      }
      // Plate crop for ANPR.
      if (scene.rule === "anpr") {
        for (const o of scene.objects) {
          if (o.kind !== "car" || o.y < 40 || o.y > 95) continue;
          ctx.fillStyle = "#f4f1e4";
          ctx.fillRect(o.x - 3, o.y + o.h + 1, 15, 4.5);
          ctx.fillStyle = "#111";
          ctx.font = "700 2.6px ui-monospace, Menlo, monospace";
          ctx.fillText(o.plate ?? "", o.x - 2.4, o.y + o.h + 4.3);
          ctx.font = "600 3.4px Inter, system-ui, sans-serif";
        }
      }
      // HUD.
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, 6);
      ctx.fillStyle = "#e6e6e0";
      ctx.font = "500 3.6px ui-monospace, Menlo, monospace";
      ctx.fillText(scene.name.toUpperCase(), 2, 4.3);
      const d = new Date();
      ctx.fillText(d.toTimeString().slice(0, 8), W - 17, 4.3);
      ctx.fillStyle = "#f0645a";
      ctx.beginPath();
      ctx.arc(W - 20, 3, 1, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [scene, large]);
  return <canvas ref={ref} className={className ?? "block aspect-[4/3] w-full rounded-control bg-black"} aria-label={`${scene.name} camera feed with detections`} />;
}

function background(ctx: CanvasRenderingContext2D, scene: Scene) {
  ctx.fillStyle = "#1d201e";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2f2c";
  const dash = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.strokeStyle = "#8a8f8b";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  switch (scene.rule) {
    case "parking":
      ctx.fillRect(0, 44, W, 36);
      ctx.fillStyle = "#383c39";
      ctx.fillRect(0, 26, W, 18);
      ctx.fillRect(0, 80, W, 18);
      dash(0, 62, W, 62);
      break;
    case "accident":
      ctx.fillRect(0, 44, W, 32);
      ctx.fillRect(64, 0, 32, H);
      dash(0, 60, 62, 60);
      dash(98, 60, W, 60);
      dash(80, 0, 80, 42);
      dash(80, 78, 80, H);
      break;
    case "anpr":
      ctx.fillRect(36, 0, 88, H);
      dash(80, 0, 80, H);
      ctx.fillStyle = "#3b403c";
      ctx.fillRect(76, 60, 8, 22);
      break;
    case "crowd":
      ctx.fillStyle = "#2f322f";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#3a3f3b";
      ctx.fillRect(60, 0, 40, 4);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      for (let x = 0; x <= W; x += W / 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y <= H; y += H / 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      break;
    case "dumping":
      ctx.fillStyle = "#3a3530";
      ctx.fillRect(0, 0, W, 12);
      ctx.fillStyle = "#2b2f2c";
      ctx.fillRect(0, 34, W, 70);
      break;
    case "object":
      ctx.fillStyle = "#30332f";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#3d423e";
      for (let x = 20; x < W; x += 36) ctx.fillRect(x, 50, 20, 4);
      break;
    case "intrusion":
      ctx.fillStyle = "#262a27";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#6e7570";
      ctx.lineWidth = 0.6;
      ctx.strokeRect(70, 18, 80, 86);
      ctx.fillStyle = "#3b403c";
      ctx.fillRect(92, 40, 16, 16);
      ctx.fillRect(118, 62, 16, 16);
      ctx.fillRect(92, 74, 16, 16);
      break;
  }
}
