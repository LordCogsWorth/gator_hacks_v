/**
 * Shared form-control classes (care-side editors; the patient path has no typing).
 *   <label className={LABEL_CLASS}>Reps<input className={INPUT_CLASS} type="number" /></label>
 */
export const INPUT_CLASS =
  'mt-1 block min-h-tap w-full rounded-control border border-text-muted/40 bg-surface px-3 text-base text-text tabular-nums ' +
  'placeholder:text-text-muted hover:border-text-muted/70 focus-visible:border-focus disabled:opacity-50';
export const LABEL_CLASS = 'block text-sm font-semibold text-text';
export const HINT_CLASS = 'mt-1 text-sm text-text-muted';
export const ERROR_CLASS = 'mt-1 text-sm font-semibold text-danger';
