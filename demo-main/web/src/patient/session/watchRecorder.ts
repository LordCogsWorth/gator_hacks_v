// Collects the real Apple Watch data (Kyle's motion server, /events) during a session round, and turns it
// into an ExerciseResult (RoundStats) plus a WatchSession row, so the session shows up in the patient's
// history and on the care dashboard. Samples from the dashboard simulator (simulated: true) are ignored.
import { useEffect, useRef } from 'react';
import { dataMode } from '../../data/index';
import { nextId, writeDb } from '../../data/local/db';
import type { Exercise, WatchSession } from '../../types';
import type { RoundStats } from './repCounter';

const WATCH_SOURCE = "Kyle's Apple Watch";

interface Sample {
  source?: string;
  simulated?: boolean;
  sessionId?: string;
  heartRate?: number;
  arm?: { exercise?: string; elevationDeg?: number; directionDeg?: number; calibrated?: boolean; reps?: number; targetReps?: number };
}

export interface WatchRound {
  startedAt: number;
  /** Highest rep count per watch session (the watch restarts at 0 for each session). */
  repsBySession: Map<string, number>;
  bestElevation: number;
  hr: number[];
  samples: number;
  watchExercise: string | null;
}

const emptyRound = (): WatchRound => ({
  startedAt: Date.now(),
  repsBySession: new Map(),
  bestElevation: 0,
  hr: [],
  samples: 0,
  watchExercise: null,
});

/** Listens to the watch stream for as long as the component is mounted. */
export function useWatchRecorder() {
  const round = useRef<WatchRound>(emptyRound());
  const listeners = useRef(new Set<(r: WatchRound) => void>());

  useEffect(() => {
    const es = new EventSource('/events');
    es.addEventListener('motion', (ev) => {
      let s: Sample;
      try {
        s = JSON.parse((ev as MessageEvent).data);
      } catch {
        return;
      }
      if (s.source !== WATCH_SOURCE || s.simulated || !s.arm) return;
      const r = round.current;
      r.samples++;
      r.watchExercise = s.arm.exercise ?? r.watchExercise;
      const key = s.sessionId ?? 'watch';
      r.repsBySession.set(key, Math.max(r.repsBySession.get(key) ?? 0, s.arm.reps ?? 0));
      if (s.arm.calibrated && typeof s.arm.elevationDeg === 'number') {
        r.bestElevation = Math.max(r.bestElevation, Math.min(180, s.arm.elevationDeg));
      }
      if (typeof s.heartRate === 'number' && s.heartRate >= 25 && s.heartRate <= 240) r.hr.push(s.heartRate);
      listeners.current.forEach((fn) => fn(r));
    });
    return () => es.close();
  }, []);

  return {
    /** Start a fresh round (call when the patient starts an arm). */
    reset() {
      round.current = emptyRound();
      listeners.current.forEach((fn) => fn(round.current));
    },
    current: () => round.current,
    subscribe(fn: (r: WatchRound) => void) {
      listeners.current.add(fn);
      return () => void listeners.current.delete(fn);
    },
  };
}

export const roundReps = (r: WatchRound) => [...r.repsBySession.values()].reduce((a, b) => a + b, 0);

/** Watch round → the stats the session saves. Null when the watch sent nothing. */
export function roundToStats(r: WatchRound, exercise: Exercise): RoundStats | null {
  if (!r.samples) return null;
  const reps = roundReps(r);
  const secs = (Date.now() - r.startedAt) / 1000;
  return {
    bestValue: Math.round(r.bestElevation * 10) / 10,
    reps,
    secPerRep: reps ? Math.round((secs / reps) * 10) / 10 : 0,
    smoothness: 1,
    fatigue: 1,
    trunkLeanMax: 0,
    shoulderHikeMax: 0,
    compRepPct: 0,
    ...(exercise === 'forward_reach' ? { reachCm: null } : {}),
  };
}

/** Save the round as a watch session row, so the care dashboard's watch section shows it (offline data). */
export async function saveWatchSession(
  r: WatchRound,
  patientId: string,
  exercise: Exercise,
  arm: 'left' | 'right',
  targetReps: number,
): Promise<void> {
  if (!r.samples || exercise === 'hand_open' || dataMode() !== 'local') return;
  const avg = r.hr.length ? Math.round(r.hr.reduce((a, b) => a + b, 0) / r.hr.length) : null;
  const reps = roundReps(r);
  const end = new Date();
  await writeDb((db) => {
    const id = nextId(db, 'ws');
    const row: WatchSession = {
      id,
      sessionId: id,
      patientId,
      exercise,
      arm,
      startedAt: new Date(r.startedAt).toISOString(),
      endedAt: end.toISOString(),
      durationSec: Math.round((end.getTime() - r.startedAt) / 1000),
      targetReps,
      reps,
      attempts: null,
      bestElevationDeg: Math.round(r.bestElevation * 10) / 10,
      completed: reps >= targetReps,
      avgHr: avg,
      maxHr: r.hr.length ? Math.round(Math.max(...r.hr)) : null,
      minHr: r.hr.length ? Math.round(Math.min(...r.hr)) : null,
      appSessionId: null,
    };
    db.watchSessions.push(row);
    return row;
  });
}
