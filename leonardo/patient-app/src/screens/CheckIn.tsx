import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BigButton } from '../components/Layout';
import { useSession } from '../session/SessionContext';
import { speak, useSpeakOnMount } from '../voice/useVoice';

export const TIREDNESS = [
  { v: 1, emoji: '😀', label: 'Full of energy' },
  { v: 2, emoji: '🙂', label: 'Fine' },
  { v: 3, emoji: '😐', label: 'A bit tired' },
  { v: 4, emoji: '😕', label: 'Tired' },
  { v: 5, emoji: '😫', label: 'Exhausted' },
];

export const PAIN_STOP_AT = 7;

export function CheckIn() {
  const navigate = useNavigate();
  const session = useSession();
  const [pain, setPain] = useState(2);
  const [tired, setTired] = useState<number | null>(null);

  useSpeakOnMount('Quick check in. How much pain do you have today? Then tap how tired you feel.');

  const go = () => {
    if (tired === null) return;
    session.setCheckIn(pain, tired);
    navigate(pain >= PAIN_STOP_AT ? '/patient/stop?reason=pain' : '/patient/session');
  };

  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-extrabold">Quick check-in</h1>

      <section className="rounded-3xl bg-neutral-900 p-6">
        <h2 className="text-3xl font-bold">Pain today</h2>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-7xl font-extrabold">{pain}</span>
          <span className="text-2xl text-neutral-300">out of 10</span>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={pain}
          onChange={(e) => setPain(Number(e.target.value))}
          onPointerUp={() => speak(`Pain ${pain}`)}
          aria-label="Pain today, 0 to 10"
          className="pain-slider mt-4 w-full"
        />
        <div className="mt-1 flex justify-between text-xl text-neutral-300">
          <span>0 · No pain</span>
          <span>10 · Worst</span>
        </div>
      </section>

      <section>
        <h2 className="text-3xl font-bold">How tired are you?</h2>
        <div className="mt-3 grid grid-cols-5 gap-2 sm:gap-3">
          {TIREDNESS.map((t) => (
            <button
              key={t.v}
              onClick={() => {
                setTired(t.v);
                speak(t.label);
              }}
              aria-pressed={tired === t.v}
              className={`flex min-h-[120px] flex-col items-center justify-center rounded-2xl border-4 p-2 ${
                tired === t.v ? 'border-neutral-100 bg-neutral-800' : 'border-neutral-700'
              }`}
            >
              <span className="text-5xl">{t.emoji}</span>
              <span className="mt-1 text-center text-base font-bold sm:text-lg">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <BigButton className="w-full" disabled={tired === null} onClick={go}>
        Next
      </BigButton>
    </div>
  );
}
