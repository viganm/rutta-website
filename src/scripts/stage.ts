/**
 * The wall screen. One night map stays pinned while the hero and the day's
 * steps scroll over it; each step sets a mode and the map follows: orders
 * dropping in, routes drawing themselves, the camera flying to Arben's route,
 * then following his van through Prishtinë's streets.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { fill, type Copy } from '../i18n/index.ts';
import { bindBoard } from './board.ts';
import { instrumentEls, updateInstruments } from './map/instruments.ts';
import { MapView, type Camera, type Pad } from './map/view.ts';
import { clock, clockAt, routes, stateAt, type VanState } from './sim.ts';

type Mode = 'hero' | 'orders' | 'routes' | 'publish' | 'live';

const R1 = routes[0]!;
/** Arben's own clock for the live step: mid-morning in Prishtinë, slower and closer. */
const LIVE_FROM = 8 * 60 + 28;
const LIVE_SPEED = 0.45;

export function initStage(root: HTMLElement, t: Copy, lang: 'sq' | 'en', reduced: boolean): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-map]')!;
  const view = new MapView(canvas, 'night', lang);
  view.setRoutes(routes.map((r) => ({ slot: r.data.slot, line: r.line, stops: r.data.stops })));

  const boardWrap = root.querySelector<HTMLElement>('[data-hero-board]')!;
  const board = bindBoard(boardWrap.querySelector('[data-board]')!, t.board, reduced);
  const inst = {
    clock: root.querySelector<HTMLElement>('[data-inst-clock]')!,
    ...instrumentEls(root),
  };
  const heroCopy = root.querySelector<HTMLElement>('.hero__copy')!;
  const drawer = {
    status: root.querySelector<HTMLElement>('[data-drawer-status]')!,
    next: root.querySelector<HTMLElement>('[data-drawer-next]')!,
    speed: root.querySelector<HTMLElement>('[data-drawer-speed]')!,
    battery: root.querySelector<HTMLElement>('[data-drawer-battery]')!,
    heard: root.querySelector<HTMLElement>('[data-drawer-heard]')!,
  };

  let mode: Mode = 'hero';
  let seconds = 0;
  let liveSeconds = 0;
  let lastClock = 0;
  let pointer: { x: number; y: number } | null = null;
  let hovered: number | null = null;
  let visible = true;
  const target: Camera = { ...view.cam };
  const stepTimes: Partial<Record<Mode, string>> = {
    orders: t.day.steps.orders.time,
    routes: t.day.steps.routes.time,
    publish: t.day.steps.publish.time,
  };

  // ------------------------------------------------------------- cameras
  const wide = () => view.w >= 1100;
  const phone = () => view.w < 700;
  const nav = 68;

  function pads(m: Mode): Pad {
    const { w, h } = view;
    if (phone()) {
      return m === 'hero'
        ? { top: h * 0.56, right: 14, bottom: 46, left: 14 }
        : { top: nav + 8, right: 14, bottom: h * 0.5, left: 14 };
    }
    const card = Math.min(460, w * 0.48) + Math.max(16, w * 0.042) + 36;
    if (m === 'hero') {
      // Nothing of the map sits under the copy: the country starts where it ends.
      return wide()
        ? {
            top: nav + 24,
            right: 320 + Math.max(16, w * 0.042) + 14,
            bottom: 48,
            left: heroCopy.getBoundingClientRect().right + 32,
          }
        : { top: h * 0.5, right: 24, bottom: 54, left: 24 };
    }
    return { top: nav + 32, right: 32, bottom: 64, left: card };
  }

  function cameraFor(m: Mode): Camera {
    if (m === 'publish') {
      const b = R1.line.bbox();
      const box: [number, number, number, number] = [b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2];
      return view.fit(box, pads(m), 4.2);
    }
    if (m === 'live') return follow();
    return view.fit(view.kosovo, pads(m));
  }

  /** Keep Arben's van in the open part of the screen, at street level. */
  function follow(): Camera {
    const s = r1Live();
    const p = R1.line.at(s.d);
    const z = phone() ? 4.15 : 4.5;
    const k = 2 ** z;
    const pad = pads('live');
    const sx = pad.left + (view.w - pad.left - pad.right) / 2;
    const sy = pad.top + (view.h - pad.top - pad.bottom) / 2;
    return { x: p.x - (sx - view.w / 2) / k, y: p.y - (sy - view.h / 2) / k, z };
  }

  const r1Live = (): VanState => {
    const span = R1.legs.at(-1)!.arrive - LIVE_FROM - 4;
    return stateAt(R1, LIVE_FROM + ((liveSeconds * LIVE_SPEED) % span));
  };

  function snapCamera(): void {
    Object.assign(target, cameraFor(mode));
    Object.assign(view.cam, target);
    keepLabelsOffCopy();
    view.dirty();
  }

  /**
   * No map label under the instrument strip, and in the hero none under the
   * headline, the lead or the buttons.
   */
  function keepLabelsOffCopy(): void {
    const r = heroCopy.getBoundingClientRect();
    const canvasTop = canvas.getBoundingClientRect().top;
    const strip: [number, number, number, number] = [0, view.h - 48, view.w, view.h];
    view.exclusions =
      mode === 'hero'
        ? [strip, [r.left - 16, r.top - canvasTop - 16, r.right + 16, r.bottom - canvasTop + 16]]
        : [strip];
    view.dirty();
  }

  // --------------------------------------------------------------- modes
  const tweens: gsap.core.Animation[] = [];
  const all = (v: number) => Object.fromEntries(routes.map((_, i) => [i, v]));

  function setMode(next: Mode): void {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    tweens.splice(0).forEach((tw) => tw.kill());
    const d = reduced ? 0 : 1;
    const tw = (targets: object, vars: gsap.TweenVars) =>
      tweens.push(
        gsap.to(targets, { duration: 0.8 * d, ease: 'power2.out', overwrite: 'auto', ...vars }),
      );

    Object.assign(target, cameraFor(mode));
    if (reduced) Object.assign(view.cam, target);
    keepLabelsOffCopy();

    tw(boardWrap, {
      autoAlpha: mode === 'hero' ? 1 : 0,
      y: mode === 'hero' ? 0 : -12,
      duration: 0.5 * d,
    });
    // The clock is where each step's time lives: it steps forward with a pulse.
    if (mode !== 'hero' && !reduced) {
      inst.clock.animate(
        [
          { transform: 'scale(1.35)', color: 'var(--primary)' },
          { transform: 'none', color: 'var(--text)' },
        ],
        { duration: 900, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      );
    }

    if (mode === 'hero') {
      tw(view.layer, { routes: 1, vans: 1, stops: 1, depot: 1, aheadAlpha: 0.38 });
      tw(view, { orders: 0 });
      tw(view.draw, all(1));
      tw(view.focus, all(1));
      view.pops.forEach((p) =>
        tw(p, { ...Object.fromEntries(p.map((_, i) => [i, 1])), duration: 0.3 * d }),
      );
    }

    if (mode === 'orders') {
      tw(view.layer, { routes: 0, vans: 0, stops: 1, depot: 1, duration: 0.5 * d });
      tw(view.focus, all(1));
      view.orders = 1;
      // Orders drop in town by town, west to east, like rows arriving in a sheet.
      const drops = routes.flatMap((r, ri) => r.data.stops.map((s, si) => ({ ri, si, x: s.x })));
      drops.sort((a, b) => a.x - b.x);
      if (prev === 'hero') view.pops.forEach((p) => p.fill(0));
      drops.forEach((o, i) =>
        tw(view.pops[o.ri]!, {
          [o.si]: 1,
          duration: 0.5 * d,
          ease: 'back.out(2.4)',
          delay: 0.2 + i * 0.022 * d,
        }),
      );
      playImport();
    }

    if (mode === 'routes') {
      view.pops.forEach((p) => p.fill(1));
      tw(view, { orders: 0, duration: 0.6 * d });
      tw(view.layer, {
        routes: 1,
        vans: 0,
        stops: 1,
        depot: 1,
        aheadAlpha: 0.95,
        duration: 0.3 * d,
      });
      tw(view.focus, all(1));
      view.progress.fill(0);
      if (prev === 'orders' || prev === 'hero') view.draw.fill(0);
      routes.forEach((_, i) =>
        tw(view.draw, {
          [i]: 1,
          duration: 1.1 * d,
          ease: 'power2.inOut',
          delay: 0.15 + i * 0.16 * d,
        }),
      );
      playBuilder();
      view.useStreets();
    }

    if (mode === 'publish' || mode === 'live') {
      view.pops.forEach((p) => p.fill(1));
      tw(view, { orders: 0 });
      tw(view.draw, all(1));
      tw(view.focus, { ...all(0.13), 0: 1 });
      tw(view.layer, {
        routes: 1,
        vans: 1,
        stops: 1,
        depot: 1,
        aheadAlpha: mode === 'live' ? 0.42 : 0.95,
      });
      view.useStreets();
      if (mode === 'publish') playPublish();
      if (mode === 'live') {
        view.useStreets();
        liveSeconds = 0;
      }
    }
  }

  // ------------------------------------------------ the step cards' UI bits
  const importEl = root.querySelector<HTMLElement>('[data-import]')!;
  function playImport(): void {
    if (reduced) return;
    const rows = importEl.querySelectorAll('[data-map-row]');
    const tl = gsap.timeline();
    tl.from(rows, { opacity: 0, x: -10, stagger: 0.12, duration: 0.45, ease: 'power3.out' })
      .from(
        importEl.querySelectorAll('.ui-import__arrow path'),
        { drawSVG: 0, stagger: 0.12, duration: 0.4 },
        0.1,
      )
      .from(
        importEl.querySelectorAll('.ui-import__ok'),
        { scale: 0, transformOrigin: '50% 50%', stagger: 0.12, duration: 0.4, ease: 'back.out(3)' },
        0.35,
      )
      .fromTo(
        importEl.querySelectorAll('[data-ready],[data-fix]'),
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, stagger: 0.08, duration: 0.4 },
        0.9,
      )
      .to(
        importEl.querySelectorAll('[data-ready],[data-fix]'),
        { opacity: 0, y: -6, duration: 0.3 },
        2.4,
      )
      .fromTo(
        importEl.querySelector('[data-done]'),
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.4 },
        2.6,
      );
    tweens.push(tl);
  }

  const builderEl = root.querySelector<HTMLElement>('[data-builder]')!;
  function playBuilder(): void {
    if (reduced) return;
    builderEl.querySelectorAll<HTMLElement>('[data-fill]').forEach((bar, i) => {
      const p = bar.style.getPropertyValue('--p');
      tweens.push(
        gsap.fromTo(
          bar,
          { '--p': 0 },
          { '--p': p, duration: 1.2, ease: 'power3.out', delay: 0.3 + i * 0.07 },
        ),
      );
    });
  }

  const publishEl = root.querySelector<HTMLElement>('[data-publish]')!;
  function playPublish(): void {
    if (reduced) return;
    const tl = gsap.timeline({ delay: 0.3 });
    tl.fromTo(
      publishEl.querySelector('[data-publish-btn]'),
      { scale: 1 },
      { scale: 0.94, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out' },
    )
      .fromTo(
        publishEl.querySelector('[data-toast]'),
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' },
        0.25,
      )
      .fromTo(
        publishEl.querySelectorAll('.mini__next, .mini__list li'),
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, stagger: 0.08, duration: 0.45, ease: 'power3.out' },
        0.45,
      );
    tweens.push(tl);
  }

  // ------------------------------------------------------------ the frame
  let lastTime = performance.now();
  function frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (!visible) return;
    if (!reduced) {
      seconds += dt;
      if (mode === 'live') liveSeconds += dt;
    }
    view.resize();

    const clockNow = clockAt(seconds);
    if (clockNow < lastClock - 1 && !reduced) {
      // The time-lapse looped back to the morning: let the vans blink over.
      gsap.fromTo(view.layer, { vans: 0 }, { vans: 1, duration: 0.8 });
    }
    lastClock = clockNow;

    if (mode === 'hero') {
      const states = routes.map((r) => stateAt(r, clockNow));
      view.vans = states.map((s, i) => vanFor(i, s, 1));
      states.forEach((s, i) => {
        view.progress[i] = s.d;
        view.stopStates[i] = s.stops;
      });
      board.update(clockNow);
      inst.clock.textContent = clock(clockNow);
    } else if (mode === 'publish' || mode === 'live') {
      const s = mode === 'live' ? r1Live() : stateAt(R1, R1.legs[0]!.depart - 1);
      view.vans = [vanFor(0, s, 1)];
      view.progress.fill(0);
      view.progress[0] = s.d;
      view.stopStates.forEach((st) => st.fill('pending'));
      view.stopStates[0] = s.stops;
      if (mode === 'live') {
        Object.assign(target, follow());
        updateDrawer(s);
        inst.clock.textContent = clock(LIVE_FROM + liveSeconds * LIVE_SPEED);
      } else {
        inst.clock.textContent = stepTimes.publish!;
      }
    } else {
      view.vans = [];
      view.stopStates.forEach((st) => st.fill('pending'));
      inst.clock.textContent = stepTimes[mode] ?? '';
    }

    // Ease the camera toward its target (in log-zoom, so flights feel even).
    const c = view.cam;
    const rate = reduced ? 1 : 1 - Math.exp(-dt * (mode === 'live' ? 2.6 : 2.2));
    const moved =
      Math.abs(target.x - c.x) > 0.01 ||
      Math.abs(target.y - c.y) > 0.01 ||
      Math.abs(target.z - c.z) > 0.0005;
    if (moved) {
      c.x += (target.x - c.x) * rate;
      c.y += (target.y - c.y) * rate;
      c.z += (target.z - c.z) * rate;
    }

    view.render(now / 1000);
    instruments();
  }

  function vanFor(i: number, s: VanState, alpha: number) {
    const p = routes[i]!.line.at(s.d);
    let a = alpha;
    if (s.signal === 'not_started') a *= 0.85;
    if (s.signal === 'finished') a *= 0.5;
    return { slot: i, x: p.x, y: p.y, angle: p.angle, signal: s.signal, alpha: a };
  }

  let battery = 82;
  function updateDrawer(s: VanState): void {
    const next = s.next < R1.data.stops.length ? R1.data.stops[s.next]! : null;
    drawer.status.dataset.tone = s.signal;
    drawer.status.textContent = t.board.signal[s.signal];
    drawer.next.textContent = next
      ? fill(t.board.next, { n: s.next + 1, name: next.name })
      : t.board.done;
    drawer.speed.textContent = fill(t.board.kmh, {
      n: s.signal === 'moving' ? Math.max(8, s.speedKmh) : 0,
    });
    battery = Math.max(61, 82 - liveSeconds * 0.05);
    drawer.battery.textContent = `${Math.round(battery)}%`;
    const ago = Math.floor(liveSeconds % 6);
    drawer.heard.textContent = fill(t.board.lastHeard, {
      when: ago < 1 ? t.board.justNow : fill(t.board.secondsAgo, { n: ago }),
    });
  }

  // The coordinates under the pointer (or the open part of the map) and the scale.
  function instruments(): void {
    updateInstruments(view, inst, pointer ?? { x: view.w * 0.68, y: view.h * 0.5 });
  }

  // ----------------------------------------------------------- interaction
  function focus(slot: number | null): void {
    if (mode !== 'hero' || slot === hovered) return;
    hovered = slot;
    board.setFocus(slot);
    gsap.to(view.focus, {
      ...all(slot === null ? 1 : 0.18),
      ...(slot === null ? {} : { [slot]: 1 }),
      duration: reduced ? 0 : 0.35,
      ease: 'power2.out',
      overwrite: 'auto',
    });
  }
  board.onFocus(focus);
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    const slot = view.vanAt(pointer.x, pointer.y);
    canvas.style.cursor = slot === null ? '' : 'pointer';
    if (slot !== null || hovered !== null) focus(slot);
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    focus(null);
  });

  // ------------------------------------------------------------ lifecycle
  // The active step is whichever trigger is live, decided again after every
  // refresh: positions measured before fonts and styles settle are wrong.
  const triggers: ScrollTrigger[] = [];
  root.querySelectorAll<HTMLElement>('[data-step]').forEach((el) =>
    triggers.push(
      ScrollTrigger.create({
        trigger: el,
        start: el.dataset.step === 'hero' ? 'top top' : 'top 60%',
        end: 'bottom 60%',
        onToggle: syncMode,
      }),
    ),
  );
  function syncMode(): void {
    const active = triggers.filter((tr) => tr.isActive).at(-1);
    setMode(((active?.trigger as HTMLElement | undefined)?.dataset.step as Mode) ?? 'hero');
  }
  ScrollTrigger.addEventListener('refresh', syncMode);
  if (import.meta.env.DEV) Object.assign(window, { __stage: { view, target, mode: () => mode } });

  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    lastTime = performance.now();
  }).observe(root);

  let resizeTimer = 0;
  new ResizeObserver(() => {
    view.resize();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(snapCamera, 60);
  }).observe(canvas);

  view.ready.then(() => {
    snapCamera();
    intro();
  });
  gsap.ticker.add(frame);

  // ----------------------------------------------------- the first moment
  // Routes draw themselves out of the depot while the headline rises.
  function intro(): void {
    document.documentElement.classList.remove('js-intro');
    if (reduced) return;
    view.draw.fill(0);
    view.layer.vans = 0;
    const tl = gsap.timeline({ delay: 0.15 });
    routes.forEach((_, i) =>
      tl.to(view.draw, { [i]: 1, duration: 1.6, ease: 'power2.inOut' }, i * 0.09),
    );
    tl.to(view.layer, { vans: 1, duration: 0.6, ease: 'power2.out' }, 0.9);
    const title = root.querySelector<HTMLElement>('[data-hero-title]')!;
    const text = title.textContent!;
    const lines = splitLines(title);
    tl.from(
      lines,
      {
        yPercent: 110,
        duration: 1.1,
        stagger: 0.09,
        ease: 'power4.out',
        // Back to plain text so the heading reflows on resize.
        onComplete: () => void (title.textContent = text),
      },
      0,
    );
    tl.from(
      root.querySelectorAll('.hero__lead, .hero__actions'),
      { opacity: 0, y: 14, duration: 0.9, stagger: 0.08, ease: 'power3.out' },
      0.45,
    );
    tl.from(boardWrap, { opacity: 0, y: 16, duration: 0.9, ease: 'power3.out' }, 0.6);
    tl.from(root.querySelector('[data-instruments]'), { opacity: 0, duration: 0.8 }, 1);
  }
}

/** Wraps each rendered line of a heading in a mask, for a line-by-line rise. */
function splitLines(el: HTMLElement): HTMLElement[] {
  const words = el.textContent!.trim().split(/\s+/);
  el.innerHTML = words.map((w) => `<span class="w">${w}</span>`).join(' ');
  const lines: HTMLElement[][] = [];
  let top = -Infinity;
  el.querySelectorAll<HTMLElement>('.w').forEach((w) => {
    if (w.offsetTop > top + 2) {
      lines.push([]);
      top = w.offsetTop;
    }
    lines.at(-1)!.push(w);
  });
  el.innerHTML = '';
  return lines.map((line) => {
    const mask = document.createElement('span');
    mask.className = 'line-mask';
    const inner = document.createElement('span');
    inner.className = 'line';
    inner.textContent = line.map((w) => w.textContent).join(' ');
    mask.append(inner);
    el.append(mask, ' ');
    return inner;
  });
}
