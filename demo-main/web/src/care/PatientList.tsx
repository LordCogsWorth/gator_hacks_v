import { ChevronRight, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPatients } from '../api';
import type { PatientSummary } from '../types';
import { ALERT_LABELS } from '../types';
import { Badge, Banner, Card, EmptyState, PageHeader, Spinner, cx } from '../ui';
import { usePolling } from '../usePolling';
import { ALERT_TONE } from './alertTone';
import { daysBetween, formatDay, relativeDays, todayISO } from './dates';
import { errorMessage } from './errors';

const FLASH_MS = 4000;

/** Flagged first, then by name (the data layer already sorts this way; kept stable here). */
function byFlagThenName(a: PatientSummary, b: PatientSummary) {
  return Number(b.flagged) - Number(a.flagged) || a.name.localeCompare(b.name);
}

/** A row flashes when a new session or a new alert arrives for that patient. */
function changedIds(prev: Map<string, PatientSummary>, next: PatientSummary[]): string[] {
  return next
    .filter((p) => {
      const old = prev.get(p.id);
      if (!old) return false;
      return (
        p.openAlertCount > old.openAlertCount ||
        p.sessionsThisWeek !== old.sessionsThisWeek ||
        p.latestSymmetry !== old.latestSymmetry
      );
    })
    .map((p) => p.id);
}

const TREND = {
  up: { glyph: '▲', word: 'rising', className: 'text-success' },
  down: { glyph: '▼', word: 'falling', className: 'text-danger' },
  flat: { glyph: '▬', word: 'flat', className: 'text-text-muted' },
} as const;

function SymmetryCell({ p }: { p: PatientSummary }) {
  if (p.latestSymmetry == null) return <span className="text-text-muted">—</span>;
  const trend = p.trend === 'none' ? null : TREND[p.trend];
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-lg font-semibold tabular-nums text-text">{Math.round(p.latestSymmetry)}%</span>
      {trend && (
        <span className={cx('text-sm font-semibold tabular-nums', trend.className)} title={`Symmetry ${trend.word}`}>
          <span aria-hidden>{trend.glyph}</span>
          <span className="sr-only">{trend.word}</span>
          {p.trend !== 'flat' && ` ${Math.abs(p.trendDelta)}`}
        </span>
      )}
    </span>
  );
}

function AdherenceCell({ p }: { p: PatientSummary }) {
  const goal = p.sessionsPerWeek;
  const pct = goal ? Math.min(100, (p.sessionsThisWeek / goal) * 100) : 0;
  return (
    <div className="min-w-24">
      <span className="tabular-nums text-text">
        <span className="font-semibold">{p.sessionsThisWeek}</span>
        <span className="text-text-muted"> / {goal ?? '—'}</span>
      </span>
      {goal ? (
        <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function CheckinCell({ date }: { date: string }) {
  const days = daysBetween(todayISO(), date);
  return (
    <div>
      <div className="text-text">{formatDay(date)}</div>
      <div className={cx('text-sm', days < 0 ? 'font-semibold text-danger' : 'text-text-muted')}>
        {days < 0 ? `Overdue · ${relativeDays(days)}` : relativeDays(days)}
      </div>
    </div>
  );
}

export default function PatientList() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const last = useRef<Map<string, PatientSummary> | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const data = [...(await getPatients())].sort(byFlagThenName);
    // Skip the very first load: nothing is "new" yet.
    if (last.current) {
      const changed = changedIds(last.current, data);
      if (changed.length > 0) {
        setFlashIds(new Set(changed));
        window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlashIds(new Set()), FLASH_MS);
      }
    }
    last.current = new Map(data.map((p) => [p.id, p]));
    setPatients(data);
    setError(null);
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setError(errorMessage(e, 'Could not load patients')))
      .finally(() => setLoading(false));
    return () => window.clearTimeout(flashTimer.current);
  }, [load]);

  // Refresh every 5 s (paused while the tab is hidden).
  usePolling(async () => {
    try {
      await load();
    } catch (e) {
      setError(errorMessage(e, 'Could not load patients'));
    }
  });

  if (loading) {
    return <Spinner label="Loading patients…" className="text-lg text-text-muted" />;
  }

  if (error && patients.length === 0) {
    return (
      <EmptyState icon={<Users />} title="Could not load patients">
        {error} Retrying every 5 seconds.
      </EmptyState>
    );
  }

  const flagged = patients.filter((p) => p.flagged).length;

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle={flagged > 0 ? `${flagged} flagged for review · flagged patients first` : 'No open alerts · all patients on track'}
        meta={<span className="text-sm text-text-muted">Live · refreshes every 5 seconds</span>}
      />

      {error && (
        <Banner tone="warning" title="Showing the last list we loaded" className="mb-4">
          {error}
        </Banner>
      )}

      {patients.length === 0 ? (
        <EmptyState icon={<Users />} title="No patients yet" />
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-base">
              <thead className="bg-surface-2 text-sm uppercase tracking-wide text-text-muted">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">Patient</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Symmetry</th>
                  <th scope="col" className="px-3 py-3 font-semibold">This week / goal</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Open alerts</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Next check-in</th>
                  <th scope="col" className="w-12 px-3 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <tr
                    key={p.id}
                    className={cx(
                      'border-t border-border align-middle transition-colors hover:bg-primary-soft/50',
                      p.flagged && 'bg-warning-soft/40',
                      flashIds.has(p.id) && 'animate-row-flash',
                    )}
                  >
                    <td className="px-5 py-3">
                      <Link
                        to={`/care/patients/${p.id}`}
                        className="inline-flex min-h-tap items-center rounded-control text-lg font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                        <span>
                          Weak side <span className="capitalize">{p.weakSide}</span> · Phase {p.phase}
                        </span>
                        {p.flagged && (
                          <Badge tone="warning" size="sm">
                            Flagged
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <SymmetryCell p={p} />
                    </td>
                    <td className="px-3 py-3">
                      <AdherenceCell p={p} />
                    </td>
                    <td className="px-3 py-3">
                      {p.openAlertTypes.length === 0 ? (
                        <span className="text-text-muted">None</span>
                      ) : (
                        <div className="flex max-w-xs flex-wrap gap-1.5">
                          {p.openAlertTypes.map((t) => (
                            <Badge key={t} tone={ALERT_TONE[t]} size="sm">
                              {ALERT_LABELS[t]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <CheckinCell date={p.nextCheckin} />
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        to={`/care/patients/${p.id}`}
                        aria-label={`Open ${p.name}`}
                        tabIndex={-1}
                        className="flex min-h-tap min-w-tap items-center justify-center rounded-control text-text-muted hover:bg-text/[0.06] hover:text-text"
                      >
                        <ChevronRight className="h-5 w-5" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
