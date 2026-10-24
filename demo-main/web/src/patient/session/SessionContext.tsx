// Holds today's session while the patient moves through the screens, and saves it to the API once.
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExerciseResult, Plan, ReplayFile, Side, StopReason } from '../../types';
import { saveSession, type SaveInput, type SaveOutcome } from '../api';
import { usePatientData } from '../PatientData';
import type { RoundStats } from './repCounter';

/** Idempotency key for the upload. crypto.randomUUID is missing on plain-http LAN origins (npm run dev:lan). */
export function newClientKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface Step {
  exerciseIndex: number;
  role: Side;
}

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; outcome: SaveOutcome }
  | { status: 'failed'; error: string };

interface SessionValue {
  /** The plan as it was when the session began; a plan approved mid-session applies to the next one. */
  plan: Plan | null;
  startedAt: string;
  pain: number | null;
  tiredness: number | null;
  results: ExerciseResult[];
  /** One ReplayFile per finished round (exercise + arm). */
  replays: ReplayFile[];
  saveState: SaveState;
  begin(plan: Plan): void;
  setCheckIn(pain: number, tiredness: number): void;
  addRound(step: Step, stats: RoundStats, replay: ReplayFile | null): void;
  /** The step after `step`, or null when every exercise is done. Healthy arm always goes first. */
  next(step: Step): Step | null;
  /** Upload the session (POST /sessions + replays). Only uploads once per session; retry after a failure. */
  save(stopReason?: StopReason): Promise<SaveOutcome>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { patient, refresh } = usePatientData();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  // New per session (begin), reused by every retry of that session's upload.
  const [clientKey, setClientKey] = useState(newClientKey);
  const [pain, setPain] = useState<number | null>(null);
  const [tiredness, setTiredness] = useState<number | null>(null);
  const [results, setResults] = useState<ExerciseResult[]>([]);
  const [replays, setReplays] = useState<ReplayFile[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const saving = useRef<Promise<SaveOutcome> | null>(null);

  const value = useMemo<SessionValue>(
    () => ({
      plan,
      startedAt,
      pain,
      tiredness,
      results,
      replays,
      saveState,
      begin(p) {
        setPlan(p);
        setStartedAt(new Date().toISOString());
        setClientKey(newClientKey());
        setPain(null);
        setTiredness(null);
        setResults([]);
        setReplays([]);
        setSaveState({ status: 'idle' });
        saving.current = null;
      },
      setCheckIn(p, t) {
        setPain(p);
        setTiredness(t);
      },
      addRound(step, stats, replay) {
        if (!plan) return;
        const exercise = plan.exercises[step.exerciseIndex].exercise;
        const same = (r: { exercise: string; side: string }) => r.exercise === exercise && r.side === step.role;
        setResults((rs) => [...rs.filter((r) => !same(r)), { exercise, side: step.role, ...stats }]);
        setReplays((rs) => [...rs.filter((r) => !same(r)), ...(replay ? [replay] : [])]);
      },
      next(step) {
        if (step.role === 'healthy') return { ...step, role: 'weak' };
        const n = plan?.exercises.length ?? 0;
        return step.exerciseIndex + 1 < n ? { exerciseIndex: step.exerciseIndex + 1, role: 'healthy' } : null;
      },
      save(stopReason) {
        if (!saving.current) {
          setSaveState({ status: 'saving' });
          const input: SaveInput & { clientKey: string } = {
            clientKey,
            patientId: patient.id,
            startedAt,
            endedAt: new Date().toISOString(),
            pain,
            tiredness,
            stopReason,
            results,
            replays,
          };
          saving.current = saveSession(input).then(
            (outcome) => {
              setSaveState({ status: 'saved', outcome });
              void refresh();
              return outcome;
            },
            (e: unknown) => {
              saving.current = null; // allow a retry
              setSaveState({ status: 'failed', error: e instanceof Error ? e.message : 'Could not save' });
              throw e;
            },
          );
        }
        return saving.current;
      },
    }),
    [plan, startedAt, clientKey, pain, tiredness, results, replays, saveState, patient.id, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
