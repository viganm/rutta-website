/**
 * A pin put right on Prishtinë's real streets: the order sheet's approximate
 * pin, the delivery recorded at the gate (Dispatch shows how far from the pin
 * it happened), then the dispatcher drags the pin to the gate and saves it as
 * verified, the way Rutta Dispatch's pin picker works.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { fill } from '../i18n/index.ts';
import { metresPerUnit, project } from './map/geo.ts';
import { instrumentEls, updateInstruments } from './map/instruments.ts';
import { MapView } from './map/view.ts';

const OLD = project(21.1714, 42.6547);
const GATE = project(21.1693, 42.6534);

export function initPin(root: HTMLElement, lang: 'sq' | 'en', reduced: boolean): void {
  const c = JSON.parse(root.querySelector('template[data-copy]')!.innerHTML) as {
    delivered: string;
    verified: string;
  };
  const canvas = root.querySelector<HTMLCanvasElement>('[data-map]')!;
  const oldLabel = root.querySelector<HTMLElement>('[data-old-label]')!;
  const fixLabel = root.querySelector<HTMLElement>('[data-fix-label]')!;
  const verifiedLabel = root.querySelector<HTMLElement>('[data-verified-label]')!;
  const bar = root.querySelector<HTMLElement>('[data-bar]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const approximate = status.textContent!;
  const metres =
    Math.round((Math.hypot(GATE.x - OLD.x, GATE.y - OLD.y) * metresPerUnit(42.654)) / 10) * 10;
  root.querySelector('[data-delivered]')!.textContent = fill(c.delivered, { m: metres });

  const inst = instrumentEls(root);
  const view = new MapView(canvas, 'paper', lang);
  view.setRoutes([]);
  view.layer.depot = 0;
  view.layer.labels = 0;
  view.useStreets();

  // Everything the overlay draws reads from this; the timeline tweens it.
  const s = { fix: 0, line: 0, move: 0, lift: 0 };
  const pin = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    lift: number,
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = `rgba(18, 26, 23, ${0.22 - lift * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7 - lift * 2, 2.6 - lift, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(0, -lift * 10);
    ctx.scale(1 + lift * 0.12, 1 + lift * 0.12);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-4, -8, -12, -14, -12, -24);
    ctx.arc(0, -24, 12, Math.PI, 0);
    ctx.bezierCurveTo(12, -14, 4, -8, 0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, -24, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  view.overlay = (ctx) => {
    const d = view.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const o = view.toScreen(OLD.x, OLD.y);
    const g = view.toScreen(GATE.x, GATE.y);
    // Where the delivery actually happened: the proof's GPS fix at the gate.
    if (s.fix > 0.01) {
      ctx.globalAlpha = s.fix;
      ctx.fillStyle = 'rgba(24, 100, 171, 0.12)';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1864AB';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // How far from the pin it was.
    if (s.line > 0.01) {
      ctx.globalAlpha = Math.min(1, s.line * 2) * (1 - s.move);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#1864AB';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + (g.x - o.x) * s.line, o.y + (g.y - o.y) * s.line);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    const m = s.move;
    pin(
      ctx,
      o.x + (g.x - o.x) * m,
      o.y + (g.y - o.y) * m,
      m > 0.98 ? '#0F5C4A' : '#77857E',
      s.lift,
    );
  };

  function camera(): void {
    const narrow = view.w < 560;
    const box: [number, number, number, number] = [
      Math.min(OLD.x, GATE.x),
      Math.min(OLD.y, GATE.y),
      Math.max(OLD.x, GATE.x),
      Math.max(OLD.y, GATE.y),
    ];
    view.cam = view.fit(
      box,
      { top: narrow ? 190 : 150, right: 170, bottom: 150, left: narrow ? 70 : 190 },
      7.2,
    );
    view.dirty();
  }

  // Tags beside their points, kept inside the card.
  const put = (el: HTMLElement, x: number, y: number) => {
    const w = el.offsetWidth;
    const px = Math.max(10, Math.min(view.w - w - 10, x));
    el.style.transform = `translate(${px}px, ${y}px)`;
  };
  function place(): void {
    const o = view.toScreen(OLD.x, OLD.y);
    const g = view.toScreen(GATE.x, GATE.y);
    put(oldLabel, o.x + 16, o.y - 30);
    put(fixLabel, g.x - fixLabel.offsetWidth - 16, g.y + 6);
    put(verifiedLabel, g.x + 16, g.y - 30);
  }

  const tl = gsap.timeline({
    paused: true,
    repeat: -1,
    repeatDelay: 1.4,
    defaults: { ease: 'power3.out' },
  });
  tl.set(s, { fix: 0, line: 0, move: 0, lift: 0 }, 0)
    .set([fixLabel, verifiedLabel], { opacity: 0, y: 4 }, 0)
    .set(oldLabel, { opacity: 1 }, 0)
    .set(bar, { opacity: 0, y: 14 }, 0)
    .set(root.querySelector('[data-done]'), { opacity: 0 }, 0)
    .call(
      () => {
        status.textContent = approximate;
        status.dataset.tone = 'warning';
      },
      [],
      0,
    )
    // The delivery, recorded at the gate.
    .to(s, { fix: 1, duration: 0.5 }, 0.6)
    .to(fixLabel, { opacity: 1, y: 0, duration: 0.4 }, 0.8)
    .to(s, { line: 1, duration: 0.8, ease: 'power2.inOut' }, 1.2)
    // The dispatcher opens the pin and drags it to the gate.
    .to(bar, { opacity: 1, y: 0, duration: 0.5 }, 2.4)
    .to(oldLabel, { opacity: 0, duration: 0.25 }, 2.9)
    .to(s, { lift: 1, duration: 0.25, ease: 'power2.out' }, 3)
    .to(s, { move: 1, duration: 1.1, ease: 'power2.inOut' }, 3.2)
    .to(s, { lift: 0, duration: 0.45, ease: 'back.out(3)' }, 4.25)
    .to(fixLabel, { opacity: 0, duration: 0.3 }, 4.3)
    .to(s, { fix: 0, duration: 0.4 }, 4.4)
    .call(
      () => {
        status.textContent = c.verified;
        status.dataset.tone = 'delivered';
      },
      [],
      4.5,
    )
    .fromTo(
      root.querySelector('[data-save]'),
      { scale: 1 },
      { scale: 0.94, duration: 0.12, yoyo: true, repeat: 1 },
      4.9,
    )
    .to(root.querySelector('[data-done]'), { opacity: 1, duration: 0.3 }, 5.15)
    .to(verifiedLabel, { opacity: 1, y: 0, duration: 0.4 }, 5.2)
    .to({}, { duration: 2.6 }, 5.6);

  let visible = false;
  const frame = () => {
    if (!visible) return;
    view.resize();
    view.render(performance.now() / 1000);
    place();
    updateInstruments(view, inst);
  };
  view.ready.then(camera);
  new ResizeObserver(() => {
    view.resize();
    camera();
  }).observe(canvas);

  if (reduced) {
    // The finished correction: pin at the gate, verified, nothing moving.
    tl.seek(7.6).pause();
  }
  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => (visible = self.isActive),
  });
  if (!reduced) {
    ScrollTrigger.create({
      trigger: root,
      start: 'top 70%',
      end: 'bottom top',
      onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
    });
  }
  gsap.ticker.add(frame);
}
