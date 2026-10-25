import { Home } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { Exercise } from '../../types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { streakDays, summarize, symmetryFor, weekAgoSummary } from '../api';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';
import { useSession } from '../session/SessionContext';
import { useSpeakOnMount } from '../voice/useVoice';

export function Summary() {
  const navigate = useNavigate();
  const session = useSession();
  const { sessions } = usePatientData();
  const savedOnce = useRef(false);
  // Opened without doing a session (e.g. after a page refresh): nothing to show or save.
  const empty = !session.plan || (session.pain === null && session.results.length === 0);
  // Every exercise skipped (or stopped before finishing one): there is nothing to send to the care team.
  const nothingDone = session.results.length === 0;

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
  const first = lines.find((l) => l.today !== null);
  useSpeakOnMount(
    empty
      ? ''
      : nothingDone
        ? 'No exercises were finished today, so there is nothing to send to your care team.'
        : `Session complete. ${first ? sentence(first.name, first.today!, first.before) : ''} Well done.`,
  );

  useEffect(() => {
    if (savedOnce.current || empty || nothingDone) return;
    savedOnce.current = true;
    session.save().catch(() => {
      // Shown below from session.saveState.
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- save once when the summary opens

  if (empty) return <Navigate to="/patient" replace />;

  const { saveState } = session;
  const streak = saveState.status === 'saved' ? streakDays(sessions) : null;

  return (
    <div className="space-y-6">
      <ul className="space-y-4">
        {lines.map((l) => (
          <li key={l.name}>
            <Card title={EXERCISES[l.name].title} titleAs="h2">
              {l.today === null ? (
                <p className="text-2xl">Not finished today.</p>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-4">
                  <span className="font-display text-6xl font-semibold tabular-nums">{l.today}%</span>
                  <span className="text-2xl">{sentence(l.name, l.today, l.before)}</span>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {nothingDone ? (
        <Banner tone="info" title="No exercises finished today">
          There's nothing to send to your care team. You can try again from Home whenever you're ready.
        </Banner>
      ) : saveState.status === 'saved' ? (
        <Banner tone="success" title="Sent to your care team">
          {streak !== null && `${streak} ${streak === 1 ? 'day' : 'days'} in a row. `}
          3D recordings sent: {saveState.outcome.replaysSent} of {saveState.outcome.replaysTotal}.
        </Banner>
      ) : saveState.status === 'failed' && !saveState.network ? (
        <Banner tone="warning" title="Your session couldn't be saved.">
          {saveState.error}
        </Banner>
      ) : saveState.status === 'failed' ? (
        <Banner
          tone="danger"
          title="Couldn't reach your care team."
          action={
            <Button variant="secondary" onClick={() => void session.save().catch(() => undefined)}>
              Try again
            </Button>
          }
        >
          Your session is kept on this screen. Try again in a moment.
        </Banner>
      ) : (
        <Banner tone="info" title="Saving…" />
      )}

      <Button size="xl" fullWidth icon={<Home />} onClick={() => navigate('/patient')}>
        Back to Home
      </Button>
    </div>
  );
}

function sentence(ex: Exercise, today: number, before: number | null) {
  const what = ex === 'hand_open' ? 'Your weak hand opened' : 'Your weak arm reached';
  const base = `${what} ${today}% of your stronger ${ex === 'hand_open' ? 'hand' : 'arm'}`;
  if (before === null) return `${base}.`;
  if (today > before) return `${base}, up from ${before}% last week.`;
  if (today === before) return `${base}, same as last week.`;
  return `${base}. Last week was ${before}%. Keep going!`;
}
