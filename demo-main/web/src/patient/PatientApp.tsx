// The patient app, mounted at /patient/*. Who it acts as: ?as=<patientId>, the remembered id, else p-maria
// (identity.tsx); ?pick=1 shows the "Who are you?" picker. Everything else comes from the API (PatientData.tsx).
// ?demo=1 shows the demo controls (demo.tsx) for the rest of the browser-tab session.
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { BRAND_NAME } from '../Brand';
import { applyArea } from '../ui/theme';
import { Layout } from './components/Layout';
import { demoEnabled, DemoProvider, rememberDemo } from './demo';
import { IdentityProvider, rememberPatientId, resolvePatientId, storedPatientId, WhoAreYou } from './identity';
import { PatientDataProvider } from './PatientData';
import { CheckIn } from './screens/CheckIn';
import { Dashboard } from './screens/Dashboard';
import { History } from './screens/History';
import { SafetyStop } from './screens/SafetyStop';
import { SessionRun } from './screens/SessionRun';
import { Summary } from './screens/Summary';
import { SessionProvider } from './session/SessionContext';
import './patient.css';

const URL_FLAGS = ['as', 'demo', 'pick'];

export default function PatientApp() {
  const [params, setParams] = useSearchParams();
  const urlAs = params.get('as');
  const urlDemo = params.get('demo');
  const urlPick = params.get('pick') === '1';
  const [patientId, setPatientId] = useState<string | null>(() => resolvePatientId(params, storedPatientId()));
  const [demo, setDemo] = useState(() => (urlDemo !== null ? urlDemo === '1' : demoEnabled()));
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    document.title = BRAND_NAME;
    applyArea('patient');
  }, []);

  // ?as=<id>, ?pick=1 and ?demo=1 / 0 are applied (and remembered), then removed from the address bar.
  useEffect(() => {
    if (!URL_FLAGS.some((f) => params.has(f))) return;
    if (urlPick) {
      setPatientId(null);
    } else if (urlAs) {
      rememberPatientId(urlAs);
      setPatientId(urlAs);
    }
    if (urlDemo !== null) {
      rememberDemo(urlDemo === '1');
      setDemo(urlDemo === '1');
    }
    const next = new URLSearchParams(params);
    URL_FLAGS.forEach((f) => next.delete(f));
    setParams(next, { replace: true });
  }, [urlAs, urlDemo, urlPick]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the params change

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
        <DemoProvider enabled={demo}>
          <SessionProvider>
            <Layout>
              <Routes>
                <Route index element={<Dashboard />} />
                <Route path="sessions" element={<History />} />
                <Route path="checkin" element={<CheckIn />} />
                <Route path="session" element={<SessionRun />} />
                <Route path="summary" element={<Summary />} />
                <Route path="stop" element={<SafetyStop />} />
                <Route path="*" element={<Navigate to="/patient" replace />} />
              </Routes>
            </Layout>
          </SessionProvider>
        </DemoProvider>
      </PatientDataProvider>
    </IdentityProvider>
  );
}
