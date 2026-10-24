/**
 * Final route table (CONVERGENCE_PLAN §8). FROZEN after WP0.
 *   /                                       landing page (Home)
 *   /patient/*                              patient app (dark + large by default)
 *   /care                                   patient list (light + comfortable by default)
 *   /care/patients/:id                      patient detail
 *   /care/patients/:id/sessions/:sid        3D session replay (?exercise=…&side=…)
 * Areas and the replay page are lazy-loaded; the three.js chunk loads only with the replay.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './Home';
import { Spinner } from './ui/Spinner';
import { useRouteTheme } from './ui/theme';

const PatientApp = lazy(() => import('./patient/PatientApp'));
const CareLayout = lazy(() => import('./care/CareLayout'));
const PatientList = lazy(() => import('./care/PatientList'));
const PatientDetail = lazy(() => import('./care/PatientDetail'));
const ReplayPage = lazy(() => import('./care/replay/ReplayPage'));

function PageLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-lg text-text-muted">
      <Spinner label="Loading…" />
    </div>
  );
}

const lazyPage = (node: ReactNode) => <Suspense fallback={<PageLoading />}>{node}</Suspense>;

export default function App() {
  useRouteTheme();
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/patient/*" element={lazyPage(<PatientApp />)} />
      <Route path="/care" element={lazyPage(<CareLayout />)}>
        <Route index element={lazyPage(<PatientList />)} />
        <Route path="patients/:id" element={lazyPage(<PatientDetail />)} />
        <Route path="patients/:id/sessions/:sid" element={lazyPage(<ReplayPage />)} />
        <Route path="*" element={<Navigate to="/care" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
