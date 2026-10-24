/**
 * Chart colours from the design tokens, for Recharts (or any SVG/canvas). FROZEN after WP0.
 *
 *   const t = useChartTheme();
 *   <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
 *   <XAxis stroke={t.axis} tick={t.tick} />
 *   <Line stroke={t.series[0]} />                    // series[0..2] = arm raise, forward reach, hand open
 *   <ReferenceLine stroke={t.target} strokeDasharray="6 4" />
 *   <Tooltip contentStyle={t.tooltipStyle} labelStyle={t.tooltipLabelStyle} itemStyle={t.tooltipItemStyle} cursor={t.cursor} />
 *
 * Values are hex strings read from the CSS variables on <html>, re-read when data-theme changes.
 */
import { useMemo, type CSSProperties } from 'react';
import type { Exercise } from '../types';
import { useAppliedTheme, type Theme } from './theme';

export interface ChartTheme {
  theme: Theme;
  grid: string;
  axis: string;
  text: string;
  muted: string;
  surface: string;
  border: string;
  /** The 3 exercise colours: [arm_raise, forward_reach, hand_open]. */
  series: [string, string, string];
  /** Dashed target / limit lines. */
  target: string;
  primary: string;
  info: string;
  warning: string;
  danger: string;
  success: string;
  /** Recharts axis tick props: `<XAxis tick={t.tick} />`. */
  tick: { fill: string; fontSize: number };
  tooltipStyle: CSSProperties;
  tooltipLabelStyle: CSSProperties;
  tooltipItemStyle: CSSProperties;
  /** Recharts Tooltip cursor: `<Tooltip cursor={t.cursor} />`. */
  cursor: { stroke: string; strokeWidth: number };
}

/** Exercise → series index (matches --chart-1/2/3). */
export const EXERCISE_SERIES: Record<Exercise, 0 | 1 | 2> = { arm_raise: 0, forward_reach: 1, hand_open: 2 };

// Fallbacks (light theme) for non-browser environments (tests, SSR).
const FALLBACK: Record<string, string> = {
  'chart-grid': '#E2E8F0',
  'text-muted': '#475569',
  text: '#0F172A',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  'chart-1': '#0F766E',
  'chart-2': '#0369A1',
  'chart-3': '#B45309',
  'chart-target': '#B91C1C',
  primary: '#0F766E',
  info: '#0369A1',
  warning: '#B45309',
  danger: '#B91C1C',
  success: '#15803D',
};

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Read one token ("15 118 110") from <html> and return "#0f766e". */
export function readToken(name: string): string {
  if (typeof document === 'undefined') return FALLBACK[name] ?? '#000000';
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return FALLBACK[name] ?? '#000000';
  return `#${hex(parts[0])}${hex(parts[1])}${hex(parts[2])}`;
}

/** Build the chart theme from the tokens currently on <html>. */
export function readChartTheme(theme: Theme): ChartTheme {
  const t = (n: string) => readToken(n);
  const text = t('text');
  const muted = t('text-muted');
  const surface = t('surface');
  const border = t('border');
  return {
    theme,
    grid: t('chart-grid'),
    axis: muted,
    text,
    muted,
    surface,
    border,
    series: [t('chart-1'), t('chart-2'), t('chart-3')],
    target: t('chart-target'),
    primary: t('primary'),
    info: t('info'),
    warning: t('warning'),
    danger: t('danger'),
    success: t('success'),
    tick: { fill: muted, fontSize: 13 },
    tooltipStyle: {
      backgroundColor: surface,
      border: `1px solid ${border}`,
      borderRadius: 12,
      color: text,
      boxShadow: '0 4px 12px -2px rgba(0,0,0,0.18)',
      padding: '8px 12px',
    },
    tooltipLabelStyle: { color: text, fontWeight: 600, marginBottom: 4 },
    tooltipItemStyle: { color: text, padding: 0 },
    cursor: { stroke: muted, strokeWidth: 1 },
  };
}

/** Chart colours for the current theme; re-computed when the theme changes. */
export function useChartTheme(): ChartTheme {
  const theme = useAppliedTheme();
  return useMemo(() => readChartTheme(theme), [theme]);
}
