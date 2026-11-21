// Downloads the 3D city models and Draco decoder from the deployed
// CapstoneConnect 3D site into public/, so UrbanPulse can run offline.
// Then set NEXT_PUBLIC_CITY_ASSETS="" in .env.local.
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.env.CITY_SOURCE ?? "https://3duicapstoneconnect.vercel.app";
const FILES = [
  "/models/city-core.0000be5e42.glb",
  "/models/city-tile-0.3a8608e695.glb",
  "/models/city-tile-1.844b6f46af.glb",
  "/models/city-tile-2.41431ac5c4.glb",
  "/models/city-tile-3.dbec2f88e8.glb",
  "/models/car.9e73b5c633.glb",
  "/models/plane.a89a45b17b.glb",
  "/models/island-field.975282efb4.bin",
  "/models/environment-1.4bc7b0744f.bin",
  "/models/environment-2.a6a6ccce5b.bin",
  "/models/environment-3.b60d8d704f.bin",
  "/draco/draco_wasm_wrapper.js",
  "/draco/draco_decoder.wasm",
];

for (const f of FILES) {
  const out = path.join("public", f);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const res = await fetch(BASE + f);
  if (!res.ok) throw new Error(`${res.status} ${f}`);
  await fs.writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log("saved", out);
}
console.log('\nDone. Add NEXT_PUBLIC_CITY_ASSETS="" to .env.local and restart `npm run dev`.');
