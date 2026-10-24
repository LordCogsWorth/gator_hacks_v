import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionProvider } from './session/SessionContext';
import { CheckIn } from './screens/CheckIn';
import { History } from './screens/History';
import { Home } from './screens/Home';
import { Progress } from './screens/Progress';
import { SafetyStop } from './screens/SafetyStop';
import { SessionRun } from './screens/SessionRun';
import { Summary } from './screens/Summary';

export function App() {
  return (
    <SessionProvider>
      <Layout>
        <Routes>
          <Route path="/patient" element={<Home />} />
          <Route path="/patient/checkin" element={<CheckIn />} />
          <Route path="/patient/session" element={<SessionRun />} />
          <Route path="/patient/summary" element={<Summary />} />
          <Route path="/patient/stop" element={<SafetyStop />} />
          <Route path="/patient/history" element={<History />} />
          <Route path="/patient/progress" element={<Progress />} />
          <Route path="*" element={<Navigate to="/patient" replace />} />
        </Routes>
      </Layout>
    </SessionProvider>
  );
}
