import { Link, Route, Routes, useLocation, useMatch, useParams } from 'react-router-dom';
import PatientList from './pages/PatientList';
import PatientDetail from './pages/PatientDetail';
import PatientDemo from './pages/PatientDemo';

/** Remount the demo page per patient so no session state leaks between patients. */
function PatientDemoRoute() {
  const { id = 'p-maria' } = useParams<{ id: string }>();
  return <PatientDemo key={id} id={id} />;
}

export default function App() {
  const onPatientDemo = useLocation().pathname.startsWith('/patient/');
  // From a patient's detail page, the demo link opens that patient's view.
  const detailMatch = useMatch('/patients/:id');
  const demoPatientId = detailMatch?.params.id ?? 'p-maria';

  return (
    <div className="min-h-screen">
      <header className="border-b border-foam bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="group flex items-baseline gap-3 no-underline">
            <span className="font-display text-2xl font-bold tracking-tight text-teal-deep group-hover:text-teal">
              RehabTrack
            </span>
            {onPatientDemo ? (
              <span className="rounded-md bg-amber-200 px-2 py-0.5 text-base font-semibold text-amber-950">
                Demo patient view
              </span>
            ) : (
              <span className="text-base font-medium text-slate-500">Care team</span>
            )}
          </Link>
          {onPatientDemo ? (
            <Link to="/" className="text-sm text-slate-500 underline-offset-2 hover:underline">
              Care team dashboard →
            </Link>
          ) : (
            <div className="flex items-baseline gap-5">
              <p className="hidden text-sm text-slate-500 sm:block">Home progress between clinic visits</p>
              <Link
                to={`/patient/${demoPatientId}`}
                className="text-sm text-slate-400 underline-offset-2 hover:text-teal-deep hover:underline"
                title="Stand-in for the patient app (mock camera)"
              >
                Demo patient view
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <Routes>
          <Route path="/" element={<PatientList />} />
          <Route path="/patients/:id" element={<PatientDetail />} />
          <Route path="/patient/:id" element={<PatientDemoRoute />} />
        </Routes>
      </main>
    </div>
  );
}
