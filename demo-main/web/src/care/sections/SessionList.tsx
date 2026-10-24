import { Play, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Exercise, Session, Side } from '../../types';
import { EXERCISE_LABELS } from '../../types';
import { Badge, Card, EmptyState } from '../../ui';
import { shortDateTime } from '../dates';
import { parseReplayKeys } from './replayKeys';

const STOP_LABELS = { pain: 'Stopped: pain', dizziness: 'Stopped: dizziness', other: 'Stopped early' } as const;

const fmt = (v: number | null, unit: string) => (v == null ? '—' : `${Math.round(v)}${unit}`);

export function replayHref(patientId: string, sessionId: string, exercise: Exercise, side: Side) {
  return `/care/patients/${encodeURIComponent(patientId)}/sessions/${encodeURIComponent(sessionId)}?exercise=${exercise}&side=${side}`;
}

/** The last 10 sessions, newest first, with links to each recorded replay. */
export function SessionList({ sessions, patientId }: { sessions: Session[]; patientId: string }) {
  const recent = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);

  if (recent.length === 0) {
    return <EmptyState title="No sessions yet">Sessions appear here as soon as the patient finishes one.</EmptyState>;
  }

  return (
    <Card title="Recent sessions" subtitle="Last 10, newest first. Open a replay to see the movement in 3D." padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-base">
          <thead className="bg-surface-2 text-sm uppercase tracking-wide text-text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Date</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Symmetry</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Compensation</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Avg HR</th>
              <th scope="col" className="px-3 py-3 font-semibold">Status</th>
              <th scope="col" className="px-5 py-3 font-semibold">Replays</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((s) => {
              const replays = parseReplayKeys(s.id, s.replays);
              return (
                <tr key={s.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-5 py-3 text-text">{shortDateTime(s.startedAt)}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-text">{fmt(s.symmetry, '%')}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-text">{fmt(s.compensation, '%')}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-text">{fmt(s.avgHr, ' bpm')}</td>
                  <td className="px-3 py-3">
                    {s.stopReason ? <Badge tone="danger">{STOP_LABELS[s.stopReason]}</Badge> : <span className="text-text-muted">Completed</span>}
                  </td>
                  <td className="px-5 py-2">
                    {replays.length === 0 ? (
                      <span className="inline-flex min-h-tap items-center text-text-muted">No replay</span>
                    ) : (
                      <ul className="flex flex-wrap gap-2" aria-label="Replays">
                        {replays.map((r) => (
                          <li key={`${r.exercise}-${r.side}`}>
                            <Link
                              to={replayHref(patientId, s.id, r.exercise, r.side)}
                              className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-primary/40 bg-primary-soft px-3 text-sm font-semibold text-text no-underline hover:border-primary hover:bg-primary/20"
                            >
                              <Play className="h-4 w-4 text-primary" aria-hidden />
                              {EXERCISE_LABELS[r.exercise]} · {r.side}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-2 border-t border-border px-5 py-3 text-sm text-text-muted">
        <Video className="h-4 w-4" aria-hidden />
        Replays are skeleton recordings only; no camera video is stored.
      </p>
    </Card>
  );
}
