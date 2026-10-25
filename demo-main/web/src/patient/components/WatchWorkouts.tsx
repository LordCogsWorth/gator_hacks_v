// Everything the Apple Watch recorded: reps, attempts, best arm angle, heart rate and time, per round.
import { Camera, Watch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPatientWatchSessions, onDataChange } from '../../api';
import type { WatchSession } from '../../types';
import { CameraAnalysisView, useCameraAnalyses } from '../../ui/CameraAnalysisView';
import { Card } from '../../ui/Card';

const EX_TITLE: Record<WatchSession['exercise'], string> = {
  arm_raise: 'Arm raise to the side',
  forward_reach: 'Forward reach',
};

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const dur = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s` : `${Math.round(sec)} s`);

/** The patient's watch rounds, newest first; re-loads when data changes. */
export function useWatchSessions(patientId: string): WatchSession[] | null {
  const [rows, setRows] = useState<WatchSession[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getPatientWatchSessions(patientId)
        .then((r) => alive && setRows(r))
        .catch(() => alive && setRows([]));
    load();
    const unsub = onDataChange(load);
    const timer = setInterval(load, 15_000); // pick up new watch uploads without a reload
    return () => {
      alive = false;
      clearInterval(timer);
      unsub();
    };
  }, [patientId]);
  return rows;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-surface-2 px-4 py-2">
      <div className="text-base text-text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** One watch round as a block of big numbers. */
export function WatchRound({ w }: { w: WatchSession }) {
  const hr =
    w.avgHr != null ? `${Math.round(w.avgHr)} bpm` + (w.maxHr != null ? ` (max ${Math.round(w.maxHr)})` : '') : '—';
  return (
    <div className="space-y-3">
      <div className="text-xl">
        <b>{EX_TITLE[w.exercise] ?? w.exercise}</b>
        {w.arm ? ` · ${w.arm} arm` : ''} <span className="text-text-muted">· {time(w.startedAt)}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        <Stat label="Reps" value={w.reps != null ? `${w.reps}${w.targetReps ? ` / ${w.targetReps}` : ''}` : '—'} />
        <Stat label="Best arm angle" value={w.bestElevationDeg != null ? `${Math.round(w.bestElevationDeg)}°` : '—'} />
        <Stat label="Tries" value={w.attempts != null ? String(w.attempts) : '—'} />
        <Stat label="Heart rate" value={hr} />
        <Stat label="Time" value={dur(w.durationSec)} />
        <Stat label="Finished" value={w.completed == null ? '—' : w.completed ? 'Yes ✓' : 'Not all reps'} />
      </div>
    </div>
  );
}

/** Home card: the latest camera Analyze result. */
export function CameraResults({ patientId }: { patientId: string }) {
  const rows = useCameraAnalyses(patientId);
  if (!rows || rows.length === 0) return null;
  return (
    <Card icon={<Camera />} title="From the camera" subtitle={`${rows.length} ${rows.length === 1 ? 'analysis' : 'analyses'} saved · latest below`}>
      <CameraAnalysisView a={rows[0]} />
    </Card>
  );
}

/** Home card: the latest watch rounds. */
export function WatchWorkouts({ patientId, limit = 3 }: { patientId: string; limit?: number }) {
  const rows = useWatchSessions(patientId);
  if (!rows || rows.length === 0) return null;
  return (
    <Card icon={<Watch />} title="From your Apple Watch" subtitle={`${rows.length} ${rows.length === 1 ? 'round' : 'rounds'} recorded`}>
      <div className="space-y-6">
        {rows.slice(0, limit).map((w) => (
          <WatchRound key={w.id} w={w} />
        ))}
      </div>
    </Card>
  );
}
