/** A still of the Šar mountains' contours behind "made for here": no routes, no labels. */
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { project } from './map/geo.ts';
import { MapView } from './map/view.ts';

export function initLocal(root: HTMLElement, lang: 'sq' | 'en'): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-map]')!;
  const view = new MapView(canvas, 'paper', lang);
  view.setRoutes([]);
  view.layer.labels = 0;
  view.layer.depot = 0;
  const a = project(20.72, 42.32);
  const b = project(21.12, 42.04);
  const draw = () => {
    view.resize();
    view.cam = view.fit([a.x, a.y, b.x, b.y], { top: 0, right: 0, bottom: 0, left: 0 }, 4);
    view.dirty();
    view.render(0);
  };
  let shown = false;
  view.ready.then(() => shown && draw());
  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    once: true,
    onEnter: () => {
      shown = true;
      view.ready.then(draw);
    },
  });
  new ResizeObserver(() => shown && view.ready.then(draw)).observe(canvas);
}
