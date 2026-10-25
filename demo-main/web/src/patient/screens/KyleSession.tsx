// Today's session, using Kyle's live dashboard (public/kyle/, unchanged copy of Kyle/server/public).
// For each exercise in the plan: the coach explains it (same behaviour as ExerciseExplainer, in the style
// of Kyle's dashboard) → "I'm ready" opens Kyle's dashboard (camera pose + hand tracking, 3D model and the
// live Apple Watch panel) → "I'm done with this exercise" moves on; after the last one, the summary.
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { saveCameraAnalysis } from '../../api';
import type { BodySide, CameraAnalysis, Exercise, Plan, Side } from '../../types';
import { Avatar } from '../components/ExerciseAvatar';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';
import type { RoundStats } from '../session/repCounter';
import { useSession } from '../session/SessionContext';
import { roundReps, roundToStats, saveWatchSession, useWatchRecorder } from '../session/watchRecorder';
import { speak, speakLines, useSpeakOnMount } from '../voice/useVoice';
import './kyle-session.css';

/** What the embedded dashboard posts after Analyze (public/kyle/app.js → publishReport). */
interface CameraReport {
  createdAt?: string;
  shoulder?: CameraAnalysis['shoulder'];
  maxArmSpeedDegS?: number;
  peakArmSpeedDegS?: number;
  vitals?: { heartRate?: number | null; watchSpeed?: number | null };
  heightCm?: number | null;
  joints?: CameraAnalysis['joints'];
  findings?: CameraAnalysis['findings'];
}

/** Camera arm-raise angle for one arm → round stats (used when the watch sent nothing). */
function cameraToStats(r: CameraReport | null, side: BodySide, exercise: Exercise): RoundStats | null {
  const s = r?.shoulder?.[side === 'left' ? 'L' : 'R'];
  if (!s || exercise === 'hand_open') return null;
  return {
    bestValue: s.peakDeg,
    reps: 1,
    secPerRep: 0,
    smoothness: 1,
    fatigue: 1,
    trunkLeanMax: 0,
    shoulderHikeMax: 0,
    compRepPct: 0,
    ...(exercise === 'forward_reach' ? { reachCm: null } : {}),
  };
}

type Phase = 'explain' | 'live';

export function KyleSession() {
  const session = useSession();
  // Opened without a check-in (e.g. after a page refresh): start again from the dashboard.
  if (!session.plan || session.pain === null) return <Navigate to="/patient" replace />;
  if (!session.plan.exercises.length) return <NoExercises />;
  return <Run plan={session.plan} />;
}

function NoExercises() {
  const navigate = useNavigate();
  const text = 'There are no exercises in your plan today. Your care team will add them.';
  useSpeakOnMount(text);
  return (
    <div className="kyle-scope" style={{ textAlign: 'center' }}>
      <div className="kyle-head" style={{ justifyContent: 'center' }}>
        <h1>No exercises today</h1>
      </div>
      <p style={{ fontSize: 18, color: 'var(--k-muted)' }}>{text}</p>
      <div className="kyle-actions">
        <button className="kyle-btn primary" onClick={() => navigate('/patient')}>
          Back to Home
        </button>
      </div>
    </div>
  );
}

function Run({ plan }: { plan: Plan }) {
  const navigate = useNavigate();
  const session = useSession();
  const { patient } = usePatientData();
  const watch = useWatchRecorder();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('explain');
  const [role, setRole] = useState<Side>('healthy');
  const [live, setLive] = useState({ reps: 0, best: 0, samples: 0 });
  const info = EXERCISES[plan.exercises[index].exercise];
  const reps = plan.exercises[index].reps;
  const last = index + 1 >= plan.exercises.length;
  const healthySide: BodySide = patient.weakSide === 'right' ? 'left' : 'right';
  const side: BodySide = role === 'healthy' ? healthySide : patient.weakSide;

  useEffect(
    () => watch.subscribe((r) => setLive({ reps: roundReps(r), best: Math.round(r.bestElevation), samples: r.samples })),
    [], // eslint-disable-line react-hooks/exhaustive-deps -- subscribe once
  );

  // Camera "Analyze" results from the embedded dashboard → saved to the patient's account.
  const camera = useRef<CameraReport | null>(null);
  const [cameraSaved, setCameraSaved] = useState<string | null>(null);
  const ctx = useRef({ exercise: info.id, side });
  ctx.current = { exercise: info.id, side };
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== 'rehabtrack:camera-report') return;
      const r = e.data.report as CameraReport;
      camera.current = r;
      setCameraSaved('Saving camera result…');
      saveCameraAnalysis({
        patientId: patient.id,
        createdAt: r.createdAt ?? new Date().toISOString(),
        exercise: ctx.current.exercise,
        arm: ctx.current.side,
        shoulder: r.shoulder ?? { L: null, R: null },
        maxArmSpeedDegS: r.maxArmSpeedDegS ?? null,
        peakArmSpeedDegS: r.peakArmSpeedDegS ?? null,
        heartRate: r.vitals?.heartRate ?? null,
        wristSpeed: r.vitals?.watchSpeed ?? null,
        heightCm: r.heightCm ?? null,
        joints: r.joints ?? {},
        findings: r.findings ?? [],
      })
        .then(() => setCameraSaved('Camera result saved ✓'))
        .catch((err) => {
          console.warn('Camera result not saved', err);
          setCameraSaved('Camera result not saved');
        });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [patient.id]);

  const start = () => {
    speak(`Starting ${info.title}. Use your stronger ${healthySide} arm first. Follow the camera and your watch.`);
    setRole('healthy');
    watch.reset();
    camera.current = null;
    setCameraSaved(null);
    setPhase('live');
  };

  /** Save this arm's watch data into today's session (and as a watch session row). */
  const saveRound = () => {
    const r = watch.current();
    // Watch first; if the watch sent nothing, use the camera's angle for this arm.
    const stats = roundToStats(r, info.id) ?? cameraToStats(camera.current, side, info.id);
    if (stats) session.addRound({ exerciseIndex: index, role }, stats, null);
    void saveWatchSession(r, patient.id, info.id, side, reps);
    camera.current = null;
    setCameraSaved(null);
  };

  const done = () => {
    saveRound();
    if (role === 'healthy') {
      setRole('weak');
      watch.reset();
      speak(`Now your weaker ${patient.weakSide} arm. Try to match your other arm.`);
      return;
    }
    if (last) {
      speak('Great work. Session complete.');
      navigate('/patient/summary');
    } else {
      setIndex((i) => i + 1);
      setRole('healthy');
      setPhase('explain');
    }
  };

  return (
    <div className="kyle-scope">
      <div className="kyle-head">
        <div>
          <h1>
            {index + 1}/{plan.exercises.length} · {info.title}
          </h1>
          <div className="kyle-sub">
            {reps} reps · stronger arm first, then your weaker arm
          </div>
        </div>
        <span className={`kyle-pill${phase === 'live' ? ' live' : ''}`}>
          <span className="dot" />
          {phase === 'live'
            ? `${role === 'healthy' ? 'Stronger' : 'Weaker'} arm (${side}) · recording`
            : 'Coach'}
        </span>
      </div>

      {phase === 'explain' ? (
        <Explainer key={info.id} info={info} onStart={start} />
      ) : (
        <>
          <div className="kyle-watchbar" role="status">
            <span>
              ⌚ Watch reps <b>{live.reps}</b>/{reps}
            </span>
            <span>
              Best angle <b>{live.best}°</b>
            </span>
            <span className={live.samples ? 'ok' : 'wait'}>
              {live.samples ? 'Receiving watch data' : 'Waiting for your watch… start the exercise on it'}
            </span>
            {cameraSaved && <span className="ok">📷 {cameraSaved}</span>}
          </div>
          <iframe
            className="kyle-frame"
            src="/kyle/index.html"
            title="Live session: camera and Apple Watch"
            allow="camera; microphone; autoplay; fullscreen"
          />
          <p className="kyle-note">
            Put the watch on your {side} wrist and start the same exercise on it. This arm's watch data is saved when you press the button below.
          </p>
        </>
      )}

      <div className="kyle-actions half">
        <button className="kyle-btn primary" disabled={phase !== 'live'} onClick={done}>
          {role === 'healthy' ? 'Save & switch to weaker arm' : last ? 'Save & finish session' : 'Save & next exercise'}
        </button>
        <button className="kyle-btn danger" onClick={() => navigate('/patient/stop?reason=dizzy')}>
          I feel dizzy or unwell
        </button>
      </div>
    </div>
  );
}

/** The coach acts out the exercise and reads the steps aloud, highlighting each one. */
function Explainer({ info, onStart }: { info: (typeof EXERCISES)[keyof typeof EXERCISES]; onStart: () => void }) {
  const [current, setCurrent] = useState(-1);
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    setCurrent(-1);
    speakLines(
      [`Let me show you: ${info.title}.`, ...info.steps, 'We will do your stronger arm first, then your weaker arm.'],
      (i) => setCurrent(i - 1),
    );
  }, [info, replay]);

  return (
    <>
      <div className="kyle-grid">
        <div className="kyle-coach">
          <Avatar exercise={info.id} />
          <div className="label">Your coach</div>
        </div>
        <div className="kyle-card kyle-bubble">
          <h2>{info.title}</h2>
          <ol className="kyle-steps">
            {info.steps.map((s, i) => (
              <li key={s} aria-current={current === i || undefined}>
                <span className="n">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <p className="kyle-tip">Stronger arm first, then your weaker arm.</p>
        </div>
      </div>
      <div className="kyle-actions two">
        <button className="kyle-btn primary" onClick={onStart}>
          ▶ I'm ready, let's start
        </button>
        <button className="kyle-btn" onClick={() => setReplay((r) => r + 1)}>
          ↻ Explain again
        </button>
      </div>
    </>
  );
}
