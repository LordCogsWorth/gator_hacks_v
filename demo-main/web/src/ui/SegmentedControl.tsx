import type { ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Arm". */
  label: string;
  fullWidth?: boolean;
  className?: string;
}

/**
 * A row of mutually exclusive toggle buttons (aria-pressed), e.g. Healthy | Weak | Both, or exercise tabs.
 * Each segment is ≥ var(--tap) tall.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, fullWidth = false, className }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex gap-1 rounded-control border border-border bg-surface-2 p-1', fullWidth && 'flex w-full', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex min-h-tap items-center justify-center gap-2 rounded-[calc(var(--radius-control)-0.25rem)] px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-5 [&_svg]:w-5',
              fullWidth && 'flex-1',
              active ? 'bg-surface text-text shadow-card ring-1 ring-inset ring-primary/40' : 'text-text-muted hover:bg-text/[0.06] hover:text-text',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
