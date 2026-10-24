import type { ReactNode } from 'react';
import type { Trend } from '../types';
import { cx } from './cx';

export interface StatDelta {
  /** Signed change, e.g. +6 or -3. 0 shows "No change". */
  value: number;
  /** Which direction is good news (decides green vs red; the glyph always shows direction). */
  goodWhen: 'up' | 'down';
  /** Text after the number, e.g. "from last week". */
  label?: string;
  /** Unit after the number, e.g. "%", " pts", "°". */
  unit?: string;
  /** Decimal places (default 0). */
  precision?: number;
}

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: StatDelta;
  /** Glyph-only trend when there is no number (e.g. patient list). Ignored when `delta` is set. */
  trend?: { direction: Trend; goodWhen?: 'up' | 'down'; label?: string };
  /** Small muted line at the bottom. */
  hint?: ReactNode;
  /** Icon in a soft square, left of the value. */
  icon?: ReactNode;
  tone?: 'default' | 'primary' | 'warning' | 'danger';
  className?: string;
}

const TONE_RING: Record<NonNullable<StatTileProps['tone']>, string> = {
  default: 'border-border',
  primary: 'border-primary/50',
  warning: 'border-warning/60',
  danger: 'border-danger/60',
};

const ICON_BG: Record<NonNullable<StatTileProps['tone']>, string> = {
  default: 'bg-primary-soft text-primary',
  primary: 'bg-primary-soft text-primary',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

function goodness(direction: 'up' | 'down' | 'flat', goodWhen: 'up' | 'down'): 'good' | 'bad' | 'neutral' {
  if (direction === 'flat') return 'neutral';
  return direction === goodWhen ? 'good' : 'bad';
}

const GOODNESS_TEXT = { good: 'text-success', bad: 'text-danger', neutral: 'text-text-muted' } as const;
const GLYPH = { up: '▲', down: '▼', flat: '▬' } as const;
const SR_WORD = { up: 'Up', down: 'Down', flat: 'No change' } as const;

/** "▲ 6 from last week" — glyph + text, coloured by good/bad. Usable on its own (tables). */
export function Delta({ value, goodWhen, label, unit = '', precision = 0, className }: StatDelta & { className?: string }) {
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const magnitude = Math.abs(value).toFixed(precision);
  return (
    <span className={cx('inline-flex items-baseline gap-1 font-semibold tabular-nums', GOODNESS_TEXT[goodness(direction, goodWhen)], className)}>
      <span aria-hidden>{GLYPH[direction]}</span>
      <span className="sr-only">{SR_WORD[direction]}</span>
      <span>
        {direction === 'flat' ? 'No change' : `${magnitude}${unit}`}
        {label ? ` ${label}` : ''}
      </span>
    </span>
  );
}

const TREND_WORD: Record<Trend, string> = { up: 'Improving', down: 'Declining', flat: 'Steady', none: 'Not enough data' };

/** Trend glyph + word ("▲ Improving"). `none` renders a muted dash. */
export function TrendIndicator({ direction, goodWhen = 'up', label, className }: { direction: Trend; goodWhen?: 'up' | 'down'; label?: string; className?: string }) {
  if (direction === 'none') {
    return <span className={cx('text-text-muted', className)}>{label ?? '—'}</span>;
  }
  return (
    <span className={cx('inline-flex items-baseline gap-1 font-semibold', GOODNESS_TEXT[goodness(direction, goodWhen)], className)}>
      <span aria-hidden>{GLYPH[direction]}</span>
      <span>{label ?? TREND_WORD[direction]}</span>
    </span>
  );
}

/**
 * One number with its label.
 *
 *   <StatTile label="Weak arm vs healthy" value={64} unit="%" delta={{ value: 6, goodWhen: 'up', label: 'from last week' }} />
 */
export function StatTile({ label, value, unit, delta, trend, hint, icon, tone = 'default', className }: StatTileProps) {
  return (
    <div className={cx('flex items-start gap-4 rounded-card border bg-surface p-5 shadow-card', TONE_RING[tone], className)}>
      {icon && (
        <span className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-control [&_svg]:h-6 [&_svg]:w-6', ICON_BG[tone])} aria-hidden>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-base font-medium text-text-muted">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1 font-display text-3xl font-semibold tabular-nums text-text">
          <span>{value}</span>
          {unit !== undefined && <span className="text-xl font-semibold text-text-muted">{unit}</span>}
        </div>
        {delta ? (
          <div className="mt-1 text-base">
            <Delta {...delta} />
          </div>
        ) : trend ? (
          <div className="mt-1 text-base">
            <TrendIndicator {...trend} />
          </div>
        ) : null}
        {hint !== undefined && <div className="mt-1 text-sm text-text-muted">{hint}</div>}
      </div>
    </div>
  );
}
