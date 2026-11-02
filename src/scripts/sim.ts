/**
 * The demo day, as a schedule rather than a physics loop: given a clock time
 * (minutes after midnight) it says where every van is and what every stop's
 * state is. Deterministic, so the server can render the board exactly as the
 * client's first frame will show it, and scrolling back and forth never
 * disagrees with itself.
 *
 * Demo data only: Ilirida Distribucion's seven routes (scripts/build-map.ts),
 * timed like the app's seed: one route running half an hour late, a couple of
 * failed stops, one driver losing signal in the mountains.
 */
import { demo, Polyline, type RouteData } from './map/geo.ts';

export type Signal = 'not_started' | 'moving' | 'at_stop' | 'no_signal' | 'finished';
export type StopState = 'pending' | 'arrived' | 'delivered' | 'failed';
export type FailReason = 'closed' | 'customer_absent' | 'no_cash';

/** The clock the hero opens on, and how fast it runs (minutes per second). */
export const START = 10 * 60 + 30;
export const SPEED = 1.5;

interface Plan {
  /** Planned departure (minutes after midnight); the published stop times. */
  start: number;
  /** How late the van actually left. */
  delay: number;
  /** Minutes at each stop: unloading crates takes longer in town. */
  dwell: number;
  failed: Partial<Record<number, FailReason>>;
  /** No signal between these clock times; the van's updates arrive after. */
  noSignal?: [number, number];
}

const plans: Plan[] = [
  { start: 8 * 60, delay: 0, dwell: 15, failed: { 4: 'closed' } },
  { start: 8 * 60 + 30, delay: 0, dwell: 12, failed: {} },
  { start: 7 * 60 + 45, delay: 34, dwell: 9, failed: { 2: 'customer_absent' } },
  { start: 10 * 60 + 36, delay: 0, dwell: 9, failed: {} },
  { start: 7 * 60 + 50, delay: 0, dwell: 8, failed: {} },
  {
    start: 7 * 60 + 55,
    delay: 0,
    dwell: 8,
    failed: { 6: 'no_cash' },
    noSignal: [10 * 60 + 12, 10 * 60 + 52],
  },
  { start: 8 * 60 + 10, delay: 0, dwell: 9, failed: {} },
];

export interface Leg {
  from: number;
  to: number;
  depart: number;
  arrive: number;
  leave: number;
  plannedArrive: number;
}

export interface SimRoute {
  data: RouteData;
  line: Polyline;
  plan: Plan;
  legs: Leg[];
}

function legsFor(data: RouteData, plan: Plan): Leg[] {
  const points = [0, ...data.stops.map((s) => s.at), data.length];
  const minutes = data.stops.map((s) => Math.max(2, s.legMin));
  minutes.push(Math.max(4, data.minutes - minutes.reduce((a, b) => a + b, 0)));
  const legs: Leg[] = [];
  let t = plan.start + plan.delay;
  let planned = plan.start;
  for (let i = 0; i < minutes.length; i++) {
    const last = i === minutes.length - 1;
    const arrive = t + minutes[i]!;
    const plannedArrive = planned + minutes[i]!;
    const leave = last ? arrive : arrive + plan.dwell;
    legs.push({ from: points[i]!, to: points[i + 1]!, depart: t, arrive, leave, plannedArrive });
    t = leave;
    planned = plannedArrive + (last ? 0 : plan.dwell);
  }
  return legs;
}

export const routes: SimRoute[] = demo.routes.map((data, i) => {
  const plan = plans[i]!;
  return { data, line: new Polyline(data.line), plan, legs: legsFor(data, plan) };
});

export const totalStops = routes.reduce((n, r) => n + r.data.stops.length, 0);

export interface VanState {
  slot: number;
  signal: Signal;
  /** Distance along the line. */
  d: number;
  /** Index of the next stop not yet done (stops.length when all are done). */
  next: number;
  done: number;
  failed: number;
  stops: StopState[];
  /** Planned arrival at the next stop. */
  due: number | null;
  /** Set when the next stop is overdue: its planned time. */
  lateSince: number | null;
  /** When the van was last heard from (clock minutes). */
  heard: number;
  speedKmh: number;
}

const ease = (t: number) => 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, t))) / 2;

/** Where a route actually is at clock time t, ignoring signal. */
function trueState(route: SimRoute, t: number): VanState {
  const { legs, data, plan } = route;
  const n = data.stops.length;
  const stops: StopState[] = Array.from({ length: n }, () => 'pending');
  let d = 0;
  let signal: Signal = 'not_started';
  let next = 0;
  let speedKmh = 0;

  if (t >= legs[0]!.depart) {
    signal = 'finished';
    d = data.length;
    next = n;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;
      if (t < leg.arrive) {
        signal = 'moving';
        const p = (t - leg.depart) / (leg.arrive - leg.depart);
        d = leg.from + (leg.to - leg.from) * ease(p);
        const km = i < n ? data.stops[i]!.legKm : 0;
        const avg = km / ((leg.arrive - leg.depart) / 60 || 1);
        speedKmh = Math.round(avg * (0.6 + 0.8 * Math.sin(Math.PI * p)));
        next = Math.min(i, n);
        break;
      }
      if (t < leg.leave) {
        signal = 'at_stop';
        d = leg.to;
        next = i;
        stops[i] = 'arrived';
        break;
      }
      if (i < n) stops[i] = plan.failed[i] ? 'failed' : 'delivered';
    }
  }

  const done = stops.filter((s) => s === 'delivered' || s === 'failed').length;
  const failed = stops.filter((s) => s === 'failed').length;
  const nextLeg = next < n ? legs[next]! : null;
  const due = nextLeg ? nextLeg.plannedArrive : null;
  // Overdue means not there yet; a van already at the stop is dealt with.
  const lateSince =
    due !== null && signal !== 'not_started' && signal !== 'at_stop' && t > due + 10 ? due : null;
  return {
    slot: data.slot,
    signal,
    d,
    next,
    done,
    failed,
    stops,
    due,
    lateSince,
    heard: t,
    speedKmh,
  };
}

/** What dispatch sees at clock time t: during a signal gap, the last state heard. */
export function stateAt(route: SimRoute, t: number): VanState {
  const gap = route.plan.noSignal;
  if (gap && t >= gap[0] && t < gap[1]) {
    const last = trueState(route, gap[0]);
    return { ...last, signal: 'no_signal', speedKmh: 0, heard: gap[0] };
  }
  return trueState(route, t);
}

export function failReason(route: SimRoute, stop: number): FailReason | undefined {
  return route.plan.failed[stop];
}

export const clock = (minutes: number) => {
  const m = Math.floor(minutes) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The time-lapse loops: by 12:10 most vans are heading home, so the morning starts again. */
export const END = 12 * 60 + 10;

/** Clock time for a number of seconds since the demo started. */
export const clockAt = (seconds: number) => START + ((seconds * SPEED) % (END - START));
