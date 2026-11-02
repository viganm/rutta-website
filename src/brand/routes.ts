/**
 * Categorical route colours: the dataviz skill's validated default, kept in its
 * fixed order (never cycled). Validated on Hartë surfaces 2026-10-17:
 * light (#F1F4F0) worst adjacent CVD ΔE 9.1, normal-vision 19.6;
 * dark (#0E1A17) CVD 8.4, normal-vision 19.3, all >= 3:1.
 *
 * A map is an all-pairs form: only the first three slots stay distinct for any
 * pair, and four light slots are under 3:1 on map paper. So route colour is
 * never the only cue: lines get a `routeCasing` outline, every route carries a
 * labelled badge (R1…), and selecting a route dims the rest.
 */
export const routeColors = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

export const MAX_ROUTE_COLORS = 8;

/** Colour follows the route's stable slot, never its rank in a filtered list. */
export function routeColor(slot: number, mode: 'light' | 'dark'): string {
  const palette = routeColors[mode];
  return palette[((slot % MAX_ROUTE_COLORS) + MAX_ROUTE_COLORS) % MAX_ROUTE_COLORS]!;
}
