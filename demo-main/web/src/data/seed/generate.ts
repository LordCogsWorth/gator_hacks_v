/**
 * Deterministic demo data (port of Raghav/api/seed.js, CONVERGENCE_PLAN §6.4). Used by the LocalSource seed and
 * by web/scripts/gen-seed-sql.ts (supabase/seed.sql), so both modes tell the same story:
 *   Maria: improving 45% → ~71%, good adherence, 6 watch sessions (best elevation 70° → 95°) → phase-up suggestion.
 *   James: plateau ~55% for 2 weeks, no session for 4 days, weak-arm use falling (95 → 58 min, ratio 0.55 → 0.38),
 *          latest arm-raise replay leans on reps 3 and 5 → plateau + adherence alerts, plateau suggestion.
 *   Priya: rising symmetry with ~55% compensation, shoulder hike in the latest replay, resting HR climbing,
 *          today's systolic BP over her limit → compensation + heart-rate + blood-pressure alerts.
 * Sessions run from 20 days ago to yesterday (local time); today stays empty for the live demo.
 */
import type {
  Alert,
  BodySide,
  Exercise,
  ExerciseResult,
  Patient,
  Plan,
  WatchDaily,
  WatchSession,
  WeeklySummary,
} from '../../types';
import { evaluate } from '../../rules/engine';
import { EXERCISES } from '../../rules/constants';
import { localDate } from '../validate';
import { replayKey } from '../derive';
import type { ReplayRow, SessionRow, Snapshot } from '../source';
import { synthPath, synthReplay, type SynthParams } from './replaySynth';
import { pregeneratedSummary } from './summaries';

export interface DemoData {
  patients: Patient[];
  plans: Plan[];
  sessions: SessionRow[];
  results: ExerciseResult[];
  watch: WatchDaily[];
  watchSessions: WatchSession[];
  replays: ReplayRow[];
  summaries: WeeklySummary[];
  alerts: Alert[];
}

/** Small deterministic PRNG (returns 0 ≤ x < 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Replays for the last N sessions of each patient. */
const REPLAY_SESSIONS = 5;
const HEALTHY_BEST: Record<Exercise, number> = { arm_raise: 160, forward_reach: 150, hand_open: 90 };

interface Story {
  patient: Patient;
  short: string;
  /** Local start time of the daily session (at or before 11:30 so no zone down to UTC-12 puts yesterday's session on today's UTC date). */
  hour: number;
  skipDays: Set<number>;
  symmetryAt: (ago: number) => number;
  offsets?: Partial<Record<Exercise, number>>;
  weak: { compRepPct: (ex: Exercise) => number; trunkLeanMax: number; shoulderHikeMax: number };
  painAt: (ago: number) => number;
  restingHrAt: (ago: number) => number;
  bpSysAt: (ago: number) => number;
  stepsAt: (ago: number) => number;
  armMinAt: (ago: number) => number;
  useRatioAt: (ago: number) => number;
  steadiness: number;
  planPhase: number;
}

export function generateDemoData(today: Date, rng = mulberry32(42)): DemoData {
  const Y = today.getFullYear();
  const M = today.getMonth();
  const D = today.getDate();
  /** Local time `ago` days before today. */
  const at = (ago: number, hour = 0, minute = 0) => new Date(Y, M, D - ago, hour, minute);
  const dateAgo = (ago: number) => localDate(at(ago));
  // Rules run "this morning": alerts and suggestions are timestamped before any live activity.
  const evalNow = new Date(Math.min(today.getTime(), at(0, 6).getTime()));

  const patients: Patient[] = [
    { id: 'p-maria', name: 'Maria Santos', weakSide: 'left', strokeDate: dateAgo(104), phase: 2, maxRaiseAngle: 120, nextCheckin: dateAgo(-4), bpLimitSys: 150 },
    { id: 'p-james', name: 'James Okonkwo', weakSide: 'right', strokeDate: dateAgo(174), phase: 2, maxRaiseAngle: 110, nextCheckin: dateAgo(-2), bpLimitSys: 145 },
    { id: 'p-priya', name: 'Priya Nair', weakSide: 'left', strokeDate: dateAgo(65), phase: 1, maxRaiseAngle: 100, nextCheckin: dateAgo(-6), bpLimitSys: 140 },
  ];
  const defaultArmMin = (ago: number) => 60 + (20 - ago) * 2;
  const defaultUseRatio = (ago: number) => round2(0.4 + (20 - ago) * 0.01);

  const stories: Story[] = [
    {
      patient: patients[0],
      short: 'maria',
      hour: 9,
      skipDays: new Set(),
      // Ends a little above 70 so her last 3 sessions clear the phase-2 target (65%) whichever weekend days are skipped.
      symmetryAt: (ago) => Math.round(lerp(45, 72, (20 - ago) / 20)),
      weak: { compRepPct: (ex) => 10 + (ex === 'arm_raise' ? 5 : 0), trunkLeanMax: 7, shoulderHikeMax: 0.02 },
      painAt: () => 2,
      restingHrAt: () => 68,
      bpSysAt: () => 128,
      stepsAt: (ago) => 4000 + (20 - ago) * 50,
      armMinAt: defaultArmMin,
      useRatioAt: defaultUseRatio,
      steadiness: 82,
      planPhase: 2,
    },
    {
      patient: patients[1],
      short: 'james',
      hour: 10,
      // No session for the last 3 days (plus today) → adherence; one earlier miss.
      skipDays: new Set([1, 2, 3, 10]),
      // First week rises a bit, then flat 54–56 for 2 weeks → plateau.
      symmetryAt: (ago) => (ago > 14 ? Math.round(lerp(48, 55, (20 - ago) / 6)) : 54 + (ago % 3)),
      // Hand opening lags the other exercises, so the plateau suggestion targets it.
      offsets: { hand_open: -6 },
      weak: { compRepPct: () => 18, trunkLeanMax: 9, shoulderHikeMax: 0.025 },
      painAt: () => 3,
      restingHrAt: () => 72,
      bpSysAt: () => 135,
      stepsAt: (ago) => 2800 + (ago % 5) * 100,
      armMinAt: (ago) => Math.round(lerp(95, 58, (20 - ago) / 20)),
      useRatioAt: (ago) => round2(lerp(0.55, 0.38, (20 - ago) / 20)),
      steadiness: 68,
      planPhase: 2,
    },
    {
      patient: patients[2],
      short: 'priya',
      hour: 11,
      skipDays: new Set([7]),
      symmetryAt: (ago) => Math.round(lerp(40, 58, (20 - ago) / 20)),
      weak: { compRepPct: () => 55, trunkLeanMax: 18, shoulderHikeMax: 0.06 },
      painAt: (ago) => (ago === 1 ? 4 : 3),
      // Steady 66 for 2 weeks, then climbs over the last week (to 80 today).
      restingHrAt: (ago) => (ago > 7 ? 66 : 66 + Math.round(((7 - ago) / 7) * 14)),
      bpSysAt: (ago) => (ago === 0 ? 148 : 130),
      stepsAt: (ago) => 3200 + (20 - ago) * 40,
      armMinAt: defaultArmMin,
      useRatioAt: defaultUseRatio,
      steadiness: 74,
      planPhase: 1,
    },
  ];

  const data: DemoData = {
    patients,
    plans: [],
    sessions: [],
    results: [],
    watch: [],
    watchSessions: [],
    replays: [],
    summaries: [],
    alerts: [],
  };

  for (const story of stories) {
    const { patient, short } = story;
    const sessions: SessionRow[] = [];
    const results: ExerciseResult[] = [];

    for (let ago = 20; ago >= 1; ago--) {
      if (story.skipDays.has(ago)) continue;
      const start = at(ago, story.hour, 30);
      const dow = start.getDay();
      // Skip every 3rd weekend day for realism; keep most for denser charts.
      if ((dow === 0 || dow === 6) && ago % 3 === 0) continue;

      const id = `sess-${short}-${String(ago).padStart(2, '0')}`;
      sessions.push({
        id,
        patientId: patient.id,
        startedAt: start.toISOString(),
        endedAt: new Date(start.getTime() + 12 * 60_000).toISOString(),
        pain: story.painAt(ago),
        tiredness: 2 + (ago % 4 === 0 ? 1 : 0),
        stopReason: null,
        avgHr: 68 + Math.floor(rng() * 23),
        replays: [],
      });
      const sym = story.symmetryAt(ago);
      for (const exercise of EXERCISES) {
        const h = HEALTHY_BEST[exercise];
        const w = Math.round((h * (sym + (story.offsets?.[exercise] ?? 0))) / 100);
        results.push({
          id: `er-${id}-${exercise}-healthy`,
          sessionId: id,
          exercise,
          side: 'healthy',
          bestValue: h,
          reps: 10,
          secPerRep: 3.0,
          smoothness: 1.1,
          fatigue: 0.98,
          trunkLeanMax: 3,
          shoulderHikeMax: exercise === 'arm_raise' ? 0.01 : 0,
          compRepPct: 0,
          reachCm: exercise === 'forward_reach' ? 42 : null,
          closedMin: exercise === 'hand_open' ? 6 : null,
        });
        results.push({
          id: `er-${id}-${exercise}-weak`,
          sessionId: id,
          exercise,
          side: 'weak',
          bestValue: w,
          reps: 8,
          secPerRep: 4.2,
          smoothness: 2.4,
          fatigue: 0.9,
          trunkLeanMax: story.weak.trunkLeanMax,
          shoulderHikeMax: exercise === 'arm_raise' ? story.weak.shoulderHikeMax : 0,
          compRepPct: story.weak.compRepPct(exercise),
          reachCm: exercise === 'forward_reach' ? Math.round((42 * w) / h) : null,
          closedMin: exercise === 'hand_open' ? 14 : null,
        });
      }
    }

    // James's latest arm raise: the trunk leans on reps 3 and 5 (shown in the 3D replay).
    const lastId = sessions[sessions.length - 1]?.id;
    if (short === 'james') {
      const r = results.find((x) => x.sessionId === lastId && x.exercise === 'arm_raise' && x.side === 'weak');
      if (r) Object.assign(r, { compRepPct: 25, trunkLeanMax: 15 });
    }

    // Synthetic replays for the last few sessions (every result).
    for (const [i, s] of sessions.slice(-REPLAY_SESSIONS).entries()) {
      const isLatest = s.id === lastId;
      for (const r of results.filter((x) => x.sessionId === s.id)) {
        const params: SynthParams = {
          seed: `${short}-${i + 1}-${r.exercise}-${r.side}`,
          exercise: r.exercise,
          side: r.side,
          weakSide: patient.weakSide as BodySide,
          peakDeg: r.bestValue,
          reps: r.reps,
        };
        if (isLatest && r.exercise === 'arm_raise' && r.side === 'weak') {
          if (short === 'james') Object.assign(params, { seed: 'james-lean', leanReps: [3, 5] });
          if (short === 'priya') Object.assign(params, { seed: 'priya-hike', hikeReps: [2, 4, 5, 7] });
        }
        const file = synthReplay(params);
        data.replays.push({
          sessionId: s.id,
          exercise: r.exercise,
          side: r.side,
          path: synthPath(params),
          fps: 15,
          frameCount: file.frames.length,
          seconds: round1(file.frames.length / 15),
          warningCount: file.warnings?.length ?? 0,
          uploadedAt: s.endedAt,
        });
        s.replays.push(replayKey(s.id, r.exercise, r.side));
      }
      s.replays.sort();
    }

    const watch: WatchDaily[] = [];
    for (let ago = 20; ago >= 0; ago--) {
      const date = dateAgo(ago);
      watch.push({
        id: `wd-${short}-${date}`,
        patientId: patient.id,
        date,
        steps: story.stepsAt(ago),
        exerciseMin: 15 + (ago % 5) * 2,
        standHr: 8 + (ago % 3),
        restingHr: story.restingHrAt(ago),
        hrv: 35 + (ago % 7),
        sleepHr: round1(6.5 + (ago % 4) * 0.3),
        bpSys: story.bpSysAt(ago),
        bpDia: 78 + (ago % 5),
        falls: 0,
        walkingSteadiness: story.steadiness + (ago % 3),
        weakArmActiveMin: story.armMinAt(ago),
        useRatio: story.useRatioAt(ago),
      });
    }

    if (short === 'maria') {
      [18, 15, 12, 9, 6, 3].forEach((ago, i) => {
        const start = at(ago, 18, 0);
        const durationSec = 360 + i * 10;
        const reps = [8, 8, 9, 9, 10, 10][i];
        const avgHr = 78 + Math.floor(rng() * 7);
        data.watchSessions.push({
          id: String(i + 1),
          sessionId: `5eed0000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          patientId: patient.id,
          exercise: 'arm_raise',
          arm: patient.weakSide,
          startedAt: start.toISOString(),
          endedAt: new Date(start.getTime() + durationSec * 1000).toISOString(),
          durationSec,
          targetReps: 10,
          reps,
          attempts: reps + 2,
          bestElevationDeg: 70 + i * 5,
          completed: reps >= 10,
          avgHr,
          maxHr: avgHr + 14,
          minHr: avgHr - 10,
          appSessionId: null,
        });
      });
    }

    const approvedAt = at(21, 9).toISOString();
    const phase = story.planPhase;
    const approved: Plan = {
      id: `plan-${short}-approved`,
      patientId: patient.id,
      phase,
      exercises: [
        { exercise: 'arm_raise', reps: 10, target: 85 + phase * 8 },
        { exercise: 'forward_reach', reps: 10, target: 125 + phase * 5 },
        { exercise: 'hand_open', reps: 12, target: 55 + phase * 8 },
      ],
      sessionsPerWeek: 5,
      status: 'approved',
      approvedBy: 'Dr. Chen',
      nextCheckin: patient.nextCheckin,
      createdAt: approvedAt,
      approvedAt,
    };

    // Run the rules "this morning" so the alerts and the suggestion match the story.
    const snapshot: Snapshot = {
      patient,
      sessions,
      results,
      replays: data.replays.filter((r) => r.sessionId.startsWith(`sess-${short}-`)),
      watch,
      alerts: [],
      plans: [approved],
    };
    const out = evaluate(snapshot, evalNow);
    const alerts: Alert[] = out.alerts.map((a) => ({ ...a, id: `al-${short}-${a.type}`, acknowledged: false }));
    const plans: Plan[] = [approved];
    if (out.plan) plans.push({ ...out.plan, id: `plan-${short}-suggested`, status: 'suggested', approvedBy: null });

    data.sessions.push(...sessions);
    data.results.push(...results);
    data.watch.push(...watch);
    data.alerts.push(...alerts);
    data.plans.push(...plans);
    data.summaries.push(pregeneratedSummary({ ...snapshot, alerts, plans }, evalNow, evalNow.toISOString()));
  }

  return data;
}
