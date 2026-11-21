"use client";

/**
 * Shared city state across modules: public alerts and citizen complaints.
 * Persisted in localStorage so a demo survives a refresh. Swap the reducer's
 * side-effects for API calls when a backend is attached.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { SECTORS } from "@/lib/city/model";
import { uid } from "@/lib/utils";

export type Severity = "critical" | "warning" | "info";
export type AlertSource = "traffic" | "emergency" | "surveillance" | "environment" | "citizen";

export interface CityAlert {
  id: string;
  ts: number;
  severity: Severity;
  source: AlertSource;
  title: string;
  body: string;
  sector?: number;
  /** Shown to citizens (broadcast) or kept for operators only. */
  public: boolean;
}

export type ComplaintCategory = "pothole" | "garbage" | "water";
export type ComplaintStage = "submitted" | "assigned" | "in_progress" | "resolved";

export interface Complaint {
  id: string;
  ts: number;
  category: ComplaintCategory;
  description: string;
  x: number;
  y: number;
  sector: number;
  photo?: string;
  reporter: string;
  /** Seconds after submission at which each stage is reached (demo clock). */
  schedule: [number, number, number];
  rating?: number;
}

export const CATEGORY_META: Record<ComplaintCategory, { label: string; department: string; slaHours: number }> = {
  pothole: { label: "Pothole", department: "Public Works — Roads", slaHours: 72 },
  garbage: { label: "Garbage", department: "Sanitation", slaHours: 24 },
  water: { label: "Water leakage", department: "Water Supply & Sewerage", slaHours: 12 },
};

export const STAGES: { id: ComplaintStage; label: string }[] = [
  { id: "submitted", label: "Submitted" },
  { id: "assigned", label: "Assigned" },
  { id: "in_progress", label: "Crew on site" },
  { id: "resolved", label: "Resolved" },
];

export function complaintStage(c: Complaint, now = Date.now()): { stage: ComplaintStage; index: number } {
  const elapsed = (now - c.ts) / 1000;
  let index = 0;
  c.schedule.forEach((t, i) => {
    if (elapsed >= t) index = i + 1;
  });
  return { stage: STAGES[index].id, index };
}

interface CityStore {
  alerts: CityAlert[];
  complaints: Complaint[];
  pushAlert: (a: Omit<CityAlert, "id" | "ts">) => CityAlert;
  dismissAlert: (id: string) => void;
  addComplaint: (c: Omit<Complaint, "id" | "ts" | "schedule">) => Complaint;
  rateComplaint: (id: string, rating: number) => void;
  resetDemo: () => void;
}

const Ctx = createContext<CityStore | undefined>(undefined);
const KEY = "urbanpulse_state_v1";

function seedState(): { alerts: CityAlert[]; complaints: Complaint[] } {
  const now = Date.now();
  const min = 60_000;
  const s = (n: number) => SECTORS[n - 1];
  return {
    alerts: [
      {
        id: "seed-a1",
        ts: now - 6 * min,
        severity: "warning",
        source: "environment",
        title: "Air quality is Poor across the north-west",
        body: "Smoke from crop-residue fires is drifting in on a north-westerly wind. Limit outdoor exercise; masks advised for children and the elderly.",
        public: true,
      },
      {
        id: "seed-a2",
        ts: now - 25 * min,
        severity: "info",
        source: "traffic",
        title: "Signal timing adapted on GT Road",
        body: "Adaptive signals extended green on GT Road for the morning peak.",
        public: true,
      },
    ],
    complaints: [
      {
        id: "CMP-24817",
        ts: now - 40 * min,
        category: "pothole",
        description: "Deep pothole near the bus stop, two-wheelers swerving into traffic.",
        x: s(20).cx + 30,
        y: s(20).y + 4,
        sector: 19,
        reporter: "You",
        schedule: [60, 600, 3000],
      },
      {
        id: "CMP-24790",
        ts: now - 3 * 60 * min,
        category: "garbage",
        description: "Overflowing community bin outside the park gate.",
        x: s(11).cx - 20,
        y: s(11).cy + 25,
        sector: 10,
        reporter: "You",
        schedule: [120, 900, 3600],
        rating: 4,
      },
    ],
  };
}

export function CityStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(KEY) : null;
      if (raw) return JSON.parse(raw) as { alerts: CityAlert[]; complaints: Complaint[] };
    } catch {
      // Ignore corrupt storage.
    }
    return seedState();
  });

  useEffect(() => {
    try {
      // Photos can be large; keep storage small by dropping them past the 10 newest.
      const complaints = state.complaints.map((c, i) => (i < 10 ? c : { ...c, photo: undefined }));
      localStorage.setItem(KEY, JSON.stringify({ alerts: state.alerts.slice(0, 60), complaints }));
    } catch {
      // Storage may be full or blocked.
    }
  }, [state]);

  const pushAlert = useCallback((a: Omit<CityAlert, "id" | "ts">) => {
    const alert: CityAlert = { ...a, id: uid("al"), ts: Date.now() };
    setState((s) => ({ ...s, alerts: [alert, ...s.alerts].slice(0, 80) }));
    return alert;
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setState((s) => ({ ...s, alerts: s.alerts.filter((a) => a.id !== id) }));
  }, []);

  const addComplaint = useCallback((c: Omit<Complaint, "id" | "ts" | "schedule">) => {
    const complaint: Complaint = {
      ...c,
      id: `CMP-${Math.floor(24820 + Math.random() * 9000)}`,
      ts: Date.now(),
      // Demo clock: assigned in ~20 s, crew on site in ~1 min, resolved in ~3 min.
      schedule: [15 + Math.random() * 10, 50 + Math.random() * 20, 150 + Math.random() * 60],
    };
    setState((s) => ({ ...s, complaints: [complaint, ...s.complaints] }));
    return complaint;
  }, []);

  const rateComplaint = useCallback((id: string, rating: number) => {
    setState((s) => ({ ...s, complaints: s.complaints.map((c) => (c.id === id ? { ...c, rating } : c)) }));
  }, []);

  const resetDemo = useCallback(() => setState(seedState()), []);

  const value = useMemo(
    () => ({ ...state, pushAlert, dismissAlert, addComplaint, rateComplaint, resetDemo }),
    [state, pushAlert, dismissAlert, addComplaint, rateComplaint, resetDemo]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCity() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCity must be used inside CityStoreProvider");
  return c;
}

/** Ticks every `ms` so time-based UI (complaint stages, "2 min ago") stays fresh. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
