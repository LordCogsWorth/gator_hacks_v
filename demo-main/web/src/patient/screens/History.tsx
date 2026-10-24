// Every past session, newest first. Tap one to see each arm's numbers.
import { ChevronDown, Home, Play } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Exercise, StopReason } from '../../types';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { EmptyState } from '../../ui/EmptyState';
import type { SessionSummary } from '../api';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';
import { useSpeakOnMount } from '../voice/useVoice';
import { PAIN_STOP_AT, TIREDNESS } from './CheckIn';

const STOP_WORDS: Record<StopReason, string> = { pain: 'pain', dizziness: 'felt unwell', other: 'other' };

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function History() {
  const navigate = useNavigate();
  const { summaries, plan } = usePatientData();
  const sessions = [...summaries].reverse();
  // Columns: the plan's exercises (all three if there's no plan yet).
  const exercises = plan ? plan.exercises.map((e) => e.exercise) : (Object.keys(EXERCISES) as Exercise[]);
  const [open, setOpen] = useState<string | null>(null);

  useSpeakOnMount(
    sessions.length
      ? `Your past sessions. You have done ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}. Tap one to see more.`
      : 'You have no sessions yet. Start one from Home.',
  );

  return (
    <div className="space-y-6">
      {sessions.length ? (
        <p className="text-xl text-text-muted">
          {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} done. The % is how your weaker arm did compared with your stronger arm.
        </p>
      ) : (
        <EmptyState title="No sessions yet" action={<Button size="xl" icon={<Play />} to="/patient">Go to today's session</Button>}>
          Your sessions show up here after you finish one.
        </EmptyState>
      )}

      <ul className="space-y-4">
        {sessions.map((s) => (
          <SessionCard
            key={s.session.id}
            s={s}
            exercises={exercises}
            open={open === s.session.id}
            onToggle={() => setOpen(open === s.session.id ? null : s.session.id)}
          />
        ))}
      </ul>

      <Button size="xl" fullWidth variant="secondary" icon={<Home />} onClick={() => navigate('/patient')}>
        Back to Home
      </Button>
    </div>
  );
}

function SessionCard({ s, exercises, open, onToggle }: { s: SessionSummary; exercises: Exercise[]; open: boolean; onToggle: () => void }) {
  const tired = TIREDNESS.find((t) => t.v === s.session.tiredness);
  const stopped = s.average === null;
  const reason = s.session.stopReason ? STOP_WORDS[s.session.stopReason] : (s.session.pain ?? 0) >= PAIN_STOP_AT ? 'pain' : null;
  const detailsId = `session-${s.session.id}`;

  return (
    <li className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={detailsId}
        className="block min-h-[96px] w-full p-5 text-left hover:bg-surface-2"
      >
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg text-text-muted">Session {s.number}</div>
            <div className="text-2xl font-semibold">{dateLabel(s.session.startedAt)}</div>
          </div>
          <ChevronDown className={cx('h-8 w-8 shrink-0 text-text-muted transition-transform', open && 'rotate-180')} aria-hidden />
        </div>
        {stopped ? (
          <Badge tone="warning" size="md" className="mt-3">
            Stopped early{reason ? ` (${reason})` : ''}
          </Badge>
        ) : (
          <div className="mt-3 flex flex-wrap gap-3">
            {exercises.map((ex) => (
              <div key={ex} className="rounded-control bg-surface-2 px-4 py-2">
                <div className="text-base text-text-muted">{EXERCISES[ex].title}</div>
                <div className="text-2xl font-semibold tabular-nums">{s.symmetry[ex] !== undefined ? `${s.symmetry[ex]}%` : '—'}</div>
              </div>
            ))}
          </div>
        )}
      </button>

      {open && (
        <div id={detailsId} className="space-y-4 border-t border-border p-5 text-xl">
          <div className="flex flex-wrap gap-6">
            <span>
              Pain: <b>{s.session.pain !== null ? `${s.session.pain}/10` : '—'}</b>
            </span>
            <span>
              Tiredness: <b>{tired ? `${tired.emoji} ${tired.label}` : '—'}</b>
            </span>
            {s.session.avgHr !== null && (
              <span>
                Heart rate: <b>{Math.round(s.session.avgHr)} bpm</b>
              </span>
            )}
          </div>
          {!stopped && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-lg text-text-muted">
                  <tr>
                    <th className="py-2 pr-4 font-normal">Exercise</th>
                    <th className="py-2 pr-4 font-normal">Stronger arm</th>
                    <th className="py-2 pr-4 font-normal">Weaker arm</th>
                    <th className="py-2 font-normal">Reps</th>
                  </tr>
                </thead>
                <tbody>
                  {exercises.map((ex) => {
                    const h = s.session.results.find((r) => r.exercise === ex && r.side === 'healthy');
                    const w = s.session.results.find((r) => r.exercise === ex && r.side === 'weak');
                    const unit = EXERCISES[ex].unit;
                    return (
                      <tr key={ex} className="border-t border-border">
                        <td className="py-2 pr-4">{EXERCISES[ex].title}</td>
                        <td className="py-2 pr-4 tabular-nums">{h ? `${Math.round(h.bestValue)}${unit}` : '—'}</td>
                        <td className="py-2 pr-4 tabular-nums">{w ? `${Math.round(w.bestValue)}${unit}` : '—'}</td>
                        <td className="py-2 tabular-nums">{w ? w.reps : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
