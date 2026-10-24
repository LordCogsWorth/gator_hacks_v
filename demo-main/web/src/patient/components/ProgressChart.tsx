// One point per session: how close the weak arm is to the healthy arm. Colours from the design tokens.
import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import type { Exercise } from '../../types';
import { Card } from '../../ui/Card';
import { useChartTheme } from '../../ui/chartTheme';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Delta } from '../../ui/StatTile';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';

type View = 'average' | Exercise;

interface Point {
  number: number;
  date: string;
  value: number;
}

export function ProgressChart() {
  const [view, setView] = useState<View>('average');
  const { summaries, plan } = usePatientData();
  const t = useChartTheme();
  const washId = `wash-${useId().replace(/:/g, '')}`;

  const points: Point[] = summaries.flatMap((s) => {
    const value = view === 'average' ? s.average : s.symmetry[view];
    return value == null
      ? []
      : [{ number: s.number, date: new Date(s.session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value }];
  });
  const first = points[0];
  const last = points[points.length - 1];
  const label = view === 'average' ? 'All exercises' : EXERCISES[view].title;
  const values = points.map((p) => p.value);
  const yMin = Math.max(0, Math.floor((Math.min(...values, 100) - 10) / 10) * 10);
  const yMax = Math.ceil(Math.max(...values, 100) / 10) * 10;
  const tick = { fill: t.muted, fontSize: 16 };

  const views: View[] = ['average', ...(plan ? plan.exercises.map((e) => e.exercise) : (Object.keys(EXERCISES) as Exercise[]))];

  return (
    <Card title="Your progress" subtitle="Weaker arm compared with stronger arm, each session">
      <SegmentedControl
        label="Choose exercise"
        value={view}
        onChange={setView}
        className="flex-wrap"
        options={views.map((v) => ({ value: v, label: v === 'average' ? 'All exercises' : EXERCISES[v].title }))}
      />
      {last ? (
        <div className="mt-4">
          <div className="text-lg text-text-muted">{label}</div>
          <div className="flex flex-wrap items-baseline gap-x-4">
            <span className="font-display text-5xl font-semibold tabular-nums">{last.value}%</span>
            <Delta value={last.value - first.value} goodWhen="up" unit=" points" label={`since session ${first.number}`} className="text-xl" />
          </div>

          <figure className="m-0 mt-4 h-72 w-full" aria-label={`${label}: ${last.value}% at the latest session`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                <defs>
                  <linearGradient id={washId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={t.primary} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={t.primary} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={t.grid} strokeWidth={1} vertical={false} />
                <XAxis dataKey="number" tick={tick} tickLine={false} axisLine={{ stroke: t.grid }} tickFormatter={(n) => `#${n}`} minTickGap={24} />
                <YAxis
                  domain={[yMin, yMax]}
                  ticks={Array.from({ length: (yMax - yMin) / 10 + 1 }, (_, i) => yMin + i * 10)}
                  tick={tick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  width={56}
                />
                <ReferenceLine
                  y={100}
                  stroke={t.muted}
                  strokeDasharray="6 6"
                  label={{ value: 'Same as stronger arm', fill: t.muted, fontSize: 15, position: 'insideTopLeft' }}
                />
                <Tooltip content={<PointTooltip />} cursor={t.cursor} />
                <Area
                  type="linear"
                  dataKey="value"
                  stroke={t.primary}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  fill={`url(#${washId})`}
                  dot={{ r: 4, fill: t.primary, stroke: t.surface, strokeWidth: 2 }}
                  activeDot={{ r: 8, fill: t.primary, stroke: t.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </figure>
          <p className="mt-1 text-base text-text-muted">Each dot is one session. Point at a dot to see that day.</p>
        </div>
      ) : (
        <p className="mt-4 text-xl text-text-muted">No finished sessions yet.</p>
      )}
    </Card>
  );
}

function PointTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  return (
    <div className="rounded-control border border-border bg-surface px-4 py-2 text-lg text-text shadow-raised">
      <div className="text-text-muted">
        Session {p.number} · {p.date}
      </div>
      <div className="text-2xl font-semibold">{p.value}%</div>
    </div>
  );
}
