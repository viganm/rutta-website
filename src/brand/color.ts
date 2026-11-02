/**
 * Hartë colour tokens, copied from the Rutta apps (decided 2026-10-17).
 * Semantic roles only: components never reference a hex directly.
 */
export const themeNames = ['light', 'dark', 'highContrast'] as const;
export type ThemeName = (typeof themeNames)[number];

export const statusNames = ['pending', 'arrived', 'delivered', 'failed', 'warning'] as const;
export type StatusName = (typeof statusNames)[number];

export type StatusColors = {
  /** Marker / badge fill, paired with an icon. */
  solid: string;
  /** Text or icon on top of `solid`. */
  onSolid: string;
  /** Tinted pill background. */
  subtle: string;
  /** Text on `subtle`. */
  onSubtle: string;
};

export type ColorTheme = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  primarySubtle: string;
  onPrimarySubtle: string;
  focus: string;
  /** Outline under route lines so low-contrast route colours keep an edge on light maps. */
  routeCasing: string;
  status: Record<StatusName, StatusColors>;
};

/** Named Hartë primitives, for documentation and the token preview. */
export const brand = {
  slate: '#1B2622',
  deepSlate: '#121A17',
  pine: '#0F5C4A',
  mapPaper: '#F1F4F0',
  contour: '#56635D',
  night: '#0E1A17',
  mint: '#7FD8B8',
} as const;

const light: ColorTheme = {
  background: brand.mapPaper,
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#EAF0EB',
  // Deep slate rather than slate: >= 15:1 on every light surface (sunlight rule).
  text: brand.deepSlate,
  textSecondary: '#3F4B45',
  textMuted: '#56635D',
  border: '#D3DCD5',
  borderStrong: '#77857E',
  primary: brand.pine,
  primaryHover: '#0B4A3B',
  onPrimary: '#FFFFFF',
  primarySubtle: '#DCEBE3',
  onPrimarySubtle: '#0B4A3B',
  focus: '#1864AB',
  routeCasing: '#121A17',
  status: {
    pending: { solid: '#56635D', onSolid: '#FFFFFF', subtle: '#EAF0EB', onSubtle: '#3F4B45' },
    arrived: { solid: '#1864AB', onSolid: '#FFFFFF', subtle: '#DDEAF7', onSubtle: '#124F88' },
    delivered: { solid: brand.pine, onSolid: '#FFFFFF', subtle: '#DCEBE3', onSubtle: '#0B4A3B' },
    failed: { solid: '#B42318', onSolid: '#FFFFFF', subtle: '#FBE4E1', onSubtle: '#8F1C13' },
    warning: { solid: '#8A5300', onSolid: '#FFFFFF', subtle: '#FDF0D5', onSubtle: '#6B4100' },
  },
};

const dark: ColorTheme = {
  background: brand.night,
  surface: '#15231F',
  surfaceRaised: '#1B2B26',
  surfaceSunken: '#0A1411',
  text: '#E7EFEA',
  textSecondary: '#B8C8BF',
  textMuted: '#97AAA0',
  border: '#263731',
  borderStrong: '#66796F',
  primary: brand.mint,
  primaryHover: '#9BE3C8',
  onPrimary: brand.night,
  primarySubtle: '#17352C',
  onPrimarySubtle: '#A6E8CF',
  focus: '#74B4F0',
  routeCasing: '#0A1411',
  status: {
    pending: { solid: '#97AAA0', onSolid: brand.night, subtle: '#1F302A', onSubtle: '#C9D6CF' },
    arrived: { solid: '#74B4F0', onSolid: brand.night, subtle: '#142B40', onSubtle: '#A9D1F7' },
    delivered: { solid: brand.mint, onSolid: brand.night, subtle: '#17352C', onSubtle: '#A6E8CF' },
    failed: { solid: '#FF8A7A', onSolid: brand.night, subtle: '#3A1915', onSubtle: '#FFB8AE' },
    warning: { solid: '#F2BE62', onSolid: brand.night, subtle: '#36280E', onSubtle: '#F7D696' },
  },
};

/** Light high-contrast: the driver app's sunlight mode and the OS "increase contrast" setting. */
const highContrast: ColorTheme = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#F2F5F3',
  text: '#050807',
  textSecondary: '#1B2622',
  textMuted: '#2F3B35',
  border: '#56635D',
  borderStrong: '#121A17',
  primary: '#0A4436',
  primaryHover: '#073328',
  onPrimary: '#FFFFFF',
  primarySubtle: '#DCEBE3',
  onPrimarySubtle: '#073328',
  focus: '#0B3F73',
  routeCasing: '#050807',
  status: {
    pending: { solid: '#2F3B35', onSolid: '#FFFFFF', subtle: '#F2F5F3', onSubtle: '#1B2622' },
    arrived: { solid: '#0B4A87', onSolid: '#FFFFFF', subtle: '#DDEAF7', onSubtle: '#0B3F73' },
    delivered: { solid: '#0A4436', onSolid: '#FFFFFF', subtle: '#DCEBE3', onSubtle: '#073328' },
    failed: { solid: '#8F1C13', onSolid: '#FFFFFF', subtle: '#FBE4E1', onSubtle: '#6E140D' },
    warning: { solid: '#6B4100', onSolid: '#FFFFFF', subtle: '#FDF0D5', onSubtle: '#4F3000' },
  },
};

export const colors: Record<ThemeName, ColorTheme> = { light, dark, highContrast };
