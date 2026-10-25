// Every watch round with the numbers the watch records, newest first.
import type { Patient, WatchSession } from '../../types';
import { EXERCISE_LABELS } from '../../types';
import { shortDateTime } from '../dates';

const dur = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`);

export function WatchSessionTable({ rows, patient }: { rows: WatchSession[]; patient: Patient }) {
  if (rows.length === 0) return <p className="text-text-muted">No watch exercise sessions yet.</p>;
  const sorted = [...rows].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="text-text-muted">
          <tr>
            {['When', 'Exercise', 'Arm', 'Reps', 'Tries', 'Best angle', 'Avg HR', 'Max HR', 'Duration', 'Done'].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((w) => {
            const weak = w.arm != null && w.arm === patient.weakSide;
            return (
              <tr key={w.id} className="border-t border-border tabular-nums">
                <td className="px-3 py-2">{shortDateTime(w.startedAt)}</td>
                <td className="px-3 py-2">{EXERCISE_LABELS[w.exercise] ?? w.exercise}</td>
                <td className="px-3 py-2 capitalize">{w.arm ? `${w.arm}${weak ? ' (weak)' : ''}` : '—'}</td>
                <td className="px-3 py-2">{w.reps ?? '—'}{w.targetReps ? ` / ${w.targetReps}` : ''}</td>
                <td className="px-3 py-2">{w.attempts ?? '—'}</td>
                <td className="px-3 py-2">{w.bestElevationDeg != null ? `${Math.round(w.bestElevationDeg)}°` : '—'}</td>
                <td className="px-3 py-2">{w.avgHr != null ? `${Math.round(w.avgHr)} bpm` : '—'}</td>
                <td className="px-3 py-2">{w.maxHr != null ? `${Math.round(w.maxHr)} bpm` : '—'}</td>
                <td className="px-3 py-2">{dur(w.durationSec)}</td>
                <td className="px-3 py-2">{w.completed == null ? '—' : w.completed ? '✓' : 'partial'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
