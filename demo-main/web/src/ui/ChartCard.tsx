import type { ReactElement, ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { Card } from './Card';

export interface ChartCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Chart height in px (default 240). */
  height?: number;
  /** Header right side (toggle, badge). */
  action?: ReactNode;
  /** Custom legend row under the chart (prefer this over Recharts' <Legend/> for readable text). */
  legend?: ReactNode;
  footer?: ReactNode;
  /** When set, shown instead of the chart (e.g. "No sessions yet"). */
  empty?: ReactNode;
  /**
   * One Recharts chart element (<LineChart>, <ComposedChart> …) — it is wrapped in a
   * ResponsiveContainer. Pass `responsive={false}` to render any other content at `height`.
   */
  children: ReactElement;
  responsive?: boolean;
  /** Screen-reader summary of what the chart shows. */
  description?: string;
  className?: string;
}

/**
 * A card holding one chart. Colours come from useChartTheme().
 *
 *   const t = useChartTheme();
 *   <ChartCard title="Symmetry" subtitle="Weak ÷ healthy, %" height={260}>
 *     <LineChart data={rows}>…<Line stroke={t.series[0]} /></LineChart>
 *   </ChartCard>
 */
export function ChartCard({ title, subtitle, height = 240, action, legend, footer, empty, children, responsive = true, description, className }: ChartCardProps) {
  return (
    <Card title={title} subtitle={subtitle} action={action} footer={footer} className={className}>
      {empty ? (
        <div className="flex items-center justify-center rounded-control bg-surface-2 px-4 text-center text-base text-text-muted" style={{ height }}>
          {empty}
        </div>
      ) : (
        <figure className="m-0" aria-label={description}>
          <div style={{ height }} className="w-full">
            {responsive ? (
              <ResponsiveContainer width="100%" height="100%">
                {children}
              </ResponsiveContainer>
            ) : (
              children
            )}
          </div>
          {legend && <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-text-muted">{legend}</figcaption>}
        </figure>
      )}
    </Card>
  );
}

/** One legend entry: a coloured swatch (line or dashed) + label. */
export function LegendItem({ color, label, dashed = false }: { color: string; label: ReactNode; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="20" height="8" aria-hidden>
        <line x1="1" y1="4" x2="19" y2="4" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      <span className="text-text">{label}</span>
    </span>
  );
}
