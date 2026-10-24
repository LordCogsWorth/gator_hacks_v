import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import type { Exercise, Patient, Session } from '../../types';
import { EXERCISE_LABELS } from '../../types';
import { ChartCard, EXERCISE_SERIES, LegendItem, useChartTheme } from '../../ui';
import { shortDate } from '../dates';
import { chartProps, MARGIN } from './chartProps';

const EXERCISES: Exercise[] = ['arm_raise', 'forward_reach', 'hand_open'];
const round = (v: number | null | undefined) => (v == null ? null : Math.round(v));

/** Camera progress: symmetry per exercise (with the phase target), compensation %, pain and tiredness. */
export function CameraCharts({ sessions, patient, phaseTarget }: { sessions: Session[]; patient: Patient; phaseTarget: number | null }) {
  const t = useChartTheme();
  const p = chartProps(t);
  const empty = sessions.length === 0 ? 'No camera sessions yet.' : undefined;

  const rows = sessions.map((s) => {
    const row: Record<string, string | number | null> = {
      date: shortDate(s.startedAt),
      compensation: round(s.compensation),
      pain: s.pain,
      tiredness: s.tiredness,
    };
    for (const ex of EXERCISES) row[ex] = round(s.symmetryByExercise?.[ex]);
    return row;
  });

  return (
    <div className="space-y-6">
      <ChartCard
        title="Symmetry by exercise"
        subtitle="Weak arm ÷ healthy arm × 100, per session"
        height={280}
        empty={empty}
        description="Symmetry percentage per exercise over time, with the phase target line"
        legend={
          <>
            {EXERCISES.map((ex) => (
              <LegendItem key={ex} color={t.series[EXERCISE_SERIES[ex]]} label={EXERCISE_LABELS[ex]} />
            ))}
            {phaseTarget != null && <LegendItem color={t.target} dashed label={`Phase ${patient.phase} target ${phaseTarget}%`} />}
          </>
        }
      >
        <LineChart data={rows} margin={MARGIN}>
          <CartesianGrid {...p.grid} />
          <XAxis dataKey="date" {...p.axis} />
          <YAxis domain={[0, 100]} unit="%" width={48} {...p.axis} />
          <Tooltip {...p.tooltip} formatter={(v) => `${v}%`} />
          {phaseTarget != null && <ReferenceLine y={phaseTarget} stroke={t.target} strokeDasharray="6 4" strokeWidth={2} />}
          {EXERCISES.map((ex) => (
            <Line
              key={ex}
              type="monotone"
              dataKey={ex}
              name={EXERCISE_LABELS[ex]}
              stroke={t.series[EXERCISE_SERIES[ex]]}
              strokeWidth={2.5}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Compensation"
          subtitle="% of weak-arm reps with trunk lean or shoulder hike"
          empty={empty}
          description="Compensation percentage per session"
          legend={<LegendItem color={t.warning} label="Compensation" />}
        >
          <LineChart data={rows} margin={MARGIN}>
            <CartesianGrid {...p.grid} />
            <XAxis dataKey="date" {...p.axis} />
            <YAxis domain={[0, 100]} unit="%" width={48} {...p.axis} />
            <Tooltip {...p.tooltip} formatter={(v) => `${v}%`} />
            <Line type="monotone" dataKey="compensation" name="Compensation" stroke={t.warning} strokeWidth={2.5} dot={false} connectNulls />
          </LineChart>
        </ChartCard>

        <ChartCard
          title="Pain and tiredness"
          subtitle="Before each session: pain 0–10 (left), tiredness 1–5 (right)"
          empty={empty}
          description="Pain and tiredness reported before each session"
          legend={
            <>
              <LegendItem color={t.danger} label="Pain (0–10)" />
              <LegendItem color={t.info} dashed label="Tiredness (1–5)" />
            </>
          }
        >
          <LineChart data={rows} margin={MARGIN}>
            <CartesianGrid {...p.grid} />
            <XAxis dataKey="date" {...p.axis} />
            <YAxis yAxisId="pain" domain={[0, 10]} allowDecimals={false} width={32} {...p.axis} />
            <YAxis yAxisId="tired" orientation="right" domain={[1, 5]} allowDecimals={false} width={32} {...p.axis} />
            <Tooltip {...p.tooltip} />
            <Line yAxisId="pain" type="monotone" dataKey="pain" name="Pain" stroke={t.danger} strokeWidth={2.5} dot={false} connectNulls />
            <Line
              yAxisId="tired"
              type="monotone"
              dataKey="tiredness"
              name="Tiredness"
              stroke={t.info}
              strokeWidth={2.5}
              strokeDasharray="6 3"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartCard>
      </div>
    </div>
  );
}
