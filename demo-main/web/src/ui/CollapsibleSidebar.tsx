// Collapsible sidebar helpers: remembered open/closed state and the toggle button.
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from './cx';

/** [collapsed, toggle]. Remembered per key; `defaultCollapsed` applies when the user hasn't chosen. */
export function useCollapsedSidebar(key: string, defaultCollapsed = false): [boolean, () => void] {
  const read = () => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? defaultCollapsed : v === '1';
    } catch {
      return defaultCollapsed;
    }
  };
  const [collapsed, setCollapsed] = useState(read);
  // Re-apply the default when the page changes (e.g. collapse on the live session page).
  useEffect(() => setCollapsed(read()), [defaultCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(key, c ? '0' : '1');
      } catch {
        // not remembered
      }
      return !c;
    });
  return [collapsed, toggle];
}

export function SidebarToggle({ collapsed, onToggle, className }: { collapsed: boolean; onToggle: () => void; className?: string }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={cx(
        'mt-auto flex min-h-tap items-center gap-3 rounded-control text-base font-semibold text-text-muted hover:bg-text/[0.06] hover:text-text',
        collapsed ? 'justify-center' : 'px-4',
        className,
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
      {!collapsed && 'Collapse'}
    </button>
  );
}
