/**
 * Demo patient view: a minimal stand-in for Lucas's patient app, so the whole
 * loop (session → rules → care team approves → patient sees new plan) can be
 * demoed before his app and Stuti's camera module are in the repo.
 *
 * Also a reference for Lucas: GET /patients/:id/plan, mock camera
 * (camera/mockCamera.ts, same signature as Stuti's module), POST /sessions,
 * then POST /sessions/:id/replay per exercise + side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getApprovedPlan, getPatients, postSession, uploadReplay } from '../api';
import { releaseCamera, startExercise } from '../camera/mockCamera';
import type { ExerciseControl, ExerciseResult, LiveFrame, ReplayFile } from '../camera/types';
import { usePolling } from '../usePolling';
import type { Alert, Exercise, PatientSummary, Plan, PlanExercise, SessionUploadResponse, Side } from '../types';
import { EXERCISE_LABELS, TARGET_UNITS } from '../types';

const SPEED_UP = 8; // ≈ 30 s for a full 6-step session instead of ~4 minutes
const DEFAULT_COMPENSATION = 10;

const bigButton =
  'min-h-[72px] rounded-2xl px-8 text-2xl font-bold shadow-sm transition focus:outline-none focus:ring-4 focus:ring-teal-soft disabled:opacity-50';
const primaryButton = `${bigButton} bg-teal-deep text-white hover:bg-teal`;
const secondaryButton = `${bigButton} bg-white text-teal-deep ring-2 ring-teal-deep hover:bg-teal-soft/40`;

const WARNING_TEXT: Record<NonNullable<LiveFrame['warning']>, string> = {
  lean: 'Sit up straight — try not to lean',
  shoulder_hike: 'Relax your shoulder down',
  not_visible: 'Move so the camera can see you',
};

/** Plain-language lines for alerts a session can raise (patient-facing). */
const ALERT_WORDS: Record<Alert['type'], string> = {
  compensation: 'You leaned or lifted your shoulder in many reps. Your care team has been told, so they can help with your form.',
  pain: 'You reported strong pain. Your care team has been told. If the pain is severe or sudden, call your doctor.',
  setback: 'Your arm moved less than last time. Your care team has been told.',
  plateau: 'Your progress has been steady for a while. Your care team may adjust your plan.',
  adherence: 'Your care team noticed a few missed days. Every session helps.',
  'heart-rate': 'Your care team has been told about your resting heart rate.',
  'blood-pressure': 'Your care team has been told about your blood pressure.',
  fall: 'Your care team has been told about a recorded fall.',
};

const TIREDNESS_LABELS = ['Not tired', 'A little', 'Somewhat', 'Very', 'Exhausted'];

interface Step extends PlanExercise {
  side: Side;
}

function stepsFor(plan: Plan): Step[] {
  return plan.exercises.flatMap((e) => [
    { ...e, side: 'healthy' as const },
    { ...e, side: 'weak' as const },
  ]);
}

function daysUntil(date: string) {
  const target = new Date(date + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDate(date: string) {
  const d = new Date(date + 'T12:00:00');
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function unit(exercise: Exercise) {
  return TARGET_UNITS[exercise];
}

// ---------------------------------------------------------------------------
// Plan card
// ---------------------------------------------------------------------------

function PlanSummary({ plan }: { plan: Plan }) {
  const days = daysUntil(plan.nextCheckin);
  return (
    <section className="rounded-3xl border-2 border-foam bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xl font-semibold uppercase tracking-wide text-teal-deep">Today's plan · Phase {plan.phase}</p>
      <ul className="mt-5 space-y-4">
        {plan.exercises.map((e) => (
          <li key={e.exercise} className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl bg-mist px-5 py-4">
            <span className="text-3xl font-bold text-ink">{EXERCISE_LABELS[e.exercise]}</span>
            <span className="text-2xl text-slate-700">
              {e.reps} reps · goal {e.target}
              {unit(e.exercise)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-2xl text-slate-700">
        Next check-in: <span className="font-bold text-ink">{formatDate(plan.nextCheckin)}</span>
        {days >= 0 && (
          <span className="text-slate-500"> ({days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`})</span>
        )}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One exercise, one arm, driven by the camera module
// ---------------------------------------------------------------------------

function ExerciseStep({
  step,
  index,
  total,
  weakSide,
  goal,
  symmetryPct,
  compensationPct,
  speedUp,
  onDone,
}: {
  step: Step;
  index: number;
  total: number;
  weakSide: 'left' | 'right';
  goal: number | null;
  symmetryPct: number;
  compensationPct: number;
  speedUp: boolean;
  onDone: (result: ExerciseResult, replay: ReplayFile) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const control = useRef<ExerciseControl | null>(null);
  const finished = useRef<{ result: ExerciseResult; replay: ReplayFile } | null>(null);
  const lastWarning = useRef<{ type: NonNullable<LiveFrame['warning']>; at: number } | null>(null);
  const [frame, setFrame] = useState<LiveFrame>({ value: 0, reps: 0 });
  const [warning, setWarning] = useState<LiveFrame['warning']>();
  const [done, setDone] = useState(false);
  const [cameraLive, setCameraLive] = useState(false);
  const handedOff = useRef(false);

  // Hand the result to the page once (the auto-advance timer and the button can race).
  const next = useCallback(() => {
    if (handedOff.current || !finished.current) return;
    handedOff.current = true;
    onDone(finished.current.result, finished.current.replay);
  }, [onDone]);

  const finish = useCallback(() => {
    if (finished.current || !control.current) return;
    finished.current = { result: control.current.stop(), replay: control.current.replay() };
    setWarning(undefined);
    setDone(true);
  }, []);

  // Start the camera module when this step mounts; stop it on unmount.
  // Options are read once per step, so slider changes apply from the next exercise.
  useEffect(() => {
    finished.current = null;
    const ctl = startExercise(
      videoRef.current!,
      step.exercise,
      step.side,
      (f) => {
        setFrame(f);
        const now = performance.now();
        if (f.warning) lastWarning.current = { type: f.warning, at: now };
        // Hold a warning briefly so the banner doesn't flicker between frames.
        const recent = lastWarning.current && now - lastWarning.current.at < 900 ? lastWarning.current.type : undefined;
        setWarning(f.warning ?? recent);
        if (f.reps >= step.reps) finish();
      },
      { symmetryPct, compensationPct, speed: speedUp ? SPEED_UP : 1, weakSide }
    );
    control.current = ctl;
    return () => {
      ctl.stop();
      control.current = null;
    };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps -- options are read once per step on purpose

  // With "Speed up demo" on, move on by itself shortly after the reps are done.
  useEffect(() => {
    if (!done || !speedUp) return;
    const t = window.setTimeout(next, 900);
    return () => window.clearTimeout(t);
  }, [done, speedUp, next]);

  const arm = step.side === 'healthy' ? (weakSide === 'left' ? 'right' : 'left') : weakSide;
  const shownValue = done && finished.current ? finished.current.result.bestValue : frame.value;
  const scaleMax = goal ?? (step.exercise === 'hand_open' ? 100 : 180);
  const pct = Math.min(100, (shownValue / scaleMax) * 100);
  const isLast = index === total - 1;

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xl font-semibold text-slate-500">
          Exercise {index + 1} of {total}
        </p>
        <h2 className="mt-1 text-4xl font-bold text-ink">{EXERCISE_LABELS[step.exercise]}</h2>
        <p className="mt-2 text-2xl text-slate-700">
          {step.side === 'healthy'
            ? `Your stronger arm (${arm}) first — this sets your goal.`
            : `Now your weaker arm (${arm}). Aim for the mark your stronger arm set.`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-3xl bg-slate-800">
          <video
            ref={videoRef}
            className={`aspect-video w-full -scale-x-100 object-cover ${cameraLive ? '' : 'invisible'}`}
            muted
            playsInline
            onLoadedData={() => setCameraLive(true)}
          />
          {!cameraLive && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-xl text-slate-200">
              No camera here — movement is simulated
            </p>
          )}
          <span className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-1 text-sm font-semibold text-white">
            Demo: numbers are simulated
          </span>
        </div>

        <div className="flex flex-col justify-between gap-5 rounded-3xl border-2 border-foam bg-white p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xl text-slate-500">{done ? 'Best' : 'Now'}</p>
              <p className="text-7xl font-bold tabular-nums text-ink">
                {Math.round(shownValue)}
                {unit(step.exercise)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xl text-slate-500">Reps</p>
              <p className="text-6xl font-bold tabular-nums text-teal-deep">
                {Math.min(frame.reps, step.reps)}
                <span className="text-3xl text-slate-400"> / {step.reps}</span>
              </p>
            </div>
          </div>

          <div>
            <div className="h-6 w-full overflow-hidden rounded-full bg-mist">
              <div className="h-full rounded-full bg-teal transition-[width] duration-75" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xl text-slate-600">
              {goal != null
                ? `Goal: ${Math.round(goal)}${unit(step.exercise)} (your stronger arm today)`
                : `Care team target for your weaker arm: ${step.target}${unit(step.exercise)}`}
            </p>
          </div>

          <div
            role="status"
            aria-live="assertive"
            className={`min-h-[72px] rounded-2xl px-5 py-4 text-2xl font-bold ${
              warning ? 'bg-amber-300 text-amber-950' : done ? 'bg-teal-soft text-teal-deep' : 'bg-transparent'
            }`}
          >
            {warning ? WARNING_TEXT[warning] : done ? 'Well done!' : ''}
          </div>

          {done ? (
            <button type="button" className={primaryButton} onClick={next}>
              {isLast ? 'Finish' : 'Next exercise'}
            </button>
          ) : (
            <button type="button" className={secondaryButton} onClick={finish}>
              Stop
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Check-in (pain + tiredness)
// ---------------------------------------------------------------------------

function CheckIn({ onSave }: { onSave: (pain: number, tiredness: number) => void }) {
  const [pain, setPain] = useState<number | null>(null);
  const [tiredness, setTiredness] = useState<number | null>(null);
  const choice = (selected: boolean) =>
    `min-h-[64px] rounded-2xl text-2xl font-bold ring-2 transition ${
      selected ? 'bg-teal-deep text-white ring-teal-deep' : 'bg-white text-ink ring-foam hover:ring-teal'
    }`;
  return (
    <section className="space-y-8">
      <h2 className="text-4xl font-bold text-ink">How do you feel?</h2>
      <div>
        <p className="text-2xl font-semibold text-slate-700">Pain right now (0 = none, 10 = worst)</p>
        <div className="mt-3 grid grid-cols-6 gap-3 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" aria-pressed={pain === n} className={choice(pain === n)} onClick={() => setPain(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-2xl font-semibold text-slate-700">How tired are you?</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {TIREDNESS_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={tiredness === i + 1}
              className={`${choice(tiredness === i + 1)} px-3`}
              onClick={() => setTiredness(i + 1)}
            >
              {i + 1} · {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className={`${primaryButton} w-full`}
        disabled={pain == null || tiredness == null}
        onClick={() => pain != null && tiredness != null && onSave(pain, tiredness)}
      >
        Save my session
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Stage = 'home' | 'exercise' | 'checkin' | 'saving' | 'result';

interface Outcome {
  saved: SessionUploadResponse | null;
  error: string | null;
  replaysSent: number;
  replaysTotal: number;
}

export default function PatientDemo({ id }: { id: string }) {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState(false);
  const seenPlanId = useRef<string | null | undefined>(undefined);

  // Demo controls
  const [symmetryPct, setSymmetryPct] = useState(70);
  const [compensationPct, setCompensationPct] = useState(DEFAULT_COMPENSATION);
  const [speedUp, setSpeedUp] = useState(true);
  const symmetryTouched = useRef(false);

  // Session in progress
  const [stage, setStage] = useState<Stage>('home');
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const startedAt = useRef(0);
  const results = useRef<ExerciseResult[]>([]);
  const replays = useRef<ReplayFile[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const patient = patients?.find((p) => p.id === id) ?? null;

  const loadPlan = useCallback(async () => {
    const p = await getApprovedPlan(id);
    const planId = p?.id ?? null;
    // A different approved plan than the one already on screen = the care team approved a new one.
    if (seenPlanId.current !== undefined && planId && planId !== seenPlanId.current) setNewPlan(true);
    seenPlanId.current = planId;
    setPlan(p);
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const list = await getPatients();
        setPatients(list);
        const me = list.find((p) => p.id === id);
        if (!me) {
          setError('Patient not found');
          return;
        }
        if (me.latestSymmetry != null && !symmetryTouched.current) setSymmetryPct(me.latestSymmetry);
        await loadPlan();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not reach the API');
      }
    })();
    return () => releaseCamera();
  }, [id, loadPlan]);

  // Poll the approved plan every 5 s so a newly approved plan shows up on its own.
  usePolling(async () => {
    if (plan === undefined) return;
    try {
      await loadPlan();
      setPollError(null);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : 'Lost connection');
    }
  });

  function startSession() {
    if (!plan) return;
    setSteps(stepsFor(plan));
    setStepIndex(0);
    results.current = [];
    replays.current = [];
    startedAt.current = Date.now();
    setOutcome(null);
    setStage('exercise');
  }

  const onStepDone = useCallback(
    (result: ExerciseResult, replay: ReplayFile) => {
      results.current = [...results.current.filter((r) => !(r.exercise === result.exercise && r.side === result.side)), result];
      replays.current = [...replays.current, replay];
      if (stepIndex + 1 < steps.length) {
        setStepIndex(stepIndex + 1);
      } else {
        releaseCamera();
        setStage('checkin');
      }
    },
    [stepIndex, steps.length]
  );

  async function save(pain: number, tiredness: number) {
    setStage('saving');
    const next: Outcome = { saved: null, error: null, replaysSent: 0, replaysTotal: replays.current.length };
    try {
      next.saved = await postSession({
        patientId: id,
        startedAt: startedAt.current,
        endedAt: Date.now(),
        pain,
        tiredness,
        results: results.current,
      });
    } catch (e) {
      next.error = e instanceof Error ? e.message : 'Could not save';
      setOutcome(next);
      setStage('checkin');
      return;
    }
    // Replays are extra: the session is already saved even if one fails.
    for (const replay of replays.current) {
      try {
        await uploadReplay(next.saved.session.id, replay);
        next.replaysSent++;
      } catch {
        /* counted as not sent */
      }
    }
    setOutcome(next);
    setStage('result');
  }

  // Goal for the weak arm = the healthy arm's best for the same exercise today.
  const step = steps[stepIndex];
  const goal =
    step?.side === 'weak'
      ? results.current.find((r) => r.exercise === step.exercise && r.side === 'healthy')?.bestValue ?? null
      : null;

  if (error) {
    return (
      <div className="rounded-3xl border-2 border-amber-300 bg-alert-soft p-8 text-2xl">
        <p className="font-bold text-alert">{error}</p>
        <Link to="/patient/p-maria" className="mt-4 inline-block text-teal-deep underline">
          Open Maria's demo view
        </Link>
      </div>
    );
  }

  if (plan === undefined || !patients) {
    return <p className="text-2xl text-slate-600">Loading your plan…</p>;
  }

  const firstName = patient?.name.split(' ')[0] ?? 'there';

  return (
    <div className="mx-auto max-w-4xl space-y-8 text-ink">
      {newPlan && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-teal-deep px-6 py-5 text-white shadow-lg">
          <p className="text-3xl font-bold">New plan from your care team</p>
          <button
            type="button"
            className="min-h-[60px] rounded-2xl bg-white px-6 text-xl font-bold text-teal-deep"
            onClick={() => setNewPlan(false)}
          >
            OK
          </button>
        </div>
      )}
      {pollError && (
        <p className="rounded-2xl bg-alert-soft px-5 py-3 text-xl text-alert">Can't reach the care team right now. Retrying…</p>
      )}

      {stage === 'home' && (
        <>
          <h1 className="text-5xl font-bold">Hello, {firstName}</h1>
          {plan ? (
            <>
              <PlanSummary plan={plan} />
              <button type="button" className={`${primaryButton} w-full text-3xl`} onClick={startSession}>
                Start today's session
              </button>
            </>
          ) : (
            <section className="rounded-3xl border-2 border-foam bg-white p-8">
              <p className="text-3xl font-bold">No plan yet</p>
              <p className="mt-3 text-2xl text-slate-700">
                Your care team hasn't set up your exercises yet. This page will update by itself when they do.
              </p>
            </section>
          )}
        </>
      )}

      {stage === 'exercise' && step && patient && (
        <ExerciseStep
          key={stepIndex}
          step={step}
          index={stepIndex}
          total={steps.length}
          weakSide={patient.weakSide}
          goal={goal}
          symmetryPct={symmetryPct}
          compensationPct={compensationPct}
          speedUp={speedUp}
          onDone={onStepDone}
        />
      )}

      {stage === 'checkin' && (
        <>
          {outcome?.error && (
            <p className="rounded-2xl bg-alert-soft px-5 py-4 text-2xl text-alert">
              Couldn't save ({outcome.error}). Please try again.
            </p>
          )}
          <CheckIn onSave={save} />
        </>
      )}

      {stage === 'saving' && <p className="text-3xl font-bold text-slate-700">Saving your session…</p>}

      {stage === 'result' && outcome?.saved && (
        <ResultScreen outcome={outcome} saved={outcome.saved} onHome={() => setStage('home')} />
      )}

      <DemoControls
        patients={patients}
        id={id}
        locked={stage !== 'home'}
        latestSymmetry={patient?.latestSymmetry ?? null}
        symmetryPct={symmetryPct}
        compensationPct={compensationPct}
        speedUp={speedUp}
        onSymmetry={(v) => {
          symmetryTouched.current = true;
          setSymmetryPct(v);
        }}
        onCompensation={setCompensationPct}
        onSpeedUp={setSpeedUp}
        onPatient={(pid) => navigate(`/patient/${pid}`)}
      />

      <p className="rounded-2xl bg-white px-5 py-4 text-xl text-slate-700 ring-1 ring-foam">
        <span className="font-bold text-rose-700">Stroke warning signs:</span> face drooping, arm weakness, speech
        difficulty. <span className="font-bold">Call 911 right away.</span>
      </p>
    </div>
  );
}

function ResultScreen({
  outcome,
  saved,
  onHome,
}: {
  outcome: Outcome;
  saved: SessionUploadResponse;
  onHome: () => void;
}) {
  const byExercise = (['arm_raise', 'forward_reach', 'hand_open'] as Exercise[])
    .map((ex) => {
      const healthy = saved.results.find((r) => r.exercise === ex && r.side === 'healthy');
      const weak = saved.results.find((r) => r.exercise === ex && r.side === 'weak');
      if (!healthy || !weak || !healthy.bestValue) return null;
      return { ex, pct: Math.round((weak.bestValue / healthy.bestValue) * 100) };
    })
    .filter((x): x is { ex: Exercise; pct: number } => x !== null);

  return (
    <section className="space-y-6">
      <h2 className="text-5xl font-bold text-teal-deep">Session saved</h2>
      {byExercise.length > 0 && (
        <ul className="space-y-3">
          {byExercise.map(({ ex, pct }) => (
            <li key={ex} className="rounded-2xl bg-white px-5 py-4 text-2xl ring-1 ring-foam">
              <span className="font-bold">{EXERCISE_LABELS[ex]}:</span> your weaker arm reached{' '}
              <span className="font-bold">{pct}%</span> of your stronger arm
            </li>
          ))}
        </ul>
      )}
      {saved.alertsCreated.length > 0 ? (
        <ul className="space-y-3">
          {saved.alertsCreated.map((a) => (
            <li key={a.id} className="rounded-2xl bg-amber-100 px-5 py-4 text-2xl text-amber-950">
              {ALERT_WORDS[a.type]}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-2xl text-slate-700">No new alerts for your care team.</p>
      )}
      <p className="rounded-2xl bg-teal-soft px-5 py-4 text-2xl font-semibold text-teal-deep">
        {saved.planSuggested ? 'Your care team will review a new plan.' : 'Keep following your current plan.'}
      </p>
      <p className="text-lg text-slate-500">
        3D recordings sent: {outcome.replaysSent} of {outcome.replaysTotal}
      </p>
      <button type="button" className={`${primaryButton} w-full`} onClick={onHome}>
        Back to home
      </button>
    </section>
  );
}

function DemoControls({
  patients,
  id,
  locked,
  latestSymmetry,
  symmetryPct,
  compensationPct,
  speedUp,
  onSymmetry,
  onCompensation,
  onSpeedUp,
  onPatient,
}: {
  patients: PatientSummary[];
  id: string;
  locked: boolean;
  latestSymmetry: number | null;
  symmetryPct: number;
  compensationPct: number;
  speedUp: boolean;
  onSymmetry: (v: number) => void;
  onCompensation: (v: number) => void;
  onSpeedUp: (v: boolean) => void;
  onPatient: (id: string) => void;
}) {
  return (
    <details className="rounded-2xl border border-dashed border-slate-400 bg-slate-50 px-5 py-4 text-base text-slate-700">
      <summary className="cursor-pointer text-lg font-semibold text-slate-600">Demo controls</summary>
      <div className="mt-4 space-y-5">
        <label className="block">
          <span className="font-semibold">Patient</span>
          <select
            className="ml-3 rounded-md border border-slate-300 bg-white px-2 py-1"
            value={id}
            disabled={locked}
            onChange={(e) => onPatient(e.target.value)}
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-semibold">Simulated symmetry: {symmetryPct}%</span>
          <span className="text-slate-500"> (weak-arm peak ÷ healthy; latest on file {latestSymmetry ?? '—'}%)</span>
          <input
            type="range"
            min={10}
            max={100}
            value={symmetryPct}
            onChange={(e) => onSymmetry(Number(e.target.value))}
            className="mt-2 block w-full accent-teal-deep"
          />
        </label>
        <label className="block">
          <span className="font-semibold">Simulated compensation: {compensationPct}%</span>
          <span className="text-slate-500"> (weak-arm reps with lean / shoulder hike; over 50% raises an alert)</span>
          <input
            type="range"
            min={0}
            max={100}
            value={compensationPct}
            onChange={(e) => onCompensation(Number(e.target.value))}
            className="mt-2 block w-full accent-teal-deep"
          />
        </label>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={speedUp} onChange={(e) => onSpeedUp(e.target.checked)} className="h-5 w-5 accent-teal-deep" />
          <span className="font-semibold">Speed up demo</span>
          <span className="text-slate-500">(≈ 30 s per session instead of a few minutes)</span>
        </label>
        <p className="text-sm text-slate-500">Slider changes apply from the next exercise. Mock camera: values are simulated.</p>
      </div>
    </details>
  );
}
