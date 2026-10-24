import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPatients } from '../api';
import { usePolling } from '../usePolling';
import type { PatientSummary } from '../types';
import { ALERT_LABELS } from '../types';

function TrendArrow({ trend }: { trend: PatientSummary['trend'] }) {
  if (trend === 'up') {
    return <span className="font-semibold text-teal" title="Symmetry rising">↑</span>;
  }
  if (trend === 'down') {
    return <span className="font-semibold text-amber-700" title="Symmetry falling">↓</span>;
  }
  if (trend === 'flat') {
    return <span className="font-semibold text-slate-500" title="Symmetry flat">→</span>;
  }
  return <span className="text-slate-400">—</span>;
}

function formatCheckin(date: string) {
  try {
    return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return date;
  }
}

export default function PatientList() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Rows whose open-alert count just went up; flashed for a few seconds.
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const lastCounts = useRef<Map<string, number> | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const data = await getPatients();
    const prev = lastCounts.current;
    // Skip the very first load: nothing has "gone up" yet.
    if (prev) {
      const risen = data.filter((p) => p.openAlertCount > (prev.get(p.id) ?? 0)).map((p) => p.id);
      if (risen.length > 0) {
        setFlashIds(new Set(risen));
        window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlashIds(new Set()), 4000);
      }
    }
    lastCounts.current = new Map(data.map((p) => [p.id, p.openAlertCount]));
    setPatients(data);
    setError(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load patients');
      } finally {
        setLoading(false);
      }
    })();
    return () => window.clearTimeout(flashTimer.current);
  }, [load]);

  // Refresh every 5s (paused while the tab is hidden).
  usePolling(async () => {
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load patients');
    }
  });

  if (loading) {
    return <p className="text-lg text-slate-600">Loading patients…</p>;
  }

  // Only replace the table with the error if we never loaded anything.
  if (error && patients.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-alert-soft px-5 py-4 text-lg">
        <p className="font-semibold text-alert">Could not reach the API</p>
        <p className="mt-1 text-slate-700">{error}</p>
        <p className="mt-2 text-base text-slate-600">
          Start the API with <code className="rounded bg-white px-1">npm start</code> in{' '}
          <code className="rounded bg-white px-1">Raghav/api</code>, then refresh.
        </p>
      </div>
    );
  }

  const flagged = patients.filter((p) => p.flagged).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-ink">Patients</h1>
        <p className="mt-1 text-lg text-slate-600">
          {flagged > 0
            ? `${flagged} flagged for care team review · sorted with alerts first`
            : 'No open alerts · all patients on track'}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {error ? `Can't reach the API (${error}) — retrying…` : 'Live · refreshes every 5 seconds'}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-foam bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-base">
          <thead className="bg-mist text-sm uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Weak side</th>
              <th className="px-4 py-3 font-semibold">Symmetry</th>
              <th className="px-4 py-3 font-semibold">Sessions / week</th>
              <th className="px-4 py-3 font-semibold">Open alerts</th>
              <th className="px-4 py-3 font-semibold">Next check-in</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => (
              <tr
                key={p.id}
                className={`border-t border-foam transition hover:bg-teal-soft/40 ${
                  p.flagged ? 'bg-alert-soft/40' : ''
                } ${flashIds.has(p.id) ? 'row-flash' : ''}`}
              >
                <td className="px-4 py-4">
                  <Link
                    to={`/care/patients/${p.id}`}
                    className="text-lg font-semibold text-teal-deep underline-offset-2 hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.flagged && (
                    <span className="ml-2 rounded bg-alert-soft px-2 py-0.5 text-xs font-semibold uppercase text-alert">
                      Flagged
                    </span>
                  )}
                </td>
                <td className="px-4 py-4 capitalize text-slate-700">{p.weakSide}</td>
                <td className="px-4 py-4">
                  <span className="mr-2 text-lg font-semibold tabular-nums">
                    {p.latestSymmetry != null ? `${p.latestSymmetry}%` : '—'}
                  </span>
                  <TrendArrow trend={p.trend} />
                </td>
                <td className="px-4 py-4 tabular-nums text-slate-700">
                  {p.sessionsThisWeek}
                  <span className="text-slate-400"> / </span>
                  {p.sessionsPerWeek ?? '—'}
                </td>
                <td className="px-4 py-4">
                  {p.openAlertCount === 0 ? (
                    <span className="text-slate-400">0</span>
                  ) : (
                    <div>
                      <span className="font-semibold text-alert">{p.openAlertCount}</span>
                      <div className="mt-0.5 text-sm text-slate-600">
                        {p.openAlertTypes.map((t) => ALERT_LABELS[t]).join(', ')}
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-4 text-slate-700">{formatCheckin(p.nextCheckin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
