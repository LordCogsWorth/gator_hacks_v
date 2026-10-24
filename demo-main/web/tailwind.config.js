/**
 * Tailwind ← design tokens (src/ui/tokens.css). FROZEN after WP0: request changes via WP8.
 *
 * Colour class names mirror the token names exactly:
 *   bg-bg, bg-surface, bg-surface-2, border-border, text-text, text-text-muted,
 *   bg-primary text-primary-ink hover:bg-primary-hover bg-primary-soft,
 *   bg-danger text-danger-ink bg-danger-soft, text-warning bg-warning-soft,
 *   text-success bg-success-soft, text-info bg-info-soft, ring-focus,
 *   chart-1..3, chart-grid, chart-target, row-flash, bg-overlay/60.
 * All support alpha (bg-primary/10). A bare `border` uses --border; a bare `ring` uses --focus.
 * Tap targets: min-h-tap / min-w-tap / h-tap / w-tap = var(--tap) (44 px care, 64 px patient).
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'text',
  'text-muted',
  'primary',
  'primary-ink',
  'primary-hover',
  'primary-soft',
  'danger',
  'danger-ink',
  'danger-soft',
  'warning',
  'warning-soft',
  'success',
  'success-soft',
  'info',
  'info-soft',
  'focus',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-grid',
  'chart-target',
  'row-flash',
  'overlay',
  'shadow',
];

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(TOKENS.map((t) => [t, token(t)])),
      borderColor: { DEFAULT: token('border') },
      ringColor: { DEFAULT: token('focus') },
      ringOffsetColor: { DEFAULT: token('bg') },
      spacing: { tap: 'var(--tap)' },
      minHeight: { tap: 'var(--tap)' },
      minWidth: { tap: 'var(--tap)' },
      borderRadius: { card: 'var(--radius-card)', control: 'var(--radius-control)' },
      boxShadow: {
        card: '0 1px 2px 0 rgb(var(--shadow) / 0.06), 0 1px 3px 0 rgb(var(--shadow) / 0.08)',
        raised: '0 4px 12px -2px rgb(var(--shadow) / 0.12), 0 2px 4px -2px rgb(var(--shadow) / 0.08)',
        modal: '0 24px 48px -12px rgb(var(--shadow) / 0.35)',
      },
      fontFamily: {
        brand: ['"IBM Plex Sans"', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        sans: ['"Source Sans 3"', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
      keyframes: {
        'row-flash': {
          '0%, 40%': { backgroundColor: 'rgb(var(--row-flash))' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: { 'row-flash': 'row-flash 4s ease-out' },
    },
  },
  plugins: [],
};
