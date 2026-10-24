/**
 * Rules engine (port of Raghav/api/rules.js). Pure: `evaluate(snapshot, now)` returns the alerts and the plan
 * suggestion to write; api.ts applies them through the data source (which dedupes again).
 * - Alerts: plateau, setback, compensation, adherence, pain, safety stop, heart rate, blood pressure, fall.
 *   Never a second open alert of the same type; an alert acknowledged in the last 72 h is not re-raised
 *   unless newer data arrived since (isCoolingDown).
 * - Plan suggestions (compensation, phase-up, plateau) with a plain-language reason. A clinician approves.
 * Day boundaries are local time (the code runs in the browser).
 */
import type { Alert, AlertType, Exercise, ExerciseResult, Patient, Plan, PlanExercise, PlanKind, WatchDaily } from '../types';
import type { NewAlert, NewPlan, SessionRow, Snapshot } from '../data/source';
import {
  ALERT_COOLDOWN_HOURS,
  COMPENSATION_ALERT_PCT,
  DEFAULT_EXERCISES,
  DEFAULT_SESSIONS_PER_WEEK,
  EXERCISE_NAMES,
  EXERCISES,
  MAX_PHASE,
  MAX_PLAN_REPS,
  MISSED_DAYS_ALERT,
  NEXT_PHASE_MAX_COMPENSATION,
  PAIN_ALERT,
  PHASE_TARGETS,
  PLATEAU_DAYS,
  PLATEAU_MIN_SESSIONS,
  PLATEAU_RANGE,
  RESTING_HR_RISE,
  SETBACK_BASELINE_SESSIONS,
  SETBACK_DROP,
  TARGET_CEILING,
  WATCH_ALERT_TYPES,
} from './constants';

const DAY_MS = 86_400_000;

export interface TimelineEntry {
  session: SessionRow;
  results: ExerciseResult[];
  symmetry: number | null;
  compensation: number | null;
}

export interface PlanChange {
  kind: PlanKind;
  phase: number;
  exercises: PlanExercise[];
  reason: string;
  basedOn: { sessions: number; avgSymmetry: number | null; avgCompensation: number | null };
}

// ---- time helpers (local) ----

/** Local midnight of the day `d` falls on. */
export function localDayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local midnight of a YYYY-MM-DD date. */
export function localDateStart(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole calendar days from `a` to `b` (local; DST-safe). */
export function calendarDaysBetween(a: Date, b: Date): number {
  return Math.round((localDayStart(b).getTime() - localDayStart(a).getTime()) / DAY_MS);
}

// ---- symmetry helpers ----

/** weak best / healthy best × 100 for one exercise; null if a side is missing. */
export function symmetryForExercise(results: ExerciseResult[], exercise: Exercise): number | null {
  const healthy = results.find((r) => r.exercise === exercise && r.side === 'healthy');
  const weak = results.find((r) => r.exercise === exercise && r.side === 'weak');
  if (!healthy || !weak || !healthy.bestValue) return null;
  return (weak.bestValue / healthy.bestValue) * 100;
}

/** Mean symmetry across the exercises that have both sides. */
export function avgSymmetry(results: ExerciseResult[]): number | null {
  const values = EXERCISES.map((ex) => symmetryForExercise(results, ex)).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Mean compensation % across the weak-arm results of a session. */
export function avgCompensation(results: ExerciseResult[]): number | null {
  const weak = results.filter((r) => r.side === 'weak');
  if (weak.length === 0) return null;
  return weak.reduce((sum, r) => sum + (r.compRepPct || 0), 0) / weak.length;
}

/** One patient's sessions with their results and scores, oldest first. */
export function sessionTimeline(patientId: string, sessions: SessionRow[], allResults: ExerciseResult[]): TimelineEntry[] {
  const bySession = new Map<string, ExerciseResult[]>();
  for (const r of allResults) {
    if (!r.sessionId) continue;
    const list = bySession.get(r.sessionId);
    if (list) list.push(r);
    else bySession.set(r.sessionId, [r]);
  }
  return sessions
    .filter((s) => s.patientId === patientId)
    .slice()
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    .map((session) => {
      const results = bySession.get(session.id) ?? [];
      return { session, results, symmetry: avgSymmetry(results), compensation: avgCompensation(results) };
    });
}

/** Scored sessions in the last `days` days. */
export function recentWithSymmetry(timeline: TimelineEntry[], now = new Date(), days = PLATEAU_DAYS): TimelineEntry[] {
  const since = now.getTime() - days * DAY_MS;
  return timeline.filter((t) => t.symmetry != null && new Date(t.session.startedAt).getTime() >= since);
}

/** Flat for ~2 weeks: 4+ scored sessions in the last 14 days within a 5-point range. */
export function isPlateau(timeline: TimelineEntry[], now = new Date()): boolean {
  const recent = recentWithSymmetry(timeline, now);
  if (recent.length < PLATEAU_MIN_SESSIONS) return false;
  const values = recent.map((t) => t.symmetry as number);
  return Math.max(...values) - Math.min(...values) < PLATEAU_RANGE;
}

/**
 * Setback: the latest scored session is 10+ points below the mean of the previous (up to) 3 scored sessions.
 * Returns the numbers for the alert text, or null.
 */
export function setbackInfo(timeline: TimelineEntry[]): { latest: number; baseline: number; sessions: number } | null {
  const scored = timeline.filter((t) => t.symmetry != null);
  if (scored.length < 2) return null;
  const latest = scored[scored.length - 1].symmetry as number;
  const prev = scored.slice(-1 - SETBACK_BASELINE_SESSIONS, -1).map((t) => t.symmetry as number);
  const baseline = mean(prev);
  return baseline - latest >= SETBACK_DROP ? { latest, baseline, sessions: prev.length } : null;
}

export function isSetback(timeline: TimelineEntry[]): boolean {
  return setbackInfo(timeline) !== null;
}

/**
 * Calendar days (local) with no session since the last one, minus one grace day (today / yesterday is fine).
 * 0 when the patient has no sessions yet.
 */
export function missedSessionStreak(timeline: TimelineEntry[], now = new Date()): number {
  if (timeline.length === 0) return 0;
  const last = new Date(timeline[timeline.length - 1].session.startedAt);
  return Math.max(0, calendarDaysBetween(last, now) - 1);
}

/** Resting HR: the latest day is 10+ bpm above the mean of the prior 14 days. */
export function restingHrSpike(
  watchRows: Pick<WatchDaily, 'date' | 'restingHr'>[],
): { latest: number; avg: number; date: string } | null {
  const withHr = watchRows
    .filter((w) => typeof w.restingHr === 'number')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (withHr.length < 3) return null;

  const latest = withHr[withHr.length - 1];
  const latestDay = localDateStart(latest.date);
  const baseline = withHr.filter((w) => {
    const gap = calendarDaysBetween(localDateStart(w.date), latestDay);
    return gap > 0 && gap <= 14;
  });
  if (baseline.length === 0) return null;

  const avg = baseline.reduce((s, w) => s + (w.restingHr as number), 0) / baseline.length;
  if ((latest.restingHr as number) - avg >= RESTING_HR_RISE) {
    return { latest: latest.restingHr as number, avg: Math.round(avg), date: latest.date };
  }
  return null;
}

// ---- alert helpers ----

const STOP_REASON_WORDS: Record<string, string> = {
  pain: 'pain',
  dizziness: 'dizziness or feeling unwell',
  other: 'another reason',
};

/** Alert text for a session the patient ended early. */
export function safetyStopDetail(entry: TimelineEntry): string {
  const { stopReason, pain } = entry.session;
  const painText = typeof pain === 'number' ? ` Reported pain ${pain}/10.` : '';
  const done = entry.results.length;
  const doneText =
    done === 0 ? ' No exercises were recorded.' : ` ${done} exercise result(s) were recorded before stopping.`;
  const why = STOP_REASON_WORDS[stopReason ?? ''] || stopReason;
  return `Patient stopped the latest session early because of ${why}.${painText}${doneText}`;
}

type AlertLike = Pick<Alert, 'patientId' | 'type' | 'acknowledged'> & { acknowledgedAt?: string };

export function hasOpenAlert(alerts: AlertLike[], patientId: string, type: AlertType): boolean {
  return alerts.some((a) => a.patientId === patientId && a.type === type && !a.acknowledged);
}

/**
 * True when an alert of this type was acknowledged within the cooldown window and the triggering data
 * (`dataTime`, ISO; null = none) is not newer than that acknowledgement.
 */
export function isCoolingDown(
  alerts: AlertLike[],
  patientId: string,
  type: AlertType,
  dataTime: string | null,
  now = new Date(),
): boolean {
  const cutoff = now.getTime() - ALERT_COOLDOWN_HOURS * 3_600_000;
  const dataMs = dataTime ? Date.parse(dataTime) : -Infinity;
  return alerts.some((a) => {
    if (a.patientId !== patientId || a.type !== type || !a.acknowledged || !a.acknowledgedAt) return false;
    const ackMs = Date.parse(a.acknowledgedAt);
    return ackMs >= cutoff && dataMs <= ackMs;
  });
}

/** Ready for the next phase: last 3 sessions at or above the phase target with compensation under 20 %. */
export function shouldSuggestNextPhase(patient: Pick<Patient, 'phase'>, timeline: TimelineEntry[]): boolean {
  const target = PHASE_TARGETS[patient.phase] ?? 70;
  const last3 = timeline.slice(-3);
  if (last3.length < 3) return false;
  return last3.every(
    (t) =>
      t.symmetry != null && t.symmetry >= target && t.compensation != null && t.compensation < NEXT_PHASE_MAX_COMPENSATION,
  );
}

// ---- plan suggestions ----

const round1 = (n: number) => Math.round(n * 10) / 10;
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** { sessions, avgSymmetry, avgCompensation } for the entries a rule looked at. */
export function basedOnSummary(entries: TimelineEntry[]): PlanChange['basedOn'] {
  const sym = entries.map((t) => t.symmetry).filter((v): v is number => v != null);
  const comp = entries.map((t) => t.compensation).filter((v): v is number => v != null);
  return {
    sessions: entries.length,
    avgSymmetry: sym.length ? round1(mean(sym)) : null,
    avgCompensation: comp.length ? round1(mean(comp)) : null,
  };
}

export function clampTarget(exercise: Exercise, target: number): number {
  return Math.min(Math.round(target), TARGET_CEILING[exercise] ?? 180);
}

/**
 * Whether the care team should see a plan change, from the sessions given (callers pass only sessions recorded
 * after the last plan decision). Priority: compensation (form first), ready, plateau.
 */
export function suggestPlanChange(
  patient: Pick<Patient, 'phase'> & Partial<Pick<Patient, 'maxRaiseAngle'>>,
  timeline: TimelineEntry[],
  currentPlan: Pick<Plan, 'exercises'> | null | undefined,
  now = new Date(),
): PlanChange | null {
  const phase = patient.phase || 1;
  const base = currentPlan?.exercises?.length ? currentPlan.exercises : DEFAULT_EXERCISES;
  const last3 = timeline.slice(-3);

  // 1. Compensation: leaning / shoulder hiking in most weak-arm reps.
  if (last3.length === 3 && last3.every((t) => t.compensation != null)) {
    const basedOn = basedOnSummary(last3);
    if ((basedOn.avgCompensation as number) > COMPENSATION_ALERT_PCT) {
      return {
        kind: 'compensation',
        phase,
        exercises: base.map((e) => ({
          exercise: e.exercise,
          reps: Math.max(1, Math.round(e.reps * 0.8)),
          target: clampTarget(e.exercise, e.target * 0.9),
        })),
        reason:
          `Compensation averaged ${Math.round(basedOn.avgCompensation as number)}% of weak-arm reps over the last 3 sessions (threshold 50%). ` +
          `Stay in phase ${phase} with 20% fewer reps and 10% lower targets so the patient can focus on form ` +
          `(no leaning or shoulder hiking).`,
        basedOn,
      };
    }
  }

  // 2. Ready: last 3 sessions above the phase target with low compensation.
  if (phase < MAX_PHASE && shouldSuggestNextPhase({ phase }, timeline)) {
    const basedOn = basedOnSummary(last3);
    const capped: string[] = [];
    const exercises = base.map((e) => {
      let target = clampTarget(e.exercise, e.target * 1.1);
      // Never suggest an arm-raise target above the clinician's safety limit.
      if (e.exercise === 'arm_raise' && typeof patient.maxRaiseAngle === 'number' && target > patient.maxRaiseAngle) {
        target = patient.maxRaiseAngle;
        capped.push(`arm raise capped at the ${patient.maxRaiseAngle}° safety limit`);
      }
      return { exercise: e.exercise, reps: e.reps, target };
    });
    return {
      kind: 'phase-up',
      phase: phase + 1,
      exercises,
      reason:
        `Symmetry averaged ${Math.round(basedOn.avgSymmetry as number)}% over the last 3 sessions, above the phase ${phase} target of ` +
        `${PHASE_TARGETS[phase]}%, with ${Math.round(basedOn.avgCompensation as number)}% compensation. ` +
        `Move to phase ${phase + 1} with targets raised 10%` +
        (capped.length ? ` (${capped.join('; ')}).` : '.'),
      basedOn,
    };
  }

  // 3. Plateau: flat for 2 weeks. Shift volume to the weakest exercise.
  if (isPlateau(timeline, now)) {
    const recent = recentWithSymmetry(timeline, now);
    const values = recent.map((t) => t.symmetry as number);
    const byExercise = base
      .map((e) => {
        const sym = recent
          .map((t) => symmetryForExercise(t.results, e.exercise))
          .filter((v): v is number => v != null);
        return { exercise: e.exercise, avg: sym.length ? mean(sym) : Infinity };
      })
      .sort((a, b) => a.avg - b.avg);
    const weakest = byExercise[0].exercise;

    let change = '';
    const exercises = base.map((e) => {
      if (e.exercise !== weakest) return { ...e };
      const reps = Math.min(MAX_PLAN_REPS, Math.max(e.reps + 1, Math.round(e.reps * 1.2)));
      const target = clampTarget(e.exercise, e.target * 0.95);
      change = `more reps (${e.reps} → ${reps}) at an easier target (${e.target} → ${target})`;
      return { exercise: e.exercise, reps, target };
    });
    const weakestAvg = byExercise[0].avg;
    return {
      kind: 'plateau',
      phase,
      exercises,
      reason:
        `Symmetry has stayed between ${Math.round(Math.min(...values))}% and ${Math.round(Math.max(...values))}% ` +
        `over ${recent.length} sessions in the last 14 days. Weakest exercise is ${EXERCISE_NAMES[weakest]}` +
        (Number.isFinite(weakestAvg) ? ` (${Math.round(weakestAvg)}%)` : '') +
        `: ${change}, to shift practice to where progress lags.`,
      basedOn: basedOnSummary(recent),
    };
  }

  return null;
}

/** A suggestPlanChange() result as a plan to insert with status 'suggested'. */
export function buildSuggestedPlan(
  patient: Pick<Patient, 'id' | 'nextCheckin'>,
  currentPlan: Pick<Plan, 'sessionsPerWeek'> | null | undefined,
  change: PlanChange,
  now = new Date(),
): NewPlan {
  return {
    patientId: patient.id,
    phase: change.phase,
    exercises: change.exercises,
    sessionsPerWeek: currentPlan?.sessionsPerWeek || DEFAULT_SESSIONS_PER_WEEK,
    nextCheckin: patient.nextCheckin,
    createdAt: now.toISOString(),
    kind: change.kind,
    reason: change.reason,
    basedOn: change.basedOn,
  };
}

/** Latest time (ISO) the care team approved or dismissed a plan for this patient, or null. */
export function lastPlanDecisionAt(plans: Plan[], patientId: string): string | null {
  let latest: number | null = null;
  for (const p of plans) {
    if (p.patientId !== patientId) continue;
    const approvedAt = p.approvedAt || (p.status === 'approved' || p.status === 'superseded' ? p.createdAt : null);
    for (const t of [approvedAt, p.dismissedAt]) {
      const ms = t ? Date.parse(t) : NaN;
      if (Number.isFinite(ms) && (latest === null || ms > latest)) latest = ms;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}

export function currentApprovedPlan(plans: Plan[], patientId: string): Plan | null {
  return (
    plans
      .filter((p) => p.patientId === patientId && p.status === 'approved')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

// ---- main entry ----

/** Run every rule for one patient's snapshot. Pure: returns what to write. */
export function evaluate(s: Snapshot, now: Date): { alerts: NewAlert[]; plan: NewPlan | null } {
  const { patient } = s;
  const patientId = patient.id;
  const timeline = sessionTimeline(patientId, s.sessions, s.results);
  const lastEntry = timeline[timeline.length - 1];
  const watchDaily = s.watch.filter((w) => w.patientId === patientId).sort((a, b) => a.date.localeCompare(b.date));
  const latestWatch = watchDaily[watchDaily.length - 1];
  const alerts: AlertLike[] = s.alerts.slice();
  const created: NewAlert[] = [];

  // Newest data each kind of rule looks at, for the acknowledgement cooldown. A watch row covers a whole
  // day, so it counts from local midnight.
  const latestSessionAt = lastEntry ? new Date(lastEntry.session.startedAt).toISOString() : null;
  const latestWatchAt = latestWatch ? localDateStart(latestWatch.date).toISOString() : null;

  const addIfNew = (type: AlertType, detail: string) => {
    if (hasOpenAlert(alerts, patientId, type)) return;
    const dataTime = WATCH_ALERT_TYPES.includes(type) ? latestWatchAt : latestSessionAt;
    if (isCoolingDown(alerts, patientId, type, dataTime, now)) return;
    alerts.push({ patientId, type, acknowledged: false });
    created.push({ patientId, type, detail, createdAt: now.toISOString() });
  };

  // Session-based alerts
  if (isPlateau(timeline, now)) {
    addIfNew(
      'plateau',
      'Symmetry has been flat (under 5-point range) for about 2 weeks. Care team may want to review the plan.',
    );
  }

  const setback = setbackInfo(timeline);
  if (setback) {
    addIfNew(
      'setback',
      `Symmetry dropped to ${setback.latest.toFixed(0)}% from an average of ${setback.baseline.toFixed(0)}% over the ` +
        `previous ${setback.sessions} session(s). Consider an earlier check-in.`,
    );
  }

  if (lastEntry && lastEntry.compensation != null && lastEntry.compensation > COMPENSATION_ALERT_PCT) {
    addIfNew(
      'compensation',
      `Compensation in ${lastEntry.compensation.toFixed(0)}% of weak-arm reps in the latest session (threshold 50%).`,
    );
  }

  const misses = missedSessionStreak(timeline, now);
  if (misses >= MISSED_DAYS_ALERT) {
    addIfNew('adherence', `About ${misses} missed session day(s) in a row since the last completed session.`);
  }

  if (lastEntry && lastEntry.session.stopReason) {
    addIfNew('safety-stop', safetyStopDetail(lastEntry));
  }

  if (lastEntry && typeof lastEntry.session.pain === 'number' && lastEntry.session.pain >= PAIN_ALERT) {
    addIfNew('pain', `Patient reported pain ${lastEntry.session.pain}/10 in the latest session (threshold 7).`);
  }

  // Watch-based alerts
  const hrSpike = restingHrSpike(watchDaily);
  if (hrSpike) {
    addIfNew(
      'heart-rate',
      `Resting heart rate ${hrSpike.latest} bpm on ${hrSpike.date} is 10+ above the recent 2-week average (${hrSpike.avg} bpm).`,
    );
  }

  if (
    latestWatch &&
    typeof latestWatch.bpSys === 'number' &&
    typeof patient.bpLimitSys === 'number' &&
    latestWatch.bpSys > patient.bpLimitSys
  ) {
    addIfNew(
      'blood-pressure',
      `Systolic BP ${latestWatch.bpSys} mmHg on ${latestWatch.date} is above this patient's limit of ${patient.bpLimitSys}.`,
    );
  }

  if (latestWatch && typeof latestWatch.falls === 'number' && latestWatch.falls > 0) {
    addIfNew('fall', `${latestWatch.falls} fall(s) recorded on ${latestWatch.date}.`);
  }

  // Plan change (at most one open suggestion per patient)
  let plan: NewPlan | null = null;
  const hasSuggested = s.plans.some((p) => p.patientId === patientId && p.status === 'suggested');
  if (!hasSuggested) {
    // Only sessions recorded after the care team's last approve/dismiss, so a decision isn't
    // immediately second-guessed with the same data.
    const decidedAt = lastPlanDecisionAt(s.plans, patientId);
    const decidedMs = decidedAt ? Date.parse(decidedAt) : -Infinity;
    const fresh = timeline.filter((t) => Date.parse(t.session.startedAt) > decidedMs);
    const approved = currentApprovedPlan(s.plans, patientId);
    const change = suggestPlanChange(patient, fresh, approved, now);
    if (change) plan = buildSuggestedPlan(patient, approved, change, now);
  }

  return { alerts: created, plan };
}
