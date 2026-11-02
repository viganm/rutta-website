import { colors, statusNames, type ColorTheme } from '../brand/color.ts';
import { routeColors } from '../brand/routes.ts';

/**
 * The page has two worlds side by side rather than a theme switch: the
 * dispatch wall screen (`.night`, Hartë dark) and the street (`.paper`, Hartë
 * light). Both read the same semantic variables, generated here from the
 * Hartë tokens in src/brand/, copied from the Rutta apps so the two match.
 */
function region(selector: string, t: ColorTheme, routes: readonly string[]): string {
  const vars: Record<string, string> = {
    bg: t.background,
    surface: t.surface,
    raised: t.surfaceRaised,
    sunken: t.surfaceSunken,
    text: t.text,
    'text-2': t.textSecondary,
    'text-3': t.textMuted,
    line: t.border,
    'line-strong': t.borderStrong,
    primary: t.primary,
    'primary-hover': t.primaryHover,
    'on-primary': t.onPrimary,
    'primary-subtle': t.primarySubtle,
    'on-primary-subtle': t.onPrimarySubtle,
    focus: t.focus,
    casing: t.routeCasing,
  };
  for (const name of statusNames) {
    const s = t.status[name];
    vars[`st-${name}`] = s.solid;
    vars[`st-${name}-on`] = s.onSolid;
    vars[`st-${name}-subtle`] = s.subtle;
    vars[`st-${name}-on-subtle`] = s.onSubtle;
  }
  routes.forEach((c, i) => (vars[`r${i}`] = c));
  const body = Object.entries(vars)
    .map(([k, v]) => `--${k}:${v}`)
    .join(';');
  return `${selector}{${body}}`;
}

export const tokenCss = [
  region(':root,.paper', colors.light, routeColors.light),
  region('.night', colors.dark, routeColors.dark),
].join('\n');

/** Map palettes for the canvas renderer, from the same tokens. */
export const mapPalette = {
  night: { routes: [...routeColors.dark], ...colors.dark },
  paper: { routes: [...routeColors.light], ...colors.light },
};
