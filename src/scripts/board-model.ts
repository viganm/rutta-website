/**
 * What the Today board says about each route at a clock time. Pure, so the
 * server renders the same rows the client then keeps up to date.
 */
import { fill, type Copy } from '../i18n/index.ts';
import { clock, failReason, routes, stateAt, totalStops, type VanState } from './sim.ts';

export type Tone = 'moving' | 'at_stop' | 'no_signal' | 'not_started' | 'finished' | 'late';

export interface RowView {
  slot: number;
  label: string;
  name: string;
  driver: string;
  plate: string;
  done: number;
  total: number;
  ratio: number;
  tone: Tone;
  status: string;
  next: string;
  when: string;
  late: boolean;
  /** Sort weight on the full board: what needs attention first. */
  weight: number;
}

export interface AttentionItem {
  key: string;
  kind: 'late' | 'failed' | 'no_signal';
  text: string;
  slot: number;
}

export interface BoardView {
  rows: RowView[];
  done: number;
  total: number;
  attention: AttentionItem[];
  clock: string;
}

export function boardAt(t: number, c: Copy['board']): BoardView {
  const states = routes.map((r) => stateAt(r, t));
  const rows = routes.map((r, i) => rowView(r, states[i]!, t, c));
  const attention: AttentionItem[] = [];
  routes.forEach((r, i) => {
    const s = states[i]!;
    const label = `R${r.data.slot + 1}`;
    if (s.signal === 'no_signal') {
      attention.push({
        key: `ns-${i}`,
        kind: 'no_signal',
        slot: i,
        text: fill(c.noSignal, { route: label, driver: r.data.driver, time: clock(s.heard) }),
      });
    }
    if (s.lateSince !== null) {
      const stop = r.data.stops[s.next]!;
      attention.push({
        key: `late-${i}-${s.next}`,
        kind: 'late',
        slot: i,
        text: fill(c.late, {
          route: label,
          n: s.next + 1,
          name: stop.name,
          time: clock(s.lateSince),
        }),
      });
    }
    s.stops.forEach((st, j) => {
      if (st !== 'failed') return;
      const reason = failReason(r, j);
      attention.push({
        key: `f-${i}-${j}`,
        kind: 'failed',
        slot: i,
        text: fill(c.failed, {
          route: label,
          n: j + 1,
          name: r.data.stops[j]!.name,
          time: '',
          reason: reason ? c.reasons[reason] : '',
        }),
      });
    });
  });
  const order = { no_signal: 0, late: 1, failed: 2 };
  attention.sort((a, b) => order[a.kind] - order[b.kind]);
  return {
    rows,
    done: states.reduce((n, s) => n + s.done, 0),
    total: totalStops,
    attention,
    clock: clock(t),
  };
}

function rowView(r: (typeof routes)[number], s: VanState, t: number, c: Copy['board']): RowView {
  const total = r.data.stops.length;
  const late = s.lateSince !== null;
  const tone: Tone = late && s.signal === 'moving' ? 'late' : s.signal;
  const status = late && s.signal === 'moving' ? c.signal.moving : c.signal[s.signal];
  let next: string;
  let when = '';
  if (s.signal === 'not_started') {
    next = fill(c.next, { n: 1, name: r.data.stops[0]!.name });
    when = fill(c.departs, { time: clock(r.legs[0]!.depart) });
  } else if (s.next < total) {
    next = fill(c.next, { n: s.next + 1, name: r.data.stops[s.next]!.name });
    when = late
      ? fill(c.lateSince, { time: clock(s.lateSince!) })
      : fill(c.due, { time: clock(s.due ?? t) });
  } else {
    next = c.done;
  }
  const weight =
    s.signal === 'no_signal' ? 0 : late ? 1 : s.failed ? 2 : s.signal === 'finished' ? 9 : 5;
  return {
    slot: r.data.slot,
    label: `R${r.data.slot + 1}`,
    name: r.data.name,
    driver: r.data.driver,
    plate: r.data.plate,
    done: s.done,
    total,
    ratio: s.done / total,
    tone,
    status,
    next,
    when,
    late,
    weight,
  };
}
