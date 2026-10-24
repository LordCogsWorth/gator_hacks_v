import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionProvider } from './session/SessionContext';
import { CheckIn } from './screens/CheckIn';
import { Dashboard } from './screens/Dashboard';
import { History } from './screens/History';
import { Messages } from './screens/Messages';
import { SafetyStop } from './screens/SafetyStop';
import { SessionRun } from './screens/SessionRun';
import { Settings } from './screens/Settings';
import { Summary } from './screens/Summary';

export function App() {
  return (
    <SessionProvider>
      <Layout>
        <Routes>
          <Route path="/patient" element={<Dashboard />} />
          <Route path="/patient/sessions" element={<History />} />
          <Route path="/patient/messages" element={<Messages />} />
          <Route path="/patient/settings" element={<Settings />} />
          <Route path="/patient/checkin" element={<CheckIn />} />
          <Route path="/patient/session" element={<SessionRun />} />
          <Route path="/patient/summary" element={<Summary />} />
          <Route path="/patient/stop" element={<SafetyStop />} />
          <Route path="*" element={<Navigate to="/patient" replace />} />
        </Routes>
      </Layout>
    </SessionProvider>
  );
}
