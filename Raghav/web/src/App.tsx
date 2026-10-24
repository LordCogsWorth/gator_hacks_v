import { Link, Route, Routes } from 'react-router-dom';
import PatientList from './pages/PatientList';
import PatientDetail from './pages/PatientDetail';

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-foam bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="group flex items-baseline gap-3 no-underline">
            <span className="font-display text-2xl font-bold tracking-tight text-teal-deep group-hover:text-teal">
              RehabTrack
            </span>
            <span className="text-base font-medium text-slate-500">Care team</span>
          </Link>
          <p className="hidden text-sm text-slate-500 sm:block">
            Home progress between clinic visits
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <Routes>
          <Route path="/" element={<PatientList />} />
          <Route path="/patients/:id" element={<PatientDetail />} />
        </Routes>
      </main>
    </div>
  );
}
