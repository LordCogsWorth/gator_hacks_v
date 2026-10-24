/**
 * RehabTrack API routes.
 *
 * Exports one express.Router() so Kyle can later mount it into main/server:
 *   app.use('/api', require('../Raghav/api/router'));
 *
 * During development we run this via api/dev-server.js on port 8081.
 *
 * Self-contained: parses its own JSON bodies and always answers errors as
 * JSON ({ error }), so it behaves the same when mounted in another server.
 */

const express = require('express');
const store = require('./store');
const { validateSession, validateWatchDaily, validateApproval, WATCH_NUMBER_FIELDS } = require('./validate');
const {
  evaluatePatient,
  avgSymmetry,
  avgCompensation,
  EXERCISES,
  symmetryForExercise,
  PHASE_TARGETS,
  MAX_PHASE,
  ALERT_COOLDOWN_HOURS,
} = require('./rules');

const router = express.Router();

// Parse JSON here (not in the host server) so the router works wherever it's mounted.
router.use(express.json({ limit: '5mb' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfWeekUTC(now = new Date()) {
  // Monday as start of week (ISO-ish).
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function sessionsThisWeek(patientId, sessions, now = new Date()) {
  const start = startOfWeekUTC(now).toISOString();
  return sessions.filter((s) => s.patientId === patientId && s.startedAt >= start).length;
}

function openAlertsFor(patientId, alerts) {
  return alerts.filter((a) => a.patientId === patientId && !a.acknowledged);
}

function currentApprovedPlan(patientId, plans) {
  return plans
    .filter((p) => p.patientId === patientId && p.status === 'approved')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

function currentPlanAny(patientId, plans) {
  // Prefer an open suggested plan for the detail view; else approved.
  const suggested = plans
    .filter((p) => p.patientId === patientId && p.status === 'suggested')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (suggested) return suggested;
  return currentApprovedPlan(patientId, plans);
}

/**
 * Wrap a route handler so any thrown error (sync or async) goes to the JSON
 * error handler at the bottom instead of crashing the process.
 */
function wrap(handler) {
  return (req, res, next) => {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/** 400 with every field problem listed: { error, details: [{ field, message }] } */
function badRequest(res, error, details) {
  return res.status(400).json({ error, details });
}

function resultsForSession(sessionId, allResults) {
  return allResults.filter((r) => r.sessionId === sessionId);
}

/**
 * Latest average symmetry + simple trend vs previous session.
 * trend: 'up' | 'down' | 'flat' | 'none'
 */
function latestSymmetrySummary(patientId, sessions, results) {
  const mine = sessions
    .filter((s) => s.patientId === patientId)
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  if (mine.length === 0) {
    return { latestSymmetry: null, trend: 'none', trendDelta: 0 };
  }

  const last = mine[mine.length - 1];
  const lastSym = avgSymmetry(resultsForSession(last.id, results));
  if (mine.length === 1) {
    return { latestSymmetry: lastSym, trend: 'none', trendDelta: 0 };
  }

  const prev = mine[mine.length - 2];
  const prevSym = avgSymmetry(resultsForSession(prev.id, results));
  if (lastSym == null || prevSym == null) {
    return { latestSymmetry: lastSym, trend: 'none', trendDelta: 0 };
  }

  const delta = lastSym - prevSym;
  let trend = 'flat';
  if (delta >= 2) trend = 'up';
  else if (delta <= -2) trend = 'down';
  return { latestSymmetry: lastSym, trend, trendDelta: delta };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /health — quick liveness check */
router.get('/health', wrap((_req, res) => {
  res.json({ ok: true, service: 'rehabtrack-api' });
}));

/** GET /config — rule constants the dashboard draws (phase targets, etc.) */
router.get('/config', wrap((_req, res) => {
  res.json({
    phaseTargets: PHASE_TARGETS,
    maxPhase: MAX_PHASE,
    exercises: EXERCISES,
    alertCooldownHours: ALERT_COOLDOWN_HOURS,
  });
}));

/**
 * GET /patients — list with summary fields for the care-team list screen.
 */
router.get('/patients', wrap((_req, res) => {
  const patients = store.readAll('patients');
  const sessions = store.readAll('sessions');
  const results = store.readAll('exerciseResults');
  const alerts = store.readAll('alerts');
  const plans = store.readAll('plans');

  const list = patients.map((p) => {
    const { latestSymmetry, trend, trendDelta } = latestSymmetrySummary(
      p.id,
      sessions,
      results
    );
    const openAlerts = openAlertsFor(p.id, alerts);
    const plan = currentApprovedPlan(p.id, plans);
    const weekCount = sessionsThisWeek(p.id, sessions);

    return {
      ...p,
      latestSymmetry: latestSymmetry != null ? Math.round(latestSymmetry) : null,
      trend,
      trendDelta: Math.round(trendDelta * 10) / 10,
      openAlertCount: openAlerts.length,
      openAlertTypes: [...new Set(openAlerts.map((a) => a.type))],
      sessionsThisWeek: weekCount,
      sessionsPerWeek: plan ? plan.sessionsPerWeek : null,
      flagged: openAlerts.length > 0,
    };
  });

  // Flagged patients first, then by name.
  list.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  res.json(list);
}));

/**
 * GET /patients/:id — patient + current plan + open alerts
 */
router.get('/patients/:id', wrap((req, res) => {
  const patient = store.findById('patients', req.params.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }
  const plans = store.readAll('plans');
  const alerts = openAlertsFor(patient.id, store.readAll('alerts'));
  const plan = currentPlanAny(patient.id, plans);
  const approvedPlan = currentApprovedPlan(patient.id, plans);

  res.json({
    patient,
    plan,
    approvedPlan,
    openAlerts: alerts,
  });
}));

/**
 * GET /patients/:id/sessions — sessions with nested exerciseResults
 */
router.get('/patients/:id/sessions', wrap((req, res) => {
  const patient = store.findById('patients', req.params.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const allResults = store.readAll('exerciseResults');
  const sessions = store
    .readAll('sessions')
    .filter((s) => s.patientId === patient.id)
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((s) => {
      const results = resultsForSession(s.id, allResults);
      return {
        ...s,
        results,
        symmetry: avgSymmetry(results),
        compensation: avgCompensation(results),
        symmetryByExercise: Object.fromEntries(
          EXERCISES.map((ex) => [ex, symmetryForExercise(results, ex)])
        ),
      };
    });

  res.json(sessions);
}));

/**
 * POST /sessions — Lucas's patient app uploads a finished session.
 * Body: { patientId, startedAt, endedAt, pain, tiredness, results: ExerciseResult[] }
 */
router.post('/sessions', wrap((req, res) => {
  // Validate everything BEFORE writing, so a bad upload leaves no partial data.
  const { errors, value } = validateSession(req.body);
  if (errors.length > 0) {
    return badRequest(res, 'Invalid session', errors);
  }

  const patient = store.findById('patients', value.patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const session = {
    id: store.makeId('sess'),
    patientId: value.patientId,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    pain: value.pain,
    tiredness: value.tiredness,
    avgHr: null,
    replayFile: null,
  };
  const savedResults = value.results.map((r) => ({
    id: store.makeId('er'),
    sessionId: session.id,
    ...r,
  }));

  store.append('sessions', session);
  store.writeAll('exerciseResults', [...store.readAll('exerciseResults'), ...savedResults]);

  const ruleResult = evaluatePatient(value.patientId);

  res.status(201).json({
    session,
    results: savedResults,
    alertsCreated: ruleResult.alertsCreated,
    planSuggested: ruleResult.planSuggested,
  });
}));

/**
 * GET /patients/:id/plan — current approved plan (what the patient should do today)
 */
router.get('/patients/:id/plan', wrap((req, res) => {
  const patient = store.findById('patients', req.params.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }
  const plan = currentApprovedPlan(patient.id, store.readAll('plans'));
  if (!plan) {
    return res.status(404).json({ error: 'No approved plan for this patient' });
  }
  res.json(plan);
}));

/**
 * GET /patients/:id/watch — watchDaily rows for charts
 */
router.get('/patients/:id/watch', wrap((req, res) => {
  const patient = store.findById('patients', req.params.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }
  const rows = store
    .readAll('watchDaily')
    .filter((w) => w.patientId === patient.id)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  res.json(rows);
}));

/**
 * POST /watch/daily — one day of Health data from the iPhone Shortcut.
 * Same patientId + date MERGES into the existing row: fields not sent
 * (or sent as null) keep their previous value.
 */
router.post('/watch/daily', wrap((req, res) => {
  const { errors, value } = validateWatchDaily(req.body);
  if (errors.length > 0) {
    return badRequest(res, 'Invalid watch daily data', errors);
  }
  const { patientId, date, fields } = value;

  const patient = store.findById('patients', patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const existing = store.readAll('watchDaily');
  const index = existing.findIndex((w) => w.patientId === patientId && w.date === date);
  const prev = index >= 0 ? existing[index] : {};
  const row = { id: prev.id || store.makeId('wd'), patientId, date };
  for (const f of WATCH_NUMBER_FIELDS) {
    row[f] = f in fields ? fields[f] : prev[f] ?? null;
  }

  if (index >= 0) {
    existing[index] = row;
  } else {
    existing.push(row);
  }
  store.writeAll('watchDaily', existing);

  // Re-run rules so BP / HR / fall alerts update.
  const ruleResult = evaluatePatient(patientId);

  res.status(201).json({ watchDaily: row, alertsCreated: ruleResult.alertsCreated });
}));

/**
 * GET /alerts — all open (unacknowledged) alerts across patients
 */
router.get('/alerts', wrap((_req, res) => {
  const alerts = store
    .readAll('alerts')
    .filter((a) => !a.acknowledged)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(alerts);
}));

/**
 * PATCH /alerts/:id — acknowledge an alert
 * Body: { acknowledged: true } (or just hit the endpoint)
 * Sets acknowledgedAt (kept from the first acknowledgement), which the rules
 * engine uses to avoid re-raising the same alert for 72h without newer data.
 */
router.patch('/alerts/:id', wrap((req, res) => {
  const alerts = store.readAll('alerts');
  const index = alerts.findIndex((a) => a.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: 'Alert not found' });
  }
  alerts[index] = {
    ...alerts[index],
    acknowledged: true,
    acknowledgedAt: alerts[index].acknowledgedAt || new Date().toISOString(),
  };
  store.writeAll('alerts', alerts);
  res.json(alerts[index]);
}));

/**
 * POST /plans/:id/approve — care team approves (and optionally edits) a plan
 * Body: { exercises?, sessionsPerWeek?, nextCheckin?, approvedBy }
 * The patient's previously approved plan becomes 'superseded'.
 */
router.post('/plans/:id/approve', wrap((req, res) => {
  const plans = store.readAll('plans');
  const index = plans.findIndex((p) => p.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const { errors, value: body } = validateApproval(req.body || {});
  if (errors.length > 0) {
    return badRequest(res, 'Invalid plan approval', errors);
  }
  if (plans[index].status === 'dismissed' || plans[index].status === 'superseded') {
    return res.status(409).json({ error: `Plan is ${plans[index].status} and can't be approved` });
  }

  const now = new Date().toISOString();
  const plan = { ...plans[index] };
  if (body.exercises !== undefined) {
    plan.exercises = body.exercises.map((e) => ({ exercise: e.exercise, reps: e.reps, target: e.target }));
  }
  if (body.sessionsPerWeek !== undefined) plan.sessionsPerWeek = body.sessionsPerWeek;
  if (body.nextCheckin !== undefined) plan.nextCheckin = body.nextCheckin;
  plan.status = 'approved';
  plan.approvedBy = body.approvedBy;
  plan.approvedAt = now;
  plans[index] = plan;

  // Only one approved plan per patient: retire the one this replaces.
  plans.forEach((p, i) => {
    if (i !== index && p.patientId === plan.patientId && p.status === 'approved') {
      plans[i] = { ...p, status: 'superseded', supersededAt: now };
    }
  });
  store.writeAll('plans', plans);

  // Mirror next check-in onto the patient record.
  if (plan.nextCheckin) {
    const patients = store.readAll('patients');
    const pi = patients.findIndex((p) => p.id === plan.patientId);
    if (pi >= 0) {
      patients[pi] = {
        ...patients[pi],
        nextCheckin: plan.nextCheckin,
        phase: plan.phase,
      };
      store.writeAll('patients', patients);
    }
  }

  res.json(plan);
}));

/**
 * POST /plans/:id/dismiss — care team rejects a suggested plan
 * Body (optional): { dismissedBy }
 */
router.post('/plans/:id/dismiss', wrap((req, res) => {
  const plans = store.readAll('plans');
  const index = plans.findIndex((p) => p.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  if (plans[index].status !== 'suggested') {
    return res.status(409).json({ error: `Only suggested plans can be dismissed (this one is ${plans[index].status})` });
  }
  const dismissedBy = req.body && typeof req.body.dismissedBy === 'string' ? req.body.dismissedBy : null;
  plans[index] = {
    ...plans[index],
    status: 'dismissed',
    dismissedAt: new Date().toISOString(),
    dismissedBy,
  };
  store.writeAll('plans', plans);
  res.json(plans[index]);
}));

// ---------------------------------------------------------------------------
// Fallbacks: unknown route and errors, always as JSON (never Express's HTML page)
// ---------------------------------------------------------------------------

router.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// Express recognises an error handler by its 4 arguments, so keep `_next`.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  let message = err.message || 'Request failed';
  if (err.type === 'entity.parse.failed') message = 'Request body is not valid JSON';
  if (err.type === 'entity.too.large') message = 'Request body is too large (limit 5mb)';
  if (status >= 500) {
    console.error(`[rehabtrack-api] ${req.method} ${req.originalUrl} failed:`, err);
    message = 'Internal server error';
  }
  if (res.headersSent) return;
  res.status(status).json({ error: message });
});

module.exports = router;
