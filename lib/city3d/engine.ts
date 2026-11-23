/**
 * CityEngine — the 3D city scene, rebuilt with vanilla three.js from the
 * CapstoneConnect 3D site: the same models, palettes, sky, animated river and
 * sea with surf, sand beaches from the island field, image-based lighting,
 * drifting clouds, the circling airliner, and the colour grade (bloom, ACES,
 * saturation, contrast, split tone, vignette).
 *
 * Smart-city layers (traffic, incidents, sensors) attach to `engine.layers`
 * and tick through `engine.onFrame`.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  Effect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import { ASSET_BASE, CENTER, ENV_MAP, FIELD, MODELS, PALETTES, type Palette, type PaletteId } from "./config";
import { paletteAt } from "./daynight";
import { FILM_FRAG, SKY_FRAG, SKY_VERT, SPLIT_TONE_FRAG, waterPatch } from "./shaders";

export type Quality = "high" | "medium" | "low";

export interface EngineOptions {
  palette?: PaletteId;
  quality?: Quality;
  onProgress?: (p: number, label: string) => void;
  onReady?: () => void;
  onError?: (e: unknown) => void;
}

type MatMap = Map<string, THREE.MeshStandardMaterial>;

const url = (p: string) => `${ASSET_BASE}${p}`;

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 31 && head[1] === 139) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  return buf;
}

class SplitToneEffect extends Effect {
  constructor() {
    super("SplitToneEffect", SPLIT_TONE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["shadowTint", new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ["highlightTint", new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ["strength", new THREE.Uniform(0.5)],
      ]),
    });
  }
}

/** Old-film look: sepia, grain, flicker, scratches and a soft gate vignette. */
class FilmEffect extends Effect {
  constructor() {
    super("FilmEffect", FILM_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["filmAmount", new THREE.Uniform(0)],
        ["filmClock", new THREE.Uniform(0)],
      ]),
    });
  }
}

/* ------------------------------------------------------------- camera rig */

export class OrbitRig {
  target = new THREE.Vector3(-60, 0, -90);
  radius = 330;
  phi = 0.93; // polar angle from +y
  theta = 0.77; // azimuth
  private goal = { target: this.target.clone(), radius: this.radius, phi: this.phi, theta: this.theta };
  private dragging: null | { button: number; x: number; y: number } = null;
  enabled = true;
  limits = { minR: 30, maxR: 1100, minPhi: 0.12, maxPhi: 1.45, x0: -420, x1: 260, z0: -460, z1: 240 };
  private tween: null | { t: number; dur: number; from: { target: THREE.Vector3; radius: number; phi: number; theta: number } } = null;
  private shake = 0;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    dom.style.touchAction = "none"; // we handle pinch and drag ourselves on phones
    dom.addEventListener("pointerdown", this.down);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.up);
    window.addEventListener("pointercancel", this.up);
    dom.addEventListener("wheel", this.wheel, { passive: false });
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this.down);
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.up);
    window.removeEventListener("pointercancel", this.up);
    this.dom.removeEventListener("wheel", this.wheel);
  }

  /** Active touch points, for two-finger pinch-zoom and pan on phones. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; cx: number; cy: number } | null = null;

  private down = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.tween = null;
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        this.dragging = null;
        return;
      }
    }
    this.dragging = { button: e.button === 2 || e.shiftKey ? 2 : 0, x: e.clientX, y: e.clientY };
  };
  private move = (e: PointerEvent) => {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size >= 2) {
        const [a, b] = [...this.touches.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        // Pinch to zoom, two-finger drag to pan.
        this.goal.radius *= this.pinch.dist / Math.max(1, dist);
        const k = this.goal.radius / 650;
        const dx = cx - this.pinch.cx;
        const dy = cy - this.pinch.cy;
        const sin = Math.sin(this.goal.theta);
        const cos = Math.cos(this.goal.theta);
        this.goal.target.x += (-dx * cos - dy * sin) * k;
        this.goal.target.z += (dx * sin - dy * cos) * k;
        this.pinch = { dist, cx, cy };
        this.clampGoal();
        return;
      }
    }
    const d = this.dragging;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.button === 2) {
      // Pan along the ground, in camera-relative directions.
      const k = this.goal.radius / 650;
      const sin = Math.sin(this.goal.theta);
      const cos = Math.cos(this.goal.theta);
      this.goal.target.x += (-dx * cos - dy * sin) * k;
      this.goal.target.z += (dx * sin - dy * cos) * k;
    } else {
      this.goal.theta -= dx * 0.0045;
      this.goal.phi -= dy * 0.0035;
    }
    this.clampGoal();
  };
  private up = (e?: PointerEvent) => {
    this.dragging = null;
    if (e && e.pointerType === "touch") {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
    }
  };
  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.tween = null;
    this.goal.radius *= Math.exp(e.deltaY * 0.0012);
    this.clampGoal();
  };

  private clampGoal() {
    const L = this.limits;
    this.goal.radius = THREE.MathUtils.clamp(this.goal.radius, L.minR, L.maxR);
    this.goal.phi = THREE.MathUtils.clamp(this.goal.phi, L.minPhi, L.maxPhi);
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, L.x0, L.x1);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, L.z0, L.z1);
  }

  /** Smoothly move to look at a point. */
  flyTo(x: number, z: number, radius = 160, phi = 0.95, theta?: number, seconds?: number) {
    const from = { target: this.target.clone(), radius: this.radius, phi: this.phi, theta: this.theta };
    this.goal.target.set(x, 0, z);
    this.goal.radius = radius;
    this.goal.phi = phi;
    if (theta !== undefined) this.goal.theta = theta;
    this.clampGoal();
    // Eased flight: duration grows with distance; arcs out a little on long hops.
    const dist = from.target.distanceTo(this.goal.target) + Math.abs(from.radius - this.goal.radius) * 0.5;
    this.tween = { t: 0, dur: seconds ?? THREE.MathUtils.clamp(0.9 + dist / 260, 1, 2.6), from };
  }

  /** True while a scripted camera flight is running. */
  get flying() {
    return this.tween !== null;
  }

  shakeFor(seconds: number) {
    this.shake = Math.max(this.shake, seconds);
  }

  update(dt: number) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2; // easeInOutCubic
      const lift = Math.sin(Math.PI * tw.t) * Math.min(120, tw.from.target.distanceTo(this.goal.target) * 0.25);
      this.target.lerpVectors(tw.from.target, this.goal.target, e);
      this.radius = tw.from.radius + (this.goal.radius - tw.from.radius) * e + lift;
      this.phi = tw.from.phi + (this.goal.phi - tw.from.phi) * e;
      let d = this.goal.theta - tw.from.theta;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.theta = tw.from.theta + d * e;
      if (tw.t >= 1) this.tween = null;
    } else {
      const k = 1 - Math.exp(-dt * 5);
      this.target.lerp(this.goal.target, k);
      this.radius += (this.goal.radius - this.radius) * k;
      this.phi += (this.goal.phi - this.phi) * k;
      let dTheta = this.goal.theta - this.theta;
      dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
      this.theta += dTheta * k;
    }
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta)
    );
    if (this.shake > 0) {
      this.shake -= dt;
      const a = Math.min(1, this.shake) * 2.2;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(this.target);
  }
}

/* ------------------------------------------------------------------ engine */

export class CityEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rig: OrbitRig;
  composer: EffectComposer;
  palette: Palette;
  quality: Quality;
  /** Overlay groups for smart-city layers. */
  layers = {
    traffic: new THREE.Group(),
    incidents: new THREE.Group(),
    sensors: new THREE.Group(),
    markers: new THREE.Group(),
  };
  onFrame = new Set<(dt: number, t: number) => void>();
  ready = false;
  /** Meshes that make up the city (for raycasts). */
  cityMeshes: THREE.Mesh[] = [];
  roadMeshes: THREE.Mesh[] = [];
  carTemplate: THREE.Object3D | null = null;
  /** 0 = full day, 1 = full night. Drives lamps, windows, headlights. */
  night = 0;
  /** Hour of day, 0..24. */
  hour = 17.2;
  /** Simulated hours per real second (0 = paused). */
  timeRate = 1 / 60;
  /** When true, the day/night cycle drives the palette. */
  autoSky = true;
  /** Scripted motion for the plane and ferry lives in the world layer when set. */
  externalMotion = false;
  plane: THREE.Object3D | null = null;
  boat: THREE.Object3D | null = null;

  private canvas: HTMLCanvasElement;
  private materials: MatMap = new Map();
  private waterUniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uShimmer: { value: 0.5 },
    uSky: { value: new THREE.Color() },
    uLagoon: { value: new THREE.Color() },
    uFoam: { value: new THREE.Color() },
    uShore: { value: null as THREE.Texture | null },
    uFieldOrigin: { value: new THREE.Vector2(FIELD.x0, FIELD.z0) },
    uFieldSize: { value: new THREE.Vector2(FIELD.cols * FIELD.step, FIELD.rows * FIELD.step) },
    uWaterline: { value: 22 },
    uFlood: { value: 0 },
    uNight: { value: 0 },
  };
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  private seaMat: THREE.MeshStandardMaterial;
  private beach: THREE.Mesh | null = null;
  private beachHeights: Float32Array | null = null;
  private clouds: THREE.InstancedMesh[] = [];
  private cloudMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, metalness: 0 });
  private cloudData = new Float32Array(48);
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private skyClock = 0;
  private envId: PaletteId = 2;
  private effects!: {
    bloom: BloomEffect;
    hue: HueSaturationEffect;
    bc: BrightnessContrastEffect;
    split: SplitToneEffect;
    vignette: VignetteEffect;
    film: FilmEffect;
  };
  private filmTarget = 0;
  private envTextures = new Map<PaletteId, THREE.DataTexture>();
  private raf = 0;
  private last = 0;
  private time = 0;
  private resizeObs: ResizeObserver;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, private opts: EngineOptions = {}) {
    this.canvas = canvas;
    this.quality = opts.quality ?? "high";
    this.palette = PALETTES[opts.palette ?? 2];
    this.envId = this.palette.id;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === "low" ? 1 : 1.75));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = this.quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
    this.rig = new OrbitRig(this.camera, canvas);

    // Sky dome that follows the camera.
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uSunGlow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uGlowSize: { value: 0.4 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.skyMat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // Stars and moon, faded in at night.
    const starPos = new Float32Array(1400 * 3);
    let sd = 7;
    const r = () => ((sd = (16807 * sd) % 0x7fffffff) - 1) / 0x7ffffffe;
    for (let i = 0; i < 1400; i++) {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const k = Math.sqrt(1 - y * y);
      starPos.set([Math.cos(th) * k * 950, y * 950, Math.sin(th) * k * 950], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.6, 1.8), size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.15, 1.9), transparent: true, opacity: 0, fog: false, toneMapped: false, depthWrite: false }));
    this.moon.renderOrder = -1;
    this.scene.add(this.moon);

    // Lights.
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -170;
    sc.right = 170;
    sc.top = 170;
    sc.bottom = -170;
    sc.near = 50;
    sc.far = 790;
    this.sun.shadow.bias = -4e-4;
    this.sun.shadow.normalBias = 0.25;
    const ms = this.quality === "high" ? 4096 : 2048;
    this.sun.shadow.mapSize.set(ms, ms);
    this.scene.add(this.sun, this.sun.target);

    // Sea with shore surf.
    this.seaMat = new THREE.MeshStandardMaterial({ name: "m_sea" });
    this.patchWater(this.seaMat, true);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(2400, 64), this.seaMat);
    sea.position.set(CENTER[0], -8.2, CENTER[2]);
    sea.rotation.x = -Math.PI / 2;
    sea.receiveShadow = true;
    this.scene.add(sea);

    this.makeClouds();
    for (const g of Object.values(this.layers)) this.scene.add(g);

    // Post-processing.
    this.composer = new EffectComposer(this.renderer, {
      multisampling: this.quality === "high" ? 4 : 0,
      frameBufferType: THREE.HalfFloatType,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.effects = {
      bloom: new BloomEffect({ intensity: 0.3, luminanceThreshold: 0.9, luminanceSmoothing: 0.2, mipmapBlur: true }),
      hue: new HueSaturationEffect({ saturation: 0.1 }),
      bc: new BrightnessContrastEffect({ brightness: 0, contrast: 0.08 }),
      split: new SplitToneEffect(),
      vignette: new VignetteEffect({ offset: 0.3, darkness: 0.35 }),
      film: new FilmEffect(),
    };
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(new EffectPass(this.camera, this.effects.bloom, tone, this.effects.hue, this.effects.bc, this.effects.split, this.effects.vignette, this.effects.film));

    this.applyPalette();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
    this.load().catch((e) => opts.onError?.(e));
  }

  /* ------------------------------------------------------------- loading */

  private async load() {
    const progress = (p: number, label: string) => this.opts.onProgress?.(p, label);
    progress(2, "Loading the city");
    const draco = new DRACOLoader();
    draco.setDecoderPath(url(MODELS.draco));
    const gltf = new GLTFLoader();
    gltf.setDRACOLoader(draco);
    gltf.setCrossOrigin("anonymous");

    const [field, env] = await Promise.all([fetchBytes(MODELS.islandField), fetchBytes(MODELS.environment[this.palette.id])]);
    this.buildField(field);
    this.setEnvironment(this.palette.id, env);
    progress(15, "Loading the city");

    const core = await gltf.loadAsync(url(MODELS.cityCore));
    this.adoptCity(core.scene);
    this.scene.add(core.scene);
    this.boat = core.scene.getObjectByName("boat") ?? null;
    progress(40, "Loading the city");

    let done = 0;
    const tiles = await Promise.all(
      MODELS.cityTiles.map((p) =>
        gltf.loadAsync(url(p)).then((g) => {
          done++;
          progress(40 + done * 10, "Loading the city");
          return g;
        })
      )
    );
    for (const t of tiles) {
      this.adoptCity(t.scene);
      this.scene.add(t.scene);
    }
    this.applyPalette();
    progress(85, "Setting the scene");

    const [plane, car] = await Promise.all([gltf.loadAsync(url(MODELS.plane)), gltf.loadAsync(url(MODELS.car))]);
    this.plane = plane.scene;
    this.plane.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.scene.add(this.plane);
    this.carTemplate = car.scene;
    this.carTemplate.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    draco.dispose();

    // Shadows are static: render the shadow map once now that everything is in.
    this.renderer.shadowMap.needsUpdate = true;
    this.ready = true;
    progress(100, "Setting the scene");
    this.opts.onReady?.();
  }

  /** Material sharing, road-paint split and shadows — as in the original scene. */
  private adoptCity(root: THREE.Object3D) {
    const map = this.materials;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const swapRoad = (m: THREE.Material) => {
        if (m.name !== ".1_3") return m;
        let r = map.get("m_road_paint");
        if (!r) {
          r = (m as THREE.MeshStandardMaterial).clone();
          r.name = "m_road_paint";
          delete r.userData.base;
        }
        return r;
      };
      const isCity = /^city_|^bld_/.test(mesh.name) || /^city_|^bld_/.test(mesh.parent?.name ?? "");
      if (isCity) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swapRoad) : swapRoad(mesh.material);
      const share = (m: THREE.Material) => map.get(m.name) ?? m;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(share) : share(mesh.material);
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const m of mats) {
        if (!m.isMeshStandardMaterial || map.has(m.name)) continue;
        m.userData.base ??= { color: m.color.clone(), roughness: m.roughness, metalness: m.metalness };
        map.set(m.name, m);
        if (m.name === "m_water") this.patchWater(m, false);
      }
      if (mats.some((m) => m.name === "m_water")) mesh.castShadow = false;
      this.cityMeshes.push(mesh);
      if (mats.some((m) => m.name === "m_asphalt")) this.roadMeshes.push(mesh);
    });
  }

  private patchWater(mat: THREE.MeshStandardMaterial, shore: boolean) {
    const patch = waterPatch(false);
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.waterUniforms);
      if (shore) shader.defines = { ...(shader.defines ?? {}), WATER_SHORE: "" };
      shader.vertexShader = patch.vertex(shader.vertexShader);
      shader.fragmentShader = patch.fragment(shader.fragmentShader);
    };
    mat.customProgramCacheKey = () => (shore ? "urbanpulse-sea" : "urbanpulse-water");
    mat.needsUpdate = true;
  }

  /** Island field: shore distance texture for surf, and the sand beach mesh. */
  private buildField(buf: ArrayBuffer) {
    const { cols, rows, x0, z0, step } = FIELD;
    const n = cols * rows;
    const bytes = new Uint8Array(buf);
    const distance = new Float32Array(n);
    const landHeight = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      distance[i] = bytes[i] / 2;
      landHeight[i] = bytes[2 * n + i] / 8 - 16;
    }
    const region = bytes.slice(n, 2 * n);
    const tex = new THREE.DataTexture(bytes.slice(0, n), cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.waterUniforms.uShore.value = tex;

    const shelf = (d: number, h: number) => {
      const base = Math.min(h, 0) - 0.25;
      if (d <= 2) return base;
      if (d <= 22) return base + (-8.2 - base) * (1 - (1 - (d - 2) / 20) ** 2.2);
      return -8.2 - (d - 22) * 0.25;
    };
    const pos = new Float32Array(n * 3);
    const heights = new Float32Array(n);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const h = landHeight[i];
        const y = region[i] === 1 ? Math.min(h, 0.2) - 0.8 : region[i] === 0 ? shelf(distance[i], h) : Math.min(shelf(distance[i], h), -8.6);
        heights[i] = y;
        pos.set([x0 + c * step, y, z0 + r * step], 3 * i);
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i = r * cols + c;
        const q = [i, i + 1, i + cols, i + cols + 1];
        if (q.some((k) => region[k] === 0) && !q.every((k) => heights[k] < -8.5)) index.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    this.beachHeights = heights;
    this.beach = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: "m_beach", vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.beach.receiveShadow = true;
    this.scene.add(this.beach);
    this.colorBeach();
  }

  private colorBeach() {
    if (!this.beach || !this.beachHeights) return;
    const sand = new THREE.Color(this.palette.shore.sand);
    const wet = new THREE.Color(this.palette.shore.wetSand);
    const tmp = new THREE.Color();
    const attr = this.beach.geometry.getAttribute("color") as THREE.BufferAttribute;
    const h = this.beachHeights;
    for (let i = 0; i < h.length; i++) {
      const t = Math.min(1, Math.max(0, (h[i] + 8.2 - 0.2) / 2.2));
      const k = 1 - t * t * (3 - 2 * t);
      const jitter = 0.96 + 0.08 * Math.abs((43758.5453 * Math.sin(12.9898 * i)) % 1);
      tmp.copy(sand).lerp(wet, k).multiplyScalar(jitter);
      attr.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    attr.needsUpdate = true;
  }

  private setEnvironment(id: PaletteId, buf: ArrayBuffer) {
    let tex = this.envTextures.get(id);
    if (!tex) {
      tex = new THREE.DataTexture(new Uint16Array(buf), ENV_MAP.width, ENV_MAP.height, THREE.RGBAFormat, THREE.HalfFloatType);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.envTextures.set(id, tex);
    }
    this.scene.environment = tex;
    this.scene.environmentIntensity = ENV_MAP.intensity;
  }

  private makeClouds() {
    let seed = 0;
    const rnd = () => ((seed = (16807 * seed) % 0x7fffffff) - 1) / 0x7ffffffe;
    for (let k = 0; k < 3; k++) {
      seed = 11 + 97 * k;
      const group: THREE.BufferGeometry[] = [];
      const puffs = 4 + Math.floor(3 * rnd());
      for (let e = 0; e < puffs; e++) {
        const g = new THREE.IcosahedronGeometry(9 + 9 * rnd(), 1);
        g.scale(1, 0.55 + 0.15 * rnd(), 0.85);
        g.translate((e - puffs / 2) * 13 + 6 * rnd(), 5 * rnd(), (rnd() - 0.5) * 12);
        group.push(g);
      }
      const merged = mergeGeometries(group);
      group.forEach((g) => g.dispose());
      merged.computeVertexNormals();
      const inst = new THREE.InstancedMesh(merged, this.cloudMat, 4);
      inst.frustumCulled = false;
      this.clouds.push(inst);
      this.scene.add(inst);
    }
    seed = 4242;
    for (let n = 0; n < 12; n++) {
      this.cloudData[4 * n] = CENTER[0] + (rnd() - 0.5) * 900;
      this.cloudData[4 * n + 1] = 115 + 60 * rnd();
      this.cloudData[4 * n + 2] = CENTER[2] + (rnd() - 0.5) * 720;
      this.cloudData[4 * n + 3] = 0.8 + 0.7 * rnd();
    }
  }

  /* -------------------------------------------------------------- palette */

  setPalette(id: PaletteId) {
    this.autoSky = false;
    this.palette = PALETTES[id];
    this.night = id === 3 ? 0.55 : 0;
    this.applyPalette();
    this.useEnv(id);
  }

  /** Jump the clock (hours) and follow the sun from there. */
  setHour(h: number) {
    this.hour = ((h % 24) + 24) % 24;
    this.autoSky = true;
    this.skyClock = 1;
  }

  private useEnv(id: PaletteId) {
    if (id === this.envId && this.scene.environment) return;
    this.envId = id;
    const cached = this.envTextures.get(id);
    if (cached) this.scene.environment = cached;
    else fetchBytes(MODELS.environment[id]).then((b) => this.envId === id && this.setEnvironment(id, b)).catch(() => {});
  }

  private updateSky(dt: number) {
    this.hour = (this.hour + dt * this.timeRate + 24) % 24;
    if (!this.autoSky) return;
    this.skyClock += dt;
    // Re-grade a few times a second; cheap enough and visually continuous at this clock rate.
    if (this.skyClock < 0.25) return;
    this.skyClock = 0;
    const { palette, env, night } = paletteAt(this.hour);
    this.palette = palette;
    this.night = night;
    this.applyPalette(false);
    this.useEnv(env);
  }

  private applyPalette(shadows = true) {
    const p = this.palette;
    const u = this.skyMat.uniforms;
    u.uZenith.value.set(p.sky.zenith);
    u.uHorizon.value.set(p.sky.horizon);
    u.uFog.value.set(p.fog.color);
    u.uSunGlow.value.set(p.sky.sunGlow);
    (u.uSunDir.value as THREE.Vector3).set(...p.sun.direction).normalize();
    u.uGlowSize.value = p.sky.sunGlowSize;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(p.fog.color);
      this.scene.fog.near = p.fog.near;
      this.scene.fog.far = p.fog.far * 1.35;
    } else this.scene.fog = new THREE.Fog(p.fog.color, p.fog.near, p.fog.far * 1.35);

    const [cx, cy, cz] = CENTER;
    const d = new THREE.Vector3(...p.sun.direction).normalize();
    this.sun.position.set(cx + d.x * 450, cy + d.y * 450, cz + d.z * 450);
    this.sun.target.position.set(cx, cy, cz);
    this.sun.target.updateMatrixWorld();
    this.sun.color.set(p.sun.color);
    this.sun.intensity = p.sun.intensity * p.grade.exposure;
    this.hemi.color.set(p.hemi.sky);
    this.hemi.groundColor.set(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity * p.grade.exposure;

    const tint = new THREE.Color(p.otherMaterials.tint);
    const hsl = { h: 0, s: 0, l: 0 };
    for (const [name, m] of this.materials) {
      const base = m.userData.base as { color: THREE.Color; roughness: number; metalness: number } | undefined;
      const spec = p.materials[name];
      if (spec) {
        m.color.set(spec.color);
        m.roughness = spec.roughness ?? base?.roughness ?? m.roughness;
        m.metalness = spec.metalness ?? base?.metalness ?? m.metalness;
      } else if (base) {
        base.color.getHSL(hsl);
        m.color.setHSL(hsl.h, Math.min(1, hsl.s * p.otherMaterials.saturation), hsl.l * p.otherMaterials.lightness);
        m.color.lerp(tint, p.otherMaterials.tintAmount);
        m.roughness = base.roughness;
        m.metalness = base.metalness;
      }
      if (spec?.emissive) {
        m.emissive.set(spec.emissive);
        m.emissiveIntensity = spec.emissiveIntensity ?? 1;
      } else m.emissive.setRGB(0, 0, 0);
    }
    const water = p.materials.m_water;
    this.seaMat.roughness = water?.roughness ?? 0.2;
    this.seaMat.metalness = water?.metalness ?? 0.05;
    const w = this.waterUniforms;
    w.uDeep.value.set(p.water.deep);
    w.uShallow.value.set(p.water.shallow);
    w.uShimmer.value = p.water.shimmer;
    w.uSky.value.set(p.sky.horizon);
    w.uLagoon.value.set(p.shore.lagoon);
    w.uFoam.value.set(p.shore.foam);
    this.cloudMat.color.set(p.clouds.color);
    this.cloudMat.emissive.set(p.clouds.shade);
    this.cloudMat.emissiveIntensity = 0.18;
    this.colorBeach();

    const g = p.grade;
    this.effects.bloom.intensity = g.bloomIntensity;
    this.effects.bloom.luminanceMaterial.threshold = g.bloomThreshold;
    this.effects.hue.saturation = g.saturation;
    this.effects.bc.brightness = g.brightness;
    this.effects.bc.contrast = g.contrast;
    const su = this.effects.split.uniforms;
    (su.get("shadowTint")!.value as THREE.Color).setRGB(...g.shadowTint);
    (su.get("highlightTint")!.value as THREE.Color).setRGB(...g.highlightTint);
    su.get("strength")!.value = g.splitStrength;
    this.effects.vignette.darkness = g.vignette;

    // Night: lit windows, glowing road paint, stars and the moon.
    const n = this.night;
    this.waterUniforms.uNight.value = n;
    const glass = this.materials.get("m_glass");
    if (glass) {
      glass.emissive.set("#ffc47a");
      glass.emissiveIntensity = n * 0.6;
    }
    const sm = this.stars.material as THREE.PointsMaterial;
    sm.opacity = Math.max(0, n * 1.1 - 0.1);
    const mm = this.moon.material as THREE.MeshBasicMaterial;
    mm.opacity = n;
    const md = new THREE.Vector3(...p.sun.direction).normalize();
    this.moon.userData.dir = n > 0.5 ? md : new THREE.Vector3(-0.6, 0.45, -0.6).normalize();
    this.scene.environmentIntensity = ENV_MAP.intensity * (1 - n * 0.65);
    if (shadows || this.shadowClock++ % 8 === 0) this.renderer.shadowMap.needsUpdate = true;
  }
  private shadowClock = 0;

  /** Vintage film grade on/off (fades in and out). */
  setFilm(on: boolean) {
    this.filmTarget = on ? 1 : 0;
  }
  get film() {
    return this.filmTarget > 0;
  }

  /** Muddy, raised water for the flood scenario (0..1). */
  setFlood(level: number) {
    this.waterUniforms.uFlood.value = level;
  }

  /* ------------------------------------------------------------ frame loop */

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.time += dt;
    this.waterUniforms.uTime.value += dt;
    this.rig.update(dt);
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.updateSky(dt);
    const md = this.moon.userData.dir as THREE.Vector3 | undefined;
    if (md) {
      this.moon.position.copy(this.camera.position).addScaledVector(md, 900);
      this.moon.lookAt(this.camera.position);
    }

    // Clouds drift east and wrap around.
    const wrap = CENTER[0] - 450;
    for (let c = 0; c < 3; c++) {
      const inst = this.clouds[c];
      const m = new THREE.Matrix4();
      for (let k = 0; k < 4; k++) {
        const o = (4 * c + k) * 4;
        let x = this.cloudData[o] + 2.2 * dt;
        if (x > wrap + 900) x -= 900;
        this.cloudData[o] = x;
        m.compose(new THREE.Vector3(x, this.cloudData[o + 1], this.cloudData[o + 2]), new THREE.Quaternion(), new THREE.Vector3().setScalar(this.cloudData[o + 3]));
        inst.setMatrixAt(k, m);
      }
      inst.instanceMatrix.needsUpdate = true;
    }

    // Airliner circling the island, banked into the turn.
    if (this.plane && !this.externalMotion) {
      const a = this.time * 0.11;
      const R = 300;
      this.plane.position.set(CENTER[0] + Math.cos(a) * R, 92 + Math.sin(a * 2) * 6, CENTER[2] + Math.sin(a) * R);
      this.plane.rotation.set(0, -a, 0, "YXZ");
      this.plane.rotateZ(-0.22);
    }
    // Ferry cruising up and down the river.
    if (this.boat && !this.externalMotion) {
      const s = Math.sin(this.time * 0.05);
      this.boat.position.z = -60 + s * 95;
      this.boat.rotation.y = Math.cos(this.time * 0.05) >= 0 ? Math.PI : 0;
    }

    const fu = this.effects.film.uniforms;
    const fa = fu.get("filmAmount")!;
    fa.value += (this.filmTarget - (fa.value as number)) * Math.min(1, dt * 3);
    fu.get("filmClock")!.value = this.time % 1000;
    for (const f of this.onFrame) f(dt, this.time);
    this.composer.render(dt);
  };

  /* ---------------------------------------------------------------- utils */

  /** Ground point under a screen position (y = 0 plane), or null. */
  pickGround(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }

  /** Screen position of a world point, for HTML labels. */
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height, visible: v.z < 1 && v.z > -1 };
  }

  /**
   * Road surface heights along a polyline of (x, z) points. Picks, at each point,
   * the asphalt hit closest to the previous height so a road passing under a
   * flyover stays on the ground and one on the bridge stays on the deck, then
   * smooths out modelling seams.
   */
  roadHeights(pts: [number, number][]) {
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const out: number[] = [];
    let prev: number | null = null;
    for (const [x, z] of pts) {
      ray.set(new THREE.Vector3(x, 60, z), down);
      ray.far = 80;
      const ys = ray.intersectObjects(this.roadMeshes, false).map((h) => h.point.y).filter((y) => y < 14);
      let y: number;
      if (!ys.length) y = prev ?? 0;
      else if (prev === null) y = Math.min(...ys);
      else y = ys.reduce((a, b) => (Math.abs(b - prev!) < Math.abs(a - prev!) ? b : a));
      out.push(y);
      prev = y;
    }
    // Median of 3, then a light moving average.
    const med = out.map((_, i) => {
      const w = [out[Math.max(0, i - 1)], out[i], out[Math.min(out.length - 1, i + 1)]].sort((a, b) => a - b);
      return w[1];
    });
    return med.map((_, i) => {
      const a = med[Math.max(0, i - 1)];
      const b = med[i];
      const c = med[Math.min(med.length - 1, i + 1)];
      return 0.25 * a + 0.5 * b + 0.25 * c + 0.02;
    });
  }

  /**
   * Remove model triangles that lie entirely inside a world-space box and whose
   * material passes `test` — used to clear the old static fairground and the
   * model's parked train so the animated versions don't double up.
   */
  carve(box: [number, number, number, number, number, number], test: (material: string) => boolean) {
    const v = new THREE.Vector3();
    let removed = 0;
    const inside = (P: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, m: THREE.Matrix4) => {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      return v.x > box[0] && v.x < box[3] && v.y > box[1] && v.y < box[4] && v.z > box[2] && v.z < box[5];
    };
    for (const o of this.cityMeshes) {
      const g = o.geometry;
      const P = g.attributes.position;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.updateMatrixWorld();
      const M = o.matrixWorld;
      const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : P.count, materialIndex: 0 }];
      if (g.index) {
        const arr = g.index.array;
        const out: number[] = [];
        const ng: { start: number; count: number; materialIndex: number }[] = [];
        let any = false;
        for (const gr of groups) {
          const name = (mats[gr.materialIndex ?? 0] ?? mats[0]).name;
          const start = out.length;
          const hit = test(name);
          for (let t = gr.start; t < gr.start + gr.count; t += 3) {
            if (hit && inside(P, arr[t], M) && inside(P, arr[t + 1], M) && inside(P, arr[t + 2], M)) {
              any = true;
              removed++;
              continue;
            }
            out.push(arr[t], arr[t + 1], arr[t + 2]);
          }
          ng.push({ start, count: out.length - start, materialIndex: gr.materialIndex ?? 0 });
        }
        if (any) {
          g.setIndex(out);
          g.clearGroups();
          if (Array.isArray(o.material)) for (const x of ng) g.addGroup(x.start, x.count, x.materialIndex);
        }
      } else {
        let any = false;
        for (const gr of groups) {
          if (!test((mats[gr.materialIndex ?? 0] ?? mats[0]).name)) continue;
          for (let t = gr.start; t < gr.start + gr.count; t += 3) {
            if (inside(P, t, M) && inside(P, t + 1, M) && inside(P, t + 2, M)) {
              const x = P.getX(t), y = P.getY(t), z = P.getZ(t);
              P.setXYZ(t + 1, x, y, z);
              P.setXYZ(t + 2, x, y, z);
              any = true;
              removed++;
            }
          }
        }
        if (any) P.needsUpdate = true;
      }
    }
    this.renderer.shadowMap.needsUpdate = true;
    return removed;
  }

  /** City meshes that use a given material. */
  meshesWith(material: string) {
    return this.cityMeshes.filter((m) => (Array.isArray(m.material) ? m.material : [m.material]).some((x) => x.name === material));
  }

  /** Highest city surface under (x, z) whose material passes `accept` (default: anything below `maxY`). */
  surfaceY(x: number, z: number, accept?: (material: string) => boolean, maxY = 40) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 80, z), new THREE.Vector3(0, -1, 0), 0, 120);
    const hits = ray.intersectObjects(this.cityMeshes, false);
    for (const h of hits) {
      if (h.point.y > maxY) continue;
      const m = (Array.isArray((h.object as THREE.Mesh).material) ? ((h.object as THREE.Mesh).material as THREE.Material[])[h.face?.materialIndex ?? 0] : (h.object as THREE.Mesh).material) as THREE.Material;
      if (!accept || accept(m.name)) return h.point.y;
    }
    return null;
  }

  /** Height of the road surface under (x, z), from the road meshes. */
  roadHeight(x: number, z: number) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0), 0, 80);
    const hits = ray.intersectObjects(this.roadMeshes, false);
    // Lowest drivable surface below the bridge arches.
    const ok = hits.filter((h) => h.point.y < 12);
    return ok.length ? ok[0].point.y : 0;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.rig.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
      }
    });
  }
}

/** Minimal mergeGeometries for non-indexed or indexed position/normal geometries. */
function mergeGeometries(geos: THREE.BufferGeometry[]) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const a = g.getAttribute("position").array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return out;
}
