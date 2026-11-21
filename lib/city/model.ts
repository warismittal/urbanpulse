/**
 * The city: a planned sector grid (8 x 6 sectors) bounded by a road network.
 * Everything here is deterministic so every module draws the same city.
 *
 * Units: 1 map unit = 5 metres. One sector block is 120 units (600 m).
 */
import { seeded } from "@/lib/utils";

export const COLS = 8;
export const ROWS = 6;
export const BLOCK = 120;
export const MARGIN = 40;
export const MAP_W = MARGIN * 2 + COLS * BLOCK; // 1040
export const MAP_H = MARGIN * 2 + ROWS * BLOCK; // 800
export const METRES_PER_UNIT = 5;

export type LandUse =
  | "residential"
  | "mixed"
  | "commercial"
  | "industrial"
  | "institutional"
  | "green"
  | "water"
  | "transit";

export interface Sector {
  id: number; // 0..47
  number: number; // display number
  name: string;
  col: number;
  row: number;
  x: number; // top-left
  y: number;
  cx: number;
  cy: number;
  use: LandUse;
  population: number;
  elevation: number; // metres above sea level
  vulnerability: number; // 0..1 structural vulnerability (age, density, construction)
  greenCover: number; // % canopy
  builtDensity: number; // 0..1
}

export interface Node {
  id: number;
  i: number;
  j: number;
  x: number;
  y: number;
}

export interface Edge {
  id: number;
  from: number;
  to: number;
  dir: "h" | "v";
  length: number;
  arterial: boolean;
  lanes: number;
  name: string;
}

export type PoiKind = "hospital" | "police" | "fire" | "shelter";

export interface Poi {
  id: string;
  kind: PoiKind;
  name: string;
  sector: number;
  x: number;
  y: number;
  node: number;
  phone: string;
  capacity?: number;
}

/* ------------------------------------------------------------------ sectors */

const SPECIAL: Record<string, { use: LandUse; name?: string }> = {
  "3,2": { use: "commercial", name: "City Centre" },
  "4,2": { use: "commercial", name: "Market Square" },
  "6,4": { use: "industrial", name: "Industrial Area Ph I" },
  "7,4": { use: "industrial", name: "Industrial Area Ph II" },
  "6,5": { use: "industrial", name: "Industrial Area Ph III" },
  "7,5": { use: "industrial", name: "Chemical Estate" },
  "5,1": { use: "green", name: "Leisure Valley" },
  "2,4": { use: "green", name: "City Forest" },
  "7,0": { use: "water", name: "City Lake" },
  "1,1": { use: "institutional", name: "University Campus" },
  "5,3": { use: "institutional", name: "Medical College" },
  "0,3": { use: "transit", name: "Railway Station" },
  "4,4": { use: "mixed" },
  "2,2": { use: "mixed" },
  "5,4": { use: "mixed" },
  "1,3": { use: "mixed" },
};

function buildSectors(): Sector[] {
  const rand = seeded(17);
  const out: Sector[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const id = row * COLS + col;
      const special = SPECIAL[`${col},${row}`];
      const use: LandUse = special?.use ?? "residential";
      const number = id + 1;
      const r = rand();
      const population =
        use === "residential"
          ? Math.round(16000 + r * 16000)
          : use === "mixed"
            ? Math.round(11000 + r * 8000)
            : use === "commercial"
              ? Math.round(5000 + r * 3000)
              : use === "institutional"
                ? Math.round(7000 + r * 3000)
                : use === "industrial"
                  ? Math.round(2000 + r * 2000)
                  : use === "transit"
                    ? 4000
                    : use === "green"
                      ? 400
                      : 0;
      // Land falls towards the south-west, where the seasonal nallah runs.
      const elevation = 248 + col * 0.32 + (ROWS - 1 - row) * 0.42 + (rand() - 0.5) * 0.7;
      const greenCover =
        use === "green"
          ? 72 + rand() * 12
          : use === "water"
            ? 30
            : use === "residential"
              ? 16 + rand() * 20
              : use === "institutional"
                ? 30 + rand() * 12
                : use === "mixed"
                  ? 12 + rand() * 8
                  : use === "transit"
                    ? 9
                    : 5 + rand() * 6;
      const builtDensity =
        use === "green" || use === "water"
          ? 0.05
          : use === "commercial"
            ? 0.85 + rand() * 0.1
            : use === "industrial"
              ? 0.7 + rand() * 0.15
              : 0.45 + rand() * 0.35;
      const vulnerability = Math.min(
        0.95,
        (use === "residential" || use === "mixed" ? 0.35 : 0.25) + builtDensity * 0.35 + rand() * 0.25
      );
      const x = MARGIN + col * BLOCK;
      const y = MARGIN + row * BLOCK;
      out.push({
        id,
        number,
        name: special?.name ? `${special.name}` : `Sector ${number}`,
        col,
        row,
        x,
        y,
        cx: x + BLOCK / 2,
        cy: y + BLOCK / 2,
        use,
        population: use === "water" ? 0 : population,
        elevation: Math.round(elevation * 10) / 10,
        vulnerability: Math.round(vulnerability * 100) / 100,
        greenCover: Math.round(greenCover),
        builtDensity: Math.round(builtDensity * 100) / 100,
      });
    }
  }
  return out;
}

export const SECTORS: Sector[] = buildSectors();

export function sectorLabel(s: Sector) {
  return s.name.startsWith("Sector") ? s.name : `${s.name} (Sec ${s.number})`;
}

export function sectorAt(x: number, y: number): Sector | null {
  const col = Math.floor((x - MARGIN) / BLOCK);
  const row = Math.floor((y - MARGIN) / BLOCK);
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return null;
  return SECTORS[row * COLS + col];
}

export function sectorNeighbours(s: Sector): Sector[] {
  const out: Sector[] = [];
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const c = s.col + dc;
    const r = s.row + dr;
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) out.push(SECTORS[r * COLS + c]);
  }
  return out;
}

/* -------------------------------------------------------------------- roads */

const V_NAMES: Record<number, string> = {
  0: "Western Bypass",
  2: "University Road",
  4: "Mall Road",
  6: "Hospital Road",
  8: "Eastern Bypass",
};
const H_NAMES: Record<number, string> = {
  0: "Northern Ring",
  2: "Lake Road",
  3: "GT Road",
  4: "Station Road",
  6: "Canal Road",
};
const ARTERIAL_V = new Set([0, 4, 8]);
const ARTERIAL_H = new Set([0, 3, 6]);

function buildNetwork() {
  const nodes: Node[] = [];
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      nodes.push({ id: j * (COLS + 1) + i, i, j, x: MARGIN + i * BLOCK, y: MARGIN + j * BLOCK });
    }
  }
  const edges: Edge[] = [];
  const nodeId = (i: number, j: number) => j * (COLS + 1) + i;
  const add = (a: number, b: number, dir: "h" | "v", line: number) => {
    const arterial = dir === "h" ? ARTERIAL_H.has(line) : ARTERIAL_V.has(line);
    const name = (dir === "h" ? H_NAMES[line] : V_NAMES[line]) ?? `${dir === "h" ? "Sector Road" : "Link Road"} ${line + 1}`;
    edges.push({ id: edges.length, from: a, to: b, dir, length: BLOCK, arterial, lanes: arterial ? 2 : 1, name });
  };
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      add(nodeId(i, j), nodeId(i + 1, j), "h", j);
      add(nodeId(i + 1, j), nodeId(i, j), "h", j);
    }
  }
  for (let i = 0; i <= COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      add(nodeId(i, j), nodeId(i, j + 1), "v", i);
      add(nodeId(i, j + 1), nodeId(i, j), "v", i);
    }
  }
  const outEdges: number[][] = nodes.map(() => []);
  const inEdges: number[][] = nodes.map(() => []);
  for (const e of edges) {
    outEdges[e.from].push(e.id);
    inEdges[e.to].push(e.id);
  }
  return { nodes, edges, outEdges, inEdges };
}

export const NETWORK = buildNetwork();
export const NODES = NETWORK.nodes;
export const EDGES = NETWORK.edges;

export function nearestNode(x: number, y: number): number {
  const i = Math.max(0, Math.min(COLS, Math.round((x - MARGIN) / BLOCK)));
  const j = Math.max(0, Math.min(ROWS, Math.round((y - MARGIN) / BLOCK)));
  return j * (COLS + 1) + i;
}

export function edgeBetween(a: number, b: number): Edge | undefined {
  return NETWORK.outEdges[a].map((id) => EDGES[id]).find((e) => e.to === b);
}

/** Opposite-direction twin of an edge (same physical road). */
export function twinEdge(e: Edge): Edge | undefined {
  return edgeBetween(e.to, e.from);
}

/** Dijkstra over the directed network. Returns edge ids from a to b, or null. */
export function shortestPath(
  from: number,
  to: number,
  weight: (e: Edge) => number = (e) => e.length
): number[] | null {
  const n = NODES.length;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) (best = dist[i]), (u = i);
    if (u === -1 || u === to) break;
    done[u] = 1;
    for (const eid of NETWORK.outEdges[u]) {
      const e = EDGES[eid];
      const w = weight(e);
      if (!Number.isFinite(w)) continue;
      const nd = dist[u] + w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        via[e.to] = eid;
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const path: number[] = [];
  let cur = to;
  while (cur !== from) {
    const eid = via[cur];
    if (eid < 0) return null;
    path.push(eid);
    cur = EDGES[eid].from;
  }
  return path.reverse();
}

/** Road distance in metres between two nodes along the shortest path. */
export function roadDistance(a: number, b: number) {
  const p = shortestPath(a, b);
  return p ? p.reduce((sum, id) => sum + EDGES[id].length, 0) * METRES_PER_UNIT : Infinity;
}

/* --------------------------------------------------------------------- POIs */

function poi(kind: PoiKind, name: string, col: number, row: number, dx: number, dy: number, phone: string, capacity?: number): Poi {
  const s = SECTORS[row * COLS + col];
  const x = s.cx + dx;
  const y = s.cy + dy;
  return { id: `${kind}-${col}-${row}`, kind, name, sector: s.id, x, y, node: nearestNode(x, y), phone, capacity };
}

export const POIS: Poi[] = [
  poi("hospital", "Govt. Medical College & Hospital", 5, 3, 18, -20, "0172-2665253", 620),
  poi("hospital", "Civil Hospital", 1, 2, -20, 15, "0172-2780312", 280),
  poi("hospital", "City Multispeciality Hospital", 6, 1, 22, 18, "0172-5021000", 340),
  poi("hospital", "ESI Hospital", 2, 5, -15, -22, "0172-2603190", 160),
  poi("police", "City Centre Police Station", 3, 2, -30, 28, "112"),
  poi("police", "Station Police Post", 0, 3, 24, -26, "112"),
  poi("police", "Industrial Area Police Station", 6, 4, -26, -28, "112"),
  poi("police", "North Police Station", 2, 0, 26, 24, "112"),
  poi("police", "South Police Station", 5, 5, -24, 22, "112"),
  poi("fire", "Central Fire Station", 4, 3, -24, -24, "101"),
  poi("fire", "Industrial Fire Station", 7, 4, -26, 26, "101"),
  poi("fire", "West Fire Station", 1, 4, 26, -20, "101"),
  poi("shelter", "Govt. Senior Secondary School", 2, 1, 0, -10, "1078", 2500),
  poi("shelter", "Sports Stadium", 4, 0, 0, 0, "1078", 9000),
  poi("shelter", "Community Centre", 5, 2, -10, 10, "1078", 1800),
  poi("shelter", "Town Hall", 3, 4, 10, -10, "1078", 2200),
  poi("shelter", "Exhibition Grounds", 6, 2, 10, -12, "1078", 6000),
  poi("shelter", "College Ground", 0, 0, 10, 10, "1078", 4000),
];

export const POI_LABEL: Record<PoiKind, string> = {
  hospital: "Hospital",
  police: "Police",
  fire: "Fire station",
  shelter: "Relief shelter",
};

/** Fixed pollution and hazard sources. */
export const SOURCES = [
  { id: "stack-1", kind: "industrial" as const, name: "Steel rolling mill stack", x: SECTORS[38].cx + 20, y: SECTORS[38].cy - 10, strength: 1 },
  { id: "stack-2", kind: "industrial" as const, name: "Chemical plant (chlorine store)", x: SECTORS[47].cx - 10, y: SECTORS[47].cy + 10, strength: 0.8 },
  { id: "stack-3", kind: "industrial" as const, name: "Brick kiln cluster", x: SECTORS[39].cx + 25, y: SECTORS[39].cy + 20, strength: 0.7 },
  { id: "build-1", kind: "construction" as const, name: "Metro depot construction", x: SECTORS[18].cx, y: SECTORS[18].cy, strength: 0.5 },
  { id: "build-2", kind: "construction" as const, name: "Flyover construction", x: SECTORS[37].cx - 20, y: SECTORS[37].cy, strength: 0.45 },
  { id: "build-3", kind: "construction" as const, name: "Housing project", x: SECTORS[25].cx, y: SECTORS[25].cy + 15, strength: 0.35 },
];

/* --------------------------------------------------------- public transport */

export interface BusRoute {
  id: string;
  name: string;
  nodes: number[]; // ordered node ids, stops at each
  headwayMin: number;
  color: "series-1" | "series-2" | "series-3";
}

const N = (i: number, j: number) => j * (COLS + 1) + i;
export const BUS_ROUTES: BusRoute[] = [
  { id: "1A", name: "Railway Station ⇄ Industrial Area", nodes: [N(0, 3), N(1, 3), N(2, 3), N(3, 3), N(4, 3), N(5, 3), N(6, 3), N(7, 3), N(7, 4), N(7, 5)], headwayMin: 8, color: "series-1" },
  { id: "2", name: "University ⇄ Medical College", nodes: [N(1, 1), N(2, 1), N(2, 2), N(3, 2), N(4, 2), N(4, 3), N(5, 3), N(6, 3)], headwayMin: 12, color: "series-2" },
  { id: "5", name: "Northern Ring ⇄ Canal Road", nodes: [N(4, 0), N(4, 1), N(4, 2), N(4, 3), N(4, 4), N(4, 5), N(4, 6)], headwayMin: 10, color: "series-3" },
];

/** Intersections with traffic cameras (computer-vision counting). */
export const CAMERA_NODES: { node: number; name: string }[] = [
  { node: N(4, 3), name: "Mall Rd × GT Rd" },
  { node: N(0, 3), name: "Station Chowk" },
  { node: N(4, 0), name: "Stadium Chowk" },
  { node: N(8, 3), name: "Eastern Bypass × GT Rd" },
  { node: N(4, 6), name: "Mall Rd × Canal Rd" },
  { node: N(3, 2), name: "City Centre Chowk" },
  { node: N(6, 4), name: "Industrial Gate" },
  { node: N(2, 3), name: "University Rd × GT Rd" },
];
