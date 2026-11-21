/**
 * Time of day: a 24-hour clock drives a blend between palettes (night, dawn,
 * day, golden hour, dusk), the sun's arc from east to west, and a night factor
 * that switches on street lamps, windows, headlights and stars.
 *
 * Sky keyframes follow Ideociety's SocietyScene approach.
 */
import { PALETTES, type Palette, type PaletteId } from "./config";

/** Night palette, derived from Dusk. */
export const NIGHT: Palette = {
  ...PALETTES[3],
  id: 3,
  name: "Night",
  sky: { zenith: "#040a1c", horizon: "#1b2546", sunGlow: "#7f8fc9", sunGlowSize: 0.2 },
  sun: { direction: [0.4, 0.6, 0.3], color: "#9fb3e0", intensity: 0.45 },
  hemi: { sky: "#2a3563", ground: "#10131f", intensity: 0.38 },
  fog: { color: "#131b31", near: 220, far: 1000 },
  otherMaterials: { saturation: 0.9, lightness: 0.72, tint: "#5a6aa0", tintAmount: 0.14 },
  water: { deep: "#08192b", shallow: "#173a55", shimmer: 1 },
  shore: { sand: "#5d5a63", wetSand: "#3a3843", lagoon: "#1c4664", foam: "#8090b0" },
  clouds: { color: "#34405f", shade: "#151b30" },
  grade: { exposure: 1.05, saturation: 0.08, contrast: 0.14, brightness: 0.0, shadowTint: [0.9, 0.95, 1.15], highlightTint: [1.1, 1.0, 0.9], splitStrength: 0.8, bloomIntensity: 0.95, bloomThreshold: 0.62, vignette: 0.5 },
};

/** Dawn: Dusk's colours with a softer, pinker sky. */
export const DAWN: Palette = {
  ...PALETTES[3],
  name: "Dawn",
  sky: { zenith: "#3a4f8a", horizon: "#f6a777", sunGlow: "#ffb070", sunGlowSize: 0.6 },
  hemi: { sky: "#b7a9d8", ground: "#4d5160", intensity: 0.75 },
  fog: { color: "#d9a58c", near: 260, far: 1000 },
};

interface Key {
  h: number;
  p: Palette;
  env: PaletteId;
}

const KEYS: Key[] = [
  { h: 0, p: NIGHT, env: 3 },
  { h: 4.9, p: NIGHT, env: 3 },
  { h: 6.0, p: DAWN, env: 3 },
  { h: 7.4, p: PALETTES[1], env: 1 },
  { h: 12, p: PALETTES[1], env: 1 },
  { h: 16.3, p: PALETTES[1], env: 1 },
  { h: 17.3, p: PALETTES[2], env: 2 },
  { h: 18.4, p: PALETTES[3], env: 3 },
  { h: 19.5, p: NIGHT, env: 3 },
  { h: 24, p: NIGHT, env: 3 },
];

function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a: string, b: string, t: number) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
const mixN = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];

/** Interpolate every colour and number of two palettes. */
export function blendPalettes(a: Palette, b: Palette, t: number): Palette {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const materials: Palette["materials"] = {};
  for (const k of new Set([...Object.keys(a.materials), ...Object.keys(b.materials)])) {
    const ma = a.materials[k] ?? b.materials[k];
    const mb = b.materials[k] ?? a.materials[k];
    materials[k] = {
      color: mixHex(ma.color, mb.color, t),
      roughness: ma.roughness !== undefined || mb.roughness !== undefined ? mixN(ma.roughness ?? 0.8, mb.roughness ?? 0.8, t) : undefined,
      metalness: ma.metalness !== undefined || mb.metalness !== undefined ? mixN(ma.metalness ?? 0, mb.metalness ?? 0, t) : undefined,
      emissive: ma.emissive || mb.emissive ? mixHex(ma.emissive ?? "#000000", mb.emissive ?? "#000000", t) : undefined,
      emissiveIntensity: mixN(ma.emissiveIntensity ?? (ma.emissive ? 1 : 0), mb.emissiveIntensity ?? (mb.emissive ? 1 : 0), t),
    };
  }
  return {
    id: t < 0.5 ? a.id : b.id,
    name: t < 0.5 ? a.name : b.name,
    sky: { zenith: mixHex(a.sky.zenith, b.sky.zenith, t), horizon: mixHex(a.sky.horizon, b.sky.horizon, t), sunGlow: mixHex(a.sky.sunGlow, b.sky.sunGlow, t), sunGlowSize: mixN(a.sky.sunGlowSize, b.sky.sunGlowSize, t) },
    sun: { direction: mix3(a.sun.direction, b.sun.direction, t), color: mixHex(a.sun.color, b.sun.color, t), intensity: mixN(a.sun.intensity, b.sun.intensity, t) },
    hemi: { sky: mixHex(a.hemi.sky, b.hemi.sky, t), ground: mixHex(a.hemi.ground, b.hemi.ground, t), intensity: mixN(a.hemi.intensity, b.hemi.intensity, t) },
    fog: { color: mixHex(a.fog.color, b.fog.color, t), near: mixN(a.fog.near, b.fog.near, t), far: mixN(a.fog.far, b.fog.far, t) },
    materials,
    otherMaterials: {
      saturation: mixN(a.otherMaterials.saturation, b.otherMaterials.saturation, t),
      lightness: mixN(a.otherMaterials.lightness, b.otherMaterials.lightness, t),
      tint: mixHex(a.otherMaterials.tint, b.otherMaterials.tint, t),
      tintAmount: mixN(a.otherMaterials.tintAmount, b.otherMaterials.tintAmount, t),
    },
    water: { deep: mixHex(a.water.deep, b.water.deep, t), shallow: mixHex(a.water.shallow, b.water.shallow, t), shimmer: mixN(a.water.shimmer, b.water.shimmer, t) },
    shore: { sand: mixHex(a.shore.sand, b.shore.sand, t), wetSand: mixHex(a.shore.wetSand, b.shore.wetSand, t), lagoon: mixHex(a.shore.lagoon, b.shore.lagoon, t), foam: mixHex(a.shore.foam, b.shore.foam, t) },
    clouds: { color: mixHex(a.clouds.color, b.clouds.color, t), shade: mixHex(a.clouds.shade, b.clouds.shade, t) },
    grade: {
      exposure: mixN(a.grade.exposure, b.grade.exposure, t),
      saturation: mixN(a.grade.saturation, b.grade.saturation, t),
      contrast: mixN(a.grade.contrast, b.grade.contrast, t),
      brightness: mixN(a.grade.brightness, b.grade.brightness, t),
      shadowTint: mix3(a.grade.shadowTint, b.grade.shadowTint, t),
      highlightTint: mix3(a.grade.highlightTint, b.grade.highlightTint, t),
      splitStrength: mixN(a.grade.splitStrength, b.grade.splitStrength, t),
      bloomIntensity: mixN(a.grade.bloomIntensity, b.grade.bloomIntensity, t),
      bloomThreshold: mixN(a.grade.bloomThreshold, b.grade.bloomThreshold, t),
      vignette: mixN(a.grade.vignette, b.grade.vignette, t),
    },
  };
}

/** Night factor 0 (day) .. 1 (full night). */
export function nightFactor(h: number) {
  const s = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  if (h < 12) return 1 - s(h, 5.4, 6.9);
  return s(h, 18.0, 19.4);
}

/** Direction towards the sun (or the moon at night). +x east, -z north. */
export function sunDirection(h: number): [number, number, number] {
  const day = h >= 5.8 && h <= 18.6;
  const a = day ? ((h - 6) / 12) * Math.PI : (((h + 6) % 24) / 12) * Math.PI; // moon follows the opposite arc
  const x = Math.cos(a);
  const y = Math.max(0.06, Math.sin(a)) * (day ? 0.95 : 0.8);
  const z = 0.35;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

export function paletteAt(h: number): { palette: Palette; env: PaletteId; night: number } {
  const hh = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= hh) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (hh - a.h) / Math.max(1e-6, b.h - a.h);
  const e = t * t * (3 - 2 * t);
  const p = blendPalettes(a.p, b.p, e);
  const night = nightFactor(hh);
  const sunDir = sunDirection(hh);
  // Light dims as the sun drops; moonlight at night.
  const sun = { ...p.sun, direction: sunDir, intensity: p.sun.intensity * (night > 0.5 ? 1 : Math.min(1, 0.35 + sunDir[1] * 1.4)) };
  return { palette: { ...p, sun }, env: e < 0.5 ? a.env : b.env, night };
}

export function formatHour(h: number) {
  const hh = ((h % 24) + 24) % 24;
  const H = Math.floor(hh);
  const M = Math.floor((hh - H) * 60);
  return `${String(H).padStart(2, "0")}:${String(M).padStart(2, "0")}`;
}
