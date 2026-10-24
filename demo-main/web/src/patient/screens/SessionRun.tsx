// Camera setup → healthy arm → weak arm, for each exercise in the plan.
// The camera stays on for the whole screen so it doesn't restart between exercises.
// Each round (exercise + arm): explain → setup gate → countdown (rest baseline) → active → done,
// producing one ExerciseResult (repCounter) and one ReplayFile.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { tracker } from '../../camera';
import type { TrackingFrame } from '../../camera/types';
import { REPLAY_JOINTS, type BodySide, type Plan, type ReplayFile } from '../../types';
import { Button, cx } from '../../ui';
import { CameraView } from '../components/CameraView';
import { ExerciseExplainer } from '../components/ExerciseAvatar';
import { EXERCISES, thresholds } from '../data/exercises';
import { useDemo } from '../demo';
import { usePatientData } from '../PatientData';
import { BASELINE_TIMEOUT_MS, RestBaseline } from '../session/baseline';
import { CompensationMonitor } from '../session/compensation';
import { RepCounter } from '../session/repCounter';
import { useSession, type Step } from '../session/SessionContext';
import { speak, useSpeakOnMount } from '../voice/useVoice';

type Phase = 'explain' | 'setup' | 'countdown' | 'active' | 'done';

const ROUND_TIMEOUT_MS = 90_000;
const COUNTDOWN_FROM = 3;
const REPLAY_FPS = 15;
const REPLAY_EVERY_MS = 1000 / REPLAY_FPS;
const REPLAY_MAX_FRAMES = REPLAY_FPS * 120; // replays are capped at 120 s
const WARN_EVERY_MS = 4000;
const WARN_CLEAR_MS = 1500;
const HAND_HINT_AFTER_MS = 3000;
const START_ANYWAY_AFTER_MS = 8000;

const WARNING_TEXT = {
  lean: 'Sit back against the chair.',
  shoulder_hike: 'Keep your shoulder down.',
} as const;

type Vec3 = [number, number, number];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

const newRound = () => ({
  baseline: new RestBaseline(),
  countdownOver: false,
  // Created when the round goes active, from the rest baseline.
  counter: null as RepCounter | null,
  comp: null as CompensationMonitor | null,
  started: 0,
  lastWarn: -Infinity,
  lastComp: -Infinity,
  lastSeenHand: 0,
  seenSince: 0,
  closedMin: null as number | null,
  // 3D replay for this round, sampled at 15 fps of frame time while active.
  frames: [] as Vec3[][],
  warnings: [] as NonNullable<ReplayFile['warnings']>,
  lastReplay: -Infinity,
});

export function SessionRun() {
  const session = useSession();
  // Opened without a check-in (e.g. after a page refresh): start again from the dashboard.
  if (!session.plan || session.pain === null) return <Navigate to="/patient" replace />;
  if (!session.plan.exercises.length) return <NoExercises />;
  return <Run plan={session.plan} />;
}

function NoExercises() {
  const text = 'There are no exercises in your plan today. Your care team will add them.';
  useSpeakOnMount(text);
  return (
    <div className="space-y-6 rounded-card border border-border bg-surface p-6 text-center">
      <h1 className="text-2xl font-semibold text-text sm:text-3xl">No exercises today</h1>
      <p className="text-xl text-text-muted">{text}</p>
      <Button size="xl" to="/patient">
        Back to Home
      </Button>
    </div>
  );
}

function Run({ plan }: { plan: Plan }) {
  const navigate = useNavigate();
  const session = useSession();
  const { patient } = usePatientData();
  // Demo speed-up: shorter countdowns and pauses (the fake tracker also runs faster).
  const demo = useDemo();
  const { fast } = demo;
  const healthySide: BodySide = patient.weakSide === 'right' ? 'left' : 'right';

  const [step, setStep] = useState<Step>({ exerciseIndex: 0, role: 'healthy' });
  const [phase, setPhase] = useState<Phase>('explain');
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  const [baselineReady, setBaselineReady] = useState(false);
  const [value, setValue] = useState(0);
  const [reps, setReps] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [bodySeen, setBodySeen] = useState(false);
  const [startAnyway, setStartAnyway] = useState(false);
  const [doneText, setDoneText] = useState('');

  const planEx = plan.exercises[step.exerciseIndex];
  const exercise = planEx.exercise;
  const info = EXERCISES[exercise];
  const side: BodySide = step.role === 'healthy' ? healthySide : patient.weakSide;
  const healthyBest = session.results.find((r) => r.exercise === exercise && r.side === 'healthy')?.bestValue ?? null;
  const goal =
    step.role === 'weak' && healthyBest !== null
      ? exercise === 'arm_raise'
        ? Math.min(healthyBest, patient.maxRaiseAngle)
        : healthyBest
      : null;

  // Per-round mutable state, read from the 30 fps frame callback.
  const round = useRef(newRound());
  const readyTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(readyTimer.current), []);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Load the hand model now, so the first hand_open round has readings from its first frame.
  useEffect(() => {
    if (plan.exercises.some((e) => e.exercise === 'hand_open')) tracker.preloadHand();
  }, []);

  function goto(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  // New step: point the tracker at it (arm at rest) and reset the round.
  useEffect(() => {
    tracker.configure({ exercise, activeSide: side, resting: true });
    round.current = newRound();
    setReps(0);
    setValue(0);
    setWarning(null);
    setHint(null);
    setBodySeen(false);
    goto(step.role === 'healthy' ? 'explain' : 'countdown');
  }, [step]);

  // Setup: offer "Start anyway" if the gate hasn't opened after a while.
  useEffect(() => {
    if (phase !== 'setup') return;
    setStartAnyway(false);
    const id = window.setTimeout(() => setStartAnyway(true), START_ANYWAY_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [phase, step]);

  /** Countdown over and the rest pose is known (or timed out): start counting reps. */
  function goActive() {
    if (phaseRef.current !== 'countdown') return;
    const r = round.current;
    const base = r.baseline.result();
    r.counter = new RepCounter(thresholds(exercise, base?.v0 ?? null));
    r.comp = new CompensationMonitor(exercise, base);
    tracker.configure({ exercise, activeSide: side, resting: false });
    speak('Go');
    goto('active');
  }

  // Countdown, with the spoken instruction. The rest baseline is collected meanwhile (see onFrame).
  useEffect(() => {
    if (phase !== 'countdown') return;
    const which = step.role === 'healthy' ? `your stronger ${side} arm first` : `your ${side} arm. Try to reach the goal line`;
    speak(`Now ${which}. ${info.instruction}`);
    const r = round.current;
    r.baseline = new RestBaseline();
    r.countdownOver = false;
    setBaselineReady(false);
    setCountdown(COUNTDOWN_FROM);
    let n = COUNTDOWN_FROM;
    const id = window.setInterval(
      () => {
        n--;
        setCountdown(n);
        if (n > 0) return;
        window.clearInterval(id);
        r.countdownOver = true;
        // Demo speed-up: take the (simulated) rest pose as it is.
        if (fast || r.baseline.ready) goActive();
      },
      fast ? 1000 / COUNTDOWN_FROM : 1000,
    );
    // Not steady in time (or no frames at all): go with what there is.
    const timeout = window.setTimeout(goActive, BASELINE_TIMEOUT_MS);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timeout);
    };
  }, [phase, step]);

  // Round finished: save it, say how it went, move on.
  useEffect(() => {
    if (phase !== 'done') return;
    const r = round.current;
    const counter = r.counter ?? new RepCounter(thresholds(exercise, null));
    const stats = counter.stats({
      ...(r.comp?.metrics() ?? {}),
      ...(exercise === 'hand_open' ? { closedMin: r.closedMin } : {}),
    });
    if (exercise === 'forward_reach') stats.reachCm ??= null;
    const replay: ReplayFile | null = r.frames.length
      ? { fps: REPLAY_FPS, exercise, side: step.role, joints: [...REPLAY_JOINTS], frames: r.frames, warnings: r.warnings }
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
    }, fast ? 1200 : 3500);
    return () => window.clearTimeout(id);
  }, [phase]);

  function onFrame(f: TrackingFrame) {
    // Times use the tracker's clock (frame.t), never performance.now() directly.
    const now = f.t;
    const r = round.current;

    if (phaseRef.current === 'setup') {
      if (!info.inView(f, side)) {
        r.seenSince = 0;
        setBodySeen(false);
      } else if (!r.seenSince) {
        r.seenSince = now;
      } else if (now - r.seenSince >= info.setupHoldMs) {
        r.seenSince = Infinity; // only fire once
        setBodySeen(true);
        speak('Ready');
        readyTimer.current = window.setTimeout(() => goto('countdown'), fast ? 500 : 1500);
      }
      return;
    }

    if (phaseRef.current === 'countdown') {
      r.baseline.push({
        trunkVec: f.trunkVec,
        hike: f.shoulderHike,
        value: exercise === 'hand_open' ? null : info.read(f, side),
      });
      if (r.baseline.ready) {
        setBaselineReady(true);
        if (r.countdownOver) goActive();
      }
      return;
    }

    if (phaseRef.current !== 'active' || !r.counter || !r.comp) return;
    if (!r.started) {
      r.started = now;
      r.lastSeenHand = now;
    }
    if (now - r.started > ROUND_TIMEOUT_MS) {
      goto('done');
      return;
    }

    const comp = r.comp.push({
      trunkVec: f.trunkVec,
      trunkLeanDeg: f.trunkLeanDeg,
      shoulderHike: f.shoulderHike,
      shoulderAngle: f.shoulderAngle[side],
      shoulderWidthM: f.shoulderWidthM,
    });

    // Replay: [x, y, z] of the 13 joints at 15 fps, with a warning where the patient was compensating.
    if (f.joints3d && now - r.lastReplay >= REPLAY_EVERY_MS && r.frames.length < REPLAY_MAX_FRAMES) {
      if (comp.kind) r.warnings.push({ frame: r.frames.length, type: comp.kind });
      r.frames.push(f.joints3d.map((j) => [r4(j.x), r4(j.y), r4(j.z)]));
      r.lastReplay = now;
    }

    if (comp.kind) {
      const msg = WARNING_TEXT[comp.kind];
      r.lastComp = now;
      setWarning(msg);
      if (now - r.lastWarn >= WARN_EVERY_MS) {
        speak(msg, { interrupt: false });
        r.lastWarn = now;
      }
    } else if (now - r.lastComp > WARN_CLEAR_MS) {
      setWarning(null);
    }

    const v = info.read(f, side);
    if (v === null) {
      if (exercise === 'hand_open' && now - r.lastSeenHand > HAND_HINT_AFTER_MS) {
        setHint('Open your hand toward the camera as far as you can.');
      }
      return;
    }
    r.lastSeenHand = now;
    setHint(null);
    if (exercise === 'hand_open') r.closedMin = Math.min(r.closedMin ?? Infinity, v);

    setValue(v);
    if (r.counter.push(v, now, comp.compensating, exercise === 'forward_reach' ? f.reachM[side] : null)) {
      const n = r.counter.count;
      setReps(n);
      speak(String(n));
      if (n >= planEx.reps) goto('done');
    }
  }

  const roundLabel = step.role === 'healthy' ? `Stronger arm (${side})` : `Weaker arm (${side})`;
  const banner = warning ?? hint;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-text sm:text-3xl">
          {step.exerciseIndex + 1}/{plan.exercises.length} · {info.title}
        </h1>
        {phase !== 'setup' && phase !== 'explain' && (
          <span
            className={cx(
              'rounded-full border px-4 py-1 text-2xl font-bold text-text',
              step.role === 'healthy' ? 'border-border bg-surface-2' : 'border-primary/40 bg-primary-soft',
            )}
          >
            {roundLabel}
          </span>
        )}
      </div>

      {phase === 'explain' && (
        <ExerciseExplainer
          info={info}
          onStart={() => {
            goto('setup');
            speak(info.cameraSetup);
          }}
        />
      )}

      {/* Hidden (not removed) while the coach explains, so the camera keeps running. */}
      <div className={cx('grid gap-4 lg:grid-cols-[1fr_220px]', phase === 'explain' && 'hidden')}>
        <div className="relative">
          <CameraView onFrame={onFrame} outline={phase === 'setup'} demoPanel={demo.enabled} />
          {phase === 'setup' && (
            <Overlay>
              <p className="text-2xl font-bold">{info.cameraSetup}</p>
              <p className="mt-2 text-xl text-text-muted" role="status">
                {bodySeen ? '✅ Ready!' : info.setupWaiting}
              </p>
              {startAnyway && !bodySeen && (
                <Button size="xl" variant="secondary" className="mt-4" onClick={() => goto('countdown')}>
                  Start anyway
                </Button>
              )}
            </Overlay>
          )}
          {phase === 'countdown' && (
            <Overlay>
              <p className="text-2xl">{info.instruction}</p>
              {countdown > 0 && <p className="mt-2 text-7xl font-semibold tabular-nums">{countdown}</p>}
              {!baselineReady && (
                <p className="mt-3 text-xl font-semibold text-text-muted" role="status">
                  Rest your arm for a moment…
                </p>
              )}
            </Overlay>
          )}
          {phase === 'done' && (
            <Overlay>
              <p className="text-3xl font-semibold">{doneText}</p>
            </Overlay>
          )}
          {phase === 'active' && banner && (
            <div
              role="status"
              className="absolute inset-x-3 top-3 rounded-2xl border-2 border-warning bg-warning-soft px-4 py-3 text-center text-3xl font-semibold text-text shadow-raised"
            >
              ⚠ {banner}
            </div>
          )}
        </div>

        <div className="flex gap-4 lg:flex-col">
          <Bar value={value} max={info.scaleMax} goal={goal} unit={info.unit} />
          <div className="flex flex-1 flex-col justify-center rounded-2xl border border-border bg-surface p-4 text-center">
            <div className="text-xl text-text-muted">Reps</div>
            <div className="text-6xl font-semibold tabular-nums text-text">
              {reps}
              <span className="text-3xl text-text-muted">/{planEx.reps}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button size="xl" variant="secondary" fullWidth disabled={phase !== 'active'} onClick={() => goto('done')}>
          I'm done with this arm
        </Button>
        <Button size="xl" variant="danger" fullWidth onClick={() => navigate('/patient/stop?reason=dizzy')}>
          I feel dizzy or unwell
        </Button>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="max-w-xl rounded-2xl border border-border bg-surface/95 p-6 text-center text-text shadow-modal">{children}</div>
    </div>
  );
}

/** Big vertical bar that fills with the current angle / opening. The goal line is the healthy arm's best. */
function Bar({ value, max, goal, unit }: { value: number; max: number; goal: number | null; unit: string }) {
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / max) * 100))}%`;
  const reached = goal !== null && value >= goal * 0.98;
  return (
    <div className="relative h-72 w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface-2 lg:h-96 lg:w-full">
      <div
        className={cx('absolute inset-x-0 bottom-0 transition-[height] duration-100', reached ? 'bg-success' : 'bg-primary')}
        style={{ height: pct(value) }}
      />
      {goal !== null && (
        <div className="absolute inset-x-0 border-t-[6px] border-dashed border-text" style={{ bottom: pct(goal) }}>
          <span className="absolute -top-9 right-1 rounded bg-text px-2 text-lg font-bold text-surface">Goal</span>
        </div>
      )}
      <div className="absolute inset-x-0 top-3 text-center">
        <span className="rounded-lg bg-surface/90 px-2 text-4xl font-semibold tabular-nums text-text">
          {Math.round(value)}
          {unit}
        </span>
      </div>
    </div>
  );
}
