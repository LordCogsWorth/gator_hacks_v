/**
 * Rules engine for RehabTrack.
 *
 * Runs after each session upload (and after seeding).
 * - Suggests a next-phase plan when the patient is ready.
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
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

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
function isPlateau(timeline, now = new Date()) {
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const recent = timeline.filter(
    (t) => t.symmetry != null && new Date(t.session.startedAt) >= twoWeeksAgo
  );
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

/**
 * Build a suggested plan draft (does not write to disk by itself).
 */
function buildSuggestedPlan(patient, currentPlan) {
  const nextPhase = Math.min((patient.phase || 1) + 1, 4);
  const baseExercises = (currentPlan && currentPlan.exercises) || [
    { exercise: 'arm_raise', reps: 10, target: 90 },
    { exercise: 'forward_reach', reps: 10, target: 140 },
    { exercise: 'hand_open', reps: 12, target: 70 },
  ];

  // Bump targets a bit for the next phase.
  const exercises = baseExercises.map((e) => ({
    ...e,
    target: Math.min(Math.round(e.target * 1.1), e.exercise === 'hand_open' ? 100 : 180),
  }));

  return {
    id: store.makeId('plan'),
    patientId: patient.id,
    phase: nextPhase,
    exercises,
    sessionsPerWeek: (currentPlan && currentPlan.sessionsPerWeek) || 5,
    status: 'suggested',
    approvedBy: null,
    nextCheckin: patient.nextCheckin,
    createdAt: new Date().toISOString(),
  };
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

  // --- Suggest next phase if ready and no open suggested plan ---
  let planSuggested = null;
  const hasSuggested = plans.some(
    (p) => p.patientId === patientId && p.status === 'suggested'
  );
  const approved = plans
    .filter((p) => p.patientId === patientId && p.status === 'approved')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!hasSuggested && shouldSuggestNextPhase(patient, timeline)) {
    planSuggested = buildSuggestedPlan(patient, approved);
    plans.push(planSuggested);
    store.writeAll('plans', plans);
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
  buildSuggestedPlan,
  hasOpenAlert,
  evaluatePatient,
  evaluateAll,
};
