import { forwardRef, type ButtonHTMLAttributes, type MouseEventHandler, type ReactNode, type Ref } from 'react';
import { Link, type To } from 'react-router-dom';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** md: ≥ var(--tap) (44 px care, 64 px patient). xl: ≥ 64 px, text-xl (patient hero actions). */
export type ButtonSize = 'md' | 'xl';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, e.g. <Play />. Sized automatically. Replaced by a spinner while loading. */
  icon?: ReactNode;
  /** Trailing icon, e.g. <ChevronRight />. */
  iconRight?: ReactNode;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Render as a react-router <Link> to this route. */
  to?: To;
  /** Render as a plain <a href> (tel:, mailto:, external). */
  href?: string;
  /** For `to` links: replace the history entry. */
  replace?: boolean;
  /** For `href` links. */
  target?: string;
  rel?: string;
  children?: ReactNode;
}

const BASE =
  'inline-flex select-none items-center justify-center rounded-control font-semibold leading-tight no-underline transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-ink shadow-card hover:bg-primary-hover',
  secondary: 'border border-text-muted/40 bg-surface text-text hover:border-text-muted/70 hover:bg-surface-2',
  ghost: 'bg-transparent text-text hover:bg-text/[0.06]',
  danger: 'bg-danger text-danger-ink shadow-card hover:bg-danger/90',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'min-h-tap min-w-tap gap-2 px-4 py-2 text-base [&_svg]:h-5 [&_svg]:w-5',
  xl: 'min-h-16 min-w-16 gap-3 px-6 py-3 text-xl [&_svg]:h-6 [&_svg]:w-6',
};

/** Class string for a button look, for the rare element that can't be a <Button>. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], extra);
}

/**
 * The one button. `to` → router link, `href` → anchor, otherwise <button type="button">.
 *
 *   <Button size="xl" icon={<Play />} onClick={start}>Start today's session</Button>
 *   <Button variant="secondary" to="/care">Care team</Button>
 *   <Button variant="danger" href="tel:911" icon={<Phone />}>Call 911</Button>
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    fullWidth = false,
    to,
    href,
    replace,
    target,
    rel,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const classes = cx(buttonClass(variant, size), fullWidth && 'w-full', className);
  const content = (
    <>
      {loading ? <Spinner /> : icon}
      {children !== undefined && children !== null && children !== false && <span className="inline-flex items-center gap-2">{children}</span>}
      {iconRight}
    </>
  );
  const isDisabled = disabled || loading;

  if (to !== undefined || href !== undefined) {
    // Links can't be disabled natively: aria-disabled + no pointer events + out of the tab order.
    const linkProps = {
      className: classes,
      'aria-disabled': isDisabled || undefined,
      'aria-busy': loading || undefined,
      tabIndex: isDisabled ? -1 : undefined,
      onClick: rest.onClick as MouseEventHandler<HTMLAnchorElement> | undefined,
      title: rest.title,
      id: rest.id,
      'aria-label': rest['aria-label'],
      'aria-describedby': rest['aria-describedby'],
      'aria-current': rest['aria-current'],
    };
    if (to !== undefined) {
      return (
        <Link ref={ref as Ref<HTMLAnchorElement>} to={to} replace={replace} {...linkProps}>
          {content}
        </Link>
      );
    }
    return (
      <a ref={ref as Ref<HTMLAnchorElement>} href={href} target={target} rel={rel ?? (target === '_blank' ? 'noreferrer' : undefined)} {...linkProps}>
        {content}
      </a>
    );
  }

  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type={type ?? 'button'}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
});
