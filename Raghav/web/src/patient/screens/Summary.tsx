import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { Exercise } from '../../types';
import { streakDays, summarize, symmetryFor, weekAgoSummary } from '../api';
import { BigButton } from '../components/Layout';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';
import { useSession } from '../session/SessionContext';
import { speak } from '../voice/useVoice';

export function Summary() {
  const navigate = useNavigate();
  const session = useSession();
  const { sessions } = usePatientData();
  const savedOnce = useRef(false);
  // Opened without doing a session (e.g. after a page refresh): nothing to show or save.
  const empty = !session.plan || (session.pain === null && session.results.length === 0);

  // Compare with the most recent session from about a week ago, using the history from
  // before today's session is saved (computed once, when the summary opens).
  const [lines] = useState(() => {
    const history = summarize(sessions);
    return (session.plan?.exercises ?? []).map(({ exercise }) => ({
      name: exercise,
      today: symmetryFor(session.results, exercise),
      before: weekAgoSummary(history, exercise)?.symmetry[exercise] ?? null,
    }));
  });

  useEffect(() => {
    if (savedOnce.current || empty) return;
    savedOnce.current = true;
    session.save().catch(() => {
      // Shown below from session.saveState.
    });
    const first = lines.find((l) => l.today !== null);
    speak(`Session complete. ${first ? sentence(first.name, first.today!, first.before) : ''} Well done.`);
  }, []); // run once when the summary opens

  if (empty) return <Navigate to="/patient" replace />;

  const { saveState } = session;
  const streak = saveState.status === 'saved' ? streakDays(sessions) : null;

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
          {saveState.status === 'saved'
            ? '✓ Sent to your care team'
            : saveState.status === 'failed'
              ? "Couldn't reach your care team."
              : 'Saving…'}
        </span>
        {saveState.status === 'failed' && (
          <BigButton variant="secondary" onClick={() => void session.save().catch(() => undefined)}>
            Try again
          </BigButton>
        )}
        {saveState.status === 'saved' && (
          <span className="w-full text-base text-neutral-500">
            3D recordings sent: {saveState.outcome.replaysSent} of {saveState.outcome.replaysTotal}
          </span>
        )}
      </div>

      <BigButton className="w-full" onClick={() => navigate('/patient')}>
        Back to dashboard
      </BigButton>
    </div>
  );
}

function sentence(ex: Exercise, today: number, before: number | null) {
  const what = ex === 'hand_open' ? 'Your weak hand opened' : 'Your weak arm reached';
  const base = `${what} ${today}% of your stronger ${ex === 'hand_open' ? 'hand' : 'arm'}`;
  if (before === null) return `${base}.`;
  if (today > before) return `${base} — up from ${before}% last week.`;
  if (today === before) return `${base} — same as last week.`;
  return `${base}. Last week was ${before}%. Keep going!`;
}
