// Stock-style chart: one point per session showing how close the weak arm is to the healthy arm.
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { getCurrentPlan, getSessionSummaries } from '../api';
import { Card } from './Layout';
import { EXERCISES } from '../data/exercises';
import type { ExerciseId } from '../types';

type View = 'average' | ExerciseId;

// Chart tokens for the dark surface (dataviz guide: hairline recessive grid, 2px line, ~10% area wash).
const INK = '#f0efec';
const INK_2 = '#c3c2b7';
const GRID = '#383835';
const SURFACE = '#171717';
const GOOD = '#0ca30c';
const BAD = '#e66767';

interface Point {
  number: number;
  date: string;
  value: number;
}

/** Dashboard panel: the weak arm's % of the healthy arm, one point per session. */
export function ProgressChart() {
  const [view, setView] = useState<View>('average');
  const summaries = getSessionSummaries();

  const points: Point[] = summaries.flatMap((s) => {
    const value = view === 'average' ? s.average : s.symmetry[view];
    return value == null
      ? []
      : [{ number: s.number, date: new Date(s.session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value }];
  });
  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? last.value - first.value : 0;
  const up = change >= 0;
  const label = view === 'average' ? 'All exercises' : EXERCISES[view].title;
  const values = points.map((p) => p.value);
  const yMin = Math.max(0, Math.floor((Math.min(...values, 100) - 10) / 10) * 10);
  const yMax = Math.ceil(Math.max(...values, 100) / 10) * 10;

  const views: View[] = ['average', ...getCurrentPlan().exercises.map((e) => e.name)];

  return (
    <Card
      title="Your progress"
      action={
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose exercise">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`min-h-[48px] rounded-xl border px-4 text-base font-medium ${
                view === v ? 'border-neutral-100 bg-neutral-100 text-neutral-950' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {v === 'average' ? 'All exercises' : EXERCISES[v].title}
            </button>
          ))}
        </div>
      }
    >
      {last ? (
        <div>
          {/* Ticker-style headline: where you are now and how far you've come. */}
          <div className="text-lg text-neutral-400">{label} · weaker arm compared with stronger arm</div>
          <div className="flex flex-wrap items-baseline gap-x-4">
            <span className="text-5xl font-semibold">{last.value}%</span>
            <span className="text-xl font-semibold" style={{ color: up ? GOOD : BAD }}>
              {up ? '▲' : '▼'} {up ? '+' : ''}
              {change} points
            </span>
            <span className="text-xl text-neutral-300">since session {first.number}</span>
          </div>

          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
                <defs>
                  <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={INK} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={INK} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="number"
                  tick={{ fill: INK_2, fontSize: 16 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID }}
                  tickFormatter={(n) => `#${n}`}
                  minTickGap={24}
                />
                <YAxis
                  domain={[yMin, yMax]}
                  ticks={Array.from({ length: (yMax - yMin) / 10 + 1 }, (_, i) => yMin + i * 10)}
                  tick={{ fill: INK_2, fontSize: 16 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  width={56}
                />
                <ReferenceLine
                  y={100}
                  stroke={INK_2}
                  strokeDasharray="6 6"
                  label={{ value: 'Same as stronger arm', fill: INK_2, fontSize: 15, position: 'insideTopLeft' }}
                />
                <Tooltip content={<PointTooltip />} cursor={{ stroke: INK_2, strokeWidth: 1 }} />
                <Area
                  type="linear"
                  dataKey="value"
                  stroke={INK}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  fill="url(#wash)"
                  dot={{ r: 4, fill: INK, stroke: SURFACE, strokeWidth: 2 }}
                  activeDot={{ r: 8, fill: INK, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-base text-neutral-400">Each dot is one session. Point at a dot to see that day.</p>
        </div>
      ) : (
        <p className="text-xl text-neutral-300">No finished sessions yet.</p>
      )}
    </Card>
  );
}

function PointTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  return (
    <div className="rounded-xl border border-neutral-600 bg-neutral-950 px-4 py-2 text-lg">
      <div className="text-neutral-300">
        Session {p.number} · {p.date}
      </div>
      <div className="text-2xl font-semibold">{p.value}%</div>
    </div>
  );
}
