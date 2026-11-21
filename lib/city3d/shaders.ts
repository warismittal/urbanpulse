/* Shader code recovered from the CapstoneConnect 3D scene. */

export const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane: the sky never clips or z-fights
  }
`;

export const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uFog;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDir;
  uniform float uGlowSize;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.85, h), 0.6));
    col = mix(col, uFog, 1.0 - smoothstep(-0.03, 0.14, h));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    float halo = pow(s, mix(48.0, 4.0, uGlowSize)) * 0.6;
    float core = smoothstep(0.9994, 0.9998, s) * 1.4;
    float band = (1.0 - smoothstep(0.0, 0.35, abs(h))) * pow(s, 3.0) * 0.25;
    float glowFade = smoothstep(-0.04, 0.08, h);
    col += uSunGlow * (halo + band) * glowFade + mix(uSunGlow, vec3(1.0), 0.6) * core;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Patches a MeshStandardMaterial into animated water (river) or sea with surf (shore = true). */
export function waterPatch(shore: boolean) {
  return {
    vertex: (src: string) =>
      src
        .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"),
    fragment: (src: string) =>
      (shore ? "#define WATER_SHORE\n" : "") +
      src
        .replace(
          "#include <common>",
          `#include <common>
        varying vec3 vWaterPos;
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform float uShimmer;
        uniform vec3 uSky;
        uniform vec3 uLagoon;
        uniform vec3 uFoam;
        uniform sampler2D uShore;
        uniform vec2 uFieldOrigin;
        uniform vec2 uFieldSize;
        uniform float uWaterline;
        uniform float uFlood;
        uniform float uNight;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float wFbm(vec2 p) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < 4; i++) { s += a * wNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          return s;
        }
        vec2 waveSlope(vec2 p, vec2 dir, float len, float amp, float speed) {
          float k = 6.2831853 / len;
          return dir * (amp * k * cos(dot(dir, p) * k - uTime * speed * k));
        }`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
        vec2 wp = vWaterPos.xz;
        float broad = sin(wp.x * 0.021 + uTime * 0.12) * sin(wp.y * 0.017 - uTime * 0.09);
        vec3 waterColor = mix(uDeep, uShallow, 0.22 + 0.08 * broad);
        float flowStreak = 0.0;
        #ifndef WATER_SHORE
          // River: flowing current — stretched fbm drifting downstream, with foam streaks.
          vec2 fp = vec2(wp.x * 0.09, wp.y * 0.035 - uTime * 0.22);
          float n1 = wFbm(fp);
          float n2 = wFbm(fp * 2.3 + vec2(0.0, -uTime * 0.15));
          flowStreak = smoothstep(0.6, 0.8, n1 * 0.6 + n2 * 0.5);
          waterColor = mix(waterColor, uShallow * 1.2, clamp((n1 - 0.45) * 0.45, 0.0, 0.3));
          waterColor = mix(waterColor, uFoam, flowStreak * 0.16);
        #endif
        // Flood: silty brown water.
        waterColor = mix(waterColor, vec3(0.42, 0.36, 0.25), uFlood * 0.55);
        #ifdef WATER_SHORE
          vec2 fuv = (wp - uFieldOrigin) / uFieldSize;
          bool inField = all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)));
          float shoreDist = inField ? texture2D(uShore, fuv).r * 127.5 : 127.5;
          float beyond = shoreDist - uWaterline;
          waterColor = mix(waterColor, uLagoon, (1.0 - smoothstep(0.0, 45.0, beyond)) * 0.85);
          float breakup = 0.55 + 0.45 * sin(wp.x * 0.23 + uTime * 0.6) * sin(wp.y * 0.19 - uTime * 0.5);
          float edge = 1.0 - smoothstep(0.0, 1.6, beyond);
          float rollIn = 7.0 * (1.0 - fract(uTime * 0.14 + 0.02 * (wp.x + wp.y)));
          float swash = (1.0 - smoothstep(0.0, 1.1, abs(beyond - rollIn))) * (1.0 - rollIn / 7.0);
          waterColor = mix(waterColor, uFoam, clamp((edge * 0.85 + swash * 0.7) * breakup, 0.0, 1.0));
        #endif
        diffuseColor.rgb = waterColor;`
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
        {
          vec2 q = vWaterPos.xz;
          float viewDist = length(vViewPosition);
          vec2 slope = waveSlope(q, vec2(-0.71, -0.7), 29.0, 0.22, 1.5)
                     + waveSlope(q, vec2(0.83, 0.56), 13.0, 0.1, 1.1) * (1.0 - smoothstep(90.0, 260.0, viewDist))
                     + waveSlope(q, vec2(-0.45, 0.89), 7.0, 0.045, 0.9) * (1.0 - smoothstep(45.0, 140.0, viewDist));
          #ifndef WATER_SHORE
            vec2 fq = vec2(q.x * 0.25, q.y * 0.12 - uTime * 0.6);
            float c0 = wFbm(fq);
            vec2 g = vec2(wFbm(fq + vec2(0.15, 0.0)) - c0, wFbm(fq + vec2(0.0, 0.15)) - c0) / 0.15;
            slope += g * vec2(0.25, 0.12) * 0.9 * (1.0 - smoothstep(60.0, 240.0, viewDist));
          #endif
          slope *= 1.0 - smoothstep(260.0, 650.0, viewDist);
          vec3 waveNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
          normal = normalize((viewMatrix * vec4(waveNormal, 0.0)).xyz);
        }`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
        float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uSky * pow(1.0 - facing, 5.0) * 0.55;
        // City lights shimmering on the water at night.
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * uNight * (0.05 + flowStreak * 0.25) * pow(1.0 - facing, 2.0);`
        )
        .replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.12 + 0.3 * uShimmer;
        reflectedLight.indirectSpecular *= 0.35;`
        ),
  };
}

export const SPLIT_TONE_FRAG = /* glsl */ `
  uniform vec3 shadowTint;
  uniform vec3 highlightTint;
  uniform float strength;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float luma = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 tintColor = mix(shadowTint, highlightTint, smoothstep(0.15, 0.85, luma));
    outputColor = vec4(inputColor.rgb * mix(vec3(1.0), tintColor, strength), inputColor.a);
  }
`;

/** Gaussian-plume ground overlay: concentration bands for a toxic release. */
export const PLUME_FRAG = /* glsl */ `
  varying vec2 vXZ;
  uniform vec2 uSource;
  uniform vec2 uWind;     // unit vector the plume travels along
  uniform float uSpeed;   // m/s
  uniform float uRate;    // kg/s
  uniform float uFront;   // metres the cloud has travelled
  uniform float uTail;    // start of the cloud after the leak is stopped (-1 = none)
  uniform float uTime;
  void main() {
    vec2 d = vXZ - uSource;
    float down = dot(d, uWind);
    float cross = dot(d, vec2(-uWind.y, uWind.x));
    if (down < 1.0 || down > uFront || (uTail > 0.0 && down < uTail)) discard;
    float x = down;
    float sy = 0.16 * x * pow(1.0 + 0.0004 * x, -0.5);
    float sz = 0.14 * x * pow(1.0 + 0.0003 * x, -0.5);
    float c = (uRate * 1.0e6 / (3.14159 * uSpeed * sy * sz)) * exp(-(cross * cross) / (2.0 * sy * sy));
    float ppm = c * 24.45 / 70.9;
    if (ppm < 0.5) discard;
    vec3 col = ppm > 20.0 ? vec3(0.86, 0.2, 0.16) : ppm > 2.8 ? vec3(0.94, 0.51, 0.16) : vec3(0.93, 0.78, 0.16);
    float edgeFade = smoothstep(uFront, uFront - 40.0, down);
    float wisp = 0.85 + 0.15 * sin(vXZ.x * 0.08 + uTime * 0.7) * sin(vXZ.y * 0.07 - uTime * 0.5);
    float a = (ppm > 20.0 ? 0.62 : ppm > 2.8 ? 0.5 : 0.36) * edgeFade * wisp;
    gl_FragColor = vec4(col, a);
  }
`;

export const PLUME_VERT = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Soft scalar heat overlay sampled from a small data texture (AQI / temperature). */
export const HEAT_FRAG = /* glsl */ `
  varying vec2 vXZ;
  uniform sampler2D uData;
  uniform vec4 uBounds; // x0, z0, x1, z1
  uniform float uOpacity;
  void main() {
    vec2 uv = (vXZ - uBounds.xy) / (uBounds.zw - uBounds.xy);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
    vec4 c = texture2D(uData, uv);
    float edge = smoothstep(0.0, 0.06, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
    gl_FragColor = vec4(c.rgb, c.a * uOpacity * edge);
  }
`;

/** Vintage film: sepia tone, grain, frame flicker, vertical scratches and gate vignette. */
export const FILM_FRAG = /* glsl */ `
  uniform float filmAmount;
  uniform float filmClock;
  float fh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (filmAmount <= 0.001) { outputColor = inputColor; return; }
    vec3 c = inputColor.rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 sepia = vec3(l) * vec3(1.07, 0.92, 0.72);
    float frame = floor(filmClock * 18.0);
    float flicker = 0.94 + 0.06 * fh(vec2(frame, 3.1));
    float grain = (fh(uv * 913.0 + frame) - 0.5) * 0.12;
    float sx = fh(vec2(frame, 7.0));
    float scratch = step(0.86, fh(vec2(frame, 1.0))) * (1.0 - smoothstep(0.0, 0.0016, abs(uv.x - sx))) * 0.35;
    vec2 d = uv - 0.5;
    float gate = smoothstep(0.82, 0.32, length(d * vec2(1.05, 1.25)));
    vec3 film = (sepia * flicker + grain + scratch) * mix(0.55, 1.0, gate);
    outputColor = vec4(mix(c, film, filmAmount), inputColor.a);
  }
`;
