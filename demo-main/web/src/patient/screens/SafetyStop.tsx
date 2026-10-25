// Pain 7+ or dizziness ends the session automatically (brief: "Safety stop").
// The session is still uploaded with a stopReason, so the care team gets a safety-stop alert.
import { Home } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { StopReason } from '../../types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Call911Button } from '../../ui/EmergencyBar';
import { Card } from '../../ui/Card';
import { useSession } from '../session/SessionContext';
import { useSpeakOnMount } from '../voice/useVoice';

export function SafetyStop() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const session = useSession();
  const reason = params.get('reason') === 'dizzy' ? 'dizzy' : 'pain';
  const stopReason: StopReason = reason === 'dizzy' ? 'dizziness' : 'pain';
  const started = useRef(false);
  // Nothing to send if the page was opened without a check-in (e.g. after a refresh).
  const hasSession = session.pain !== null;

  const message =
    reason === 'pain'
      ? "Your pain is high today, so let's skip exercises. Rest, and your care team will see this."
      : "Let's stop here. Sit down, rest, and drink some water. Your care team will see this.";
  useSpeakOnMount(`${message} If your face droops, your arm feels weak, or you have trouble speaking, call 911 now.`);

  useEffect(() => {
    if (started.current || !hasSession) return;
    started.current = true;
    session.save(stopReason).catch(() => {
      // Shown below from session.saveState.
    });
  }, [hasSession, session, stopReason]);

  const { saveState } = session;

  return (
    <div className="space-y-6">
      <p className="text-3xl leading-snug">{message}</p>
      <Card tone="danger">
        <p className="text-2xl">
          If you have <b>face drooping</b>, <b>arm weakness</b> or <b>trouble speaking</b>, call 911 now.
        </p>
        <Call911Button size="xl" className="mt-4" />
      </Card>
      {hasSession &&
        (saveState.status === 'saved' ? (
          <Banner tone="success" title="Your care team has been told" />
        ) : saveState.status === 'failed' ? (
          <Banner
            tone="warning"
            title="Couldn't reach your care team."
            action={
              <Button variant="secondary" onClick={() => void session.save(stopReason).catch(() => undefined)}>
                Try again
              </Button>
            }
          />
        ) : (
          <Banner tone="info" title="Telling your care team…" />
        ))}
      <Button size="xl" fullWidth icon={<Home />} onClick={() => navigate('/patient')}>
        Back to Home
      </Button>
    </div>
  );
}
