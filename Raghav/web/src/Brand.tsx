/**
 * Shared brand: the name and logo mark used in both the care and patient headers.
 * Colour and font come from the `brand` tokens in tailwind.config.js.
 */
import { Activity } from 'lucide-react';

export const BRAND_NAME = 'RehabTrack';

/** Square logo mark; pass sizing classes to change its size. */
export function BrandMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink ${className}`} aria-hidden>
      <Activity className="h-3/5 w-3/5" />
    </span>
  );
}
