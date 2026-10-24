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
