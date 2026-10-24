import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type CardTone = 'default' | 'primary' | 'warning' | 'danger';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Header title (h2 by default). */
  title?: ReactNode;
  /** Smaller line under the title. */
  subtitle?: ReactNode;
  /** Header right side: buttons, links, badges. */
  action?: ReactNode;
  /** Small icon before the title. */
  icon?: ReactNode;
  /** default = surface; primary = highlighted (hero); warning / danger = tinted with a tone border. */
  tone?: CardTone;
  /** 'md' (default) pads the body; 'none' lets tables / charts run edge to edge (header stays padded). */
  padding?: 'md' | 'none';
  /** Optional footer row, separated by a hairline. */
  footer?: ReactNode;
  titleAs?: 'h2' | 'h3';
  as?: 'section' | 'div' | 'article';
  children?: ReactNode;
}

const TONES: Record<CardTone, string> = {
  default: 'border-border bg-surface',
  primary: 'border-primary/40 bg-surface ring-1 ring-inset ring-primary/20',
  warning: 'border-warning/50 bg-warning-soft',
  danger: 'border-danger/50 bg-danger-soft',
};

/**
 * A panel. Header (title + subtitle + action) only renders when one of them is given.
 *
 *   <Card title="Today's session" action={<Badge tone="primary">Phase 2</Badge>}>…</Card>
 *   <Card title="Sessions" padding="none"><table>…</table></Card>
 */
export function Card({
  title,
  subtitle,
  action,
  icon,
  tone = 'default',
  padding = 'md',
  footer,
  titleAs: Title = 'h2',
  as: Tag = 'section',
  className,
  children,
  ...rest
}: CardProps) {
  const hasHeader = title !== undefined || subtitle !== undefined || action !== undefined;
  const pad = 'px-5 sm:px-6';
  return (
    <Tag className={cx('overflow-hidden rounded-card border shadow-card', TONES[tone], className)} {...rest}>
      {hasHeader && (
        <header className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pt-5 sm:pt-6', pad, padding === 'none' ? 'pb-4' : 'pb-0')}>
          <div className="min-w-0 flex-1">
            {title !== undefined && (
              <Title className="flex items-center gap-2 font-display text-lg font-semibold text-text [&_svg]:h-5 [&_svg]:w-5 [&_svg]:shrink-0">
                {icon}
                {title}
              </Title>
            )}
            {subtitle !== undefined && <p className="mt-0.5 text-base text-text-muted">{subtitle}</p>}
          </div>
          {action !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </header>
      )}
      {padding === 'md' ? <div className={cx(pad, hasHeader ? 'pb-5 pt-4 sm:pb-6' : 'py-5 sm:py-6')}>{children}</div> : children}
      {footer !== undefined && <footer className={cx('border-t border-border py-3', pad)}>{footer}</footer>}
    </Tag>
  );
}
