import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, type To } from 'react-router-dom';
import { cx } from './cx';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right side: buttons, controls (wraps below the title on narrow screens). */
  actions?: ReactNode;
  /** Small line above the title (e.g. "Patient"). */
  eyebrow?: ReactNode;
  /** Back link above the title. */
  back?: { to: To; label: string };
  /** Extra row under the subtitle (badges, meta). */
  meta?: ReactNode;
  className?: string;
}

/** Page title block (the page's h1). */
export function PageHeader({ title, subtitle, actions, eyebrow, back, meta, className }: PageHeaderProps) {
  return (
    <div className={cx('mb-6', className)}>
      {back && (
        <Link
          to={back.to}
          className="-ml-2 mb-2 inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-base font-semibold text-primary no-underline hover:bg-primary/10"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {eyebrow !== undefined && <div className="text-sm font-semibold uppercase tracking-wide text-text-muted">{eyebrow}</div>}
          <h1 className="font-display text-3xl font-semibold text-text">{title}</h1>
          {subtitle !== undefined && <p className="mt-1 text-lg text-text-muted">{subtitle}</p>}
          {meta !== undefined && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions !== undefined && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}
