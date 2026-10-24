import type { ReactNode } from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Leading icon (tone-coloured). Without one, a tone-coloured dot is shown (`dot={false}` hides it). */
  icon?: ReactNode;
  dot?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
}

const TONES: Record<BadgeTone, { box: string; dot: string; icon: string }> = {
  neutral: { box: 'border-border bg-surface-2', dot: 'bg-text-muted', icon: 'text-text-muted' },
  primary: { box: 'border-primary/40 bg-primary-soft', dot: 'bg-primary', icon: 'text-primary' },
  info: { box: 'border-info/40 bg-info-soft', dot: 'bg-info', icon: 'text-info' },
  success: { box: 'border-success/40 bg-success-soft', dot: 'bg-success', icon: 'text-success' },
  warning: { box: 'border-warning/50 bg-warning-soft', dot: 'bg-warning', icon: 'text-warning' },
  danger: { box: 'border-danger/50 bg-danger-soft', dot: 'bg-danger', icon: 'text-danger' },
};

/**
 * Small label / chip. Text is always --text (readable in both themes); the tone shows in the
 * background, border and dot/icon, so colour is never the only signal — say it in the text too.
 *
 *   <Badge tone="danger">Setback</Badge>   <Badge tone="success" icon={<Cloud />}>Live · Supabase</Badge>
 */
export function Badge({ tone = 'neutral', children, icon, dot = true, size = 'md', title, className }: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-tight text-text',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        t.box,
        className,
      )}
    >
      {icon ? (
        <span className={cx('shrink-0 [&_svg]:h-4 [&_svg]:w-4', t.icon)} aria-hidden>
          {icon}
        </span>
      ) : (
        dot && <span className={cx('h-2 w-2 shrink-0 rounded-full', t.dot)} aria-hidden />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
