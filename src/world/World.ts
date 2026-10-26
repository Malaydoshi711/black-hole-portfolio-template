import * as THREE from "three";
import {
  MAX_BODIES, blurFrag, brightFrag, compositeFrag, downFrag, fullscreenVert, holeFrag, lineFrag, lineVert,
} from "./shaders";
import { RING, ROUTE_AT, REEL_END, sampleKeys, shadowAngle } from "./route";
import { categories, experience, featured, projects, publications, skills } from "../data/content";

const D2R = Math.PI / 180;
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 0 outside [a, d], 1 inside [b, c], smooth ramps between */
const win = (a: number, b: number, c: number, d: number, x: number) => smooth(a, b, x) * (1 - smooth(c, d, x));

type Kind = 0 | 1 | 2; // planet, star, pulsar
type Body = {
  id: string;
  group: string;
  kind: Kind;
  radius: number;
  color: THREE.Color;
  emissive: number;
  glow: number;
  seed: number;
  pos: THREE.Vector3;
  axis: THREE.Vector3;
  beam: number;
  highlight: number;
  vis: number;
  tag?: HTMLElement;
  tagMode?: "always" | "active";
  orbit: Orbit;
};

// project category colours come from `categories` in content.ts
const CAT_COLORS: Record<string, string> = Object.fromEntries(categories.map((c) => [c.name, c.color]));
export const categoryColor = (c: string) => CAT_COLORS[c] ?? "#ffffff";

/** colours of the scene's bodies (the disk and sky live in shaders.ts) */
const PALETTE = {
  about: "#d9d2c6",
  experience: ["#ffc26a", "#e9e1d4", "#bcd2f0", "#ee9466"],
  flagship: ["#ffe9c2", "#ffc35c", "#ff8a3a", "#b9d2ff", "#9fe3cf", "#fff3dc"],
  pulsar: "#cfe0ff",
  pulsarAward: "#ffc35a",
  toolkit: ["#fff0d0", "#ffc062", "#ee9466", "#cfe0ff"],
  orbit: "#ffe2b0",
  graph: "#ffd79a",
};

type Orbit = {
  R: number; incl: number; node: number; y?: number;
  base: number; drift: number; sweep: number; anchor: number;
  /** orbit plane orientation (from incl/node, or solved from the target) */
  q: THREE.Quaternion;
  line?: THREE.Line;
  /** desired screen spot at the anchor: desktop x, y, phone x, y (NDC) */
  target?: [number, number, number, number];
  /** distance from the camera at the anchor, as a fraction of the camera's distance to the hole */
  depth?: number;
  /** which way it should drift across the screen at the anchor (+1 right, -1 left) */
  dir?: number;
};
const quatFrom = (incl: number, node: number) =>
  new THREE.Quaternion().setFromAxisAngle(AY, node).multiply(new THREE.Quaternion().setFromAxisAngle(AX, incl * D2R));
type CamState = { pos: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3; tan: number; aspect: number; sx: number; sy: number };
const camState = (): CamState => ({ pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), tan: 0.33, aspect: 1, sx: 0, sy: 0 });

type Group = { id: string; window: [number, number, number, number]; vis: number; lines: THREE.Line[]; lineAlpha: number; clock: number };

export type WorldOpts = { mobile: boolean; reduce: boolean; fixRes?: number };
export type Telemetry = { r: number; clock: number };

export class World {
  private renderer: THREE.WebGLRenderer;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private holeMat: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private rtHole: THREE.WebGLRenderTarget;
  private rtB1: THREE.WebGLRenderTarget;
  private rtB1b: THREE.WebGLRenderTarget;
  private rtB2: THREE.WebGLRenderTarget;
  private rtB2b: THREE.WebGLRenderTarget;
  private lineScene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.05, 500);

  private bodies: Body[] = [];
  private groups = new Map<string, Group>();
  private agentEdges!: THREE.Line;
  private agents?: Body[];
  private nParts = Math.max(1, Math.min(6, featured.parts.length));
  private omniOrbit!: Orbit;
  private ringOrbit: Orbit = { R: 6.5, incl: 3, node: 0, base: 0, drift: 0, sweep: 0, anchor: 0, q: quatFrom(3, 0) };
  private omniBasis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  private ringOffset = 0;
  private omniCentre = new THREE.Vector3();
  private solveCam = camState();
  private liveCam = camState();

  private scale: number;
  private minScale: number;
  private maxScale: number;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private bloom = true;
  private degraded = false;

  target = 0;
  progress = 0;
  private reel = 0;
  private reelSmooth = 0;
  private activeAgent = -1;
  private pointer = new THREE.Vector2();
  private pointerS = new THREE.Vector2();
  private intro = 1;
  private pull = 0;
  private pullHold = 0;
  private diskTime = 0;
  private t0 = performance.now();
  private lastT = 0;
  private dt = 1 / 60;
  private ema = 1 / 60;
  private lastScaleChange = 0;
  private slowFor = 0;
  private raf = 0;
  private running = false;
  private dirty = true;
  private camPos = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private shift = new THREE.Vector2();
  private tanHalf = 0.33;
  private tmp = new THREE.Vector3();
  private basis = new THREE.Matrix4();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  frameCost = 0;
  frames = 0;

  onTelemetry?: (t: Telemetry) => void;
  onDegrade?: () => void;
  /** the project whose body is lit and labelled (rounded smoothed reel index) */
  onReel?: (i: number) => void;
  private reelIdx = -1;

  constructor(canvas: HTMLCanvasElement, private opts: WorldOpts) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: false });
    if (!this.renderer.capabilities.isWebGL2) throw new Error("WebGL2 required");
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.minScale = opts.mobile ? 0.3 : 0.32;
    this.maxScale = opts.mobile ? 0.6 : 0.85;
    this.scale = opts.fixRes ?? (opts.mobile ? 0.45 : 0.6);

    const rt = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.rtHole = rt(4, 4);
    this.rtB1 = rt(4, 4); this.rtB1b = rt(4, 4);
    this.rtB2 = rt(4, 4); this.rtB2b = rt(4, 4);

    const zeros = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
    this.holeMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: holeFrag,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uCamRight: { value: new THREE.Vector3() },
        uCamUp: { value: new THREE.Vector3() },
        uCamFwd: { value: new THREE.Vector3() },
        uTanHalf: { value: 0.33 },
        uAspect: { value: 1 },
        uShift: { value: new THREE.Vector2() },
        uDiskTime: { value: 0 },
        uTime: { value: 0 },
        uMaxSteps: { value: opts.mobile ? 120 : 190 },
        uStepScale: { value: opts.mobile ? 1.25 : 1 },
        uPixAngle: { value: 0.002 },
        uDiskGain: { value: 1.6 },
        uStarGain: { value: 1 },
        uStarDim: { value: 1 },
        uRingGain: { value: 1 },
        uGalN: { value: new THREE.Vector3(0.35, 0.82, 0.45).normalize() },
        uBody: { value: zeros(MAX_BODIES) },
        uBodyCol: { value: zeros(MAX_BODIES) },
        uBodyInfo: { value: zeros(MAX_BODIES) },
        uBodyAxis: { value: zeros(MAX_BODIES) },
        uBodyCount: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: brightFrag,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.1 } },
      depthTest: false, depthWrite: false,
    });
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: downFrag,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: blurFrag,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: compositeFrag,
      uniforms: {
        tHole: { value: this.rtHole.texture },
        tBloom1: { value: this.rtB1.texture },
        tBloom2: { value: this.rtB2.texture },
        uHoleRes: { value: new THREE.Vector2(4, 4) },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uWarp: { value: 0 },
        uPull: { value: 0 },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        uBloom: { value: 1 },
        uFade: { value: 1 },
        uGrain: { value: 0.035 },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.holeMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.buildBodies();
    this.resize();
  }

  /* ------------------------------------------------------------ */
  /* bodies and orbit guides                                       */
  /* ------------------------------------------------------------ */
  private addGroup(id: string, window: [number, number, number, number], lineAlpha = 0.22) {
    const g: Group = { id, window, vis: 0, lines: [], lineAlpha, clock: 0 };
    this.groups.set(id, g);
    return g;
  }

  private lineMat(color: string, dash = 0) {
    return new THREE.ShaderMaterial({
      vertexShader: lineVert, fragmentShader: lineFrag,
      uniforms: {
        uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(color) },
        uAlpha: { value: 0 }, uDash: { value: dash }, uTime: { value: 0 },
      },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  private orbit(g: Group, o: Orbit, color = "#ffe2b0", dash = 0) {
    const n = 256;
    const pos = new Float32Array((n + 1) * 3);
    const t = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * o.R;
      pos[i * 3 + 1] = o.y ?? 0;
      pos[i * 3 + 2] = Math.sin(a) * o.R;
      t[i] = (i / n) * o.R * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    const line = new THREE.Line(geo, this.lineMat(color, dash));
    line.quaternion.copy(o.q);
    line.frustumCulled = false;
    this.lineScene.add(line);
    g.lines.push(line);
    o.line = line;
    return line;
  }

  private body(b: Partial<Omit<Body, "color">> & { id: string; group: string; radius: number; color: string; orbit: Orbit }): Body {
    const body: Body = {
      kind: 0, emissive: 0, glow: 0, seed: Math.random(), beam: 0, highlight: 0, vis: 0,
      ...b,
      color: new THREE.Color(b.color),
      pos: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 1, 0),
    } as Body;
    this.bodies.push(body);
    return body;
  }

  private buildBodies() {
    const A = ROUTE_AT;
    const orb = (o: Partial<Orbit> & { R: number; anchor: number }): Orbit =>
      ({ incl: 0, node: 0, base: 0, drift: 0, sweep: 0, ...o, q: quatFrom(o.incl ?? 0, o.node ?? 0) });

    // About: one quiet companion on a wide orbit
    const gA = this.addGroup("about", [A.about - 0.085, A.about - 0.03, A.about + 0.04, A.about + 0.09]);
    const oA = orb({ R: 17, anchor: A.about, sweep: 1.2, drift: 0.004, target: [0.8, 0.5, 0.55, 0.8], depth: 0.85, dir: 1 });
    this.orbit(gA, oA);
    this.body({ id: "about-0", group: "about", radius: 0.9, color: PALETTE.about, seed: 0.31, tagMode: "always", orbit: oA });

    // Experience: one orbit per entry (up to four), newest innermost
    const gE = this.addGroup("experience", [A.experience - 0.07, A.experience - 0.03, A.experience + 0.04, A.experience + 0.085]);
    const expT: [number, number, number, number][] = [[-0.6, 0.55, 0.62, 0.82], [-0.8, -0.3, -0.62, 0.3], [-0.5, -0.68, 0.55, 0.14], [-0.2, 0.2, -0.5, 0.56]];
    [13, 16.5, 20, 23].slice(0, Math.min(4, experience.length)).forEach((R, i) => {
      const o = orb({ R, anchor: A.experience, sweep: 1.2 - i * 0.2, drift: 0.005, target: expT[i], depth: [0.9, 0.8, 0.72, 0.66][i], dir: [1, -1, 1, -1][i] });
      this.orbit(gE, o, PALETTE.orbit);
      this.body({ id: `exp-${i}`, group: "experience", radius: [0.85, 0.7, 0.62, 0.55][i], color: PALETTE.experience[i], seed: 0.2 + i * 0.27, tagMode: "always", orbit: o });
    });

    // Flagship: its parts as bright bodies orbiting a common centre
    const gO = this.addGroup("flagship", [A.flagship - 0.07, A.flagship - 0.03, A.flagship + 0.045, A.flagship + 0.09], 0.18);
    this.omniOrbit = orb({ R: 11, anchor: A.flagship, sweep: 1.0, drift: 0.003, target: [0.58, -0.48, 0.3, 0.76], depth: 0.62, dir: -1 });
    this.orbit(gO, this.omniOrbit, PALETTE.orbit, 36);
    const nParts = this.nParts;
    for (let i = 0; i < nParts; i++)
      this.body({ id: `agent-${i}`, group: "flagship", kind: 1, radius: 0.19, color: PALETTE.flagship[i], emissive: 0.85, glow: 0.4, seed: i * 0.19, tagMode: "always", orbit: this.omniOrbit });
    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((nParts + 1) * 3), 3));
      geo.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(Array.from({ length: nParts + 1 }, (_, k) => k)), 1));
      this.agentEdges = new THREE.Line(geo, this.lineMat(PALETTE.graph, 0));
      this.agentEdges.frustumCulled = false;
      this.lineScene.add(this.agentEdges);
      gO.lines.push(this.agentEdges);
    }

    // Projects: one body per project on a ring just above the disk
    const gP = this.addGroup("projects", [A.projects - 0.06, A.projects - 0.01, REEL_END + 0.01, REEL_END + 0.06], 0.16);
    this.orbit(gP, this.ringOrbit, PALETTE.orbit, 60);
    projects.forEach((p, i) =>
      this.body({ id: `proj-${i}`, group: "projects", radius: 0.4 + ((i * 37) % 11) * 0.008, color: categoryColor(p.category), seed: 0.13 + i * 0.071, tagMode: "active", orbit: this.ringOrbit }));

    // Research: one pulsar per publication (up to six); awards shine gold
    this.addGroup("research", [A.research - 0.065, A.research - 0.025, A.research + 0.04, A.research + 0.08]);
    const pulT: [number, number, number, number][] = [[-0.84, 0.66, -0.62, 0.86], [-0.94, -0.3, 0.66, 0.78], [-0.08, 0.72, -0.55, 0.12], [-0.56, -0.7, 0.6, 0.16], [-0.3, -0.12, 0.05, 0.5], [-0.62, 0.18, -0.2, 0.86]];
    [8.5, 10.5, 9.2, 11.5, 9.8, 10.9].slice(0, Math.min(6, publications.length)).forEach((R, i) =>
      this.body({
        id: `pulsar-${i}`, group: "research", kind: 2, radius: 0.14, color: publications[i].award ? PALETTE.pulsarAward : PALETTE.pulsar, emissive: 1, glow: publications[i].award ? 1.6 : 1,
        seed: i * 0.23, beam: publications[i].award ? 1.0 : 0.6, tagMode: "always",
        orbit: orb({ R, anchor: A.research, sweep: 0.8, drift: 0.002, target: pulT[i], depth: [0.8, 0.9, 0.75, 0.85, 0.82, 0.88][i], dir: i % 2 ? 1 : -1 }),
      }));

    // Toolkit: one small body per skill group (up to four) racing near the inner edge
    const gT = this.addGroup("toolkit", [A.toolkit - 0.06, A.toolkit - 0.025, A.toolkit + 0.035, A.toolkit + 0.07], 0.2);
    const tT: [number, number, number, number][] = [[0.6, 0.84, -0.6, 0.86], [0.94, 0.42, 0.62, 0.8], [0.95, -0.62, -0.55, 0.12], [0.5, -0.86, 0.6, 0.18]];
    [4.3, 5.2, 6.2, 7.3].slice(0, Math.min(4, skills.length)).forEach((R, i) => {
      const o = orb({ R, anchor: A.toolkit, sweep: 2, drift: 0.05, target: tT[i], depth: 0.8, dir: i % 2 ? -1 : 1 });
      this.orbit(gT, o, PALETTE.orbit);
      this.body({ id: `tool-${i}`, group: "toolkit", radius: 0.2 + i * 0.015, color: PALETTE.toolkit[i], seed: 0.4 + i * 0.15, tagMode: "always", orbit: o });
    });
  }

  /** a point on an inclined circular orbit (rs = 1) */
  private orbitPoint(o: Orbit, angle: number, out: THREE.Vector3) {
    return out.set(Math.cos(angle) * o.R, o.y ?? 0, Math.sin(angle) * o.R).applyQuaternion(o.q);
  }

  /** where each body is at time t and story progress p */
  private placeBodies(t: number, p: number) {
    const centre = this.omniCentre;
    {
      const o = this.omniOrbit;
      this.orbitPoint(o, o.base + (p - o.anchor) * o.sweep + this.groups.get("flagship")!.clock * o.drift, centre);
    }
    for (const b of this.bodies) {
      const i = Number(b.id.split("-")[1]);
      const o = b.orbit;
      if (b.group === "projects") {
        const a = (RING.phase - i * RING.spacing) * D2R + this.ringOffset + Math.sin(t * 0.2 + i) * 0.004;
        this.orbitPoint(o, a, b.pos);
        b.axis.set(Math.sin(i), 1, Math.cos(i * 1.7) * 0.5);
      } else if (b.group === "flagship") {
        // the parts circle their common centre on a small ring tilted to face the viewer
        const a = t * 0.32 + (i * Math.PI * 2) / this.nParts + p * 6;
        const [bx, by, bz] = this.omniBasis;
        b.pos.copy(centre).addScaledVector(bx, Math.cos(a) * 1.0).addScaledVector(by, Math.sin(a) * 0.62).addScaledVector(bz, Math.sin(a) * 0.5);
      } else if (o) {
        const clock = this.groups.get(b.group)!.clock;
        this.orbitPoint(o, o.base + (p - o.anchor) * o.sweep + clock * o.drift, b.pos);
        if (b.kind === 2) {
          // pulsar spin axis precesses, so the beams sweep across the sky
          const sp = t * [0.9, 0.7, 1.1, 0.8, 1.0, 0.75][i % 6] + i;
          b.axis.set(Math.cos(sp), 0.55 + 0.25 * Math.sin(i), Math.sin(sp)).normalize();
        } else b.axis.set(0.2 * i, 1, 0.15);
      }
    }
  }

  /** choose each orbit's phase so the body sits at a chosen spot on screen
   *  when its section is in view (depends on the aspect ratio) */
  private solvePlacements() {
    const mobile = this.isMobileLayout();
    const cam = this.solveCam;
    const ndc = (pos: THREE.Vector3) => {
      const rel = this.tmp3.copy(pos).sub(cam.pos);
      const z = rel.dot(cam.fwd);
      if (z < 1) return null;
      // hidden behind the shadow?
      const L = rel.length();
      const s = Math.min(L, Math.max(0, -cam.pos.dot(rel) / L));
      const dc = this.tmp2.copy(cam.pos).addScaledVector(rel, s / L).length();
      if (s > 0.01 && s < L - 0.01 && dc < 3.4) return null;
      return [rel.dot(cam.right) / (z * cam.tan * cam.aspect) + cam.sx, rel.dot(cam.up) / (z * cam.tan) + cam.sy];
    };
    // put the body at the target spot and depth, then lay its orbit plane
    // through that point so the orbital motion runs across the screen
    const solve = (o: Orbit) => {
      if (!o.target || !o.depth) return;
      this.camAt(o.anchor, 0, 1, 0, 0, cam);
      const [tx, ty] = mobile ? [o.target[2], o.target[3]] : [o.target[0], o.target[1]];
      const dir = this.tmp.copy(cam.fwd)
        .addScaledVector(cam.right, (tx - cam.sx) * cam.tan * cam.aspect)
        .addScaledVector(cam.up, (ty - cam.sy) * cam.tan).normalize();
      const P0 = new THREE.Vector3().copy(cam.pos).addScaledVector(dir, o.depth * cam.pos.length());
      o.R = P0.length();
      const p0n = P0.clone().normalize();
      const want = cam.right.clone().multiplyScalar(o.dir ?? 1);
      want.addScaledVector(p0n, -want.dot(p0n)).normalize();
      const n = new THREE.Vector3().crossVectors(want, p0n).normalize(); // so that n x P0 runs along want
      o.q.setFromUnitVectors(AY, n);
      const local = P0.clone().applyQuaternion(o.q.clone().invert());
      o.base = Math.atan2(local.z, local.x);
      // check the sense of rotation; flip the motion if needed
      const ahead = this.orbitPoint(o, o.base + 0.01, new THREE.Vector3()).sub(P0);
      if (ahead.dot(want) < 0) { o.sweep = -Math.abs(o.sweep); o.drift = -Math.abs(o.drift); }
      else { o.sweep = Math.abs(o.sweep); o.drift = Math.abs(o.drift); }
      if (o.line) {
        o.line.quaternion.copy(o.q);
        o.line.scale.setScalar(o.R / (o.line.userData.R0 ?? (o.line.userData.R0 = (o.line.geometry.getAttribute("position") as THREE.BufferAttribute).getX(0))));
      }
    };
    for (const b of this.bodies) if (b.orbit && b.group !== "projects" && b.group !== "flagship") solve(b.orbit);
    solve(this.omniOrbit);
    this.camAt(ROUTE_AT.flagship, 0, 1, 0, 0, cam);
    this.omniBasis[0].copy(cam.right); this.omniBasis[1].copy(cam.up); this.omniBasis[2].copy(cam.fwd);
    // ring offset: body i should sit beside the hole when card i is in focus
    {
      const o = this.ringOrbit;
      this.camAt(ROUTE_AT.projects + 0.05, 0, 1, 0, 0, cam);
      // force the reel camera for fi = 0
      const [tx, ty] = mobile ? [-0.5, 0.5] : [-0.42, 0.16];
      let best = Infinity, bestO = 0;
      const holeDist = cam.pos.length();
      for (let k = -180; k <= 180; k++) {
        const off = k * 0.5 * D2R;
        const pt = this.orbitPoint(o, RING.phase * D2R + off, this.tmp);
        const depth = this.tmp2.copy(pt).sub(cam.pos).dot(cam.fwd);
        if (depth > holeDist - 1.5) continue;   // keep it on the near side, unlensed
        const q = ndc(pt);
        if (!q) continue;
        const d = (q[0] - tx) ** 2 + (q[1] - ty) ** 2;
        if (d < best) { best = d; bestO = off; }
      }
      this.ringOffset = bestO;
    }
  }

  /* ------------------------------------------------------------ */
  /* inputs                                                        */
  /* ------------------------------------------------------------ */
  setProgress(p: number) { this.target = clamp01(p); this.dirty = true; }
  /** fractional index of the project card in focus (0..projects.length - 1) */
  setReel(fi: number) { this.reel = fi; this.dirty = true; }
  setAgent(i: number) { this.activeAgent = i; this.dirty = true; }
  setPointer(x: number, y: number) { this.pointer.set(x, y); this.dirty = true; }
  setIntro(v: number) { this.intro = v; this.dirty = true; }
  /** jump straight to the current target (used by automated screenshots) */
  snap() { this.progress = this.target; this.reelSmooth = this.reel; this.pull = 0; this.pullHold = 4; this.dirty = true; for (const g of this.groups.values()) g.vis = win(...g.window, this.target); }
  registerTag(id: string, el: HTMLElement | null) {
    const b = this.bodies.find((x) => x.id === id);
    if (b) b.tag = el ?? undefined;
  }

  /* ------------------------------------------------------------ */
  /* camera                                                        */
  /* ------------------------------------------------------------ */
  private isMobileLayout() { return this.opts.mobile || this.w / this.h < 0.9; }

  /** camera state at progress p (pure: used for rendering and for solving placements) */
  private camAt(p: number, reel: number, intro: number, px: number, py: number, out: CamState) {
    const k = sampleKeys(p);
    const aspect = this.w / this.h;
    const mobile = this.isMobileLayout();

    // project reel: the camera rides the ring so each body passes it as its card is read
    // fully on the ring by the time the reel pins, so body 01 already sits beside the hole
    const inReel = win(ROUTE_AT.projects - 0.03, ROUTE_AT.projects - 0.002, REEL_END + 0.002, REEL_END + 0.03, p);
    let az = k.az;
    if (inReel > 0) az = az + (RING.phase - reel * RING.spacing - az) * inReel;

    // intro: fall in from far out
    const e = 1 - Math.pow(1 - intro, 3);
    // phones: sit a little closer so the hole reads at a small width
    let r = k.r * (1 + (1 - e) * 4.2) * (mobile ? 1 - 0.2 * (1 - smooth(0.86, 0.95, p)) : 1);
    az += (1 - e) * -75 + px * 4.5;
    const incl = k.incl + (1 - e) * 16 - py * 3;
    r = Math.max(r, 1.6);

    const ci = Math.cos(incl * D2R);
    out.pos.set(ci * Math.cos(az * D2R) * r, Math.sin(incl * D2R) * r, ci * Math.sin(az * D2R) * r);
    out.fwd.copy(out.pos).multiplyScalar(-1).normalize();
    out.right.crossVectors(out.fwd, AY).normalize();
    out.up.crossVectors(out.right, out.fwd).normalize();
    const roll = k.roll * D2R;
    if (roll) {
      out.right.applyAxisAngle(out.fwd, roll);
      out.up.applyAxisAngle(out.fwd, roll);
    }
    // field of view: wide on phones; at the end it opens up so the photon
    // ring frames the contact view
    let tan = mobile ? Math.max(0.33, 0.28 / aspect) : 0.33;
    const near = smooth(0.94, 1.0, p);
    if (near > 0) {
      const target = mobile ? 0.64 : 0.9;
      const want = Math.tan(shadowAngle(r)) / target;
      tan = tan + (Math.max(tan, want) - tan) * near;
    }
    out.tan = tan;
    out.aspect = aspect;
    out.sx = mobile ? 0 : k.sx;
    out.sy = mobile ? k.my : k.sy;
    return out;
  }

  private placeCamera() {
    const c = this.camAt(this.progress, this.reelSmooth, this.intro,
      this.opts.reduce ? 0 : this.pointerS.x, this.opts.reduce ? 0 : this.pointerS.y, this.liveCam);
    this.camPos.copy(c.pos);
    this.fwd.copy(c.fwd);
    this.right.copy(c.right);
    this.up.copy(c.up);
    this.tanHalf = c.tan;
    this.shift.set(c.sx, c.sy);
    const tan = c.tan, aspect = c.aspect;

    // overlay camera, matched to the ray tracer (including the lens shift)
    const cam = this.camera;
    cam.position.copy(this.camPos);
    const m = this.basis.makeBasis(this.right, this.up, this.tmp.copy(this.fwd).negate());
    cam.quaternion.setFromRotationMatrix(m);
    cam.fov = (2 * Math.atan(tan)) / D2R;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = -this.shift.x;
    cam.projectionMatrix.elements[9] = -this.shift.y;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld();
  }

  /* ------------------------------------------------------------ */
  /* loop                                                          */
  /* ------------------------------------------------------------ */
  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    const c0 = performance.now();
    const t = (c0 - this.t0) / 1000;
    this.dt = Math.min(0.1, Math.max(0.001, t - this.lastT));
    this.lastT = t;
    if (this.opts.reduce && !this.dirty && Math.abs(this.target - this.progress) < 1e-5) return;
    this.dirty = false;
    this.adapt(t);

    const before = this.progress;
    this.progress += (this.target - this.progress) * (this.opts.reduce ? 1 : 1 - Math.exp(-this.dt * 3.2));
    this.reelSmooth += (this.reel - this.reelSmooth) * (this.opts.reduce ? 1 : 1 - Math.exp(-this.dt * 5));
    // the card counter follows the same index the labels use, so they always agree
    const ri = Math.max(0, Math.min(projects.length - 1, Math.round(this.reelSmooth)));
    if (ri !== this.reelIdx) { this.reelIdx = ri; this.onReel?.(ri); }
    const speed = Math.abs(this.progress - before) / this.dt;
    this.pull += (Math.min(1, speed * 6) - this.pull) * (1 - Math.exp(-this.dt * 5));
    if (this.pullHold > 0) { this.pullHold--; this.pull = 0; }
    this.pointerS.lerp(this.pointer, 1 - Math.exp(-this.dt * 2.5));
    this.placeCamera();

    // time slows as you fall in (gravitational time dilation, exaggerated)
    const r = this.camPos.length();
    const clock = Math.sqrt(Math.max(0, 1 - 1 / r));
    if (!this.opts.reduce) this.diskTime += this.dt * Math.pow(clock, 4) * 1.0;
    this.placeBodies(this.opts.reduce ? 0 : t, this.progress);
    this.updateGroups(t);
    this.uploadBodies();
    this.updateTags();

    const u = this.holeMat.uniforms;
    u.uCamPos.value.copy(this.camPos);
    u.uCamRight.value.copy(this.right);
    u.uCamUp.value.copy(this.up);
    u.uCamFwd.value.copy(this.fwd);
    u.uTanHalf.value = this.tanHalf;
    u.uAspect.value = this.w / this.h;
    u.uShift.value.copy(this.shift);
    u.uDiskTime.value = this.diskTime;
    u.uTime.value = t;
    u.uPixAngle.value = (2 * this.tanHalf) / this.rtHole.height;
    u.uStarGain.value = 1 - 0.88 * smooth(0.9, 1, this.progress);
    u.uRingGain.value = 1 + 1.2 * smooth(0.95, 1, this.progress);

    const p = this.progress;
    const cu = this.compMat.uniforms;
    // the crossing: ripple while the shadow swallows the screen, then calm
    const warp = win(0.885, 0.94, 0.955, 0.995, p) + (1 - this.intro) * 0.9;
    cu.uWarp.value = this.opts.reduce ? 0 : warp;
    cu.uPull.value = this.opts.reduce ? 0 : this.pull * (1 - smooth(0.95, 1, p));
    cu.uCenter.value.set(this.shift.x * 0.5 + 0.5, this.shift.y * 0.5 + 0.5);
    cu.uAspect.value = this.w / this.h;
    cu.uTime.value = t;
    cu.uExposure.value = 1.0 - 0.15 * smooth(0.95, 1, p);
    cu.uFade.value = smooth(0, 0.35, this.intro);
    cu.uBloom.value = this.bloom ? 1 : 0;

    this.renderAll();
    this.frames++;
    this.frameCost = performance.now() - c0;
    if (this.onTelemetry) this.onTelemetry({ r, clock });
  };

  private updateGroups(t: number) {
    const p = this.progress;
    for (const g of this.groups.values()) {
      const [a, b, c, d] = g.window;
      const target = win(a, b, c, d, p);
      g.vis += (target - g.vis) * (this.opts.reduce ? 1 : 1 - Math.exp(-this.dt * 4));
      g.clock = g.vis < 0.005 ? 0 : g.clock + (this.opts.reduce ? 0 : this.dt);
      for (const l of g.lines) {
        const m = l.material as THREE.ShaderMaterial;
        m.uniforms.uAlpha.value = g.vis * g.lineAlpha;
        m.uniforms.uCam.value.copy(this.camPos);
        m.uniforms.uTime.value = t;
        l.visible = g.vis > 0.01;
      }
    }
    for (const b of this.bodies) {
      const g = this.groups.get(b.group)!;
      b.vis = g.vis;
      const i = Number(b.id.split("-")[1]);
      if (b.group === "projects") b.highlight = Math.exp(-Math.pow(this.reelSmooth - i, 2) * 5) * 0.6;
      else if (b.group === "flagship") b.highlight = this.activeAgent === i ? 0.45 : 0;
      else b.highlight = 0;
    }
    // flagship graph: each part hands over to the next, and the last closes the loop
    const ag = this.agents ??= this.bodies.filter((b) => b.group === "flagship");
    const pos = this.agentEdges.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k <= ag.length; k++) { const b = ag[k % ag.length].pos; pos.setXYZ(k, b.x, b.y, b.z); }
    pos.needsUpdate = true;
  }

  private visible: Body[] = [];
  private uploadBodies() {
    const u = this.holeMat.uniforms;
    const list = this.visible;
    list.length = 0;
    for (const b of this.bodies) if (b.vis > 0.01) list.push(b);
    if (list.length > MAX_BODIES) {
      list.sort((a, b) => b.vis - a.vis || a.pos.distanceToSquared(this.camPos) - b.pos.distanceToSquared(this.camPos));
      list.length = MAX_BODIES;
    }
    const B = u.uBody.value as THREE.Vector4[], C = u.uBodyCol.value as THREE.Vector4[];
    const I = u.uBodyInfo.value as THREE.Vector4[], X = u.uBodyAxis.value as THREE.Vector4[];
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      const e = 1 - Math.pow(1 - b.vis, 3);
      B[k].set(b.pos.x, b.pos.y, b.pos.z, this.bodyRadius(b));
      C[k].set(b.color.r, b.color.g, b.color.b, b.emissive);
      I[k].set(b.kind, b.highlight, b.seed, b.glow * e);
      X[k].set(b.axis.x, b.axis.y, b.axis.z, b.beam * e);
    }
    u.uBodyCount.value = list.length;
  }

  private lv = new THREE.Vector3();
  private lh = new THREE.Vector3();
  /** where a body appears: point-lens primary image (bodies behind the hole are bent outward) */
  private lensed(p: THREE.Vector3, out: THREE.Vector3) {
    const rel = this.lv.copy(p).sub(this.camPos);
    const Ds = rel.length();
    const Dl = this.camPos.length();
    const h = this.lh.copy(this.camPos).multiplyScalar(-1 / Dl);
    const Dls = rel.dot(h) - Dl;
    if (Dls <= 0) return out.copy(p);
    rel.divideScalar(Ds);
    const beta = Math.acos(Math.min(1, Math.max(-1, rel.dot(h))));
    if (beta < 1e-4) return out.copy(p);
    const e2 = (2 * Dls) / (Dl * Ds);
    const theta = (beta + Math.sqrt(beta * beta + 4 * e2)) / 2;
    // rotate the hole direction towards the body by theta
    const perp = rel.addScaledVector(h, -Math.cos(beta)).normalize();
    return out.copy(h).multiplyScalar(Math.cos(theta)).addScaledVector(perp, Math.sin(theta)).multiplyScalar(Ds).add(this.camPos);
  }
  private updateTags() {
    const W = this.w, H = this.h;
    const hx = (this.shift.x * 0.5 + 0.5) * W;
    const pxPerUnit = H / (2 * this.tanHalf);
    for (const b of this.bodies) {
      const el = b.tag;
      if (!el) continue;
      let a = b.vis;
      if (b.tagMode === "active") a *= smooth(0.25, 0.55, b.highlight);
      if (a < 0.01) { if (el.style.opacity !== "0") el.style.opacity = "0"; continue; }
      const v = this.lensed(b.pos, this.tmp).project(this.camera);
      // hidden behind the shadow?
      const toB = this.tmp2.copy(b.pos).sub(this.camPos);
      const L = toB.length();
      const dir = toB.divideScalar(L);
      const s = Math.min(L, Math.max(0, -this.camPos.dot(dir)));
      const dc = this.tmp3.copy(this.camPos).addScaledVector(dir, s).length();
      if (s > 0.01 && s < L - 0.01) a *= smooth(2.7, 3.6, dc);
      if (v.z > 1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02) a = 0;
      const x = (v.x * 0.5 + 0.5) * W, y = (0.5 - v.y * 0.5) * H;
      // the marker ring wraps the body as drawn, and the label starts outside it
      const ring = Math.round(Math.min(90, Math.max(b.group === "projects" ? 15 : 9, (this.bodyRadius(b) / L) * pxPerUnit + 7)));
      if (el.dataset.r !== String(ring)) { el.dataset.r = String(ring); el.style.setProperty("--r", `${ring}px`); }
      // labels point away from the hole, unless that would run off screen
      let left = x < hx && b.group !== "projects";
      if (left && x < 230) left = false;
      else if (!left && x > W - 230) left = true;
      const side = left ? "l" : "r";
      if (el.dataset.side !== side) { el.dataset.side = side; el.classList.toggle("tag--l", left); }
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = a.toFixed(3);
    }
  }

  /** radius a body is drawn with (it grows in as its section arrives) */
  private bodyRadius(b: Body) {
    const e = 1 - Math.pow(1 - b.vis, 3);
    // the project in focus swells a little; the rest stay small
    const grow = b.group === "projects" ? 0.7 + b.highlight * 0.85 : 1;
    return Math.max(0.001, b.radius * e * grow);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  private renderAll() {
    this.pass(this.holeMat, this.rtHole);
    if (this.bloom) {
      const bm = this.brightMat.uniforms;
      bm.tSrc.value = this.rtHole.texture;
      bm.uTexel.value.set(1 / this.rtHole.width, 1 / this.rtHole.height);
      this.pass(this.brightMat, this.rtB1);
      const bl = this.blurMat.uniforms;
      bl.tSrc.value = this.rtB1.texture; bl.uDir.value.set(1 / this.rtB1.width, 0); this.pass(this.blurMat, this.rtB1b);
      bl.tSrc.value = this.rtB1b.texture; bl.uDir.value.set(0, 1 / this.rtB1.height); this.pass(this.blurMat, this.rtB1);
      const dm = this.downMat.uniforms;
      dm.tSrc.value = this.rtB1.texture; dm.uTexel.value.set(0.5 / this.rtB1.width, 0.5 / this.rtB1.height);
      this.pass(this.downMat, this.rtB2);
      bl.tSrc.value = this.rtB2.texture; bl.uDir.value.set(1.5 / this.rtB2.width, 0); this.pass(this.blurMat, this.rtB2b);
      bl.tSrc.value = this.rtB2b.texture; bl.uDir.value.set(0, 1.5 / this.rtB2.height); this.pass(this.blurMat, this.rtB2);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.pass(this.compMat, null);
    this.renderer.render(this.lineScene, this.camera);
  }

  /* dynamic resolution: the hole is traced at a fraction of the screen and
   * upscaled; the fraction follows the frame rate */
  private adapt(t: number) {
    if (this.opts.fixRes || t < 1.5) return;
    this.ema += (this.dt - this.ema) * 0.08;
    if (t - this.lastScaleChange < 0.6) return;
    if (this.ema > 1 / 48 && this.scale > this.minScale + 1e-3) {
      this.scale = Math.max(this.minScale, this.scale * 0.85);
      this.lastScaleChange = t;
      this.sizeTargets();
    } else if (this.ema < 1 / 57 && this.scale < this.maxScale - 1e-3 && t - this.lastScaleChange > 2.5) {
      this.scale = Math.min(this.maxScale, this.scale * 1.08);
      this.lastScaleChange = t;
      this.sizeTargets();
    }
    // still slow at the lowest resolution: drop bloom and march fewer steps
    if (!this.degraded && this.scale <= this.minScale + 1e-3 && this.ema > 1 / 30) {
      this.slowFor += this.dt;
      if (this.slowFor > 3) {
        this.degraded = true;
        this.bloom = false;
        this.holeMat.uniforms.uMaxSteps.value = 110;
        this.holeMat.uniforms.uStepScale.value = 1.4;
        this.dpr = 1;
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(this.w, this.h, false);
        this.onDegrade?.();
      }
    } else this.slowFor = Math.max(0, this.slowFor - this.dt);
  }

  private sizeTargets() {
    const hw = Math.max(64, Math.round(this.w * this.scale));
    const hh = Math.max(64, Math.round(this.h * this.scale));
    this.rtHole.setSize(hw, hh);
    this.compMat.uniforms.uHoleRes.value.set(hw, hh);
    // stars are about one traced pixel wide: at low trace resolution they get
    // big when upscaled, so dim them to keep the sky from turning to snow
    this.holeMat.uniforms.uStarDim.value = Math.min(1, Math.pow(this.scale / 0.6, 1.5));
    const b1w = Math.max(16, Math.round(this.w / 8)), b1h = Math.max(16, Math.round(this.h / 8));
    this.rtB1.setSize(b1w, b1h); this.rtB1b.setSize(b1w, b1h);
    this.rtB2.setSize(Math.max(8, b1w >> 1), Math.max(8, b1h >> 1));
    this.rtB2b.setSize(Math.max(8, b1w >> 1), Math.max(8, b1h >> 1));
    this.dirty = true;
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = this.degraded ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.sizeTargets();
    this.solvePlacements();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now() - this.lastT * 1000;
    this.frame();
  }

  /** compile and render one frame behind the loader */
  warm() {
    this.placeCamera();
    this.placeBodies(0, this.progress);
    this.updateGroups(0);
    this.uploadBodies();
    this.renderer.compile(this.quadScene, this.quadCam);
    this.renderAll();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    [this.rtHole, this.rtB1, this.rtB1b, this.rtB2, this.rtB2b].forEach((r) => r.dispose());
    [this.holeMat, this.brightMat, this.downMat, this.blurMat, this.compMat].forEach((m) => m.dispose());
    this.lineScene.traverse((o) => {
      const l = o as THREE.Line;
      l.geometry?.dispose();
      (l.material as THREE.Material | undefined)?.dispose?.();
    });
    this.quad.geometry.dispose();
    this.renderer.dispose();
  }
}
