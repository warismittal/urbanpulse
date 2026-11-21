/**
 * Life in the city: Victorian street lamps, a vintage steam train with a level
 * crossing, the airliner's full landing / taxi / take-off cycle, a working
 * fairground (Ferris wheel, carousel, swing ride, string lights, crowd),
 * rowing boats with lanterns and the river ferry, bird flocks, aviation
 * warning lights, and an open horizon of distant islands, ships and a
 * lighthouse.
 *
 * Everything is driven by `engine.night` (0 day .. 1 night) so lights come on
 * at dusk and go off at dawn.
 */
import * as THREE from "three";
import { CENTER, FAIR, PLACES, RAIL, RUNWAY } from "./config";
import type { CityEngine } from "./engine";
import type { Traffic3D } from "./traffic3d";
import { mergeParts } from "./vehicles";

type Part = THREE.BufferGeometry;

function tint(g: Part, c: THREE.ColorRepresentation): Part {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const n = geo.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute("uv");
  return geo;
}
const at = (g: Part, x: number, y: number, z: number) => (g.translate(x, y, z), g);

/** Soft round sprite texture without a canvas (works everywhere). */
function softTexture(size = 64, hard = 0) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.max(0, 1 - r) ** (hard ? 0.6 : 1.8);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

const vmat = (rough = 0.7, metal = 0.1) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
const glowMat = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

/* ================================================================ lamps */

class StreetLamps {
  group = new THREE.Group();
  private glass: THREE.MeshBasicMaterial;
  private pools: THREE.MeshBasicMaterial;
  count = 0;

  constructor(traffic: Traffic3D) {
    const spots: { x: number; y: number; z: number; yaw: number }[] = [];
    const seen = new Set<string>();
    for (const e of traffic.edges) {
      const key = `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = traffic.nodes[e.from];
      const step = 21;
      const n = Math.floor((e.length - 16) / step);
      for (let k = 0; k <= n; k++) {
        const s = 8 + k * step + ((e.length - 16) - n * step) / 2;
        if (s < 7 || s > e.length - 7) continue;
        const side = k % 2 === 0 ? 1 : -1;
        const lat = (e.name === "River Bridge" ? 4.3 : 5.3) * side;
        spots.push({ x: a.x + e.dir.x * s + e.dir.y * lat, z: a.y + e.dir.y * s - e.dir.x * lat, y: traffic.heightAt(e.id, s), yaw: Math.atan2(e.dir.x, e.dir.y) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
    }
    this.count = spots.length;

    // Cast-iron Victorian post: plinth, fluted column, scroll arm, lantern cage and cap.
    const iron = "#1f2a24";
    const post = mergeParts([
      tint(at(new THREE.CylinderGeometry(0.32, 0.4, 0.55, 8), 0, 0.27, 0), iron),
      tint(at(new THREE.CylinderGeometry(0.2, 0.28, 0.5, 8), 0, 0.8, 0), iron),
      tint(at(new THREE.CylinderGeometry(0.08, 0.12, 3.6, 8), 0, 2.8, 0), iron),
      tint(at(new THREE.TorusGeometry(0.16, 0.035, 6, 12).rotateX(Math.PI / 2), 0, 4.2, 0), iron),
      tint(at(new THREE.BoxGeometry(0.06, 0.06, 0.9), 0, 4.45, 0.35), iron),
      tint(at(new THREE.CylinderGeometry(0.26, 0.16, 0.12, 4).rotateY(Math.PI / 4), 0, 4.6, 0.75), iron),
      tint(at(new THREE.ConeGeometry(0.36, 0.38, 4).rotateY(Math.PI / 4), 0, 5.28, 0.75), iron),
      tint(at(new THREE.SphereGeometry(0.06, 6, 4), 0, 5.52, 0.75), iron),
    ]);
    const lantern = tint(at(new THREE.CylinderGeometry(0.27, 0.19, 0.48, 4).rotateY(Math.PI / 4), 0, 4.92, 0.75), "#ffe0a3");
    const posts = new THREE.InstancedMesh(post, vmat(0.55, 0.5), spots.length);
    this.glass = glowMat();
    const lamps = new THREE.InstancedMesh(lantern, this.glass, spots.length);
    // Pools of light on the ground at night.
    const poolGeo = new THREE.CircleGeometry(6.5, 24);
    poolGeo.rotateX(-Math.PI / 2);
    this.pools = new THREE.MeshBasicMaterial({ map: softTexture(64), color: "#ffc27a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const pools = new THREE.InstancedMesh(poolGeo, this.pools, spots.length);
    pools.renderOrder = 2;
    const m = new THREE.Object3D();
    spots.forEach((p, i) => {
      m.position.set(p.x, p.y, p.z);
      m.rotation.set(0, p.yaw, 0);
      m.updateMatrix();
      posts.setMatrixAt(i, m.matrix);
      lamps.setMatrixAt(i, m.matrix);
      m.position.set(p.x + Math.sin(p.yaw) * 0.75, p.y + 0.12, p.z + Math.cos(p.yaw) * 0.75);
      m.updateMatrix();
      pools.setMatrixAt(i, m.matrix);
    });
    posts.castShadow = true;
    for (const im of [posts, lamps, pools]) im.frustumCulled = false;
    this.group.add(posts, lamps, pools);
  }

  update(night: number, t: number) {
    // Lamps warm up over a few seconds with a slight flicker, like gas mantles.
    const on = THREE.MathUtils.smoothstep(night, 0.15, 0.55);
    this.glass.color.setRGB(0.55 + on * 3.2, 0.5 + on * 2.4, 0.42 + on * 1.3).multiplyScalar(0.97 + 0.03 * Math.sin(t * 13));
    this.pools.opacity = on * 0.55;
  }
}

/* ================================================================ train */

interface TrainCar {
  obj: THREE.Group;
  offset: number; // distance behind the front of the train
  length: number;
  wheels: THREE.Object3D[];
}

class SteamTrain {
  group = new THREE.Group();
  private cars: TrainCar[] = [];
  private x = RAIL.x0 - 60;
  private dir = 1;
  private v = 0;
  private phase: "hidden" | "run" | "dwell" = "hidden";
  private timer = 6;
  private puffs: THREE.Sprite[] = [];
  private puffData: { life: number; vx: number; vy: number; vz: number; s0: number }[] = [];
  private puffClock = 0;
  private windows: THREE.MeshBasicMaterial;
  private headlamp: THREE.MeshBasicMaterial;
  private beam: THREE.SpotLight;
  private stationStopped = false;
  status = "In the west tunnel";
  /** Called with true when the train nears a level crossing at x. */
  crossings: { x: number; closed: boolean; onChange?: (closed: boolean) => void }[] = [];

  constructor(scene: THREE.Group) {
    this.windows = new THREE.MeshBasicMaterial({ color: "#ffd38a", toneMapped: false });
    this.headlamp = new THREE.MeshBasicMaterial({ color: "#fff1c4", toneMapped: false });
    this.cars.push(this.makeLoco());
    this.cars.push(this.makeTender(this.cars[0].offset + this.cars[0].length + 0.6));
    let off = this.cars[1].offset + this.cars[1].length + 0.8;
    for (let i = 0; i < 3; i++) {
      const c = this.makeCoach(off, i);
      this.cars.push(c);
      off += c.length + 0.8;
    }
    for (const c of this.cars) this.group.add(c.obj);

    this.beam = new THREE.SpotLight("#ffe7b0", 0, 70, 0.45, 0.6, 1.5);
    this.group.add(this.beam, this.beam.target);

    const tex = softTexture(64);
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: "#e9e6df", transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false;
      this.puffs.push(s);
      this.puffData.push({ life: 0, vx: 0, vy: 0, vz: 0, s0: 1 });
      scene.add(s);
    }
    this.buildPortals();
  }

  /** Locomotive: boiler, smokebox, chimney, dome, cab, red driving wheels and a cow-catcher. Faces +x. */
  private makeLoco(): TrainCar {
    const g = new THREE.Group();
    const L = 9.5;
    const black = "#1c1c1f";
    const brass = "#c9a441";
    const red = "#a3241e";
    const body = mergeParts([
      tint(at(new THREE.BoxGeometry(L, 0.35, 2.4), -L / 2, 1.05, 0), black), // frame
      tint(at(new THREE.CylinderGeometry(0.95, 0.95, 5.6, 16).rotateZ(Math.PI / 2), -3.9, 2.25, 0), black), // boiler
      tint(at(new THREE.CylinderGeometry(1.0, 1.0, 0.25, 16).rotateZ(Math.PI / 2), -1.15, 2.25, 0), brass), // smokebox ring
      tint(at(new THREE.CylinderGeometry(0.98, 0.98, 0.9, 16).rotateZ(Math.PI / 2), -0.65, 2.25, 0), "#26262a"), // smokebox
      tint(at(new THREE.CylinderGeometry(0.28, 0.36, 1.25, 10), -1.0, 3.6, 0), black), // chimney
      tint(at(new THREE.CylinderGeometry(0.42, 0.38, 0.14, 10), -1.0, 4.25, 0), black),
      tint(at(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), -3.6, 3.15, 0), brass), // dome
      tint(at(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8), -5.2, 3.35, 0), brass), // whistle stack
      tint(at(new THREE.BoxGeometry(2.6, 2.4, 2.5), -8.0, 2.45, 0), red), // cab
      tint(at(new THREE.BoxGeometry(3.0, 0.18, 2.8), -8.0, 3.72, 0), black), // cab roof
      tint(at(new THREE.BoxGeometry(0.2, 0.9, 2.5), -0.05, 0.75, 0), "#7a1712"), // buffer beam
      tint(at(new THREE.ConeGeometry(1.3, 1.1, 4, 1).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4), 0.5, 0.6, 0), "#3a3a3d"), // cow-catcher
      tint(at(new THREE.BoxGeometry(5.6, 0.12, 0.18), -3.9, 1.5, 1.05), brass), // running boards
      tint(at(new THREE.BoxGeometry(5.6, 0.12, 0.18), -3.9, 1.5, -1.05), brass),
    ]);
    g.add(new THREE.Mesh(body, vmat(0.45, 0.45)));
    const win = new THREE.Mesh(at(new THREE.BoxGeometry(1.2, 0.7, 2.52), -8.0, 2.95, 0), this.windows);
    g.add(win);
    const lamp = new THREE.Mesh(at(new THREE.CylinderGeometry(0.26, 0.26, 0.3, 10).rotateZ(Math.PI / 2), 0.05, 2.7, 0), this.headlamp);
    g.add(lamp);
    const wheels: THREE.Object3D[] = [];
    const wgeo = mergeParts([tint(new THREE.CylinderGeometry(0.8, 0.8, 0.18, 16).rotateX(Math.PI / 2), red), tint(at(new THREE.BoxGeometry(1.5, 0.12, 0.2), 0, 0, 0), "#d8d2c4")]);
    const sgeo = mergeParts([tint(new THREE.CylinderGeometry(0.45, 0.45, 0.16, 12).rotateX(Math.PI / 2), black)]);
    for (const [x, geo, y] of [[-2.2, sgeo, 0.45], [-4.2, wgeo, 0.8], [-6.0, wgeo, 0.8], [-7.8, wgeo, 0.8]] as [number, Part, number][]) {
      for (const z of [-1.15, 1.15]) {
        const w = new THREE.Mesh(geo, vmat(0.5, 0.5));
        w.position.set(x, y, z);
        g.add(w);
        wheels.push(w);
      }
    }
    // Coupling rods.
    const rod = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: "#d8d2c4", metalness: 0.8, roughness: 0.3 }));
    rod.name = "rod";
    rod.position.set(-6.0, 0.8, 1.3);
    g.add(rod);
    const rod2 = rod.clone();
    rod2.position.z = -1.3;
    g.add(rod2);
    return { obj: g, offset: 0, length: L, wheels };
  }

  private makeTender(offset: number): TrainCar {
    const g = new THREE.Group();
    const L = 4.6;
    const body = mergeParts([
      tint(at(new THREE.BoxGeometry(L, 0.3, 2.4), -L / 2, 1.0, 0), "#1c1c1f"),
      tint(at(new THREE.BoxGeometry(L - 0.2, 1.7, 2.5), -L / 2, 2.0, 0), "#a3241e"),
      tint(at(new THREE.BoxGeometry(L - 0.6, 0.5, 2.1), -L / 2, 3.0, 0), "#141414"), // coal
      tint(at(new THREE.BoxGeometry(L - 0.1, 0.1, 2.55), -L / 2, 2.9, 0), "#c9a441"),
    ]);
    g.add(new THREE.Mesh(body, vmat(0.6, 0.3)));
    const wheels = this.bogies(g, L, 0.5);
    return { obj: g, offset, length: L, wheels };
  }

  private makeCoach(offset: number, i: number): TrainCar {
    const g = new THREE.Group();
    const L = 10.5;
    const paint = i % 2 ? "#2f4a3a" : "#5b1f22";
    const cream = "#e9dcc0";
    const roof = new THREE.CylinderGeometry(1.45, 1.45, L, 14, 1, false, -Math.PI / 2 + 0.55, Math.PI - 1.1).rotateZ(Math.PI / 2);
    const body = mergeParts([
      tint(at(new THREE.BoxGeometry(L, 0.3, 2.3), -L / 2, 1.0, 0), "#1c1c1f"),
      tint(at(new THREE.BoxGeometry(L - 0.1, 1.0, 2.6), -L / 2, 1.75, 0), paint),
      tint(at(new THREE.BoxGeometry(L - 0.1, 0.25, 2.62), -L / 2, 2.4, 0), cream),
      tint(at(new THREE.BoxGeometry(L - 0.1, 0.4, 2.6), -L / 2, 3.12, 0), paint),
      tint(at(roof, -L / 2, 2.3, 0), "#3b3b3e"),
      tint(at(new THREE.BoxGeometry(0.5, 2.0, 2.0), -0.15, 2.0, 0), "#2a2a2c"), // vestibules
      tint(at(new THREE.BoxGeometry(0.5, 2.0, 2.0), -L + 0.15, 2.0, 0), "#2a2a2c"),
    ]);
    g.add(new THREE.Mesh(body, vmat(0.55, 0.2)));
    // Window band (lit at night).
    for (let k = 0; k < 6; k++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.55, 2.64), this.windows);
      w.position.set(-1.2 - k * 1.6, 2.72, 0);
      g.add(w);
    }
    const wheels = this.bogies(g, L, 0.45);
    return { obj: g, offset, length: L, wheels };
  }

  private bogies(g: THREE.Group, L: number, r: number) {
    const wheels: THREE.Object3D[] = [];
    const geo = mergeParts([tint(new THREE.CylinderGeometry(r, r, 0.16, 12).rotateX(Math.PI / 2), "#202022"), tint(new THREE.BoxGeometry(r * 1.6, 0.08, 0.18), "#8a8a8a")]);
    for (const x of [-1.2, -2.4, -L + 2.4, -L + 1.2]) {
      for (const z of [-1.1, 1.1]) {
        const w = new THREE.Mesh(geo, vmat(0.5, 0.5));
        w.position.set(x, r, z);
        g.add(w);
        wheels.push(w);
      }
    }
    return wheels;
  }

  private buildPortals() {
    const stone = "#7d7468";
    for (const [x, face] of [[RAIL.x0, -1], [RAIL.x1, 1]] as [number, number][]) {
      const parts = [
        tint(at(new THREE.BoxGeometry(3, 9, 14), x + face * 1.5, RAIL.y + 4.5, RAIL.z), stone),
        tint(at(new THREE.BoxGeometry(5, 4, 20), x + face * 4.5, RAIL.y + 2, RAIL.z), "#6b8f4e"), // hillside
      ];
      const portal = new THREE.Mesh(mergeParts(parts), vmat(0.95, 0));
      portal.castShadow = true;
      portal.receiveShadow = true;
      // Dark opening.
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5.4), new THREE.MeshBasicMaterial({ color: "#050506" }));
      hole.position.set(x - face * 0.02, RAIL.y + 2.7, RAIL.z);
      hole.rotation.y = face > 0 ? -Math.PI / 2 : Math.PI / 2;
      const arch = new THREE.Mesh(new THREE.CircleGeometry(2.1, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: "#050506" }));
      arch.position.set(x - face * 0.02, RAIL.y + 5.4, RAIL.z);
      arch.rotation.y = hole.rotation.y;
      this.group.add(portal, hole, arch);
    }
  }

  private trainLength() {
    const c = this.cars[this.cars.length - 1];
    return c.offset + c.length;
  }

  update(dt: number, night: number, t: number) {
    const total = this.trainLength();
    const vmax = 13;
    if (this.phase === "hidden") {
      this.timer -= dt;
      this.group.visible = false;
      if (this.timer <= 0) {
        this.phase = "run";
        this.stationStopped = false;
        this.x = this.dir > 0 ? RAIL.x0 - 2 : RAIL.x1 + 2;
        this.v = vmax * 0.6;
      }
    } else if (this.phase === "dwell") {
      this.timer -= dt;
      this.v = 0;
      this.status = `Boarding at Railway Station · departs in ${Math.ceil(this.timer)} s`;
      if (this.timer <= 0) this.phase = "run";
    }
    if (this.phase === "run") {
      // Brake for the station (front of the train stops past the platform centre).
      const stopAt = RAIL.station + this.dir * (total / 2);
      const toStop = (stopAt - this.x) * this.dir;
      let target = vmax;
      if (!this.stationStopped && toStop > 0) target = Math.min(vmax, Math.sqrt(2 * 0.7 * toStop) + 0.2);
      this.v += THREE.MathUtils.clamp(target - this.v, -1.2 * dt, 0.55 * dt);
      this.x += this.dir * this.v * dt;
      if (!this.stationStopped && toStop <= 0.3) {
        this.stationStopped = true;
        this.phase = "dwell";
        this.timer = 22;
        this.v = 0;
      } else this.status = this.stationStopped ? `Departing ${this.dir > 0 ? "east" : "west"} · ${(this.v * 3.6).toFixed(0)} km/h` : `Arriving at Railway Station · ${(this.v * 3.6).toFixed(0)} km/h`;
      // Into the far tunnel: hide and come back the other way.
      const tail = this.x - this.dir * total;
      if ((this.dir > 0 && tail > RAIL.x1 + 1) || (this.dir < 0 && tail < RAIL.x0 - 1)) {
        this.phase = "hidden";
        this.timer = 26;
        this.dir *= -1;
        this.status = `In the ${this.dir > 0 ? "west" : "east"} tunnel · next run in 26 s`;
      }
    }
    if (this.phase !== "hidden") {
      this.group.visible = true;
      for (const c of this.cars) {
        const x = this.x - this.dir * c.offset;
        c.obj.position.set(x, RAIL.y, RAIL.z);
        c.obj.rotation.y = this.dir > 0 ? 0 : Math.PI;
        // Hide cars still inside a tunnel.
        const back = x - this.dir * c.length;
        c.obj.visible = Math.max(x, back) > RAIL.x0 + 0.5 && Math.min(x, back) < RAIL.x1 - 0.5;
        for (const w of c.wheels) w.rotation.z -= (this.v * dt) / 0.7;
      }
      const loco = this.cars[0].obj;
      const ang = this.cars[0].wheels[2]?.rotation.z ?? 0;
      loco.children.filter((o) => o.name === "rod").forEach((r, i) => {
        r.position.x = -6.0 + Math.cos(ang) * 0.45;
        r.position.y = 0.8 + Math.sin(ang) * 0.45 * (i ? 1 : -1);
      });
      // Headlamp beam at night.
      this.beam.intensity = night * 220;
      this.beam.visible = night > 0.15;
      this.beam.position.set(this.x + this.dir * 0.3, RAIL.y + 2.7, RAIL.z);
      this.beam.target.position.set(this.x + this.dir * 30, RAIL.y, RAIL.z);
      // Chuff: puff rate grows with speed, plus a lazy plume while standing.
      this.puffClock -= dt;
      if (this.puffClock <= 0 && this.cars[0].obj.visible) {
        this.puffClock = this.v > 0.5 ? Math.max(0.12, 1.1 - this.v * 0.07) : 0.9;
        this.emit(this.x - this.dir * 1.0, RAIL.y + 4.4, RAIL.z, this.v);
      }
    }
    this.windows.color.setRGB(0.3 + night * 2.4, 0.25 + night * 1.75, 0.18 + night * 0.9);
    this.headlamp.color.setRGB(0.6 + night * 3, 0.58 + night * 2.8, 0.5 + night * 2);

    // Level crossings close while the train is within 70 m.
    for (const c of this.crossings) {
      const head = this.x;
      const tail = this.x - this.dir * total;
      const near = this.phase !== "hidden" && Math.min(Math.abs(head - c.x), Math.abs(tail - c.x), (head - c.x) * (tail - c.x) < 0 ? 0 : 999) < 70 && !((this.dir > 0 && tail > c.x + 4) || (this.dir < 0 && tail < c.x - 4));
      if (near !== c.closed) {
        c.closed = near;
        c.onChange?.(near);
      }
    }

    for (let i = 0; i < this.puffs.length; i++) {
      const d = this.puffData[i];
      const s = this.puffs[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      s.position.x += d.vx * dt;
      s.position.y += d.vy * dt;
      s.position.z += d.vz * dt;
      d.vy *= 1 - dt * 0.25;
      const age = 1 - d.life / 4.5;
      s.scale.setScalar(d.s0 + age * 7);
      (s.material as THREE.SpriteMaterial).opacity = Math.max(0, (1 - age) * 0.7);
      (s.material as THREE.SpriteMaterial).color.setScalar(0.92 - night * 0.55 + Math.sin(t + i) * 0.02);
      if (d.life <= 0) s.visible = false;
    }
  }

  private emit(x: number, y: number, z: number, v: number) {
    const i = this.puffData.findIndex((d) => d.life <= 0);
    if (i < 0) return;
    const d = this.puffData[i];
    d.life = 4.5;
    d.vx = -this.dir * v * 0.35 + (Math.random() - 0.5) * 0.6;
    d.vy = 2.2 + Math.random() * 1.2;
    d.vz = (Math.random() - 0.5) * 0.8 + 0.4;
    d.s0 = 1.2;
    const s = this.puffs[i];
    s.visible = true;
    s.position.set(x, y, z);
  }

  get position() {
    return { x: this.x, z: RAIL.z, visible: this.phase !== "hidden" };
  }
}

/* ============================================================ crossing */

class LevelCrossing {
  group = new THREE.Group();
  private arms: THREE.Object3D[] = [];
  private lamps: THREE.MeshBasicMaterial;
  private angle = 0;
  closed = false;

  constructor(x: number, y: number) {
    this.lamps = new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false });
    const pole = new THREE.MeshStandardMaterial({ color: "#e9e6df", roughness: 0.6 });
    for (const side of [-1, 1]) {
      const z = RAIL.z + side * 5.2;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.5), pole);
      base.position.set(x - side * 5.4, y + 0.65, z);
      this.group.add(base);
      const pivot = new THREE.Group();
      pivot.position.set(x - side * 5.4, y + 1.2, z);
      const armGeo = new THREE.BoxGeometry(9.5, 0.18, 0.16);
      armGeo.translate(side * 4.75, 0, 0);
      const stripe = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: "#d7261e", roughness: 0.5 }));
      pivot.add(stripe);
      this.group.add(pivot);
      this.arms.push(pivot);
      const sig = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), this.lamps);
      sig.position.set(x - side * 5.4, y + 2.4, z);
      this.group.add(sig);
    }
  }

  update(dt: number, t: number) {
    const goal = this.closed ? 0 : 1.35;
    this.angle += THREE.MathUtils.clamp(goal - this.angle, -dt * 0.9, dt * 0.9);
    this.arms.forEach((a, i) => (a.rotation.z = (i === 0 ? 1 : -1) * this.angle));
    const on = this.closed && Math.floor(t * 2.5) % 2 === 0;
    this.lamps.color.setRGB(on ? 4 : 0.25, on ? 0.4 : 0.05, on ? 0.3 : 0.04);
  }
}

/* ============================================================== airliner */

interface Seg {
  kind: "path" | "circle" | "hold";
  len: number; // metres (or seconds for hold)
  v0: number;
  v1: number;
  at: (u: number) => THREE.Vector3; // u in metres along
  label: string;
  ground?: boolean;
}

function bezierSeg(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, v0: number, v1: number, label: string, ground = false): Seg {
  const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  const len = curve.getLength();
  return { kind: "path", len, v0, v1, label, ground, at: (u) => curve.getPointAt(THREE.MathUtils.clamp(u / len, 0, 1)) };
}

class Airliner {
  private segs: Seg[] = [];
  private i = 0;
  private u = 0;
  private v = 30;
  private hold = 0;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private lift = 0;
  private prev = new THREE.Vector3();
  private navR: THREE.Mesh;
  private navG: THREE.Mesh;
  private strobe: THREE.Mesh;
  private landing: THREE.SpotLight;
  private runwayLights: THREE.MeshBasicMaterial;
  status = "Holding over the bay";
  group = new THREE.Group();

  constructor(private plane: THREE.Object3D) {
    // Ground clearance from the model's bounding box.
    plane.position.set(0, 0, 0);
    plane.rotation.set(0, 0, 0);
    plane.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(plane);
    this.lift = -box.min.y;
    const span = Math.max(box.max.x - box.min.x, 6);

    const mk = (c: THREE.ColorRepresentation) => new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    this.navR = mk(new THREE.Color(3, 0.2, 0.2));
    this.navG = mk(new THREE.Color(0.2, 3, 0.4));
    this.strobe = mk(new THREE.Color(4, 4, 4));
    this.navR.position.set(span / 2, box.min.y + (box.max.y - box.min.y) * 0.35, (box.min.z + box.max.z) / 2);
    this.navG.position.set(-span / 2, this.navR.position.y, this.navR.position.z);
    this.strobe.position.set(0, box.max.y, box.min.z);
    plane.add(this.navR, this.navG, this.strobe);
    this.landing = new THREE.SpotLight("#fff4dc", 0, 160, 0.35, 0.5, 1.4);
    this.landing.position.set(0, box.min.y + 1, box.max.z);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, -10, box.max.z + 60);
    plane.add(this.landing, tgt);
    this.landing.target = tgt;

    // Runway edge lights.
    this.runwayLights = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    const pts: THREE.Vector3[] = [];
    for (let x = RUNWAY.x0; x <= RUNWAY.x1; x += 6) for (const dz of [-5.5, 5.5]) pts.push(new THREE.Vector3(x, RUNWAY.y + 0.12, RUNWAY.z + dz));
    // Approach lights east of the threshold.
    for (let k = 1; k <= 8; k++) pts.push(new THREE.Vector3(RUNWAY.x1 + k * 7, RUNWAY.y + 0.2, RUNWAY.z));
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), this.runwayLights, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    this.group.add(im);

    this.buildCycle();
    const p = this.segs[0].at(0);
    this.prev.copy(p);
  }

  private buildCycle() {
    const C = new THREE.Vector3(CENTER[0], 95, CENTER[2]);
    const R = 330;
    const ry = RUNWAY.y + this.lift;
    const z = RUNWAY.z;
    const V = (x: number, y: number, zz: number) => new THREE.Vector3(x, y, zz);
    const circ = (a0: number, a1: number, label: string): Seg => {
      const len = Math.abs(a1 - a0) * R;
      return { kind: "circle", len, v0: 34, v1: 34, label, at: (u) => {
        const a = a0 + (a1 - a0) * (u / len);
        return V(C.x + Math.cos(a) * R, C.y + Math.sin(a * 3) * 4, C.z + Math.sin(a) * R);
      } };
    };
    // Clockwise holding pattern (angle decreasing), joined at π and left at π/2 a lap later.
    const join = Math.PI;
    const leave = Math.PI / 2 - Math.PI * 2;
    const pLeave = V(C.x + Math.cos(leave) * R, C.y, C.z + Math.sin(leave) * R);
    const gate = V(RUNWAY.x1 + 300, 58, z);
    const td = V(RUNWAY.x1 - 6, ry, z);
    this.segs = [
      circ(join, leave, "Holding over the bay"),
      // Downwind, base and final: a left-hand circuit onto the runway heading west.
      bezierSeg(pLeave, pLeave.clone().add(V(260, -10, 0)), gate.clone().add(V(260, 0, 0)), gate, 34, 30, "Turning final, runway 27"),
      bezierSeg(gate, gate.clone().add(V(-120, -22, 0)), td.clone().add(V(90, 3, 0)), td, 30, 24, "On final approach · gear down"),
      bezierSeg(td, td.clone().add(V(-30, 0, 0)), V(RUNWAY.x0 + 40, ry, z), V(RUNWAY.x0 + 22, ry, z), 24, 6, "Touchdown · reversers", true),
      // Vacate the runway and taxi to the gate.
      bezierSeg(V(RUNWAY.x0 + 22, ry, z), V(RUNWAY.x0 - 6, ry, z), V(RUNWAY.gate[0] - 34, ry, RUNWAY.gate[1]), V(RUNWAY.gate[0], ry, RUNWAY.gate[1]), 6, 2, "Taxiing to the stand", true),
      { kind: "hold", len: 28, v0: 0, v1: 0, label: "On stand · boarding", ground: true, at: () => V(RUNWAY.gate[0], ry, RUNWAY.gate[1]) },
      bezierSeg(V(RUNWAY.gate[0], ry, RUNWAY.gate[1]), V(RUNWAY.gate[0] + 60, ry, RUNWAY.gate[1]), V(RUNWAY.x1 + 22, ry, z), V(RUNWAY.x1 - 4, ry, z), 2, 3, "Taxiing to runway 27", true),
      { kind: "hold", len: 6, v0: 0, v1: 0, label: "Lined up · cleared for take-off", ground: true, at: () => V(RUNWAY.x1 - 4, ry, z) },
      bezierSeg(V(RUNWAY.x1 - 4, ry, z), V(RUNWAY.x1 - 40, ry, z), V(RUNWAY.x0 + 10, ry, z), V(RUNWAY.x0 - 10, ry + 2, z), 3, 34, "Take-off roll", true),
      bezierSeg(V(RUNWAY.x0 - 10, ry + 2, z), V(RUNWAY.x0 - 140, 30, z), V(C.x + Math.cos(join) * R, C.y, C.z + Math.sin(join) * R - 160), V(C.x + Math.cos(join) * R, C.y, C.z + Math.sin(join) * R), 34, 34, "Climbing out"),
    ];
  }

  update(dt: number, night: number, t: number) {
    const seg = this.segs[this.i];
    let pos: THREE.Vector3;
    if (seg.kind === "hold") {
      this.hold += dt;
      this.v = 0;
      pos = seg.at(0);
      if (this.hold >= seg.len) {
        this.hold = 0;
        this.next();
      }
    } else {
      const f = THREE.MathUtils.clamp(this.u / seg.len, 0, 1);
      const vt = Math.sqrt(Math.max(0.25, seg.v0 * seg.v0 + (seg.v1 * seg.v1 - seg.v0 * seg.v0) * f));
      this.v += (vt - this.v) * Math.min(1, dt * 2);
      this.u += Math.max(0.4, this.v) * dt;
      pos = seg.at(this.u);
      if (this.u >= seg.len) {
        this.u -= seg.len;
        this.next();
      }
    }
    this.status = seg.label;
    const d = pos.clone().sub(this.prev);
    const h = Math.hypot(d.x, d.z);
    if (h > 1e-3) {
      const yaw = Math.atan2(d.x, d.z);
      let dy = yaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const rate = dy / Math.max(dt, 1e-3);
      this.yaw = Math.atan2(Math.sin(this.yaw + dy), Math.cos(this.yaw + dy));
      const rollGoal = seg.ground ? 0 : THREE.MathUtils.clamp(-rate * 0.9, -0.5, 0.5);
      this.roll += (rollGoal - this.roll) * Math.min(1, dt * 1.5);
      let pitchGoal = -Math.atan2(d.y, h);
      if (seg.ground && seg.label.startsWith("Take-off") && this.v > 22) pitchGoal = -0.14; // rotate
      if (!seg.ground && seg.label.startsWith("On final")) pitchGoal = -0.06; // flare attitude
      if (seg.ground && !seg.label.startsWith("Take-off")) pitchGoal = 0;
      this.pitch += (pitchGoal - this.pitch) * Math.min(1, dt * 2);
    }
    this.prev.copy(pos);
    this.plane.position.copy(pos);
    this.plane.rotation.set(this.pitch, this.yaw, this.roll, "YXZ");

    // Lights: nav always on, strobe blinks, landing light on approach and at night.
    const blink = Math.floor(t * 1.2) % 2 === 0 && (t * 1.2) % 1 < 0.12;
    this.strobe.visible = blink;
    const approach = this.i >= 1 && this.i <= 3;
    this.landing.intensity = approach || this.i === 8 ? 60 + night * 400 : 0;
    this.landing.visible = this.landing.intensity > 0;
    const k = 0.4 + night * 3;
    this.runwayLights.color.setRGB(k, k * 0.95, k * 0.8);
  }

  private next() {
    this.i = (this.i + 1) % this.segs.length;
  }

  get phaseIndex() {
    return this.i;
  }
}

/* ============================================================ fairground */

class Fairground {
  group = new THREE.Group();
  private wheel = new THREE.Group();
  private gondolas: THREE.Object3D[] = [];
  private wheelBulbs!: THREE.InstancedMesh;
  private carousel = new THREE.Group();
  private horses: THREE.Object3D[] = [];
  private swingTop = new THREE.Group();
  private chairs: THREE.Object3D[] = [];
  private strings: THREE.InstancedMesh;
  private bulbMat: THREE.MeshBasicMaterial;
  private people: THREE.InstancedMesh;
  private crowd: { x: number; z: number; tx: number; tz: number; v: number; c: THREE.Color }[] = [];
  private rides = {
    wheel: { speed: 0, t: 0 },
    carousel: { speed: 0, t: 6 },
    swing: { speed: 0, t: 14 },
  };
  private wheelAngle = 0;
  private carAngle = 0;
  private swingAngle = 0;
  status = { wheel: "Loading", carousel: "Loading", swing: "Loading", visitors: 0 };
  readonly x: number;
  readonly z: number;
  readonly y: number;

  constructor(engine: CityEngine) {
    this.x = FAIR.x;
    this.z = FAIR.z;
    this.y = engine.surfaceY(FAIR.x, FAIR.z, (m) => !/tree|forest|bld|glass|facade/i.test(m), 6) ?? 0;
    this.group.position.set(this.x, this.y, this.z);
    this.bulbMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

    // Ground: a packed-earth plaza with a fence.
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(24, 40), new THREE.MeshStandardMaterial({ color: "#b49b74", roughness: 1 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.05;
    plaza.receiveShadow = true;
    this.group.add(plaza);

    this.buildWheel();
    this.buildCarousel();
    this.buildSwing();
    this.buildStalls();

    // Festoon lights strung between poles round the plaza.
    const poles: THREE.Vector3[] = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      poles.push(new THREE.Vector3(Math.cos(a) * 21, 5.2, Math.sin(a) * 21));
    }
    const bulbs: THREE.Vector3[] = [];
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 5.2, 6);
    poleGeo.translate(0, 2.6, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: "#4a3a2a" });
    for (let k = 0; k < poles.length; k++) {
      const a = poles[k];
      const b = poles[(k + 1) % poles.length];
      const pm = new THREE.Mesh(poleGeo, poleMat);
      pm.position.set(a.x, 0, a.z);
      this.group.add(pm);
      for (let i = 1; i < 10; i++) {
        const t = i / 10;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(Math.PI * t) * 1.3;
        bulbs.push(p);
      }
      // Spokes to the Ferris wheel hub for a canopy of lights.
      if (k % 2 === 0) {
        const hub = new THREE.Vector3(0, 9, 0);
        for (let i = 1; i < 9; i++) {
          const t = i / 9;
          const p = a.clone().lerp(hub, t);
          p.y -= Math.sin(Math.PI * t) * 1.6;
          if (Math.hypot(p.x, p.z) > 9) bulbs.push(p);
        }
      }
    }
    const bulbGeo = tint(new THREE.SphereGeometry(0.16, 6, 4), "#ffffff");
    this.strings = new THREE.InstancedMesh(bulbGeo, this.bulbMat, bulbs.length);
    const m = new THREE.Matrix4();
    const pal = ["#ffd36b", "#ff6b6b", "#6bd6ff", "#9dff6b", "#ff9de0"].map((c) => new THREE.Color(c));
    bulbs.forEach((p, i) => {
      this.strings.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      this.strings.setColorAt(i, pal[i % pal.length]);
    });
    this.group.add(this.strings);

    // Visitors milling about.
    const N = 70;
    const person = mergeParts([tint(at(new THREE.CylinderGeometry(0.22, 0.26, 1.1, 6), 0, 0.55, 0), "#ffffff"), tint(at(new THREE.SphereGeometry(0.2, 6, 5), 0, 1.35, 0), "#d9a77e")]);
    this.people = new THREE.InstancedMesh(person, vmat(0.8, 0), N);
    this.people.castShadow = true;
    const clothes = ["#2f5f9e", "#c43a32", "#f2c230", "#3a8f6a", "#e9e6df", "#7d4fa3", "#ff8a3d"];
    for (let i = 0; i < N; i++) {
      const p = this.freeSpot();
      const q = this.freeSpot();
      this.crowd.push({ x: p.x, z: p.z, tx: q.x, tz: q.z, v: 0.9 + Math.random() * 0.6, c: new THREE.Color(clothes[i % clothes.length]) });
    }
    this.group.add(this.people);
    this.group.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh && !(mm.material as THREE.Material).transparent) mm.castShadow = true;
    });
  }

  /** Somewhere on the plaza clear of the rides. */
  private freeSpot() {
    for (;;) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 18;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x + 8, z - 2) < 6 && Math.abs(z - 2) < 3.5) continue; // wheel base
      if (Math.hypot(x - 9, z + 6) < 7.5) continue; // carousel
      if (Math.hypot(x - 8, z - 10) < 8) continue; // swing
      return { x, z };
    }
  }

  private buildWheel() {
    const R = 12;
    const hubY = 14;
    const steel = "#e8e4dc";
    const parts: Part[] = [];
    for (const zz of [-1.2, 1.2]) {
      parts.push(tint(at(new THREE.TorusGeometry(R, 0.18, 6, 64), 0, 0, zz), steel));
      parts.push(tint(at(new THREE.TorusGeometry(R * 0.55, 0.12, 6, 40), 0, 0, zz), steel));
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const sp = new THREE.BoxGeometry(0.1, R, 0.1);
        sp.translate(0, R / 2, 0);
        sp.rotateZ(a);
        sp.translate(0, 0, zz);
        parts.push(tint(sp, steel));
      }
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const bar = new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6).rotateX(Math.PI / 2);
      bar.translate(Math.cos(a) * R, Math.sin(a) * R, 0);
      parts.push(tint(bar, steel));
    }
    parts.push(tint(new THREE.CylinderGeometry(0.8, 0.8, 3.2, 12).rotateX(Math.PI / 2), "#c43a32"));
    const rim = new THREE.Mesh(mergeParts(parts), vmat(0.35, 0.6));
    this.wheel.add(rim);
    this.wheel.position.set(-8, hubY, 2);
    // A-frame legs.
    const legs: Part[] = [];
    for (const zz of [-2.2, 2.2]) {
      for (const s of [-1, 1]) {
        const len = Math.hypot(hubY, 7);
        const l = new THREE.BoxGeometry(0.45, len, 0.45);
        l.translate(0, len / 2, 0);
        l.rotateZ(s * Math.atan2(7, hubY));
        l.translate(s * 7, 0, zz);
        legs.push(tint(l, "#c43a32"));
      }
    }
    legs.push(tint(at(new THREE.BoxGeometry(5, 0.8, 4), 0, 0.4, 0), "#6e4a2e")); // boarding platform
    const frame = new THREE.Mesh(mergeParts(legs), vmat(0.5, 0.4));
    frame.position.set(-8, 0, 2);
    this.group.add(frame, this.wheel);

    // Gondolas hang from the rim and stay level.
    const gcols = ["#ff6b6b", "#ffd36b", "#6bd6ff", "#9dff6b"];
    for (let k = 0; k < 16; k++) {
      const g = mergeParts([
        tint(at(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 4), 0, -0.6, 0), "#888888"),
        tint(at(new THREE.CylinderGeometry(0.9, 0.7, 1.1, 8), 0, -1.7, 0), gcols[k % 4]),
        tint(at(new THREE.ConeGeometry(1.0, 0.5, 8), 0, -0.95, 0), "#f4f2ec"),
      ]);
      const o = new THREE.Mesh(g, vmat(0.5, 0.2));
      this.gondolas.push(o);
      this.group.add(o);
    }
    // Bulbs on the rim (chase lights).
    const bulb = tint(new THREE.SphereGeometry(0.2, 6, 4), "#ffffff");
    this.wheelBulbs = new THREE.InstancedMesh(bulb, this.bulbMat, 96);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 96; i++) {
      const a = (i / 48) * Math.PI * 2;
      const zz = i < 48 ? -1.35 : 1.35;
      this.wheelBulbs.setMatrixAt(i, m.makeTranslation(Math.cos(a) * (R + 0.25), Math.sin(a) * (R + 0.25), zz));
      this.wheelBulbs.setColorAt(i, new THREE.Color("#ffffff"));
    }
    this.wheel.add(this.wheelBulbs);
  }

  private buildCarousel() {
    const stripes: Part[] = [];
    const seg = 16;
    for (let k = 0; k < seg; k++) {
      const c = new THREE.ConeGeometry(7, 2.4, 2, 1, true, (k / seg) * Math.PI * 2, (Math.PI * 2) / seg);
      c.translate(0, 6.2, 0);
      stripes.push(tint(c, k % 2 ? "#f4f2ec" : "#d23b4a"));
      const v = new THREE.CylinderGeometry(7, 7, 0.7, 2, 1, true, (k / seg) * Math.PI * 2, (Math.PI * 2) / seg);
      v.translate(0, 4.65, 0);
      stripes.push(tint(v, k % 2 ? "#d23b4a" : "#f4f2ec"));
    }
    stripes.push(tint(at(new THREE.CylinderGeometry(6.8, 7, 0.5, 24), 0, 0.25, 0), "#8a5a33"));
    stripes.push(tint(at(new THREE.CylinderGeometry(0.8, 0.8, 4.4, 12), 0, 2.4, 0), "#e7c35a"));
    stripes.push(tint(at(new THREE.SphereGeometry(0.5, 8, 6), 0, 7.6, 0), "#e7c35a"));
    this.carousel.add(new THREE.Mesh(mergeParts(stripes), vmat(0.5, 0.2)));
    const hcols = ["#f4f2ec", "#3a3f44", "#c9a441", "#8a5a33"];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r = k % 2 ? 5.2 : 3.8;
      const horse = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.3, 6), new THREE.MeshStandardMaterial({ color: "#e7c35a", metalness: 0.8, roughness: 0.3 }));
      pole.position.y = 2.6;
      const body = new THREE.Mesh(
        mergeParts([
          tint(at(new THREE.BoxGeometry(0.5, 0.6, 1.5), 0, 0, 0), hcols[k % 4]),
          tint(at(new THREE.BoxGeometry(0.35, 0.8, 0.35), 0, 0.45, 0.7), hcols[k % 4]),
          tint(at(new THREE.BoxGeometry(0.3, 0.3, 0.55), 0, 0.85, 0.95), hcols[k % 4]),
          tint(at(new THREE.BoxGeometry(0.12, 0.8, 0.12), 0.15, -0.6, 0.5), hcols[k % 4]),
          tint(at(new THREE.BoxGeometry(0.12, 0.8, 0.12), -0.15, -0.6, -0.5), hcols[k % 4]),
          tint(at(new THREE.BoxGeometry(0.55, 0.1, 0.5), 0, 0.33, -0.1), "#c43a32"),
        ]),
        vmat(0.6, 0.1)
      );
      body.name = "horse";
      horse.add(pole, body);
      horse.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      horse.rotation.y = -a;
      this.horses.push(body);
      this.carousel.add(horse);
    }
    this.carousel.position.set(9, 0, -6);
    this.group.add(this.carousel);
  }

  private buildSwing() {
    const tower = new THREE.Mesh(
      mergeParts([
        tint(at(new THREE.CylinderGeometry(0.6, 1.0, 12, 10), 0, 6, 0), "#3a6fb0"),
        tint(at(new THREE.CylinderGeometry(2.6, 2.6, 0.6, 16), 0, 0.3, 0), "#2c2c30"),
      ]),
      vmat(0.4, 0.5)
    );
    tower.position.set(8, 0, 10);
    this.group.add(tower);
    const top = mergeParts([tint(at(new THREE.CylinderGeometry(5, 3.2, 1.2, 20), 0, 0, 0), "#ffd36b"), tint(at(new THREE.ConeGeometry(5.1, 1.6, 20), 0, 1.4, 0), "#d23b4a")]);
    this.swingTop.add(new THREE.Mesh(top, vmat(0.5, 0.2)));
    this.swingTop.position.set(8, 12.3, 10);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * 4.6, -0.5, Math.sin(a) * 4.6);
      pivot.rotation.y = -a;
      const arm = new THREE.Group();
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 5.5, 4), new THREE.MeshStandardMaterial({ color: "#9a9a9a", metalness: 0.9 }));
      chain.position.y = -2.75;
      const seat = new THREE.Mesh(tint(new THREE.BoxGeometry(0.7, 0.15, 0.6), ["#ff6b6b", "#6bd6ff", "#9dff6b"][k % 3]), vmat(0.5, 0.2));
      seat.position.y = -5.5;
      const rider = new THREE.Mesh(tint(at(new THREE.CylinderGeometry(0.18, 0.2, 0.8, 6), 0, 0.45, 0), "#2f5f9e"), vmat(0.8, 0));
      rider.position.y = -5.5;
      arm.add(chain, seat, rider);
      pivot.add(arm);
      this.chairs.push(arm);
      this.swingTop.add(pivot);
    }
    this.group.add(this.swingTop);
  }

  private buildStalls() {
    const cols = ["#d23b4a", "#3a8f6a", "#e0a22b", "#3a6fb0", "#7d4fa3"];
    for (let k = 0; k < 5; k++) {
      const a = Math.PI * 0.95 + (k / 5) * Math.PI * 0.75;
      const x = Math.cos(a) * 18.5;
      const z = Math.sin(a) * 18.5;
      const parts: Part[] = [tint(at(new THREE.BoxGeometry(3.4, 2.2, 2.4), 0, 1.1, 0), "#f4f2ec")];
      for (let s = 0; s < 6; s++) parts.push(tint(at(new THREE.BoxGeometry(0.58, 0.12, 3.0).rotateX(0.18), -1.45 + s * 0.58, 2.6, 0.3), s % 2 ? "#f4f2ec" : cols[k]));
      parts.push(tint(at(new THREE.BoxGeometry(3.4, 0.5, 0.3), 0, 1.0, 1.3), cols[k]));
      const stall = new THREE.Mesh(mergeParts(parts), vmat(0.7, 0));
      stall.position.set(x, 0, z);
      stall.rotation.y = -a - Math.PI / 2;
      this.group.add(stall);
    }
  }

  private runCycle(r: { speed: number; t: number }, dt: number, run: number, rest: number, top: number) {
    r.t = (r.t + dt) % (run + rest);
    const running = r.t < run;
    // Smooth spin-up and spin-down.
    const goal = running ? top : 0;
    r.speed += THREE.MathUtils.clamp(goal - r.speed, -dt * top * 0.35, dt * top * 0.35);
    return running ? (r.speed < top * 0.98 ? "Starting" : "Running") : r.speed > 0.01 ? "Slowing" : "Loading";
  }

  update(dt: number, night: number, t: number) {
    this.status.wheel = this.runCycle(this.rides.wheel, dt, 70, 18, 0.11);
    this.status.carousel = this.runCycle(this.rides.carousel, dt, 40, 14, 0.55);
    this.status.swing = this.runCycle(this.rides.swing, dt, 32, 18, 1.05);
    this.wheelAngle += this.rides.wheel.speed * dt;
    this.wheel.rotation.z = this.wheelAngle;
    const R = 12;
    this.gondolas.forEach((g, k) => {
      const a = (k / 16) * Math.PI * 2 + this.wheelAngle;
      g.position.set(-8 + Math.cos(a) * R, 14 + Math.sin(a) * R, 2);
      g.rotation.z = Math.sin(t * 1.3 + k) * 0.04 * (this.rides.wheel.speed / 0.11);
    });
    this.carAngle += this.rides.carousel.speed * dt;
    this.carousel.rotation.y = this.carAngle;
    this.horses.forEach((h, k) => (h.position.y = 1.6 + Math.sin(this.carAngle * 3 + k * 1.7) * 0.45 * Math.min(1, this.rides.carousel.speed / 0.3)));
    this.swingAngle += this.rides.swing.speed * dt;
    this.swingTop.rotation.y = this.swingAngle;
    // Chairs fly outwards with speed (tan θ = ω² r / g).
    const w = this.rides.swing.speed;
    const tilt = Math.atan((w * w * 6.5) / 9.81);
    this.swingTop.rotation.z = Math.sin(this.swingAngle * 0.5) * 0.05 * (w / 1.05);
    for (const c of this.chairs) c.rotation.z = tilt;

    // Lights: a chase on the wheel, twinkle on the festoons — always a little lit, bright at night.
    const k = 0.5 + night * 2.8;
    const col = new THREE.Color();
    for (let i = 0; i < 96; i++) {
      const chase = (Math.floor(t * 8) + i) % 6 < 3 ? 1 : 0.35;
      col.setHSL(((i % 48) / 48 + t * 0.05) % 1, 0.9, 0.6).multiplyScalar(k * chase);
      this.wheelBulbs.setColorAt(i, col);
    }
    if (this.wheelBulbs.instanceColor) this.wheelBulbs.instanceColor.needsUpdate = true;
    this.bulbMat.color.setScalar(1);
    const sm = this.strings.material as THREE.MeshBasicMaterial;
    sm.color.setScalar(1);
    this.strings.instanceColor?.array && this.twinkle(t, k);

    // Crowd: walk to a random spot, pause, pick another. More visitors in the evening.
    const target = Math.round(this.crowd.length * (0.45 + 0.55 * THREE.MathUtils.smoothstep(night, 0.1, 0.6)));
    const m = new THREE.Object3D();
    let shown = 0;
    for (let i = 0; i < this.crowd.length; i++) {
      const p = this.crowd[i];
      if (i >= target) continue;
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) {
        if (Math.random() < dt * 0.25) {
          const q = this.freeSpot();
          p.tx = q.x;
          p.tz = q.z;
        }
      } else {
        p.x += (dx / d) * p.v * dt;
        p.z += (dz / d) * p.v * dt;
      }
      m.position.set(p.x, Math.abs(Math.sin(t * 7 + i)) * 0.05 * (d > 0.3 ? 1 : 0), p.z);
      m.rotation.y = Math.atan2(dx, dz);
      m.updateMatrix();
      this.people.setMatrixAt(shown, m.matrix);
      this.people.setColorAt(shown, p.c);
      shown++;
    }
    this.people.count = shown;
    this.people.instanceMatrix.needsUpdate = true;
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
    this.status.visitors = shown * 9;
  }

  private base?: Float32Array;
  private twinkle(t: number, k: number) {
    const ic = this.strings.instanceColor!;
    if (!this.base) this.base = Float32Array.from(ic.array as Float32Array);
    const a = ic.array as Float32Array;
    for (let i = 0; i < a.length / 3; i++) {
      const f = k * (0.8 + 0.2 * Math.sin(t * 3 + i * 1.7));
      a[i * 3] = this.base[i * 3] * f;
      a[i * 3 + 1] = this.base[i * 3 + 1] * f;
      a[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    ic.needsUpdate = true;
  }
}

/* ================================================================= boats */

class Boats {
  group = new THREE.Group();
  private boats: { obj: THREE.Group; path: THREE.Vector3[]; u: number; dir: number; speed: number; oars: THREE.Object3D[]; lantern: THREE.PointLight; seed: number }[] = [];
  private lanternMat: THREE.MeshBasicMaterial;
  private waterY = -1.5;

  constructor(private engine: CityEngine) {
    this.lanternMat = new THREE.MeshBasicMaterial({ color: "#ffb44d", toneMapped: false });
    // River centreline from the water surface itself.
    const water = engine.meshesWith("m_water");
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const centre: THREE.Vector3[] = [];
    for (let z = -168; z <= 50; z += 6) {
      const xs: number[] = [];
      let y = -1.5;
      for (let x = -175; x <= -66; x += 2) {
        ray.set(new THREE.Vector3(x, 40, z), down);
        const hit = water.length ? ray.intersectObjects(water, false)[0] : undefined;
        if (hit) {
          xs.push(x);
          y = hit.point.y;
        }
      }
      if (xs.length >= 4) centre.push(new THREE.Vector3((xs[0] + xs[xs.length - 1]) / 2, y, z));
    }
    if (centre.length) this.waterY = centre.reduce((a, p) => a + p.y, 0) / centre.length;
    const path = centre.length > 6 ? centre : [new THREE.Vector3(-122, this.waterY, -165), new THREE.Vector3(-122, this.waterY, 48)];

    // Rowing boats with a lantern each, on stretches of the river.
    const reaches: [number, number][] = [[0.05, 0.42], [0.5, 0.7], [0.76, 0.97]];
    reaches.forEach(([a, b], i) => {
      const n = path.length - 1;
      const seg = path.slice(Math.floor(a * n), Math.max(Math.floor(a * n) + 2, Math.ceil(b * n) + 1));
      const lateral = (i % 2 ? 1 : -1) * 5;
      const off = seg.map((p, k) => {
        const q = seg[Math.min(seg.length - 1, k + 1)];
        const r = seg[Math.max(0, k - 1)];
        const dx = q.x - r.x;
        const dz = q.z - r.z;
        const l = Math.hypot(dx, dz) || 1;
        return new THREE.Vector3(p.x + (dz / l) * lateral, p.y, p.z - (dx / l) * lateral);
      });
      this.boats.push(this.makeRowboat(off, i));
    });
  }

  private makeRowboat(path: THREE.Vector3[], i: number) {
    const g = new THREE.Group();
    const wood = "#8a5a33";
    const dark = "#5c3a20";
    // Hull: a box pinched to points fore and aft, with a sheer line.
    const hull = new THREE.BoxGeometry(1.6, 0.6, 4.4, 1, 1, 8);
    const p = hull.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const z = p.getZ(k) / 2.2;
      const pinch = 1 - Math.abs(z) ** 2.2;
      p.setX(k, p.getX(k) * (0.15 + 0.85 * pinch) * (p.getY(k) < 0 ? 0.7 : 1));
      p.setY(k, p.getY(k) + Math.abs(z) ** 2 * 0.25 * (p.getY(k) > 0 ? 1 : 0));
    }
    hull.computeVertexNormals();
    const parts: Part[] = [tint(at(hull, 0, 0.3, 0), wood)];
    parts.push(tint(at(new THREE.BoxGeometry(1.3, 0.06, 0.35), 0, 0.5, 0.2), dark));
    parts.push(tint(at(new THREE.BoxGeometry(1.1, 0.06, 0.35), 0, 0.5, -1.2), dark));
    parts.push(tint(at(new THREE.BoxGeometry(0.06, 1.3, 0.06), 0, 1.15, 1.9), dark)); // lantern post
    parts.push(tint(at(new THREE.BoxGeometry(0.4, 0.06, 0.06), 0, 1.8, 1.9), dark));
    // Rower.
    parts.push(tint(at(new THREE.CylinderGeometry(0.22, 0.26, 0.7, 6), 0, 0.9, 0.1), ["#2f5f9e", "#c43a32", "#3a8f6a"][i % 3]));
    parts.push(tint(at(new THREE.SphereGeometry(0.18, 6, 5), 0, 1.4, 0.1), "#d9a77e"));
    parts.push(tint(at(new THREE.ConeGeometry(0.28, 0.2, 8), 0, 1.58, 0.1), "#d8c48a"));
    const body = new THREE.Mesh(mergeParts(parts), vmat(0.85, 0));
    body.castShadow = true;
    g.add(body);
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), this.lanternMat);
    lantern.position.set(0.2, 1.62, 1.9);
    g.add(lantern);
    const light = new THREE.PointLight("#ffb44d", 0, 16, 2);
    light.position.copy(lantern.position);
    g.add(light);
    const oars: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.75, 0.75, 0.05);
      const oar = new THREE.Mesh(mergeParts([tint(at(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5).rotateZ(Math.PI / 2), s * 1.1, 0, 0), dark), tint(at(new THREE.BoxGeometry(0.6, 0.04, 0.2), s * 2.3, 0, 0), wood)]), vmat(0.8, 0));
      pivot.add(oar);
      g.add(pivot);
      oars.push(pivot);
    }
    this.group.add(g);
    return { obj: g, path, u: Math.random(), dir: 1, speed: 0.9 + i * 0.15, oars, lantern: light, seed: i * 2.3 };
  }

  update(dt: number, night: number, t: number) {
    this.lanternMat.color.setRGB(0.6 + night * 3.2, 0.4 + night * 2, 0.15 + night * 0.6);
    for (const b of this.boats) {
      const n = b.path.length - 1;
      if (n < 1) continue;
      const len = n * 6;
      b.u += (b.dir * b.speed * dt) / len;
      if (b.u > 1 || b.u < 0) {
        b.dir *= -1;
        b.u = THREE.MathUtils.clamp(b.u, 0, 1);
      }
      const f = b.u * n;
      const i = Math.min(n - 1, Math.floor(f));
      const p = b.path[i].clone().lerp(b.path[i + 1], f - i);
      const d = b.path[i + 1].clone().sub(b.path[i]).multiplyScalar(b.dir);
      b.obj.position.set(p.x, p.y - 0.1 + Math.sin(t * 1.4 + b.seed) * 0.06, p.z);
      const yaw = Math.atan2(d.x, d.z);
      let dy = yaw - b.obj.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.obj.rotation.y += dy * Math.min(1, dt * 0.8);
      b.obj.rotation.z = Math.sin(t * 1.1 + b.seed) * 0.04;
      b.obj.rotation.x = Math.sin(t * 0.9 + b.seed) * 0.02;
      // Rowing stroke.
      const stroke = t * 1.6 + b.seed;
      b.oars.forEach((o, k) => {
        o.rotation.y = (k ? -1 : 1) * Math.sin(stroke) * 0.5;
        o.rotation.z = (k ? 1 : -1) * (0.25 + Math.cos(stroke) * 0.15);
      });
      b.lantern.intensity = night * 14;
      b.lantern.visible = night > 0.15; // no per-pixel light cost by day
    }
    // River ferry from the city model: cruise with a gentle bob.
    const ferry = this.engine.boat;
    if (ferry) {
      const s = Math.sin(t * 0.05);
      ferry.position.z = -60 + s * 95;
      ferry.rotation.y = Math.cos(t * 0.05) >= 0 ? Math.PI : 0;
      ferry.rotation.z = Math.sin(t * 0.8) * 0.015;
    }
  }
}

/* ================================================================= birds */

class Birds {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private flocks: { cx: number; cz: number; r: number; h: number; speed: number; phase: number; members: { dx: number; dy: number; dz: number; f: number }[] }[] = [];

  constructor() {
    // Two wings with raised tips; scaling y flips them between up and down strokes.
    const g = new THREE.BufferGeometry();
    const v = new Float32Array([0, 0, 0.35, 0, 0, -0.3, 1.1, 0.4, -0.1, 0, 0, 0.35, -1.1, 0.4, -0.1, 0, 0, -0.3]);
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    let total = 0;
    const defs = [
      { cx: -120, cz: -60, r: 140, h: 48, speed: 0.07 },
      { cx: 0, cz: -160, r: 110, h: 62, speed: -0.09 },
      { cx: -200, cz: -10, r: 90, h: 40, speed: 0.11 },
      { cx: 80, cz: 40, r: 160, h: 70, speed: -0.06 },
    ];
    for (const d of defs) {
      const n = 9 + Math.floor(Math.random() * 8);
      const members = [];
      for (let i = 0; i < n; i++) members.push({ dx: (Math.random() - 0.5) * 18, dy: (Math.random() - 0.5) * 5, dz: (Math.random() - 0.5) * 18, f: Math.random() * 6 });
      this.flocks.push({ ...d, phase: Math.random() * 6, members });
      total += n;
    }
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: "#1e2226", side: THREE.DoubleSide }), total);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  update(dt: number, night: number, t: number) {
    // Birds roost at night.
    this.group.visible = night < 0.7;
    if (!this.group.visible) return;
    const m = new THREE.Object3D();
    let i = 0;
    for (const f of this.flocks) {
      f.phase += f.speed * dt;
      const a = f.phase;
      // A wandering loop (lissajous) rather than a perfect circle.
      const cx = f.cx + Math.cos(a) * f.r + Math.sin(a * 2.3) * 25;
      const cz = f.cz + Math.sin(a) * f.r * 0.7 + Math.cos(a * 1.7) * 20;
      const cy = f.h + Math.sin(a * 3) * 6;
      const yaw = Math.atan2(-Math.sin(a) * f.r * Math.sign(f.speed), Math.cos(a) * f.r * 0.7 * Math.sign(f.speed));
      for (const b of f.members) {
        const wob = t * 0.7 + b.f;
        m.position.set(cx + b.dx + Math.sin(wob) * 2, cy + b.dy + Math.sin(wob * 1.3) * 1, cz + b.dz + Math.cos(wob) * 2);
        m.rotation.set(0, yaw + Math.sin(wob) * 0.15, Math.sin(wob * 0.8) * 0.2);
        const flap = Math.sin(t * 11 + b.f * 3);
        m.scale.set(0.9, flap * 1.1, 0.9);
        m.updateMatrix();
        this.mesh.setMatrixAt(i++, m.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ======================================================== open horizon */

class Horizon {
  group = new THREE.Group();
  private ships: { obj: THREE.Object3D; a: number; r: number; speed: number }[] = [];
  private beam: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private aviation: THREE.MeshBasicMaterial;
  private aviationLamps: THREE.Object3D[] = [];
  private shipLights: THREE.MeshBasicMaterial;

  constructor() {
    // Distant islands and headlands fading into the haze.
    let seed = 99;
    const rnd = () => ((seed = (16807 * seed) % 0x7fffffff) - 1) / 0x7ffffffe;
    const islandMat = new THREE.MeshStandardMaterial({ color: "#6f8f62", roughness: 1, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: "#8d8577", roughness: 1, flatShading: true });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rnd() * 0.3;
      const r = 650 + rnd() * 500;
      const w = 50 + rnd() * 140;
      const h = 14 + rnd() * 55;
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const p = geo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const n = 0.75 + rnd() * 0.5;
        p.setXYZ(i, p.getX(i) * w * n, Math.max(-0.2, y) * h * n, p.getZ(i) * w * 0.7 * n);
      }
      geo.computeVertexNormals();
      const isl = new THREE.Mesh(geo, k % 3 ? islandMat : rockMat);
      isl.position.set(CENTER[0] + Math.cos(a) * r, -8.5, CENTER[2] + Math.sin(a) * r);
      isl.rotation.y = rnd() * Math.PI;
      this.group.add(isl);
    }

    // Lighthouse on a headland with a sweeping beam.
    const lh = new THREE.Group();
    const tower = mergeParts([
      tint(at(new THREE.CylinderGeometry(2.2, 3.2, 22, 12), 0, 11, 0), "#f4f2ec"),
      tint(at(new THREE.CylinderGeometry(2.25, 2.6, 3, 12), 0, 7, 0), "#c43a32"),
      tint(at(new THREE.CylinderGeometry(2.25, 2.35, 3, 12), 0, 15, 0), "#c43a32"),
      tint(at(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 12), 0, 22.2, 0), "#2c2c30"),
      tint(at(new THREE.ConeGeometry(2.0, 2.2, 12), 0, 25.5, 0), "#2c2c30"),
    ]);
    lh.add(new THREE.Mesh(tower, vmat(0.6, 0.1)));
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(16, 1), rockMat);
    rock.scale.set(1.3, 0.5, 1);
    lh.add(rock);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.8, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.2), toneMapped: false }));
    lamp.position.y = 23.5;
    lh.add(lamp);
    this.beamMat = new THREE.MeshBasicMaterial({ color: "#fff2c8", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const bg = new THREE.ConeGeometry(14, 260, 16, 1, true);
    bg.translate(0, -130, 0);
    bg.rotateZ(Math.PI / 2);
    this.beam = new THREE.Mesh(bg, this.beamMat);
    this.beam.position.y = 23.5;
    lh.add(this.beam);
    lh.position.set(CENTER[0] + 330, -7, CENTER[2] + 360);
    this.group.add(lh);

    // Ships on the horizon.
    this.shipLights = new THREE.MeshBasicMaterial({ color: "#ffe3a0", toneMapped: false });
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Group();
      const hull = mergeParts([
        tint(at(new THREE.BoxGeometry(9, 4, 60), 0, 2, 0), ["#2c3e50", "#7a2020", "#1f3b2b", "#3a3f44"][k]),
        tint(at(new THREE.BoxGeometry(8, 7, 9), 0, 7.5, -22), "#f4f2ec"),
        tint(at(new THREE.BoxGeometry(8.5, 3.5, 34), 0, 5.75, 6), ["#d9a441", "#2f5f9e", "#c43a32", "#6b7f4a"][k]), // containers
        tint(at(new THREE.CylinderGeometry(0.9, 1.1, 5, 8), 0, 13, -22), "#2c2c30"),
      ]);
      s.add(new THREE.Mesh(hull, vmat(0.8, 0.2)));
      const win = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.8, 9.2), this.shipLights);
      win.position.set(0, 9, -22);
      s.add(win);
      this.group.add(s);
      this.ships.push({ obj: s, a: k * 1.6, r: 900 + k * 90, speed: (k % 2 ? 1 : -1) * 0.006 });
    }

    // Red aviation warning lights on the tallest towers.
    this.aviation = new THREE.MeshBasicMaterial({ color: "#ff2010", toneMapped: false });
    for (const p of PLACES.filter((pl) => pl.height >= 45)) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), this.aviation);
      m.position.set(p.x, p.height + 1.2, p.z);
      this.aviationLamps.push(m);
      this.group.add(m);
    }
  }

  update(dt: number, night: number, t: number) {
    for (const s of this.ships) {
      s.a += s.speed * dt;
      s.obj.position.set(CENTER[0] + Math.cos(s.a) * s.r, -8.4 + Math.sin(t * 0.4 + s.a) * 0.3, CENTER[2] + Math.sin(s.a) * s.r);
      s.obj.rotation.y = Math.atan2(-Math.sin(s.a) * Math.sign(s.speed), Math.cos(s.a) * Math.sign(s.speed));
    }
    this.beam.rotation.y = t * 0.6;
    this.beamMat.opacity = night * 0.16;
    this.shipLights.color.setScalar(0.3 + night * 2.5);
    const blink = Math.sin(t * Math.PI) > 0.2;
    this.aviation.color.setRGB(blink ? 1 + night * 3 : 0.2, blink ? 0.1 + night * 0.3 : 0.02, 0.05);
  }
}

/* ================================================================ world */

export class CityLife {
  lamps: StreetLamps;
  train: SteamTrain;
  airliner: Airliner | null = null;
  fair: Fairground;
  boats: Boats;
  birds: Birds;
  horizon: Horizon;
  crossings: LevelCrossing[] = [];
  root = new THREE.Group();

  constructor(private engine: CityEngine, traffic: Traffic3D) {
    this.root.name = "city-life";
    engine.scene.add(this.root);
    this.lamps = new StreetLamps(traffic);
    this.train = new SteamTrain(this.root);
    this.fair = new Fairground(engine);
    this.boats = new Boats(engine);
    this.birds = new Birds();
    this.horizon = new Horizon();
    this.root.add(this.lamps.group, this.train.group, this.fair.group, this.boats.group, this.birds.group, this.horizon.group);
    if (engine.plane) {
      this.airliner = new Airliner(engine.plane);
      this.root.add(this.airliner.group);
    }
    engine.externalMotion = true;

    // Level crossings wherever a road crosses the railway.
    for (const e of traffic.edges) {
      const a = traffic.nodes[e.from];
      const b = traffic.nodes[e.to];
      if ((a.y - RAIL.z) * (b.y - RAIL.z) >= 0) continue;
      const f = (RAIL.z - a.y) / (b.y - a.y);
      const x = a.x + (b.x - a.x) * f;
      if (x < RAIL.x0 + 5 || x > RAIL.x1 - 5) continue;
      const s = f * e.length;
      traffic.addCrossing(e.id, s);
      if (e.from < e.to) {
        const lc = new LevelCrossing(x, traffic.heightAt(e.id, s));
        this.crossings.push(lc);
        this.root.add(lc.group);
        this.train.crossings.push({ x, closed: false, onChange: (closed) => {
          lc.closed = closed;
          traffic.setCrossingClosed(x, closed);
        } });
      }
    }
    engine.onFrame.add(this.frame);
  }

  private frame = (dt: number, t: number) => {
    const n = this.engine.night;
    this.lamps.update(n, t);
    this.train.update(dt, n, t);
    this.airliner?.update(dt, n, t);
    this.fair.update(dt, n, t);
    this.boats.update(dt, n, t);
    this.birds.update(dt, n, t);
    this.horizon.update(dt, n, t);
    for (const c of this.crossings) c.update(dt, t);
  };

  status() {
    return {
      train: this.train.status,
      plane: this.airliner?.status ?? "—",
      fair: this.fair.status,
      lamps: this.lamps.count,
      crossingClosed: this.crossings.some((c) => c.closed),
    };
  }

  dispose() {
    this.engine.onFrame.delete(this.frame);
    this.engine.externalMotion = false;
    this.root.removeFromParent();
  }
}
