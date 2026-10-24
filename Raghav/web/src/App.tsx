/**
 * One app, two areas:
 *   /care/*    care-team dashboard (light theme)
 *   /patient/* patient app (dark theme)
 * Old links (/, /patients/:id) redirect into /care.
 */
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import CareLayout from './care/CareLayout';
import PatientDetail from './care/PatientDetail';
import PatientList from './care/PatientList';
import PatientDemo from './pages/PatientDemo';

/** Remount the demo page per patient so no session state leaks between patients. */
function PatientDemoRoute() {
  const { id = 'p-maria' } = useParams<{ id: string }>();
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <PatientDemo key={id} id={id} />
    </main>
  );
}

/** Old dashboard link /patients/:id → /care/patients/:id */
function LegacyPatientRedirect() {
  const { id = '' } = useParams<{ id: string }>();
  return <Navigate to={`/care/patients/${id}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/care" replace />} />
      <Route path="/care" element={<CareLayout />}>
        <Route index element={<PatientList />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="*" element={<Navigate to="/care" replace />} />
      </Route>
      <Route path="/patients/:id" element={<LegacyPatientRedirect />} />
      <Route path="/patient/:id" element={<PatientDemoRoute />} />
      <Route path="*" element={<Navigate to="/care" replace />} />
    </Routes>
  );
}
