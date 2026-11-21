import { CAMERA_NODES, EDGES, NODES } from "./model";

/** "Mall Road × GT Road", or the camera's name if one is installed there. */
export function junctionName(node: number) {
  const n = NODES[node];
  const cam = CAMERA_NODES.find((c) => c.node === node);
  if (cam) return cam.name;
  const v = EDGES.find((e) => e.dir === "v" && (e.from === node || e.to === node));
  const h = EDGES.find((e) => e.dir === "h" && (e.from === node || e.to === node));
  return `${v?.name ?? `Line ${n.i}`} × ${h?.name ?? `Line ${n.j}`}`;
}

/** "GT Road EB" */
export function edgeLabel(eid: number) {
  const e = EDGES[eid];
  const a = NODES[e.from];
  const b = NODES[e.to];
  const dir = e.dir === "h" ? (b.x > a.x ? "EB" : "WB") : b.y > a.y ? "SB" : "NB";
  return `${e.name} ${dir}`;
}
