import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import type { Patient, WatchDaily, WatchSession } from '../../types';
import { EXERCISE_LABELS } from '../../types';
import { ChartCard, EXERCISE_SERIES, LegendItem, useChartTheme } from '../../ui';
import { shortDate, shortDateTime } from '../dates';
import { chartProps, dotsOf, fitDomain, MARGIN } from './chartProps';

const WATCH_EXERCISES = ['arm_raise', 'forward_reach'] as const;

/** Watch trends: resting HR, blood pressure, activity, weak-arm use, and watch exercise sessions. */
export function WatchCharts({ watch, watchSessions, patient }: { watch: WatchDaily[]; watchSessions: WatchSession[]; patient: Patient }) {
  const t = useChartTheme();
  const p = chartProps(t);
  const empty = watch.length === 0 ? 'No watch data yet.' : undefined;

  const rows = watch.map((w) => ({
    date: shortDate(w.date),
    restingHr: w.restingHr,
    bpSys: w.bpSys,
    bpDia: w.bpDia,
    steps: w.steps,
    exerciseMin: w.exerciseMin,
    weakArmActiveMin: w.weakArmActiveMin,
    useRatio: w.useRatio,
  }));

  // Oldest first so time runs left to right.
  const sessionRows = [...watchSessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => ({
      label: shortDateTime(s.startedAt),
      arm_raise: s.exercise === 'arm_raise' ? s.bestElevationDeg : null,
      forward_reach: s.exercise === 'forward_reach' ? s.bestElevationDeg : null,
      reps: s.reps,
    }));
  const exercisesPresent = WATCH_EXERCISES.filter((ex) => watchSessions.some((s) => s.exercise === ex));

  // Each axis fitted to this patient's own range.
  const ratioDomain = fitDomain(rows.map((r) => r.useRatio), { lo: 0, hi: 1, step: 0.05, minSpan: 0.2 });
  const elevationDomain = fitDomain(watchSessions.map((s) => s.bestElevationDeg), { lo: 0, hi: 180, step: 10, minSpan: 30, zero: true });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard
        title="Resting heart rate"
        subtitle="Daily, from the watch (bpm)"
        empty={empty}
        description="Daily resting heart rate"
        legend={<LegendItem color={t.info} label="Resting HR" />}
      >
        <LineChart data={rows} margin={MARGIN}>
          <CartesianGrid {...p.grid} />
          <XAxis dataKey="date" {...p.axis} />
          <YAxis domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} width={40} {...p.axis} />
          <Tooltip {...p.tooltip} formatter={(v) => `${v} bpm`} />
          <Line type="monotone" dataKey="restingHr" name="Resting HR" stroke={t.info} strokeWidth={3} dot={dotsOf(rows, 'restingHr')} connectNulls />
        </LineChart>
      </ChartCard>

      <ChartCard
        title="Blood pressure"
        subtitle={`Systolic and diastolic (mmHg); limit ${patient.bpLimitSys} systolic`}
        empty={empty}
        description="Daily systolic and diastolic blood pressure with the systolic limit line"
        legend={
          <>
            <LegendItem color={t.warning} label="Systolic" />
            <LegendItem color={t.primary} label="Diastolic" />
            <LegendItem color={t.target} dashed label={`Limit ${patient.bpLimitSys}`} />
          </>
        }
      >
        <LineChart data={rows} margin={MARGIN}>
          <CartesianGrid {...p.grid} />
          <XAxis dataKey="date" {...p.axis} />
          <YAxis
            allowDecimals={false}
            width={40}
            domain={[(min: number) => Math.floor((min - 10) / 10) * 10, (max: number) => Math.ceil((max + 5) / 10) * 10]}
            {...p.axis}
          />
          <Tooltip {...p.tooltip} formatter={(v) => `${v} mmHg`} />
          <ReferenceLine y={patient.bpLimitSys} stroke={t.target} strokeDasharray="6 4" strokeWidth={2} ifOverflow="extendDomain" />
          <Line type="monotone" dataKey="bpSys" name="Systolic" stroke={t.warning} strokeWidth={3} dot={dotsOf(rows, 'bpSys')} connectNulls />
          <Line type="monotone" dataKey="bpDia" name="Diastolic" stroke={t.primary} strokeWidth={3} dot={dotsOf(rows, 'bpDia')} connectNulls />
        </LineChart>
      </ChartCard>

      <ChartCard
        title="Activity"
        subtitle="Steps (left) and exercise minutes (right)"
        empty={empty}
        description="Daily steps and exercise minutes"
        legend={
          <>
            <LegendItem color={t.info} label="Steps" />
            <LegendItem color={t.warning} label="Exercise minutes" />
          </>
        }
      >
        <ComposedChart data={rows} margin={MARGIN}>
          <CartesianGrid {...p.grid} />
          <XAxis dataKey="date" {...p.axis} />
          <YAxis yAxisId="steps" allowDecimals={false} width={52} {...p.axis} />
          <YAxis yAxisId="min" orientation="right" allowDecimals={false} width={36} {...p.axis} />
          <Tooltip {...p.tooltip} />
          <Bar yAxisId="steps" dataKey="steps" name="Steps" fill={t.info} fillOpacity={0.55} radius={[3, 3, 0, 0]} />
          <Line yAxisId="min" type="monotone" dataKey="exerciseMin" name="Exercise min" stroke={t.warning} strokeWidth={3} dot={dotsOf(rows, 'exerciseMin')} connectNulls />
        </ComposedChart>
      </ChartCard>

      <ChartCard
        title="Weak-arm use"
        subtitle="Active minutes (left) and weak ÷ healthy use ratio (right)"
        empty={empty}
        description="Daily weak-arm active minutes and use ratio"
        legend={
          <>
            <LegendItem color={t.primary} label="Weak-arm active minutes" />
            <LegendItem color={t.info} dashed label="Use ratio" />
          </>
        }
      >
        <LineChart data={rows} margin={MARGIN}>
          <CartesianGrid {...p.grid} />
          <XAxis dataKey="date" {...p.axis} />
          <YAxis yAxisId="min" domain={[(m: number) => Math.max(0, Math.floor(m - 5)), (m: number) => Math.ceil(m + 5)]} allowDecimals={false} width={40} {...p.axis} />
          <YAxis yAxisId="ratio" orientation="right" domain={ratioDomain} width={40} allowDataOverflow {...p.axis} />
          <Tooltip {...p.tooltip} />
          <Line yAxisId="min" type="monotone" dataKey="weakArmActiveMin" name="Active min" stroke={t.primary} strokeWidth={3} dot={dotsOf(rows, 'weakArmActiveMin')} connectNulls />
          <Line
            yAxisId="ratio"
            type="monotone"
            dataKey="useRatio"
            name="Use ratio"
            stroke={t.info}
            strokeWidth={3}
            strokeDasharray="6 3"
            dot={dotsOf(rows, 'useRatio')}
            connectNulls
          />
        </LineChart>
      </ChartCard>

      <ChartCard
        className="lg:col-span-2"
        title="Watch exercise sessions"
        subtitle="Best arm elevation per session (degrees), recorded by the watch app"
        empty={sessionRows.length === 0 ? 'No watch exercise sessions yet.' : undefined}
        description="Best arm elevation per watch exercise session"
        legend={exercisesPresent.map((ex) => (
          <LegendItem key={ex} color={t.series[EXERCISE_SERIES[ex]]} label={EXERCISE_LABELS[ex]} />
        ))}
      >
        <BarChart data={sessionRows} margin={MARGIN}>
          <CartesianGrid {...p.grid} />
          <XAxis dataKey="label" {...p.axis} />
          <YAxis domain={elevationDomain} unit="°" width={44} allowDataOverflow {...p.axis} />
          <Tooltip {...p.tooltip} formatter={(v) => `${v}°`} />
          {exercisesPresent.map((ex) => (
            <Bar key={ex} dataKey={ex} name={EXERCISE_LABELS[ex]} fill={t.series[EXERCISE_SERIES[ex]]} radius={[3, 3, 0, 0]} maxBarSize={36} />
          ))}
        </BarChart>
      </ChartCard>
    </div>
  );
}
