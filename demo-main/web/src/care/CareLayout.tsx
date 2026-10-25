import { useEffect } from 'react';
import { Link, Outlet, useMatch } from 'react-router-dom';
import { BRAND_NAME, BrandLockup, TEAM_LINE } from '../Brand';
import { DataModeBadge, SupabaseHealthBanner, ThemeToggle } from '../ui';
import { SignOutButton } from '../ui/SignOutButton';
import { useRulesSweep } from './useRulesSweep';

/** Care-team area shell: header (brand, data mode, theme, sign out) + page + footer with the team line. */
export default function CareLayout() {
  // From a patient's detail page, the patient-app link opens the app as that patient; elsewhere, the picker.
  const detailMatch = useMatch('/care/patients/:id/*');
  const patientAppLink = detailMatch?.params.id ? `/patient?as=${detailMatch.params.id}` : '/patient?pick=1';

  useRulesSweep();

  useEffect(() => {
    document.title = `${BRAND_NAME} · Care team`;
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
          <div className="flex items-center gap-3">
            <Link to="/care" className="rounded-control no-underline">
              <BrandLockup area="Care team" />
            </Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <DataModeBadge className="hidden sm:inline-flex" />
            <Link
              to={patientAppLink}
              className="inline-flex min-h-tap items-center rounded-control px-2 text-sm font-semibold text-primary underline-offset-2 hover:underline"
              title="Open the patient app as this patient (demo, no login)"
            >
              Patient app
            </Link>
            <ThemeToggle area="care" />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        <SupabaseHealthBanner className="mb-6" />
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-text-muted">
          <DataModeBadge className="sm:hidden" />
          <span>
            {BRAND_NAME} {TEAM_LINE} · Demo data, not for clinical use
          </span>
          <span>Every plan change needs clinician approval.</span>
        </div>
      </footer>
    </div>
  );
}
