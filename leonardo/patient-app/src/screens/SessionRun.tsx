// Camera setup → healthy arm → weak arm, for each exercise in the plan.
// The camera stays on for the whole screen so it doesn't restart between exercises.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentPlan, getPatient } from '../api';
import { tracker } from '../camera';
import type { TrackingFrame } from '../camera/types';
import { CameraView } from '../components/CameraView';
import { ExerciseExplainer } from '../components/ExerciseAvatar';
import { BigButton } from '../components/Layout';
import { EXERCISES, SHOULDER_HIKE_LIMIT, TRUNK_LEAN_LIMIT_DEG } from '../data/exercises';
import { RepCounter } from '../session/repCounter';
import { useSession, type Step } from '../session/SessionContext';
import type { Side } from '../types';
import { speak } from '../voice/useVoice';

type Phase = 'explain' | 'setup' | 'countdown' | 'active' | 'done';

const ROUND_TIMEOUT_MS = 90_000;
const SMOOTH_FRAMES = 5;
const REPLAY_EVERY_MS = 1000 / 15;
const WARN_EVERY_MS = 4000;
const HAND_HINT_AFTER_MS = 3000;

export function SessionRun() {
  const navigate = useNavigate();
  const session = useSession();
  const patient = getPatient();
  const plan = getCurrentPlan();
  const healthySide: Side = patient.weak_side === 'right' ? 'left' : 'right';

  const [step, setStep] = useState<Step>({ exerciseIndex: 0, role: 'healthy' });
  const [phase, setPhase] = useState<Phase>('explain');
  const [countdown, setCountdown] = useState(3);
  const [value, setValue] = useState(0);
  const [reps, setReps] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [bodySeen, setBodySeen] = useState(false);
  const [doneText, setDoneText] = useState('');

  const planEx = plan.exercises[step.exerciseIndex];
  const info = EXERCISES[planEx.name];
  const side: Side = step.role === 'healthy' ? healthySide : patient.weak_side;
  const healthyBest = session.results.find((r) => r.exercise === planEx.name && r.side === 'healthy')?.best_value ?? null;
  const goal =
    step.role === 'weak' && healthyBest !== null
      ? planEx.name === 'arm_raise'
        ? Math.min(healthyBest, patient.max_raise_angle)
        : healthyBest
      : null;

  // Per-round mutable state, read from the 30 fps frame callback.
  const round = useRef({ counter: new RepCounter(info.restAt, info.upAt), recent: [] as number[], started: 0, lastWarn: 0, lastSeenHand: 0, seenSince: 0 });
  const lastReplay = useRef(0);
  const readyTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(readyTimer.current), []);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // New step: point the tracker at it and reset the round.
  useEffect(() => {
    tracker.configure({ exercise: planEx.name, activeSide: side });
    round.current = { counter: new RepCounter(info.restAt, info.upAt), recent: [], started: 0, lastWarn: 0, lastSeenHand: performance.now(), seenSince: 0 };
    setReps(0);
    setValue(0);
    setWarning(null);
    setBodySeen(false);
    if (step.role === 'healthy') {
      setPhase('explain');
    } else {
      setPhase('countdown');
    }
  }, [step]);

  // Countdown, with the spoken instruction.
  useEffect(() => {
    if (phase !== 'countdown') return;
    const which = step.role === 'healthy' ? `your stronger ${side} arm first` : `your ${side} arm. Try to reach the goal line`;
    speak(`Now ${which}. ${info.instruction}`);
    setCountdown(3);
    let n = 3;
    const id = window.setInterval(() => {
      n--;
      setCountdown(n);
      if (n <= 0) {
        window.clearInterval(id);
        round.current.started = performance.now();
        speak('Go');
        setPhase('active');
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [phase, step]);

  // Round finished: save it, say how it went, move on.
  useEffect(() => {
    if (phase !== 'done') return;
    const stats = round.current.counter.stats();
    session.addRound(step, stats);
    let text = `Great job. ${stats.reps} reps.`;
    if (step.role === 'weak' && healthyBest) {
      text = `Great job. Your ${side} arm reached ${Math.round((stats.best_value / healthyBest) * 100)} percent of your other arm.`;
    }
    setDoneText(text);
    speak(text);
    const id = window.setTimeout(() => {
      const next = session.next(step);
      if (next) setStep(next);
      else navigate('/patient/summary');
    }, 3500);
    return () => window.clearTimeout(id);
  }, [phase]);

  function onFrame(f: TrackingFrame) {
    const now = f.t;
    const r = round.current;

    if (f.joints3d && now - lastReplay.current >= REPLAY_EVERY_MS) {
      session.replay.current.push(f.joints3d);
      lastReplay.current = now;
    }

    if (phaseRef.current === 'setup') {
      const v = f.visible;
      const all = v.shoulders.left && v.shoulders.right && v.elbows.left && v.elbows.right && v.wrists.left && v.wrists.right;
      if (!all) {
        r.seenSince = 0;
        setBodySeen(false);
      } else if (!r.seenSince) {
        r.seenSince = now;
      } else if (now - r.seenSince > 1000) {
        r.seenSince = Infinity; // only fire once
        setBodySeen(true);
        speak('Ready');
        readyTimer.current = window.setTimeout(() => setPhase('countdown'), 1500);
      }
      return;
    }
    if (phaseRef.current !== 'active') return;
    if (now - r.started > ROUND_TIMEOUT_MS) {
      setPhase('done');
      return;
    }

    const raw = info.read(f, side);
    if (raw === null) {
      if (planEx.name === 'hand_open' && now - r.lastSeenHand > HAND_HINT_AFTER_MS) {
        setWarning('Open your hand toward the camera as far as you can.');
      }
      return;
    }
    r.lastSeenHand = now;

    r.recent.push(raw);
    if (r.recent.length > SMOOTH_FRAMES) r.recent.shift();
    const v = r.recent.reduce((a, b) => a + b, 0) / r.recent.length;

    const lean = f.trunkLeanDeg ?? 0;
    const hike = f.shoulderHike ?? 0;
    const compensating = lean > TRUNK_LEAN_LIMIT_DEG || hike > SHOULDER_HIKE_LIMIT;
    if (compensating) {
      const msg = lean > TRUNK_LEAN_LIMIT_DEG ? 'Sit back against the chair.' : 'Keep your shoulder down.';
      setWarning(msg);
      if (now - r.lastWarn > WARN_EVERY_MS) {
        speak(msg, { interrupt: false });
        r.lastWarn = now;
      }
    } else if (now - r.lastWarn > 1500) {
      setWarning(null);
    }

    setValue(v);
    if (r.counter.push(v, now, compensating, lean, hike)) {
      const n = r.counter.count;
      setReps(n);
      speak(String(n));
      if (n >= planEx.reps) setPhase('done');
    }
  }

  const roundLabel = step.role === 'healthy' ? `Stronger arm (${side})` : `Weaker arm (${side})`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          {step.exerciseIndex + 1}/{plan.exercises.length} · {info.title}
        </h1>
        {phase !== 'setup' && phase !== 'explain' && (
          <span className={`rounded-full px-4 py-1 text-2xl font-bold text-white ${step.role === 'healthy' ? 'bg-neutral-800' : 'bg-neutral-600'}`}>
            {roundLabel}
          </span>
        )}
      </div>

      {phase === 'explain' && (
        <ExerciseExplainer
          info={info}
          onStart={() => {
            setPhase('setup');
            speak(info.cameraSetup);
          }}
        />
      )}

      {/* Hidden (not removed) while the coach explains, so the camera keeps running. */}
      <div className={`grid gap-4 lg:grid-cols-[1fr_220px] ${phase === 'explain' ? 'hidden' : ''}`}>
        <div className="relative">
          <CameraView onFrame={onFrame} outline={phase === 'setup'} />
          {phase === 'setup' && (
            <Overlay>
              <p className="text-2xl font-bold">{info.cameraSetup}</p>
              <p className="mt-2 text-xl">{bodySeen ? '✅ Ready!' : 'Waiting to see both shoulders, elbows and wrists…'}</p>
            </Overlay>
          )}
          {phase === 'countdown' && (
            <Overlay>
              <p className="text-2xl">{info.instruction}</p>
              <p className="mt-2 text-7xl font-semibold">{countdown > 0 ? countdown : 'Go!'}</p>
            </Overlay>
          )}
          {phase === 'done' && (
            <Overlay>
              <p className="text-3xl font-semibold">{doneText}</p>
            </Overlay>
          )}
          {phase === 'active' && warning && (
            <div className="absolute inset-x-3 top-3 rounded-2xl bg-amber-400 px-4 py-3 text-center text-3xl font-semibold text-neutral-950">
              ⚠ {warning}
            </div>
          )}
        </div>

        <div className="flex gap-4 lg:flex-col">
          <Bar value={value} max={info.scaleMax} goal={goal} unit={info.unit} />
          <div className="flex flex-1 flex-col justify-center rounded-2xl bg-neutral-900 p-4 text-center">
            <div className="text-xl text-neutral-300">Reps</div>
            <div className="text-6xl font-semibold">
              {reps}
              <span className="text-3xl text-neutral-400">/{planEx.reps}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <BigButton variant="secondary" disabled={phase !== 'active'} onClick={() => setPhase('done')}>
          I'm done with this arm
        </BigButton>
        <BigButton variant="danger" onClick={() => navigate('/patient/stop?reason=dizzy')}>
          I feel dizzy or unwell
        </BigButton>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="max-w-xl rounded-2xl bg-neutral-900/95 p-6 text-center shadow-xl">{children}</div>
    </div>
  );
}

/** Big vertical bar that fills with the current angle / opening. The goal line is the healthy arm's best. */
function Bar({ value, max, goal, unit }: { value: number; max: number; goal: number | null; unit: string }) {
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / max) * 100))}%`;
  const reached = goal !== null && value >= goal * 0.98;
  return (
    <div className="relative h-72 w-32 shrink-0 overflow-hidden rounded-2xl border border-neutral-500 bg-neutral-900 lg:h-96 lg:w-full">
      <div
        className={`absolute inset-x-0 bottom-0 transition-[height] duration-100 ${reached ? 'bg-green-600' : 'bg-neutral-300'}`}
        style={{ height: pct(value) }}
      />
      {goal !== null && (
        <div className="absolute inset-x-0 border-t-[6px] border-dashed border-neutral-50" style={{ bottom: pct(goal) }}>
          <span className="absolute right-1 -top-9 rounded bg-neutral-50 px-2 text-lg font-bold text-neutral-950">Goal</span>
        </div>
      )}
      <div className="absolute inset-x-0 top-3 text-center text-4xl font-semibold text-white mix-blend-difference">
        {Math.round(value)}
        {unit}
      </div>
    </div>
  );
}
