/**
 * The close. The paper map shows the finished day (every route driven, every
 * stop decided); the form checks its three required fields and opens the
 * visitor's email app with the request written out.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { fill, type Copy } from '../i18n/index.ts';
import { instrumentEls, updateInstruments } from './map/instruments.ts';
import { MapView } from './map/view.ts';
import { failReason, routes } from './sim.ts';

type DemoCopy = Copy['demo'] & { email: string };

export function initDemo(root: HTMLElement, lang: 'sq' | 'en'): void {
  const c = JSON.parse(root.querySelector('template[data-copy]')!.innerHTML) as DemoCopy;
  initForm(root, c);

  const canvas = root.querySelector<HTMLCanvasElement>('[data-map]')!;
  const view = new MapView(canvas, 'paper', lang);
  view.setRoutes(routes.map((r) => ({ slot: r.data.slot, line: r.line, stops: r.data.stops })));
  routes.forEach((r, i) => {
    view.progress[i] = r.line.length;
    view.stopStates[i] = r.data.stops.map((_, j) => (failReason(r, j) ? 'failed' : 'delivered'));
  });
  view.vans = [];

  const camera = () => {
    const wide = view.w >= 900;
    view.cam = view.fit(
      view.kosovo,
      wide
        ? { top: 100, right: 60, bottom: 80, left: Math.min(720, view.w * 0.46) }
        : { top: 70, right: 16, bottom: view.h * 0.5, left: 16 },
    );
    view.dirty();
  };
  let visible = false;
  view.ready.then(camera);
  new ResizeObserver(() => {
    view.resize();
    camera();
  }).observe(canvas);
  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => (visible = self.isActive),
  });
  const inst = instrumentEls(root);
  gsap.ticker.add(() => {
    if (!visible) return;
    view.resize();
    view.render(performance.now() / 1000);
    updateInstruments(view, inst, { x: view.w * 0.72, y: view.h * 0.5 });
  });
}

function initForm(root: HTMLElement, c: DemoCopy): void {
  const form = root.querySelector<HTMLFormElement>('[data-form]')!;
  const note = root.querySelector<HTMLElement>('[data-form-note]')!;
  const planNote = root.querySelector<HTMLElement>('[data-plan-note]')!;

  // "Talk to us" on a plan fills in which plan.
  document.querySelectorAll<HTMLAnchorElement>('[data-plan]').forEach((a) =>
    a.addEventListener('click', () => {
      (form.elements.namedItem('plan') as HTMLInputElement).value = a.dataset.plan!;
      planNote.textContent = fill(c.planChosen, { plan: a.dataset.plan! });
      planNote.hidden = false;
    }),
  );

  const required = ['name', 'company', 'contact'] as const;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const check = (name: string) => {
    const input = field(name);
    const ok = input.value.trim().length > 0;
    input.setAttribute('aria-invalid', String(!ok));
    root.querySelector<HTMLElement>(`#${input.id}-err`)!.hidden = ok;
    return ok;
  };
  required.forEach((name) =>
    field(name).addEventListener(
      'blur',
      () => field(name).getAttribute('aria-invalid') && check(name),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bad = required.filter((name) => !check(name));
    if (bad.length) {
      field(bad[0]!).focus();
      return;
    }
    const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim();
    const lines = [
      `${c.lines.name}: ${v('name')}`,
      `${c.lines.company}: ${v('company')}`,
      `${c.lines.contact}: ${v('contact')}`,
      `${c.lines.fleet}: ${v('fleet')}`,
      v('plan') && `${c.lines.plan}: ${v('plan')}`,
      v('message') && `\n${c.lines.message}:\n${v('message')}`,
    ].filter(Boolean);
    const subject = fill(c.subject, { company: v('company') });
    window.location.href = `mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
    note.textContent = fill(c.sent, { email: c.email });
  });
}
