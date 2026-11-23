/**
 * 3D city configuration, rebuilt from the deployed CapstoneConnect 3D site
 * (https://3duicapstoneconnect.vercel.app): model manifest, colour palettes,
 * island-field layout, and the road graph and building footprints extracted
 * from the city models.
 *
 * World units are metres. +x east, -z north, y up.
 */

/** Where models and the Draco decoder are served from. Set NEXT_PUBLIC_CITY_ASSETS="" after `npm run fetch-city` to serve them locally. */
const ENV_ASSETS = process.env.NEXT_PUBLIC_CITY_ASSETS;
export const ASSET_BASE: string = ENV_ASSETS !== undefined ? ENV_ASSETS : "https://3duicapstoneconnect.vercel.app";

export const MODELS = {
  cityCore: "/models/city-core.0000be5e42.glb",
  cityTiles: [
    "/models/city-tile-0.3a8608e695.glb",
    "/models/city-tile-1.844b6f46af.glb",
    "/models/city-tile-2.41431ac5c4.glb",
    "/models/city-tile-3.dbec2f88e8.glb",
  ],
  car: "/models/car.9e73b5c633.glb",
  plane: "/models/plane.a89a45b17b.glb",
  islandField: "/models/island-field.975282efb4.bin",
  environment: {
    1: "/models/environment-1.4bc7b0744f.bin",
    2: "/models/environment-2.a6a6ccce5b.bin",
    3: "/models/environment-3.b60d8d704f.bin",
  } as Record<PaletteId, string>,
  draco: "/draco/",
};

export const ENV_MAP = { width: 336, height: 256, intensity: 0.45 };
export const CENTER: [number, number, number] = [-98, 0, -106];
export const FIELD = { cols: 194, rows: 208, x0: -292, z0: -312, step: 2 };

export type PaletteId = 1 | 2 | 3;

export interface MaterialSpec {
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export interface Palette {
  id: PaletteId;
  name: string;
  sky: { zenith: string; horizon: string; sunGlow: string; sunGlowSize: number };
  sun: { direction: [number, number, number]; color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  fog: { color: string; near: number; far: number };
  materials: Record<string, MaterialSpec>;
  otherMaterials: { saturation: number; lightness: number; tint: string; tintAmount: number };
  water: { deep: string; shallow: string; shimmer: number };
  shore: { sand: string; wetSand: string; lagoon: string; foam: string };
  clouds: { color: string; shade: string };
  grade: {
    exposure: number;
    saturation: number;
    contrast: number;
    brightness: number;
    shadowTint: [number, number, number];
    highlightTint: [number, number, number];
    splitStrength: number;
    bloomIntensity: number;
    bloomThreshold: number;
    vignette: number;
  };
}

const facades = (p: { pink: string; lav: string; blue: string; orange: string; beige: string; sage: string }) => ({
  m_facade_pink: { color: p.pink },
  m_facade_lavender: { color: p.lav },
  m_facade_blue: { color: p.blue },
  m_facade_orange: { color: p.orange },
  m_facade_beige: { color: p.beige },
  m_facade_sage: { color: p.sage },
});

export const PALETTES: Record<PaletteId, Palette> = {
  1: {
    id: 1,
    name: "Fresh day",
    sky: { zenith: "#3f8fdc", horizon: "#e9eef0", sunGlow: "#fff2d6", sunGlowSize: 0.35 },
    sun: { direction: [-0.42, 0.78, -0.46], color: "#fff4e3", intensity: 2.6 },
    hemi: { sky: "#cfe6ff", ground: "#8fa86c", intensity: 0.95 },
    fog: { color: "#dfe9ee", near: 320, far: 1150 },
    materials: {
      m_water: { color: "#2a9db4", roughness: 0.26, metalness: 0.05 },
      m_asphalt: { color: "#4a4744" },
      m_road_paint: { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.3 },
      m_pavement: { color: "#cdc8be" },
      m_terrain: { color: "#86b85a" },
      m_grass: { color: "#77c25f" },
      m_grass_light: { color: "#a2d264" },
      m_forest: { color: "#5c9c46" },
      m_tree: { color: "#4c8f43" },
      m_tree_dark: { color: "#3b7a3e" },
      m_earth: { color: "#a9865c" },
      m_sand: { color: "#ecd8a4" },
      m_runway: { color: "#3c3c41" },
      m_apron: { color: "#aab0a2" },
      m_taxiway: { color: "#6e6e73" },
      m_bridge: { color: "#d9513f" },
      ...facades({ pink: "#f39a98", lav: "#9893d8", blue: "#73c3e6", orange: "#f08a5a", beige: "#e9d3ae", sage: "#a3c494" }),
      m_glass: { color: "#97d0ea", roughness: 0.25 },
      m_white_trim: { color: "#f5f2ea" },
    },
    otherMaterials: { saturation: 1.3, lightness: 0.97, tint: "#fff6e6", tintAmount: 0.06 },
    water: { deep: "#1d7e98", shallow: "#47c1c9", shimmer: 0.55 },
    shore: { sand: "#e8d8ae", wetSand: "#b7a277", lagoon: "#5ccfc6", foam: "#f4fbfb" },
    clouds: { color: "#ffffff", shade: "#cbd9e6" },
    grade: { exposure: 1, saturation: 0.1, contrast: 0.08, brightness: 0, shadowTint: [0.96, 0.99, 1.05], highlightTint: [1.03, 1.01, 0.97], splitStrength: 0.5, bloomIntensity: 0.25, bloomThreshold: 0.92, vignette: 0.32 },
  },
  2: {
    id: 2,
    name: "Golden hour",
    sky: { zenith: "#4f86cf", horizon: "#ffc98f", sunGlow: "#ffb766", sunGlowSize: 0.55 },
    sun: { direction: [-0.74, 0.27, -0.6], color: "#ffd3a0", intensity: 2.9 },
    hemi: { sky: "#ffdcb5", ground: "#71805a", intensity: 0.8 },
    fog: { color: "#f3cfa8", near: 280, far: 1050 },
    materials: {
      m_water: { color: "#2a8ea6", roughness: 0.24, metalness: 0.06 },
      m_asphalt: { color: "#544c47" },
      m_road_paint: { color: "#ffffff", emissive: "#fff3e2", emissiveIntensity: 0.4 },
      m_pavement: { color: "#d6c9b5" },
      m_terrain: { color: "#8fb558" },
      m_grass: { color: "#80bf5b" },
      m_grass_light: { color: "#acd062" },
      m_forest: { color: "#5f9844" },
      m_tree: { color: "#518c42" },
      m_tree_dark: { color: "#3f763c" },
      m_earth: { color: "#b38a5a" },
      m_sand: { color: "#f0d39b" },
      m_runway: { color: "#3e3a3c" },
      m_apron: { color: "#b5b09e" },
      m_taxiway: { color: "#736d6b" },
      m_bridge: { color: "#d84b37" },
      ...facades({ pink: "#f59a8f", lav: "#a093d2", blue: "#7cc0dd", orange: "#f2854f", beige: "#efd2a6", sage: "#a9c28c" }),
      m_glass: { color: "#a6cfe0", roughness: 0.2 },
      m_white_trim: { color: "#fbf1e2" },
    },
    otherMaterials: { saturation: 1.25, lightness: 0.98, tint: "#ffd9ad", tintAmount: 0.1 },
    water: { deep: "#1f7690", shallow: "#5bc0c4", shimmer: 0.75 },
    shore: { sand: "#ebd09c", wetSand: "#b49369", lagoon: "#68c6bc", foam: "#fff3e4" },
    clouds: { color: "#fff1e0", shade: "#e8b49a" },
    grade: { exposure: 1, saturation: 0.12, contrast: 0.1, brightness: 0, shadowTint: [0.94, 0.98, 1.07], highlightTint: [1.06, 1, 0.92], splitStrength: 0.7, bloomIntensity: 0.35, bloomThreshold: 0.88, vignette: 0.38 },
  },
  3: {
    id: 3,
    name: "Dusk",
    sky: { zenith: "#25356a", horizon: "#f2a07e", sunGlow: "#ff8c5e", sunGlowSize: 0.6 },
    sun: { direction: [-0.82, 0.13, -0.56], color: "#ffa47e", intensity: 1.7 },
    hemi: { sky: "#9a97d0", ground: "#3d4150", intensity: 0.85 },
    fog: { color: "#b98f97", near: 240, far: 950 },
    materials: {
      m_water: { color: "#255f84", roughness: 0.3, metalness: 0.06 },
      m_asphalt: { color: "#3b3940" },
      m_road_paint: { color: "#ffffff", emissive: "#f4ecff", emissiveIntensity: 0.55 },
      m_pavement: { color: "#b7b0b0" },
      m_terrain: { color: "#6f9a58" },
      m_grass: { color: "#69a75a" },
      m_grass_light: { color: "#90b862" },
      m_forest: { color: "#4b8146" },
      m_tree: { color: "#407841" },
      m_tree_dark: { color: "#33663d" },
      m_earth: { color: "#94775d" },
      m_sand: { color: "#d9bf95" },
      m_runway: { color: "#333238" },
      m_apron: { color: "#99979a" },
      m_taxiway: { color: "#5f5d64" },
      m_bridge: { color: "#d0473f" },
      ...facades({ pink: "#e88d97", lav: "#8c86cf", blue: "#6aaed6", orange: "#e57d55", beige: "#d8c2a5", sage: "#93b08e" }),
      m_glass: { color: "#7f9fc2", emissive: "#ffcf8a", emissiveIntensity: 0.35, roughness: 0.2 },
      m_white_trim: { color: "#e9e3e3" },
    },
    otherMaterials: { saturation: 1.2, lightness: 0.92, tint: "#c9a6c4", tintAmount: 0.08 },
    water: { deep: "#1b4b70", shallow: "#4f8fae", shimmer: 0.9 },
    shore: { sand: "#b8a79e", wetSand: "#83746d", lagoon: "#3f86a4", foam: "#d8dceb" },
    clouds: { color: "#ffd2c2", shade: "#8e7aa6" },
    grade: { exposure: 1.05, saturation: 0.1, contrast: 0.12, brightness: 0.01, shadowTint: [0.92, 0.96, 1.1], highlightTint: [1.08, 0.99, 0.93], splitStrength: 0.8, bloomIntensity: 0.55, bloomThreshold: 0.8, vignette: 0.42 },
  },
};

/* ------------------------------------------------------------ road graph */

/** Junctions and road ends (x, z), extracted from the asphalt in the city models. */
export const ROAD_NODES: [number, number][] = [
  [-9.5, -168.5], [-31.5, -167.5], [26.5, -167.5], [-9.5, -115.5], [27.3, -115.5], [-30.2, -115.2],
  [10.5, -54.5], [-59.7, -45.7], [-31.5, -28], [-9.5, -28.7], [-60.5, -28.5], [-45.5, -28.5],
  [27.5, -27.7], [-238.5, -27.5], [-212.5, -27.2], [0.5, -27.2], [40.5, -27.5], [-0.5, -6.7],
  [-212.5, -6.5], [-10.5, -6.5], [18.5, 0.5], [-228.5, 7], [-31.5, 46.5],
];

/** Two-way road links [from, to]. */
export const ROAD_LINKS: [number, number][] = [
  [0, 3], [1, 5], [2, 4], [5, 3], [3, 4], [5, 8], [3, 9], [4, 12], [7, 11], [7, 10], [10, 11],
  [10, 14], [11, 8], [8, 9], [9, 15], [13, 14], [15, 12], [12, 16], [14, 18], [8, 22], [15, 17], [19, 17], [17, 20],
];

/** Named roads for labels. */
export const ROAD_NAMES: Record<string, string> = {
  "0-3": "Terminal Avenue", "3-9": "Terminal Avenue",
  "1-5": "Airport Road", "5-8": "Airport Road", "8-22": "Airport Road",
  "2-4": "Harbour Drive", "4-12": "Harbour Drive",
  "5-3": "Civic Lane", "3-4": "Civic Lane",
  "10-14": "River Bridge", "13-14": "Forest Road", "14-18": "Forest Road",
  "10-11": "Bridge Approach", "11-8": "Bridge Approach", "8-9": "Market Street", "9-15": "Market Street", "15-12": "Market Street", "12-16": "Market Street",
  "7-11": "Riverside Lane", "7-10": "Riverside Lane", "15-17": "Station Road", "19-17": "Station Road", "17-20": "Station Road",
};

/* --------------------------------------------------------------- places */

export interface Place {
  id: string;
  name: string;
  kind: "command" | "hospital" | "police" | "fire" | "civic" | "residential" | "shelter" | "station" | "airport" | "industrial" | "park";
  x: number;
  z: number;
  height: number;
}

/** Buildings of the 3D city given smart-city roles (footprint centres and roof heights from the models). */
export const PLACES: Place[] = [
  { id: "iccc", name: "Integrated Command & Control Centre", kind: "command", x: 8.5, z: -89.6, height: 80 },
  { id: "hospital", name: "Civil Hospital", kind: "hospital", x: -53.2, z: -143.4, height: 50 },
  { id: "civic", name: "Municipal Corporation", kind: "civic", x: 10, z: -129.6, height: 29 },
  { id: "police", name: "Police Headquarters", kind: "police", x: 10, z: -159.9, height: 29 },
  { id: "fire", name: "Fire & Emergency Services", kind: "fire", x: 39.8, z: -83.1, height: 27 },
  { id: "apex", name: "Apex Residency", kind: "residential", x: -53, z: -94.5, height: 51 },
  { id: "riverside", name: "Riverside Apartments", kind: "residential", x: -52, z: -55, height: 11 },
  { id: "market", name: "Market Square Flats", kind: "residential", x: -20.5, z: -55, height: 18 },
  { id: "harbour", name: "Harbour View", kind: "residential", x: 39.5, z: -54.5, height: 18 },
  { id: "fuel", name: "Airport Fuel Farm", kind: "industrial", x: 39, z: -208, height: 35 },
  { id: "warehouse", name: "Cold-storage Warehouse", kind: "industrial", x: 38, z: -2, height: 12 },
  { id: "station", name: "Railway Station", kind: "station", x: 9.5, z: 29.5, height: 6 },
  { id: "airport", name: "Airport Terminal", kind: "airport", x: -8, z: -204, height: 55 },
  { id: "shelter-forest", name: "Forest Lodge Relief Shelter", kind: "shelter", x: -209, z: 6, height: 7 },
  { id: "shelter-hall", name: "Community Hall Shelter", kind: "shelter", x: -183.5, z: 6, height: 11 },
  { id: "shelter-school", name: "Riverside School Shelter", kind: "shelter", x: -20.5, z: 0, height: 10 },
  { id: "park", name: "Forest Park", kind: "park", x: -205, z: -100, height: 10 },
  { id: "fair", name: "Riverside Fair", kind: "park", x: -49, z: 7, height: 16 },
  { id: "clock", name: "Clock Tower", kind: "civic", x: -62, z: -6, height: 40 },
];

export const placeById = (id: string) => PLACES.find((p) => p.id === id)!;

/** River channel and low-lying banks (for flood visuals). */
export const RIVER = { x0: -167, x1: -76, z0: -171, z1: 52 };

/** Railway centreline (runs east–west), with tunnel portals at both ends. */
export const RAIL = { z: 26.2, y: 1.33, x0: -238, x1: 38, station: 9.5 };
/** Runway (east–west) and the apron by the terminal. */
export const RUNWAY = { z: -243, y: 0.21, x0: -71, x1: 47, gate: [-35, -231] as [number, number] };
/** Animated fairground, on the model's own fair square by the river (its static rides are cleared). */
export const FAIR = { x: -49, z: 7, scale: 0.58 };
/** The fair square's footprint, cleared of the model's static rides. */
export const FAIR_SQUARE = { x0: -66, x1: -38, z0: -10, z1: 20 };
/** Clock tower on the north-west corner of the square. */
export const CLOCK_TOWER = { x: -62, z: -6 };
/** CCTV poles on junctions. */
export const CCTV_NODES: { node: number; name: string }[] = [
  { node: 3, name: "Civic Lane × Terminal Ave" },
  { node: 4, name: "Civic Lane × Harbour Dr" },
  { node: 8, name: "Airport Rd × Market St" },
  { node: 12, name: "Harbour Dr × Market St" },
  { node: 14, name: "Forest Rd × Bridge" },
  { node: 17, name: "Station Rd junction" },
  { node: 10, name: "Bridge east end" },
];
