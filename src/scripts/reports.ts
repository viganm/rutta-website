/**
 * Reports: the bars grow from their baseline once, as the panel arrives, and
 * every mark has a tooltip (pointer and keyboard).
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function initReports(root: HTMLElement, reduced: boolean): void {
  const tip = root.querySelector<HTMLElement>('[data-tip-box]')!;
  const show = (el: HTMLElement, x: number, y: number) => {
    tip.textContent = el.dataset.tip ?? '';
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, calc(-100% - 12px))`;
    tip.toggleAttribute('data-on', true);
  };
  root.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => {
    el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => tip.removeAttribute('data-on'));
    el.addEventListener('focus', () => {
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top);
    });
    el.addEventListener('blur', () => tip.removeAttribute('data-on'));
  });

  if (reduced) return;
  root.querySelectorAll<HTMLElement>('.panel').forEach((panel) => {
    const cols = panel.querySelectorAll('.col__stack');
    const bars = panel.querySelectorAll('.hbars__track i, .pairs__bars i');
    const tl = gsap.timeline({ paused: true });
    if (cols.length)
      tl.from(cols, { scaleY: 0, duration: 0.9, stagger: 0.035, ease: 'power3.out' });
    if (bars.length)
      tl.from(bars, { scaleX: 0, duration: 0.9, stagger: 0.06, ease: 'power3.out' }, 0);
    ScrollTrigger.create({
      trigger: panel,
      start: 'top 82%',
      once: true,
      onEnter: () => tl.play(),
    });
  });
}
