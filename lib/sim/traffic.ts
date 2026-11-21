/**
 * Microscopic traffic simulation on the sector grid.
 *
 * - Thousands of vehicles follow the car ahead (gap-limited speed) on each road.
 * - Every signalised junction runs either a fixed 30 s cycle or an adaptive
 *   max-pressure controller that serves whichever approach has the longer queue.
 * - Ambulances can pre-empt signals along their route (green wave) and traffic
 *   ahead of them yields.
 * - Vehicles re-route every simulated minute on current travel times, and
 *   around blocked roads (accidents, floods).
 *
 * Time step: 1 simulated second. Distances in map units (1 unit = 5 m).
 */
import { EDGES, NETWORK, NODES, SECTORS, COLS, ROWS, MARGIN, BLOCK, METRES_PER_UNIT, type Edge } from "@/lib/city/model";
import { clamp, seeded } from "@/lib/utils";

export const INSET = 7;
const SPACING = 1.6; // jam spacing per lane (8 m)
const ACC = 0.55; // units/s^2
const DEC = 1.1;
const V_ART = 2.8; // 50 km/h
const V_LOC = 2.2; // 40 km/h
const HIST = 240; // minutes of history kept

export type VehicleKind = 0 | 1 | 2 | 3; // car, bus, truck, ambulance

export interface Vehicle {
  id: number;
  alive: boolean;
  edge: number;
  s: number;
  v: number;
  dest: number;
  kind: VehicleKind;
  factor: number; // driver speed preference
  tickMoved: number;
  start: number;
  /** Ambulances only. */
  route?: number[];
  routeIdx?: number;
  priority?: boolean;
  missionId?: number;
}

export interface AmbulanceMission {
  id: number;
  vehicle: number;
  label: string;
  priority: boolean;
  dispatchedAt: number; // sim seconds
  pickupNode: number;
  hospitalNode: number;
  route: number[];
  pickupIdx: number; // route index where pickup happens
  estimateNoPriority: number; // seconds
  pickedUpAt?: number;
  arrivedAt?: number;
  progress: number; // 0..1
  signalsCleared: number;
}

export interface CityMinute {
  t: number;
  vehicles: number;
  speedKmh: number;
  congestion: number; // 0..1 network congestion index
  stoppedPct: number;
  trips: number;
}

export interface SimSettings {
  peakVehicles: number;
  adaptive: boolean;
  preemption: boolean;
  dynamicRouting: boolean;
}

/** Hourly demand profile, 0..1. Two commute peaks and a midday plateau. */
export function demandProfile(hour: number) {
  const bump = (c: number, w: number) => Math.exp(-((hour - c) ** 2) / (2 * w * w));
  return clamp(0.16 + 0.42 * bump(13.5, 3.2) + 0.84 * bump(9.2, 1.15) + 0.82 * bump(18.6, 1.35), 0, 1);
}

export function congestionLevel(c: number): { id: "free" | "moderate" | "heavy" | "jam"; label: string } {
  if (c < 0.3) return { id: "free", label: "Free flow" };
  if (c < 0.5) return { id: "moderate", label: "Moderate" };
  if (c < 0.7) return { id: "heavy", label: "Heavy" };
  return { id: "jam", label: "Jammed" };
}

const NN = NODES.length;
const NE = EDGES.length;

export class TrafficSim {
  t: number; // sim seconds since midnight
  tick = 0;
  vehicles: Vehicle[] = [];
  private free: number[] = [];
  edgeQ: number[][] = EDGES.map(() => []);
  aliveCount = 0;

  /* signals */
  signalised = new Uint8Array(NN);
  phase = new Uint8Array(NN); // 0 = north-south green, 1 = east-west green
  amber = new Uint8Array(NN);
  elapsed = new Uint16Array(NN);
  preemptDir = new Int8Array(NN).fill(-1);
  preemptUntil = new Int32Array(NN);
  greenTime = new Float64Array(NN); // accumulated, for stats
  switches = 0;

  /* per-edge stats (refreshed every tick) */
  edgeCount = new Uint16Array(NE);
  edgeStopped = new Uint16Array(NE);
  edgeSpeed = new Float32Array(NE); // mean, units/s
  congestion = new Float32Array(NE); // smoothed 0..1
  blocked = new Uint8Array(NE);

  /* routing */
  nextEdge = new Int16Array(NN * NN).fill(-1);
  travelTime = new Float32Array(NE);

  /* history */
  minutes: CityMinute[] = [];
  edgeHistory = new Float32Array(HIST * NE);
  histLen = 0;
  histHead = 0;
  tripsThisMinute = 0;
  tripTimes: number[] = [];

  missions: AmbulanceMission[] = [];
  private missionSeq = 1;
  settings: SimSettings;
  private rand = seeded(2026);
  private destWeightsAM: Float64Array;
  private destWeightsPM: Float64Array;

  constructor(settings?: Partial<SimSettings>, startTime = 7 * 3600 + 25 * 60) {
    this.t = startTime;
    this.settings = { peakVehicles: 4200, adaptive: true, preemption: true, dynamicRouting: true, ...settings };
    for (let n = 0; n < NN; n++) {
      this.signalised[n] = NETWORK.inEdges[n].length >= 3 ? 1 : 0;
      this.phase[n] = n % 2;
      this.elapsed[n] = (n * 7) % 25;
    }
    for (const e of EDGES) this.travelTime[e.id] = e.length / this.vmax(e);
    this.recomputeRoutes();
    // Origins and destinations weighted by land use around each junction.
    const jobs = new Float64Array(NN);
    const homes = new Float64Array(NN);
    for (const s of SECTORS) {
      const corners = [
        [s.col, s.row],
        [s.col + 1, s.row],
        [s.col, s.row + 1],
        [s.col + 1, s.row + 1],
      ];
      const job =
        s.use === "commercial" ? 6 : s.use === "industrial" ? 4 : s.use === "institutional" ? 3.5 : s.use === "transit" ? 4 : s.use === "mixed" ? 2 : s.use === "residential" ? 0.6 : 0.2;
      const home = s.population / 8000;
      for (const [i, j] of corners) {
        const id = j * (COLS + 1) + i;
        jobs[id] += job;
        homes[id] += home + 0.15;
      }
    }
    this.destWeightsAM = jobs;
    this.destWeightsPM = homes;
  }

  vmax(e: Edge) {
    return e.arterial ? V_ART : V_LOC;
  }

  get hour() {
    return (this.t / 3600) % 24;
  }

  targetVehicles() {
    return Math.round(this.settings.peakVehicles * demandProfile(this.hour));
  }

  /* ------------------------------------------------------------- routing */

  recomputeRoutes() {
    const w = new Float64Array(NE);
    for (let e = 0; e < NE; e++) {
      if (this.blocked[e]) w[e] = Infinity;
      else if (this.settings.dynamicRouting) w[e] = this.travelTime[e] + this.edgeStopped[e] * 1.5;
      else w[e] = EDGES[e].length / this.vmax(EDGES[e]);
    }
    const dist = new Float64Array(NN);
    const first = new Int16Array(NN);
    const done = new Uint8Array(NN);
    for (let src = 0; src < NN; src++) {
      dist.fill(Infinity);
      first.fill(-1);
      done.fill(0);
      dist[src] = 0;
      for (let k = 0; k < NN; k++) {
        let u = -1;
        let best = Infinity;
        for (let i = 0; i < NN; i++) if (!done[i] && dist[i] < best) (best = dist[i]), (u = i);
        if (u === -1) break;
        done[u] = 1;
        for (const eid of NETWORK.outEdges[u]) {
          const to = EDGES[eid].to;
          const nd = dist[u] + w[eid];
          if (nd < dist[to]) {
            dist[to] = nd;
            first[to] = u === src ? eid : first[u];
          }
        }
      }
      for (let d = 0; d < NN; d++) this.nextEdge[src * NN + d] = first[d];
    }
  }

  routeEdges(from: number, to: number): number[] {
    const out: number[] = [];
    let cur = from;
    let guard = 0;
    while (cur !== to && guard++ < NN * 2) {
      const e = this.nextEdge[cur * NN + to];
      if (e < 0) break;
      out.push(e);
      cur = EDGES[e].to;
    }
    return out;
  }

  /* ------------------------------------------------------------ vehicles */

  private pickWeighted(weights: Float64Array) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = this.rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  private chooseDest(from: number) {
    const morning = this.hour < 13.5;
    const w = morning ? this.destWeightsAM : this.destWeightsPM;
    // Blend in some random trips so every road sees traffic.
    for (let tries = 0; tries < 4; tries++) {
      const d = this.rand() < 0.65 ? this.pickWeighted(w) : Math.floor(this.rand() * NN);
      if (d !== from) return d;
    }
    return (from + 7) % NN;
  }

  private entryHasRoom(eid: number, extra = 0) {
    const q = this.edgeQ[eid];
    if (q.length === 0) return true;
    const last = this.vehicles[q[q.length - 1]];
    return last.s > INSET + SPACING / EDGES[eid].lanes + extra;
  }

  spawn(kind: VehicleKind = 0, origin?: number, dest?: number): number {
    const from = origin ?? this.pickWeighted(this.hour < 13.5 ? this.destWeightsPM : this.destWeightsAM);
    const to = dest ?? this.chooseDest(from);
    let eid = this.nextEdge[from * NN + to];
    if (eid < 0 || !this.entryHasRoom(eid)) {
      const options = NETWORK.outEdges[from].filter((id) => !this.blocked[id] && this.entryHasRoom(id));
      if (!options.length) return -1;
      eid = options[Math.floor(this.rand() * options.length)];
    }
    const id = this.free.length ? this.free.pop()! : this.vehicles.length;
    const veh: Vehicle = {
      id,
      alive: true,
      edge: eid,
      s: INSET,
      v: 0,
      dest: to,
      kind,
      factor: 0.82 + this.rand() * 0.3,
      tickMoved: this.tick,
      start: this.t,
    };
    this.vehicles[id] = veh;
    this.edgeQ[eid].push(id);
    this.aliveCount++;
    return id;
  }

  /* ------------------------------------------------------------- signals */

  isGreen(eid: number) {
    const e = EDGES[eid];
    const n = e.to;
    if (!this.signalised[n]) return true;
    if (this.amber[n] > 0) return false;
    return this.phase[n] === 0 ? e.dir === "v" : e.dir === "h";
  }

  private approachQueue(n: number, dir: "h" | "v") {
    let q = 0;
    for (const eid of NETWORK.inEdges[n]) if (EDGES[eid].dir === dir) q += this.edgeStopped[eid];
    return q;
  }

  private updateSignals() {
    for (let n = 0; n < NN; n++) {
      if (!this.signalised[n]) continue;
      if (this.amber[n] > 0) {
        this.amber[n]--;
        if (this.amber[n] === 0) {
          this.phase[n] = 1 - this.phase[n];
          this.elapsed[n] = 0;
        }
        continue;
      }
      this.elapsed[n]++;
      this.greenTime[n]++;
      const preempt = this.preemptUntil[n] > this.tick ? this.preemptDir[n] : -1;
      if (preempt >= 0) {
        if (this.phase[n] !== preempt) this.switchPhase(n, 2);
        continue;
      }
      const el = this.elapsed[n];
      if (!this.settings.adaptive) {
        if (el >= 30) this.switchPhase(n);
        continue;
      }
      const greenDir = this.phase[n] === 0 ? "v" : "h";
      const redDir = greenDir === "v" ? "h" : "v";
      const qg = this.approachQueue(n, greenDir);
      const qr = this.approachQueue(n, redDir);
      if (el >= 75 || (el >= 10 && (qr > qg * 1.5 + 3 || (qg === 0 && qr > 0 && el >= 6)))) this.switchPhase(n);
    }
  }

  private switchPhase(n: number, amberSeconds = 3) {
    this.amber[n] = amberSeconds;
    this.switches++;
  }

  /* --------------------------------------------------------------- step */

  step() {
    this.tick++;
    this.t += 1;
    this.updateSignals();
    this.applyPreemption();

    const veh = this.vehicles;
    for (let eid = 0; eid < NE; eid++) {
      const e = EDGES[eid];
      const q = this.edgeQ[eid];
      const stop = e.length - INSET;
      const sp = SPACING / e.lanes;
      const vmax = this.vmax(e);
      let count = 0;
      let stopped = 0;
      let speedSum = 0;
      let hasAmbulance = false;
      for (let k = 0; k < q.length; k++) {
        const v = veh[q[k]];
        count++;
        if (v.kind === 3) hasAmbulance = true;
        if (v.tickMoved === this.tick) {
          speedSum += v.v;
          if (v.v < 0.3) stopped++;
          continue;
        }
        v.tickMoved = this.tick;
        const isPriority = v.kind === 3 && v.priority;
        let limit: number;
        if (k === 0 || isPriority) {
          limit = this.canLeave(v, eid) ? Infinity : stop;
          if (this.blocked[eid] && v.s < e.length / 2 - 2) limit = Math.min(limit, e.length / 2 - 4);
        } else {
          limit = veh[q[k - 1]].s - sp;
        }
        // Vehicles ahead of a priority ambulance pull over and slow down.
        const top = v.kind === 3 ? vmax * 1.3 : vmax * v.factor * (v.kind === 2 ? 0.8 : v.kind === 1 ? 0.85 : 1);
        const vdes = Math.min(top, v.v + ACC);
        const gap = limit - v.s;
        const vsafe = gap <= 0 ? 0 : Math.min(gap, Math.sqrt(2 * DEC * gap));
        v.v = Math.max(0, Math.min(vdes, vsafe));
        v.s += v.v;
        speedSum += v.v;
        if (v.v < 0.3) stopped++;
      }
      if (hasAmbulance) q.sort((a, b) => veh[b].s - veh[a].s);
      this.edgeCount[eid] = count;
      this.edgeStopped[eid] = stopped;
      const mean = count ? speedSum / count : vmax;
      this.edgeSpeed[eid] = mean;
      const density = (count * sp) / (e.length - 2 * INSET);
      const raw = count ? clamp(0.62 * (1 - mean / vmax) + 0.55 * density, 0, 1) : 0;
      this.congestion[eid] = this.congestion[eid] * 0.92 + raw * 0.08;
      const tt = e.length / Math.max(0.35, mean);
      this.travelTime[eid] = this.travelTime[eid] * 0.95 + tt * 0.05;

      // Transfers through the junction at the end of this road.
      while (q.length) {
        const front = veh[q[0]];
        if (front.s < stop) break;
        if (!this.canLeave(front, eid)) {
          front.s = stop;
          front.v = 0;
          break;
        }
        this.leave(front, eid);
      }
    }

    // Keep the fleet near the time-of-day target.
    const target = this.targetVehicles();
    let budget = 24;
    while (this.aliveCount < target && budget-- > 0) {
      if (this.spawn(this.rand() < 0.04 ? 1 : this.rand() < 0.08 ? 2 : 0) < 0) break;
    }

    if (this.tick % 60 === 0) {
      if (this.settings.dynamicRouting) this.recomputeRoutes();
      this.recordMinute();
    }
  }

  private nextFor(v: Vehicle, eid: number): number {
    const node = EDGES[eid].to;
    if (v.kind === 3 && v.route) return v.route[(v.routeIdx ?? 0) + 1] ?? -1;
    if (node === v.dest) return -2; // arrived
    return this.nextEdge[node * NN + v.dest];
  }

  private canLeave(v: Vehicle, eid: number) {
    const priority = v.kind === 3 && v.priority;
    if (!priority && !this.isGreen(eid)) return false;
    if (priority && !this.isGreen(eid) && this.amber[EDGES[eid].to] === 0 && !this.settings.preemption) return false;
    const next = this.nextFor(v, eid);
    if (next === -2 || next === -1) return true;
    if (this.blocked[next] && !priority) return false;
    return priority || this.entryHasRoom(next);
  }

  private leave(v: Vehicle, eid: number) {
    const q = this.edgeQ[eid];
    q.shift();
    const next = this.nextFor(v, eid);
    if (v.kind === 3 && v.route) {
      if (next < 0) {
        this.finishMission(v);
        return;
      }
      v.routeIdx = (v.routeIdx ?? 0) + 1;
      this.onMissionProgress(v);
    } else if (next === -2 || next < 0) {
      // Trip complete.
      this.tripsThisMinute++;
      this.tripTimes.push(this.t - v.start);
      if (this.tripTimes.length > 400) this.tripTimes.shift();
      if (this.aliveCount > this.targetVehicles() || next === -1) {
        v.alive = false;
        this.free.push(v.id);
        this.aliveCount--;
        return;
      }
      const node = EDGES[eid].to;
      v.dest = this.chooseDest(node);
      v.start = this.t;
      const n2 = this.nextEdge[node * NN + v.dest];
      if (n2 < 0 || !this.entryHasRoom(n2)) {
        v.alive = false;
        this.free.push(v.id);
        this.aliveCount--;
        return;
      }
      this.enter(v, n2);
      return;
    }
    this.enter(v, next);
  }

  private enter(v: Vehicle, eid: number) {
    v.edge = eid;
    v.s = INSET;
    const q = this.edgeQ[eid];
    if (v.kind === 3) {
      q.push(v.id);
      q.sort((a, b) => this.vehicles[b].s - this.vehicles[a].s);
    } else q.push(v.id);
  }

  private recordMinute() {
    let n = 0;
    let speed = 0;
    let stopped = 0;
    let cong = 0;
    for (let e = 0; e < NE; e++) {
      const c = this.edgeCount[e];
      n += c;
      speed += this.edgeSpeed[e] * c;
      stopped += this.edgeStopped[e];
      cong += this.congestion[e] * (EDGES[e].arterial ? 1.6 : 1);
    }
    let wsum = 0;
    for (let e = 0; e < NE; e++) wsum += EDGES[e].arterial ? 1.6 : 1;
    const m: CityMinute = {
      t: this.t,
      vehicles: n,
      speedKmh: n ? ((speed / n) * METRES_PER_UNIT * 3.6) : 0,
      congestion: cong / wsum,
      stoppedPct: n ? stopped / n : 0,
      trips: this.tripsThisMinute,
    };
    this.tripsThisMinute = 0;
    this.minutes.push(m);
    if (this.minutes.length > HIST) this.minutes.shift();
    this.edgeHistory.set(this.congestion, this.histHead * NE);
    this.histHead = (this.histHead + 1) % HIST;
    this.histLen = Math.min(HIST, this.histLen + 1);
  }

  /** Last `n` minutes of congestion for one road, oldest first. */
  edgeSeries(eid: number, n = 60): number[] {
    const len = Math.min(n, this.histLen);
    const out: number[] = [];
    for (let k = len; k >= 1; k--) {
      const idx = (this.histHead - k + HIST) % HIST;
      out.push(this.edgeHistory[idx * NE + eid]);
    }
    return out;
  }

  /* ------------------------------------------------------------ ambulances */

  private applyPreemption() {
    if (!this.settings.preemption) return;
    for (const m of this.missions) {
      if (m.arrivedAt !== undefined || !m.priority) continue;
      const v = this.vehicles[m.vehicle];
      if (!v?.alive) continue;
      const e = EDGES[v.edge];
      if (e.length - INSET - v.s < 75) {
        const n = e.to;
        if (this.signalised[n]) {
          const dir = e.dir === "v" ? 0 : 1;
          if (this.preemptUntil[n] <= this.tick && this.phase[n] !== dir) m.signalsCleared++;
          this.preemptDir[n] = dir;
          this.preemptUntil[n] = this.tick + 3;
        }
      }
    }
  }

  dispatchAmbulance(hospitalNode: number, pickupNode: number, label: string): AmbulanceMission | null {
    const out = this.routeEdges(hospitalNode, pickupNode);
    const back = this.routeEdges(pickupNode, hospitalNode);
    if (!out.length || !back.length) return null;
    const route = [...out, ...back];
    const id = this.spawnAt(route[0]);
    if (id < 0) return null;
    const v = this.vehicles[id];
    v.kind = 3;
    v.route = route;
    v.routeIdx = 0;
    v.priority = this.settings.preemption;
    // Baseline: what this trip costs in current traffic without priority.
    let est = 0;
    for (const eid of route) {
      const e = EDGES[eid];
      // Without priority an ambulance still gets some room, but waits at reds and in queues.
      est += e.length / (1.15 * Math.max(0.75 * this.vmax(e), this.edgeSpeed[eid] || this.vmax(e)));
      if (this.signalised[e.to]) est += 7 + this.edgeStopped[eid] * 0.8;
    }
    const m: AmbulanceMission = {
      id: this.missionSeq++,
      vehicle: id,
      label,
      priority: Boolean(v.priority),
      dispatchedAt: this.t,
      pickupNode,
      hospitalNode,
      route,
      pickupIdx: out.length - 1,
      estimateNoPriority: est,
      progress: 0,
      signalsCleared: 0,
    };
    v.missionId = m.id;
    this.missions.unshift(m);
    if (this.missions.length > 8) this.missions.pop();
    return m;
  }

  private spawnAt(eid: number) {
    const id = this.free.length ? this.free.pop()! : this.vehicles.length;
    this.vehicles[id] = {
      id,
      alive: true,
      edge: eid,
      s: INSET,
      v: 0,
      dest: EDGES[eid].to,
      kind: 0,
      factor: 1,
      tickMoved: this.tick,
      start: this.t,
    };
    this.edgeQ[eid].push(id);
    this.edgeQ[eid].sort((a, b) => this.vehicles[b].s - this.vehicles[a].s);
    this.aliveCount++;
    return id;
  }

  private onMissionProgress(v: Vehicle) {
    const m = this.missions.find((x) => x.id === v.missionId);
    if (!m) return;
    const idx = v.routeIdx ?? 0;
    m.progress = idx / m.route.length;
    if (m.pickedUpAt === undefined && idx > m.pickupIdx) m.pickedUpAt = this.t;
  }

  private finishMission(v: Vehicle) {
    const m = this.missions.find((x) => x.id === v.missionId);
    if (m) {
      m.arrivedAt = this.t;
      m.progress = 1;
      if (m.pickedUpAt === undefined) m.pickedUpAt = this.t;
    }
    v.alive = false;
    this.free.push(v.id);
    this.aliveCount--;
  }

  /* ---------------------------------------------------------- incidents */

  setBlocked(eid: number, on: boolean) {
    this.blocked[eid] = on ? 1 : 0;
    this.recomputeRoutes();
  }

  /* ------------------------------------------------------------ summary */

  summary() {
    const last = this.minutes[this.minutes.length - 1];
    let hot = 0;
    for (let e = 0; e < NE; e++) if (this.congestion[e] >= 0.5) hot++;
    const avgTrip = this.tripTimes.length ? this.tripTimes.reduce((a, b) => a + b, 0) / this.tripTimes.length : 0;
    return {
      t: this.t,
      vehicles: this.aliveCount,
      target: this.targetVehicles(),
      speedKmh: last?.speedKmh ?? 0,
      congestion: last?.congestion ?? 0,
      stoppedPct: last?.stoppedPct ?? 0,
      tripsPerMin: last?.trips ?? 0,
      hotRoads: hot,
      avgTripMin: avgTrip / 60,
      signals: this.signalised.reduce((a, b) => a + b, 0),
    };
  }
}

/** Geometry helper: where a vehicle at (edge, s) sits on the map. India drives on the left. */
export function edgePoint(eid: number, s: number, laneOffset = 3.2): [number, number, number] {
  const e = EDGES[eid];
  const a = NODES[e.from];
  const b = NODES[e.to];
  const dx = (b.x - a.x) / e.length;
  const dy = (b.y - a.y) / e.length;
  // Left of the direction of travel: rotate (dx,dy) by -90deg -> (dy, -dx).
  const ox = dy * laneOffset;
  const oy = -dx * laneOffset;
  return [a.x + dx * s + ox, a.y + dy * s + oy, Math.atan2(dy, dx)];
}

export const MAP_BOUNDS = { x0: MARGIN, y0: MARGIN, x1: MARGIN + COLS * BLOCK, y1: MARGIN + ROWS * BLOCK, rows: ROWS };
