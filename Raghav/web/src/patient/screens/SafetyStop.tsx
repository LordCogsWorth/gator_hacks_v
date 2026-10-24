// Pain 7+ or dizziness ends the session automatically (brief: "Safety stop").
// The session is still uploaded with a stopReason, so the care team gets a safety-stop alert.
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { StopReason } from '../../types';
import { BigButton } from '../components/Layout';
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
  useSpeakOnMount(message);

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
      <div className="rounded-2xl border-2 border-red-700 bg-red-950 p-5 text-2xl">
        If you have <b>face drooping</b>, <b>arm weakness</b> or <b>trouble speaking</b>, call 911 now.
      </div>
      {hasSession && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-neutral-900 p-5 text-2xl text-neutral-300">
          {saveState.status === 'saved' ? (
            <span>✓ Your care team has been told</span>
          ) : saveState.status === 'failed' ? (
            <>
              <span>Couldn't reach your care team.</span>
              <BigButton variant="secondary" onClick={() => void session.save(stopReason).catch(() => undefined)}>
                Try again
              </BigButton>
            </>
          ) : (
            <span>Telling your care team…</span>
          )}
        </div>
      )}
      <BigButton className="w-full" onClick={() => navigate('/patient')}>
        Back to dashboard
      </BigButton>
    </div>
  );
}
