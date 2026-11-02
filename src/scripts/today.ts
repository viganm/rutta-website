/**
 * The Today section's board runs on its own clock, a little later in the
 * morning than the hero, and only while it's on screen.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Copy } from '../i18n/index.ts';
import { bindBoard } from './board.ts';
import { clockAt } from './sim.ts';

export function initToday(root: HTMLElement, t: Copy, reduced: boolean): void {
  const board = bindBoard(root.querySelector('[data-board]')!, t.board, reduced);
  let seconds = 0;
  let visible = false;
  let last = performance.now();
  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      visible = self.isActive;
      last = performance.now();
    },
  });
  gsap.ticker.add(() => {
    const now = performance.now();
    if (visible && !reduced) seconds += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (visible) board.update(clockAt(seconds));
  });
}
