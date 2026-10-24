import { History, LayoutDashboard, MessageSquare, Phone, Settings, TriangleAlert, Volume2, VolumeX, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BRAND_NAME, BrandMark } from '../../Brand';
import { firstName } from '../api';
import { DemoPanel } from '../demo';
import { usePatientData } from '../PatientData';
import { speak, useMuted } from '../voice/useVoice';

const NAV = [
  { to: '/patient', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, end: true },
  { to: '/patient/sessions', label: 'Sessions', short: 'Sessions', icon: History },
  { to: '/patient/messages', label: 'Messages', short: 'Messages', icon: MessageSquare },
  { to: '/patient/settings', label: 'Settings', short: 'Settings', icon: Settings },
];

const TITLES: Record<string, [string, string]> = {
  '/patient/sessions': ['Sessions', 'Every exercise session you have done'],
  '/patient/messages': ['Messages', 'Talk with your care team'],
  '/patient/settings': ['Settings', 'Your details and your physicians'],
  '/patient/checkin': ["Today's session", 'Quick check-in'],
  '/patient/session': ["Today's session", 'Follow the coach, then the camera'],
  '/patient/summary': ["Today's session", 'Session complete'],
  '/patient/stop': ["Today's session", 'Time to rest'],
};

/** Website shell: sidebar navigation, top bar with greeting and profile, and the always-visible 911 button. */
export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [showSigns, setShowSigns] = useState(false);
  const { patient, connectionError } = usePatientData();
  const [title, subtitle] = TITLES[pathname] ?? [`Hello, ${firstName(patient.name)}!`, "Here's how your recovery is going."];

  const openSigns = () => {
    setShowSigns(true);
    speak('Stroke warning signs. Face drooping, arm weakness, or speech difficulty. Call 9 1 1 now.');
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900 p-5 lg:flex">
        <Logo />
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <button
          onClick={openSigns}
          className="mt-auto flex min-h-[56px] items-center gap-3 rounded-xl border border-red-800 bg-red-950 px-4 text-left text-base font-semibold text-red-200"
        >
          <TriangleAlert className="h-5 w-5 shrink-0" />
          Stroke warning signs
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-4 border-b border-neutral-800 px-4 py-4 sm:px-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
            <p className="text-lg text-neutral-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <VoiceToggle />
            <button
              onClick={openSigns}
              className="flex min-h-[48px] items-center gap-2 rounded-xl bg-red-700 px-4 text-base font-semibold text-white"
            >
              <Phone className="h-5 w-5" /> Call 911
            </button>
            <div className="hidden items-center gap-3 border-l border-neutral-800 pl-4 sm:flex">
              <Initials name={patient.name} />
              <div className="leading-tight">
                <div className="text-lg font-semibold">{patient.name}</div>
                <div className="text-sm text-neutral-400">Patient</div>
              </div>
            </div>
          </div>
        </header>

        {/* Narrow screens: the sidebar becomes a tab bar fixed to the bottom, every item visible. */}
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-neutral-800 bg-neutral-900 px-1 pb-[env(safe-area-inset-bottom)] pt-1 lg:hidden"
        >
          {NAV.map((n) => (
            <TabItem key={n.to} {...n} />
          ))}
        </nav>

        {/* Bottom padding on narrow screens keeps content clear of the fixed tab bar. */}
        <main className="w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-8 lg:pb-6">
          {connectionError && (
            <p className="mb-4 rounded-xl border border-amber-700 bg-amber-950 px-4 py-3 text-lg text-amber-100">
              Can't reach your care team right now. Retrying…
            </p>
          )}
          {children}
          <DemoPanel />
        </main>
      </div>

      {showSigns && <WarningSigns onClose={() => setShowSigns(false)} />}
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <BrandMark />
      <span className="font-brand text-xl font-semibold">{BRAND_NAME}</span>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-[52px] shrink-0 items-center gap-3 rounded-xl px-4 text-lg font-medium transition-colors ${
          isActive ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-300 hover:bg-neutral-800'
        }`
      }
    >
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}

/** One bottom-bar tab: icon over a short label, same active colours as the sidebar. */
function TabItem({ to, short, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-[64px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-sm font-medium transition-colors ${
          isActive ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-300 hover:bg-neutral-800'
        }`
      }
    >
      <Icon className="h-6 w-6" />
      {short}
    </NavLink>
  );
}

function VoiceToggle() {
  const [muted, setMuted] = useMuted();
  return (
    <button
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      title={muted ? 'Voice off' : 'Voice on'}
      className="flex min-h-[48px] items-center gap-2 rounded-xl border border-neutral-700 px-4 text-base font-medium"
    >
      {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      <span className="hidden sm:inline">{muted ? 'Voice off' : 'Voice on'}</span>
    </button>
  );
}

export function Initials({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const letters = name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-neutral-700 font-semibold text-neutral-50 ${
        size === 'lg' ? 'h-16 w-16 text-2xl' : 'h-11 w-11 text-lg'
      }`}
    >
      {letters}
    </span>
  );
}

function WarningSigns({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-6">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-12 w-12 items-center justify-center rounded-xl hover:bg-neutral-800">
          <X className="h-6 w-6" />
        </button>
        <h2 className="pr-12 text-2xl font-semibold text-red-300">Call 911 right away if you notice:</h2>
        <ul className="mt-4 space-y-3 text-xl">
          <li><b>Face</b> drooping on one side</li>
          <li><b>Arm</b> suddenly weak or numb</li>
          <li><b>Speech</b> slurred or hard to understand</li>
        </ul>
        <p className="mt-4 text-lg">Note the time it started. Do not wait to see if it goes away.</p>
        <p className="mt-1 text-base text-neutral-400">This app cannot detect a stroke.</p>
        <a href="tel:911" className="mt-5 flex min-h-[64px] items-center justify-center gap-2 rounded-xl bg-red-700 text-xl font-semibold text-white">
          <Phone className="h-6 w-6" /> Call 911
        </a>
      </div>
    </div>
  );
}

/** A dashboard panel. */
export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-xl font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function BigButton({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  disabled?: boolean;
}) {
  const styles = {
    primary: 'bg-neutral-100 text-neutral-950 hover:bg-white',
    secondary: 'border border-neutral-600 bg-neutral-900 text-neutral-50 hover:bg-neutral-800',
    danger: 'bg-red-700 text-white hover:bg-red-600',
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[60px] items-center justify-center gap-2 rounded-xl px-6 text-xl font-semibold transition-colors disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}
