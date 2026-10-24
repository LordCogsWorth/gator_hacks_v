// Every past session, newest first. Tap one to see each arm's numbers.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentPlan, getSessionSummaries, type SessionSummary } from '../api';
import { BigButton } from '../components/Layout';
import { EXERCISES } from '../data/exercises';
import { TIREDNESS } from './CheckIn';
import { useSpeakOnMount } from '../voice/useVoice';

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function History() {
  const navigate = useNavigate();
  const sessions = getSessionSummaries().reverse();
  const [open, setOpen] = useState<string | null>(null);

  useSpeakOnMount(`Your past sessions. You have done ${sessions.length} sessions. Tap one to see more.`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-extrabold">Past sessions</h1>
        <BigButton variant="secondary" onClick={() => navigate('/patient/progress')}>
          📈 See my progress
        </BigButton>
      </div>
      <p className="text-2xl text-neutral-300">{sessions.length} sessions done. The % is how your weaker arm did compared with your stronger arm.</p>

      <ul className="space-y-4">
        {sessions.map((s) => (
          <SessionCard key={s.session.id} s={s} open={open === s.session.id} onToggle={() => setOpen(open === s.session.id ? null : s.session.id)} />
        ))}
      </ul>

      <BigButton className="w-full" onClick={() => navigate('/patient')}>
        Back to home
      </BigButton>
    </div>
  );
}

function SessionCard({ s, open, onToggle }: { s: SessionSummary; open: boolean; onToggle: () => void }) {
  const exercises = getCurrentPlan().exercises.map((e) => e.name);
  const tired = TIREDNESS.find((t) => t.v === s.session.tiredness);
  const stopped = s.average === null;

  return (
    <li className="overflow-hidden rounded-3xl border-2 border-neutral-700 bg-neutral-900">
      <button onClick={onToggle} aria-expanded={open} className="flex min-h-[96px] w-full flex-wrap items-center gap-x-6 gap-y-2 p-5 text-left">
        <div className="min-w-[180px]">
          <div className="text-lg text-neutral-400">Session {s.number}</div>
          <div className="text-2xl font-extrabold">{dateLabel(s.session.started_at)}</div>
        </div>
        {stopped ? (
          <div className="text-2xl text-neutral-300">Stopped early {s.session.pain >= 7 ? '(pain)' : ''}</div>
        ) : (
          <div className="flex flex-1 flex-wrap gap-3">
            {exercises.map((ex) => (
              <div key={ex} className="rounded-2xl bg-neutral-800 px-4 py-2">
                <div className="text-base text-neutral-400">{EXERCISES[ex].title}</div>
                <div className="text-2xl font-extrabold">{s.symmetry[ex] !== undefined ? `${s.symmetry[ex]}%` : '—'}</div>
              </div>
            ))}
          </div>
        )}
        <span className="ml-auto text-3xl text-neutral-400" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t-2 border-neutral-800 p-5 text-xl">
          <div className="flex flex-wrap gap-6">
            <span>Pain: <b>{s.session.pain}/10</b></span>
            <span>Tiredness: <b>{tired ? `${tired.emoji} ${tired.label}` : '—'}</b></span>
            {s.session.avg_hr !== null && <span>Heart rate: <b>{s.session.avg_hr} bpm</b></span>}
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
                  const h = s.results.find((r) => r.exercise === ex && r.side === 'healthy');
                  const w = s.results.find((r) => r.exercise === ex && r.side === 'weak');
                  const unit = EXERCISES[ex].unit;
                  return (
                    <tr key={ex} className="border-t border-neutral-800">
                      <td className="py-2">{EXERCISES[ex].title}</td>
                      <td className="py-2">{h ? `${h.best_value}${unit}` : '—'}</td>
                      <td className="py-2">{w ? `${w.best_value}${unit}` : '—'}</td>
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
