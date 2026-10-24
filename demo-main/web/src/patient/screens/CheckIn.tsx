import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { cx } from '../../ui/cx';
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

  // Opened without starting a session (e.g. after a page refresh): back to Home.
  if (!session.plan) return <Navigate to="/patient" replace />;

  const go = () => {
    if (tired === null) return;
    session.setCheckIn(pain, tired);
    navigate(pain >= PAIN_STOP_AT ? '/patient/stop?reason=pain' : '/patient/session');
  };

  return (
    <div className="space-y-6">
      <Card title="Pain today" titleAs="h2">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-7xl font-semibold tabular-nums">{pain}</span>
          <span className="text-2xl text-text-muted">out of 10</span>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={pain}
          onChange={(e) => setPain(Number(e.target.value))}
          onPointerUp={() => speak(`Pain ${pain}`)}
          onKeyUp={() => speak(`Pain ${pain}`)}
          aria-label="Pain today, 0 to 10"
          aria-valuetext={`${pain} out of 10`}
          className="pain-slider mt-4 w-full"
        />
        <div className="mt-1 flex justify-between text-xl text-text-muted">
          <span>0 · No pain</span>
          <span>10 · Worst</span>
        </div>
        {pain >= PAIN_STOP_AT && (
          <p className="mt-3 text-lg font-semibold text-warning" role="status">
            That's a lot of pain. We'll skip exercises today.
          </p>
        )}
      </Card>

      <section>
        <h2 className="text-2xl font-semibold">How tired are you?</h2>
        <div className="mt-3 grid grid-cols-5 gap-2 sm:gap-3">
          {TIREDNESS.map((t) => (
            <button
              type="button"
              key={t.v}
              onClick={() => {
                setTired(t.v);
                speak(t.label);
              }}
              aria-pressed={tired === t.v}
              aria-label={t.label}
              className={cx(
                'flex min-h-[120px] flex-col items-center justify-center rounded-card border-2 p-2 transition-colors',
                tired === t.v ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              <span className="text-5xl" aria-hidden>
                {t.emoji}
              </span>
              <span className="mt-1 text-center text-base font-semibold sm:text-lg">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div>
        <Button size="xl" fullWidth disabled={tired === null} onClick={go}>
          Next
        </Button>
        {tired === null && <p className="mt-2 text-center text-lg text-text-muted">Tap how tired you feel first.</p>}
      </div>
    </div>
  );
}
