/**
 * The Hartë map, drawn on canvas: real contours, water, roads and (close up)
 * Prishtinë's streets in a cached static layer; routes, stops, the depot and
 * the vans redrawn every frame on top. One renderer serves the night wall
 * screen and the paper maps further down the page.
 */
import { routeColors } from '../../brand/routes.ts';
import baseUrl from '../../data/map-base.json?url';
import streetsUrl from '../../data/map-streets.json?url';
import {
  depot,
  neighbours,
  parseRings,
  places,
  project,
  ringsBox,
  smoothPath,
  type Polyline,
  type Pt,
} from './geo.ts';
import type { StopState } from '../sim.ts';

export type Theme = 'night' | 'paper';
export type Box = [number, number, number, number];
export type Camera = { x: number; y: number; z: number };
export type Pad = { top: number; right: number; bottom: number; left: number };

const palettes = {
  night: {
    bg: '#0E1A17',
    contour: '168 206 189',
    contourA: [0.07, 0.17],
    veil: 'rgba(10, 20, 17, 0.55)',
    border: 'rgba(201, 214, 207, 0.42)',
    river: 'rgba(96, 160, 178, 0.5)',
    lake: 'rgba(44, 92, 106, 0.6)',
    major: 'rgba(201, 214, 207, 0.2)',
    primary: 'rgba(201, 214, 207, 0.1)',
    streetMain: 'rgba(201, 214, 207, 0.24)',
    streetMinor: 'rgba(201, 214, 207, 0.11)',
    label: 'rgba(184, 200, 191, 0.78)',
    labelStrong: '#E7EFEA',
    labelFar: 'rgba(151, 170, 160, 0.5)',
    halo: '#0E1A17',
    routes: routeColors.dark,
    casing: '#0A1411',
    cab: '#E7EFEA',
    glass: '#0E1A17',
    depot: '#E7EFEA',
    failed: '#FF8A7A',
    neutral: '#97AAA0',
    order: '#E7EFEA',
    shadow: 'rgba(0, 0, 0, 0.45)',
  },
  paper: {
    bg: '#F1F4F0',
    contour: '86 99 93',
    contourA: [0.12, 0.26],
    veil: 'rgba(241, 244, 240, 0.6)',
    border: 'rgba(63, 75, 69, 0.5)',
    river: 'rgba(64, 128, 158, 0.45)',
    lake: 'rgba(150, 192, 208, 0.5)',
    major: 'rgba(63, 75, 69, 0.24)',
    primary: 'rgba(63, 75, 69, 0.13)',
    streetMain: 'rgba(63, 75, 69, 0.3)',
    streetMinor: 'rgba(63, 75, 69, 0.15)',
    label: 'rgba(63, 75, 69, 0.85)',
    labelStrong: '#121A17',
    labelFar: 'rgba(86, 99, 93, 0.55)',
    halo: '#F1F4F0',
    routes: routeColors.light,
    casing: 'rgba(18, 26, 23, 0.5)',
    cab: '#FFFFFF',
    glass: '#121A17',
    depot: '#121A17',
    failed: '#B42318',
    neutral: '#77857E',
    order: '#3F4B45',
    shadow: 'rgba(18, 26, 23, 0.28)',
  },
};

interface BaseMap {
  contours: { e: number; path: Path2D }[];
  border: Path2D;
  veil: Path2D;
  kosovo: Box;
  rivers: Path2D;
  lakes: Path2D;
  major: Path2D;
  primary: Path2D;
}
interface Streets {
  main: Path2D;
  minor: Path2D;
}

let basePromise: Promise<BaseMap> | null = null;
let streetsPromise: Promise<Streets> | null = null;

export function loadBase(): Promise<BaseMap> {
  basePromise ??= fetch(baseUrl)
    .then((r) => r.json())
    .then(
      (raw: {
        border: string;
        rivers: string;
        lakes: string;
        roads: { major: string; primary: string };
        contours: { e: number; d: string }[];
      }) => {
        const borderRings = parseRings(raw.border);
        const veil = new Path2D();
        veil.rect(-20000, -20000, 40000, 40000);
        for (const r of borderRings) {
          veil.moveTo(r[0]!, r[1]!);
          for (let i = 2; i < r.length; i += 2) veil.lineTo(r[i]!, r[i + 1]!);
          veil.closePath();
        }
        return {
          contours: raw.contours.map((c) => ({ e: c.e, path: smoothPath(parseRings(c.d)) })),
          border: smoothPath(borderRings),
          veil,
          kosovo: ringsBox(borderRings),
          rivers: smoothPath(parseRings(raw.rivers)),
          lakes: smoothPath(parseRings(raw.lakes)),
          major: smoothPath(parseRings(raw.roads.major)),
          primary: smoothPath(parseRings(raw.roads.primary)),
        };
      },
    );
  return basePromise;
}

export function loadStreets(): Promise<Streets> {
  streetsPromise ??= fetch(streetsUrl)
    .then((r) => r.json())
    .then((raw: { main: string; minor: string }) => ({
      main: smoothPath(parseRings(raw.main)),
      minor: smoothPath(parseRings(raw.minor)),
    }));
  return streetsPromise;
}

export interface MapRoute {
  slot: number;
  line: Polyline;
  stops: { x: number; y: number }[];
}

export interface Van {
  slot: number;
  x: number;
  y: number;
  angle: number;
  /** 'no_signal' greys the van and stops its pulse. */
  signal: string;
  alpha: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stat = document.createElement('canvas');
  private sctx = this.stat.getContext('2d')!;
  private labelItems: {
    text: string;
    x: number;
    y: number;
    font: string;
    color: string;
    rect: [number, number, number, number];
    alpha: number;
    /** Other spots clear of markers, for stepping aside when a van parks on it. */
    spots: { x: number; y: number; rect: [number, number, number, number] }[];
    covered: number;
  }[] = [];
  /** Screen areas no label may use (the hero copy, say). Set, then call dirty(). */
  exclusions: [number, number, number, number][] = [];
  private lastFrame = 0;
  private staticKey = '';
  private base: BaseMap | null = null;
  private streets: Streets | null = null;
  private lang: 'sq' | 'en';
  w = 0;
  h = 0;
  dpr = 1;
  theme: Theme;
  cam: Camera = { x: 1000, y: 700, z: 0 };

  routes: MapRoute[] = [];
  /** Per route: how much of the line is drawn (0–1), its emphasis (0–1), the van's distance. */
  draw: number[] = [];
  focus: number[] = [];
  progress: number[] = [];
  stopStates: StopState[][] = [];
  vans: Van[] = [];
  /** 0 = stops in route colours; 1 = every stop a grey, unassigned order. */
  orders = 0;
  /** Per route, per stop: pop-in scale for the orders step. */
  pops: number[][] = [];
  layer = { routes: 1, vans: 1, stops: 1, labels: 1, depot: 1, aheadAlpha: 0.38 };
  /** Section-specific drawing in screen space, between the stops and the vans. */
  overlay: ((ctx: CanvasRenderingContext2D, now: number) => void) | null = null;
  ready: Promise<void>;
  private vanScreen: { slot: number; x: number; y: number }[] = [];

  constructor(canvas: HTMLCanvasElement, theme: Theme, lang: 'sq' | 'en') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.theme = theme;
    this.lang = lang;
    this.ready = Promise.all([
      loadBase().then((b) => {
        this.base = b;
        this.dirty();
      }),
      document.fonts.load('600 12px "Geologica Variable"').then(() => this.dirty()),
    ]).then(() => undefined);
    this.resize();
  }

  get pal() {
    return palettes[this.theme];
  }

  get k(): number {
    return 2 ** this.cam.z;
  }

  get kosovo(): Box {
    return this.base?.kosovo ?? [400, 330, 1050, 1060];
  }

  /** Per-route state is indexed by slot, so a map can show route 5 alone. */
  setRoutes(routes: MapRoute[]): void {
    this.routes = routes;
    const n = Math.max(0, ...routes.map((r) => r.slot + 1));
    this.draw = Array.from({ length: n }, () => 1);
    this.focus = Array.from({ length: n }, () => 1);
    this.progress = Array.from({ length: n }, () => 0);
    this.stopStates = [];
    this.pops = [];
    for (const r of routes) {
      this.stopStates[r.slot] = r.stops.map(() => 'pending' as StopState);
      this.pops[r.slot] = r.stops.map(() => 1);
    }
  }

  useStreets(): void {
    if (this.streets) return;
    loadStreets().then((s) => {
      this.streets = s;
      this.dirty();
    });
  }

  dirty(): void {
    this.staticKey = '';
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    // Cap the backing store: a 5K wall screen doesn't need 2× pixels to read.
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(7e6 / (w * h)));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    for (const c of [this.canvas, this.stat]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.dirty();
  }

  /** Camera that fits a box into the viewport minus padding. */
  fit(box: Box, pad: Pad, maxZ = 6): Camera {
    const aw = Math.max(40, this.w - pad.left - pad.right);
    const ah = Math.max(40, this.h - pad.top - pad.bottom);
    const k = Math.min(aw / Math.max(1, box[2] - box[0]), ah / Math.max(1, box[3] - box[1]));
    const z = Math.min(maxZ, Math.log2(k));
    const kk = 2 ** z;
    const sx = pad.left + aw / 2;
    const sy = pad.top + ah / 2;
    const mx = (box[0] + box[2]) / 2;
    const my = (box[1] + box[3]) / 2;
    return { x: mx - (sx - this.w / 2) / kk, y: my - (sy - this.h / 2) / kk, z };
  }

  toScreen(x: number, y: number): Pt {
    const k = this.k;
    return { x: (x - this.cam.x) * k + this.w / 2, y: (y - this.cam.y) * k + this.h / 2 };
  }

  toMap(sx: number, sy: number): Pt {
    const k = this.k;
    return { x: (sx - this.w / 2) / k + this.cam.x, y: (sy - this.h / 2) / k + this.cam.y };
  }

  vanAt(sx: number, sy: number): number | null {
    let best: number | null = null;
    let bestD = 22 * 22;
    for (const v of this.vanScreen) {
      const d = (v.x - sx) ** 2 + (v.y - sy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v.slot;
      }
    }
    return best;
  }

  private mapTransform(ctx: CanvasRenderingContext2D): void {
    const k = this.k;
    const d = this.dpr;
    ctx.setTransform(
      k * d,
      0,
      0,
      k * d,
      (this.w / 2 - this.cam.x * k) * d,
      (this.h / 2 - this.cam.y * k) * d,
    );
  }

  // ------------------------------------------------------------ static layer
  private renderStatic(): void {
    const key = `${this.cam.x.toFixed(3)},${this.cam.y.toFixed(3)},${this.cam.z.toFixed(4)},${this.w},${this.h},${this.dpr},${this.layer.stops > 0.01},${!!this.base},${!!this.streets}`;
    if (key === this.staticKey) return;
    this.staticKey = key;
    const ctx = this.sctx;
    const p = this.pal;
    const k = this.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, this.stat.width, this.stat.height);
    const b = this.base;
    if (!b) return;

    this.mapTransform(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Contours: higher ground draws a touch brighter, index lines heavier.
    const [a0, a1] = p.contourA as [number, number];
    for (const c of b.contours) {
      const t = clamp((c.e - 350) / 1900, 0, 1);
      const index = (c.e - 350) % 600 === 0;
      ctx.strokeStyle = `rgb(${p.contour} / ${(a0 + (a1 - a0) * t) * (index ? 1.35 : 1)})`;
      ctx.lineWidth = (index ? 1.15 : 0.75) / k;
      ctx.stroke(c.path);
    }

    ctx.fillStyle = p.lake;
    ctx.fill(b.lakes);
    ctx.strokeStyle = p.river;
    ctx.lineWidth = 1 / k;
    ctx.stroke(b.rivers);

    const streetsA = this.streets ? clamp((this.cam.z - 1.9) / 1.1, 0, 1) : 0;
    const roadsA = 1 - streetsA * 0.5;
    ctx.globalAlpha = roadsA;
    ctx.strokeStyle = p.primary;
    ctx.lineWidth = Math.max(0.9, Math.min(3, k * 0.35)) / k;
    ctx.stroke(b.primary);
    ctx.strokeStyle = p.major;
    ctx.lineWidth = Math.max(1.5, Math.min(5, k * 0.6)) / k;
    ctx.stroke(b.major);
    ctx.globalAlpha = 1;

    if (this.streets && streetsA > 0) {
      ctx.globalAlpha = streetsA;
      ctx.strokeStyle = p.streetMinor;
      ctx.lineWidth = Math.min(2.2, 0.06 * k) / k;
      ctx.stroke(this.streets.minor);
      ctx.strokeStyle = p.streetMain;
      ctx.lineWidth = Math.min(4, 0.11 * k) / k;
      ctx.stroke(this.streets.main);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = p.veil;
    ctx.fill(b.veil, 'evenodd');
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1.1 / k;
    ctx.setLineDash([5 / k, 4 / k]);
    ctx.stroke(b.border);
    ctx.setLineDash([]);

    this.placeLabels();
  }

  /**
   * Places the town labels once per camera: each tries above its town, then
   * below, right and left, and keeps clear of other labels, stop markers and
   * the depot. Drawn every frame (drawLabels) so they can step aside for vans.
   */
  private placeLabels(): void {
    const k = this.k;
    const p = this.pal;
    const ctx = this.sctx;
    const obstacles: [number, number, number, number][] = [];
    const box = (x: number, y: number, r: number) => obstacles.push([x - r, y - r, x + r, y + r]);
    if (this.layer.stops > 0.01) {
      for (const route of this.routes) {
        for (const stop of route.stops) {
          const s = this.toScreen(stop.x, stop.y);
          box(s.x, s.y, 7);
        }
      }
    }
    if (this.layer.depot > 0.01) {
      const s = this.toScreen(depot.x, depot.y);
      box(s.x, s.y, 12);
    }
    const placed: [number, number, number, number][] = [];
    const apart = (
      r: [number, number, number, number],
      others: [number, number, number, number][],
    ) => others.every(([a, b, c, e]) => r[0] >= c || r[2] <= a || r[1] >= e || r[3] <= b);
    const previous = new Map(this.labelItems.map((l) => [l.text, l.alpha]));
    this.labelItems = [];
    // Towns try eight spots, near then farther; a major town that finds no spot
    // clear of the markers may sit over one, but never over another label.
    // Vans where they are now: a label shouldn't start life under one.
    if (this.layer.vans > 0.01) {
      const size = clamp(16 * k ** 0.33, 19, 46);
      for (const v of this.vans) {
        const s = this.toScreen(v.x, v.y);
        box(s.x, s.y, size * 0.8);
      }
    }
    obstacles.push(...this.exclusions);
    const add = (
      text: string,
      x: number,
      y: number,
      size: number,
      weight: number,
      color: string,
      gap: number,
      major: boolean,
    ) => {
      if (x < -60 || y < -30 || x > this.w + 60 || y > this.h + 30) return;
      const font = `${weight} ${size}px "Geologica Variable", sans-serif`;
      ctx.font = font;
      const w = ctx.measureText(text).width + 8;
      const h = size + 4;
      const side = w / 2 + 8;
      const spots = [
        [x, y - gap],
        [x, y + gap],
        [x + side, y],
        [x - side, y],
        [x, y - gap * 2],
        [x, y + gap * 2],
        [x + side + 10, y - gap],
        [x - side - 10, y + gap],
      ];
      const rect = (lx: number, ly: number): [number, number, number, number] => [
        lx - w / 2,
        ly - h / 2,
        lx + w / 2,
        ly + h / 2,
      ];
      const free = spots.filter(([lx, ly]) => apart(rect(lx!, ly!), obstacles));
      let spot = free.find(([lx, ly]) => apart(rect(lx!, ly!), placed));
      // A major town may sit over a marker, never over another label or an exclusion.
      if (!spot && major) {
        spot = spots.find(([lx, ly]) => {
          const r = rect(lx!, ly!);
          return apart(r, placed) && apart(r, this.exclusions);
        });
      }
      if (!spot) return;
      const r = rect(spot[0]!, spot[1]!);
      placed.push(r);
      this.labelItems.push({
        text,
        x: spot[0]!,
        y: spot[1]!,
        font,
        color,
        rect: r,
        alpha: previous.get(text) ?? 1,
        // Spots to step to when a van parks on it: clear of markers first, then any outside the exclusions.
        spots: [...free, ...spots.filter((sp) => !free.includes(sp))]
          .map(([lx, ly]) => ({ x: lx!, y: ly!, rect: rect(lx!, ly!) }))
          .filter((sp) => apart(sp.rect, this.exclusions)),
        covered: 0,
      });
    };
    const street = this.cam.z > 3.4;
    for (const pl of places) {
      if (street && pl.tier > 1) continue;
      const visible = pl.tier === 1 ? k > 0.35 : pl.tier === 2 ? k > 1.05 : k > 1.9;
      if (!visible) continue;
      const pt = project(pl.lng, pl.lat);
      const s = this.toScreen(pt.x, pt.y);
      const big = pl.tier === 1;
      add(
        pl.name,
        s.x,
        s.y,
        big ? 13 : 11.5,
        big ? 620 : 520,
        big ? p.labelStrong : p.label,
        big ? 13 : 11,
        big,
      );
    }
    if (!street) {
      for (const n of neighbours) {
        const pt = project(n.lng, n.lat);
        const s = this.toScreen(pt.x, pt.y);
        add(n[this.lang], s.x, s.y, 11.5, 480, p.labelFar, 0, false);
      }
    }
  }

  /**
   * A van passing over a label is fine; one that stays there for a moment
   * makes the label step to another free spot (and fade back in there). Only
   * when no spot is free does the label fade back until the van moves on.
   */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    vans: { x: number; y: number }[],
    size: number,
    dt: number,
  ): void {
    if (this.layer.labels <= 0.01) return;
    const p = this.pal;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = p.halo;
    // The van's body (whichever way it's turned), not its pulse ring.
    const r = size * 0.72;
    const hits = (rect: [number, number, number, number]) =>
      vans.some(
        (v) => v.x + r > rect[0] && v.x - r < rect[2] && v.y + r > rect[1] && v.y - r < rect[3],
      );
    const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) =>
      a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    for (const l of this.labelItems) {
      let covered = hits(l.rect);
      l.covered = covered ? l.covered + dt : 0;
      if (l.covered > 0.35) {
        const next = l.spots.find(
          (s) =>
            !hits(s.rect) && this.labelItems.every((o) => o === l || !overlaps(o.rect, s.rect)),
        );
        if (next) {
          l.x = next.x;
          l.y = next.y;
          l.rect = next.rect;
          l.alpha = 0;
          l.covered = 0;
          covered = false;
        }
      }
      l.alpha += ((covered && l.covered > 0.35 ? 0.12 : 1) - l.alpha) * Math.min(1, dt * 7);
      ctx.globalAlpha = l.alpha * this.layer.labels;
      ctx.font = l.font;
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
    }
    ctx.globalAlpha = 1;
  }

  // ----------------------------------------------------------------- frame
  render(now: number): void {
    if (!this.w) return;
    this.renderStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.stat, 0, 0);
    if (!this.base) return;

    const p = this.pal;
    const k = this.k;
    this.mapTransform(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Routes: the driven part bright, what's ahead quieter.
    const lw = clamp(2.9 + this.cam.z * 0.7, 2.9, 6);
    if (this.layer.routes > 0.01) {
      for (const r of this.routes) {
        const a = this.layer.routes * this.focus[r.slot]!;
        const drawn = this.draw[r.slot]! * r.line.length;
        if (a < 0.01 || drawn <= 0) continue;
        const color = p.routes[r.slot % p.routes.length]!;
        const driven = Math.min(drawn, this.progress[r.slot]!);
        const path = new Path2D();
        r.line.trace(path, 0, drawn);
        ctx.globalAlpha = a * (this.theme === 'night' ? 0.9 : 0.6);
        ctx.strokeStyle = p.casing;
        ctx.lineWidth = (lw + 2.4) / k;
        ctx.stroke(path);
        if (driven < drawn) {
          const ahead = new Path2D();
          r.line.trace(ahead, driven, drawn);
          ctx.globalAlpha = a * this.layer.aheadAlpha;
          ctx.strokeStyle = color;
          ctx.lineWidth = lw / k;
          ctx.stroke(ahead);
        }
        if (driven > 0) {
          const done = new Path2D();
          r.line.trace(done, 0, driven);
          ctx.globalAlpha = a;
          ctx.strokeStyle = color;
          ctx.lineWidth = lw / k;
          ctx.stroke(done);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Vans' screen positions first: labels make way for them.
    const vanSize = clamp(16 * k ** 0.33, 19, 46);
    const vanPts = this.layer.vans > 0.01 ? this.vans.map((v) => this.toScreen(v.x, v.y)) : [];
    const dt = Math.min(0.1, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    this.drawLabels(ctx, vanPts, vanSize, dt);

    // Everything else is drawn in screen space at a constant size.
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);

    if (this.layer.stops > 0.01) this.renderStops(ctx, k);
    if (this.layer.depot > 0.01) {
      const s = this.toScreen(depot.x, depot.y);
      const size = clamp(5 + this.cam.z * 1.2, 5, 10);
      ctx.globalAlpha = this.layer.depot;
      ctx.fillStyle = p.casing;
      roundRect(ctx, s.x - size - 1.5, s.y - size - 1.5, size * 2 + 3, size * 2 + 3, 4);
      ctx.fill();
      ctx.fillStyle = p.depot;
      roundRect(ctx, s.x - size, s.y - size, size * 2, size * 2, 3);
      ctx.fill();
      ctx.fillStyle = p.bg;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (this.overlay) {
      ctx.save();
      this.overlay(ctx, now);
      ctx.restore();
    }

    this.vanScreen = [];
    if (this.layer.vans > 0.01) {
      const size = vanSize;
      for (const v of this.vans) {
        const a = v.alpha * this.layer.vans * Math.max(0.3, this.focus[v.slot] ?? 1);
        if (a < 0.01) continue;
        const s = this.toScreen(v.x, v.y);
        this.vanScreen.push({ slot: v.slot, x: s.x, y: s.y });
        const color = v.signal === 'no_signal' ? p.neutral : p.routes[v.slot % p.routes.length]!;
        ctx.globalAlpha = a;
        if (v.signal !== 'no_signal' && v.signal !== 'finished' && v.signal !== 'not_started') {
          const phase = (now * 0.45 + v.slot * 0.17) % 1;
          for (const off of [0, 0.5]) {
            const t = (phase + off) % 1;
            ctx.strokeStyle = color;
            ctx.globalAlpha = a * (1 - t) * 0.55;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(s.x, s.y, size * 0.45 + t * size * 1.25, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = a;
        } else if (v.signal === 'no_signal') {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(s.x, s.y, size * 0.85, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        drawVan(ctx, s.x, s.y, v.angle, size, color, p);
      }
      ctx.globalAlpha = 1;
    }
  }

  private renderStops(ctx: CanvasRenderingContext2D, k: number): void {
    const p = this.pal;
    const r0 = clamp(2.4 * k ** 0.3, 2.6, 6.5);
    for (const route of this.routes) {
      const color = p.routes[route.slot % p.routes.length]!;
      const states = this.stopStates[route.slot]!;
      const focus = this.focus[route.slot]!;
      route.stops.forEach((stop, i) => {
        const pop = this.pops[route.slot]![i]!;
        if (pop <= 0.01) return;
        const s = this.toScreen(stop.x, stop.y);
        if (s.x < -20 || s.y < -20 || s.x > this.w + 20 || s.y > this.h + 20) return;
        const r = r0 * pop;
        const state = states[i]!;
        const a = this.layer.stops * Math.max(this.orders, focus) * Math.min(1, pop);
        ctx.globalAlpha = a;
        // Orders step: every stop the same quiet dot, not yet on a route.
        if (this.orders > 0.01) {
          const ro = r * (1 + 0.35 * this.orders);
          ctx.fillStyle = p.casing;
          ctx.beginPath();
          ctx.arc(s.x, s.y, ro + 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = mix(p.order, color, 1 - this.orders);
          ctx.beginPath();
          ctx.arc(s.x, s.y, ro, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        ctx.fillStyle = p.casing;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 1.6, 0, Math.PI * 2);
        ctx.fill();
        if (state === 'delivered') {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          if (r > 4.5) tick(ctx, s.x, s.y, r, p.bg);
        } else if (state === 'failed') {
          ctx.fillStyle = p.failed;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          cross(ctx, s.x, s.y, r, p.bg);
        } else {
          ctx.fillStyle = p.bg;
          ctx.strokeStyle = color;
          ctx.lineWidth = state === 'arrived' ? 2.6 : 1.6;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r - 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
    }
    ctx.globalAlpha = 1;
  }
}

/** A box truck from above, nose along +x: cargo box in the route colour, light cab. */
function drawVan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  L: number,
  color: string,
  p: (typeof palettes)['night'] | (typeof palettes)['paper'],
): void {
  const W = L * 0.47;
  const box = L * 0.66;
  const gap = L * 0.035;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Shadow, offset away from the light.
  ctx.fillStyle = p.shadow;
  roundRect(ctx, -L / 2 + 1, -W / 2 + 2, L, W, W * 0.24);
  ctx.fill();
  // Outline under both bodies.
  ctx.fillStyle = p.casing;
  roundRect(ctx, -L / 2 - 1, -W / 2 - 1, L + 2, W + 2, W * 0.26);
  ctx.fill();
  // Cargo box.
  ctx.fillStyle = color;
  roundRect(ctx, -L / 2, -W / 2, box, W, W * 0.16);
  ctx.fill();
  // Roof ribs on the box, once the van is big enough to show them.
  if (L > 26) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const rx = -L / 2 + (box * i) / 4;
      ctx.beginPath();
      ctx.moveTo(rx, -W / 2 + 2);
      ctx.lineTo(rx, W / 2 - 2);
      ctx.stroke();
    }
  }
  // Cab with its windscreen at the nose.
  const cx = -L / 2 + box + gap;
  const cw = L - box - gap;
  ctx.fillStyle = p.cab;
  roundRect(ctx, cx, -W / 2 + W * 0.04, cw, W * 0.92, [W * 0.12, W * 0.3, W * 0.3, W * 0.12]);
  ctx.fill();
  ctx.fillStyle = p.glass;
  roundRect(ctx, cx + cw * 0.56, -W / 2 + W * 0.16, cw * 0.3, W * 0.68, W * 0.08);
  ctx.fill();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[],
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.4, r * 0.28);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.42, y + r * 0.02);
  ctx.lineTo(x - r * 0.1, y + r * 0.34);
  ctx.lineTo(x + r * 0.46, y - r * 0.32);
  ctx.stroke();
}

function cross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.3, r * 0.26);
  const s = r * 0.36;
  ctx.beginPath();
  ctx.moveTo(x - s, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.moveTo(x + s, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.stroke();
}

/** Blend two hex colours (t = 0 gives a). */
function mix(a: string, b: string, t: number): string {
  if (t <= 0.001) return a;
  if (t >= 0.999) return b;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
}
