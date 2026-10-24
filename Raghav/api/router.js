/**
 * RehabTrack API routes.
 *
 * Exports one express.Router() so Kyle can later mount it into main/server:
 *   app.use('/api', require('../Raghav/api/router'));
 *
 * During development we run this via api/dev-server.js on port 8081.
 */

const express = require('express');
const store = require('./store');
const {
  evaluatePatient,
  avgSymmetry,
  avgCompensation,
  EXERCISES,
  symmetryForExercise,
} = require('./rules');

const router = express.Router();

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
router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'rehabtrack-api' });
});

/**
 * GET /patients — list with summary fields for the care-team list screen.
 */
router.get('/patients', (_req, res) => {
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
});

/**
 * GET /patients/:id — patient + current plan + open alerts
 */
router.get('/patients/:id', (req, res) => {
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
});

/**
 * GET /patients/:id/sessions — sessions with nested exerciseResults
 */
router.get('/patients/:id/sessions', (req, res) => {
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
});

/**
 * POST /sessions — Lucas's patient app uploads a finished session.
 * Body: { patientId, startedAt, endedAt, pain, tiredness, results: ExerciseResult[] }
 */
router.post('/sessions', (req, res) => {
  const body = req.body || {};
  const { patientId, startedAt, endedAt, pain, tiredness, results } = body;

  if (!patientId || !startedAt || !endedAt || !Array.isArray(results)) {
    return res.status(400).json({
      error: 'Required: patientId, startedAt, endedAt, results (array)',
    });
  }

  const patient = store.findById('patients', patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const session = {
    id: store.makeId('sess'),
    patientId,
    startedAt,
    endedAt,
    pain: typeof pain === 'number' ? pain : null,
    tiredness: typeof tiredness === 'number' ? tiredness : null,
    avgHr: null,
    replayFile: null,
  };
  store.append('sessions', session);

  const savedResults = results.map((r) => ({
    id: store.makeId('er'),
    sessionId: session.id,
    exercise: r.exercise,
    side: r.side,
    bestValue: r.bestValue,
    reps: r.reps,
    secPerRep: r.secPerRep,
    smoothness: r.smoothness,
    fatigue: r.fatigue,
    trunkLeanMax: r.trunkLeanMax,
    shoulderHikeMax: r.shoulderHikeMax,
    compRepPct: r.compRepPct,
  }));
  for (const r of savedResults) {
    store.append('exerciseResults', r);
  }

  const ruleResult = evaluatePatient(patientId);

  res.status(201).json({
    session,
    results: savedResults,
    alertsCreated: ruleResult.alertsCreated,
    planSuggested: ruleResult.planSuggested,
  });
});

/**
 * GET /patients/:id/plan — current approved plan (what the patient should do today)
 */
router.get('/patients/:id/plan', (req, res) => {
  const patient = store.findById('patients', req.params.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }
  const plan = currentApprovedPlan(patient.id, store.readAll('plans'));
  if (!plan) {
    return res.status(404).json({ error: 'No approved plan for this patient' });
  }
  res.json(plan);
});

/**
 * GET /patients/:id/watch — watchDaily rows for charts
 */
router.get('/patients/:id/watch', (req, res) => {
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
});

/**
 * POST /watch/daily — one day of Health data from the iPhone Shortcut.
 * Same patientId + date replaces the previous row.
 */
router.post('/watch/daily', (req, res) => {
  const body = req.body || {};
  const { patientId, date } = body;
  if (!patientId || !date) {
    return res.status(400).json({ error: 'Required: patientId, date (YYYY-MM-DD)' });
  }

  const patient = store.findById('patients', patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const existing = store.readAll('watchDaily');
  const index = existing.findIndex((w) => w.patientId === patientId && w.date === date);
  const row = {
    id: index >= 0 ? existing[index].id : store.makeId('wd'),
    patientId,
    date,
    steps: body.steps ?? null,
    exerciseMin: body.exerciseMin ?? null,
    standHr: body.standHr ?? null,
    restingHr: body.restingHr ?? null,
    hrv: body.hrv ?? null,
    sleepHr: body.sleepHr ?? null,
    bpSys: body.bpSys ?? null,
    bpDia: body.bpDia ?? null,
    falls: body.falls ?? null,
    weakArmActiveMin: body.weakArmActiveMin ?? null,
    useRatio: body.useRatio ?? null,
  };

  if (index >= 0) {
    existing[index] = row;
    store.writeAll('watchDaily', existing);
  } else {
    store.append('watchDaily', row);
  }

  // Re-run rules so BP / HR / fall alerts update.
  const ruleResult = evaluatePatient(patientId);

  res.status(201).json({ watchDaily: row, alertsCreated: ruleResult.alertsCreated });
});

/**
 * GET /alerts — all open (unacknowledged) alerts across patients
 */
router.get('/alerts', (_req, res) => {
  const alerts = store
    .readAll('alerts')
    .filter((a) => !a.acknowledged)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(alerts);
});

/**
 * PATCH /alerts/:id — acknowledge an alert
 * Body: { acknowledged: true } (or just hit the endpoint)
 */
router.patch('/alerts/:id', (req, res) => {
  const alerts = store.readAll('alerts');
  const index = alerts.findIndex((a) => a.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: 'Alert not found' });
  }
  alerts[index] = {
    ...alerts[index],
    acknowledged: true,
  };
  store.writeAll('alerts', alerts);
  res.json(alerts[index]);
});

/**
 * POST /plans/:id/approve — care team approves (and optionally edits) a plan
 * Body: { exercises?, sessionsPerWeek?, nextCheckin?, approvedBy }
 */
router.post('/plans/:id/approve', (req, res) => {
  const plans = store.readAll('plans');
  const index = plans.findIndex((p) => p.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const body = req.body || {};
  if (!body.approvedBy) {
    return res.status(400).json({ error: 'approvedBy is required' });
  }

  const plan = { ...plans[index] };
  if (Array.isArray(body.exercises)) plan.exercises = body.exercises;
  if (typeof body.sessionsPerWeek === 'number') plan.sessionsPerWeek = body.sessionsPerWeek;
  if (typeof body.nextCheckin === 'string') plan.nextCheckin = body.nextCheckin;
  plan.status = 'approved';
  plan.approvedBy = body.approvedBy;
  plans[index] = plan;
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
});

module.exports = router;
