// Stock-style chart: one point per session showing how close the weak arm is to the healthy arm.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { getCurrentPlan, getSessionSummaries } from '../api';
import { BigButton } from '../components/Layout';
import { EXERCISES } from '../data/exercises';
import type { ExerciseId } from '../types';
import { useSpeakOnMount } from '../voice/useVoice';

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

export function Progress() {
  const navigate = useNavigate();
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
  const yMin = Math.max(0, Math.floor((Math.min(...points.map((p) => p.value), 100) - 10) / 10) * 10);

  useSpeakOnMount(
    first && last
      ? `Your progress. Your weaker arm went from ${first.value} percent to ${last.value} percent of your stronger arm.`
      : 'Your progress. Finish a session to start your chart.',
  );

  const views: View[] = ['average', ...getCurrentPlan().exercises.map((e) => e.name)];

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-extrabold">My progress</h1>

      <div className="flex flex-wrap gap-3" role="group" aria-label="Choose exercise">
        {views.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`min-h-[60px] rounded-2xl border-2 px-5 text-xl font-bold ${
              view === v ? 'border-neutral-100 bg-neutral-100 text-neutral-950' : 'border-neutral-600 text-neutral-50'
            }`}
          >
            {v === 'average' ? 'All exercises' : EXERCISES[v].title}
          </button>
        ))}
      </div>

      {last ? (
        <section className="rounded-3xl border-2 border-neutral-800 bg-neutral-900 p-5">
          {/* Ticker-style headline: where you are now and how far you've come. */}
          <div className="text-xl text-neutral-300">{label} · weaker arm vs stronger arm</div>
          <div className="flex flex-wrap items-baseline gap-x-5">
            <span className="text-7xl font-extrabold">{last.value}%</span>
            <span className="text-2xl font-bold" style={{ color: up ? GOOD : BAD }}>
              {up ? '▲' : '▼'} {up ? '+' : ''}
              {change} points
            </span>
            <span className="text-xl text-neutral-300">since session {first.number}</span>
          </div>

          <div className="mt-4 h-80 w-full sm:h-96">
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
                  domain={[yMin, 100]}
                  ticks={Array.from({ length: (100 - yMin) / 10 + 1 }, (_, i) => yMin + i * 10)}
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
          <p className="mt-2 text-lg text-neutral-400">Each dot is one session. Touch a dot to see that day.</p>
        </section>
      ) : (
        <p className="text-2xl text-neutral-300">No finished sessions yet.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <BigButton variant="secondary" onClick={() => navigate('/patient/history')}>
          📋 Past sessions
        </BigButton>
        <BigButton onClick={() => navigate('/patient')}>Back to home</BigButton>
      </div>
    </div>
  );
}

function PointTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  return (
    <div className="rounded-xl border-2 border-neutral-600 bg-neutral-950 px-4 py-2 text-lg">
      <div className="text-neutral-300">
        Session {p.number} · {p.date}
      </div>
      <div className="text-2xl font-extrabold">{p.value}%</div>
    </div>
  );
}
