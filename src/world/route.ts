/* The journey: one story progress value p (0 = hero, 1 = contact) drives
 * the camera's orbit around the hole. Each section owns an anchor on p, so
 * its scene moment is framed exactly when its panel is centred. */

import { featured, projects, publications } from "../data/content";

const ALL_SECTIONS = [
  { id: "about", label: "About" },
  { id: "experience", label: "Experience" },
  { id: "flagship", label: featured.title },
  { id: "projects", label: "Projects" },
  { id: "research", label: "Research" },
  { id: "toolkit", label: "Toolkit" },
  { id: "contact", label: "Contact" },
] as const;
export type SectionId = (typeof ALL_SECTIONS)[number]["id"];
/** sections that have content (Research hides itself when there are no publications) */
export const SECTIONS: { id: SectionId; label: string }[] = ALL_SECTIONS.filter(
  (s) => s.id !== "research" || publications.length > 0,
);

/** anchor on p for each section; the project reel spans a range */
export const ROUTE_AT: Record<SectionId, number> = {
  about: 0.11,
  experience: 0.23,
  flagship: 0.355,
  projects: 0.46,
  research: 0.74,
  toolkit: 0.85,
  contact: 1,
};
export const REEL_END = 0.64;

/** project ring geometry: one body per project, S degrees apart around the
 *  whole ring; the camera rides the ring as the reel advances */
const NP = Math.max(1, projects.length);
export const RING = { phase: 130, spacing: 360 / NP, offset: 7 };

type Key = {
  p: number;
  r: number;      // orbital radius in Schwarzschild radii
  incl: number;   // degrees above the disk plane
  az: number;     // degrees around the hole
  roll: number;   // degrees
  sx: number;     // lens shift: where the hole sits on screen (desktop)
  sy: number;
  my: number;     // vertical lens shift on phones
  linear?: boolean;
};

const PA = RING.phase, S = RING.spacing;
/** azimuth where the reel leaves the ring: a little past the last body */
const OUT = PA - (NP + 0.2) * S;
export const KEYS: Key[] = [
  { p: 0.0, r: 30, incl: 7, az: 0, roll: -7, sx: 0.4, sy: 0.04, my: 0.5 },
  { p: 0.11, r: 26, incl: 15, az: 26, roll: 4, sx: 0.42, sy: 0.02, my: 0.44 },
  { p: 0.23, r: 22.5, incl: 25, az: 60, roll: -5, sx: -0.42, sy: 0.02, my: 0.44 },
  { p: 0.355, r: 19, incl: 11, az: 96, roll: 3, sx: 0.4, sy: 0.02, my: 0.44 },
  { p: 0.46, r: 15, incl: 4.5, az: PA + 1.2 * S, roll: 0, sx: 0.12, sy: 0.38, my: 0.5, linear: true },
  { p: 0.64, r: 15, incl: 4.5, az: OUT, roll: 0, sx: 0.12, sy: 0.38, my: 0.5 },
  { p: 0.74, r: 12, incl: 17, az: OUT - 34, roll: -5, sx: -0.4, sy: 0.02, my: 0.44 },
  { p: 0.85, r: 10.5, incl: 40, az: OUT - 70, roll: 5, sx: 0.46, sy: 0.08, my: 0.44 },
  { p: 0.935, r: 3.3, incl: 14, az: OUT - 110, roll: -2, sx: 0.05, sy: 0, my: 0.15 },
  { p: 1.0, r: 2.05, incl: 9, az: OUT - 128, roll: 0, sx: 0, sy: 0, my: 0 },
];

export type Cam = { r: number; incl: number; az: number; roll: number; sx: number; sy: number; my: number };

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function sampleKeys(p: number): Cam {
  const x = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < KEYS.length - 2 && x > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t0 = Math.min(1, Math.max(0, (x - a.p) / (b.p - a.p)));
  const t = a.linear ? t0 : smoother(t0);
  const l = (u: number, v: number) => u + (v - u) * t;
  return {
    r: Math.exp(l(Math.log(a.r), Math.log(b.r))),
    incl: l(a.incl, b.incl),
    az: l(a.az, b.az),
    roll: l(a.roll, b.roll),
    sx: l(a.sx, b.sx),
    sy: l(a.sy, b.sy),
    my: l(a.my, b.my),
  };
}

/** angular radius of the shadow seen by a static observer at radius r (rs = 1) */
export function shadowAngle(r: number) {
  const s = (2.598076 * Math.sqrt(Math.max(0, 1 - 1 / r))) / r;
  return s >= 1 ? Math.PI / 2 : Math.asin(s);
}
