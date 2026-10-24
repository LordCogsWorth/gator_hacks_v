/**
 * Rules engine for RehabTrack.
 *
 * Runs after each session upload (and after seeding).
 * - Drafts a suggested plan for the care team (phase up, plateau, or
 *   compensation), with a plain-language reason. A clinician approves it.
 * - Raises alerts (plateau, setback, compensation, adherence, pain, HR, BP, fall).
 * - Never creates a duplicate "open" alert of the same type for the same patient.
 * - Doesn't re-raise an alert the care team acknowledged in the last 72h
 *   unless newer data has arrived since (see isCoolingDown).
 *
 * Pure helpers are exported so unit tests can call them without touching files.
 */

const store = require('./store');

const EXERCISES = ['arm_raise', 'forward_reach', 'hand_open'];

// After an alert is acknowledged, the same alert type stays quiet this long
// unless newer triggering data arrives.
const ALERT_COOLDOWN_HOURS = 72;

// Alert types driven by Apple Watch rows; every other type is driven by sessions.
const WATCH_ALERT_TYPES = ['heart-rate', 'blood-pressure', 'fall'];

// Phase targets: symmetry % the weak arm should reach before moving on.
const PHASE_TARGETS = {
  1: 50,
  2: 65,
  3: 80,
  4: 90,
};
const MAX_PHASE = 4;

// Upper bound for a plan target: degrees for the arm exercises, % for hand_open.
const TARGET_CEILING = { arm_raise: 180, forward_reach: 180, hand_open: 100 };

const DEFAULT_EXERCISES = [
  { exercise: 'arm_raise', reps: 10, target: 90 },
  { exercise: 'forward_reach', reps: 10, target: 140 },
  { exercise: 'hand_open', reps: 12, target: 70 },
];

const EXERCISE_NAMES = {
  arm_raise: 'arm raise',
  forward_reach: 'forward reach',
  hand_open: 'hand open',
};

// ---------------------------------------------------------------------------
// Symmetry helpers
// ---------------------------------------------------------------------------

/**
 * Symmetry % for one exercise in one session.
 * weak best / healthy best * 100. Returns null if either side is missing.
 */
function symmetryForExercise(results, exercise) {
  const healthy = results.find((r) => r.exercise === exercise && r.side === 'healthy');
  const weak = results.find((r) => r.exercise === exercise && r.side === 'weak');
  if (!healthy || !weak || !healthy.bestValue) {
    return null;
  }
  return (weak.bestValue / healthy.bestValue) * 100;
}

/**
 * Average symmetry across all exercises that have both sides.
 */
function avgSymmetry(results) {
  const values = EXERCISES.map((ex) => symmetryForExercise(results, ex)).filter(
    (v) => v != null
  );
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Average compensation % across weak-arm results in a session.
 */
function avgCompensation(results) {
  const weak = results.filter((r) => r.side === 'weak');
  if (weak.length === 0) return null;
  return weak.reduce((sum, r) => sum + (r.compRepPct || 0), 0) / weak.length;
}

/**
 * Build a chronological list of { session, results, symmetry, compensation }
 * for one patient. Oldest first.
 */
function sessionTimeline(patientId, sessions, allResults) {
  const mine = sessions
    .filter((s) => s.patientId === patientId)
    .slice()
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

  return mine.map((session) => {
    const results = allResults.filter((r) => r.sessionId === session.id);
    return {
      session,
      results,
      symmetry: avgSymmetry(results),
      compensation: avgCompensation(results),
    };
  });
}

/**
 * Is the symmetry trend "flat" over roughly 2 weeks?
 * We look at sessions in the last 14 days and check if the range
 * (max - min) is under 5 percentage points.
 */
function recentWithSymmetry(timeline, now = new Date(), days = 14) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return timeline.filter((t) => t.symmetry != null && new Date(t.session.startedAt) >= since);
}

function isPlateau(timeline, now = new Date()) {
  const recent = recentWithSymmetry(timeline, now);
  if (recent.length < 4) return false;
  const values = recent.map((t) => t.symmetry);
  const range = Math.max(...values) - Math.min(...values);
  return range < 5;
}

/**
 * Setback: latest symmetry is 10+ points below the previous session.
 */
function isSetback(timeline) {
  if (timeline.length < 2) return false;
  const prev = timeline[timeline.length - 2].symmetry;
  const last = timeline[timeline.length - 1].symmetry;
  if (prev == null || last == null) return false;
  return prev - last >= 10;
}

/**
 * Count consecutive calendar days (ending today or the last session day)
 * with no session. Used for adherence alerts.
 *
 * "3 missed sessions in a row" ≈ 3 planned days without a session.
 * We treat one session per day as the expected cadence when sessionsPerWeek
 * is high; for simplicity we flag if there are 3+ calendar days between
 * the last session and "today" with no sessions, OR if the last 3
 * expected session days were missed. Hackathon version: 3+ days gap
 * with no session counts as 3 missed.
 */
function missedSessionStreak(timeline, now = new Date()) {
  if (timeline.length === 0) {
    // No sessions at all — treat as a long miss for seeding edge cases.
    return 99;
  }
  const last = new Date(timeline[timeline.length - 1].session.startedAt);
  // Normalize to UTC midnight for day counting.
  const lastDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayGap = Math.round((today - lastDay) / (24 * 60 * 60 * 1000));
  // dayGap of 0 or 1 = session today or yesterday (ok). Missed streak starts after that.
  return Math.max(0, dayGap - 1);
}

/**
 * Resting HR: latest day is 10+ bpm above the average of the prior 14 days.
 */
function restingHrSpike(watchRows, now = new Date()) {
  const withHr = watchRows
    .filter((w) => typeof w.restingHr === 'number')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (withHr.length < 3) return null;

  const latest = withHr[withHr.length - 1];
  const latestDate = new Date(latest.date + 'T00:00:00.000Z');
  const twoWeeksAgo = new Date(latestDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const baseline = withHr.filter((w) => {
    const d = new Date(w.date + 'T00:00:00.000Z');
    return d < latestDate && d >= twoWeeksAgo;
  });
  if (baseline.length === 0) return null;

  const avg = baseline.reduce((s, w) => s + w.restingHr, 0) / baseline.length;
  if (latest.restingHr - avg >= 10) {
    return { latest: latest.restingHr, avg: Math.round(avg), date: latest.date };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alert helpers
// ---------------------------------------------------------------------------

function hasOpenAlert(alerts, patientId, type) {
  return alerts.some((a) => a.patientId === patientId && a.type === type && !a.acknowledged);
}

/**
 * True when an alert of this type was acknowledged within the cooldown window
 * and the triggering data is NOT newer than that acknowledgement.
 * dataTime = ISO time of the newest data the rule looked at (null = no data).
 * Acknowledged alerts without acknowledgedAt (older data) never block.
 */
function isCoolingDown(alerts, patientId, type, dataTime, now = new Date()) {
  const cutoff = now.getTime() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000;
  const dataMs = dataTime ? Date.parse(dataTime) : -Infinity;
  return alerts.some((a) => {
    if (a.patientId !== patientId || a.type !== type || !a.acknowledged || !a.acknowledgedAt) {
      return false;
    }
    const ackMs = Date.parse(a.acknowledgedAt);
    return ackMs >= cutoff && dataMs <= ackMs;
  });
}

function makeAlert(patientId, type, detail, now = new Date()) {
  return {
    id: store.makeId('alert'),
    patientId,
    type,
    detail,
    createdAt: now.toISOString(),
    acknowledged: false,
  };
}

/**
 * Decide whether the patient is ready for the next phase.
 * Needs last 3 sessions above the current phase target AND
 * compensation under 20% in those sessions.
 */
function shouldSuggestNextPhase(patient, timeline) {
  const target = PHASE_TARGETS[patient.phase] ?? 70;
  const last3 = timeline.slice(-3);
  if (last3.length < 3) return false;
  return last3.every(
    (t) => t.symmetry != null && t.symmetry >= target && t.compensation != null && t.compensation < 20
  );
}

// ---------------------------------------------------------------------------
// Plan suggestions
// ---------------------------------------------------------------------------

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

/** { sessions, avgSymmetry, avgCompensation } for the entries a rule looked at. */
function basedOnSummary(entries) {
  const sym = entries.map((t) => t.symmetry).filter((v) => v != null);
  const comp = entries.map((t) => t.compensation).filter((v) => v != null);
  return {
    sessions: entries.length,
    avgSymmetry: sym.length ? round1(mean(sym)) : null,
    avgCompensation: comp.length ? round1(mean(comp)) : null,
  };
}

function clampTarget(exercise, target) {
  return Math.min(Math.round(target), TARGET_CEILING[exercise] ?? 180);
}

/**
 * Decide whether the care team should see a plan change, from the sessions
 * given (callers pass only sessions recorded after the last plan decision).
 * Checked in priority order: compensation (form first), ready, plateau.
 *
 * Returns { kind, phase, exercises, reason, basedOn } or null. Pure: no I/O.
 */
function suggestPlanChange(patient, timeline, currentPlan, now = new Date()) {
  const phase = patient.phase || 1;
  const base = (currentPlan && currentPlan.exercises) || DEFAULT_EXERCISES;
  const last3 = timeline.slice(-3);

  // 1. Compensation: leaning / shoulder hiking in most weak-arm reps.
  if (last3.length === 3 && last3.every((t) => t.compensation != null)) {
    const basedOn = basedOnSummary(last3);
    if (basedOn.avgCompensation > 50) {
      return {
        kind: 'compensation',
        phase,
        exercises: base.map((e) => ({
          exercise: e.exercise,
          reps: Math.max(1, Math.round(e.reps * 0.8)),
          target: clampTarget(e.exercise, e.target * 0.9),
        })),
        reason:
          `Compensation averaged ${Math.round(basedOn.avgCompensation)}% of weak-arm reps over the last 3 sessions (threshold 50%). ` +
          `Stay in phase ${phase} with 20% fewer reps and 10% lower targets so the patient can focus on form ` +
          `(no leaning or shoulder hiking).`,
        basedOn,
      };
    }
  }

  // 2. Ready: last 3 sessions above the phase target with low compensation.
  if (phase < MAX_PHASE && shouldSuggestNextPhase(patient, timeline)) {
    const basedOn = basedOnSummary(last3);
    const capped = [];
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
        `Symmetry averaged ${Math.round(basedOn.avgSymmetry)}% over the last 3 sessions, above the phase ${phase} target of ` +
        `${PHASE_TARGETS[phase]}%, with ${Math.round(basedOn.avgCompensation)}% compensation. ` +
        `Move to phase ${phase + 1} with targets raised 10%` +
        (capped.length ? ` (${capped.join('; ')}).` : '.'),
      basedOn,
    };
  }

  // 3. Plateau: flat for 2 weeks. Shift volume to the weakest exercise.
  if (isPlateau(timeline, now)) {
    const recent = recentWithSymmetry(timeline, now);
    const values = recent.map((t) => t.symmetry);
    const byExercise = base
      .map((e) => {
        const sym = recent
          .map((t) => symmetryForExercise(t.results, e.exercise))
          .filter((v) => v != null);
        return { exercise: e.exercise, avg: sym.length ? mean(sym) : Infinity };
      })
      .sort((a, b) => a.avg - b.avg);
    const weakest = byExercise[0].exercise;

    let change = '';
    const exercises = base.map((e) => {
      if (e.exercise !== weakest) return { ...e };
      const reps = Math.max(e.reps + 1, Math.round(e.reps * 1.2));
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

/**
 * Turn a suggestPlanChange() result into a 'suggested' plan record
 * (does not write to disk by itself).
 */
function buildSuggestedPlan(patient, currentPlan, change, now = new Date()) {
  return {
    id: store.makeId('plan'),
    patientId: patient.id,
    phase: change.phase,
    exercises: change.exercises,
    sessionsPerWeek: (currentPlan && currentPlan.sessionsPerWeek) || 5,
    status: 'suggested',
    approvedBy: null,
    nextCheckin: patient.nextCheckin,
    createdAt: now.toISOString(),
    kind: change.kind,
    reason: change.reason,
    basedOn: change.basedOn,
  };
}

/**
 * Latest time the care team approved or dismissed a plan for this patient
 * (ISO string), or null. Older approved plans without approvedAt fall back
 * to createdAt.
 */
function lastPlanDecisionAt(plans, patientId) {
  let latest = null;
  for (const p of plans) {
    if (p.patientId !== patientId) continue;
    const approvedAt = p.approvedAt || (p.status === 'approved' || p.status === 'superseded' ? p.createdAt : null);
    for (const t of [approvedAt, p.dismissedAt]) {
      if (t && (!latest || t > latest)) latest = t;
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Main entry: evaluate one patient (or all)
// ---------------------------------------------------------------------------

/**
 * Run all rules for one patient. Reads/writes the JSON store.
 * Returns { alertsCreated: Alert[], planSuggested: Plan|null }.
 */
function evaluatePatient(patientId, options = {}) {
  const now = options.now || new Date();
  const patients = store.readAll('patients');
  const patient = patients.find((p) => p.id === patientId);
  if (!patient) {
    return { alertsCreated: [], planSuggested: null };
  }

  const sessions = store.readAll('sessions');
  const results = store.readAll('exerciseResults');
  const watchDaily = store.readAll('watchDaily').filter((w) => w.patientId === patientId);
  let alerts = store.readAll('alerts');
  let plans = store.readAll('plans');

  const timeline = sessionTimeline(patientId, sessions, results);
  const lastEntry = timeline[timeline.length - 1];
  const latestWatch = watchDaily.slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const created = [];

  // Newest data each kind of rule looks at, for the acknowledgement cooldown.
  // A watch row covers a whole day, so its date counts from midnight UTC.
  const latestSessionAt = lastEntry ? lastEntry.session.startedAt : null;
  const latestWatchAt = latestWatch ? `${latestWatch.date}T00:00:00.000Z` : null;

  const addIfNew = (type, detail) => {
    if (hasOpenAlert(alerts, patientId, type)) return;
    const dataTime = WATCH_ALERT_TYPES.includes(type) ? latestWatchAt : latestSessionAt;
    if (isCoolingDown(alerts, patientId, type, dataTime, now)) return;
    const alert = makeAlert(patientId, type, detail, now);
    alerts.push(alert);
    created.push(alert);
  };

  // --- Session-based alerts ---
  if (isPlateau(timeline, now)) {
    addIfNew(
      'plateau',
      'Symmetry has been flat (under 5-point range) for about 2 weeks. Care team may want to review the plan.'
    );
  }

  if (isSetback(timeline)) {
    const last = timeline[timeline.length - 1];
    const prev = timeline[timeline.length - 2];
    addIfNew(
      'setback',
      `Symmetry dropped from ${prev.symmetry.toFixed(0)}% to ${last.symmetry.toFixed(0)}% between the last two sessions.`
    );
  }

  if (lastEntry && lastEntry.compensation != null && lastEntry.compensation > 50) {
    addIfNew(
      'compensation',
      `Compensation in ${lastEntry.compensation.toFixed(0)}% of weak-arm reps in the latest session (threshold 50%).`
    );
  }

  const misses = missedSessionStreak(timeline, now);
  if (misses >= 3) {
    addIfNew(
      'adherence',
      `About ${misses} missed session day(s) in a row since the last completed session.`
    );
  }

  if (lastEntry && typeof lastEntry.session.pain === 'number' && lastEntry.session.pain >= 7) {
    addIfNew(
      'pain',
      `Patient reported pain ${lastEntry.session.pain}/10 in the latest session (threshold 7).`
    );
  }

  // --- Watch-based alerts ---
  const hrSpike = restingHrSpike(watchDaily, now);
  if (hrSpike) {
    addIfNew(
      'heart-rate',
      `Resting heart rate ${hrSpike.latest} bpm on ${hrSpike.date} is 10+ above the recent 2-week average (${hrSpike.avg} bpm).`
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
      `Systolic BP ${latestWatch.bpSys} mmHg on ${latestWatch.date} is above this patient's limit of ${patient.bpLimitSys}.`
    );
  }

  if (latestWatch && typeof latestWatch.falls === 'number' && latestWatch.falls > 0) {
    addIfNew(
      'fall',
      `${latestWatch.falls} fall(s) recorded on ${latestWatch.date}.`
    );
  }

  // Persist any new alerts.
  if (created.length > 0) {
    store.writeAll('alerts', alerts);
  }

  // --- Suggest a plan change (at most one open 'suggested' plan per patient) ---
  let planSuggested = null;
  const hasSuggested = plans.some(
    (p) => p.patientId === patientId && p.status === 'suggested'
  );
  const approved = plans
    .filter((p) => p.patientId === patientId && p.status === 'approved')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!hasSuggested) {
    // Only look at sessions recorded after the care team's last approve/dismiss,
    // so a decision isn't immediately second-guessed using the same data.
    const decidedAt = lastPlanDecisionAt(plans, patientId);
    const fresh = decidedAt ? timeline.filter((t) => t.session.startedAt > decidedAt) : timeline;
    const change = suggestPlanChange(patient, fresh, approved, now);
    if (change) {
      planSuggested = buildSuggestedPlan(patient, approved, change, now);
      plans.push(planSuggested);
      store.writeAll('plans', plans);
    }
  }

  return { alertsCreated: created, planSuggested };
}

/**
 * Run rules for every patient. Used after seeding.
 */
function evaluateAll(options = {}) {
  const patients = store.readAll('patients');
  const summary = [];
  for (const p of patients) {
    summary.push({ patientId: p.id, ...evaluatePatient(p.id, options) });
  }
  return summary;
}

module.exports = {
  EXERCISES,
  PHASE_TARGETS,
  ALERT_COOLDOWN_HOURS,
  WATCH_ALERT_TYPES,
  isCoolingDown,
  symmetryForExercise,
  avgSymmetry,
  avgCompensation,
  sessionTimeline,
  isPlateau,
  isSetback,
  missedSessionStreak,
  restingHrSpike,
  shouldSuggestNextPhase,
  suggestPlanChange,
  buildSuggestedPlan,
  lastPlanDecisionAt,
  MAX_PHASE,
  hasOpenAlert,
  evaluatePatient,
  evaluateAll,
};
