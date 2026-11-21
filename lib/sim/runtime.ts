"use client";

/**
 * One live city for the whole app. The traffic simulation keeps running while
 * you move between modules, so the overview, citizen app and environment layer
 * all read the same traffic.
 */
import { useSyncExternalStore } from "react";
import { TrafficSim } from "./traffic";

export const SPEEDS = [1, 5, 15, 60] as const;
const WARMUP_TICKS = 45 * 60; // start at 07:25, be warmed up by 08:10

interface RuntimeState {
  sim: TrafficSim | null;
  speed: number; // sim seconds per real second
  paused: boolean;
  warmup: number; // remaining warm-up ticks
  version: number;
  fps: number;
}

const state: RuntimeState = { sim: null, speed: 15, paused: false, warmup: WARMUP_TICKS, version: 0, fps: 0 };
const listeners = new Set<() => void>();
let raf = 0;
let last = 0;
let carry = 0;
let lastNotify = 0;
let frames = 0;
let fpsT = 0;

function notify() {
  state.version++;
  listeners.forEach((l) => l());
}

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  const sim = state.sim!;
  const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
  last = now;
  frames++;
  if (now - fpsT > 1000) {
    state.fps = frames;
    frames = 0;
    fpsT = now;
  }
  if (state.warmup > 0) {
    const n = Math.min(state.warmup, 240);
    for (let i = 0; i < n; i++) sim.step();
    state.warmup -= n;
    notify();
    return;
  }
  if (!state.paused) {
    carry += dt * state.speed;
    let ticks = Math.floor(carry);
    carry -= ticks;
    ticks = Math.min(ticks, 90);
    for (let i = 0; i < ticks; i++) sim.step();
  }
  if (now - lastNotify > 250) {
    lastNotify = now;
    notify();
  }
}

export function getSim(): TrafficSim {
  if (!state.sim) {
    state.sim = new TrafficSim();
    if (typeof window !== "undefined") raf = requestAnimationFrame(loop);
  }
  return state.sim;
}

export const runtime = {
  get speed() {
    return state.speed;
  },
  setSpeed(s: number) {
    state.speed = s;
    notify();
  },
  get paused() {
    return state.paused;
  },
  setPaused(p: boolean) {
    state.paused = p;
    notify();
  },
  get warmingUp() {
    return state.warmup > 0;
  },
  get warmupProgress() {
    return 1 - state.warmup / WARMUP_TICKS;
  },
  get fps() {
    return state.fps;
  },
  /** Reset the city to a fresh morning. */
  reset() {
    const settings = state.sim?.settings;
    state.sim = new TrafficSim(settings);
    state.warmup = WARMUP_TICKS;
    notify();
  },
  stop() {
    cancelAnimationFrame(raf);
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-renders ~4x a second with the live sim. */
export function useSim() {
  const version = useSyncExternalStore(
    subscribe,
    () => state.version,
    () => 0
  );
  return { sim: getSim(), version, runtime };
}
