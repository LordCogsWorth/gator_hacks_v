// Today's session on one page: the coach (stick figure + spoken steps, as in ExerciseExplainer) is pinned in a
// collapsible column to the left of Kyle's live dashboard (public/kyle/, embedded with ?embed=patient: watch panels hidden). "Start Exercise"
// there counts reps on the stronger arm, then straight on to the weaker arm, and only then runs the muscle
// analysis. The frame is sized to its content so the page scrolls as one, and stays mounted for the whole
// session so the camera never restarts. Each finished arm is saved; after both arms the next exercise
// follows, and after the last one the dashboard's buttons become one "View my summary" button. "Skip Exercise"
// moves on without saving; on the last exercise it ends the session the same way. "Stop" asks about
// warning symptoms: yes → safety stop, no → the session ends (summary); ✕ closes the question and carries on.
// Watch data is still recorded in the background and saved with each arm.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { saveCameraAnalysis } from '../../api';
import type { BodySide, CameraAnalysis, Exercise, Plan, Side } from '../../types';
import { Avatar } from '../components/ExerciseAvatar';
import { EXERCISES } from '../data/exercises';
import { usePatientData } from '../PatientData';
import type { RoundStats } from '../session/repCounter';
import { useSession } from '../session/SessionContext';
import { roundToStats, saveWatchSession, useWatchRecorder } from '../session/watchRecorder';
import { speak, speakLines, useSpeakOnMount } from '../voice/useVoice';
import './kyle-session.css';

/** What the embedded dashboard posts after both arms (public/kyle/app.js → publishReport). */
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

/** One arm finished on the camera (rehabtrack:arm). */
interface ArmDone {
  side: 'L' | 'R';
  reps: number;
  peakDeg: number;
}

/** Camera reps and best arm-raise angle for one arm → round stats (used when the watch sent nothing). */
function cameraToStats(arm: ArmDone, exercise: Exercise): RoundStats | null {
  if (exercise === 'hand_open' || arm.peakDeg <= 0) return null;
  return {
    bestValue: arm.peakDeg,
    reps: arm.reps,
    secPerRep: 0,
    smoothness: 1,
    fatigue: 1,
    trunkLeanMax: 0,
    shoulderHikeMax: 0,
    compRepPct: 0,
    ...(exercise === 'forward_reach' ? { reachCm: null } : {}),
  };
}

const toKey = (side: BodySide) => (side === 'left' ? 'L' : 'R');

/** Asked when the patient presses Stop. */
const STOP_SYMPTOMS = [
  'Dizziness or lightheadedness',
  'New or worse weakness or numbness, especially on one side',
  'Shortness of breath or chest pain',
  'Sudden trouble speaking or seeing, or a severe headache',
];

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
  const [finished, setFinished] = useState(false);
  const [askStop, setAskStop] = useState(false);
  const [coachOpen, setCoachOpen] = useState(true);
  const [cameraSaved, setCameraSaved] = useState<string | null>(null);
  const info = EXERCISES[plan.exercises[index].exercise];
  const reps = plan.exercises[index].reps;
  const last = index + 1 >= plan.exercises.length;
  const healthySide: BodySide = patient.weakSide === 'right' ? 'left' : 'right';

  // The embedded dashboard: tell it what to count, and grow it to its content height.
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(900);
  const toFrame = (msg: object) => frame.current?.contentWindow?.postMessage(msg, location.origin);
  const sendExercise = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      {
        type: 'rehabtrack:exercise',
        exercise: info.id,
        sides: [toKey(healthySide), toKey(patient.weakSide)],
        target: reps,
        // The plan's goal angle (e.g. side raise 90°): the dashboard's % is measured against it.
        goalDeg: plan.exercises[index].target,
      },
      location.origin,
    );
  }, [info.id, healthySide, patient.weakSide, reps, plan, index]);
  useEffect(sendExercise, [sendExercise]);
  // The dashboard asks for the camera through this page (public/kyle/index.html), so the browser's
  // permission prompt shows for the page itself rather than for the frame. The camera is asked for once, on the
  // first Start Exercise, and reused for the rest of the session (next exercises, Pause → Resume); it is
  // released when the patient leaves the session, so the next session asks again.
  useEffect(() => {
    const w = window as Window & { __rehabtrackGetCamera?: (c: MediaStreamConstraints) => Promise<MediaStream> };
    let stream: Promise<MediaStream> | null = null;
    w.__rehabtrackGetCamera = async (c) => {
      const live = stream && (await stream.catch(() => null))?.getVideoTracks().some((t) => t.readyState === 'live');
      if (!live) stream = navigator.mediaDevices.getUserMedia(c);
      const s = await stream!.catch((err) => {
        stream = null;
        throw err;
      });
      s.getTracks().forEach((t) => (t.enabled = true));
      return s;
    };
    return () => {
      delete w.__rehabtrackGetCamera;
      void stream?.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
    };
  }, []);
  const resize = useRef<ResizeObserver>();
  useEffect(() => () => resize.current?.disconnect(), []);
  const onFrameLoad = () => {
    sendExercise();
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    shareFonts(doc);
    resize.current?.disconnect();
    resize.current = new ResizeObserver(() => setFrameHeight(doc.body.scrollHeight));
    resize.current.observe(doc.body);
  };

  /** Save one arm into today's session (watch data first, else the camera's) and as a watch session row. */
  const saveArm = (arm: ArmDone) => {
    const armRole: Side = arm.side === toKey(healthySide) ? 'healthy' : 'weak';
    const armSide: BodySide = arm.side === 'L' ? 'left' : 'right';
    const r = watch.current();
    const stats = roundToStats(r, info.id) ?? cameraToStats(arm, info.id);
    if (stats) session.addRound({ exerciseIndex: index, role: armRole }, stats, null);
    void saveWatchSession(r, patient.id, info.id, armSide, reps);
    watch.reset();
    if (armRole === 'healthy') {
      speak(`Great job. Now your weaker ${patient.weakSide} arm.`);
    }
  };

  /** Both arms done and analysed: save the camera result, then the next exercise (or the summary button). */
  const onReport = (r: CameraReport) => {
    setCameraSaved('Saving camera result…');
    saveCameraAnalysis({
      patientId: patient.id,
      createdAt: r.createdAt ?? new Date().toISOString(),
      exercise: info.id,
      arm: patient.weakSide,
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
    if (last) {
      speak('Great work. Both arms done. Session complete.');
      setFinished(true);
    } else {
      speak('Great work. Both arms done. Have a look at your results, then the next exercise.');
      setIndex((i) => i + 1);
    }
  };

  /** Skip Exercise: on to the next one without saving. On the last one it ends the session (summary button). */
  const onSkip = () => {
    if (last) {
      speak('Exercise skipped. Your session is complete.');
      setFinished(true);
      return;
    }
    speak('Exercise skipped.');
    setIndex((i) => i + 1);
  };

  // Messages from the dashboard. Read through a ref: the listener is set up once.
  const handlers = useRef({ saveArm, onReport, onSkip });
  handlers.current = { saveArm, onReport, onSkip };
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const d = e.data;
      if (d?.type === 'rehabtrack:arm') handlers.current.saveArm(d as ArmDone);
      else if (d?.type === 'rehabtrack:camera-report') handlers.current.onReport(d.report as CameraReport);
      else if (d?.type === 'rehabtrack:skip') handlers.current.onSkip();
      else if (d?.type === 'rehabtrack:summary') navigate('/patient/summary');
      else if (d?.type === 'rehabtrack:reset') watch.reset();
      else if (d?.type === 'rehabtrack:stop') {
        setAskStop(true);
        speak(`Are you feeling any of these symptoms? ${STOP_SYMPTOMS.join('. ')}.`);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- handlers are read through the ref

  // Session finished: the dashboard swaps its buttons for "View my summary".
  useEffect(() => {
    if (finished) toFrame({ type: 'rehabtrack:finished' });
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps -- toFrame only reads the ref

  // New exercise: fresh watch recording, and the coach opens again to show it.
  useEffect(() => {
    watch.reset();
    setCameraSaved(null);
    setCoachOpen(true);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps -- only on a new exercise

  return (
    <div className="kyle-scope">
      <div className="kyle-head">
        <div>
          <h1>
            {index + 1}/{plan.exercises.length} · {info.title}
          </h1>
        </div>
      </div>

      {cameraSaved && <p className="kyle-note kyle-saved">📷 {cameraSaved}</p>}
      <div className={`kyle-layout${coachOpen ? '' : ' coach-closed'}`}>
        <Coach key={info.id} info={info} open={coachOpen} onToggle={() => setCoachOpen((o) => !o)} />
        <iframe
          ref={frame}
          className="kyle-frame"
          style={{ height: frameHeight }}
          scrolling="no"
          src="/kyle/index.html?embed=patient"
          title="Live session: camera and 3D muscle model"
          allow="camera; microphone; autoplay; fullscreen"
          onLoad={onFrameLoad}
        />
      </div>

      {askStop && (
        <div className="kyle-dialog-backdrop">
          <div className="kyle-card kyle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="kyle-stop-q">
            <button
              className="kyle-dialog-close"
              aria-label="Close and keep going"
              onClick={() => {
                setAskStop(false);
                toFrame({ type: 'rehabtrack:resume' });
              }}
            >
              ✕
            </button>
            <h2 id="kyle-stop-q">Are you feeling any of these symptoms?</h2>
            <ul className="kyle-symptoms">
              {STOP_SYMPTOMS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <div className="kyle-actions half">
              <button className="kyle-btn danger" onClick={() => navigate('/patient/stop?reason=dizzy')}>
                Yes
              </button>
              <button className="kyle-btn" onClick={() => navigate('/patient/summary')}>
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The app's fonts (Source Sans 3, IBM Plex Sans) for the embedded dashboard: copy the @font-face rules in. */
function shareFonts(doc: Document) {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSFontFaceRule) rules.push(rule.cssText);
    } catch {
      // A stylesheet from another origin can't be read; the app's own fonts are same-origin.
    }
  }
  const style = doc.createElement('style');
  style.textContent = rules.join('\n');
  doc.head.appendChild(style);
}

/** The coach acts out the exercise and reads the steps aloud, highlighting each one. Collapses to a thin tab. */
function Coach({ info, open, onToggle }: { info: (typeof EXERCISES)[keyof typeof EXERCISES]; open: boolean; onToggle: () => void }) {
  const [current, setCurrent] = useState(-1);

  useEffect(() => {
    setCurrent(-1);
    speakLines(
      [
        `Let me show you: ${info.title}.`,
        ...info.steps,
        'We will do your stronger arm first, then your weaker arm. Press Start Exercise when you are ready.',
      ],
      (i) => setCurrent(i - 1),
    );
  }, [info]);

  return (
    <aside className="kyle-coach-col">
      <button
        className="kyle-coach-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Hide the coach' : 'Show the coach'}
      >
        {open ? '‹ Your coach' : '›'}
      </button>
      {open && (
        <>
          <div className="kyle-coach">
            <Avatar exercise={info.id} />
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
          </div>
        </>
      )}
    </aside>
  );
}
