// Pain 7+ or dizziness ends the session automatically (brief: "Safety stop").
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPatient, saveSession } from '../api';
import { BigButton } from '../components/Layout';
import { useSession } from '../session/SessionContext';
import { useSpeakOnMount } from '../voice/useVoice';

export function SafetyStop() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const session = useSession();
  const reason = params.get('reason') === 'dizzy' ? 'dizzy' : 'pain';
  const saved = useRef(false);

  const message =
    reason === 'pain'
      ? "Your pain is high today, so let's skip exercises. Rest, and your care team will see this."
      : "Let's stop here. Sit down, rest, and drink some water. Your care team will see this.";
  useSpeakOnMount(message);

  // Still save the check-in so the care team gets the pain / dizziness alert.
  useEffect(() => {
    if (saved.current || session.pain === null) return;
    saved.current = true;
    saveSession(
      {
        id: session.sessionId,
        patient_id: getPatient().id,
        started_at: session.startedAt,
        pain: session.pain ?? 0,
        tiredness: session.tiredness ?? 0,
        avg_hr: null,
        replay_file: null,
      },
      session.results,
      session.replay.current,
    );
  }, [session]);

  return (
    <div className="space-y-6">
      <p className="text-3xl leading-snug">{message}</p>
      <div className="rounded-2xl border-2 border-red-700 bg-red-950 p-5 text-2xl">
        If you have <b>face drooping</b>, <b>arm weakness</b> or <b>trouble speaking</b>, call 911 now.
      </div>
      <BigButton className="w-full" onClick={() => navigate('/patient')}>
        Back to dashboard
      </BigButton>
    </div>
  );
}
