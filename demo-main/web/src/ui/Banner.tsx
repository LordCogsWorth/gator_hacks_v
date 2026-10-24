import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  tone: BannerTone;
  title: ReactNode;
  children?: ReactNode;
  /** Right side (wraps below on narrow screens): usually a <Button>. */
  action?: ReactNode;
  /** Override the tone icon, or `false` for none. */
  icon?: ReactNode | false;
  /** Shows a close (X) button. */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

const STYLES: Record<BannerTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'border-info/50 bg-info-soft', icon: 'text-info', Icon: Info },
  success: { box: 'border-success/50 bg-success-soft', icon: 'text-success', Icon: CircleCheck },
  warning: { box: 'border-warning/60 bg-warning-soft', icon: 'text-warning', Icon: TriangleAlert },
  danger: { box: 'border-danger/60 bg-danger-soft', icon: 'text-danger', Icon: CircleAlert },
};

/**
 * A message strip. role="alert" for danger (announced immediately), role="status" otherwise.
 * Text is always --text on the tone's soft background (contrast ≥ 4.5:1 in both themes);
 * the tone shows in the border and icon.
 *
 *   <Banner tone="success" title="New plan from your care team" action={<Button onClick={ok}>OK</Button>} />
 */
export function Banner({ tone, title, children, action, icon, onDismiss, dismissLabel = 'Dismiss', className }: BannerProps) {
  const s = STYLES[tone];
  const iconNode = icon === false ? null : (icon ?? <s.Icon />);
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-l-4 px-4 py-3 text-text sm:px-5 sm:py-4', s.box, className)}
    >
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
        {iconNode && <span className={cx('mt-0.5 shrink-0 [&_svg]:h-6 [&_svg]:w-6', s.icon)} aria-hidden>{iconNode}</span>}
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-snug">{title}</div>
          {children !== undefined && <div className="mt-0.5 text-base">{children}</div>}
        </div>
      </div>
      {(action !== undefined || onDismiss) && (
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={dismissLabel}
              className="flex min-h-tap min-w-tap items-center justify-center rounded-control text-text hover:bg-text/[0.06]"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
