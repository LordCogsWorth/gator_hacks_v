// AI rehab plan for the care team (Weekly summary card). The numbers are worked out here, from the same data
// the page shows, so the baseline is exact; Gemma (POST /api/gemma, gemma-proxy.mjs) only writes the words:
// where the patient is struggling, a short baseline note, and suggested exercises for the therapist to consider.
// Decision support only: the clinician approves every plan change, and nothing here is a diagnosis.
import type { CameraAnalysis, Exercise, PatientDetailResponse, Session, WatchDaily, WatchSession } from '../types';
import { EXERCISE_LABELS } from '../types';
import { daysBetween, todayISO } from './dates';

const EXERCISES: Exercise[] = ['arm_raise', 'forward_reach', 'hand_open'];
const UNIT: Record<Exercise, string> = { arm_raise: '°', forward_reach: '°', hand_open: '%' };
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 28;

export interface BaselineRow {
  measure: string;
  /** Now: average of the latest sessions or days. */
  now: string;
  /** Start of the window, for the trend. */
  before: string | null;
  /** 'up' / 'down' / 'flat' compared with `before`, when both are known. */
  trend: 'up' | 'down' | 'flat' | null;
  /** Higher is better for this measure (false for compensation, pain). */
  higherIsBetter: boolean;
}

export interface PlanInput {
  detail: PatientDetailResponse;
  sessions: Session[];
  watch: WatchDaily[];
  watchSessions: WatchSession[];
  cameraAnalyses: CameraAnalysis[];
}

export interface AiPlan {
  summary: string;
  struggling: { area: string; detail: string }[];
  baselineNote: string;
  program: { focus: string; sessionsPerWeek: number | null; exercises: { name: string; dose: string; why: string }[] };
  cautions: string[];
}

export interface StoredPlan {
  plan: AiPlan | null;
  /** Gemma's raw answer, shown when it wasn't valid JSON. */
  raw: string;
  model: string;
  createdAt: string;
  baseline: BaselineRow[];
}

const round = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const mean = (xs: (number | null | undefined)[]) => {
  const ys = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
};

function trendOf(now: number | null, before: number | null, flatWithin: number): BaselineRow['trend'] {
  if (now == null || before == null) return null;
  if (Math.abs(now - before) <= flatWithin) return 'flat';
  return now > before ? 'up' : 'down';
}

/** Sessions in the window, oldest first. */
function recentSessions(sessions: Session[], now = Date.now()): Session[] {
  return sessions
    .filter((s) => now - Date.parse(s.startedAt) <= WINDOW_DAYS * DAY_MS)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

const weakBest = (s: Session, ex: Exercise) => s.results.find((r) => r.exercise === ex && r.side === 'weak')?.bestValue ?? null;

/** Where the patient is now: latest 3 sessions (and 7 watch days) against the first 3 in the last 4 weeks. */
export function computeBaseline({ sessions, watch }: Pick<PlanInput, 'sessions' | 'watch'>, now = Date.now()): BaselineRow[] {
  const ss = recentSessions(sessions, now).filter((s) => s.results.length);
  const first = ss.slice(0, 3);
  const last = ss.slice(-3);
  const enough = ss.length >= 4; // otherwise "before" and "now" are the same sessions
  const rows: BaselineRow[] = [];
  const fmt = (v: number | null, unit: string) => (v == null ? '—' : `${v}${unit}`);

  for (const ex of EXERCISES) {
    const nowBest = round(mean(last.map((s) => weakBest(s, ex))));
    if (nowBest == null) continue;
    const beforeBest = enough ? round(mean(first.map((s) => weakBest(s, ex)))) : null;
    rows.push({
      measure: `${EXERCISE_LABELS[ex]}: weak arm best`,
      now: fmt(nowBest, UNIT[ex]),
      before: beforeBest == null ? null : fmt(beforeBest, UNIT[ex]),
      trend: trendOf(nowBest, beforeBest, 2),
      higherIsBetter: true,
    });
  }
  for (const ex of EXERCISES) {
    const nowSym = round(mean(last.map((s) => s.symmetryByExercise?.[ex])));
    if (nowSym == null) continue;
    const beforeSym = enough ? round(mean(first.map((s) => s.symmetryByExercise?.[ex]))) : null;
    rows.push({
      measure: `${EXERCISE_LABELS[ex]}: symmetry (weak ÷ healthy)`,
      now: fmt(nowSym, '%'),
      before: beforeSym == null ? null : fmt(beforeSym, '%'),
      trend: trendOf(nowSym, beforeSym, 2),
      higherIsBetter: true,
    });
  }
  const nowComp = round(mean(last.map((s) => s.compensation)));
  if (nowComp != null) {
    const beforeComp = enough ? round(mean(first.map((s) => s.compensation))) : null;
    rows.push({
      measure: 'Compensation (reps with lean or hike)',
      now: fmt(nowComp, '%'),
      before: beforeComp == null ? null : fmt(beforeComp, '%'),
      trend: trendOf(nowComp, beforeComp, 3),
      higherIsBetter: false,
    });
  }
  const nowPain = round(mean(last.map((s) => s.pain)), 1);
  if (nowPain != null) {
    const beforePain = enough ? round(mean(first.map((s) => s.pain)), 1) : null;
    rows.push({
      measure: 'Pain before sessions (0–10)',
      now: fmt(nowPain, ''),
      before: beforePain == null ? null : fmt(beforePain, ''),
      trend: trendOf(nowPain, beforePain, 0.5),
      higherIsBetter: false,
    });
  }

  const days = [...watch].sort((a, b) => a.date.localeCompare(b.date));
  const w7 = days.slice(-7);
  const wFirst = days.length >= 14 ? days.slice(0, 7) : [];
  const ratioNow = round(mean(w7.map((w) => w.useRatio)), 2);
  if (ratioNow != null) {
    const ratioBefore = wFirst.length ? round(mean(wFirst.map((w) => w.useRatio)), 2) : null;
    rows.push({
      measure: 'Weak-arm use ratio (watch, 7-day avg)',
      now: String(ratioNow),
      before: ratioBefore == null ? null : String(ratioBefore),
      trend: trendOf(ratioNow, ratioBefore, 0.02),
      higherIsBetter: true,
    });
  }
  const minNow = round(mean(w7.map((w) => w.weakArmActiveMin)));
  if (minNow != null) {
    const minBefore = wFirst.length ? round(mean(wFirst.map((w) => w.weakArmActiveMin))) : null;
    rows.push({
      measure: 'Weak-arm active minutes / day (watch)',
      now: `${minNow} min`,
      before: minBefore == null ? null : `${minBefore} min`,
      trend: trendOf(minNow, minBefore, 2),
      higherIsBetter: true,
    });
  }
  return rows;
}

/** Compact, number-only view of the patient for the prompt. */
export function planData(input: PlanInput, now = Date.now()) {
  const { patient, approvedPlan, openAlerts } = input.detail;
  const ss = recentSessions(input.sessions, now);
  const sessions7 = ss.filter((s) => now - Date.parse(s.startedAt) <= 7 * DAY_MS);
  const latestCamera = [...input.cameraAnalyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const weakKey = patient.weakSide === 'left' ? 'L' : 'R';
  const last = ss.filter((s) => s.results.length).slice(-3);
  const weakRound = (ex: Exercise) => last.flatMap((s) => s.results.filter((r) => r.exercise === ex && r.side === 'weak'));

  return {
    patient: {
      weakSide: patient.weakSide,
      phase: patient.phase,
      daysSinceStroke: daysBetween(patient.strokeDate, todayISO()),
      maxSafeRaiseAngleDeg: patient.maxRaiseAngle,
    },
    currentPlan: approvedPlan
      ? { sessionsPerWeek: approvedPlan.sessionsPerWeek, exercises: approvedPlan.exercises.map((e) => ({ exercise: e.exercise, reps: e.reps })) }
      : null,
    adherence: { sessionsLast7Days: sessions7.length, goalPerWeek: approvedPlan?.sessionsPerWeek ?? null },
    stoppedEarlyLast4Weeks: ss.filter((s) => s.stopReason).map((s) => s.stopReason),
    baseline: computeBaseline(input, now).map((r) => ({ measure: r.measure, now: r.now, fourWeeksAgo: r.before })),
    weakArmQualityLatest: Object.fromEntries(
      EXERCISES.map((ex) => {
        const rs = weakRound(ex);
        return [
          ex,
          rs.length
            ? {
                secPerRep: round(mean(rs.map((r) => r.secPerRep)), 1),
                smoothnessBurstsPerRep: round(mean(rs.map((r) => r.smoothness)), 1),
                fatigueLast3VsFirst3: round(mean(rs.map((r) => r.fatigue)), 2),
                trunkLeanMaxDeg: round(mean(rs.map((r) => r.trunkLeanMax))),
                compensatedRepPct: round(mean(rs.map((r) => r.compRepPct))),
              }
            : null,
        ];
      }),
    ),
    latestCameraAnalysis: latestCamera
      ? {
          date: latestCamera.createdAt.slice(0, 10),
          weakShoulderRaise: latestCamera.shoulder[weakKey],
          otherShoulderRaise: latestCamera.shoulder[weakKey === 'L' ? 'R' : 'L'],
          jointMobilityPct: Object.fromEntries(Object.values(latestCamera.joints).map((j) => [j.name, j.pct])),
          musclesFlagged: latestCamera.findings.slice(0, 6).map((f) => ({ muscle: f.muscle, status: f.status, score: f.score })),
        }
      : null,
    watchLast7Days: (() => {
      const w7 = [...input.watch].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
      return w7.length
        ? {
            restingHrAvg: round(mean(w7.map((w) => w.restingHr))),
            bpSysLatest: w7[w7.length - 1]?.bpSys ?? null,
            bpSysLimit: patient.bpLimitSys,
            falls: w7.reduce((a, w) => a + (w.falls ?? 0), 0),
            stepsAvg: round(mean(w7.map((w) => w.steps))),
          }
        : null;
    })(),
    watchExerciseRoundsLast7Days: input.watchSessions
      .filter((s) => now - Date.parse(s.startedAt) <= 7 * DAY_MS)
      .map((s) => ({ exercise: s.exercise, arm: s.arm, reps: s.reps, targetReps: s.targetReps, bestElevationDeg: s.bestElevationDeg })),
    openAlerts: openAlerts.map((a) => a.type),
  };
}

// Instructions go in the user message because Gemma models do not reliably accept a system role.
export function planPrompt(data: ReturnType<typeof planData>): string {
  return `You are helping a physiotherapist plan home rehabilitation for a stroke survivor who is recovering arm and hand function.
All numbers below were measured by software (webcam sessions, Apple Watch). Use only these numbers; do not invent or recalculate any.
Do not diagnose and do not use the word "diagnosis". These are suggestions for the therapist to review, not orders.
Glossary: symmetry = weak arm as % of the healthy arm. Compensation = % of weak-arm reps with trunk lean or shoulder hiking.
Smoothness = speed bursts per rep (lower is smoother). Fatigue = last 3 rep peaks / first 3 (below 1 means tiring).
Use ratio = weak-arm movement / healthy-arm movement through the day. arm_raise and forward_reach are degrees, hand_open is %.
Keep any arm raise suggestion at or below maxSafeRaiseAngleDeg.

Answer with JSON only (no markdown, no code fences), exactly this shape:
{
  "summary": "1-2 sentences: how the patient is doing overall",
  "struggling": [{"area": "short name, e.g. Shoulder elevation", "detail": "one sentence that cites the numbers"}],
  "baselineNote": "1-2 sentences: where the patient is right now and the trend over the last 4 weeks",
  "program": {
    "focus": "one sentence: the main goal for the next 1-2 weeks",
    "sessionsPerWeek": 5,
    "exercises": [{"name": "exercise name", "dose": "sets x reps or minutes, how often", "why": "which struggling area it targets"}]
  },
  "cautions": ["short safety notes, only if the data supports them"]
}
Give 2-4 struggling areas, ordered worst first, and 3-5 exercises that are safe at home, seated or supported where sensible,
each tied to a struggling area. Include the current plan's exercises only if they still fit.

Patient data (JSON):
${JSON.stringify(data)}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Gemma's answer → AiPlan, or null when it isn't the JSON asked for. */
export function parsePlan(text: string): AiPlan | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const program = obj(j.program);
  const plan: AiPlan = {
    summary: str(j.summary),
    struggling: list(j.struggling)
      .map((s) => ({ area: str(obj(s).area), detail: str(obj(s).detail) }))
      .filter((s) => s.area),
    baselineNote: str(j.baselineNote),
    program: {
      focus: str(program.focus),
      sessionsPerWeek: typeof program.sessionsPerWeek === 'number' ? program.sessionsPerWeek : null,
      exercises: list(program.exercises)
        .map((e) => ({ name: str(obj(e).name), dose: str(obj(e).dose), why: str(obj(e).why) }))
        .filter((e) => e.name),
    },
    cautions: list(j.cautions).map(str).filter(Boolean),
  };
  return plan.struggling.length || plan.program.exercises.length ? plan : null;
}

/** Ask Gemma through the app's own server route. Throws with a readable message. */
export async function askGemma(prompt: string): Promise<{ text: string; model: string }> {
  let r: Response;
  try {
    r = await fetch('/api/gemma', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
  } catch {
    throw new Error('Could not reach the app server for Gemma.');
  }
  const body = (await r.json().catch(() => ({}))) as { text?: string; model?: string; error?: string };
  if (!r.ok) throw new Error(body.error || `Gemma request failed (${r.status})`);
  return { text: body.text ?? '', model: body.model ?? 'gemma' };
}

/** Last generated plan per patient, kept in this browser so it is still there after a reload. */
const KEY = (patientId: string) => `rehabtrack.aiPlan.${patientId}`;
export function loadStoredPlan(patientId: string): StoredPlan | null {
  try {
    const s = localStorage.getItem(KEY(patientId));
    return s ? (JSON.parse(s) as StoredPlan) : null;
  } catch {
    return null;
  }
}
export function storePlan(patientId: string, p: StoredPlan) {
  try {
    localStorage.setItem(KEY(patientId), JSON.stringify(p));
  } catch {
    // Not kept; still shown until the page is left.
  }
}
