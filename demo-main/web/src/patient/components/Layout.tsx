// Patient shell: sidebar (bottom tab bar on phones) with Home and My sessions; header with the greeting,
// Voice, Theme and the always-visible 911 bar; footer with the data-source badge and the team line.
import { History, LayoutDashboard, Volume2, VolumeX } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BRAND_NAME, BrandLockup, BrandMark, TEAM_LINE } from '../../Brand';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { SidebarToggle, useCollapsedSidebar } from '../../ui/CollapsibleSidebar';
import { DataModeBadge } from '../../ui/DataModeBadge';
import { EmergencyBar, WARNING_SIGNS_SPEECH } from '../../ui/EmergencyBar';
import { SupabaseHealthBanner } from '../../ui/SupabaseHealthBanner';
import { ThemeToggle } from '../../ui/ThemeToggle';
import { firstName } from '../api';
import { DemoPanel } from '../demo';
import { usePatientData } from '../PatientData';
import { speak, useMuted } from '../voice/useVoice';

const NAV = [
  { to: '/patient', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/patient/sessions', label: 'My sessions', icon: History },
];

const TITLES: Record<string, [string, string]> = {
  '/patient/sessions': ['My sessions', 'Every exercise session you have done'],
  '/patient/checkin': ["Today's session", 'Quick check-in'],
  '/patient/session': ["Today's session", 'Follow the coach, then the camera'],
  '/patient/summary': ["Today's session", 'Session complete'],
  '/patient/stop': ["Today's session", 'Time to rest'],
};

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { patient, connectionError } = usePatientData();
  const [title, subtitle] = TITLES[pathname] ?? [`Hello, ${firstName(patient.name)}!`, "Here's how your recovery is going."];
  const [collapsed, toggleSidebar] = useCollapsedSidebar('rehabtrack.patientSidebar', pathname === '/patient/session');

  return (
    <div className="min-h-screen bg-bg text-text lg:flex">
      <aside
        className={cx(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface transition-[width] lg:flex',
          collapsed ? 'w-20 p-3' : 'w-64 p-5',
        )}
      >
        {collapsed ? <BrandMark /> : <BrandLockup />}
        <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} collapsed={collapsed} />
          ))}
        </nav>
        <SidebarToggle collapsed={collapsed} onToggle={toggleSidebar} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-surface px-2 py-2 sm:px-8 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-4">
            {/* Phones skip the logo so voice, theme and the 911 bar fit on one row. */}
            <div className="hidden sm:block lg:hidden">
              <BrandLockup compact />
            </div>
            <div className="hidden min-w-[16rem] flex-1 sm:block">
              <h1 className="truncate text-3xl font-semibold">{title}</h1>
              <p className="text-lg text-text-muted">{subtitle}</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
              <VoiceToggle />
              <ThemeToggle area="patient" />
              <EmergencyBar onSignsOpen={() => speak(WARNING_SIGNS_SPEECH)} />
            </div>
          </div>
          {/* Phones: the title gets its own row under the controls. */}
          <h1 className="mt-1 truncate px-1 text-xl font-semibold sm:hidden">{title}</h1>
        </header>

        {/* Narrow screens: the sidebar becomes a tab bar fixed to the bottom. */}
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-border bg-surface px-1 pb-[env(safe-area-inset-bottom)] pt-1 lg:hidden"
        >
          {NAV.map((n) => (
            <TabItem key={n.to} {...n} />
          ))}
        </nav>

        <main className={cx('w-full flex-1 px-4 pb-6 pt-4 sm:px-8 sm:pt-6', !collapsed && 'max-w-7xl')}>
          <SupabaseHealthBanner className="mb-4" />
          {connectionError && (
            <p className="mb-4 rounded-card border border-warning/60 bg-warning-soft px-4 py-3 text-lg text-text" role="status">
              Can't reach your care team right now. Retrying…
            </p>
          )}
          {children}
        </main>

        {/* Bottom padding on narrow screens keeps the footer clear of the fixed tab bar. */}
        <footer className="flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 pb-28 pt-4 text-base text-text-muted sm:px-8 lg:pb-6">
          <DataModeBadge />
          <span>
            {BRAND_NAME} {TEAM_LINE}
          </span>
        </footer>
      </div>

      <DemoPanel />
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end, collapsed }: (typeof NAV)[number] & { collapsed?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cx(
          'flex min-h-tap shrink-0 items-center gap-3 rounded-control text-lg font-semibold no-underline transition-colors',
          collapsed ? 'justify-center px-0' : 'px-4',
          isActive ? 'bg-primary-soft text-text ring-1 ring-inset ring-primary/40' : 'text-text-muted hover:bg-text/[0.06] hover:text-text',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden />
      {!collapsed && label}
    </NavLink>
  );
}

/** One bottom-bar tab: icon over a short label, same active colours as the sidebar. */
function TabItem({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          'flex min-h-tap min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-control text-sm font-semibold no-underline transition-colors',
          isActive ? 'bg-primary-soft text-text' : 'text-text-muted hover:bg-text/[0.06]',
        )
      }
    >
      <Icon className="h-6 w-6" aria-hidden />
      {label}
    </NavLink>
  );
}

function VoiceToggle() {
  const [muted, setMuted] = useMuted();
  return (
    <Button
      variant="secondary"
      onClick={() => setMuted(!muted)}
      aria-label={muted ? 'Voice off, tap to turn the voice on' : 'Voice on, tap to turn the voice off'}
      title={muted ? 'Voice off' : 'Voice on'}
      icon={muted ? <VolumeX /> : <Volume2 />}
      className="px-3 sm:px-4"
    >
      <span className="hidden sm:inline">{muted ? 'Voice off' : 'Voice on'}</span>
    </Button>
  );
}

