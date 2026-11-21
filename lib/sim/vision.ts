/**
 * Simulated computer-vision layer for junction cameras.
 *
 * The detector "sees" vehicles from the simulation through a camera window,
 * with a realistic miss rate, box jitter and confidence scores, then derives
 * congestion the way a real deployment would: occupancy of the approach lanes
 * plus the share of tracked vehicles that are stationary.
 *
 * To use a real model, replace `detectAtNode` with detections from your
 * inference service (e.g. YOLO on RTSP frames) — everything downstream
 * consumes the same `Detection` shape.
 */
import { EDGES, NETWORK, NODES } from "@/lib/city/model";
import { INSET, edgePoint, type TrafficSim } from "./traffic";
import { clamp } from "@/lib/utils";

export const VEHICLE_CLASS = ["car", "bus", "truck", "ambulance"] as const;

export interface Detection {
  id: number;
  cls: (typeof VEHICLE_CLASS)[number];
  x: number; // map units
  y: number;
  angle: number;
  conf: number;
  stopped: boolean;
  approach: "N" | "S" | "E" | "W" | "out";
}

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function detectAtNode(sim: TrafficSim, node: number, radius: number, frame: number): Detection[] {
  const n = NODES[node];
  const out: Detection[] = [];
  const bucket = Math.floor(frame / 3);
  const edges = [...NETWORK.inEdges[node], ...NETWORK.outEdges[node]];
  for (const eid of edges) {
    const incoming = EDGES[eid].to === node;
    const e = EDGES[eid];
    for (const vid of sim.edgeQ[eid]) {
      const v = sim.vehicles[vid];
      const lane = e.lanes > 1 && v.id % 2 ? 5.2 : 3.2;
      const [x, y, angle] = edgePoint(eid, v.s, e.arterial ? lane : 2.4);
      if (Math.abs(x - n.x) > radius || Math.abs(y - n.y) > radius) continue;
      // ~5% misses, worse for vehicles partly out of frame.
      const edgeFactor = Math.max(Math.abs(x - n.x), Math.abs(y - n.y)) / radius;
      if (hash(v.id, bucket) < 0.04 + edgeFactor * 0.08) continue;
      const jx = (hash(v.id, frame) - 0.5) * 0.35;
      const jy = (hash(frame, v.id) - 0.5) * 0.35;
      const a = NODES[e.from];
      const dir = e.dir === "v" ? (n.y > a.y ? "N" : "S") : n.x > a.x ? "W" : "E";
      out.push({
        id: v.id,
        cls: VEHICLE_CLASS[v.kind],
        x: x + jx,
        y: y + jy,
        angle,
        conf: clamp(0.71 + hash(v.id, 7) * 0.27 - edgeFactor * 0.08, 0.5, 0.99),
        stopped: v.v < 0.3,
        approach: incoming ? (dir as Detection["approach"]) : "out",
      });
    }
  }
  return out;
}

/** Congestion estimate from detections only (what the camera would report). */
export function cvCongestion(dets: Detection[], node: number, radius: number) {
  const incoming = dets.filter((d) => d.approach !== "out");
  const lanesIn = NETWORK.inEdges[node].reduce((a, eid) => a + EDGES[eid].lanes, 0);
  const capacity = (lanesIn * (radius - INSET)) / 1.6;
  const occupancy = capacity > 0 ? incoming.length / capacity : 0;
  const stoppedShare = incoming.length ? incoming.filter((d) => d.stopped).length / incoming.length : 0;
  const queue: Record<"N" | "S" | "E" | "W", number> = { N: 0, S: 0, E: 0, W: 0 };
  for (const d of incoming) if (d.stopped && d.approach !== "out") queue[d.approach]++;
  return {
    index: clamp(0.5 * stoppedShare + 0.75 * occupancy, 0, 1),
    occupancy,
    stoppedShare,
    count: dets.length,
    queue,
  };
}

/** Ground truth for the same junction: mean congestion of its approaches. */
export function trueCongestion(sim: TrafficSim, node: number) {
  const ins = NETWORK.inEdges[node];
  return ins.reduce((a, eid) => a + sim.congestion[eid], 0) / Math.max(1, ins.length);
}
