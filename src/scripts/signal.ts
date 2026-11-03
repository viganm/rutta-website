/**
 * The road to Dragash on the paper map. The van drives into a dead zone,
 * delivers there (three updates wait in the outbox), and as soon as it's out
 * the updates leave in order and dispatch receives them in order.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { fill } from '../i18n/index.ts';
import { instrumentEls, updateInstruments } from './map/instruments.ts';
import { MapView } from './map/view.ts';
import { routes } from './sim.ts';

interface SignalCopy {
  offline: string;
  sending: string;
  synced: string;
  deadZone: string;
}

const R5 = routes[4]!;
const stop = R5.data.stops.findIndex((s) => s.town === 'Dragash');
const at = R5.data.stops[stop]!.at;
const FROM = at - 100;
const TO = at + 96;
const ZONE: [number, number] = [at - 42, at + 46];
/** Seconds: drive in, dwell at the stop, drive out, hold. */
const T = { arrive: 4.2, leave: 6.6, end: 10.4, loop: 12.6 };

export function initSignal(root: HTMLElement, lang: 'sq' | 'en', reduced: boolean): void {
  const c = JSON.parse(root.querySelector('script[data-copy]')!.textContent!) as SignalCopy;
  const canvas = root.querySelector<HTMLCanvasElement>('[data-map]')!;
  const tag = root.querySelector<HTMLElement>('[data-tag]')!;
  const tagText = root.querySelector<HTMLElement>('[data-tag-text]')!;
  const pill = root.querySelector<HTMLElement>('[data-pill]')!;
  const queue = [...root.querySelectorAll<HTMLElement>('[data-queue] li')];
  const received = [...root.querySelectorAll<HTMLElement>('[data-received] li')];
  const note = root.querySelector<HTMLElement>('[data-note]')!;
  const waiting = root.querySelector<HTMLElement>('[data-waiting]')!;
  const allSent = root.querySelector<HTMLElement>('[data-all]')!;
  const inst = instrumentEls(root);

  const view = new MapView(canvas, 'paper', lang);
  view.setRoutes([{ slot: 4, line: R5.line, stops: R5.data.stops }]);
  view.layer.depot = 0;
  view.layer.aheadAlpha = 0.45;
  view.stopStates[4] = R5.data.stops.map((_, i) => (i < stop ? 'delivered' : 'pending'));

  // The dead zone: a hatched patch over the mountain road, like a map's "no coverage".
  const a = R5.line.pointAt(ZONE[0]);
  const b = R5.line.pointAt(ZONE[1]);
  const mid = R5.line.pointAt((ZONE[0] + ZONE[1]) / 2);
  const centre = { x: (a.x + b.x + mid.x * 2) / 4, y: (a.y + b.y + mid.y * 2) / 4 };
  const radius =
    Math.max(
      Math.hypot(a.x - centre.x, a.y - centre.y),
      Math.hypot(b.x - centre.x, b.y - centre.y),
    ) * 0.98;
  const hatch = document.createElement('canvas');
  hatch.width = hatch.height = 10;
  const h = hatch.getContext('2d')!;
  h.strokeStyle = 'rgba(180, 35, 24, 0.22)';
  h.lineWidth = 1.2;
  h.beginPath();
  h.moveTo(-2, 12);
  h.lineTo(12, -2);
  h.stroke();
  const pattern = view.canvas.getContext('2d')!.createPattern(hatch, 'repeat')!;

  view.overlay = (ctx) => {
    const s = view.toScreen(centre.x, centre.y);
    const r = radius * view.k;
    const d = view.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = pattern;
    ctx.fill();
    ctx.fillStyle = 'rgba(180, 35, 24, 0.04)';
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(180, 35, 24, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '650 12px "Geologica Variable", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#F1F4F0';
    ctx.strokeText(c.deadZone, s.x, s.y - r - 10);
    ctx.fillStyle = '#8F1C13';
    ctx.fillText(c.deadZone, s.x, s.y - r - 10);
  };

  function camera(): void {
    const [x0, y0, x1, y1] = R5.line.bbox(FROM, TO);
    const box: [number, number, number, number] = [x0, y0, x1, y1];
    const wide = view.w >= 900;
    view.cam = view.fit(
      box,
      wide
        ? { top: 90, right: 360, bottom: 120, left: 360 }
        : { top: 70, right: 40, bottom: 70, left: 40 },
      6,
    );
    view.dirty();
  }

  // ---------------------------------------------------------------- loop
  let t = 0;
  let last = performance.now();
  let visible = false;
  let state: 'synced' | 'offline' | 'sending' = 'synced';
  let queued = 0;
  let sent = 0;

  const ease = (x: number) => 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, x))) / 2;
  function distanceAt(time: number): number {
    if (time < T.arrive) return FROM + (at - FROM) * ease(time / T.arrive);
    if (time < T.leave) return at;
    return at + (TO - at) * ease((time - T.leave) / (T.end - T.leave));
  }

  function setState(next: typeof state): void {
    if (next === state) return;
    state = next;
    pill.dataset.state = next;
    tag.toggleAttribute('data-offline', next === 'offline');
  }

  function step(time: number): void {
    const d = distanceAt(time);
    const inZone = d > ZONE[0] && d < ZONE[1];
    // Updates made in the zone: arrived, delivered, photos and signature.
    const made =
      time < T.arrive + 0.2 ? 0 : time < T.arrive + 1.2 ? 1 : time < T.arrive + 1.9 ? 2 : 3;
    const flushAt = T.leave + (T.end - T.leave) * 0.42;
    const flushed =
      inZone || time < flushAt ? 0 : Math.min(3, Math.floor((time - flushAt) / 0.45) + 1);
    const nextQueued = made - flushed;
    if (nextQueued !== queued || flushed !== sent) {
      // Only what is waiting (or received) takes space; the cards fit their content.
      queue.forEach((li, i) => {
        const on = i < made && i >= flushed;
        if (on && li.hidden)
          gsap.fromTo(li, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: reduced ? 0 : 0.35 });
        li.hidden = !on;
      });
      received.forEach((li, i) => {
        const on = i < flushed;
        if (on && li.hidden)
          gsap.fromTo(
            li,
            { opacity: 0, x: -10 },
            { opacity: 1, x: 0, duration: reduced ? 0 : 0.35 },
          );
        li.hidden = !on;
      });
      gsap.to(note, { opacity: flushed === 3 ? 1 : 0, duration: 0.3, overwrite: true });
      waiting.hidden = flushed > 0;
      allSent.hidden = nextQueued > 0;
      queued = nextQueued;
      sent = flushed;
    }
    const st = inZone ? 'offline' : queued > 0 ? 'sending' : 'synced';
    setState(st);
    const text =
      st === 'offline'
        ? fill(c.offline, { n: queued })
        : st === 'sending'
          ? fill(c.sending, { n: queued })
          : c.synced;
    if (pill.textContent !== text) pill.textContent = text;
    if (tagText.textContent !== text) tagText.textContent = text;

    view.progress[4] = d;
    view.stopStates[4]![stop] =
      time > T.arrive + 1.2 ? 'delivered' : time > T.arrive ? 'arrived' : 'pending';
    const p = R5.line.at(d);
    view.vans = [
      {
        slot: 4,
        x: p.x,
        y: p.y,
        angle: p.angle,
        signal: inZone ? 'no_signal' : 'moving',
        alpha: 1,
      },
    ];
  }

  function frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!visible) return;
    view.resize();
    if (!reduced) t = (t + dt) % T.loop;
    step(t);
    view.render(now / 1000);
    const p = view.vans[0]!;
    const s = view.toScreen(p.x, p.y);
    tag.style.transform = `translate(${s.x}px, ${s.y - 26}px) translate(-50%, -100%)`;
    updateInstruments(view, inst);
  }

  if (reduced) t = T.arrive + 2; // the stop inside the zone, three updates waiting
  view.ready.then(camera);
  new ResizeObserver(() => {
    view.resize();
    camera();
  }).observe(canvas);
  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      visible = self.isActive;
      last = performance.now();
    },
  });
  gsap.ticker.add(frame);
}
