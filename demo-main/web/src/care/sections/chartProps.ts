import type { ChartTheme } from '../../ui';

/** Recharts props shared by every care chart, from the theme tokens. */
export function chartProps(t: ChartTheme) {
  return {
    grid: { stroke: t.grid, strokeDasharray: '3 3', vertical: false },
    axis: { stroke: t.grid, tick: t.tick, tickLine: false },
    tooltip: {
      contentStyle: t.tooltipStyle,
      labelStyle: t.tooltipLabelStyle,
      itemStyle: t.tooltipItemStyle,
      cursor: t.cursor,
    },
  };
}

export const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

/**
 * Y-axis range fitted to this patient's numbers (and any reference line passed in), so small changes are
 * visible instead of a flat line on a fixed 0–100 scale. Padded by 15%, rounded out to `step`, at least
 * `minSpan` wide, and kept inside [lo, hi]. `zero` keeps the bottom at `lo` (for bars).
 */
export function fitDomain(
  values: (number | null | undefined)[],
  { lo, hi, step, minSpan, zero = false }: { lo: number; hi: number; step: number; minSpan: number; zero?: boolean },
): [number, number] {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length) return [lo, hi];
  let min = Math.min(...xs);
  let max = Math.max(...xs);
  const grow = Math.max(0, minSpan - (max - min)) / 2;
  min -= grow;
  max += grow;
  const pad = (max - min) * 0.15;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  let a = zero ? lo : Math.max(lo, round(Math.floor((min - pad) / step) * step));
  let b = Math.min(hi, round(Math.ceil((max + pad) / step) * step));
  // Pushed against a limit: keep the span by moving the other end.
  if (b - a < minSpan) {
    if (a === lo) b = Math.min(hi, a + minSpan);
    else a = Math.max(lo, b - minSpan);
  }
  return [a, b];
}

/** Dots on the line when there are few enough points to see them. */
export const dotsFor = (n: number) => (n <= 40 ? { r: 3, strokeWidth: 0 } : false);

/**
 * Dots for one series, by how many real values it has (not how many rows the chart has): a sparse series,
 * e.g. a few blood-pressure readings across two months, has no neighbours to draw a line to, so without
 * dots it only shows on hover.
 */
export function dotsOf<T extends object>(rows: T[], key: keyof T) {
  return dotsFor(rows.filter((r) => r[key] != null).length);
}
