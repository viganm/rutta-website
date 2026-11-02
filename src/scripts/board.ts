/**
 * Keeps a server-rendered Today board in step with the demo clock. Rows keep
 * their identity: on the full board a route that needs attention slides to
 * the top in place (FLIP), it doesn't vanish and reappear somewhere else.
 */
import { fill, type Copy } from '../i18n/index.ts';
import { boardAt, type BoardView } from './board-model.ts';

export interface BoardBinding {
  update(t: number): void;
  onFocus(cb: (slot: number | null) => void): void;
  setFocus(slot: number | null): void;
}

export function bindBoard(root: HTMLElement, c: Copy['board'], reduced: boolean): BoardBinding {
  const full = root.dataset.board === 'full';
  const list = root.querySelector<HTMLElement>('[data-rows]')!;
  const rows = new Map<number, HTMLElement>();
  list.querySelectorAll<HTMLElement>('.row').forEach((el) => rows.set(Number(el.dataset.slot), el));
  const icons = JSON.parse(root.querySelector('template[data-icons]')!.innerHTML) as Record<
    string,
    string
  >;
  const attention = root.querySelector<HTMLElement>('[data-attention]')!;
  const clear = root.querySelector<HTMLElement>('[data-clear]')!;
  const total = root.querySelector<HTMLElement>('[data-total]')!;
  const totalBar = root.querySelector<HTMLElement>('[data-total-bar]')!;
  const clockEl = root.querySelector<HTMLElement>('[data-clock]')!;
  const seen = new Set<string>(
    [...attention.children].map((li) => (li as HTMLElement).dataset.key!),
  );
  let last = '';
  let focusCb: (slot: number | null) => void = () => {};

  rows.forEach((el, slot) => {
    el.addEventListener('pointerenter', () => focusCb(slot));
    el.addEventListener('pointerleave', () => focusCb(null));
  });

  const set = (el: Element | null, text: string) => {
    if (el && el.textContent !== text) el.textContent = text;
  };

  function render(v: BoardView): void {
    set(clockEl, v.clock);
    set(total, fill(c.ofTotal, { done: v.done, total: v.total }));
    totalBar.style.setProperty('--p', (v.done / v.total).toFixed(3));
    for (const r of v.rows) {
      const el = rows.get(r.slot)!;
      el.dataset.tone = r.tone;
      set(el.querySelector('[data-count]'), `${r.done}/${r.total}`);
      el.querySelector<HTMLElement>('[data-bar]')!.style.setProperty('--p', r.ratio.toFixed(3));
      const pill = el.querySelector<HTMLElement>('[data-pill]')!;
      if (pill.dataset.tone !== r.tone) {
        pill.dataset.tone = r.tone;
        pill.querySelector('path')!.setAttribute('d', icons[r.tone]!);
      }
      set(el.querySelector('[data-status]'), r.status);
      set(el.querySelector('[data-next]'), r.next);
      const when = el.querySelector<HTMLElement>('[data-when]')!;
      set(when, r.when);
      when.toggleAttribute('data-late', r.late);
    }
    if (full) reorder(v);

    const items = v.attention.slice(0, full ? 4 : 2);
    const key = items.map((a) => a.key + a.text).join('|');
    if (key !== last) {
      last = key;
      attention.replaceChildren(
        ...items.map((a) => {
          const li = document.createElement('li');
          li.dataset.key = a.key;
          li.dataset.kind = a.kind;
          li.style.setProperty('--c', `var(--r${a.slot})`);
          li.textContent = a.text;
          if (!seen.has(a.key) && !reduced) li.classList.add('is-new');
          seen.add(a.key);
          return li;
        }),
      );
      clear.hidden = items.length > 0;
    }
  }

  function reorder(v: BoardView): void {
    const order = [...v.rows]
      .sort((a, b) => a.weight - b.weight || a.slot - b.slot)
      .map((r) => r.slot);
    const current = [...list.children].map((el) => Number((el as HTMLElement).dataset.slot));
    if (order.join() === current.join()) return;
    const before = new Map([...rows].map(([slot, el]) => [slot, el.getBoundingClientRect().top]));
    for (const slot of order) list.appendChild(rows.get(slot)!);
    if (reduced) return;
    rows.forEach((el, slot) => {
      const dy = before.get(slot)! - el.getBoundingClientRect().top;
      if (!dy) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: 520,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      });
    });
  }

  let lastMinute = -1;
  return {
    update(t) {
      const minute = Math.floor(t);
      if (minute === lastMinute) return;
      lastMinute = minute;
      render(boardAt(t, c));
    },
    onFocus(cb) {
      focusCb = cb;
    },
    setFocus(slot) {
      rows.forEach((el, s) => el.classList.toggle('is-focus', s === slot));
    },
  };
}
