import { CalendarCheck, CalendarClock, ChevronRight, Flame, MessageSquare, Play, TrendingUp, Volume2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TARGET_UNITS, type Exercise } from '../../types';
import { daysUntil, firstName, streakDays, weekAgoSummary } from '../api';
import { Avatar, StepList } from '../components/ExerciseAvatar';
import { BigButton, Card, Initials } from '../components/Layout';
import { ProgressChart } from '../components/ProgressChart';
import { EXERCISES } from '../data/exercises';
import { getLinks, getPhysician, useDataChanges } from '../localDemo';
import { usePatientData } from '../PatientData';
import { useSession } from '../session/SessionContext';
import { speakLines, useSpeakOnMount } from '../voice/useVoice';

const WEEK_MS = 7 * 86_400_000;
const ALL_EXERCISES = Object.keys(EXERCISES) as Exercise[];

export function Dashboard() {
  const navigate = useNavigate();
  const session = useSession();
  const { patient, plan, sessions, summaries, newPlan, dismissNewPlan } = usePatientData();
  const name = firstName(patient.name);

  const today = new Date().toDateString();
  // A session stopped for pain or dizziness doesn't count as done.
  const doneToday = summaries.some((s) => s.average !== null && new Date(s.session.startedAt).toDateString() === today);
  const thisWeek = sessions.filter((s) => Date.now() - new Date(s.startedAt).getTime() < WEEK_MS).length;
  const checkin = daysUntil(plan?.nextCheckin ?? patient.nextCheckin);
  const scored = summaries.filter((s) => s.average !== null);
  const latest = scored[scored.length - 1];
  const weekAgo = weekAgoSummary(summaries);
  const delta = latest && weekAgo ? latest.average! - weekAgo.average! : null;

  useSpeakOnMount(
    !plan
      ? `Welcome back ${name}. Your care team hasn't set up your exercises yet.`
      : doneToday
        ? `Welcome back ${name}. You finished today's session.`
        : `Welcome back ${name}. Press Start session when you are ready.`,
  );

  const start = () => {
    if (!plan) return;
    session.begin(plan);
    navigate('/patient/checkin');
  };

  return (
    <div className="space-y-6">
      {newPlan && plan && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-500 bg-neutral-800 p-5 text-xl">
          <span>
            <b>New plan from your care team.</b> Phase {plan.phase}
            {plan.approvedBy ? `, approved by ${plan.approvedBy}` : ''}. Your new goals are below.
          </span>
          <button onClick={dismissNewPlan} className="min-h-[52px] rounded-xl bg-neutral-100 px-6 font-semibold text-neutral-950">
            OK
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Flame} label="Days in a row" value={String(streakDays(sessions))} />
        <Stat
          icon={CalendarCheck}
          label={plan ? `Sessions this week · goal ${plan.sessionsPerWeek}` : 'Sessions this week'}
          value={String(thisWeek)}
        />
        <Stat
          icon={TrendingUp}
          label="Weaker arm vs stronger arm"
          value={latest ? `${latest.average}%` : '—'}
          note={delta !== null ? `${delta >= 0 ? '▲ +' : '▼ '}${delta} since last week` : undefined}
          good={delta !== null ? delta >= 0 : undefined}
        />
        <Stat icon={CalendarClock} label="Next check-in" value={checkin <= 0 ? 'Today' : checkin === 1 ? 'Tomorrow' : `In ${checkin} days`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <CoachCard exercises={plan ? plan.exercises.map((e) => e.exercise) : ALL_EXERCISES} />

        <div className="space-y-6">
          <Card title="Today's session">
            {plan ? (
              <>
                <ul className="space-y-2">
                  {plan.exercises.map((ex, i) => (
                    <li key={ex.exercise} className="flex flex-wrap items-center gap-3 rounded-xl bg-neutral-800 px-4 py-3 text-lg">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-600 text-base font-semibold">{i + 1}</span>
                      <span className="font-medium">{EXERCISES[ex.exercise].title}</span>
                      <span className="ml-auto text-neutral-400">
                        {ex.reps}× · goal {ex.target}
                        {TARGET_UNITS[ex.exercise]}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-base text-neutral-400">Phase {plan.phase} · about 10–15 minutes · stronger arm first, then weaker arm</p>
                <BigButton className="mt-4 w-full" onClick={start}>
                  <Play className="h-5 w-5" /> {doneToday ? 'Start another session' : 'Start session'}
                </BigButton>
                {doneToday && <p className="mt-2 text-center text-base text-green-400">✓ Today's session is done</p>}
              </>
            ) : (
              <p className="text-lg text-neutral-300">
                No plan yet. Your care team hasn't set up your exercises. This page updates by itself when they do.
              </p>
            )}
          </Card>

          <CareTeamCard />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProgressChart />
        </div>
        <Card
          title="Recent sessions"
          action={
            <Link to="/patient/sessions" className="flex min-h-[44px] items-center gap-1 text-base font-medium text-neutral-300 hover:text-white">
              View all <ChevronRight className="h-4 w-4" />
            </Link>
          }
        >
          <ul className="divide-y divide-neutral-800">
            {[...summaries]
              .reverse()
              .slice(0, 5)
              .map((s) => (
                <li key={s.session.id} className="flex items-center justify-between py-3 text-lg">
                  <div>
                    <div className="font-medium">
                      {new Date(s.session.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-base text-neutral-400">Session {s.number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-semibold">{s.average !== null ? `${s.average}%` : 'Stopped'}</div>
                    <div className="text-sm text-neutral-400">{s.average !== null ? 'weaker arm' : 'early'}</div>
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, note, good }: { icon: LucideIcon; label: string; value: string; note?: string; good?: boolean }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-800">
        <Icon className="h-6 w-6 text-neutral-200" />
      </span>
      <div>
        <div className="text-3xl font-semibold">{value}</div>
        <div className="text-base text-neutral-400">{label}</div>
        {note && <div className={`mt-1 text-base font-medium ${good ? 'text-green-400' : 'text-red-300'}`}>{note}</div>}
      </div>
    </div>
  );
}

/** The coach shows one exercise at a time; the buttons below him switch to the others. */
function CoachCard({ exercises }: { exercises: Exercise[] }) {
  const [selected, setSelected] = useState<Exercise>(exercises[0]);
  const [current, setCurrent] = useState(-1);
  const info = EXERCISES[selected];

  return (
    <Card
      title="Your exercises"
      className="xl:col-span-2"
      action={
        <button
          onClick={() => speakLines([info.title, ...info.steps], (i) => setCurrent(i - 1))}
          className="flex min-h-[48px] items-center gap-2 rounded-xl border border-neutral-700 px-4 text-base font-medium hover:bg-neutral-800"
        >
          <Volume2 className="h-5 w-5" /> Read aloud
        </button>
      }
    >
      <div className="grid items-start gap-6 md:grid-cols-[280px_1fr]">
        <div className="rounded-2xl bg-neutral-950 p-3">
          <Avatar exercise={selected} />
        </div>
        <div>
          <h3 className="text-2xl font-semibold">{info.title}</h3>
          <p className="mt-1 text-lg text-neutral-400">{info.cameraSetup}</p>
          <StepList steps={info.steps} current={current} />
        </div>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3" role="group" aria-label="Choose an exercise to see">
        {exercises.map((ex, i) => (
          <button
            key={ex}
            onClick={() => {
              setSelected(ex);
              setCurrent(-1);
            }}
            aria-pressed={selected === ex}
            className={`min-h-[60px] rounded-xl border px-4 text-lg font-medium ${
              selected === ex ? 'border-neutral-100 bg-neutral-100 text-neutral-950' : 'border-neutral-700 hover:bg-neutral-800'
            }`}
          >
            {i + 1}. {EXERCISES[ex].title}
          </button>
        ))}
      </div>
    </Card>
  );
}

function CareTeamCard() {
  useDataChanges();
  const { patient } = usePatientData();
  const links = getLinks(patient.id);
  return (
    <Card
      title="Your care team"
      action={
        <Link to="/patient/settings" className="flex min-h-[44px] items-center gap-1 text-base font-medium text-neutral-300 hover:text-white">
          Manage <ChevronRight className="h-4 w-4" />
        </Link>
      }
    >
      {links.length === 0 && <p className="text-lg text-neutral-400">No physician added yet. Add one in Settings.</p>}
      <ul className="space-y-3">
        {links.map((l) => {
          const doc = getPhysician(l.physicianId);
          if (!doc) return null;
          return (
            <li key={l.physicianId} className="flex items-center gap-3">
              <Initials name={doc.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-medium">{doc.name}</div>
                <div className="text-base text-neutral-400">{l.status === 'accepted' ? doc.role : 'Request sent · waiting'}</div>
              </div>
              {l.status === 'accepted' && (
                <Link
                  to={`/patient/messages?to=${doc.id}`}
                  aria-label={`Message ${doc.name}`}
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-700 hover:bg-neutral-800"
                >
                  <MessageSquare className="h-5 w-5" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
