// Camera setup → healthy arm → weak arm, for each exercise in the plan.
// The camera stays on for the whole screen so it doesn't restart between exercises.
// Each round (exercise + arm) produces one ExerciseResult (repCounter) and one ReplayFile.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { tracker } from '../../camera';
import type { Joint3D, TrackingFrame } from '../../camera/types';
import { REPLAY_JOINTS, type BodySide, type Plan, type ReplayFile } from '../../types';
import { CameraView } from '../components/CameraView';
import { ExerciseExplainer } from '../components/ExerciseAvatar';
import { BigButton } from '../components/Layout';
import { EXERCISES, SHOULDER_HIKE_LIMIT, TRUNK_LEAN_LIMIT_DEG } from '../data/exercises';
import { usePatientData } from '../PatientData';
import { RepCounter } from '../session/repCounter';
import { useSession, type Step } from '../session/SessionContext';
import { speak } from '../voice/useVoice';

type Phase = 'explain' | 'setup' | 'countdown' | 'active' | 'done';

const ROUND_TIMEOUT_MS = 90_000;
const SMOOTH_FRAMES = 5;
const REPLAY_FPS = 15;
const REPLAY_EVERY_MS = 1000 / REPLAY_FPS;
const REPLAY_MAX_FRAMES = REPLAY_FPS * 120; // the API accepts up to 120 s per replay
const WARN_EVERY_MS = 4000;
const HAND_HINT_AFTER_MS = 3000;
const DEFAULT_SHOULDER_WIDTH_M = 0.36;

type Vec3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Distance between the shoulders in metres (joints3d[1], [2]), to turn shoulderHike (a fraction) into metres. */
function shoulderWidth(j: Joint3D[] | null): number {
  if (!j) return DEFAULT_SHOULDER_WIDTH_M;
  const [l, r] = [j[1], j[2]];
  const w = Math.hypot(l.x - r.x, l.y - r.y, l.z - r.z);
  return w > 0.1 ? w : DEFAULT_SHOULDER_WIDTH_M;
}

const newRound = (restAt: number, upAt: number) => ({
  counter: new RepCounter(restAt, upAt),
  recent: [] as number[],
  started: 0,
  lastWarn: 0,
  lastSeenHand: 0,
  seenSince: 0,
  // 3D replay for this round, sampled at 15 fps of frame time while active.
  frames: [] as Vec3[][],
  warnings: [] as NonNullable<ReplayFile['warnings']>,
  lastReplay: -Infinity,
});

export function SessionRun() {
  const session = useSession();
  // Opened without a check-in (e.g. after a page refresh): start again from the dashboard.
  if (!session.plan || session.pain === null) return <Navigate to="/patient" replace />;
  return <Run plan={session.plan} />;
}

function Run({ plan }: { plan: Plan }) {
  const navigate = useNavigate();
  const session = useSession();
  const { patient } = usePatientData();
  const healthySide: BodySide = patient.weakSide === 'right' ? 'left' : 'right';

  const [step, setStep] = useState<Step>({ exerciseIndex: 0, role: 'healthy' });
  const [phase, setPhase] = useState<Phase>('explain');
  const [countdown, setCountdown] = useState(3);
  const [value, setValue] = useState(0);
  const [reps, setReps] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [bodySeen, setBodySeen] = useState(false);
  const [doneText, setDoneText] = useState('');

  const planEx = plan.exercises[step.exerciseIndex];
  const info = EXERCISES[planEx.exercise];
  const side: BodySide = step.role === 'healthy' ? healthySide : patient.weakSide;
  const healthyBest = session.results.find((r) => r.exercise === planEx.exercise && r.side === 'healthy')?.bestValue ?? null;
  const goal =
    step.role === 'weak' && healthyBest !== null
      ? planEx.exercise === 'arm_raise'
        ? Math.min(healthyBest, patient.maxRaiseAngle)
        : healthyBest
      : null;

  // Per-round mutable state, read from the 30 fps frame callback.
  const round = useRef(newRound(info.restAt, info.upAt));
  const readyTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(readyTimer.current), []);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // The fake tracker needs to know which arm is the weak one (a real tracker ignores this).
  useEffect(() => {
    tracker.setDemoOptions?.({ weakSide: patient.weakSide });
  }, [patient.weakSide]);

  // New step: point the tracker at it and reset the round.
  useEffect(() => {
    tracker.configure({ exercise: planEx.exercise, activeSide: side });
    round.current = newRound(info.restAt, info.upAt);
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
        speak('Go');
        setPhase('active');
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [phase, step]);

  // Round finished: save it, say how it went, move on.
  useEffect(() => {
    if (phase !== 'done') return;
    const r = round.current;
    const stats = r.counter.stats();
    const replay: ReplayFile | null = r.frames.length
      ? { fps: REPLAY_FPS, exercise: planEx.exercise, side: step.role, joints: [...REPLAY_JOINTS], frames: r.frames, warnings: r.warnings }
      : null;
    session.addRound(step, stats, replay);
    let text = `Great job. ${stats.reps} reps.`;
    if (step.role === 'weak' && healthyBest) {
      text = `Great job. Your ${side} arm reached ${Math.round((stats.bestValue / healthyBest) * 100)} percent of your other arm.`;
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
    // Times use the tracker's clock (frame.t), never performance.now() directly.
    if (!r.started) {
      r.started = now;
      r.lastSeenHand = now;
    }
    if (now - r.started > ROUND_TIMEOUT_MS) {
      setPhase('done');
      return;
    }

    const raw = info.read(f, side);
    const lean = f.trunkLeanDeg ?? 0;
    const hike = f.shoulderHike ?? 0;
    const leaning = lean > TRUNK_LEAN_LIMIT_DEG;
    const hiking = hike > SHOULDER_HIKE_LIMIT;

    // Replay: [x, y, z] of the 13 joints at 15 fps, with a warning where lean / hike passed the limit.
    if (f.joints3d && now - r.lastReplay >= REPLAY_EVERY_MS && r.frames.length < REPLAY_MAX_FRAMES) {
      if (leaning || hiking) r.warnings.push({ frame: r.frames.length, type: leaning ? 'lean' : 'shoulder_hike' });
      r.frames.push(f.joints3d.map((j) => [r4(j.x), r4(j.y), r4(j.z)]));
      r.lastReplay = now;
    }

    if (raw === null) {
      if (planEx.exercise === 'hand_open' && now - r.lastSeenHand > HAND_HINT_AFTER_MS) {
        setWarning('Open your hand toward the camera as far as you can.');
      }
      return;
    }
    r.lastSeenHand = now;

    r.recent.push(raw);
    if (r.recent.length > SMOOTH_FRAMES) r.recent.shift();
    const v = r.recent.reduce((a, b) => a + b, 0) / r.recent.length;

    const compensating = leaning || hiking;
    if (compensating) {
      const msg = leaning ? 'Sit back against the chair.' : 'Keep your shoulder down.';
      setWarning(msg);
      if (now - r.lastWarn > WARN_EVERY_MS) {
        speak(msg, { interrupt: false });
        r.lastWarn = now;
      }
    } else if (now - r.lastWarn > 1500) {
      setWarning(null);
    }

    setValue(v);
    if (r.counter.push(v, now, compensating, lean, hike * shoulderWidth(f.joints3d))) {
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
