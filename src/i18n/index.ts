import { en, type Copy } from './en.ts';
import { sq } from './sq.ts';

export const langs = ['sq', 'en'] as const;
export type Lang = (typeof langs)[number];

export const copy: Record<Lang, Copy> = { sq, en };

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

/** Page path for a language: Albanian lives at the base, English at `en/`. */
export const homePath = (lang: Lang) => (lang === 'sq' ? base : `${base}en/`);

/** `{name}` placeholders, filled from `values`. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

export type { Copy };
