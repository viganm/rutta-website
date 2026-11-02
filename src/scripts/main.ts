/**
 * Page entry: smooth scrolling, GSAP plugins, and each section's behaviour.
 * Everything renders without this script; it only adds motion and the live
 * demos, and reduced motion keeps every state change but drops the travel.
 */
import { gsap } from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { copy, type Lang } from '../i18n/index.ts';
import { initDemo } from './demo.ts';
import { initDriver } from './driver.ts';
import { initLocal } from './local.ts';
import { initPin } from './pin.ts';
import { initPlans } from './plans.ts';
import { initReports } from './reports.ts';
import { initSignal } from './signal.ts';
import { initStage } from './stage.ts';
import { initToday } from './today.ts';

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);

const lang = (document.documentElement.lang === 'en' ? 'en' : 'sq') as Lang;
const t = copy[lang];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduced) {
  const lenis = new Lenis({ autoRaf: false, anchors: { offset: -68 }, lerp: 0.11 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

// The nav takes the colours of the section under it, and a solid ground once scrolled.
const nav = document.querySelector<HTMLElement>('[data-nav]');
if (nav) {
  const sections = [...document.querySelectorAll<HTMLElement>('main .night, main .paper, footer')];
  const theme = () => {
    const under = sections.find((s) => {
      const r = s.getBoundingClientRect();
      return r.top <= 34 && r.bottom > 34;
    });
    const paper = !!under?.classList.contains('paper');
    nav.classList.toggle('paper', paper);
    nav.classList.toggle('night', !paper);
  };
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: theme, onRefresh: theme });
  // Solid once the page has moved at all, including at the very end.
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => nav.toggleAttribute('data-solid', self.scroll() > 40),
    onRefresh: (self) => nav.toggleAttribute('data-solid', self.scroll() > 40),
  });
}

const $ = (s: string) => document.querySelector<HTMLElement>(s);
const sections: [string, (el: HTMLElement) => void][] = [
  ['[data-stage]', (el) => initStage(el, t, lang, reduced)],
  ['#driver', (el) => initDriver(el, t.driver.phone.sending, t.driver.phone.synced, reduced)],
  ['[data-signal]', (el) => initSignal(el, lang, reduced)],
  ['[data-pin]', (el) => initPin(el, lang, reduced)],
  ['[data-today]', (el) => initToday(el, t, reduced)],
  ['[data-reports]', (el) => initReports(el, reduced)],
  ['[data-local]', (el) => initLocal(el, lang)],
  ['[data-plans]', (el) => initPlans(el, reduced)],
  ['[data-demo]', (el) => initDemo(el, lang)],
];
for (const [selector, init] of sections) {
  const el = $(selector);
  // One section failing must never take the rest of the page with it.
  if (el) {
    try {
      init(el);
    } catch (error) {
      console.error(error);
    }
  }
}
