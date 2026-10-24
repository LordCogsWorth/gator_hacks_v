// Every past session, newest first. Tap one to see each arm's numbers.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Exercise, StopReason } from '../../types';
import type { SessionSummary } from '../api';
import { BigButton } from '../components/Layout';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';
import { TIREDNESS } from './CheckIn';
import { useSpeakOnMount } from '../voice/useVoice';

const STOP_WORDS: Record<StopReason, string> = { pain: '(pain)', dizziness: '(felt unwell)', other: '' };

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function History() {
  const navigate = useNavigate();
  const { summaries, plan } = usePatientData();
  const sessions = [...summaries].reverse();
  // Columns: the plan's exercises (all three if there's no plan yet).
  const exercises = plan ? plan.exercises.map((e) => e.exercise) : (Object.keys(EXERCISES) as Exercise[]);
  const [open, setOpen] = useState<string | null>(null);

  useSpeakOnMount(`Your past sessions. You have done ${sessions.length} sessions. Tap one to see more.`);

  return (
    <div className="space-y-6">
      <p className="text-xl text-neutral-300">{sessions.length} sessions done. The % is how your weaker arm did compared with your stronger arm.</p>

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

      <BigButton className="w-full" onClick={() => navigate('/patient')}>
        Back to dashboard
      </BigButton>
    </div>
  );
}

function SessionCard({ s, exercises, open, onToggle }: { s: SessionSummary; exercises: Exercise[]; open: boolean; onToggle: () => void }) {
  const tired = TIREDNESS.find((t) => t.v === s.session.tiredness);
  const stopped = s.average === null;

  return (
    <li className="overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900">
      <button onClick={onToggle} aria-expanded={open} className="flex min-h-[96px] w-full flex-wrap items-center gap-x-6 gap-y-2 p-5 text-left">
        <div className="min-w-[180px]">
          <div className="text-lg text-neutral-400">Session {s.number}</div>
          <div className="text-2xl font-semibold">{dateLabel(s.session.startedAt)}</div>
        </div>
        {stopped ? (
          <div className="text-2xl text-neutral-300">
            Stopped early {s.session.stopReason ? STOP_WORDS[s.session.stopReason] : (s.session.pain ?? 0) >= 7 ? '(pain)' : ''}
          </div>
        ) : (
          <div className="flex flex-1 flex-wrap gap-3">
            {exercises.map((ex) => (
              <div key={ex} className="rounded-2xl bg-neutral-800 px-4 py-2">
                <div className="text-base text-neutral-400">{EXERCISES[ex].title}</div>
                <div className="text-2xl font-semibold">{s.symmetry[ex] !== undefined ? `${s.symmetry[ex]}%` : '—'}</div>
              </div>
            ))}
          </div>
        )}
        <span className="ml-auto text-3xl text-neutral-400" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-neutral-800 p-5 text-xl">
          <div className="flex flex-wrap gap-6">
            <span>Pain: <b>{s.session.pain !== null ? `${s.session.pain}/10` : '—'}</b></span>
            <span>Tiredness: <b>{tired ? `${tired.emoji} ${tired.label}` : '—'}</b></span>
            {s.session.avgHr !== null && <span>Heart rate: <b>{s.session.avgHr} bpm</b></span>}
          </div>
          {!stopped && (
            <table className="w-full text-left">
              <thead className="text-lg text-neutral-400">
                <tr>
                  <th className="py-2 font-normal">Exercise</th>
                  <th className="py-2 font-normal">Stronger arm</th>
                  <th className="py-2 font-normal">Weaker arm</th>
                  <th className="py-2 font-normal">Reps</th>
                </tr>
              </thead>
              <tbody>
                {exercises.map((ex) => {
                  const h = s.session.results.find((r) => r.exercise === ex && r.side === 'healthy');
                  const w = s.session.results.find((r) => r.exercise === ex && r.side === 'weak');
                  const unit = EXERCISES[ex].unit;
                  return (
                    <tr key={ex} className="border-t border-neutral-800">
                      <td className="py-2">{EXERCISES[ex].title}</td>
                      <td className="py-2">{h ? `${h.bestValue}${unit}` : '—'}</td>
                      <td className="py-2">{w ? `${w.bestValue}${unit}` : '—'}</td>
                      <td className="py-2">{w ? w.reps : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}
