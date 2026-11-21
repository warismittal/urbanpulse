/**
 * Smart-city overlays for the 3D city: emergency scenarios (fire, flood,
 * accident, gas leak, earthquake, evacuation), CCTV poles, air-quality
 * pillars and facility pins.
 */
import * as THREE from "three";
import { CCTV_NODES, PLACES, RIVER, placeById, type Place } from "./config";
import { PLUME_FRAG, PLUME_VERT } from "./shaders";
import type { CityEngine } from "./engine";
import type { Traffic3D, Unit3 } from "./traffic3d";

/* ------------------------------------------------------------ textures */

function radialTexture(inner: string, outer: string, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pinTexture(letter: string, bg: string) {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 120;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.strokeStyle = "#ffffff";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(48, 46, 38, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(32, 80);
  g.lineTo(48, 114);
  g.lineTo(64, 80);
  g.closePath();
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = "bold 44px Inter, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, 48, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------ particles */

class Puffs {
  sprites: THREE.Sprite[] = [];
  private life: number[] = [];
  constructor(
    parent: THREE.Object3D,
    private n: number,
    tex: THREE.Texture,
    private opts: { color: string; size: [number, number]; rise: number; drift: THREE.Vector2; life: number; spread: number; opacity: number; additive?: boolean }
  ) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, color: opts.color, transparent: true, depthWrite: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: 0, fog: true })
      );
      parent.add(s);
      this.sprites.push(s);
      this.life.push(Math.random() * opts.life);
    }
  }
  update(dt: number, origin: THREE.Vector3, rate = 1) {
    const o = this.opts;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      const s = this.sprites[i];
      if (this.life[i] > o.life) {
        this.life[i] = 0;
        s.position.set(origin.x + (Math.random() - 0.5) * o.spread, origin.y, origin.z + (Math.random() - 0.5) * o.spread);
        s.visible = Math.random() < rate;
      }
      const k = this.life[i] / o.life;
      s.position.y += o.rise * dt;
      s.position.x += o.drift.x * dt * (0.4 + k);
      s.position.z += o.drift.y * dt * (0.4 + k);
      const size = o.size[0] + (o.size[1] - o.size[0]) * k;
      s.scale.set(size, size, 1);
      (s.material as THREE.SpriteMaterial).opacity = o.opacity * Math.sin(Math.PI * Math.min(1, k * 1.15));
    }
  }
  dispose() {
    for (const s of this.sprites) {
      s.removeFromParent();
      (s.material as THREE.SpriteMaterial).dispose();
    }
  }
}

/* ------------------------------------------------------------ scenarios */

export type ScenarioKind3 = "fire" | "flood" | "accident" | "gas" | "earthquake" | "evacuation";

export interface ScenarioStatus {
  kind: ScenarioKind3;
  title: string;
  elapsed: number; // scenario seconds
  phase: string;
  metrics: { label: string; value: string; tone?: "good" | "warn" | "bad" }[];
  units: { label: string; status: string; eta?: number }[];
  log: { t: number; text: string }[];
  advice: string;
}

const TIME_SCALE = 6; // scenario seconds per real second

export class ScenarioDirector {
  active: ScenarioKind3 | null = null;
  status: ScenarioStatus | null = null;
  windFrom = 135; // degrees, wind blowing from the south-east across downtown
  windSpeed = 2.5;

  private group = new THREE.Group();
  private t = 0;
  private puffs: Puffs[] = [];
  private tick: ((dt: number) => void) | null = null;
  private cleanups: (() => void)[] = [];
  private units: Unit3[] = [];
  private log: { t: number; text: string }[] = [];
  private smokeTex = radialTexture("rgba(255,255,255,0.9)", "rgba(255,255,255,0)");
  private fireTex = radialTexture("rgba(255,240,200,1)", "rgba(255,120,20,0)");

  constructor(private engine: CityEngine, private traffic: Traffic3D) {
    engine.layers.incidents.add(this.group);
    engine.onFrame.add(this.frame);
  }

  dispose() {
    this.stop();
    this.engine.onFrame.delete(this.frame);
    this.group.removeFromParent();
  }

  private frame = (dt: number) => {
    if (!this.active) return;
    this.t += dt * TIME_SCALE;
    this.tick?.(dt);
  };

  private windVec() {
    const to = ((this.windFrom + 180) * Math.PI) / 180;
    return new THREE.Vector2(Math.sin(to), -Math.cos(to));
  }

  private say(text: string) {
    if (this.log.some((l) => l.text === text)) return;
    this.log.unshift({ t: this.t, text });
  }

  private send(kind: Unit3["kind"], label: string, from: Place, to: { x: number; z: number }, onArrive?: () => void) {
    const u = this.traffic.dispatch(kind, label, from.x, from.z, to.x, to.z, onArrive);
    if (u) this.units.push(u);
    return u;
  }

  stop() {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    for (const p of this.puffs) p.dispose();
    this.puffs = [];
    this.group.clear();
    this.tick = null;
    this.active = null;
    this.status = null;
    this.units = [];
    this.log = [];
    this.engine.setFlood(0);
  }

  start(kind: ScenarioKind3, opts: { level?: number; x?: number; z?: number } = {}) {
    this.stop();
    this.active = kind;
    this.t = 0;
    const level = opts.level ?? 2;
    const builders: Record<ScenarioKind3, () => void> = {
      fire: () => this.fire(level),
      flood: () => this.flood(level),
      accident: () => this.accident(level),
      gas: () => this.gas(level),
      earthquake: () => this.earthquake(level),
      evacuation: () => this.evacuation(level),
    };
    builders[kind]();
  }

  private unitRows() {
    return this.units.map((u) => ({
      label: `${u.label}`,
      status: u.done ? "On scene" : "En route",
      eta: u.done ? undefined : Math.max(0, Math.round((this.traffic.edges[u.car.edge].length - u.car.s) / 10)),
    }));
  }

  private setStatus(s: Omit<ScenarioStatus, "kind" | "elapsed" | "units" | "log">) {
    this.status = { ...s, kind: this.active!, elapsed: this.t, units: this.unitRows(), log: this.log.slice(0, 8) };
  }

  /* -------------------------------------------------------------- fire */

  private fire(level: number) {
    const b = placeById("apex");
    const top = new THREE.Vector3(b.x, b.height * (level === 1 ? 0.45 : level === 2 ? 0.7 : 0.95), b.z);
    const light = new THREE.PointLight("#ff7a1a", 0, 90, 1.6);
    light.position.copy(top).add(new THREE.Vector3(0, 3, 0));
    this.group.add(light);
    const flames = new Puffs(this.group, 40, this.fireTex, { color: "#ffb347", size: [3, 9], rise: 5, drift: new THREE.Vector2(0, 0), life: 1.2, spread: 7, opacity: 0.95, additive: true });
    const w = this.windVec().multiplyScalar(this.windSpeed * 2.2);
    const smoke = new Puffs(this.group, 70, this.smokeTex, { color: "#5b5654", size: [8, 34], rise: 6, drift: w, life: 9, spread: 8, opacity: 0.55 });
    this.puffs.push(flames, smoke);
    const station = placeById("fire");
    const hospital = placeById("hospital");
    let attackAt = Infinity;
    this.say(`Smoke alarm — ${b.name}, fire on upper floors`);
    this.send("fire", "Fire tender 1", station, b, () => {
      attackAt = this.t;
      this.say("Fire tender on scene, aerial ladder up");
    });
    setTimeout(() => this.active === "fire" && this.send("fire", "Fire tender 2", station, b), 1500);
    setTimeout(() => this.active === "fire" && this.send("ambulance", "Ambulance", hospital, b), 800);
    setTimeout(() => this.active === "fire" && this.send("police", "Police cordon", placeById("police"), b), 1200);
    this.engine.rig.flyTo(b.x, b.z, 170, 1.0);
    const occupants = Math.round(b.height / 3.2) * 16;
    this.tick = (dt) => {
      const since = this.t - attackAt;
      const growth = Math.min(1, this.t / 240);
      const intensity = since > 0 ? Math.max(0.05, growth * (1 - since / 420)) : growth;
      light.intensity = 900 * intensity * (0.75 + Math.random() * 0.5);
      flames.update(dt, top, intensity);
      smoke.update(dt, top.clone().add(new THREE.Vector3(0, 4, 0)), Math.min(1, intensity * 1.4 + 0.15));
      const evacuated = Math.round(occupants * (1 - Math.exp(-this.t / 220)));
      if (since > 420) this.say("Fire under control; damping down");
      this.setStatus({
        title: `Fire · ${b.name}`,
        phase: since > 420 ? "Under control" : since > 0 ? "Crews fighting fire" : "Growing — crews en route",
        metrics: [
          { label: "Fire size", value: `${Math.round(intensity * 100)}%`, tone: intensity > 0.6 ? "bad" : intensity > 0.2 ? "warn" : "good" },
          { label: "Evacuated", value: `${evacuated} / ${occupants}`, tone: evacuated / occupants > 0.95 ? "good" : "warn" },
          { label: "First response", value: Number.isFinite(attackAt) ? `${(attackAt / 60).toFixed(1)} min` : "—" },
        ],
        advice: "Residents downwind: shut windows. Keep Airport Road clear for fire tenders.",
      });
    };
  }

  /* ------------------------------------------------------------- flood */

  private flood(level: number) {
    const peak = level === 1 ? 0.7 : level === 2 ? 1.4 : 2.2;
    const W = RIVER.x1 - RIVER.x0 + 150;
    const D = RIVER.z1 - RIVER.z0 + 60;
    const alpha = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 128, 0);
      grad.addColorStop(0, "#000");
      grad.addColorStop(0.18, "#fff");
      grad.addColorStop(0.82, "#fff");
      grad.addColorStop(1, "#000");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const mat = new THREE.MeshStandardMaterial({ color: "#6f6a52", roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82, alphaMap: alpha, depthWrite: false });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 1, 1), mat);
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set((RIVER.x0 + RIVER.x1) / 2 + 10, -1.5, (RIVER.z0 + RIVER.z1) / 2);
    sheet.renderOrder = 3;
    this.group.add(sheet);
    const closed = new Set<number>();
    this.cleanups.push(() => this.traffic.setBlocked([...closed], false));
    this.say("Red alert: very heavy rain; river rising");
    this.engine.rig.flyTo(-120, -60, 320, 0.9);
    const pump = placeById("fire");
    let pumps = false;
    this.tick = () => {
      const rise = Math.min(1, this.t / 900);
      const easing = pumps ? Math.max(0.55, 1 - (this.t - 1200) / 3000) : 1;
      const lvl = -1.5 + (peak + 1.5) * rise * easing;
      sheet.position.y = lvl;
      sheet.visible = lvl > -1.2;
      this.engine.setFlood(rise);
      // Close roads under more than 30 cm of water.
      for (const e of this.traffic.edges) {
        const a = this.traffic.nodes[e.from];
        const midX = a.x + e.dir.x * e.length * 0.5;
        const midZ = a.y + e.dir.y * e.length * 0.5;
        const inside = midX > sheet.position.x - W / 2 + 10 && midX < sheet.position.x + W / 2 - 10 && midZ > RIVER.z0 - 20 && midZ < RIVER.z1 + 20;
        const under = inside && lvl - this.traffic.heightAt(e.id, e.length / 2) > 0.3;
        if (under && !closed.has(e.id)) {
          closed.add(e.id);
          this.traffic.setBlocked([e.id], true);
          this.say(`${e.name} closed — water on the road`);
        }
      }
      if (this.t > 600 && !pumps) {
        pumps = true;
        this.send("fire", "Dewatering pumps", pump, { x: -70, z: -40 });
        this.say("Pumps dispatched to the east bank");
      }
      this.setStatus({
        title: "Flooding · River corridor",
        phase: rise < 1 ? "Water rising" : pumps ? "Pumping, level easing" : "Peak",
        metrics: [
          { label: "Water above banks", value: `${Math.max(0, lvl).toFixed(2)} m`, tone: lvl > 0.5 ? "bad" : lvl > 0 ? "warn" : "good" },
          { label: "Roads closed", value: String(Math.round(closed.size / 2)), tone: closed.size ? "warn" : "good" },
          { label: "Shelters open", value: "Forest Lodge, Community Hall" },
        ],
        advice: "Do not drive through flood water. Riverside residents move to upper floors or the nearest shelter.",
      });
    };
  }

  /* ---------------------------------------------------------- accident */

  private accident(level: number) {
    const tr = this.traffic;
    const e = tr.edges.find((x) => x.name === "Market Street" && x.length > 15) ?? tr.edges[0];
    const twin = tr.edges.find((x) => x.from === e.to && x.to === e.from);
    const block = level >= 2 && twin ? [e.id, twin.id] : [e.id];
    tr.setBlocked(block, true);
    this.cleanups.push(() => tr.setBlocked(block, false));
    const a = tr.nodes[e.from];
    const mid = new THREE.Vector3(a.x + e.dir.x * e.length * 0.5, tr.heightAt(e.id, e.length / 2), a.y + e.dir.y * e.length * 0.5);
    const tpl = this.engine.carTemplate;
    for (const [dx, dz, rot] of [
      [1.2, -1, 0.6],
      [-1.5, 2.2, -0.9],
    ] as const) {
      const car = tpl ? tpl.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4.5), new THREE.MeshStandardMaterial({ color: "#888" }));
      car.position.set(mid.x + dx, mid.y, mid.z + dz);
      car.rotation.y = Math.atan2(e.dir.x, e.dir.y) + rot;
      this.group.add(car);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7.2, 40), new THREE.MeshBasicMaterial({ color: "#ff3b30", transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(mid).add(new THREE.Vector3(0, 0.2, 0));
    this.group.add(ring);
    const clearAt = (level === 1 ? 15 : level === 2 ? 30 : 50) * 60;
    this.say(`Collision detected by CCTV on ${e.name}`);
    this.send("ambulance", "Ambulance (ALS)", placeById("hospital"), { x: mid.x, z: mid.z });
    this.send("police", "Traffic police", placeById("police"), { x: mid.x, z: mid.z });
    if (level >= 2) this.send("fire", "Rescue tender", placeById("fire"), { x: mid.x, z: mid.z });
    this.engine.rig.flyTo(mid.x, mid.z, 120, 0.95);
    let cleared = false;
    this.tick = () => {
      const p = 1 + 0.15 * Math.sin(this.t * 0.8);
      ring.scale.setScalar(p);
      if (!cleared && this.t > clearAt) {
        cleared = true;
        tr.setBlocked(block, false);
        this.say("Road reopened");
        ring.visible = false;
      }
      const s = tr.stats();
      this.setStatus({
        title: `Road accident · ${e.name}`,
        phase: cleared ? "Cleared" : `Lane${block.length > 1 ? "s" : ""} closed · clears in ${Math.max(0, Math.ceil((clearAt - this.t) / 60))} min`,
        metrics: [
          { label: "Injured", value: String(level === 1 ? 0 : level === 2 ? 2 : 7), tone: level > 1 ? "bad" : "good" },
          { label: "Network speed", value: `${s.speedKmh.toFixed(0)} km/h`, tone: s.speedKmh < 15 ? "warn" : "good" },
          { label: "Queued vehicles", value: `${Math.round(s.stoppedPct * 100)}%` },
        ],
        advice: `Avoid ${e.name}; traffic is being diverted via Civic Lane.`,
      });
    };
  }

  /* --------------------------------------------------------------- gas */

  private gas(level: number) {
    const src = placeById("fuel");
    const rate = level === 1 ? 0.5 : level === 2 ? 2 : 6;
    const uniforms = {
      uSource: { value: new THREE.Vector2(src.x, src.z) },
      uWind: { value: this.windVec() },
      uSpeed: { value: this.windSpeed },
      uRate: { value: rate },
      uFront: { value: 0 },
      uTail: { value: -1 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(src.x, 1.6, src.z);
    plane.renderOrder = 4;
    this.group.add(plane);
    const haze = new Puffs(this.group, 40, this.smokeTex, { color: "#d8e07a", size: [6, 26], rise: 0.6, drift: this.windVec().multiplyScalar(this.windSpeed * 3), life: 14, spread: 10, opacity: 0.35 });
    this.puffs.push(haze);
    this.say("Chlorine release at the airport fuel farm; site siren sounded");
    this.send("fire", "HAZMAT team", placeById("fire"), { x: src.x - 20, z: src.z + 25 });
    this.send("police", "Cordon unit", placeById("police"), { x: src.x - 30, z: src.z + 40 });
    this.engine.rig.flyTo(src.x - 60, src.z + 70, 300, 0.85);
    const stopAt = 25 * 60;
    this.tick = (dt) => {
      uniforms.uTime.value += dt;
      uniforms.uWind.value.copy(this.windVec());
      uniforms.uSpeed.value = this.windSpeed;
      uniforms.uFront.value = this.windSpeed * this.t;
      uniforms.uTail.value = this.t > stopAt ? this.windSpeed * (this.t - stopAt) : -1;
      haze.update(dt, new THREE.Vector3(src.x, 3, src.z), this.t > stopAt ? 0 : 1);
      if (this.t > 300) this.say("Cell broadcast: shelter in place downwind");
      if (this.t > stopAt) this.say("Leak isolated; cloud diluting");
      const reach = Math.min(this.windSpeed * this.t, 2500);
      this.setStatus({
        title: "Gas leak · Airport fuel farm",
        phase: this.t > stopAt ? "Leak isolated" : "Active release",
        metrics: [
          { label: "Release", value: `${rate} kg/s chlorine`, tone: "bad" },
          { label: "Cloud reach", value: `${(reach / 1000).toFixed(2)} km`, tone: reach > 400 ? "bad" : "warn" },
          { label: "Wind", value: `from ${Math.round(this.windFrom)}° at ${this.windSpeed.toFixed(1)} m/s` },
        ],
        advice: "Red zone: leave crosswind. Orange zone: stay indoors, shut windows, switch off AC.",
      });
    };
  }

  /* -------------------------------------------------------- earthquake */

  private earthquake(level: number) {
    const mag = level === 1 ? 5.2 : level === 2 ? 6.2 : 7.1;
    this.engine.rig.shakeFor(2 + level * 1.5);
    const damaged = PLACES.filter((p) => p.kind === "residential" || p.kind === "civic" || p.kind === "station").slice(0, 2 + level * 2);
    const dust = damaged.map((p) => {
      const d = new Puffs(this.group, 24, this.smokeTex, { color: "#b9a88c", size: [6, 22], rise: 2.5, drift: new THREE.Vector2(0.6, 0.4), life: 8, spread: 14, opacity: 0.45 });
      this.puffs.push(d);
      return { p, d };
    });
    const pinTex = pinTexture("!", "#d62f24");
    for (const p of damaged) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTex, depthTest: false, transparent: true }));
      s.position.set(p.x, p.height + 10, p.z);
      s.scale.set(7, 8.75, 1);
      s.renderOrder = 10;
      this.group.add(s);
    }
    this.say(`M ${mag.toFixed(1)} earthquake — strong shaking across the city`);
    this.engine.rig.flyTo(-40, -90, 360, 0.85);
    damaged.slice(0, 2).forEach((p, i) => {
      setTimeout(() => this.active === "earthquake" && this.send("fire", `USAR team ${i + 1}`, placeById("fire"), p), 600 + i * 700);
      setTimeout(() => this.active === "earthquake" && this.send("ambulance", `Ambulance ${i + 1}`, placeById("hospital"), p), 900 + i * 700);
    });
    this.tick = (dt) => {
      for (const { p, d } of dust) d.update(dt, new THREE.Vector3(p.x, 2, p.z), Math.max(0.1, 1 - this.t / 1200));
      if (this.t > 240) this.say("Aftershock M " + (mag - 1.4).toFixed(1));
      if (this.t > 600) this.say("Drone survey complete; USAR prioritised by trapped estimates");
      const injured = Math.round((mag - 4.5) ** 3 * 22);
      this.setStatus({
        title: `Earthquake · M ${mag.toFixed(1)}`,
        phase: this.t < 30 ? "Shaking" : "Search & rescue",
        metrics: [
          { label: "Buildings damaged", value: String(damaged.length), tone: "bad" },
          { label: "Injured (est.)", value: String(injured), tone: injured > 120 ? "bad" : "warn" },
          { label: "Hospital surge beds", value: "180", tone: injured > 180 ? "bad" : "good" },
        ],
        advice: "Drop, cover and hold on during aftershocks. Stay out of damaged buildings.",
      });
    };
  }

  /* -------------------------------------------------------- evacuation */

  private evacuation(level: number) {
    const tr = this.traffic;
    const centre = placeById("apex");
    const radius = level === 1 ? 70 : level === 2 ? 110 : 160;
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 30, 64, 1, true),
      new THREE.MeshBasicMaterial({ color: "#ff3b30", transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    ring.position.set(centre.x, 15, centre.z);
    this.group.add(ring);
    const shelters = PLACES.filter((p) => p.kind === "shelter");
    const zoneNodes = tr.nodes.map((n, i) => ({ n, i })).filter(({ n }) => Math.hypot(n.x - centre.x, n.y - centre.z) < radius);
    const routes: THREE.Vector3[][] = [];
    for (const { i } of zoneNodes.slice(0, 4)) {
      const sh = shelters.filter((s) => Math.hypot(s.x - centre.x, s.z - centre.z) > radius).sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z))[routes.length % 2];
      if (!sh) continue;
      const path = tr.route(i, tr.nearestNode(sh.x, sh.z));
      if (!path) continue;
      const pts = [new THREE.Vector3(tr.nodes[i].x, 1, tr.nodes[i].y)];
      for (const eid of path) {
        const e = tr.edges[eid];
        pts.push(new THREE.Vector3(tr.nodes[e.to].x, tr.heightAt(eid, e.length) + 1, tr.nodes[e.to].y));
      }
      pts.push(new THREE.Vector3(sh.x, 1, sh.z));
      routes.push(pts);
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.05);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 8), 0.9, 6, false), new THREE.MeshBasicMaterial({ color: "#2fd07a", transparent: true, opacity: 0.75, toneMapped: false }));
      this.group.add(tube);
    }
    const dotsPer = 26;
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: "#eafff2", toneMapped: false }), Math.max(1, routes.length * dotsPer));
    this.group.add(dots);
    const curves = routes.map((pts) => new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.05));
    const residents = Math.round(radius * radius * 0.35);
    this.say(`Evacuation ordered within ${radius} m of ${centre.name}`);
    this.send("police", "Marshals", placeById("police"), centre);
    this.engine.rig.flyTo(centre.x - 40, centre.z + 40, 330, 0.9);
    const tmp = new THREE.Object3D();
    this.tick = () => {
      let k = 0;
      curves.forEach((c, r) => {
        for (let d = 0; d < dotsPer; d++) {
          const u = ((this.t / 240 + d / dotsPer + r * 0.13) % 1 + 1) % 1;
          c.getPointAt(u, tmp.position);
          tmp.updateMatrix();
          dots.setMatrixAt(k++, tmp.matrix);
        }
      });
      dots.instanceMatrix.needsUpdate = true;
      const out = Math.min(1, 1 - Math.exp(-((this.t / 1100) ** 2)));
      this.setStatus({
        title: `Evacuation · ${radius} m around ${centre.name}`,
        phase: out > 0.97 ? "Zone clear" : "Evacuating",
        metrics: [
          { label: "Residents", value: residents.toLocaleString("en-IN") },
          { label: "Out of zone", value: `${Math.round(out * 100)}%`, tone: out > 0.9 ? "good" : "warn" },
          { label: "Routes", value: String(routes.length) },
        ],
        advice: "Follow the green routes to the relief shelters. Carry ID, medicines and water.",
      });
    };
  }
}

/* -------------------------------------------------------------- sensors */

export class SensorLayer {
  cctv = new THREE.Group();
  aq = new THREE.Group();
  pins = new THREE.Group();
  private pillars: { mesh: THREE.Mesh; place: Place }[] = [];
  private blink: THREE.Mesh[] = [];
  private t = 0;

  constructor(private engine: CityEngine, traffic: Traffic3D) {
    const g = engine.layers.sensors;
    g.add(this.cctv, this.aq, this.pins);

    // CCTV: pole, camera head, view cone and a red recording light.
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 9, 6);
    poleGeo.translate(0, 4.5, 0);
    const pole = new THREE.MeshStandardMaterial({ color: "#3a3d40" });
    const head = new THREE.MeshStandardMaterial({ color: "#e8e8e4" });
    const cone = new THREE.MeshBasicMaterial({ color: "#7fd6ff", transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (const c of CCTV_NODES) {
      const n = traffic.nodes[c.node];
      const out = traffic.out[c.node][0];
      const dir = traffic.edges[out].dir;
      const grp = new THREE.Group();
      grp.position.set(n.x + 5, traffic.heightAt(out, 0), n.y + 5);
      grp.add(new THREE.Mesh(poleGeo, pole));
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.6), head);
      cam.position.y = 9;
      grp.add(cam);
      const view = new THREE.Mesh(new THREE.ConeGeometry(9, 30, 24, 1, true), cone);
      view.position.y = 9;
      view.rotation.x = Math.PI / 2 + 0.35;
      const yaw = new THREE.Group();
      yaw.rotation.y = Math.atan2(dir.x, dir.y);
      view.position.set(0, 9 - 5, 15);
      yaw.add(view);
      grp.add(yaw);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff2a2a", toneMapped: false }));
      led.position.set(0, 9.4, 0.85);
      grp.add(led);
      this.blink.push(led);
      grp.userData = { name: c.name };
      this.cctv.add(grp);
    }

    // Facility pins.
    const tex: Partial<Record<Place["kind"], THREE.Texture>> = {
      hospital: pinTexture("H", "#d64545"),
      police: pinTexture("P", "#3566b8"),
      fire: pinTexture("F", "#e07a2e"),
      shelter: pinTexture("S", "#2f9e62"),
      command: pinTexture("C", "#147f94"),
    };
    for (const p of PLACES) {
      const t = tex[p.kind];
      if (!t) continue;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
      s.position.set(p.x, p.height + 9, p.z);
      s.scale.set(6.4, 8, 1);
      s.renderOrder = 9;
      s.userData = { place: p };
      this.pins.add(s);
    }

    // Air-quality pillars over the monitoring sites.
    const sites = PLACES.filter((p) => p.kind !== "park").slice(0, 12);
    for (const p of sites) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.2, 1, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: "#f08c1e", transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
      );
      m.position.set(p.x + 6, 0, p.z - 6);
      this.aq.add(m);
      this.pillars.push({ mesh: m, place: p });
    }
    engine.onFrame.add(this.frame);
    this.setMode("overview");
  }

  dispose() {
    this.engine.onFrame.delete(this.frame);
    this.engine.layers.sensors.clear();
  }

  private frame = (dt: number) => {
    this.t += dt;
    const on = Math.floor(this.t * 1.5) % 2 === 0;
    for (const b of this.blink) b.visible = on;
  };

  /** Update pillar heights and colours from AQI values (one per site, cycling). */
  setAqi(values: number[], colors: string[]) {
    this.pillars.forEach(({ mesh }, i) => {
      const v = values[i % values.length] ?? 0;
      const h = Math.max(2, v / 6);
      mesh.scale.y = h;
      mesh.position.y = h / 2;
      (mesh.material as THREE.MeshBasicMaterial).color.set(colors[i % colors.length] ?? "#f08c1e");
    });
  }

  setMode(mode: "overview" | "traffic" | "emergency" | "surveillance" | "environment" | "citizen") {
    this.cctv.visible = mode === "surveillance" || mode === "traffic" || mode === "overview";
    this.aq.visible = mode === "environment";
    this.pins.visible = mode !== "environment";
  }
}
