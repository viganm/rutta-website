/**
 * Map geometry. Everything is in Web Mercator pixels at zoom 9, relative to
 * the data frame's top-left (see scripts/build-map.ts), so routes, contours
 * and labels share one plane and the camera is a single scale + offset.
 */
import routesJson from '../../data/routes.json' with { type: 'json' };

export type Pt = { x: number; y: number };

export interface StopData {
  name: string;
  town: string;
  x: number;
  y: number;
  /** Distance along the route line where the stop sits. */
  at: number;
  legKm: number;
  legMin: number;
}

export interface RouteData {
  slot: number;
  name: string;
  driver: string;
  plate: string;
  vehicle: string;
  km: number;
  minutes: number;
  line: number[];
  length: number;
  stops: StopData[];
}

interface DemoData {
  frame: { zoom: number; origin: [number, number]; size: [number, number] };
  depot: [number, number];
  routes: RouteData[];
}

export const demo = routesJson as unknown as DemoData;
export const depot: Pt = { x: demo.depot[0], y: demo.depot[1] };

const WORLD = 256 * 2 ** demo.frame.zoom;
const [X0, Y0] = demo.frame.origin;

export function project(lng: number, lat: number): Pt {
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * WORLD - X0,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD - Y0,
  };
}

export function unproject(x: number, y: number): { lng: number; lat: number } {
  const lng = ((x + X0) / WORLD) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * (y + Y0)) / WORLD;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lng, lat };
}

/** Metres per map unit at a latitude (for the scale bar). */
export function metresPerUnit(lat: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / WORLD;
}

/** A polyline with cumulative lengths, for walking a van along it. */
export class Polyline {
  readonly xs: Float32Array;
  readonly cum: Float32Array;
  readonly length: number;

  constructor(flat: number[]) {
    this.xs = Float32Array.from(flat);
    const n = flat.length / 2;
    this.cum = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const dx = this.xs[i * 2]! - this.xs[i * 2 - 2]!;
      const dy = this.xs[i * 2 + 1]! - this.xs[i * 2 - 1]!;
      this.cum[i] = this.cum[i - 1]! + Math.hypot(dx, dy);
    }
    this.length = this.cum[n - 1] ?? 0;
  }

  get count(): number {
    return this.cum.length;
  }

  /** Index of the segment that contains distance d. */
  segment(d: number): number {
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= d) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Point and heading (radians) at distance d, heading smoothed over a short window. */
  at(d: number): Pt & { angle: number } {
    const dd = Math.max(0, Math.min(this.length, d));
    const p = this.pointAt(dd);
    const a = this.pointAt(Math.max(0, dd - 0.35));
    const b = this.pointAt(Math.min(this.length, dd + 0.35));
    return { ...p, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  pointAt(d: number): Pt {
    const i = this.segment(d);
    const span = this.cum[i + 1]! - this.cum[i]! || 1;
    const t = Math.max(0, Math.min(1, (d - this.cum[i]!) / span));
    return {
      x: this.xs[i * 2]! + (this.xs[i * 2 + 2]! - this.xs[i * 2]!) * t,
      y: this.xs[i * 2 + 1]! + (this.xs[i * 2 + 3]! - this.xs[i * 2 + 1]!) * t,
    };
  }

  /** Trace the line from d0 to d1 into the current canvas path. */
  trace(ctx: CanvasRenderingContext2D | Path2D, d0: number, d1: number): void {
    if (d1 <= d0) return;
    const i0 = this.segment(d0);
    const i1 = this.segment(d1);
    const p0 = this.pointAt(d0);
    ctx.moveTo(p0.x, p0.y);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(this.xs[i * 2]!, this.xs[i * 2 + 1]!);
    const p1 = this.pointAt(d1);
    ctx.lineTo(p1.x, p1.y);
  }

  bbox(d0 = 0, d1 = this.length): [number, number, number, number] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const i0 = this.segment(d0);
    const i1 = this.segment(d1);
    for (let i = i0; i <= i1 + 1 && i < this.count; i++) {
      minX = Math.min(minX, this.xs[i * 2]!);
      maxX = Math.max(maxX, this.xs[i * 2]!);
      minY = Math.min(minY, this.xs[i * 2 + 1]!);
      maxY = Math.max(maxY, this.xs[i * 2 + 1]!);
    }
    return [minX, minY, maxX, maxY];
  }
}

/**
 * Parses the builder's compact path data ("M x y l dx dy … z") into rings of
 * absolute points.
 */
export function parseRings(d: string): Float32Array[] {
  const rings: Float32Array[] = [];
  const tokens = d.match(/[Mlz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let current: number[] = [];
  let x = 0;
  let y = 0;
  let cmd = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok === 'M' || tok === 'l' || tok === 'z') {
      cmd = tok;
      if (tok === 'M' && current.length) {
        rings.push(Float32Array.from(current));
        current = [];
      }
      if (tok === 'z' && current.length) {
        current.push(current[0]!, current[1]!);
      }
      continue;
    }
    const a = Number(tok);
    const b = Number(tokens[++i]);
    if (cmd === 'M') {
      x = a;
      y = b;
    } else {
      x += a;
      y += b;
    }
    current.push(x, y);
  }
  if (current.length) rings.push(Float32Array.from(current));
  return rings;
}

/** Rings into a Path2D, smoothed through segment midpoints so simplified lines read as curves. */
export function smoothPath(rings: Float32Array[], target = new Path2D()): Path2D {
  for (const r of rings) {
    const n = r.length / 2;
    if (n < 2) continue;
    target.moveTo(r[0]!, r[1]!);
    if (n === 2) {
      target.lineTo(r[2]!, r[3]!);
      continue;
    }
    for (let i = 1; i < n - 1; i++) {
      const x = r[i * 2]!;
      const y = r[i * 2 + 1]!;
      target.quadraticCurveTo(x, y, (x + r[i * 2 + 2]!) / 2, (y + r[i * 2 + 3]!) / 2);
    }
    target.lineTo(r[n * 2 - 2]!, r[n * 2 - 1]!);
  }
  return target;
}

export function ringsBox(rings: Float32Array[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      minX = Math.min(minX, r[i]!);
      maxX = Math.max(maxX, r[i]!);
      minY = Math.min(minY, r[i + 1]!);
      maxY = Math.max(maxY, r[i + 1]!);
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Town labels: Albanian names, tier 1 shows first. */
export const places: { name: string; lng: number; lat: number; tier: 1 | 2 | 3 }[] = [
  { name: 'Prishtinë', lng: 21.1655, lat: 42.6629, tier: 1 },
  { name: 'Prizren', lng: 20.7397, lat: 42.2139, tier: 1 },
  { name: 'Pejë', lng: 20.2887, lat: 42.6593, tier: 1 },
  { name: 'Gjakovë', lng: 20.4308, lat: 42.3803, tier: 1 },
  { name: 'Mitrovicë', lng: 20.8667, lat: 42.8833, tier: 1 },
  { name: 'Ferizaj', lng: 21.1553, lat: 42.37, tier: 1 },
  { name: 'Gjilan', lng: 21.4694, lat: 42.4639, tier: 1 },
  { name: 'Podujevë', lng: 21.1931, lat: 42.9106, tier: 2 },
  { name: 'Vushtrri', lng: 20.9675, lat: 42.8231, tier: 2 },
  { name: 'Suharekë', lng: 20.8253, lat: 42.3592, tier: 2 },
  { name: 'Rahovec', lng: 20.6547, lat: 42.3994, tier: 2 },
  { name: 'Lipjan', lng: 21.1386, lat: 42.5217, tier: 2 },
  { name: 'Kamenicë', lng: 21.5803, lat: 42.5781, tier: 2 },
  { name: 'Deçan', lng: 20.2875, lat: 42.5403, tier: 2 },
  { name: 'Istog', lng: 20.4875, lat: 42.7808, tier: 2 },
  { name: 'Klinë', lng: 20.5778, lat: 42.6203, tier: 2 },
  { name: 'Kaçanik', lng: 21.2592, lat: 42.2319, tier: 2 },
  { name: 'Dragash', lng: 20.6531, lat: 42.0619, tier: 2 },
  { name: 'Viti', lng: 21.3581, lat: 42.3214, tier: 2 },
  { name: 'Skenderaj', lng: 20.7889, lat: 42.7467, tier: 3 },
  { name: 'Drenas', lng: 20.8939, lat: 42.6264, tier: 3 },
  { name: 'Malishevë', lng: 20.7458, lat: 42.4828, tier: 3 },
  { name: 'Shtime', lng: 21.0397, lat: 42.4333, tier: 3 },
  { name: 'Graçanicë', lng: 21.1933, lat: 42.6, tier: 3 },
  { name: 'Shtërpcë', lng: 21.0272, lat: 42.2392, tier: 3 },
  { name: 'Fushë Kosovë', lng: 21.093, lat: 42.637, tier: 3 },
];

/** Neighbouring cities for context outside Kosovo; names per language. */
export const neighbours: { sq: string; en: string; lng: number; lat: number }[] = [
  { sq: 'Shkup', en: 'Skopje', lng: 21.4314, lat: 41.9973 },
  { sq: 'Tetovë', en: 'Tetovo', lng: 20.9715, lat: 42.0069 },
  { sq: 'Kukës', en: 'Kukës', lng: 20.4214, lat: 42.0767 },
  { sq: 'Novi Pazar', en: 'Novi Pazar', lng: 20.5122, lat: 43.1367 },
  { sq: 'Podgoricë', en: 'Podgorica', lng: 19.2594, lat: 42.4304 },
  { sq: 'Peshkopi', en: 'Peshkopi', lng: 20.4289, lat: 41.6853 },
  { sq: 'Nish', en: 'Niš', lng: 21.8958, lat: 43.3209 },
  { sq: 'Vranjë', en: 'Vranje', lng: 21.9003, lat: 42.5514 },
  { sq: 'Shkodër', en: 'Shkodër', lng: 19.5126, lat: 42.0683 },
];
