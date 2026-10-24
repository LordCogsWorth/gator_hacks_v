import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import type { Exercise, ReplayFile } from '../../types';
import { ChartCard, LegendItem } from '../../ui/ChartCard';
import { EXERCISE_SERIES, useChartTheme } from '../../ui/chartTheme';
import { warningRuns, type AngleRow } from './replayMath';

export interface AngleChartProps {
  exercise: Exercise;
  /** Label of the exercise angle, e.g. "Arm raise (hip–shoulder–elbow)". Null when there is none. */
  angleLabel: string | null;
  rows: AngleRow[];
  /** "Both": the healthy side's exercise angle, dashed. */
  ghostRows?: AngleRow[] | null;
  frameCount: number;
  fps: number;
  frame: number;
  warnings: ReplayFile['warnings'];
  onSeek: (frame: number) => void;
}

interface ChartRow {
  t: number;
  angle: number | null;
  lean: number | null;
  ghost: number | null;
}

export function AngleChart({ exercise, angleLabel, rows, ghostRows, frameCount, fps, frame, warnings, onSeek }: AngleChartProps) {
  const t = useChartTheme();
  const angleColor = t.series[EXERCISE_SERIES[exercise]];
  const data = useMemo<ChartRow[]>(
    () =>
      Array.from({ length: frameCount }, (_, i) => ({
        t: Math.round((i / fps) * 100) / 100,
        angle: rows[i]?.angle ?? null,
        lean: rows[i]?.lean ?? null,
        ghost: ghostRows?.[i]?.angle ?? null,
      })),
    [rows, ghostRows, frameCount, fps],
  );
  const runs = useMemo(() => warningRuns(warnings), [warnings]);
  const maxT = Math.max(0, frameCount - 1) / fps;
  const half = 0.5 / fps;

  return (
    <ChartCard
      title="Angles over time"
      subtitle={angleLabel ? 'Degrees. Click the chart to jump to that moment.' : 'Degrees, trunk lean only. Click the chart to jump to that moment.'}
      height={260}
      description={`${angleLabel ?? 'Trunk lean'} over ${maxT.toFixed(1)} seconds; red bands mark compensation warnings.`}
      legend={
        <>
          {angleLabel && <LegendItem color={angleColor} label={angleLabel} />}
          {angleLabel && ghostRows && <LegendItem color={t.info} label="Healthy side" dashed />}
          <LegendItem color={t.warning} label="Trunk lean" />
          {runs.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-5 rounded-sm bg-danger/25 ring-1 ring-inset ring-danger" aria-hidden />
              <span className="text-text">Warning</span>
            </span>
          )}
        </>
      }
    >
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
        onClick={(s) => {
          if (s && typeof s.activeTooltipIndex === 'number') onSeek(s.activeTooltipIndex);
        }}
        style={{ cursor: 'pointer' }}
      >
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          type="number"
          domain={[0, maxT]}
          stroke={t.axis}
          tick={t.tick}
          tickFormatter={(v: number) => `${Math.round(v)} s`}
          allowDecimals={false}
        />
        <YAxis stroke={t.axis} tick={t.tick} width={44} domain={[0, (max: number) => Math.max(30, Math.ceil((max + 5) / 10) * 10)]} unit="°" />
        {runs.map((r) => (
          <ReferenceArea key={r.start} x1={r.start / fps - half} x2={r.end / fps + half} fill={t.danger} fillOpacity={0.18} stroke="none" ifOverflow="hidden" />
        ))}
        <Tooltip
          contentStyle={t.tooltipStyle}
          labelStyle={t.tooltipLabelStyle}
          itemStyle={t.tooltipItemStyle}
          cursor={t.cursor}
          labelFormatter={(v: number) => `${Number(v).toFixed(1)} s`}
          formatter={(v: number) => `${Math.round(v)}°`}
        />
        {angleLabel && <Line type="monotone" dataKey="angle" name={angleLabel} stroke={angleColor} strokeWidth={2.5} dot={false} isAnimationActive={false} />}
        {angleLabel && ghostRows && (
          <Line type="monotone" dataKey="ghost" name="Healthy side" stroke={t.info} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        )}
        <Line type="monotone" dataKey="lean" name="Trunk lean" stroke={t.warning} strokeWidth={2} dot={false} isAnimationActive={false} />
        <ReferenceLine x={frame / fps} stroke={t.text} strokeWidth={2} ifOverflow="extendDomain" />
      </LineChart>
    </ChartCard>
  );
}
