/** The plan yards fill as the section arrives: vans pulling into their bays. */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function initPlans(root: HTMLElement, reduced: boolean): void {
  if (reduced) return;
  root.querySelectorAll<SVGElement>('[data-yard]').forEach((yard, i) => {
    const vans = yard.querySelectorAll('rect');
    const tween = gsap.from(vans, {
      opacity: 0,
      x: -6,
      duration: 0.5,
      ease: 'power3.out',
      stagger: { amount: Math.min(0.9, vans.length * 0.06) },
      delay: i * 0.08,
      paused: true,
    });
    ScrollTrigger.create({
      trigger: yard,
      start: 'top 88%',
      once: true,
      onEnter: () => tween.play(),
    });
  });
}
