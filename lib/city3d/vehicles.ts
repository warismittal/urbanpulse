/**
 * Procedural low-poly vehicles: sports car, sedan, SUV, hatchback, EV, city
 * bus, plus emergency units (ambulance, fire engine, police car).
 *
 * Each type is one merged geometry with vertex colours: white body parts
 * (tinted per instance with the paint colour), dark glass, black tyres and
 * chrome. Head and tail lights are a second geometry drawn with an emissive
 * material, so they glow at night through bloom.
 */
import * as THREE from "three";

export type VehicleType = "sports" | "sedan" | "suv" | "hatch" | "ev" | "bus";

export interface VehicleSpec {
  type: VehicleType;
  length: number;
  width: number;
  vmax: number; // m/s
  accel: number;
  share: number; // fleet share
  paints: string[];
}

export const VEHICLES: VehicleSpec[] = [
  { type: "hatch", length: 3.7, width: 1.7, vmax: 11.5, accel: 2.0, share: 0.3, paints: ["#c43a32", "#f2f0ea", "#2f5f9e", "#d9a441", "#7aa6c2", "#9a9ea3"] },
  { type: "sedan", length: 4.5, width: 1.8, vmax: 12.5, accel: 2.1, share: 0.27, paints: ["#e9e6df", "#3a3f44", "#9a9ea3", "#6b1f24", "#1f2e4a", "#c9c2b0"] },
  { type: "suv", length: 4.7, width: 1.95, vmax: 12, accel: 1.9, share: 0.2, paints: ["#3a3f44", "#f2f0ea", "#6b7f4a", "#1f2e4a", "#7d6a55"] },
  { type: "ev", length: 4.4, width: 1.85, vmax: 12.5, accel: 2.8, share: 0.12, paints: ["#f4f4f2", "#2d6fa3", "#bfc5c9", "#1e1f22", "#b8322b"] },
  { type: "sports", length: 4.3, width: 1.9, vmax: 14, accel: 3.2, share: 0.06, paints: ["#e8261c", "#f2c230", "#1f1f1f", "#2fa3a0", "#f6f6f6"] },
  { type: "bus", length: 10.5, width: 2.4, vmax: 10, accel: 1.2, share: 0.05, paints: ["#e0a22b", "#3a8f6a", "#c84a35"] },
];

const WHITE = new THREE.Color(1, 1, 1);
const GLASS = new THREE.Color(0.09, 0.12, 0.15);
const TYRE = new THREE.Color(0.06, 0.06, 0.07);
const RIM = new THREE.Color(0.75, 0.76, 0.78);
const TRIM = new THREE.Color(0.18, 0.18, 0.2);

type Part = THREE.BufferGeometry;

function colorize(g: Part, c: THREE.Color): Part {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute("uv");
  return geo;
}

/**
 * Box whose top face is shrunk front/back (windscreen rake) and sideways
 * (tumblehome). `rakeF`/`rakeR` are metres pulled in at the top.
 */
function cabin(w: number, h: number, l: number, rakeF: number, rakeR: number, tuck = 0.12): Part {
  const g = new THREE.BoxGeometry(w, h, l);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      const z = p.getZ(i);
      p.setZ(i, z > 0 ? z - rakeF : z + rakeR);
      p.setX(i, p.getX(i) * (1 - tuck));
    }
  }
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, l: number, x: number, y: number, z: number, c: THREE.Color, rakeF = 0, rakeR = 0): Part {
  const g = rakeF || rakeR ? cabin(w, h, l, rakeF, rakeR, 0.04) : new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, z);
  return colorize(g, c);
}

function wheels(width: number, r: number, zs: number[], tread = 0.26): Part[] {
  const out: Part[] = [];
  for (const z of zs) {
    for (const s of [-1, 1]) {
      const t = new THREE.CylinderGeometry(r, r, tread, 12);
      t.rotateZ(Math.PI / 2);
      t.translate((s * (width - tread)) / 2, r, z);
      out.push(colorize(t, TYRE));
      const h = new THREE.CylinderGeometry(r * 0.55, r * 0.55, tread + 0.02, 8);
      h.rotateZ(Math.PI / 2);
      h.translate((s * (width - tread)) / 2, r, z);
      out.push(colorize(h, RIM));
    }
  }
  return out;
}

/** Merge geometries that carry position, normal and color. */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const k = g.getAttribute("position").count * 3;
    pos.set(g.getAttribute("position").array as Float32Array, o);
    nor.set(g.getAttribute("normal").array as Float32Array, o);
    const c = g.getAttribute("color");
    if (c) col.set(c.array as Float32Array, o);
    else col.fill(1, o, o + k);
    o += k;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** Lamp quads: two headlights at +z, two tail lights at -z. */
function lamps(w: number, y: number, zf: number, zr: number, size = 0.3): Part[] {
  const head = new THREE.Color(1.0, 0.95, 0.82);
  const tail = new THREE.Color(1.0, 0.08, 0.05);
  const out: Part[] = [];
  for (const s of [-1, 1]) {
    out.push(box(size * 1.3, size * 0.7, 0.06, s * (w / 2 - 0.3), y, zf, head));
    out.push(box(size * 1.4, size * 0.55, 0.06, s * (w / 2 - 0.25), y, zr, tail));
  }
  return out;
}

export interface VehicleMeshes {
  body: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
}

/** Vehicle geometry with its origin on the ground at the centre, facing +z. */
export function buildVehicle(type: VehicleType | "ambulance" | "fire" | "police"): VehicleMeshes {
  const p: Part[] = [];
  let L: Part[] = [];
  switch (type) {
    case "hatch": {
      const l = 3.7, w = 1.7;
      p.push(box(w, 0.62, l, 0, 0.62, 0, WHITE));
      p.push(box(w - 0.1, 0.58, 2.2, 0, 1.22, -0.45, GLASS, 0.55, 0.12));
      p.push(box(w - 0.24, 0.06, 1.5, 0, 1.53, -0.55, WHITE));
      p.push(box(w + 0.02, 0.16, 0.25, 0, 0.42, l / 2 - 0.1, TRIM));
      p.push(...wheels(w, 0.31, [1.15, -1.2]));
      L = lamps(w, 0.75, l / 2 + 0.01, -l / 2 - 0.01);
      break;
    }
    case "sedan": {
      const l = 4.5, w = 1.8;
      p.push(box(w, 0.6, l, 0, 0.6, 0, WHITE));
      p.push(box(w - 0.12, 0.55, 2.3, 0, 1.17, -0.15, GLASS, 0.6, 0.5));
      p.push(box(w - 0.3, 0.05, 1.2, 0, 1.46, -0.2, WHITE));
      p.push(box(w + 0.02, 0.14, 0.2, 0, 0.42, l / 2 - 0.08, TRIM));
      p.push(...wheels(w, 0.32, [1.4, -1.4]));
      L = lamps(w, 0.72, l / 2 + 0.01, -l / 2 - 0.01);
      break;
    }
    case "suv": {
      const l = 4.7, w = 1.95;
      p.push(box(w, 0.85, l, 0, 0.8, 0, WHITE));
      p.push(box(w - 0.1, 0.7, 3.2, 0, 1.55, -0.3, GLASS, 0.45, 0.08));
      p.push(box(w - 0.22, 0.08, 2.6, 0, 1.94, -0.35, WHITE));
      p.push(box(w - 0.4, 0.06, 2.2, 0, 2.02, -0.35, TRIM)); // roof rails
      p.push(box(w + 0.04, 0.22, 0.25, 0, 0.5, l / 2 - 0.08, TRIM));
      p.push(...wheels(w, 0.4, [1.5, -1.5], 0.32));
      L = lamps(w, 1.0, l / 2 + 0.01, -l / 2 - 0.01, 0.34);
      break;
    }
    case "ev": {
      const l = 4.4, w = 1.85;
      p.push(box(w, 0.55, l, 0, 0.6, 0, WHITE));
      p.push(box(w - 0.08, 0.55, 3.0, 0, 1.15, -0.1, GLASS, 0.9, 0.75)); // glass canopy
      p.push(...wheels(w, 0.33, [1.38, -1.38]));
      // Full-width light bars.
      L = [box(w - 0.2, 0.06, 0.05, 0, 0.82, l / 2 + 0.01, new THREE.Color(0.85, 0.95, 1.0)), box(w - 0.1, 0.07, 0.05, 0, 0.82, -l / 2 - 0.01, new THREE.Color(1, 0.06, 0.05))];
      break;
    }
    case "sports": {
      const l = 4.3, w = 1.9;
      p.push(box(w, 0.45, l, 0, 0.48, 0, WHITE));
      p.push(box(w - 0.3, 0.4, 1.7, 0, 0.9, -0.3, GLASS, 0.6, 0.5));
      p.push(box(w + 0.02, 0.06, 0.35, 0, 0.88, -l / 2 + 0.18, TRIM)); // spoiler
      p.push(box(0.08, 0.2, 0.08, -0.6, 0.76, -l / 2 + 0.2, TRIM), box(0.08, 0.2, 0.08, 0.6, 0.76, -l / 2 + 0.2, TRIM));
      p.push(...wheels(w, 0.33, [1.35, -1.35], 0.3));
      L = lamps(w, 0.55, l / 2 + 0.01, -l / 2 - 0.01, 0.26);
      break;
    }
    case "bus": {
      const l = 10.5, w = 2.4;
      p.push(box(w, 2.3, l, 0, 1.55, 0, WHITE));
      p.push(box(w + 0.02, 0.7, l - 1.2, 0, 2.05, -0.3, GLASS)); // window band
      p.push(box(w - 0.2, 0.95, 0.04, 0, 2.0, l / 2 + 0.01, GLASS)); // windscreen
      p.push(box(w - 0.4, 0.18, 2.2, 0, 2.8, -1, TRIM)); // AC unit
      p.push(box(w + 0.02, 0.12, l, 0, 0.55, 0, TRIM));
      p.push(...wheels(w, 0.5, [3.3, -3.0], 0.36));
      L = lamps(w, 0.85, l / 2 + 0.01, -l / 2 - 0.01, 0.36);
      L.push(box(1.4, 0.22, 0.04, 0, 2.62, l / 2 + 0.02, new THREE.Color(1.0, 0.6, 0.1))); // destination board
      break;
    }
    case "ambulance": {
      const l = 5.6, w = 2.1;
      const red = new THREE.Color(0.85, 0.1, 0.1);
      p.push(box(w, 0.75, 1.6, 0, 0.75, l / 2 - 0.8, WHITE));
      p.push(box(w - 0.1, 0.6, 1.0, 0, 1.4, l / 2 - 1.1, GLASS, 0.4, 0));
      p.push(box(w + 0.04, 2.1, 3.9, 0, 1.4, -0.85, WHITE));
      p.push(box(w + 0.06, 0.25, 3.92, 0, 1.25, -0.85, red));
      p.push(...wheels(w, 0.38, [1.8, -1.9], 0.32));
      L = lamps(w, 0.85, l / 2 + 0.01, -l / 2 - 0.01);
      break;
    }
    case "fire": {
      const l = 7.6, w = 2.4;
      const chrome = new THREE.Color(0.8, 0.8, 0.82);
      p.push(box(w, 1.6, 2.1, 0, 1.4, l / 2 - 1.05, WHITE));
      p.push(box(w - 0.1, 0.7, 0.05, 0, 1.75, l / 2 + 0.01, GLASS));
      p.push(box(w, 1.7, 5.3, 0, 1.45, -1.1, WHITE));
      p.push(box(0.5, 0.25, 5.0, 0, 2.45, -1.2, chrome)); // ladder
      p.push(box(w + 0.04, 0.12, l, 0, 0.75, 0, chrome));
      p.push(...wheels(w, 0.5, [2.4, -1.8, -3.0], 0.4));
      L = lamps(w, 0.95, l / 2 + 0.01, -l / 2 - 0.01, 0.36);
      break;
    }
    case "police": {
      const l = 4.6, w = 1.85;
      p.push(box(w, 0.6, l, 0, 0.6, 0, WHITE));
      p.push(box(w + 0.02, 0.32, 2.2, 0, 0.62, -0.1, new THREE.Color(0.95, 0.95, 0.95)));
      p.push(box(w - 0.12, 0.55, 2.3, 0, 1.17, -0.15, GLASS, 0.6, 0.5));
      p.push(...wheels(w, 0.32, [1.45, -1.45]));
      L = lamps(w, 0.72, l / 2 + 0.01, -l / 2 - 0.01);
      break;
    }
  }
  return { body: mergeParts(p), lights: mergeParts(L) };
}

/** Pick a vehicle type according to fleet shares (deterministic per id). */
export function pickVehicle(seed: number): VehicleSpec {
  const r = (Math.sin(seed * 12.9898) * 43758.5453) % 1;
  let x = Math.abs(r);
  for (const v of VEHICLES) {
    if (x < v.share) return v;
    x -= v.share;
  }
  return VEHICLES[0];
}
