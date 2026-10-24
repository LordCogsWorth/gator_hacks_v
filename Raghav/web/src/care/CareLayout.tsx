import { useEffect } from 'react';
import { Link, Outlet, useMatch } from 'react-router-dom';
import { BRAND_NAME, BrandMark } from '../Brand';

/** Care-team area shell: light clinical header + page content. */
export default function CareLayout() {
  // From a patient's detail page, the patient-app link opens the app as that patient.
  const detailMatch = useMatch('/care/patients/:id');
  const patientId = detailMatch?.params.id ?? 'p-maria';

  useEffect(() => {
    document.title = `${BRAND_NAME} — Care Team`;
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-foam bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/care" className="group flex items-center gap-3 no-underline">
            <BrandMark className="h-9 w-9" />
            <span className="font-brand text-2xl font-bold tracking-tight text-teal-deep group-hover:text-teal">
              {BRAND_NAME}
            </span>
            <span className="text-base font-medium text-slate-500">Care team</span>
          </Link>
          <div className="flex items-baseline gap-5">
            <p className="hidden text-sm text-slate-500 sm:block">Home progress between clinic visits</p>
            <Link
              to={`/patient?as=${patientId}`}
              className="text-sm text-slate-400 underline-offset-2 hover:text-teal-deep hover:underline"
              title="Open the patient app as this patient (demo, no login)"
            >
              Patient app
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}
