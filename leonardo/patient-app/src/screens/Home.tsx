import { useNavigate } from 'react-router-dom';
import { daysUntil, getCurrentPlan, getPatient, getSessions, streakDays } from '../api';
import { BigButton } from '../components/Layout';
import { EXERCISES } from '../data/exercises';
import { useSession } from '../session/SessionContext';
import { useSpeakOnMount } from '../voice/useVoice';

export function Home() {
  const navigate = useNavigate();
  const session = useSession();
  const patient = getPatient();
  const plan = getCurrentPlan();
  const sessions = getSessions();
  const streak = streakDays(sessions);
  const checkin = daysUntil(plan.next_checkin);
  const doneToday = sessions.some((s) => new Date(s.started_at).toDateString() === new Date().toDateString());
  const lastSession = sessions[sessions.length - 1];
  const newPlan = plan.status === 'approved' && (!lastSession || plan.created_at > lastSession.started_at);

  useSpeakOnMount(
    doneToday
      ? `Well done ${patient.name}, you finished today's session.`
      : `Hello ${patient.name}. Tap the big button to start today's session.`,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-extrabold">Hello, {patient.name}</h1>

      {newPlan && (
        <div className="rounded-3xl border-4 border-neutral-100 bg-neutral-800 p-5 text-2xl">
          <b>Your care team updated your plan.</b> {plan.approved_by ? `Approved by ${plan.approved_by}.` : ''}
        </div>
      )}

      <BigButton
        className="w-full py-8 text-4xl"
        onClick={() => {
          session.begin();
          navigate('/patient/checkin');
        }}
      >
        {doneToday ? 'Do another session' : "▶ Start today's session"}
      </BigButton>

      <div className="grid gap-3 sm:grid-cols-2">
        <BigButton variant="secondary" onClick={() => navigate('/patient/history')}>
          📋 Past sessions
        </BigButton>
        <BigButton variant="secondary" onClick={() => navigate('/patient/progress')}>
          📈 My progress
        </BigButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Days in a row" value={`🔥 ${streak}`} />
        <Stat
          label="Next check-in"
          value={checkin <= 0 ? 'Today' : checkin === 1 ? 'Tomorrow' : `In ${checkin} days`}
        />
      </div>

      <section>
        <h2 className="text-3xl font-bold">Today's exercises</h2>
        <ol className="mt-3 space-y-3">
          {plan.exercises.map((ex, i) => (
            <li key={ex.name} className="flex items-center gap-4 rounded-2xl border-2 border-neutral-700 p-4 text-2xl">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-600 font-extrabold text-white">
                {i + 1}
              </span>
              <span className="font-bold">{EXERCISES[ex.name].title}</span>
              <span className="ml-auto text-neutral-300">{ex.reps} times each arm</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xl text-neutral-300">About 10–15 minutes. Your {patient.weak_side === 'right' ? 'left' : 'right'} arm goes first each time.</p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-neutral-900 p-5">
      <div className="text-xl text-neutral-300">{label}</div>
      <div className="text-4xl font-extrabold">{value}</div>
    </div>
  );
}
