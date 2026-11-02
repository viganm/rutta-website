/**
 * Builds the site's map data once, from public sources, into src/data/:
 *
 * - terrain contours from AWS Terrain Tiles (Terrarium encoding, z9),
 * - Kosovo's outline (OpenStreetMap, via Nominatim),
 * - main roads, rivers and Prishtinë's streets (OpenStreetMap, via Overpass),
 * - the demo routes' road geometry (OSRM demo server).
 *
 * Coordinates are Web Mercator pixels at zoom 9, relative to the top-left of
 * the covered tiles, so the client draws everything in one plane. The output
 * is committed; rerun (`pnpm map:data`) only to change it.
 * Downloads are cached in .cache/ so reruns don't hit the servers again.
 */
import { contours } from 'd3-contour';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache');
const outDir = join(root, 'src/data');
const UA = 'rutta-site-build/0.1 (map data for the Rutta website)';

// ----------------------------------------------------------------- projection
const Z = 9;
const WORLD = 256 * 2 ** Z;
const bounds = { west: 18.4, east: 22.6, south: 41.5, north: 43.6 };

const mercX = (lng: number) => ((lng + 180) / 360) * WORLD;
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
};
const tileX0 = Math.floor(mercX(bounds.west) / 256);
const tileX1 = Math.floor(mercX(bounds.east) / 256);
const tileY0 = Math.floor(mercY(bounds.north) / 256);
const tileY1 = Math.floor(mercY(bounds.south) / 256);
const X0 = tileX0 * 256;
const Y0 = tileY0 * 256;
const width = (tileX1 - tileX0 + 1) * 256;
const height = (tileY1 - tileY0 + 1) * 256;

type Pt = [number, number];
const project = (lng: number, lat: number): Pt => [mercX(lng) - X0, mercY(lat) - Y0];

// ------------------------------------------------------------------- helpers
async function cached(name: string, load: () => Promise<Buffer>): Promise<Buffer> {
  const file = join(cacheDir, name);
  try {
    return await readFile(file);
  } catch {
    const data = await load();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    return data;
  }
}

async function get(url: string, init?: RequestInit): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init?.headers } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt === 2) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    console.warn(`retrying ${url} after ${res.status}`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
}

// The main instance is often overloaded; the mirrors serve the same data.
const overpassServers = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function overpass(name: string, query: string): Promise<OverpassResult> {
  const body = await cached(`${name}.json`, async () => {
    for (const server of overpassServers) {
      try {
        return await get(server, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        });
      } catch (error) {
        console.warn(`${server}: ${(error as Error).message}`);
      }
    }
    throw new Error(`no Overpass server answered for ${name}`);
  });
  return JSON.parse(body.toString()) as OverpassResult;
}
type OverpassResult = {
  elements: {
    type: string;
    tags?: Record<string, string>;
    geometry?: { lat: number; lon: number }[];
  }[];
};

/** Douglas–Peucker on an open polyline. */
function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points;
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let worst = -1;
    let worstD = sq;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > worstD) {
        worst = i;
        worstD = d;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (n: number, digits: number) => Number(n.toFixed(digits));

/** SVG path data: absolute first point, then relative steps (smaller). */
function pathData(lines: Pt[][], digits: number, close = false): string {
  const f = (n: number) => String(round(n, digits));
  let d = '';
  for (const line of lines) {
    if (line.length < 2) continue;
    let [px, py] = line[0]!;
    d += `M${f(px)} ${f(py)}`;
    // Accumulate the rounded position so relative steps don't drift.
    px = round(px, digits);
    py = round(py, digits);
    for (let i = 1; i < line.length; i++) {
      const x = round(line[i]![0], digits);
      const y = round(line[i]![1], digits);
      d += `l${f(x - px)} ${f(y - py)}`;
      px = x;
      py = y;
    }
    if (close) d += 'z';
  }
  // Drop zero-length steps (only whole "l0 0" tokens, never the start of 0.53).
  return d.replace(/ -/g, '-').replace(/l0 0(?=[lMz]|$)/g, '');
}

// ------------------------------------------------------------------- terrain
async function terrain() {
  const elevation = new Float32Array(width * height);
  for (let ty = tileY0; ty <= tileY1; ty++) {
    for (let tx = tileX0; tx <= tileX1; tx++) {
      const png = PNG.sync.read(
        await cached(`terrarium/${Z}/${tx}/${ty}.png`, () =>
          get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`),
        ),
      );
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 4;
          const e = png.data[i]! * 256 + png.data[i + 1]! + png.data[i + 2]! / 256 - 32768;
          elevation[((ty - tileY0) * 256 + y) * width + (tx - tileX0) * 256 + x] = Math.max(0, e);
        }
      }
    }
  }

  // Half resolution with a light blur: smoother lines, a fraction of the points.
  const step = 2;
  const w = width / step;
  const h = height / step;
  const grid = new Float64Array(w * h);
  const r = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = Math.min(width - 1, Math.max(0, x * step + dx));
          const sy = Math.min(height - 1, Math.max(0, y * step + dy));
          sum += elevation[sy * width + sx]!;
          n++;
        }
      }
      grid[y * w + x] = sum / n;
    }
  }

  const levels: { e: number; d: string }[] = [];
  const thresholds: number[] = [];
  for (let e = 350; e <= 2600; e += 150) thresholds.push(e);
  const generator = contours().size([w, h]).thresholds(thresholds);
  for (const level of generator(Array.from(grid))) {
    const rings: Pt[][] = [];
    for (const polygon of level.coordinates) {
      for (const ring of polygon) {
        const pts = ring.map(([x, y]) => [x! * step, y! * step] as Pt);
        // Skip the frame d3 closes along the grid edge and tiny specks.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of pts) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        if (maxX - minX < 6 && maxY - minY < 6) continue;
        const open = splitAtFrame(pts);
        for (const line of open) {
          const s = simplify(line, 1.6);
          if (s.length >= 3) rings.push(s);
        }
      }
    }
    levels.push({ e: level.value, d: pathData(rings, 1) });
  }

  return levels;
}

/** d3-contour closes rings along the grid's border; cut those edges out. */
function splitAtFrame(ring: Pt[]): Pt[][] {
  const onFrame = ([x, y]: Pt) => x <= 0.5 || y <= 0.5 || x >= width - 0.5 || y >= height - 0.5;
  const lines: Pt[][] = [];
  let current: Pt[] = [];
  for (const p of ring) {
    if (onFrame(p)) {
      if (current.length > 1) lines.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length > 1) lines.push(current);
  return lines;
}

// ------------------------------------------------------------------- outline
async function outline() {
  const body = await cached('kosovo.json', () =>
    get(
      'https://nominatim.openstreetmap.org/search?q=Kosovo&featureType=country&polygon_geojson=1&polygon_threshold=0.002&format=json&limit=1',
    ),
  );
  const [place] = JSON.parse(body.toString()) as {
    geojson: { type: string; coordinates: number[][][] | number[][][][] };
  }[];
  if (!place) throw new Error('Nominatim returned no outline for Kosovo');
  const polygons = (
    place.geojson.type === 'Polygon' ? [place.geojson.coordinates] : place.geojson.coordinates
  ) as number[][][][];
  const rings = polygons.map((poly) =>
    simplify(
      poly[0]!.map(([lng, lat]) => project(lng!, lat!)),
      0.15,
    ),
  );
  return pathData(rings, 2, true);
}

// --------------------------------------------------------------------- roads
const kosovoBox = '41.80,19.95,43.32,21.85';

async function roads() {
  const data = await overpass(
    'roads',
    `[out:json][timeout:120];way["highway"~"^(motorway|trunk|primary|secondary)$"](${kosovoBox});out geom;`,
  );
  const classes: Record<string, Pt[][]> = { major: [], primary: [] };
  for (const el of data.elements) {
    if (!el.geometry) continue;
    const hw = el.tags?.highway ?? '';
    // Secondary roads are fetched (cached) but too dense to read at this scale.
    if (hw === 'secondary') continue;
    const cls = /motorway|trunk/.test(hw) ? 'major' : 'primary';
    classes[cls]!.push(
      simplify(
        el.geometry.map((g) => project(g.lon, g.lat)),
        0.3,
      ),
    );
  }
  return Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, pathData(v, 1)]));
}

async function rivers() {
  const data = await overpass(
    'rivers',
    `[out:json][timeout:120];(way["waterway"="river"](${kosovoBox});way["natural"="water"]["water"~"reservoir|lake"](${kosovoBox});node(w)->.n;);out geom;`,
  );
  const lines: Pt[][] = [];
  const lakes: Pt[][] = [];
  for (const el of data.elements) {
    if (!el.geometry || el.geometry.length < 2) continue;
    const pts = simplify(
      el.geometry.map((g) => project(g.lon, g.lat)),
      0.45,
    );
    if (el.tags?.natural === 'water') {
      // Only the big reservoirs read at this scale (Gazivoda, Ujmani, Radoniq).
      let minX = Infinity;
      let maxX = -Infinity;
      for (const [x] of pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      if (maxX - minX > 2.5) lakes.push(pts);
    } else {
      lines.push(pts);
    }
  }
  return { rivers: pathData(lines, 1), lakes: pathData(lakes, 1, true) };
}

// Prishtinë's streets, for the close-ups (the live van and the pin section).
const prishtinaBox = '42.615,21.090,42.690,21.215';
async function streets() {
  const data = await overpass(
    'streets-prishtina',
    `[out:json][timeout:120];way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|trunk|motorway)$"](${prishtinaBox});out geom;`,
  );
  const main: Pt[][] = [];
  const minor: Pt[][] = [];
  for (const el of data.elements) {
    if (!el.geometry) continue;
    const pts = simplify(
      el.geometry.map((g) => project(g.lon, g.lat)),
      0.012,
    );
    const hw = el.tags?.highway ?? '';
    (/residential|unclassified|living_street/.test(hw) ? minor : main).push(pts);
  }
  return { main: pathData(main, 2), minor: pathData(minor, 2) };
}

// -------------------------------------------------------------- demo routes
// Synthetic demo data in the shape of the app's seed (supabase/seed/generate.ts):
// Ilirida Distribucion's day, seven routes out of the Prishtinë depot.
let seed = 20261102;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (a: number, b: number) => a + (b - a) * rand();
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

const depot = { lat: 42.642, lng: 21.118 };
const towns: Record<string, { lat: number; lng: number; serbian?: boolean }> = {
  Prishtinë: { lat: 42.6629, lng: 21.1655 },
  'Kodra e Diellit': { lat: 42.6505, lng: 21.1765 },
  Graçanicë: { lat: 42.6, lng: 21.1933, serbian: true },
  Lipjan: { lat: 42.5217, lng: 21.1386 },
  Ferizaj: { lat: 42.37, lng: 21.1553 },
  Shtime: { lat: 42.4333, lng: 21.0397 },
  Kaçanik: { lat: 42.2319, lng: 21.2592 },
  Shtërpcë: { lat: 42.2392, lng: 21.0272, serbian: true },
  Gjilan: { lat: 42.4639, lng: 21.4694 },
  Viti: { lat: 42.3214, lng: 21.3581 },
  Kamenicë: { lat: 42.5781, lng: 21.5803 },
  Prizren: { lat: 42.2139, lng: 20.7397 },
  Suharekë: { lat: 42.3592, lng: 20.8253 },
  Rahovec: { lat: 42.3994, lng: 20.6547 },
  Malishevë: { lat: 42.4828, lng: 20.7458 },
  Dragash: { lat: 42.0619, lng: 20.6531 },
  Pejë: { lat: 42.6593, lng: 20.2887 },
  Gjakovë: { lat: 42.3803, lng: 20.4308 },
  Deçan: { lat: 42.5403, lng: 20.2875 },
  Klinë: { lat: 42.6203, lng: 20.5778 },
  Istog: { lat: 42.7808, lng: 20.4875 },
  Mitrovicë: { lat: 42.8833, lng: 20.8667 },
  Vushtrri: { lat: 42.8231, lng: 20.9675 },
  Skenderaj: { lat: 42.7467, lng: 20.7889 },
  Podujevë: { lat: 42.9106, lng: 21.1931 },
  Drenas: { lat: 42.6264, lng: 20.8939 },
  'Fushë Kosovë': { lat: 42.637, lng: 21.093 },
};
const plans = [
  {
    name: 'Prishtina Qendër',
    driver: 'Arben Krasniqi',
    plate: '01-487-KM',
    vehicle: 'Iveco Daily 35S',
    stops: { Prishtinë: 9 },
  },
  {
    name: 'Graçanicë – Lipjan',
    driver: 'Dragan Milić',
    plate: '01-215-AB',
    vehicle: 'Mercedes-Benz Sprinter 316',
    stops: { 'Kodra e Diellit': 3, Graçanicë: 3, Lipjan: 2 },
  },
  {
    name: 'Ferizaj – Kaçanik',
    driver: 'Blerim Gashi',
    plate: '01-902-CD',
    vehicle: 'Iveco Eurocargo 75E',
    stops: { Ferizaj: 3, Shtime: 1, Kaçanik: 2, Shtërpcë: 2 },
  },
  {
    name: 'Gjilan – Kamenicë',
    driver: 'Dardan Berisha',
    plate: '01-651-LM',
    vehicle: 'Fiat Ducato Maxi',
    stops: { Gjilan: 4, Viti: 2, Kamenicë: 2 },
  },
  {
    name: 'Prizren – Dragash',
    driver: 'Ermal Hoxha',
    plate: '01-776-GH',
    vehicle: 'Mercedes-Benz Atego 818 Frigo',
    stops: { Prizren: 4, Suharekë: 2, Rahovec: 1, Malishevë: 1, Dragash: 1 },
  },
  {
    name: 'Pejë – Gjakovë',
    driver: 'Fatos Morina',
    plate: '01-334-EF',
    vehicle: 'MAN TGL 8.190',
    stops: { Pejë: 3, Gjakovë: 3, Deçan: 1, Klinë: 1, Istog: 1 },
  },
  {
    name: 'Mitrovicë – Podujevë',
    driver: 'Genc Shala',
    plate: '01-043-NP',
    vehicle: 'DAF LF 180',
    stops: { Mitrovicë: 2, Vushtrri: 2, Skenderaj: 1, Podujevë: 2, Drenas: 1, 'Fushë Kosovë': 1 },
  },
] as const;
const shopPrefixes = [
  'Market',
  'Mini Market',
  'Shitorja',
  'Dyqani',
  'Supermarket',
  'Kafe-Market',
  'Pekara',
];
const shopNames = [
  'Kodra',
  'Ardi',
  'Lumi',
  'Drita',
  'Besa',
  'Flaka',
  'Rina',
  'Arta',
  'Era',
  'Teuta',
  'Gëzimi',
  'Bora',
  'Vala',
  'Iliri',
  'Shpresa',
  'Dielli',
  'Ylli',
  'Agimi',
];
const serbianShops = [
  'Prodavnica Kod Milana',
  'Market Lazar',
  'Mini Market Sloga',
  'Prodavnica Šar',
  'Market Jelena',
];

type Stop = { name: string; town: string; lat: number; lng: number };

/** Nearest neighbour from the depot: a plausible order without an optimiser. */
function order(stops: Stop[]): Stop[] {
  const left = [...stops];
  const out: Stop[] = [];
  let at = depot;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((s, i) => {
      const d = (s.lat - at.lat) ** 2 + ((s.lng - at.lng) * 0.74) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = left.splice(best, 1);
    out.push(next!);
    at = next!;
  }
  return out;
}

async function routes() {
  const used = new Set<string>();
  const out = [];
  for (const [slot, plan] of plans.entries()) {
    const stops: Stop[] = [];
    for (const [town, count] of Object.entries(plan.stops)) {
      const t = towns[town]!;
      for (let i = 0; i < count; i++) {
        let name: string;
        do {
          name = t.serbian ? pick(serbianShops) : `${pick(shopPrefixes)} ${pick(shopNames)}`;
        } while (used.has(`${name}|${town}`));
        used.add(`${name}|${town}`);
        const spread = town === 'Prishtinë' ? 1.6 : 1;
        stops.push({
          name,
          town: town === 'Kodra e Diellit' ? 'Prishtinë' : town,
          lat: t.lat + between(-0.008, 0.008) * spread,
          lng: t.lng + between(-0.01, 0.01) * spread,
        });
      }
    }
    const ordered = order(stops);
    const coords = [depot, ...ordered, depot].map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`);
    const body = await cached(`osrm/route-${slot}.json`, async () => {
      await new Promise((r) => setTimeout(r, 1200));
      return get(
        `https://router.project-osrm.org/route/v1/driving/${coords.join(';')}?overview=full&geometries=geojson`,
      );
    });
    const res = JSON.parse(body.toString()) as {
      routes: {
        distance: number;
        duration: number;
        legs: { distance: number; duration: number }[];
        geometry: { coordinates: [number, number][] };
      }[];
      waypoints: { location: [number, number] }[];
    };
    const route = res.routes[0]!;
    const line = simplify(
      route.geometry.coordinates.map(([lng, lat]) => project(lng, lat)),
      0.02,
    );
    // Distance along the line (projected units) where each waypoint sits.
    const cum = [0];
    for (let i = 1; i < line.length; i++) {
      cum.push(
        cum[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]),
      );
    }
    let from = 0;
    const at = res.waypoints.map(({ location }) => {
      const [wx, wy] = project(location[0], location[1]);
      let best = from;
      let bestD = Infinity;
      for (let i = from; i < line.length; i++) {
        const d = (line[i]![0] - wx) ** 2 + (line[i]![1] - wy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      from = best;
      return round(cum[best]!, 3);
    });
    out.push({
      slot,
      name: plan.name,
      driver: plan.driver,
      plate: plan.plate,
      vehicle: plan.vehicle,
      km: round(route.distance / 1000, 1),
      minutes: Math.round(route.duration / 60),
      line: line.flatMap(([x, y]) => [round(x, 2), round(y, 2)]),
      length: round(cum[cum.length - 1]!, 3),
      stops: ordered.map((s, i) => {
        const [x, y] = project(
          res.waypoints[i + 1]!.location[0],
          res.waypoints[i + 1]!.location[1],
        );
        return {
          name: s.name,
          town: s.town,
          x: round(x, 3),
          y: round(y, 3),
          at: at[i + 1]!,
          legKm: round(route.legs[i]!.distance / 1000, 1),
          legMin: Math.round(route.legs[i]!.duration / 60),
        };
      }),
    });
  }
  return { depot: project(depot.lng, depot.lat).map((n) => round(n, 3)), routes: out };
}

// ---------------------------------------------------------------------- main
const [relief, border, mainRoads, water, city, demo] = [
  await terrain(),
  await outline(),
  await roads(),
  await rivers(),
  await streets(),
  await routes(),
];
await mkdir(outDir, { recursive: true });
const frame = {
  zoom: Z,
  origin: [X0, Y0],
  size: [width, height],
  bounds,
  attribution:
    'Terrain: AWS Terrain Tiles (Mapzen, SRTM). Roads, water and outline: © OpenStreetMap contributors. Routing: OSRM.',
};
await writeFile(
  join(outDir, 'map-base.json'),
  JSON.stringify({ frame, border, roads: mainRoads, ...water, contours: relief }),
);
await writeFile(join(outDir, 'map-streets.json'), JSON.stringify(city));
await writeFile(join(outDir, 'routes.json'), JSON.stringify({ frame, ...demo }));
for (const f of ['map-base.json', 'map-streets.json', 'routes.json']) {
  const { size } = await import('node:fs').then((fs) => fs.promises.stat(join(outDir, f)));
  console.warn(`${f}: ${(size / 1024).toFixed(0)} KB`);
}
