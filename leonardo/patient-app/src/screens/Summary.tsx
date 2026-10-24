import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentPlan, getPatient, getResults, getSessions, saveSession, streakDays, symmetryFor } from '../api';
import { BigButton } from '../components/Layout';
import { EXERCISES } from '../data/exercises';
import { useSession } from '../session/SessionContext';
import type { ExerciseId } from '../types';
import { speak } from '../voice/useVoice';

const WEEK_MS = 6 * 86_400_000;

export function Summary() {
  const navigate = useNavigate();
  const session = useSession();
  const plan = getCurrentPlan();
  const [saved, setSaved] = useState<'saving' | 'saved' | 'failed'>('saving');
  const savedOnce = useRef(false);

  // Compare with the most recent session from about a week ago (before today's is saved).
  const lines = useMemo(() => {
    const history = getSessions();
    const allResults = getResults();
    const weekAgo = [...history].reverse().find((s) => Date.now() - new Date(s.started_at).getTime() >= WEEK_MS);
    return plan.exercises.map(({ name }) => {
      const today = symmetryFor(session.results, session.sessionId, name);
      const before = weekAgo ? symmetryFor(allResults, weekAgo.id, name) : null;
      return { name, today, before };
    });
  }, [plan, session.results, session.sessionId]);

  useEffect(() => {
    if (savedOnce.current) return;
    savedOnce.current = true;
    saveSession(
      {
        id: session.sessionId,
        patient_id: getPatient().id,
        started_at: session.startedAt,
        pain: session.pain ?? 0,
        tiredness: session.tiredness ?? 0,
        avg_hr: null, // filled in from the Watch when the iPhone Shortcut next runs
        replay_file: null,
      },
      session.results,
      session.replay.current,
    ).then(
      () => setSaved('saved'),
      () => setSaved('failed'),
    );
    const first = lines.find((l) => l.today !== null);
    speak(`Session complete. ${first ? sentence(first.name, first.today!, first.before) : ''} Well done.`);
  }, []); // run once when the summary opens

  const streak = saved === 'saved' ? streakDays(getSessions()) : null;

  return (
    <div className="space-y-6">
      <ul className="space-y-4">
        {lines.map((l) => (
          <li key={l.name} className="rounded-2xl border border-neutral-700 p-5">
            <div className="text-xl font-bold text-neutral-300">{EXERCISES[l.name].title}</div>
            {l.today === null ? (
              <div className="text-2xl">Not finished today.</div>
            ) : (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
                <span className="text-6xl font-semibold text-neutral-50">{l.today}%</span>
                <span className="text-2xl">{sentence(l.name, l.today, l.before)}</span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-neutral-900 p-5 text-2xl">
        {streak !== null && <span className="font-semibold">{streak} days in a row</span>}
        <span className="text-neutral-300">
          {saved === 'saving' ? 'Saving…' : saved === 'saved' ? '✓ Sent to your care team' : 'Could not save — will retry'}
        </span>
      </div>

      <BigButton className="w-full" onClick={() => navigate('/patient')}>
        Back to dashboard
      </BigButton>
    </div>
  );
}

function sentence(ex: ExerciseId, today: number, before: number | null) {
  const what = ex === 'hand_open' ? 'Your weak hand opened' : 'Your weak arm reached';
  const base = `${what} ${today}% of your healthy ${ex === 'hand_open' ? 'hand' : 'arm'}`;
  if (before === null) return `${base}.`;
  if (today > before) return `${base} — up from ${before}% last week.`;
  if (today === before) return `${base} — same as last week.`;
  return `${base}. Last week was ${before}%. Keep going!`;
}
