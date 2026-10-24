import { Loader2 } from 'lucide-react';
import { cx } from './cx';

/** Inline loading spinner. With `label`, shows the text next to it (and announces it). */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)} role={label ? 'status' : undefined}>
      <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}
