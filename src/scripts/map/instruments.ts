/**
 * Map instrumentation, the same on every map on the page: the coordinates
 * under the pointer (or the map's centre) and a scale bar with a round length.
 */
import { metresPerUnit, unproject } from './geo.ts';
import type { MapView } from './view.ts';

export interface InstrumentEls {
  coords: HTMLElement | null;
  bar: HTMLElement | null;
  scale: HTMLElement | null;
}

const lengths = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

export function instrumentEls(root: ParentNode): InstrumentEls {
  return {
    coords: root.querySelector<HTMLElement>('[data-inst-coords]'),
    bar: root.querySelector<HTMLElement>('[data-inst-bar]'),
    scale: root.querySelector<HTMLElement>('[data-inst-scale]'),
  };
}

export function updateInstruments(
  view: MapView,
  els: InstrumentEls,
  at: { x: number; y: number } = { x: view.w / 2, y: view.h / 2 },
): void {
  const p = view.toMap(at.x, at.y);
  const ll = unproject(p.x, p.y);
  if (els.coords) els.coords.textContent = `${ll.lat.toFixed(3)}° N · ${ll.lng.toFixed(3)}° E`;
  const pxPerKm = view.k / (metresPerUnit(ll.lat) / 1000);
  const km = lengths.find((s) => s * pxPerKm >= 54) ?? 100;
  if (els.bar) els.bar.style.width = `${Math.round(km * pxPerKm)}px`;
  const label = km < 1 ? `${km * 1000} m` : `${km} km`;
  if (els.scale && els.scale.textContent !== label) els.scale.textContent = label;
}
