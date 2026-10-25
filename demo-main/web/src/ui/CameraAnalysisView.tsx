// Camera "Analyze" results: both arms' raise, joint ranges and likely weak muscles. Used by patient and care pages.
import { useEffect, useState } from 'react';
import { getPatientCameraAnalyses, onDataChange } from '../api';
import type { CameraAnalysis } from '../types';

/** The patient's camera analyses, newest first; refreshes on data changes and every 15 s. */
export function useCameraAnalyses(patientId: string): CameraAnalysis[] | null {
  const [rows, setRows] = useState<CameraAnalysis[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getPatientCameraAnalyses(patientId)
        .then((r) => alive && setRows(r))
        .catch(() => alive && setRows([]));
    load();
    const unsub = onDataChange(load);
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
      unsub();
    };
  }, [patientId]);
  return rows;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const tone = (p: number | null | undefined) =>
  p == null ? 'text-text-muted' : p >= 85 ? 'text-success' : p >= 60 ? 'text-warning' : 'text-danger';

function Box({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-control bg-surface-2 px-4 py-2">
      <div className="text-sm text-text-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${cls ?? ''}`}>{value}</div>
      {sub && <div className="text-sm text-text-muted">{sub}</div>}
    </div>
  );
}

/** One analysis. `compact` hides the joint table and findings (for small cards). */
export function CameraAnalysisView({ a, compact = false }: { a: CameraAnalysis; compact?: boolean }) {
  const L = a.shoulder?.L;
  const R = a.shoulder?.R;
  const gap = L && R ? Math.abs(L.pct - R.pct) : null;
  const joints = Object.values(a.joints ?? {}).filter((j) => j.peakDeg != null);
  return (
    <div className="space-y-3">
      <div className="text-base text-text-muted">
        📷 Camera analysis · {when(a.createdAt)}
        {a.arm ? ` · during ${a.arm} arm` : ''}
      </div>
      <div className="flex flex-wrap gap-3">
        <Box label="Left arm raise" value={L ? `${L.pct}%` : '—'} sub={L ? `${L.peakDeg}° of 180°` : 'not seen'} cls={tone(L?.pct)} />
        <Box label="Right arm raise" value={R ? `${R.pct}%` : '—'} sub={R ? `${R.peakDeg}° of 180°` : 'not seen'} cls={tone(R?.pct)} />
        {gap != null && <Box label="Difference" value={`${gap} pts`} cls={gap >= 15 ? 'text-danger' : undefined} />}
        <Box label="Arm speed" value={a.maxArmSpeedDegS != null ? `${a.maxArmSpeedDegS}°/s` : '—'} />
        <Box label="Heart rate" value={a.heartRate != null ? `${a.heartRate} bpm` : '—'} />
        {a.wristSpeed != null && <Box label="Wrist speed" value={`${a.wristSpeed.toFixed(2)} m/s`} />}
        {a.heightCm != null && <Box label="Height" value={`${a.heightCm} cm`} />}
      </div>
      {!compact && joints.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-text-muted">
              <tr>
                <th className="py-1 pr-4 font-medium">Joint</th>
                <th className="py-1 pr-4 font-medium">Peak</th>
                <th className="py-1 font-medium">% of normal range</th>
              </tr>
            </thead>
            <tbody>
              {joints.map((j) => (
                <tr key={j.name} className="border-t border-border tabular-nums">
                  <td className="py-1 pr-4">{j.name}</td>
                  <td className="py-1 pr-4">{j.peakDeg}°</td>
                  <td className={`py-1 ${tone(j.pct)}`}>{j.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && a.findings?.length > 0 && (
        <ul className="space-y-1 text-sm">
          {a.findings.map((f) => (
            <li key={f.muscle}>
              <span className={f.status === 'likely' ? 'text-danger' : 'text-warning'}>{f.status === 'likely' ? '⚠' : '•'}</span>{' '}
              <b>{f.muscle}</b> — {f.status} ({f.score}%){f.reason ? `: ${f.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
      {!compact && <p className="text-xs text-text-muted">Estimate from one camera, not a medical diagnosis.</p>}
    </div>
  );
}
