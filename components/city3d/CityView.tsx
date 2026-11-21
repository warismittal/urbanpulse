"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { CityEngine, Quality } from "@/lib/city3d/engine";
import type { Traffic3D } from "@/lib/city3d/traffic3d";
import type { ScenarioDirector, SensorLayer } from "@/lib/city3d/layers3d";
import type { CityLife } from "@/lib/city3d/world3d";
import type { PaletteId } from "@/lib/city3d/config";

export interface CityHandles {
  engine: CityEngine;
  traffic: Traffic3D;
  scenarios: ScenarioDirector;
  sensors: SensorLayer;
  life: CityLife;
}

const Ctx = createContext<CityHandles | null>(null);
export const useCity3D = () => useContext(Ctx);

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2"));
  } catch {
    return false;
  }
}

/**
 * Full-viewport 3D city. three.js and the scene code load on demand, so the
 * 2D dashboards never pay for them.
 */
export function CityView({
  palette,
  quality,
  children,
  onCanvasClick,
}: {
  /** A fixed look, or "auto" to follow the day/night clock. */
  palette: PaletteId | "auto";
  quality: Quality;
  children?: React.ReactNode;
  onCanvasClick?: (x: number, z: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handles, setHandles] = useState<CityHandles | null>(null);
  const [progress, setProgress] = useState({ p: 0, label: "Loading the city" });
  const [error, setError] = useState<string | null>(null);
  const clickRef = useRef(onCanvasClick);
  useEffect(() => {
    clickRef.current = onCanvasClick;
  }, [onCanvasClick]);

  useEffect(() => {
    if (!webglAvailable()) {
      setError("This browser can't run WebGL 2, so the 3D city is unavailable. The dashboards still work.");
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | null = null;
    let life: CityLife | null = null;
    (async () => {
      const [{ CityEngine }, { Traffic3D }, { ScenarioDirector, SensorLayer }, { CityLife }] = await Promise.all([
        import("@/lib/city3d/engine"),
        import("@/lib/city3d/traffic3d"),
        import("@/lib/city3d/layers3d"),
        import("@/lib/city3d/world3d"),
      ]);
      if (disposed || !canvasRef.current) return;
      const engine = new CityEngine(canvasRef.current, {
        palette: palette === "auto" ? 2 : palette,
        quality,
        onProgress: (p, label) => setProgress({ p, label }),
        onError: (e) => setError(`The city models could not be loaded (${String(e)}).`),
        onReady: () => {
          if (disposed) return;
          const traffic = new Traffic3D(engine);
          const scenarios = new ScenarioDirector(engine, traffic);
          const sensors = new SensorLayer(engine, traffic);
          life = new CityLife(engine, traffic);
          // Open on a slow sweep in from high above.
          engine.rig.flyTo(-60, -90, 330, 0.93, 0.77, 3.2);
          setHandles({ engine, traffic, scenarios, sensors, life: life! });
        },
      });
      // Click (not drag) on the ground.
      let down: { x: number; y: number } | null = null;
      const canvas = canvasRef.current;
      const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
      const onUp = (e: PointerEvent) => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
        const p = engine.pickGround(e.clientX, e.clientY);
        if (p) clickRef.current?.(p.x, p.z);
      };
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerup", onUp);
      cleanup = () => {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointerup", onUp);
        life?.dispose();
        engine.dispose();
      };
    })().catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      cleanup?.();
    };
    // The engine is created once; palette/quality changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!handles) return;
    if (palette === "auto") handles.engine.setHour(handles.engine.hour);
    else handles.engine.setPalette(palette);
  }, [palette, handles]);

  return (
    <Ctx.Provider value={handles}>
      <div className="fixed inset-x-0 bottom-0 top-14 z-0 bg-[#cfd6d8]">
        <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="3D city. Drag to rotate, right-drag to pan, scroll to zoom." />
        {!error ? (
          <div className={`absolute inset-0 grid place-items-center bg-black/10 backdrop-blur-sm transition-opacity duration-1000 ${handles ? "pointer-events-none opacity-0" : "opacity-100"}`}>
            <div className="w-72 rounded-card border border-white/40 bg-white/70 px-5 py-4 text-center shadow-pop backdrop-blur-md dark:bg-black/50">
              <p className="text-[15px] font-semibold text-ink">UrbanPulse</p>
              <p className="mt-0.5 text-[13px] text-muted">{progress.label}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10">
                <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress.p}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] tabular-nums text-muted">{Math.round(progress.p)}%</p>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="max-w-md rounded-card border border-hair bg-surface px-5 py-4 text-[13px] text-ink shadow-pop">{error}</div>
          </div>
        ) : null}
      </div>
      {children}
    </Ctx.Provider>
  );
}

/** HTML labels pinned to world positions, repositioned every frame. */
export function WorldLabels({ items, visible = true }: { items: { id: string; text: string; x: number; y: number; z: number; tone?: string }[]; visible?: boolean }) {
  const h = useCity3D();
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!h) return;
    const f = () => {
      for (const it of items) {
        const el = refs.current[it.id];
        if (!el) continue;
        const p = h.engine.project(it.x, it.y, it.z);
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
        el.style.opacity = p.visible && visible ? "1" : "0";
      }
    };
    h.engine.onFrame.add(f);
    return () => {
      h.engine.onFrame.delete(f);
    };
  }, [h, items, visible]);
  if (!h) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 top-14 z-[5] overflow-hidden">
      {items.map((it) => (
        <div
          key={it.id}
          ref={(el) => {
            refs.current[it.id] = el;
          }}
          className="absolute left-0 top-0 whitespace-nowrap rounded-full border border-white/50 bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white shadow transition-opacity"
          style={{ opacity: 0 }}
        >
          {it.text}
        </div>
      ))}
    </div>
  );
}

export type { PaletteId, Quality };
