import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  /** Defaults to an inbox icon; `false` for none. */
  icon?: ReactNode | false;
  /** A button / link under the text. */
  action?: ReactNode;
  className?: string;
}

/** Placeholder for "nothing here yet" (no sessions, no alerts, coming soon). */
export function EmptyState({ title, children, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center rounded-card border border-dashed border-text-muted/40 bg-surface-2 px-6 py-10 text-center', className)}>
      {icon !== false && (
        <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary [&_svg]:h-7 [&_svg]:w-7" aria-hidden>
          {icon ?? <Inbox />}
        </span>
      )}
      <h2 className="font-display text-xl font-semibold text-text">{title}</h2>
      {children !== undefined && <div className="mt-2 max-w-prose text-base text-text-muted">{children}</div>}
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}
