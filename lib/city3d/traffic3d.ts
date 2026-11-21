/**
 * Traffic on the 3D city's real road network (extracted from the models).
 *
 * Every vehicle is an agent with its own perception:
 *  - Car-following uses the Intelligent Driver Model (smooth acceleration and
 *    braking, a safe time headway and a minimum gap).
 *  - Each car projects its own trajectory ahead (lane, curved turn through the
 *    junction, exit lane) and checks it against the footprint of every vehicle
 *    nearby, the way an on-board edge-AI stack fuses detections with a planned
 *    path. A vehicle in its path is a hazard: the car brakes for it.
 *  - Junctions are a shared resource. Turning paths are precomputed as curves
 *    and every pair of movements that can collide is marked as a conflict. A
 *    car enters only when its exit lane has room ("don't block the box"), no
 *    conflicting movement is in the junction, and it has right of way:
 *    signals where there are signals, otherwise give-way rules (main road
 *    first, then first come, first served; turning traffic yields to
 *    oncoming traffic).
 *  - An overlap audit checks every pair of vehicles twice a second, so the
 *    "no collisions" claim is measured, not assumed.
 *
 * Signals are fixed-time or adaptive (queue pressure), emergency units get a
 * green wave and traffic pulls over to the kerb to let them through.
 * Left-hand traffic, as in India.
 */
import * as THREE from "three";
import { ROAD_LINKS, ROAD_NAMES, ROAD_NODES } from "./config";
import type { CityEngine } from "./engine";
import { buildVehicle, pickVehicle, VEHICLES, type VehicleSpec, type VehicleType } from "./vehicles";

const INSET = 7.5; // metres kept clear inside each junction
const LANE = 1.9; // lane centre offset from the road centre (drive on the left)
const ASIDE = 1.15; // extra kerb offset when pulling over
const B_COMF = 2.8; // comfortable braking (m/s²)
const B_MAX = 9; // emergency braking
const HEADWAY = 1.1; // s
const MIN_GAP = 2.0; // m
const SENSOR_RANGE = 34; // m

export type Percept = "free" | "follow" | "yield" | "brake" | "stop";

export interface Edge3 {
  id: number;
  from: number;
  to: number;
  length: number;
  dir: THREE.Vector2; // unit, x/z
  axis: "ns" | "ew";
  name: string;
  heights: number[]; // road surface y every ~4 m
  s0: number; // start of the straight part (after the junction box)
  s1: number; // stop line
}

interface Turn {
  key: string;
  node: number;
  from: number;
  to: number;
  kind: "straight" | "left" | "right" | "uturn";
  pts: Float32Array; // x, y, z
  cum: Float32Array;
  length: number;
}

export interface Car3 {
  id: number;
  edge: number;
  s: number;
  v: number;
  acc: number;
  spec: VehicleSpec;
  color: THREE.Color;
  len: number;
  hw: number;
  vmax: number;
  from: number; // edge we turned in from (-1 = spawned on this edge)
  turnLen: number;
  next: number; // -2 undecided, -1 leave the map here
  committed: boolean;
  /** Junctions this car holds a reservation in. */
  holds: number[];
  /** Junction reserved two links ahead (short links have no room to stop). */
  /** Links after `next` cleared in one go (short links have no room to stop). */
  chain: number[];
  chainNodes: number[];
  waitSince: number;
  reason: string | null;
  stuck: number;
  aside: number;
  asideGoal: number;
  state: Percept;
  hazard: number;
  hazardGap: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  priority?: boolean;
  route?: number[];
  routeIdx?: number;
  unit?: Unit3;
}

export interface Unit3 {
  id: string;
  label: string;
  kind: "ambulance" | "fire" | "police";
  car: Car3;
  object: THREE.Object3D;
  done: boolean;
  startedAt: number;
  arrivedAt?: number;
  estimate: number; // seconds without priority
  signalsCleared: number;
  onArrive?: () => void;
}

export interface EdgeAIStats {
  reroutes: number;
  yields: number;
  brakes: number;
  conflictsHeld: number;
  boxHeld: number;
  towed: number;
  overlaps: number;
  minClearance: number;
  checksPerSec: number;
  latencyMs: number;
  states: Record<Percept, number>;
}

const STATE_COLOR: Record<Percept, THREE.Color> = {
  free: new THREE.Color("#2fd07a"),
  follow: new THREE.Color("#35b7ff"),
  yield: new THREE.Color("#ffb21e"),
  brake: new THREE.Color("#ff4b3a"),
  stop: new THREE.Color("#ff2a6a"),
};

const RANK: Record<Turn["kind"], number> = { straight: 0, left: 0, right: 1, uturn: 2 };

export class Traffic3D {
  nodes = ROAD_NODES.map(([x, z]) => new THREE.Vector2(x, z));
  edges: Edge3[] = [];
  out: number[][] = [];
  inn: number[][] = [];
  queues: number[][] = [];
  cars: Car3[] = [];
  units: Unit3[] = [];
  blocked = new Set<number>();
  signalised: boolean[] = [];
  deadEnd: boolean[] = [];
  phase: number[] = []; // 0 = ns green, 1 = ew green
  amber: number[] = [];
  elapsed: number[] = [];
  preempt: number[] = [];
  adaptive = true;
  priorityEnabled = true;
  target = 48;
  congestion: Float32Array;
  speed: Float32Array;
  stopped: Uint16Array;
  t = 0;
  switches = 0;
  ai: EdgeAIStats = { reroutes: 0, yields: 0, brakes: 0, conflictsHeld: 0, boxHeld: 0, towed: 0, overlaps: 0, minClearance: 9, checksPerSec: 0, latencyMs: 0, states: { free: 0, follow: 0, yield: 0, brake: 0, stop: 0 } };
  /** Recent notable events for the alert feed. */
  events: { t: number; text: string }[] = [];

  private seq = 1;
  private crossings = new Map<number, { s: number; x: number; closed: boolean }[]>();
  private turns = new Map<string, Turn>();
  private conflicts = new Map<string, Set<string>>();
  private transits: Map<number, string>[] = [];
  private carIndex = new Map<number, Car3>();
  private grid = new Map<number, Car3[]>();
  private leadOf = new Map<number, number>();
  private checks = 0;
  private perceptMs = 0;
  private perceptSteps = 0;
  private checkClock = 0;
  private auditClock = 0;

  private group: THREE.Group;
  private bodies = new Map<VehicleType, THREE.InstancedMesh>();
  private lamps = new Map<VehicleType, THREE.InstancedMesh>();
  private lampMats: THREE.MeshBasicMaterial[] = [];
  private lights!: THREE.InstancedMesh;
  private scans!: THREE.InstancedMesh;
  private rings!: THREE.InstancedMesh;
  private marks!: THREE.InstancedMesh;
  private ribbons: THREE.Mesh[] = [];
  private tmp = new THREE.Object3D();
  private showHeat = true;
  private showAI = false;
  private flash = 0;

  constructor(private engine: CityEngine) {
    for (let i = 0; i < this.nodes.length; i++) {
      this.out.push([]);
      this.inn.push([]);
      this.transits.push(new Map());
    }
    for (const [a, b] of ROAD_LINKS) {
      this.addEdge(a, b);
      this.addEdge(b, a);
    }
    this.queues = this.edges.map(() => []);
    for (let n = 0; n < this.nodes.length; n++) {
      const lens = this.inn[n].map((e) => this.edges[e].length);
      // Signals on the big junctions; give-way rules on tight clusters of short links.
      this.signalised[n] = this.inn[n].length >= 4 || (this.inn[n].length === 3 && Math.min(...lens) >= 30);
      this.deadEnd[n] = this.inn[n].length === 1;
      this.phase[n] = n % 2;
      this.amber[n] = 0;
      this.elapsed[n] = (n * 7) % 20;
      this.preempt[n] = -1;
    }
    // Junction box per edge end, shrunk on very short links.
    for (const e of this.edges) {
      const i0 = this.deadEnd[e.from] ? 0 : Math.min(INSET, (e.length - 1) / 2);
      const i1 = this.deadEnd[e.to] ? 0 : Math.min(INSET, (e.length - 1) / 2);
      e.s0 = i0;
      e.s1 = e.length - i1;
    }
    this.congestion = new Float32Array(this.edges.length);
    this.speed = new Float32Array(this.edges.length);
    this.stopped = new Uint16Array(this.edges.length);

    // Road heights from the asphalt surfaces (the bridge deck, not its cables), smoothed.
    for (const e of this.edges) {
      const a = this.nodes[e.from];
      const n = Math.max(2, Math.ceil(e.length / 4));
      const pts: [number, number][] = [];
      for (let k = 0; k <= n; k++) {
        const s = (k / n) * e.length;
        pts.push([a.x + e.dir.x * s, a.y + e.dir.y * s]);
      }
      e.heights = engine.roadHeights(pts);
    }
    // Pull stop lines back until a waiting car is clear of every other path through the junction.
    for (let iter = 0; iter < 8; iter++) {
      this.buildTurns();
      let moved = 0;
      for (const e of this.edges) {
        if (this.deadEnd[e.to]) continue;
        const front = this.lanePoint(e.id, e.s1);
        const back = this.lanePoint(e.id, e.s1 - 5);
        for (const t of this.turns.values()) {
          if (t.node !== e.to || t.from === e.id) continue;
          if (sweepClear(t, front, back) < 0.35) {
            const ns = Math.max(e.s0, e.s1 - 1);
            if (ns < e.s1) {
              e.s1 = ns;
              moved++;
            }
            break;
          }
        }
      }
      if (!moved) break;
    }
    this.buildTurns(true);

    this.group = engine.layers.traffic;
    this.buildMeshes();
    this.seed();
    engine.onFrame.add(this.frame);
  }

  dispose() {
    this.engine.onFrame.delete(this.frame);
    this.group.clear();
    for (const u of this.units) u.object.removeFromParent();
  }

  /* ------------------------------------------------------------ geometry */

  private addEdge(a: number, b: number) {
    const A = this.nodes[a];
    const B = this.nodes[b];
    const d = new THREE.Vector2().subVectors(B, A);
    const length = d.length();
    const e: Edge3 = {
      id: this.edges.length,
      from: a,
      to: b,
      length,
      dir: d.normalize(),
      axis: Math.abs(B.x - A.x) > Math.abs(B.y - A.y) ? "ew" : "ns",
      name: ROAD_NAMES[`${a}-${b}`] ?? ROAD_NAMES[`${b}-${a}`] ?? "Link road",
      heights: [],
      s0: 0,
      s1: length,
    };
    this.edges.push(e);
    this.out[a].push(e.id);
    this.inn[b].push(e.id);
  }

  heightAt(eid: number, s: number) {
    const e = this.edges[eid];
    const f = Math.max(0, Math.min(1, s / e.length)) * (e.heights.length - 1);
    const i = Math.min(e.heights.length - 2, Math.floor(f));
    return e.heights[i] + (e.heights[i + 1] - e.heights[i]) * (f - i);
  }

  private lanePoint(eid: number, s: number, lat = LANE) {
    const e = this.edges[eid];
    const a = this.nodes[e.from];
    return new THREE.Vector3(a.x + e.dir.x * s + e.dir.y * lat, this.heightAt(eid, s), a.y + e.dir.y * s - e.dir.x * lat);
  }

  /** Curved paths through every junction, and which pairs of them collide. */
  private buildTurns(withConflicts = false) {
    this.turns.clear();
    for (let n = 0; n < this.nodes.length; n++) {
      const list: Turn[] = [];
      for (const ein of this.inn[n]) {
        for (const eout of this.out[n]) {
          const A = this.edges[ein];
          const B = this.edges[eout];
          const p0 = this.lanePoint(ein, A.s1);
          const p3 = this.lanePoint(eout, B.s0);
          const d0 = new THREE.Vector3(A.dir.x, 0, A.dir.y);
          const d1 = new THREE.Vector3(B.dir.x, 0, B.dir.y);
          const left = new THREE.Vector3(A.dir.y, 0, -A.dir.x);
          const dotF = d0.dot(d1);
          const dotL = d1.dot(left);
          const kind: Turn["kind"] = dotF < -0.7 ? "uturn" : dotL > 0.45 ? "left" : dotL < -0.45 ? "right" : "straight";
          const chord = p0.distanceTo(p3);
          const k = kind === "uturn" ? 4.5 : Math.max(1, chord * 0.42);
          const p1 = p0.clone().addScaledVector(d0, k);
          const p2 = p3.clone().addScaledVector(d1, -k);
          const N = 16;
          const pts = new Float32Array((N + 1) * 3);
          const cum = new Float32Array(N + 1);
          const v = new THREE.Vector3();
          let prev: THREE.Vector3 | null = null;
          for (let i = 0; i <= N; i++) {
            const t = i / N;
            const u = 1 - t;
            v.set(0, 0, 0)
              .addScaledVector(p0, u * u * u)
              .addScaledVector(p1, 3 * u * u * t)
              .addScaledVector(p2, 3 * u * t * t)
              .addScaledVector(p3, t * t * t);
            v.y = p0.y + (p3.y - p0.y) * t;
            pts.set([v.x, v.y, v.z], i * 3);
            cum[i] = prev ? cum[i - 1] + prev.distanceTo(v) : 0;
            prev = v.clone();
          }
          const turn: Turn = { key: `${ein}>${eout}`, node: n, from: ein, to: eout, kind, pts, cum, length: Math.max(0.5, cum[N]) };
          this.turns.set(turn.key, turn);
          list.push(turn);
        }
      }
      if (!withConflicts) continue;
      // Two movements conflict if a design car's footprint swept along one touches the other's.
      for (const a of list) {
        const set = new Set<string>();
        for (const b of list) {
          // Same approach: cars follow each other in, their own sensors keep the spacing.
          if (a === b || a.from === b.from) continue;
          if (a.to === b.to || sweepSweep(a, b) < 0.25) set.add(b.key);
        }
        this.conflicts.set(a.key, set);
      }
    }
  }

  private turnPoint(t: Turn, u: number, out: { x: number; y: number; z: number; yaw: number }) {
    const c = t.cum;
    const N = c.length - 1;
    const uu = Math.max(0, Math.min(t.length, u));
    let i = 0;
    while (i < N - 1 && c[i + 1] < uu) i++;
    const f = c[i + 1] > c[i] ? (uu - c[i]) / (c[i + 1] - c[i]) : 0;
    const p = t.pts;
    const x0 = p[i * 3], y0 = p[i * 3 + 1], z0 = p[i * 3 + 2];
    const x1 = p[i * 3 + 3], y1 = p[i * 3 + 4], z1 = p[i * 3 + 5];
    out.x = x0 + (x1 - x0) * f;
    out.y = y0 + (y1 - y0) * f;
    out.z = z0 + (z1 - z0) * f;
    out.yaw = Math.atan2(x1 - x0, z1 - z0);
    return out;
  }

  /** Point at trajectory position S on an edge entered from `from`. */
  private edgePoint(eid: number, from: number, S: number, lat: number, out: { x: number; y: number; z: number; yaw: number }) {
    const e = this.edges[eid];
    if (S < e.s0 && from >= 0) {
      const t = this.turns.get(`${from}>${eid}`);
      if (t) return this.turnPoint(t, S - (e.s0 - t.length), out);
    }
    const a = this.nodes[e.from];
    const s = Math.max(0, S);
    out.x = a.x + e.dir.x * s + e.dir.y * lat;
    out.z = a.y + e.dir.y * s - e.dir.x * lat;
    out.y = this.heightAt(eid, s);
    out.yaw = Math.atan2(e.dir.x, e.dir.y);
    return out;
  }

  /** Where the car's centre will be `d` metres ahead along its own plan, or null past its horizon. */
  private future(c: Car3, d: number, out: { x: number; y: number; z: number; yaw: number }) {
    const e = this.edges[c.edge];
    const S = c.s + d;
    const lat = this.lat(c, S);
    if (S <= e.s1 || (c.next === -1 && S <= e.length)) return this.edgePoint(c.edge, c.from, S, lat, out);
    if (!c.committed || c.next < 0) return null;
    const over = S - e.s1;
    const t = this.turns.get(`${c.edge}>${c.next}`);
    if (!t) return null;
    if (over <= t.length) return this.turnPoint(t, over, out);
    const n = this.edges[c.next];
    const S2 = n.s0 + (over - t.length);
    return S2 <= n.s1 ? this.edgePoint(c.next, c.edge, S2, LANE, out) : null;
  }

  /** Lateral position: units run near the centre line, others pull to the kerb — blended out near junctions so paths join smoothly. */
  private lat(c: Car3, S = c.s) {
    const e = this.edges[c.edge];
    const ss = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    const k = ss(S, e.s0, e.s0 + 8) * (1 - ss(S, e.s1 - 8, e.s1));
    if (c.priority) return LANE - 1.2 * k;
    return LANE + c.aside * ASIDE * k;
  }

  /** World position and heading of a car. */
  pose(c: Car3) {
    return { x: c.x, z: c.z, y: c.y, yaw: c.yaw };
  }

  private updatePose(c: Car3) {
    const p = this.edgePoint(c.edge, c.from, c.s, this.lat(c), { x: 0, y: 0, z: 0, yaw: 0 });
    const ahead = this.edgePoint(c.edge, c.from, c.s + 1.5, this.lat(c, c.s + 1.5), { x: 0, y: 0, z: 0, yaw: 0 });
    const behind = this.edgePoint(c.edge, c.from, c.s - 1.5, this.lat(c, c.s - 1.5), { x: 0, y: 0, z: 0, yaw: 0 });
    c.x = p.x;
    c.y = p.y;
    c.z = p.z;
    // Heading from the chord (smooth on curves); pitch from the slope.
    const dx = ahead.x - behind.x;
    const dz = ahead.z - behind.z;
    if (dx * dx + dz * dz > 1e-4) c.yaw = Math.atan2(dx, dz);
    c.pitch = Math.atan2(ahead.y - behind.y, Math.hypot(dx, dz) || 1);
  }

  /* ------------------------------------------------------------ vehicles */

  private makeCar(eid: number, s: number, spec?: VehicleSpec): Car3 {
    const id = this.seq++;
    const sp = spec ?? pickVehicle(id * 1.37 + Math.random());
    const car: Car3 = {
      id,
      edge: eid,
      s,
      v: 0,
      acc: 0,
      spec: sp,
      color: new THREE.Color(sp.paints[Math.floor(Math.random() * sp.paints.length)]),
      len: sp.length,
      hw: sp.width / 2,
      vmax: sp.vmax * (0.88 + Math.random() * 0.2),
      from: -1,
      turnLen: 0,
      next: -2,
      committed: false,
      holds: [],
      chain: [],
      chainNodes: [],
      waitSince: -1,
      reason: null,
      stuck: 0,
      aside: 0,
      asideGoal: 0,
      state: "free",
      hazard: -1,
      hazardGap: Infinity,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
    };
    return car;
  }

  private insert(c: Car3) {
    this.cars.push(c);
    this.carIndex.set(c.id, c);
    const q = this.queues[c.edge];
    q.push(c.id);
    q.sort((a, b) => (this.carIndex.get(b)?.s ?? 0) - (this.carIndex.get(a)?.s ?? 0));
    this.chooseNext(c);
    this.updatePose(c);
  }

  /** Initial fleet spread over the network. */
  private seed() {
    let placed = 0;
    const order = this.edges.map((e) => e.id).sort(() => Math.random() - 0.5);
    for (let pass = 0; pass < 4 && placed < this.target; pass++) {
      for (const eid of order) {
        if (placed >= this.target) break;
        const e = this.edges[eid];
        const spec = pickVehicle(Math.random() * 1000);
        const q = this.queues[eid];
        const tail = q.length ? this.carIndex.get(q[q.length - 1])! : null;
        const hi = tail ? tail.s - tail.len / 2 - spec.length / 2 - 9 - Math.random() * 14 : e.s1 - spec.length / 2 - 4 - Math.random() * 10;
        if (hi < e.s0 + spec.length / 2 + 1) continue;
        this.insert(this.makeCar(eid, hi, spec));
        placed++;
      }
    }
  }

  /** New car entering from the edge of the map (or anywhere there is room). */
  spawn(): Car3 | null {
    const boundary = this.edges.filter((e) => this.deadEnd[e.from] && !this.blocked.has(e.id));
    const pool = Math.random() < 0.85 && boundary.length ? boundary : this.edges.filter((e) => !this.blocked.has(e.id) && e.s1 - e.s0 > 18);
    const w = pool.map((e) => this.gateWeight(e.from));
    const total = w.reduce((a, b) => a + b, 0);
    for (let tries = 0; tries < 4; tries++) {
      let r = Math.random() * total;
      let e = pool[0];
      for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) {
        e = pool[i];
        break;
      }
      const spec = pickVehicle(Math.random() * 1000);
      const s = e.s0 + spec.length / 2 + 0.5;
      if (s + spec.length / 2 > e.s1 - 1) continue;
      const p = this.lanePoint(e.id, s);
      if (this.cars.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < (o.len + spec.length) / 2 + 3)) continue;
      const q = this.queues[e.id];
      const tail = q.length ? this.carIndex.get(q[q.length - 1]) : null;
      if (tail && tail.s - tail.len / 2 < s + spec.length / 2 + 4) continue;
      const c = this.makeCar(e.id, s, spec);
      c.v = Math.min(6, c.vmax * 0.5);
      this.insert(c);
      return c;
    }
    return null;
  }

  /**
   * Give a civilian car a trip: from where it is to one of the exits at the
   * edge of the map, by the quickest route on current speeds. Trips end, so
   * cars don't circulate forever and lock the network.
   */
  private planTrip(c: Car3, replan = false, avoid = -1) {
    const e = this.edges[c.edge];
    if (this.deadEnd[e.to]) {
      c.route = [c.edge];
      c.routeIdx = 0;
      c.next = -1;
      return true;
    }
    const exits = this.deadEnd.map((d, i) => (d && i !== e.from ? i : -1)).filter((i) => i >= 0);
    const keep = replan && c.route ? c.route[c.route.length - 1] : -1;
    let goalNode = keep >= 0 && this.deadEnd[this.edges[keep].to] ? this.edges[keep].to : -1;
    if (goalNode < 0) {
      const w = exits.map((x) => this.gateWeight(x));
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      goalNode = exits[exits.length - 1];
      for (let i = 0; i < exits.length; i++) if ((r -= w[i]) <= 0) {
        goalNode = exits[i];
        break;
      }
    }
    let path = this.route(e.to, goalNode, avoid, true);
    if (!path) for (const x of exits) if ((path = this.route(e.to, x, avoid, true))) break;
    if (!path || !path.length || this.edges[path[0]].to === e.from) return false;
    c.route = [c.edge, ...path];
    c.routeIdx = 0;
    c.next = path[0];
    if (replan) this.ai.reroutes++;
    return true;
  }

  /** Share of trips that start or end at a map gate: the forest road over the single-lane river bridge carries less. */
  private gateWeight(node: number) {
    const x = this.nodes[node].x;
    return x < -150 ? 0.35 : 1;
  }

  private byId(id: number) {
    return this.carIndex.get(id);
  }

  setTarget(n: number) {
    this.target = Math.max(0, Math.min(160, Math.round(n)));
  }

  setBlocked(eids: number[], on: boolean) {
    for (const id of eids) {
      if (on) this.blocked.add(id);
      else this.blocked.delete(id);
    }
    // Re-plan anyone heading into a closed road.
    for (const c of this.cars) {
      if (c.unit || c.committed) continue;
      const rest = c.route?.slice((c.routeIdx ?? 0) + 1) ?? [];
      if (rest.some((id) => this.blocked.has(id))) this.planTrip(c, true);
    }
  }

  /** Railway level crossing on edge `eid` at distance `s`. */
  addCrossing(eid: number, s: number) {
    const e = this.edges[eid];
    const x = this.nodes[e.from].x + e.dir.x * s;
    const list = this.crossings.get(eid) ?? [];
    list.push({ s, x, closed: false });
    this.crossings.set(eid, list);
  }

  setCrossingClosed(x: number, closed: boolean) {
    for (const list of this.crossings.values()) for (const c of list) if (Math.abs(c.x - x) < 3) c.closed = closed;
  }

  setAIVisible(on: boolean) {
    this.showAI = on;
    this.scans.visible = on;
    this.rings.visible = on;
    this.marks.visible = on;
  }

  get aiVisible() {
    return this.showAI;
  }

  isGreen(eid: number) {
    const n = this.edges[eid].to;
    if (!this.signalised[n]) return true;
    if (this.amber[n] > 0) return false;
    return this.phase[n] === 0 ? this.edges[eid].axis === "ns" : this.edges[eid].axis === "ew";
  }

  private chooseNext(c: Car3) {
    if (!c.unit && (!c.route || c.route[c.routeIdx ?? 0] !== c.edge)) {
      if (this.planTrip(c)) return;
      c.route = undefined;
    }
    c.next = this.pickNext(c.edge, c, 1);
  }

  /** Next link after `eid` for car c (`ahead` = how many links past its current one). */
  private pickNext(eid: number, c: Car3, ahead = 2): number {
    const e = this.edges[eid];
    if (c.route) return c.route[(c.routeIdx ?? 0) + ahead] ?? -1;
    if (this.deadEnd[e.to]) return -1;
    const opts = this.out[e.to].filter((o) => this.edges[o].to !== e.from && !this.blocked.has(o));
    if (!opts.length) {
      const back = this.out[e.to].filter((o) => !this.blocked.has(o));
      return back.length ? back[0] : -1;
    }
    const w = opts.map((o) => {
      const k = this.turns.get(`${eid}>${o}`)?.kind;
      return k === "straight" ? 0.5 : k === "left" ? 0.3 : 0.2;
    });
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) {
      r -= w[i];
      if (r <= 0) return opts[i];
    }
    return opts[opts.length - 1];
  }

  /** Shortest path (by length) between two junctions avoiding closed roads. */
  route(from: number, to: number, avoid = -1, byTime = false): number[] | null {
    const dist = new Array(this.nodes.length).fill(Infinity);
    const via = new Array(this.nodes.length).fill(-1);
    const done = new Array(this.nodes.length).fill(false);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < dist.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      if (u === to) break;
      done[u] = true;
      for (const eid of this.out[u]) {
        if (this.blocked.has(eid) || eid === avoid) continue;
        const e = this.edges[eid];
        // No U-turns mid-route.
        if (via[u] >= 0 && this.edges[via[u]].from === e.to) continue;
        const w = byTime ? e.length / Math.max(2, Math.min(11, this.speed[eid] || 11)) + this.queues[eid].length * 0.8 : e.length;
        if (dist[u] + w < dist[e.to]) {
          dist[e.to] = dist[u] + w;
          via[e.to] = eid;
        }
      }
    }
    if (dist[to] === Infinity) return null;
    const path: number[] = [];
    for (let cur = to; cur !== from; cur = this.edges[via[cur]].from) path.unshift(via[cur]);
    return path;
  }

  nearestNode(x: number, z: number) {
    let best = 0;
    let bd = Infinity;
    this.nodes.forEach((n, i) => {
      if (!this.out[i].length) return;
      const d = Math.hypot(n.x - x, n.y - z);
      if (d < bd) (bd = d), (best = i);
    });
    return best;
  }

  /** Send an emergency vehicle between two points along the roads. */
  dispatch(kind: Unit3["kind"], label: string, fromX: number, fromZ: number, toX: number, toZ: number, onArrive?: () => void): Unit3 | null {
    const a = this.nearestNode(fromX, fromZ);
    const b = this.nearestNode(toX, toZ);
    const path = a === b ? [this.out[a][0]] : this.route(a, b);
    if (!path || !path.length) return null;
    const spec: VehicleSpec = { type: "sedan", length: kind === "fire" ? 7.6 : kind === "ambulance" ? 5.6 : 4.6, width: kind === "fire" ? 2.4 : 2.0, vmax: 15, accel: 2.4, share: 0, paints: ["#ffffff"] };
    const e0 = this.edges[path[0]];
    // Vehicles at the start of the first road give room.
    const s = e0.s0 + spec.length / 2 + 0.5;
    for (const id of [...this.queues[e0.id]]) {
      const o = this.byId(id);
      if (o && !o.unit && Math.abs(o.s - s) < (o.len + spec.length) / 2 + 2) this.remove(o);
    }
    const car = this.makeCar(e0.id, s, spec);
    car.priority = this.priorityEnabled;
    car.route = path;
    car.routeIdx = 0;
    car.vmax = this.priorityEnabled ? 15 : 12;
    // Estimate without priority: current speeds plus ~10 s per signal.
    let est = 0;
    for (const eid of path) {
      est += this.edges[eid].length / Math.max(3, this.speed[eid] || 11);
      if (this.signalised[this.edges[eid].to]) est += 10 + this.stopped[eid] * 1.5;
    }
    const obj = this.makeUnitObject(kind);
    this.group.add(obj);
    const unit: Unit3 = { id: `u${car.id}`, label, kind, car, object: obj, done: false, startedAt: this.t, estimate: est, signalsCleared: 0, onArrive };
    car.unit = unit;
    this.insert(car);
    this.units.unshift(unit);
    if (this.units.length > 12) this.units.pop()?.object.removeFromParent();
    return unit;
  }

  private makeUnitObject(kind: Unit3["kind"]) {
    const g = new THREE.Group();
    const geo = buildVehicle(kind);
    const paint = kind === "fire" ? "#c8261e" : kind === "police" ? "#1d3f8f" : "#f4f4f0";
    const body = new THREE.Mesh(geo.body, new THREE.MeshStandardMaterial({ vertexColors: true, color: paint, roughness: 0.4, metalness: 0.25 }));
    body.castShadow = true;
    const lamps = new THREE.Mesh(geo.lights, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    lamps.name = "lamps";
    g.add(body, lamps);
    const roof = kind === "fire" ? 2.75 : kind === "ambulance" ? 2.55 : 1.55;
    const zb = kind === "fire" ? 2.6 : kind === "ambulance" ? 0.9 : -0.1;
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.32), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.3), toneMapped: false }));
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 4), toneMapped: false }));
    red.position.set(-0.35, roof, zb);
    blue.position.set(0.35, roof, zb);
    red.name = "beacon-a";
    blue.name = "beacon-b";
    g.add(red, blue);
    const glow = new THREE.PointLight("#ff3030", 0, 22, 2);
    glow.position.set(0, roof + 0.5, zb);
    glow.name = "beacon-light";
    g.add(glow);
    return g;
  }

  /* ---------------------------------------------------------------- step */

  private frame = (dt: number) => {
    const steps = Math.min(4, Math.ceil(dt / 0.04));
    for (let i = 0; i < steps; i++) this.step(dt / steps);
    this.render(dt);
  };

  private buildGrid() {
    this.grid.clear();
    for (const c of this.cars) {
      const k = cellKey(c.x, c.z);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(c);
    }
  }

  private near(x: number, z: number, r: number, out: Car3[]) {
    out.length = 0;
    const c0 = Math.floor((x - r) / CELL);
    const c1 = Math.floor((x + r) / CELL);
    const r0 = Math.floor((z - r) / CELL);
    const r1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
      const l = this.grid.get(i * 4096 + j);
      if (l) for (const c of l) out.push(c);
    }
    return out;
  }

  /** Perception: first vehicle footprint on this car's planned path. */
  private perceive(c: Car3, cand: Car3[]) {
    c.hazard = -1;
    c.hazardGap = Infinity;
    const D = Math.min(SENSOR_RANGE, 5 + c.v * 1.6 + (c.v * c.v) / (2 * B_COMF));
    const hx = Math.sin(c.yaw);
    const hz = Math.cos(c.yaw);
    this.near(c.x + hx * D * 0.5, c.z + hz * D * 0.5, D * 0.5 + 8, cand);
    if (cand.length <= 1) return;
    // Close-range check of the whole body (side-swipes from long vehicles turning).
    for (const o of cand) {
      if (o === c || (c.priority && o.aside > 0.5) || (o.priority && c.aside > 0.5)) continue;
      const rx = o.x - c.x;
      const rz = o.z - c.z;
      if (rx * hx + rz * hz < 0.5 || rx * rx + rz * rz > 144) continue;
      if (Math.abs(o.y - c.y) > 3) continue;
      if (Math.cos(o.yaw - c.yaw) < -0.5) continue; // oncoming lane: handled by the path check
      if (capsuleCapsule(c, o) - c.hw - o.hw < 0.2) {
        c.hazard = o.id;
        c.hazardGap = 0;
        return;
      }
    }
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    const lead = this.leadOf.get(c.id);
    for (let d = 0; d <= D; d += 1.25) {
      const f = this.future(c, c.len / 2 + d, p);
      if (!f) break;
      for (const o of cand) {
        if (o === c || o.id === lead) continue;
        if (c.priority && o.aside > 0.5) continue;
        if (o.priority && c.aside > 0.5) continue;
        // Ignore vehicles behind us.
        const rx = o.x - c.x;
        const rz = o.z - c.z;
        if (rx * hx + rz * hz < 0) continue;
        this.checks++;
        const dist = pointCapsule(f.x, f.z, o);
        if (dist < o.hw + c.hw + 0.25 && Math.abs(o.y - f.y) < 3) {
          c.hazard = o.id;
          c.hazardGap = d;
          return;
        }
      }
    }
  }

  private idm(c: Car3, gap: number, dv: number, s0 = MIN_GAP) {
    const a = c.spec.accel;
    const sStar = s0 + Math.max(0, c.v * HEADWAY + (c.v * dv) / (2 * Math.sqrt(a * B_COMF)));
    return -a * (sStar / Math.max(gap, 0.05)) ** 2;
  }

  step(dt: number) {
    this.t += dt;
    this.updateSignals(dt);
    this.updateAside(dt);
    this.buildGrid();
    const cand: Car3[] = [];

    // Lane leaders (what car-following already handles), so perception looks past them.
    this.leadOf.clear();
    for (const q of this.queues) {
      for (let k = 1; k < q.length; k++) {
        const c = this.byId(q[k]);
        if (!c) continue;
        for (let j = k - 1; j >= 0; j--) {
          const o = this.byId(q[j]);
          if (!o || (c.priority && o.aside > 0.5) || (o.priority && c.aside > 0.5)) continue;
          this.leadOf.set(c.id, o.id);
          break;
        }
      }
    }
    const t0 = performance.now();
    for (const c of this.cars) this.perceive(c, cand);
    this.perceptMs += performance.now() - t0;
    this.perceptSteps++;

    for (let eid = 0; eid < this.edges.length; eid++) {
      const e = this.edges[eid];
      const q = this.queues[eid];
      let sum = 0;
      let stopped = 0;
      for (let k = 0; k < q.length; k++) {
        const c = this.byId(q[k]);
        if (!c) continue;
        const vmax = c.aside > 0.3 ? Math.min(c.vmax, 3.5) : c.vmax;
        let acc = c.spec.accel * (1 - (c.v / vmax) ** 4);
        let state: Percept = "free";
        let capS = Infinity;

        // 1. Car ahead in the lane (skip units' pulled-over traffic when overtaking).
        let lead: Car3 | undefined;
        for (let j = k - 1; j >= 0; j--) {
          const o = this.byId(q[j]);
          if (!o) continue;
          if (c.priority && o.aside > 0.5) continue; // overtaking pulled-over traffic
          if (o.priority && c.aside > 0.5) continue; // the unit passing us at the kerb
          // Hard limit against every car ahead in the lane, not only the nearest.
          capS = Math.min(capS, o.s - (o.len + c.len) / 2 - 0.4);
          if (!lead) lead = o;
          if (o.s - c.s > 40) break;
        }
        if (lead) {
          const gap = lead.s - c.s - (lead.len + c.len) / 2;
          if (gap < 30) state = "follow";
          acc += this.idm(c, gap, c.v - lead.v);
        }

        // 2. Junction: head-of-line car decides whether it may enter.
        if (!lead || lead.committed) {
          if (!c.committed && c.next !== -1) {
            const toStop = e.s1 - (c.s + c.len / 2);
            if (toStop < Math.max(28, c.v * 3)) {
              c.reason = this.canEnter(c);
              const canStop = (c.v * c.v) / (2 * 4.5) < toStop;
              if (c.reason === null && toStop < Math.max(3, c.v * 1.3 + 2)) this.commit(c);
              else if (c.reason === "red" && !canStop && this.amber[e.to] > 0 && this.canEnter(c, true) === null) this.commit(c);
              if (!c.committed) {
                acc = Math.min(acc, c.spec.accel * (1 - (c.v / vmax) ** 4) + this.idm(c, toStop, c.v, 0.4));
                if (toStop < 6 && c.reason) state = c.reason === "red" ? "stop" : "yield";
                capS = Math.min(capS, e.s1 - c.len / 2);
                if (toStop < 1.6 && c.v < 0.6 && c.waitSince < 0) c.waitSince = this.t;
              }
            } else c.reason = null;
          }
        }

        // 2b. Level crossing barriers.
        let held = false;
        const xs = this.crossings.get(eid);
        if (xs) {
          for (const cr of xs) {
            if (!cr.closed) continue;
            const front = c.s + c.len / 2;
            const stopAt = cr.s - 4.5;
            if (front < stopAt + 0.6) {
              acc = Math.min(acc, c.spec.accel * (1 - (c.v / vmax) ** 4) + this.idm(c, stopAt - front, c.v, 0.3));
              capS = Math.min(capS, stopAt - c.len / 2);
              if (stopAt - front < 8) state = "stop";
              held = true;
            }
          }
        }

        // 3. Perception hazard on the planned path.
        if (c.hazard >= 0) {
          const o = this.byId(c.hazard);
          if (o && o !== lead) {
            const along = Math.max(0, o.v * Math.cos(o.yaw - c.yaw));
            // Mutual sighting: the vehicle already committed (or with the lower id) goes first.
            // Mutual sighting: whoever is already in a junction (or committed, or a unit) goes first.
            const rank = (x: Car3) => (x.priority ? 8 : 0) + (x.holds.length ? 4 : 0) + (x.committed ? 2 : 0);
            const mutual = o.hazard === c.id && (rank(c) !== rank(o) ? rank(c) > rank(o) : c.id < o.id);
            // A unit that has been boxed in for a while squeezes through.
            const squeeze = !!c.unit && c.stuck > 12;
            if (!mutual && !squeeze) {
              const a2 = c.spec.accel * (1 - (c.v / vmax) ** 4) + this.idm(c, c.hazardGap, c.v - along, 1.2);
              if (a2 < acc) {
                acc = a2;
                if (c.state !== "brake" && a2 < -1) this.ai.brakes++;
                state = "brake";
              }
              capS = Math.min(capS, c.s + Math.max(0, c.hazardGap - 0.6));
            }
          }
        }

        if (state === "yield" && c.state !== "yield") this.ai.yields++;
        c.state = c.v < 0.3 && state === "free" ? "stop" : state;
        acc = Math.max(-B_MAX, acc);
        c.acc = acc;
        c.v = Math.max(0, Math.min(vmax * 1.02, c.v + acc * dt));
        let ns = c.s + c.v * dt;
        if (ns > capS) {
          ns = Math.max(c.s, capS);
          if (ns === c.s) c.v = 0;
        }
        c.s = ns;
        sum += c.v;
        if (c.v < 0.5) stopped++;
        // Tow vehicles stuck for a long time (not at a red light).
        // Only a head-of-line car that cannot move for a long time counts as stuck (queuing is normal).
        if (c.v < 0.1 && (!lead || lead.committed || c.unit) && c.reason !== "red" && !held) c.stuck += dt;
        else c.stuck = 0;
      }
      // Keep the lane order physical (units overtake pulled-over traffic).
      for (let k = 1; k < q.length; k++) {
        if ((this.byId(q[k])?.s ?? 0) > (this.byId(q[k - 1])?.s ?? 0)) {
          q.sort((a, b) => (this.byId(b)?.s ?? 0) - (this.byId(a)?.s ?? 0));
          break;
        }
      }
      const mean = q.length ? sum / q.length : 11;
      this.speed[eid] = mean;
      this.stopped[eid] = stopped;
      const density = q.length * 7.5 / Math.max(10, e.s1 - e.s0);
      const raw = q.length ? Math.min(1, 0.6 * (1 - mean / 11) + 0.6 * density) : 0;
      this.congestion[eid] += (raw - this.congestion[eid]) * Math.min(1, dt * 0.8);
    }

    // Transfers through junctions, exits and arrivals.
    for (const c of [...this.cars]) {
      const e = this.edges[c.edge];
      if (c.holds.length) this.releaseHolds(c);
      if (c.next === -1) {
        const end = c.unit ? e.s1 - c.len / 2 : e.length - 0.5;
        if (c.s >= end - 0.2) {
          if (c.unit) this.arrive(c);
          else this.remove(c);
        }
        continue;
      }
      if (c.committed && c.s >= e.s1) this.transfer(c);
      else if (c.stuck > 45 && !c.unit) {
        this.ai.towed++;
        this.remove(c);
      }
    }

    for (const c of this.cars) this.updatePose(c);

    // Keep the fleet at its target size.
    const civilians = this.cars.length - this.units.filter((u) => !u.done).length;
    if (civilians < this.target && Math.random() < dt * 4) this.spawn();
    else if (civilians > this.target + 5) {
      const victim = this.cars.find((c) => !c.unit && c.next === -1) ?? this.cars.find((c) => !c.unit && c.v > 0.5);
      if (victim) this.remove(victim);
    }

    this.checkClock += dt;
    if (this.checkClock >= 1) {
      this.ai.checksPerSec = Math.round(this.checks / this.checkClock);
      // Measured: wall-clock time of one perception pass over the whole fleet.
      this.ai.latencyMs = this.perceptSteps ? +(this.perceptMs / this.perceptSteps).toFixed(2) : 0;
      this.perceptMs = 0;
      this.perceptSteps = 0;
      this.checks = 0;
      this.checkClock = 0;
    }
    this.auditClock += dt;
    if (this.auditClock >= 0.5) {
      this.auditClock = 0;
      this.audit();
    }
  }

  /** May car c enter the junction ahead? null = yes, otherwise the reason it must wait. */
  private canEnter(c: Car3, ignoreSignal = false): string | null {
    const e = this.edges[c.edge];
    const n = e.to;
    if (c.next >= 0 && this.blocked.has(c.next) && !c.unit) this.planTrip(c, true);
    if (c.next < 0) return null;
    if (!ignoreSignal && !c.priority && !this.isGreen(c.edge)) return "red";
    const nx = this.edges[c.next];
    const q2 = this.queues[c.next];
    if (q2.length && this.storage(c.next) >= c.len + 3) {
      const last = this.byId(q2[q2.length - 1]);
      if (last && last.s - last.len / 2 < nx.s0 + (c.priority ? 1 : c.len + 1.5)) {
        if (c.reason !== "box") this.ai.boxHeld++;
        // Exit blocked for a while: look for another way round.
        if (!c.unit && c.waitSince >= 0 && this.t - c.waitSince > 12 && (c.stuck % 6) < 0.05) {
          const old = c.next;
          if (this.planTrip(c, true, old) && c.next !== old) return "reroute";
        }
        return "box";
      }
    }
    const key = `${c.edge}>${c.next}`;
    const conf = this.conflicts.get(key);
    const mine = this.turns.get(key);
    if (!conf || !mine) return null;
    for (const [oid, k2] of this.transits[n]) {
      if (oid !== c.id && conf.has(k2)) {
        if (c.reason !== "conflict") this.ai.conflictsHeld++;
        return "conflict";
      }
    }
    const r = this.chainCheck(c, ignoreSignal);
    if (r) {
      if (r === "conflict" && c.reason !== "conflict") this.ai.conflictsHeld++;
      return r;
    }
    if (c.priority) return null;
    const myRank = RANK[mine.kind];
    const myWait = c.waitSince >= 0 ? this.t - c.waitSince : 0;
    for (const e2 of this.inn[n]) {
      if (e2 === c.edge) continue;
      const q = this.queues[e2];
      const h = q.length ? this.byId(q[0]) : undefined;
      if (!h || h.committed || h.next < 0) continue;
      const k2 = `${e2}>${h.next}`;
      if (!conf.has(k2)) continue;
      if (h.priority) return "yield";
      const theirs = RANK[this.turns.get(k2)?.kind ?? "straight"];
      const hToStop = this.edges[e2].s1 - (h.s + h.len / 2);
      const hWait = h.waitSince >= 0 ? this.t - h.waitSince : -1;
      const hReady = h.reason === null || h.reason === "yield" || h.reason === "conflict";
      if (this.signalised[n]) {
        if (!this.isGreen(e2)) continue;
        // Permissive turns give way to oncoming traffic (with a starvation guard).
        if (theirs < myRank && hToStop < 25 && myWait < 14) return "yield";
        if (theirs === myRank && hWait >= 0 && hReady && (c.waitSince < 0 || h.waitSince < c.waitSince)) return "yield";
      } else {
        const mainRoad = myRank === 0 && c.v > 2;
        if (theirs === 0 && myRank > 0 && hToStop < 15 && h.v > 2 && myWait < 12) return "yield";
        if (hWait >= 0 && hReady && !(mainRoad && theirs > 0 && hWait < 12)) {
          if (c.waitSince < 0 || h.waitSince < c.waitSince - 1e-6 || (Math.abs(h.waitSince - c.waitSince) < 1e-6 && h.id < c.id)) return "yield";
        }
        if (hWait < 0 && hToStop < 7 && h.v > 3 && c.v < 1) return "yield";
      }
    }
    return null;
  }

  private commit(c: Car3) {
    c.committed = true;
    c.waitSince = -1;
    const e = this.edges[c.edge];
    if (c.next >= 0) {
      this.hold(c, e.to, `${c.edge}>${c.next}`);
      c.chainNodes = [];
      let cur = c.next;
      for (const nxt of c.chain) {
        const m = this.edges[cur].to;
        this.hold(c, m, `${cur}>${nxt}`);
        c.chainNodes.push(m);
        cur = nxt;
      }
    }
  }

  private hold(c: Car3, node: number, key: string) {
    this.transits[node].set(c.id, key);
    if (!c.holds.includes(node)) c.holds.push(node);
  }

  /** Drop reservations for junctions the car has fully cleared. */
  private releaseHolds(c: Car3) {
    const e = this.edges[c.edge];
    c.holds = c.holds.filter((node) => {
      const keep = node === e.to || c.chainNodes.includes(node) || (node === e.from && c.s - c.len / 2 < e.s0);
      if (!keep) this.transits[node].delete(c.id);
      return keep;
    });
  }

  private storage(eid: number) {
    const e = this.edges[eid];
    return e.s1 - e.s0;
  }

  /**
   * Short links have no room to wait in, so a car entering one must also be
   * able to leave it: walk ahead through consecutive short links
   * checking each junction's signal, conflicts and the room on the link after.
   */
  private chainCheck(c: Car3, ignoreSignal: boolean): string | null {
    c.chain = [];
    let cur = c.next;
    let platoon = 0; // length of the cars ahead of us on the short links, going our way
    for (let depth = 0; ; depth++) {
      const e = this.edges[cur];
      if (this.deadEnd[e.to] || this.storage(cur) >= c.len + 3) break;
      if (depth >= 6) return "box";
      const nxt = this.pickNext(cur, c, 2 + depth);
      if (nxt < 0 || this.blocked.has(nxt)) return "box";
      // Cars already on the short link: follow them only as a platoon heading the same way.
      for (const id of this.queues[cur]) {
        if (id === c.id) continue;
        const o = this.byId(id);
        if (!o) continue;
        if (!o.committed) return "box";
        if (o.next === nxt) platoon += o.len + MIN_GAP;
      }
      if (!ignoreSignal && !c.priority && !this.isGreen(cur)) return "red";
      const conf = this.conflicts.get(`${cur}>${nxt}`);
      if (conf) for (const [oid, k2] of this.transits[e.to]) if (oid !== c.id && conf.has(k2)) return "conflict";
      const n2 = this.edges[nxt];
      const q = this.queues[nxt];
      const room = q.length ? (() => {
        const last = this.byId(q[q.length - 1])!;
        return last.s - last.len / 2 - n2.s0;
      })() : n2.s1 - n2.s0 + 50;
      if (room - platoon < (c.priority ? 1 : c.len + 1.5)) return "box";
      c.chain.push(nxt);
      cur = nxt;
      if (this.storage(nxt) >= c.len + 3 || this.deadEnd[n2.to]) break;
    }
    return null;
  }

  private transfer(c: Car3) {
    const from = c.edge;
    const next = c.next;
    const e = this.edges[from];
    const q = this.queues[from];
    const i = q.indexOf(c.id);
    if (i >= 0) q.splice(i, 1);
    const t = this.turns.get(`${from}>${next}`);
    const turnLen = t?.length ?? 0;
    const over = c.s - e.s1;
    const nx = this.edges[next];
    c.edge = next;
    c.from = from;
    c.turnLen = turnLen;
    c.s = nx.s0 - turnLen + over;
    c.committed = false;
    c.reason = null;
    if (c.route) c.routeIdx = (c.routeIdx ?? 0) + 1;
    const q2 = this.queues[next];
    q2.push(c.id);
    q2.sort((a, b) => (this.byId(b)?.s ?? 0) - (this.byId(a)?.s ?? 0));
    if (c.chain.length && c.chainNodes[0] === nx.to) {
      // Already cleared through the next junction as part of the same manoeuvre.
      c.next = c.chain.shift()!;
      c.chainNodes.shift();
      c.committed = true;
    } else {
      c.chain = [];
      c.chainNodes = [];
      this.chooseNext(c);
    }
  }

  private arrive(c: Car3) {
    const u = c.unit;
    if (u && !u.done) {
      u.done = true;
      u.arrivedAt = this.t;
      // Park at the kerb with beacons on for a while.
      u.object.userData.parkedUntil = this.t + 25;
      u.object.userData.parked = { x: c.x + Math.cos(c.yaw) * 1.6, y: c.y, z: c.z - Math.sin(c.yaw) * 1.6, yaw: c.yaw };
      u.onArrive?.();
      this.events.push({ t: this.t, text: `${u.label} arrived in ${(u.arrivedAt - u.startedAt).toFixed(0)} s` });
    }
    this.remove(c);
  }

  private remove(c: Car3) {
    const q = this.queues[c.edge];
    const i = q.indexOf(c.id);
    if (i >= 0) q.splice(i, 1);
    for (const n of c.holds) this.transits[n].delete(c.id);
    c.holds = [];
    const k = this.cars.indexOf(c);
    if (k >= 0) this.cars.splice(k, 1);
    this.carIndex.delete(c.id);
  }

  /** Traffic in front of an emergency unit pulls over to the kerb. */
  private updateAside(dt: number) {
    for (const c of this.cars) c.asideGoal = 0;
    for (const u of this.units) {
      if (u.done || !u.car.priority) continue;
      const uc = u.car;
      for (const id of this.queues[uc.edge]) {
        const o = this.byId(id);
        if (o && o !== uc && o.s > uc.s - (o.len + uc.len) / 2 - 3 && o.s - uc.s < 55) o.asideGoal = 1;
      }
      if (uc.next >= 0 && this.edges[uc.edge].s1 - uc.s < 40) {
        for (const id of this.queues[uc.next]) {
          const o = this.byId(id);
          if (o && o.s < this.edges[uc.next].s0 + 30) o.asideGoal = 1;
        }
      }
    }
    for (const c of this.cars) {
      if (c.priority) continue;
      // Pull over quickly, rejoin slowly (and only when moving off).
      const k = c.asideGoal > c.aside ? dt * 1.6 : dt * 0.5;
      c.aside += Math.max(-k, Math.min(k, c.asideGoal - c.aside));
    }
  }

  /** Independent safety check: does any pair of vehicle footprints intersect? */
  private audit() {
    let overlaps = 0;
    let minC = 9;
    const cand: Car3[] = [];
    for (const a of this.cars) {
      this.near(a.x, a.z, 8, cand);
      for (const b of cand) {
        if (b.id <= a.id) continue;
        if ((a.priority && b.aside > 0.3) || (b.priority && a.aside > 0.3)) continue;
        if (Math.abs(a.y - b.y) > 3) continue;
        const d = capsuleCapsule(a, b) - a.hw - b.hw;
        if (d < minC) minC = d;
        if (d < -0.35) overlaps++;
      }
    }
    this.ai.overlaps = overlaps;
    this.ai.minClearance = minC;
  }

  private updateSignals(dt: number) {
    // Green wave: junctions ahead of a priority vehicle within 70 m switch to it.
    for (const u of this.units) {
      if (u.done || !u.car.priority) continue;
      const e = this.edges[u.car.edge];
      if (e.s1 - u.car.s < 70 && this.signalised[e.to]) {
        const want = e.axis === "ns" ? 0 : 1;
        if (this.preempt[e.to] < 0 && this.phase[e.to] !== want) {
          u.signalsCleared++;
          this.events.push({ t: this.t, text: `Green wave: junction ${e.to} cleared for ${u.label}` });
        }
        this.preempt[e.to] = want;
      }
    }
    for (let n = 0; n < this.nodes.length; n++) {
      if (!this.signalised[n]) continue;
      if (this.amber[n] > 0) {
        this.amber[n] -= dt;
        if (this.amber[n] <= 0) {
          this.phase[n] = 1 - this.phase[n];
          this.elapsed[n] = 0;
        }
        continue;
      }
      this.elapsed[n] += dt;
      const want = this.preempt[n];
      if (want >= 0) {
        if (this.phase[n] !== want) this.switchPhase(n, 1.5);
        if (!this.units.some((u) => !u.done && this.edges[u.car.edge].to === n)) this.preempt[n] = -1;
        continue;
      }
      const el = this.elapsed[n];
      if (!this.adaptive) {
        if (el >= 20) this.switchPhase(n);
        continue;
      }
      const qNS = this.inn[n].filter((e) => this.edges[e].axis === "ns").reduce((a, e) => a + this.pressure(e), 0);
      const qEW = this.inn[n].filter((e) => this.edges[e].axis === "ew").reduce((a, e) => a + this.pressure(e), 0);
      const [green, red] = this.phase[n] === 0 ? [qNS, qEW] : [qEW, qNS];
      if (el >= 32 || (el >= 8 && (red > green * 1.5 + 1 || (green === 0 && red > 0)))) this.switchPhase(n);
    }
  }

  /** Demand on an approach, counting the queue behind it when the approach is a short link. */
  private pressure(eid: number, depth = 0): number {
    let p = this.queues[eid].length + this.stopped[eid];
    if (depth < 2 && this.storage(eid) < 12) {
      const e = this.edges[eid];
      for (const up of this.inn[e.from]) if (this.edges[up].from !== e.to) p += 0.6 * this.pressure(up, depth + 1);
    }
    return p;
  }

  private switchPhase(n: number, amber = 3) {
    this.amber[n] = amber;
    this.switches++;
  }

  /* -------------------------------------------------------------- render */

  private buildMeshes() {
    const N = 340;
    for (const spec of VEHICLES) {
      const g = buildVehicle(spec.type);
      const body = new THREE.InstancedMesh(g.body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.3 }), N);
      body.castShadow = true;
      body.frustumCulled = false;
      body.count = 0;
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      this.lampMats.push(mat);
      const lamp = new THREE.InstancedMesh(g.lights, mat, N);
      lamp.frustumCulled = false;
      lamp.count = 0;
      this.bodies.set(spec.type, body);
      this.lamps.set(spec.type, lamp);
      this.group.add(body, lamp);
    }

    // Edge-AI view: scan corridors, hazard rings and yield markers.
    const scanGeo = new THREE.PlaneGeometry(1, 1);
    scanGeo.rotateX(-Math.PI / 2);
    scanGeo.translate(0, 0, 0.5);
    const shade = new Float32Array(scanGeo.getAttribute("position").count * 3);
    const pz = scanGeo.getAttribute("position");
    for (let i = 0; i < pz.count; i++) {
      const k = 1 - pz.getZ(i); // fade out with distance
      shade.set([k, k, k], i * 3);
    }
    scanGeo.setAttribute("color", new THREE.BufferAttribute(shade, 3));
    this.scans = new THREE.InstancedMesh(scanGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }), N + 16);
    this.scans.frustumCulled = false;
    this.scans.renderOrder = 3;
    const ringGeo = new THREE.RingGeometry(0.85, 1, 4, 1);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.rotateY(Math.PI / 4);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 0.3), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), N);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 3;
    this.marks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshBasicMaterial({ toneMapped: false }), N);
    this.marks.frustumCulled = false;
    this.group.add(this.scans, this.rings, this.marks);
    this.setAIVisible(false);

    // Signal heads: one lamp per incoming carriageway; give-way signs elsewhere.
    let lamps = 0;
    for (let n = 0; n < this.nodes.length; n++) if (this.signalised[n]) lamps += this.inn[n].length;
    this.lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, lamps));
    this.lights.frustumCulled = false;
    this.group.add(this.lights);
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 5.4, 6);
    poleGeo.translate(0, 2.7, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.6, metalness: 0.4 });
    const headGeo = new THREE.BoxGeometry(0.62, 1.7, 0.5);
    const signGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.06, 3);
    signGeo.rotateX(Math.PI / 2);
    signGeo.rotateZ(Math.PI);
    const signMat = new THREE.MeshStandardMaterial({ color: "#f4f2ec", emissive: "#c02020", emissiveIntensity: 0.25 });
    for (let n = 0; n < this.nodes.length; n++) {
      if (this.deadEnd[n] || this.inn[n].length < 3) continue;
      for (const eid of this.inn[n]) {
        const p = this.stopLine(eid);
        const e = this.edges[eid];
        const y = this.heightAt(eid, e.s1);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(p.x, y, p.y);
        this.group.add(pole);
        if (this.signalised[n]) {
          const head = new THREE.Mesh(headGeo, poleMat);
          head.position.set(p.x, y + 5.2, p.y);
          head.rotation.y = Math.atan2(e.dir.x, e.dir.y);
          this.group.add(head);
        } else {
          const sign = new THREE.Mesh(signGeo, signMat);
          sign.position.set(p.x, y + 3.2, p.y);
          sign.rotation.y = Math.atan2(e.dir.x, e.dir.y) + Math.PI;
          this.group.add(sign);
        }
      }
    }

    // Congestion ribbons along each carriageway.
    for (const e of this.edges) {
      const a = this.nodes[e.from];
      const left = new THREE.Vector2(e.dir.y, -e.dir.x);
      const pts: number[] = [];
      const segs = Math.max(1, e.heights.length - 1);
      for (let k = 0; k <= segs; k++) {
        const s = e.s0 + ((e.s1 - e.s0) * k) / segs;
        const cx = a.x + e.dir.x * s + left.x * LANE;
        const cz = a.y + e.dir.y * s + left.y * LANE;
        const y = this.heightAt(e.id, s) + 0.1;
        pts.push(cx - left.x * 1.2, y, cz - left.y * 1.2, cx + left.x * 1.2, y, cz + left.y * 1.2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const idx: number[] = [];
      for (let k = 0; k < segs; k++) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#3bbf6b", transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      mesh.renderOrder = 2;
      this.ribbons.push(mesh);
      this.group.add(mesh);
    }
  }

  private stopLine(eid: number) {
    const e = this.edges[eid];
    const a = this.nodes[e.from];
    const s = e.s1;
    return new THREE.Vector2(a.x + e.dir.x * s + e.dir.y * (LANE + 2.7), a.y + e.dir.y * s - e.dir.x * (LANE + 2.7));
  }

  setHeatVisible(on: boolean) {
    this.showHeat = on;
    for (const r of this.ribbons) r.visible = on;
  }

  private render(dt: number) {
    this.flash += dt;
    const night = this.engine.night;
    for (const m of this.lampMats) m.color.setScalar(0.35 + night * 2.6);
    const tmp = this.tmp;
    const counts = new Map<VehicleType, number>();
    const brake = new THREE.Color(2.2, 1, 1);
    const plain = new THREE.Color(1, 1, 1);
    let sIdx = 0;
    let rIdx = 0;
    let mIdx = 0;
    const hazards = new Set<number>();
    for (const c of this.cars) {
      if (c.unit) continue;
      const t = c.spec.type;
      const i = counts.get(t) ?? 0;
      const body = this.bodies.get(t)!;
      if (i >= body.instanceMatrix.count) continue;
      counts.set(t, i + 1);
      tmp.position.set(c.x, c.y, c.z);
      tmp.rotation.set(-c.pitch, c.yaw, 0, "YXZ");
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      body.setMatrixAt(i, tmp.matrix);
      body.setColorAt(i, c.color);
      const lamp = this.lamps.get(t)!;
      lamp.setMatrixAt(i, tmp.matrix);
      lamp.setColorAt(i, c.acc < -1.2 || c.v < 0.3 ? brake : plain);
      if (this.showAI) {
        if (c.hazard >= 0) hazards.add(c.hazard);
        const len = Math.max(2, Math.min(SENSOR_RANGE, isFinite(c.hazardGap) ? c.hazardGap : 5 + c.v * 1.6 + (c.v * c.v) / (2 * B_COMF)));
        tmp.position.set(c.x + Math.sin(c.yaw) * c.len * 0.5, c.y + 0.18, c.z + Math.cos(c.yaw) * c.len * 0.5);
        tmp.rotation.set(0, c.yaw, 0);
        tmp.scale.set(c.hw * 2, 1, len);
        tmp.updateMatrix();
        this.scans.setMatrixAt(sIdx, tmp.matrix);
        this.scans.setColorAt(sIdx, STATE_COLOR[c.state]);
        sIdx++;
        if (c.state === "yield" || c.state === "brake") {
          tmp.position.set(c.x, c.y + (c.spec.type === "bus" ? 4.2 : 2.9) + Math.sin(this.flash * 5 + c.id) * 0.15, c.z);
          tmp.rotation.set(0, this.flash * 2, 0);
          tmp.scale.setScalar(1);
          tmp.updateMatrix();
          this.marks.setMatrixAt(mIdx, tmp.matrix);
          this.marks.setColorAt(mIdx, STATE_COLOR[c.state]);
          mIdx++;
        }
      }
    }
    for (const [t, body] of this.bodies) {
      const n = counts.get(t) ?? 0;
      body.count = n;
      body.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      const lamp = this.lamps.get(t)!;
      lamp.count = n;
      lamp.instanceMatrix.needsUpdate = true;
      if (lamp.instanceColor) lamp.instanceColor.needsUpdate = true;
    }
    if (this.showAI) {
      for (const id of hazards) {
        const c = this.byId(id);
        if (!c || rIdx >= this.rings.instanceMatrix.count) continue;
        tmp.position.set(c.x, c.y + 0.2, c.z);
        tmp.rotation.set(0, c.yaw, 0);
        tmp.scale.set(c.hw * 1.9, 1, c.len * 0.75);
        tmp.updateMatrix();
        this.rings.setMatrixAt(rIdx++, tmp.matrix);
      }
      this.scans.count = sIdx;
      this.rings.count = rIdx;
      this.marks.count = mIdx;
      this.scans.instanceMatrix.needsUpdate = true;
      this.rings.instanceMatrix.needsUpdate = true;
      this.marks.instanceMatrix.needsUpdate = true;
      if (this.scans.instanceColor) this.scans.instanceColor.needsUpdate = true;
      if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true;
    }

    // Emergency units with flashing beacons.
    const on = Math.floor(this.flash * 6) % 2 === 0;
    for (const u of this.units) {
      const parked = u.object.userData.parked as { x: number; y: number; z: number; yaw: number } | undefined;
      const parkedUntil = (u.object.userData.parkedUntil as number) ?? 0;
      u.object.visible = !u.done || (parked !== undefined && this.t < parkedUntil);
      if (!u.object.visible) continue;
      const c = u.car;
      if (u.done && parked) {
        u.object.position.set(parked.x, parked.y, parked.z);
        u.object.rotation.set(0, parked.yaw, 0);
      } else {
        u.object.position.set(c.x, c.y, c.z);
        u.object.rotation.set(-c.pitch, c.yaw, 0, "YXZ");
      }
      const a = u.object.getObjectByName("beacon-a");
      const b = u.object.getObjectByName("beacon-b");
      const l = u.object.getObjectByName("beacon-light") as THREE.PointLight | undefined;
      if (a) a.visible = on;
      if (b) b.visible = !on;
      if (l) {
        l.color.set(on ? "#ff3030" : "#3070ff");
        l.intensity = 30 + night * 60;
        l.visible = night > 0.15;
      }
      const lm = (u.object.getObjectByName("lamps") as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
      lm?.color.setScalar(0.35 + night * 2.6);
    }

    // Signal lamps.
    let l = 0;
    const col = new THREE.Color();
    for (let n = 0; n < this.nodes.length; n++) {
      if (!this.signalised[n]) continue;
      for (const eid of this.inn[n]) {
        const p = this.stopLine(eid);
        const e = this.edges[eid];
        const amber = this.amber[n] > 0;
        const green = this.isGreen(eid);
        const yOff = amber ? 5.2 : green ? 4.7 : 5.7;
        tmp.position.set(p.x - e.dir.x * 0.3, this.heightAt(eid, e.s1) + yOff, p.y - e.dir.y * 0.3);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.setScalar(1);
        tmp.updateMatrix();
        this.lights.setMatrixAt(l, tmp.matrix);
        col.set(amber ? "#ffb21e" : green ? "#22e36b" : "#ff3b30").multiplyScalar(2.2);
        this.lights.setColorAt(l, col);
        l++;
      }
    }
    this.lights.instanceMatrix.needsUpdate = true;
    if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;

    if (this.showHeat) {
      for (const e of this.edges) {
        const c = this.congestion[e.id];
        const m = this.ribbons[e.id].material as THREE.MeshBasicMaterial;
        m.color.set(this.blocked.has(e.id) ? "#7a1010" : c < 0.3 ? "#3bbf6b" : c < 0.5 ? "#f2c230" : c < 0.7 ? "#f08a2a" : "#e5372d");
        m.opacity = this.blocked.has(e.id) ? 0.85 : 0.3 + Math.min(0.45, c);
      }
    }
  }

  /* --------------------------------------------------------------- stats */

  stats() {
    const civ = this.cars.filter((c) => !c.unit);
    const speed = civ.length ? civ.reduce((a, c) => a + c.v, 0) / civ.length : 0;
    const stopped = civ.filter((c) => c.v < 0.5).length;
    let cong = 0;
    for (let i = 0; i < this.congestion.length; i++) cong += this.congestion[i];
    const worst = [...this.edges].sort((a, b) => this.congestion[b.id] - this.congestion[a.id]).slice(0, 4);
    const states: Record<Percept, number> = { free: 0, follow: 0, yield: 0, brake: 0, stop: 0 };
    for (const c of civ) states[c.state]++;
    this.ai.states = states;
    return {
      vehicles: civ.length,
      speedKmh: speed * 3.6,
      stoppedPct: civ.length ? stopped / civ.length : 0,
      congestion: cong / this.congestion.length,
      worst: worst.map((e) => ({ id: e.id, name: e.name, value: this.congestion[e.id] })),
      signals: this.signalised.filter(Boolean).length,
      giveWay: this.inn.filter((l, n) => l.length >= 3 && !this.signalised[n]).length,
      ai: this.ai,
    };
  }
}

/* ------------------------------------------------------------- helpers */

const CELL = 10;
function cellKey(x: number, z: number) {
  return Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
}

/** Design vehicle for junction geometry: 5 m long, 2 m wide. */
const DESIGN_HL = 1.5;
const DESIGN_HW = 1.0;

function turnSegs(t: Turn) {
  const p = t.pts;
  const n = p.length / 3;
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let hx = p[b * 3] - p[a * 3];
    let hz = p[b * 3 + 2] - p[a * 3 + 2];
    const l = Math.hypot(hx, hz) || 1;
    hx /= l;
    hz /= l;
    const x = p[i * 3];
    const z = p[i * 3 + 2];
    out.push([x - hx * DESIGN_HL, z - hz * DESIGN_HL, x + hx * DESIGN_HL, z + hz * DESIGN_HL]);
  }
  return out;
}

/** Clearance between design-car footprints swept along two turns (negative = they would touch). */
function sweepSweep(a: Turn, b: Turn) {
  const A = turnSegs(a);
  const B = turnSegs(b);
  let m = Infinity;
  for (const s of A) for (const t of B) m = Math.min(m, segSeg(s[0], s[1], s[2], s[3], t[0], t[1], t[2], t[3]));
  return m - 2 * DESIGN_HW;
}

/** Clearance between a car waiting at a stop line (front/back centre points) and a swept turn. */
function sweepClear(t: Turn, front: THREE.Vector3, back: THREE.Vector3) {
  let m = Infinity;
  for (const s of turnSegs(t)) m = Math.min(m, segSeg(s[0], s[1], s[2], s[3], front.x, front.z, back.x, back.z));
  return m - 2 * DESIGN_HW;
}

/** Distance from a point to a car's centre line (a capsule of radius hw). */
function pointCapsule(px: number, pz: number, o: Car3) {
  const hl = Math.max(0, o.len / 2 - o.hw);
  const hx = Math.sin(o.yaw);
  const hz = Math.cos(o.yaw);
  const rx = px - o.x;
  const rz = pz - o.z;
  const t = Math.max(-hl, Math.min(hl, rx * hx + rz * hz));
  return Math.hypot(rx - hx * t, rz - hz * t);
}

/** Distance between the centre lines of two cars. */
function capsuleCapsule(a: Car3, b: Car3) {
  const ha = Math.max(0, a.len / 2 - a.hw);
  const hb = Math.max(0, b.len / 2 - b.hw);
  const ax0 = a.x - Math.sin(a.yaw) * ha, az0 = a.z - Math.cos(a.yaw) * ha;
  const ax1 = a.x + Math.sin(a.yaw) * ha, az1 = a.z + Math.cos(a.yaw) * ha;
  const bx0 = b.x - Math.sin(b.yaw) * hb, bz0 = b.z - Math.cos(b.yaw) * hb;
  const bx1 = b.x + Math.sin(b.yaw) * hb, bz1 = b.z + Math.cos(b.yaw) * hb;
  return segSeg(ax0, az0, ax1, az1, bx0, bz0, bx1, bz1);
}

function segSeg(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const ps = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number) => {
    const vx = x1 - x0;
    const vz = z1 - z0;
    const l = vx * vx + vz * vz;
    const t = l > 0 ? Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / l)) : 0;
    return Math.hypot(px - x0 - vx * t, pz - z0 - vz * t);
  };
  const cross = (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number) => (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(ps(ax, az, cx, cz, dx, dz), ps(bx, bz, cx, cz, dx, dz), ps(cx, cz, ax, az, bx, bz), ps(dx, dz, ax, az, bx, bz));
}
