// The patient app, mounted at /patient/*. Who it acts as comes from ?as=<patientId> or the
// "Who are you?" picker (identity.tsx); everything else comes from the API (PatientData.tsx).
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { BRAND_NAME } from '../Brand';
import { Layout } from './components/Layout';
import { IdentityProvider, rememberPatientId, storedPatientId, WhoAreYou } from './identity';
import { PatientDataProvider } from './PatientData';
import { CheckIn } from './screens/CheckIn';
import { Dashboard } from './screens/Dashboard';
import { History } from './screens/History';
import { Messages } from './screens/Messages';
import { SafetyStop } from './screens/SafetyStop';
import { SessionRun } from './screens/SessionRun';
import { Settings } from './screens/Settings';
import { Summary } from './screens/Summary';
import { SessionProvider } from './session/SessionContext';
import './patient.css';

/** Old demo link /patient/:id → /patient?as=:id */
function LegacyPatientLink() {
  const { id = '' } = useParams<{ id: string }>();
  return <Navigate to={`/patient?as=${encodeURIComponent(id)}`} replace />;
}

export default function PatientApp() {
  const [params, setParams] = useSearchParams();
  const urlAs = params.get('as');
  const [patientId, setPatientId] = useState<string | null>(() => urlAs ?? storedPatientId());
  const [notice, setNotice] = useState<string | undefined>();

  // Dark, larger-text theme for the whole page while the patient area is open.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('patient-area');
    document.title = BRAND_NAME;
    return () => html.classList.remove('patient-area');
  }, []);

  // ?as=<id> picks the patient and is remembered; then it's removed from the address bar.
  useEffect(() => {
    if (!urlAs) return;
    rememberPatientId(urlAs);
    setPatientId(urlAs);
    const next = new URLSearchParams(params);
    next.delete('as');
    setParams(next, { replace: true });
  }, [urlAs]); // eslint-disable-line react-hooks/exhaustive-deps -- only when ?as changes

  const switchPatient = useCallback((id: string | null) => {
    rememberPatientId(id);
    setNotice(undefined);
    setPatientId(id);
  }, []);

  const onUnknownPatient = useCallback(() => {
    setNotice(`No patient with id "${patientId}". Pick who you are.`);
    rememberPatientId(null);
    setPatientId(null);
  }, [patientId]);

  if (!patientId) return <WhoAreYou onPick={switchPatient} notice={notice} />;

  return (
    <IdentityProvider value={{ patientId, switchPatient }}>
      {/* Keyed by patient so switching patients starts from a clean slate. */}
      <PatientDataProvider key={patientId} patientId={patientId} onUnknownPatient={onUnknownPatient}>
        <SessionProvider>
          <Layout>
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="sessions" element={<History />} />
              <Route path="messages" element={<Messages />} />
              <Route path="settings" element={<Settings />} />
              <Route path="checkin" element={<CheckIn />} />
              <Route path="session" element={<SessionRun />} />
              <Route path="summary" element={<Summary />} />
              <Route path="stop" element={<SafetyStop />} />
              <Route path=":id" element={<LegacyPatientLink />} />
              <Route path="*" element={<Navigate to="/patient" replace />} />
            </Routes>
          </Layout>
        </SessionProvider>
      </PatientDataProvider>
    </IdentityProvider>
  );
}
