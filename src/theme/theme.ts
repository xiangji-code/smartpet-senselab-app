/**
 * 主题 token —— 集中管理配色、圆角、间距、字号。
 * 沿用产品原型的绿色系；后续换肤只改这里。
 */

export const colors = {
  bg: '#f4f7f5',
  panel: '#ffffff',
  surfaceAlt: '#f8fbf9',
  ink: '#16231f',
  muted: '#607169',
  line: '#dbe6e1',
  lineStrong: '#c7d8d0',
  green: '#2f9b74',
  greenDark: '#1f7658',
  greenPressed: '#196248',
  mint: '#e4f5ee',
  blue: '#3478f6',
  amber: '#f2a93b',
  red: '#e6655a',
  dangerSurface: '#fff3f1',
  warningSurface: '#fff8e8',
  soft: '#eef5f2',
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
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
  title: 20,
  header: 28,
} as const;

export const theme = { colors, radius, spacing, fontSize } as const;

export type Theme = typeof theme;
