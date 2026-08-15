/**
 * 主题 token —— 集中管理配色、圆角、间距、字号。
 * 沿用产品原型的绿色系；后续换肤只改这里。
 */

export const colors = {
  bg: '#F7F5EF',
  panel: '#FFFFFF',
  surfaceAlt: '#FBFAF7',
  ink: '#20262E',
  muted: '#66717F',
  line: '#E2E5E8',
  lineStrong: '#C9D0D7',
  indigo: '#101B4D',
  indigoSoft: '#E9ECF5',
  green: '#2F8F83',
  greenDark: '#236F67',
  greenPressed: '#1C5C55',
  mint: '#E5F3F0',
  blue: '#527FA3',
  blueSoft: '#E8F0F8',
  amber: '#E08A1E',
  red: '#F04438',
  dangerSurface: '#FFF0EE',
  warningSurface: '#FFF5E5',
  soft: '#F0F2F2',
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const fontSize = {
  tiny: 12,
  small: 13,
  body: 15,
  title: 18,
  header: 24,
} as const;

export const theme = { colors, radius, spacing, fontSize } as const;

export type Theme = typeof theme;
