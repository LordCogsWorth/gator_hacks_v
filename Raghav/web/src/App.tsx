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
import PatientApp from './patient/PatientApp';

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
      <Route path="/patient/*" element={<PatientApp />} />
      <Route path="*" element={<Navigate to="/care" replace />} />
    </Routes>
  );
}
