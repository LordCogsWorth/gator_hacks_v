// Patient Home: the "new plan" banner, the hero "Today's session" card with Start, three stat tiles,
// the weak-arm tile and the progress chart. Start must stay above the fold on a 390×844 phone.
import { CalendarCheck, CalendarClock, CircleCheck, Flame, Play, TrendingUp } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TARGET_UNITS, type Plan } from '../../types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { StatTile } from '../../ui/StatTile';
import { daysUntil, firstName, streakDays, weekAgoSummary } from '../api';
import { ProgressChart } from '../components/ProgressChart';
import { CameraResults, WatchWorkouts } from '../components/WatchWorkouts';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';
import { useSession } from '../session/SessionContext';
import { speak, useSpeakOnMount } from '../voice/useVoice';

const WEEK_MS = 7 * 86_400_000;

const checkinText = (days: number) => (days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);
const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`;

export function Dashboard() {
  const navigate = useNavigate();
  const session = useSession();
  const { patient, plan, sessions, summaries, newPlan, dismissNewPlan } = usePatientData();
  const name = firstName(patient.name);

  const today = new Date().toDateString();
  // A session stopped for pain or dizziness doesn't count as done; a watch-only session (one arm) does.
  const doneToday = summaries.some(
    (s) => (s.average !== null || s.session.results.length > 0) && new Date(s.session.startedAt).toDateString() === today,
  );
  const thisWeek = sessions.filter((s) => Date.now() - new Date(s.startedAt).getTime() < WEEK_MS).length;
  const checkin = daysUntil(plan?.nextCheckin ?? patient.nextCheckin);
  const streak = streakDays(sessions);
  const scored = summaries.filter((s) => s.average !== null);
  const latest = scored[scored.length - 1];
  const weekAgo = weekAgoSummary(summaries);
  const delta = latest && weekAgo ? latest.average! - weekAgo.average! : null;

  useSpeakOnMount(
    !plan
      ? `Welcome back ${name}. Your care team hasn't set up your exercises yet.`
      : doneToday
        ? `Welcome back ${name}. You finished today's session. Well done.`
        : `Welcome back ${name}. Press Start today's session when you are ready.`,
  );
  // Queued after the welcome, and again whenever a newer plan arrives while the page is open.
  useEffect(() => {
    if (newPlan && plan) speak(`Your care team sent you a new plan. Phase ${plan.phase}.`, { interrupt: false });
  }, [newPlan, plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- once per plan

  const start = () => {
    if (!plan) return;
    if (newPlan) dismissNewPlan();
    session.begin(plan);
    navigate('/patient/checkin');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {newPlan && plan && (
        <Banner
          tone="success"
          title="New plan from your care team"
          action={
            <Button variant="secondary" onClick={dismissNewPlan}>
              OK
            </Button>
          }
        >
          {/* Phones skip the detail so Start stays above the fold; the voice and the chips carry it. */}
          <span className="hidden sm:inline">
            Phase {plan.phase}
            {plan.approvedBy ? `, approved by ${plan.approvedBy}` : ''}. Your new goals are in today's session.
          </span>
        </Banner>
      )}

      <TodayCard plan={plan} doneToday={doneToday} onStart={start} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={<CalendarClock />} label="Next check-in" value={checkinText(checkin)} />
        <StatTile icon={<Flame />} label="Streak" value={streak} unit={plural(streak, 'day')} />
        <StatTile
          icon={<CalendarCheck />}
          label="This week"
          value={plan ? `${thisWeek} / ${plan.sessionsPerWeek}` : thisWeek}
          unit={plural(plan ? plan.sessionsPerWeek : thisWeek, 'session')}
        />
      </div>

      <StatTile
        icon={<TrendingUp />}
        label="Weak arm vs healthy"
        value={latest ? latest.average : '—'}
        unit={latest ? '%' : undefined}
        delta={delta !== null ? { value: delta, goodWhen: 'up', label: 'from last week' } : undefined}
        hint={latest ? 'Your latest session, all exercises' : 'Do the same exercise with both arms to see this'}
      />

      <WatchWorkouts patientId={patient.id} />

      <CameraResults patientId={patient.id} />

      <ProgressChart />
    </div>
  );
}

/** The hero: today's exercises as chips and the big Start button. */
export function TodayCard({ plan, doneToday, onStart }: { plan: Plan | null; doneToday: boolean; onStart: () => void }) {
  if (!plan) {
    return (
      <Card tone="primary" title="Today's session">
        <p className="text-lg text-text-muted">
          Your care team hasn't set up your exercises yet. This page updates by itself when they do.
        </p>
      </Card>
    );
  }
  return (
    <Card
      tone="primary"
      title="Today's session"
      subtitle={
        <>
          Phase {plan.phase} · about 10–15 minutes<span className="hidden sm:inline"> · stronger arm first</span>
        </>
      }
    >
      <ul className="flex flex-wrap gap-2" aria-label="Today's exercises">
        {plan.exercises.map((ex) => (
          <li key={ex.exercise} className="rounded-control bg-primary-soft px-4 py-1.5 text-lg text-text">
            <span className="font-semibold">{EXERCISES[ex.exercise].title}</span>
            <span className="text-text-muted">
              {' '}
              · {ex.reps} reps · goal {ex.target}
              {TARGET_UNITS[ex.exercise]}
            </span>
          </li>
        ))}
      </ul>
      {doneToday && (
        <p className="mt-3 flex items-center gap-2 text-lg font-semibold text-success">
          <CircleCheck className="h-5 w-5" aria-hidden /> Today's session is done
        </p>
      )}
      <Button size="xl" fullWidth icon={<Play />} className="mt-4" onClick={onStart}>
        {doneToday ? 'Start another session' : "Start today's session"}
      </Button>
    </Card>
  );
}
