import { Moon, Sun } from 'lucide-react';
import { Button } from './Button';
import { useTheme, type Area } from './theme';

export interface ThemeToggleProps {
  /** Which area's theme to switch (default: the area of the current route). */
  area?: Area;
  /** Show the text label next to the icon (default: from the sm breakpoint up). */
  label?: 'always' | 'responsive' | 'never';
  className?: string;
}

/** Light/dark switch for one area; remembered per area in localStorage. ≥ var(--tap) tall. */
export function ThemeToggle({ area, label = 'responsive', className }: ThemeToggleProps) {
  const { theme, toggle } = useTheme(area);
  const next = theme === 'dark' ? 'light' : 'dark';
  const text = next === 'light' ? 'Light' : 'Dark';
  return (
    <Button
      variant="secondary"
      onClick={toggle}
      icon={next === 'light' ? <Sun /> : <Moon />}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={className}
    >
      {label === 'never' ? undefined : <span className={label === 'responsive' ? 'hidden sm:inline' : undefined}>{text}</span>}
    </Button>
  );
}
