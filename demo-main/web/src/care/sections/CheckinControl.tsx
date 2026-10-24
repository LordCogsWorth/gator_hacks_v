import { CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { setNextCheckin } from '../../api';
import type { Patient } from '../../types';
import { Button, ERROR_CLASS, cx } from '../../ui';
import { addDays, daysBetween, formatDay, isValidCheckin, MAX_CHECKIN_DAYS, relativeDays, shiftCheckin, todayISO } from '../dates';
import { errorMessage } from '../errors';

const DATE_INPUT =
  'min-h-tap rounded-control border border-text-muted/40 bg-surface px-3 text-base tabular-nums text-text ' +
  'hover:border-text-muted/70 focus-visible:border-focus disabled:opacity-50';

/** "Next check-in" with a date picker and −3 / +7 day shortcuts (→ api.setNextCheckin). */
export function CheckinControl({ patient, onMoved }: { patient: Patient; onMoved: (message: string) => void | Promise<void> }) {
  const today = todayISO();
  const current = patient.nextCheckin;
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState<'earlier' | 'later' | 'pick' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(current), [current]);

  const earlier = shiftCheckin(current, -3, today);
  const later = shiftCheckin(current, 7, today);
  const days = daysBetween(today, current);
  const draftValid = isValidCheckin(draft, today);

  async function move(date: string, which: 'earlier' | 'later' | 'pick') {
    setBusy(which);
    setError(null);
    try {
      await setNextCheckin(patient.id, date);
      await onMoved(`Next check-in moved to ${formatDay(date)} (${relativeDays(daysBetween(todayISO(), date))}).`);
    } catch (e) {
      setError(errorMessage(e, 'Could not move the check-in'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden />
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-text-muted">Next check-in</div>
          <div className="font-display text-xl font-semibold text-text">{formatDay(current)}</div>
          <div className={cx('text-base', days < 0 ? 'font-semibold text-danger' : 'text-text-muted')}>
            {days < 0 ? `Overdue · ${relativeDays(days)}` : relativeDays(days)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          loading={busy === 'earlier'}
          disabled={busy !== null || earlier === current}
          onClick={() => move(earlier, 'earlier')}
          title={`Move to ${formatDay(earlier)}`}
        >
          −3 days
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'later'}
          disabled={busy !== null || later === current}
          onClick={() => move(later, 'later')}
          title={`Move to ${formatDay(later)}`}
        >
          +7 days
        </Button>
        <form
          className="flex items-center gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (draftValid && draft !== current) void move(draft, 'pick');
          }}
        >
          <input
            type="date"
            aria-label="Pick a check-in date"
            className={DATE_INPUT}
            min={today}
            max={addDays(today, MAX_CHECKIN_DAYS)}
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
          />
          {draft !== current && (
            <Button type="submit" loading={busy === 'pick'} disabled={busy !== null || !draftValid}>
              Move
            </Button>
          )}
        </form>
      </div>
      {draft !== current && !draftValid && <p className={ERROR_CLASS}>Pick a date between today and {MAX_CHECKIN_DAYS} days from now.</p>}
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </div>
  );
}
