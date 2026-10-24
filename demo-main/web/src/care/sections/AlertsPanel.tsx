import { BellRing, CalendarClock, Check, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { acknowledgeAlert, setNextCheckin } from '../../api';
import type { Alert, Patient } from '../../types';
import { ALERT_LABELS } from '../../types';
import { Badge, Button, Card, ERROR_CLASS, cx } from '../../ui';
import { ALERT_TONE } from '../alertTone';
import { addDays, daysBetween, formatDay, relativeDays, shortDateTime, todayISO } from '../dates';
import { errorMessage } from '../errors';

const SETBACK_CHECKIN_DAYS = 3;

/** Open alerts with Acknowledge; a setback also offers moving the check-in to 3 days from now. */
export function AlertsPanel({
  alerts,
  patient,
  onChanged,
}: {
  alerts: Alert[];
  patient: Patient;
  onChanged: (message?: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO();
  const soonDate = addDays(today, SETBACK_CHECKIN_DAYS);
  const alreadySoon = daysBetween(today, patient.nextCheckin) >= 0 && daysBetween(soonDate, patient.nextCheckin) <= 0;

  async function run(key: string, action: () => Promise<unknown>, message: string | undefined, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await onChanged(message);
    } catch (e) {
      setError(errorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      icon={<BellRing />}
      title="Open alerts"
      action={alerts.length > 0 ? <Badge tone="warning">{alerts.length} open</Badge> : undefined}
    >
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-lg text-text-muted">
          <CircleCheck className="h-5 w-5 text-success" aria-hidden />
          No open alerts.
        </p>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a) => {
            const tone = ALERT_TONE[a.type];
            return (
              <li
                key={a.id}
                className={cx(
                  'flex flex-wrap items-start justify-between gap-3 rounded-control border border-l-4 px-4 py-3',
                  tone === 'danger' ? 'border-danger/50 bg-danger-soft' : 'border-warning/50 bg-warning-soft',
                )}
              >
                <div className="min-w-0 flex-1 basis-72">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone}>{ALERT_LABELS[a.type]}</Badge>
                    <span className="text-sm text-text-muted">{shortDateTime(a.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-base text-text">{a.detail}</p>
                  {a.type === 'setback' && alreadySoon && (
                    <p className="mt-1 text-sm text-text-muted">
                      Check-in is already {relativeDays(daysBetween(today, patient.nextCheckin))} ({formatDay(patient.nextCheckin)}).
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {a.type === 'setback' && !alreadySoon && (
                    <Button
                      icon={<CalendarClock />}
                      loading={busy === `move-${a.id}`}
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `move-${a.id}`,
                          () => setNextCheckin(patient.id, soonDate),
                          `Next check-in moved to ${formatDay(soonDate)} (in ${SETBACK_CHECKIN_DAYS} days).`,
                          'Could not move the check-in',
                        )
                      }
                    >
                      Move check-in to in {SETBACK_CHECKIN_DAYS} days
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    icon={<Check />}
                    loading={busy === a.id}
                    disabled={busy !== null}
                    onClick={() => run(a.id, () => acknowledgeAlert(a.id), undefined, 'Could not acknowledge the alert')}
                  >
                    Acknowledge
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className={cx(ERROR_CLASS, 'text-base')}>
          {error}
        </p>
      )}
    </Card>
  );
}
