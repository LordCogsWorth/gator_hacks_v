/**
 * Landing page at "/": pick the patient app or the care-team dashboard. Uses the care theme.
 * Shows which data source this window uses and, in offline (local) mode, "Reset demo data".
 */
import { ArrowRight, HeartPulse, RotateCcw, Stethoscope } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, dataMode, resetDemoData } from './api';
import { BRAND_NAME, BrandLockup, TEAM_LINE } from './Brand';
import { Banner } from './ui/Banner';
import { Button, buttonClass } from './ui/Button';
import { cx } from './ui/cx';
import { DataModeBadge } from './ui/DataModeBadge';
import { SupabaseHealthBanner } from './ui/SupabaseHealthBanner';
import { ThemeToggle } from './ui/ThemeToggle';

type ResetState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string };

export default function Home() {
  const [reset, setReset] = useState<ResetState>({ kind: 'idle' });
  const local = dataMode() === 'local';

  useEffect(() => {
    document.title = `${BRAND_NAME} · Home arm rehab after stroke`;
  }, []);

  const onReset = async () => {
    setReset({ kind: 'busy' });
    try {
      await resetDemoData();
      setReset({ kind: 'done' });
    } catch (e) {
      setReset({ kind: 'error', message: e instanceof ApiError || e instanceof Error ? e.message : 'Reset failed' });
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <BrandLockup />
          <ThemeToggle area="care" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-16">
        <div className="max-w-2xl">
          <p className="text-base font-semibold uppercase tracking-wide text-primary">Stroke rehab between clinic visits</p>
          <h1 className="mt-2 font-display text-4xl font-bold text-text sm:text-5xl">Arm exercises at home, with the care team in the loop.</h1>
          <p className="mt-4 text-xl text-text-muted">
            Patients follow a short daily session with camera coaching and voice. Therapists see the trend, get alerts and approve the next plan.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <AreaCard
            to="/patient"
            icon={<HeartPulse />}
            title="I'm a patient"
            text="Today's exercises, one big Start button, voice guidance and your progress."
            cta="Open the patient app"
          />
          <AreaCard
            to="/care"
            icon={<Stethoscope />}
            title="Care team"
            text="Patient list, symmetry and watch trends, alerts, 3D session replays and plan approvals."
            cta="Open the care dashboard"
          />
        </div>

        <SupabaseHealthBanner className="mt-8" />
        {reset.kind === 'done' && (
          <Banner tone="success" title="Demo data reset" className="mt-8">
            Every patient is back to the seeded three weeks of data.
          </Banner>
        )}
        {reset.kind === 'error' && (
          <Banner tone="info" title="Couldn't reset the demo data" className="mt-8" onDismiss={() => setReset({ kind: 'idle' })}>
            {reset.message}
          </Banner>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <DataModeBadge />
            {local && (
              <Button variant="ghost" icon={<RotateCcw />} loading={reset.kind === 'busy'} onClick={onReset}>
                Reset demo data
              </Button>
            )}
          </div>
          <p className="text-base text-text-muted">
            {BRAND_NAME} {TEAM_LINE} · Demo with made-up patients, not for clinical use.
          </p>
        </div>
      </footer>
    </div>
  );
}

function AreaCard({ to, icon, title, text, cta }: { to: string; icon: ReactNode; title: string; text: string; cta: string }) {
  return (
    <Link
      to={to}
      className={cx(
        'group flex min-h-64 flex-col rounded-card border border-border bg-surface p-6 text-text no-underline shadow-card transition-shadow sm:p-8',
        'hover:border-primary/50 hover:shadow-raised',
      )}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-control bg-primary-soft text-primary [&_svg]:h-7 [&_svg]:w-7" aria-hidden>
        {icon}
      </span>
      <h2 className="mt-5 font-display text-3xl font-semibold">{title}</h2>
      <p className="mt-2 flex-1 text-lg text-text-muted">{text}</p>
      <span className={cx(buttonClass('primary', 'xl'), 'mt-6 self-start group-hover:bg-primary-hover')} aria-hidden>
        {cta}
        <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
