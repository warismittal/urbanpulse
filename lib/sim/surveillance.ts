/**
 * Video analytics on city CCTV. Each camera plays a scripted scene; a detector
 * produces tracked boxes, and rule engines turn tracks into events:
 * illegal parking, accidents, plate reads, crowd density, garbage dumping,
 * unattended objects and restricted-zone intrusion.
 *
 * Scenes are simulated. In production `Scene.objects` would be replaced by
 * tracker output (e.g. YOLO + ByteTrack, plate OCR) — the rules are unchanged.
 */
import { seeded } from "@/lib/utils";

export const W = 160; // world width in px (≈ 40 m)
export const H = 120;
export const M_PER_PX = 0.25;

export type ObjKind = "car" | "bus" | "bike" | "person" | "bag" | "garbage";
export type Rule = "parking" | "accident" | "anpr" | "crowd" | "dumping" | "object" | "intrusion";

export interface Obj {
  id: number;
  kind: ObjKind;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  color: string;
  plate?: string;
  angle?: number;
  flag?: string;
}

export interface Det {
  id: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
  alert?: boolean;
  note?: string;
}

export interface CamEvent {
  id: string;
  camera: string;
  rule: Rule;
  ts: number;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  plate?: string;
}

export const RULE_META: Record<Rule, { label: string; severity: CamEvent["severity"] }> = {
  parking: { label: "Illegal parking", severity: "warning" },
  accident: { label: "Accident", severity: "critical" },
  anpr: { label: "Number plate", severity: "info" },
  crowd: { label: "Crowd density", severity: "warning" },
  dumping: { label: "Garbage dumping", severity: "warning" },
  object: { label: "Unattended object", severity: "critical" },
  intrusion: { label: "Restricted-zone intrusion", severity: "critical" },
};

const CAR_COLORS = ["#c9ccc8", "#5d6d82", "#8f4e44", "#e2e2dc", "#3d4a3f", "#b38b3c"];
const STATES = ["PB", "PB", "PB", "CH", "HR", "HP", "DL"];
const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

function plateFor(r: () => number) {
  const st = STATES[Math.floor(r() * STATES.length)];
  const d = String(1 + Math.floor(r() * 70)).padStart(2, "0");
  const l = LETTERS[Math.floor(r() * LETTERS.length)] + LETTERS[Math.floor(r() * LETTERS.length)];
  const n = String(Math.floor(r() * 9999)).padStart(4, "0");
  return `${st} ${d} ${l} ${n}`;
}

export const WATCHLIST: Record<string, string> = {};

/* ------------------------------------------------------------------- scene */

export abstract class Scene {
  abstract id: string;
  abstract name: string;
  abstract location: string;
  abstract rule: Rule;
  abstract period: number;
  t = 0;
  cycle = 0;
  objects: Obj[] = [];
  dets: Det[] = [];
  /** Overlay drawn by the rule: zones, lines, grids. */
  zone?: { kind: "rect" | "poly" | "line"; pts: [number, number][]; label: string; color: "warn" | "danger" | "info" };
  heat?: number[]; // crowd scene grid
  status = "Monitoring";
  protected fired = new Set<string>();
  protected r = seeded(7);
  protected nextId = 1;

  step(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    this.t += dt;
    if (this.t >= this.period) {
      this.t -= this.period;
      this.cycle++;
      this.fired.clear();
      this.reset();
    }
    this.update(dt, emit);
    for (const o of this.objects) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
    }
    this.detect();
  }

  protected abstract update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void): void;
  protected reset() {}

  protected once(key: string, fn: () => void) {
    if (this.fired.has(key)) return;
    this.fired.add(key);
    fn();
  }

  protected detect() {
    const out: Det[] = [];
    for (const o of this.objects) {
      if (o.x + o.w < -2 || o.x > W + 2 || o.y + o.h < -2 || o.y > H + 2) continue;
      const seed = (o.id * 9301 + Math.floor(this.t * 8) * 49297) % 233280;
      if (seed / 233280 < 0.03) continue; // occasional miss
      const j = () => (((seed * 7) % 13) / 13 - 0.5) * 0.8;
      out.push({
        id: o.id,
        label: o.kind === "garbage" ? "garbage" : o.kind === "bag" ? "backpack" : o.kind,
        x: o.x + j(),
        y: o.y + j(),
        w: o.w,
        h: o.h,
        conf: 0.74 + ((o.id * 37) % 23) / 100,
        alert: Boolean(o.flag),
        note: o.flag,
      });
    }
    this.dets = out;
  }

  protected car(x: number, y: number, vx: number, vy: number, extra: Partial<Obj> = {}): Obj {
    const horiz = Math.abs(vx) >= Math.abs(vy);
    const o: Obj = {
      id: this.nextId++,
      kind: "car",
      x,
      y,
      w: horiz ? 18 : 9,
      h: horiz ? 9 : 18,
      vx,
      vy,
      color: CAR_COLORS[Math.floor(this.r() * CAR_COLORS.length)],
      plate: plateFor(this.r),
      ...extra,
    };
    this.objects.push(o);
    return o;
  }

  protected person(x: number, y: number, vx: number, vy: number, extra: Partial<Obj> = {}): Obj {
    const o: Obj = { id: this.nextId++, kind: "person", x, y, w: 4, h: 4, vx, vy, color: ["#d9b48a", "#8aa3c9", "#c98a8a", "#9ec98a", "#c9c38a"][this.nextId % 5], ...extra };
    this.objects.push(o);
    return o;
  }

  protected cull() {
    this.objects = this.objects.filter((o) => o.x > -40 && o.x < W + 40 && o.y > -40 && o.y < H + 40);
  }
}

/* ---------------------------------------------------------- illegal parking */

class ParkingScene extends Scene {
  id = "cam-parking";
  name = "Market Road kerb";
  location = "Market Square, Sec 21";
  rule: Rule = "parking";
  period = 48;
  private parked?: Obj;
  private spawnT = 0;
  zone = { kind: "rect" as const, pts: [[34, 30], [122, 42]] as [number, number][], label: "NO PARKING", color: "warn" as const };
  protected update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 2.2 + this.r() * 2.5;
      if (this.r() < 0.5) this.car(-20, 48, 22 + this.r() * 8, 0);
      else this.car(W + 2, 66, -(22 + this.r() * 8), 0);
    }
    if (this.t > 4 && this.t < 4.2 && !this.parked) {
      this.parked = this.car(-20, 48, 20, 0);
    }
    const p = this.parked;
    if (p) {
      if (this.t > 6 && this.t < 11) {
        p.vx = Math.max(0, p.vx - 6 * dt);
        p.vy = p.y > 32 ? -8 : 0;
      }
      if (this.t >= 11 && this.t < 38) {
        p.vx = 0;
        p.vy = 0;
      }
      const inZone = p.x > 34 && p.x + p.w < 128 && p.y < 44;
      const dwell = inZone && p.vx === 0 && this.t >= 11 ? this.t - 11 : 0;
      this.status = inZone && dwell > 0 ? `Dwell ${dwell.toFixed(0)} s in no-parking zone (limit 10 s, demo)` : "Monitoring kerb";
      if (dwell > 10) {
        p.flag = "PARKED ILLEGALLY";
        this.once("park", () =>
          emit({ rule: "parking", severity: "warning", title: `Illegal parking · ${p.plate}`, detail: `Stationary ${dwell.toFixed(0)} s in a no-parking zone on Market Road. e-Challan drafted.`, plate: p.plate })
        );
      }
      if (this.t > 38) {
        p.flag = undefined;
        p.vy = p.y < 48 ? 8 : 0;
        p.vx = Math.min(24, p.vx + 10 * dt);
      }
    }
    this.cull();
  }
  protected reset() {
    this.parked = undefined;
  }
}

/* ----------------------------------------------------------------- accident */

class AccidentScene extends Scene {
  id = "cam-accident";
  name = "GT Road × University Road";
  location = "Junction 2-3";
  rule: Rule = "accident";
  period = 50;
  private a?: Obj;
  private b?: Obj;
  private spawnT = 0;
  protected update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    this.spawnT -= dt;
    if (this.spawnT <= 0 && (this.t < 9 || this.t > 40)) {
      this.spawnT = 1.6 + this.r() * 2;
      const k = this.r();
      if (k < 0.35) this.car(-20, 64, 26, 0);
      else if (k < 0.7) this.car(W + 2, 48, -26, 0);
      else this.car(84, -20, 0, 24);
    }
    if (!this.a && this.t > 8 && this.t < 9) {
      this.a = this.car(-20, 64, 30, 0);
      this.b = this.car(72, H + 2, 0, -28);
    }
    const a = this.a;
    const b = this.b;
    if (a && b) {
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlap && a.vx > 0) {
        a.vx = 0;
        b.vy = 0;
        a.angle = 0.35;
        b.angle = -0.25;
        a.flag = "COLLISION";
        b.flag = "COLLISION";
        emit({ rule: "accident", severity: "critical", title: "Collision detected", detail: `Two vehicles (${a.plate}, ${b.plate}) stopped after impact at the junction. Ambulance and traffic police auto-notified.` });
        this.fired.add("acc");
      }
      if (this.fired.has("acc")) {
        // Other traffic stops behind the crash.
        for (const o of this.objects) if (o !== a && o !== b && o.vx > 0 && o.x + o.w > a.x - 6 && o.x < a.x && Math.abs(o.y - a.y) < 4) o.vx = 0;
        this.status = `Incident active ${(this.t - 12).toFixed(0)} s · lane blocked`;
      } else this.status = "Monitoring junction";
      if (this.t > 40) {
        a.flag = b.flag = undefined;
        a.vx = 18;
        b.vy = -18;
        for (const o of this.objects) if (o.kind === "car" && o.vx === 0 && o.vy === 0) o.vx = 20;
      }
    }
    this.cull();
  }
  protected reset() {
    this.a = this.b = undefined;
    this.objects = [];
  }
}

/* --------------------------------------------------------------------- ANPR */

class AnprScene extends Scene {
  id = "cam-anpr";
  name = "City entry gate · ANPR";
  location = "Eastern Bypass toll";
  rule: Rule = "anpr";
  period = 30;
  zone = { kind: "line" as const, pts: [[20, 70], [140, 70]] as [number, number][], label: "READ LINE", color: "info" as const };
  reads: { plate: string; conf: number; ts: number; hit?: string }[] = [];
  private spawnT = 0;
  private crossed = new Set<number>();
  protected update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 2.6 + this.r() * 2.5;
      const lane = this.r() < 0.5 ? 52 : 92;
      const c = this.car(lane, -22, 0, 26 + this.r() * 6);
      if (this.r() < 0.12) WATCHLIST[c.plate!] = this.r() < 0.5 ? "Reported stolen" : "3 unpaid challans";
    }
    for (const o of this.objects) {
      if (o.kind !== "car" || this.crossed.has(o.id)) continue;
      if (o.y + o.h > 70) {
        this.crossed.add(o.id);
        const conf = 0.86 + ((o.id * 17) % 13) / 100;
        const hit = WATCHLIST[o.plate!];
        if (hit) o.flag = hit.toUpperCase();
        this.reads.unshift({ plate: o.plate!, conf, ts: Date.now(), hit });
        if (this.reads.length > 12) this.reads.pop();
        emit({
          rule: "anpr",
          severity: hit ? (hit.includes("stolen") ? "critical" : "warning") : "info",
          title: hit ? `Watchlist hit · ${o.plate}` : `Plate read · ${o.plate}`,
          detail: hit ? `${hit}. Alert sent to the nearest PCR van.` : `OCR confidence ${(conf * 100).toFixed(0)}% · vehicle entering city`,
          plate: o.plate,
        });
      }
    }
    this.status = `${this.reads.length ? `Last read ${this.reads[0].plate}` : "Waiting for vehicles"}`;
    this.cull();
  }
}

/* -------------------------------------------------------------------- crowd */

class CrowdScene extends Scene {
  id = "cam-crowd";
  name = "Railway Station forecourt";
  location = "Railway Station, Sec 25";
  rule: Rule = "crowd";
  period = 60;
  peopleTarget = 30;
  density = 0;
  peak = 0;
  protected update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    // A train arrives at t=15 s; the forecourt surges, then disperses.
    const surge = this.t > 15 && this.t < 38 ? Math.min(1, (this.t - 15) / 6) : this.t >= 38 ? Math.max(0, 1 - (this.t - 38) / 12) : 0;
    this.peopleTarget = Math.round(28 + surge * 190);
    const live = this.objects.filter((o) => o.kind === "person");
    if (live.length < this.peopleTarget) {
      for (let k = 0; k < 6 && live.length + k < this.peopleTarget; k++) {
        const fromGate = this.r() < surge;
        this.person(fromGate ? 70 + this.r() * 20 : this.r() * W, fromGate ? 2 : this.r() < 0.5 ? H - 2 : 2, (this.r() - 0.5) * 8, fromGate ? 6 + this.r() * 6 : (this.r() - 0.5) * 10);
      }
    } else if (live.length > this.peopleTarget + 4) {
      const o = live[0];
      o.vy = o.y > H / 2 ? 14 : -14;
    }
    for (const o of live) {
      o.vx += (this.r() - 0.5) * 6 * dt;
      o.vy += (this.r() - 0.5) * 6 * dt;
      o.vx = Math.max(-9, Math.min(9, o.vx));
      o.vy = Math.max(-9, Math.min(9, o.vy));
      if (o.x < 0 || o.x > W - 4) o.vx *= -1;
    }
    this.objects = this.objects.filter((o) => o.y > -10 && o.y < H + 10);
    // 8 x 6 density grid, each cell 5 m x 5 m = 25 m².
    const grid = Array(48).fill(0);
    for (const o of this.objects) {
      const c = Math.floor((o.x / W) * 8);
      const r = Math.floor((o.y / H) * 6);
      if (c >= 0 && c < 8 && r >= 0 && r < 6) grid[r * 8 + c]++;
    }
    this.heat = grid.map((n) => n / 25);
    this.peak = Math.max(...this.heat);
    this.density = this.objects.length / ((W * M_PER_PX) * (H * M_PER_PX));
    this.status = `${this.objects.length} people · avg ${this.density.toFixed(2)} /m² · peak cell ${this.peak.toFixed(1)} /m²`;
    if (this.peak >= 1.2) {
      this.once("crowd", () =>
        emit({ rule: "crowd", severity: "warning", title: "Crowd density high at station forecourt", detail: `Peak ${this.peak.toFixed(1)} persons/m² near the exit gate. Open additional exits and deploy RPF marshals.` })
      );
    }
  }
}

/* ------------------------------------------------------------------ dumping */

class DumpingScene extends Scene {
  id = "cam-dumping";
  name = "Back lane, Sector 34";
  location = "Behind community market";
  rule: Rule = "dumping";
  period = 45;
  zone = { kind: "rect" as const, pts: [[8, 14], [152, 32]] as [number, number][], label: "NO DUMPING", color: "warn" as const };
  private walker?: Obj;
  private sack?: Obj;
  private droppedAt = 0;
  protected update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    if (!this.walker && this.t > 3 && this.t < 4) {
      this.walker = this.person(-6, 60, 14, 0);
      this.sack = { id: this.nextId++, kind: "bag", x: -4, y: 56, w: 5, h: 5, vx: 14, vy: 0, color: "#6b7b5e" };
      this.objects.push(this.sack);
    }
    const w = this.walker;
    const s = this.sack;
    if (w && s) {
      if (this.t > 9 && this.t < 12 && w.y > 34) {
        w.vx = 0;
        w.vy = -12;
        s.vx = 0;
        s.vy = -12;
      }
      if (this.t >= 12 && s.kind === "bag") {
        s.kind = "garbage";
        s.vx = s.vy = 0;
        s.w = 9;
        s.h = 7;
        s.color = "#4f5a3f";
        this.droppedAt = this.t;
        w.vy = 12;
      }
      if (this.t > 14 && w.y > 60) {
        w.vy = 0;
        w.vx = 16;
      }
      if (s.kind === "garbage" && this.t - this.droppedAt > 4 && Math.hypot(w.x - s.x, w.y - s.y) > 30) {
        s.flag = "DUMPED WASTE";
        this.once("dump", () =>
          emit({ rule: "dumping", severity: "warning", title: "Garbage dumping detected", detail: `Person (track #${w.id}) left a waste sack in the no-dumping strip and walked away. Snapshot sent to Sanitation; pickup ticket raised.` })
        );
      }
      this.status = s.kind === "garbage" ? `Static waste object for ${(this.t - this.droppedAt).toFixed(0)} s` : "Monitoring lane";
    }
    if (this.t > 34 && s) {
      // Sanitation crew clears it.
      this.objects = this.objects.filter((o) => o !== s);
      this.sack = undefined;
      this.status = "Cleared by sanitation crew";
    }
    if (this.r() < dt * 0.25) this.person(-4, 80 + this.r() * 30, 12 + this.r() * 6, 0);
    this.cull();
  }
  protected reset() {
    this.walker = this.sack = undefined;
    this.objects = [];
  }
}

/* ----------------------------------------------------------- unattended bag */

class ObjectScene extends Scene {
  id = "cam-object";
  name = "ISBT concourse";
  location = "Bus Terminal, Sec 17";
  rule: Rule = "object";
  period = 55;
  private owner?: Obj;
  private bag?: Obj;
  private leftAt = 0;
  protected update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    if (this.objects.filter((o) => o.kind === "person").length < 9 && this.r() < dt * 2) {
      const left = this.r() < 0.5;
      this.person(left ? -4 : W + 2, 20 + this.r() * 80, left ? 10 + this.r() * 8 : -(10 + this.r() * 8), (this.r() - 0.5) * 4);
    }
    if (!this.owner && this.t > 2 && this.t < 3) {
      this.owner = this.person(-4, 64, 14, 0);
      this.bag = { id: this.nextId++, kind: "bag", x: -2, y: 66, w: 4, h: 4, vx: 14, vy: 0, color: "#3b4b6b" };
      this.objects.push(this.bag);
    }
    const o = this.owner;
    const b = this.bag;
    if (o && b) {
      if (this.t > 7 && this.t < 10) {
        o.vx = 0;
        b.vx = 0;
      }
      if (this.t >= 10 && !this.leftAt) {
        this.leftAt = this.t;
        o.vx = 16;
        o.vy = -6;
      }
      const dist = Math.hypot(o.x - b.x, o.y - b.y) * M_PER_PX;
      const alone = this.leftAt ? this.t - this.leftAt : 0;
      if (this.leftAt && dist > 5) {
        this.status = `Bag unattended ${alone.toFixed(0)} s · owner #${o.id} ${dist.toFixed(0)} m away`;
        if (alone > 10) {
          b.flag = "UNATTENDED";
          this.once("bag", () =>
            emit({ rule: "object", severity: "critical", title: "Unattended bag at ISBT concourse", detail: `Backpack left for ${alone.toFixed(0)} s; owner (track #${o.id}) walked out of frame heading north-east. Security dispatched, area being cleared.` })
          );
        }
      } else this.status = "Monitoring concourse";
      if (this.t > 40) {
        this.objects = this.objects.filter((x) => x !== b);
        this.bag = undefined;
        this.status = "Bag recovered by security";
      }
    }
    this.cull();
  }
  protected reset() {
    this.owner = this.bag = undefined;
    this.leftAt = 0;
    this.objects = [];
  }
}

/* ---------------------------------------------------------------- intrusion */

class IntrusionScene extends Scene {
  id = "cam-intrusion";
  name = "220 kV substation perimeter";
  location = "Industrial Area Ph II";
  rule: Rule = "intrusion";
  period = 42;
  zone = { kind: "poly" as const, pts: [[70, 18], [150, 18], [150, 104], [70, 104]] as [number, number][], label: "RESTRICTED", color: "danger" as const };
  private intruder?: Obj;
  protected update(dt: number, emit: (e: Omit<CamEvent, "id" | "ts" | "camera">) => void) {
    if (!this.intruder && this.t > 2 && this.t < 3) this.intruder = this.person(-4, 90, 10, -4);
    const p = this.intruder;
    if (p) {
      if (this.t > 8 && this.t < 9) {
        p.vx = 0;
        p.vy = -10;
      }
      if (this.t > 11 && this.t < 12) {
        p.vx = 12;
        p.vy = 0;
      }
      if (this.t > 22 && this.t < 23) {
        p.vx = -16;
        p.vy = 6;
      }
      const inside = p.x > 70 && p.x < 150 && p.y > 18 && p.y < 104;
      if (inside) {
        p.flag = "INTRUDER";
        this.status = `Person inside restricted zone (track #${p.id})`;
        this.once("in", () =>
          emit({ rule: "intrusion", severity: "critical", title: "Intrusion at substation perimeter", detail: `Person (track #${p.id}) crossed the fence into the restricted zone. Siren triggered; patrol en route.` })
        );
      } else {
        p.flag = undefined;
        this.status = "Perimeter secure";
      }
    }
    this.cull();
  }
  protected reset() {
    this.intruder = undefined;
    this.objects = [];
  }
}

/* ------------------------------------------------------------------ runtime */

export const SCENES: Scene[] = [new ParkingScene(), new AccidentScene(), new AnprScene(), new CrowdScene(), new DumpingScene(), new ObjectScene(), new IntrusionScene()];
// Stagger cycles so events don't all fire together.
SCENES.forEach((s, i) => (s.t = (i * 7) % s.period));

const listeners = new Set<(e: CamEvent) => void>();
let timer = 0;
let seq = 0;
export const eventLog: CamEvent[] = [];

export function startSurveillance() {
  if (timer || typeof window === "undefined") return;
  let last = performance.now();
  timer = window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    for (const s of SCENES) {
      s.step(dt, (e) => {
        const ev: CamEvent = { ...e, id: `ev-${++seq}`, ts: Date.now(), camera: s.id };
        eventLog.unshift(ev);
        if (eventLog.length > 200) eventLog.pop();
        listeners.forEach((l) => l(ev));
      });
    }
  }, 50);
}

export function onCamEvent(l: (e: CamEvent) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
