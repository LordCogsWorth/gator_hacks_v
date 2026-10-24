// Holds today's session while the patient moves through the screens.
import { createContext, useContext, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Joint3D } from '../camera/types';
import type { ArmRole, ExerciseResult } from '../types';
import type { RoundStats } from './repCounter';
import { getCurrentPlan } from '../api';

export interface Step {
  exerciseIndex: number;
  role: ArmRole;
}

interface SessionValue {
  sessionId: string;
  startedAt: string;
  pain: number | null;
  tiredness: number | null;
  results: ExerciseResult[];
  /** 3D joints sampled at 15 fps across the whole session. */
  replay: MutableRefObject<Joint3D[][]>;
  begin(): void;
  setCheckIn(pain: number, tiredness: number): void;
  addRound(step: Step, stats: RoundStats): void;
  /** The step after `step`, or null when every exercise is done. Healthy arm always goes first. */
  next(step: Step): Step | null;
}

const Ctx = createContext<SessionValue | null>(null);

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState(newId);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [pain, setPain] = useState<number | null>(null);
  const [tiredness, setTiredness] = useState<number | null>(null);
  const [results, setResults] = useState<ExerciseResult[]>([]);
  const replay = useRef<Joint3D[][]>([]);

  const value = useMemo<SessionValue>(
    () => ({
      sessionId,
      startedAt,
      pain,
      tiredness,
      results,
      replay,
      begin() {
        setSessionId(newId());
        setStartedAt(new Date().toISOString());
        setPain(null);
        setTiredness(null);
        setResults([]);
        replay.current = [];
      },
      setCheckIn(p, t) {
        setPain(p);
        setTiredness(t);
      },
      addRound(step, stats) {
        const exercise = getCurrentPlan().exercises[step.exerciseIndex].name;
        setResults((rs) => [
          ...rs.filter((r) => !(r.exercise === exercise && r.side === step.role)),
          { id: newId(), session_id: sessionId, exercise, side: step.role, ...stats },
        ]);
      },
      next(step) {
        if (step.role === 'healthy') return { ...step, role: 'weak' };
        const n = getCurrentPlan().exercises.length;
        return step.exerciseIndex + 1 < n ? { exerciseIndex: step.exerciseIndex + 1, role: 'healthy' } : null;
      },
    }),
    [sessionId, startedAt, pain, tiredness, results],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
