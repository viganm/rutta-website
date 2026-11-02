/**
 * The driver app plays one delivery through: swipe to Arrived, the delivery
 * sheet (photo, the exact cash in one tap, a signature), then five seconds
 * to undo while it syncs. The step list follows along and jumps the phone.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function initDriver(
  root: HTMLElement,
  sending: string,
  synced: string,
  reduced: boolean,
): void {
  const q = <T extends Element = HTMLElement>(s: string) => root.querySelector<T & HTMLElement>(s)!;
  const steps = [...root.querySelectorAll<HTMLButtonElement>('[data-step-index]')];
  const rails = steps.map((s) => s.querySelector<HTMLElement>('.driver__step-rail i')!);
  const slab = q('[data-slab]');
  const thumb = q('[data-slab-thumb]');
  const sheet = q('[data-screen="deliver"]');
  const toast = q('[data-toast]');
  const count = q('[data-count]');
  const syncText = q('[data-sync-text]');
  const cash = q('[data-cash]');
  const signature = q<SVGPathElement>('[data-signature]');
  const ring = q<SVGCircleElement>('[data-ring]');
  const marks = [0, 2.6, 7.4, 12];

  const tl = gsap.timeline({
    paused: true,
    repeat: -1,
    repeatDelay: 0.4,
    defaults: { ease: 'power3.out' },
  });
  const travel = () => slab.clientWidth - thumb.offsetWidth - 12;

  // Everything back to the start of the stop.
  tl.set(thumb, { x: 0, opacity: 1 }, 0)
    .set(q('[data-slab-fill]'), { scaleX: 0 }, 0)
    .set(q('[data-slab-text]'), { opacity: 1 }, 0)
    .set(q('[data-slab-done]'), { opacity: 0 }, 0)
    .set(slab, { opacity: 1 }, 0)
    .set(sheet, { yPercent: 105 }, 0)
    .set(q('[data-photo]'), { opacity: 0.25 }, 0)
    .set(q('[data-photo-ok]'), { opacity: 0 }, 0)
    .set(signature, { drawSVG: '0%' }, 0)
    .set(q('[data-delivered]'), { opacity: 0, y: 6 }, 0)
    .set(toast, { opacity: 0, y: 16 }, 0)
    .set(ring, { drawSVG: '100%' }, 0)
    .call(
      () => {
        cash.classList.remove('is-on');
        syncText.textContent = synced;
        count.textContent = '5';
      },
      [],
      0,
    );

  // 1. Swipe: Arrived, and the slab becomes Deliver.
  tl.to(thumb, { x: travel, duration: 1, ease: 'power2.inOut' }, 0.7)
    .to(q('[data-slab-fill]'), { scaleX: 1, duration: 1, ease: 'power2.inOut' }, 0.7)
    .to(q('[data-slab-text]'), { opacity: 0, duration: 0.25 }, 0.8)
    .to(thumb, { opacity: 0, duration: 0.2 }, 1.75)
    .to(q('[data-slab-done]'), { opacity: 1, duration: 0.3 }, 1.85);

  // 2. The delivery sheet: photo, cash, signature, confirm.
  tl.to(sheet, { yPercent: 0, duration: 0.6 }, 2.6)
    .to(q('[data-photo]'), { opacity: 1, duration: 0.01 }, 3.4)
    .fromTo(q('[data-flash]'), { opacity: 0.95 }, { opacity: 0, duration: 0.5 }, 3.4)
    .to(q('[data-photo-ok]'), { opacity: 1, duration: 0.3 }, 3.7)
    .call(() => cash.classList.add('is-on'), [], 4.4)
    .fromTo(cash, { scale: 0.97 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' }, 4.4)
    .to(signature, { drawSVG: '100%', duration: 1.5, ease: 'power1.inOut' }, 5)
    .fromTo(
      q('[data-confirm]'),
      { scale: 1 },
      { scale: 0.96, duration: 0.12, yoyo: true, repeat: 1 },
      6.8,
    );

  // 3. Delivered: five seconds to undo while it goes out to dispatch.
  tl.to(sheet, { yPercent: 105, duration: 0.45, ease: 'power2.in' }, 7.25)
    .to(slab, { opacity: 0.35, duration: 0.3 }, 7.4)
    .to(q('[data-delivered]'), { opacity: 1, y: 0, duration: 0.4 }, 7.5)
    .to(toast, { opacity: 1, y: 0, duration: 0.45 }, 7.6)
    .to(ring, { drawSVG: '0%', duration: 4, ease: 'none' }, 7.6);
  for (let n = 4; n >= 1; n--)
    tl.call(() => void (count.textContent = String(n)), [], 7.6 + (5 - n));
  tl.call(() => void (syncText.textContent = sending), [], 11.2)
    .to(toast, { opacity: 0, y: 16, duration: 0.3, ease: 'power2.in' }, 11.6)
    .call(() => void (syncText.textContent = synced), [], 11.8)
    .to({}, { duration: 0.2 }, 11.8);

  // The step list: which step is live, and a rail that fills through it.
  steps.forEach((_, i) => {
    tl.call(
      () => steps.forEach((s, j) => s.setAttribute('aria-pressed', String(i === j))),
      [],
      marks[i]! + 0.001,
    );
    tl.fromTo(
      rails[i]!,
      { '--p': 0 },
      { '--p': 1, duration: marks[i + 1]! - marks[i]!, ease: 'none' },
      marks[i]!,
    );
    tl.set(rails[i]!, { '--p': 0 }, marks[i + 1]! - 0.01);
  });

  // Reduced motion: each step shows its finished state, nothing travels.
  const settled = [2.4, 7.1, 9.2];
  steps.forEach((btn, i) =>
    btn.addEventListener('click', () => {
      if (reduced) {
        tl.seek(settled[i]!).pause();
        steps.forEach((s, j) => s.setAttribute('aria-pressed', String(i === j)));
      } else {
        tl.play(marks[i]!);
      }
    }),
  );

  if (reduced) {
    tl.seek(settled[0]!).pause();
    return;
  }
  ScrollTrigger.create({
    trigger: root,
    start: 'top 70%',
    end: 'bottom 20%',
    onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
  });
}
