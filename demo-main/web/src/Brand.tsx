/**
 * Shared brand: the name, team line and logo mark used in both the care and patient headers and the
 * landing page. Colours come from the design tokens (bg-primary / text-primary-ink).
 */
import { cx } from './ui/cx';

export const BRAND_NAME = 'RehabTrack';
export const TEAM_LINE = 'by Ctrl+Alt+Heal';

/** Square logo mark (the Ctrl+Alt+Heal logo, public/logo.png); pass sizing classes to change its size. */
export function BrandMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <img src="/logo.png" alt="" aria-hidden className={cx('shrink-0 rounded-xl object-cover', className)} />
  );
}

/** Mark + name (+ optional area label), for headers. */
export function BrandLockup({ area, compact = false, className }: { area?: string; compact?: boolean; className?: string }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <BrandMark className={compact ? 'h-9 w-9' : 'h-10 w-10'} />
      <span className={cx('font-brand text-xl font-bold tracking-tight text-text', compact && 'hidden sm:inline')}>{BRAND_NAME}</span>
      {area && <span className="hidden text-base font-medium text-text-muted sm:inline">{area}</span>}
    </span>
  );
}
