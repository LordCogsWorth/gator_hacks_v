/**
 * Seed demo data for RehabTrack.
 *
 * Safe to re-run — it wipes api/data/ and rebuilds everything.
 *
 * Three patients, ~3 weeks of daily sessions + watchDaily each:
 *   Maria  — steadily improving symmetry (45% → 70%), good adherence
 *   James  — plateau (~55% last 2 weeks), missed sessions recently
 *   Priya  — rising symmetry but high compensation; resting HR rising last week
 *
 * Plus one approved plan per patient, then runs the rules engine, which raises
 * the alerts and drafts each patient's suggested plan (with its reason):
 *   Maria → phase up, James → plateau tweak, Priya → lighter load for form.
 *
 * Usage: npm run seed
 *        SEED_TODAY=2026-10-24 npm run seed   (pretend "today" is another date)
 *
 * By default "today" is noon UTC of the current date, so the stories line up
 * with the real clock the rules engine uses at runtime.
 */

const store = require('./store');
const { evaluateAll, EXERCISES } = require('./rules');

function resolveToday() {
  if (process.env.SEED_TODAY) {
    const d = new Date(process.env.SEED_TODAY);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`SEED_TODAY is not a valid date: ${process.env.SEED_TODAY}`);
    }
    return d;
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

const TODAY = resolveToday();

function daysAgo(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function sessionStamp(d, hour = 15) {
  const s = new Date(d);
  s.setUTCHours(hour, 30, 0, 0);
  return s.toISOString();
}

function endedStamp(startedIso, minutes = 12) {
  const e = new Date(startedIso);
  e.setUTCMinutes(e.getUTCMinutes() + minutes);
  return e.toISOString();
}

/**
 * Build 6 ExerciseResult rows (3 exercises × 2 sides) for a given symmetry %.
 * healthy best is fixed; weak best = healthy * symmetry/100.
 * compensationPct applies to weak-arm results.
 * offsets shifts symmetry per exercise, e.g. { hand_open: -6 }.
 */
function buildResults(sessionId, symmetryPct, compensationPct, offsets = {}) {
  const healthyBest = {
    arm_raise: 160,
    forward_reach: 150,
    hand_open: 90,
  };
  const rows = [];
  for (const exercise of EXERCISES) {
    const h = healthyBest[exercise];
    const w = Math.round((h * (symmetryPct + (offsets[exercise] || 0))) / 100);
    rows.push({
      id: store.makeId('er'),
      sessionId,
      exercise,
      side: 'healthy',
      bestValue: h,
      reps: 10,
      secPerRep: 3.0,
      smoothness: 1.1,
      fatigue: 0.98,
      trunkLeanMax: 3,
      shoulderHikeMax: 0.01,
      compRepPct: 0,
    });
    rows.push({
      id: store.makeId('er'),
      sessionId,
      exercise,
      side: 'weak',
      bestValue: w,
      reps: 8,
      secPerRep: 4.2,
      smoothness: 2.4,
      fatigue: 0.9,
      trunkLeanMax: compensationPct > 40 ? 16 : 8,
      shoulderHikeMax: compensationPct > 40 ? 0.05 : 0.02,
      compRepPct: compensationPct,
    });
  }
  return rows;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Dates are relative to TODAY (negative daysAgo = days from now).
function buildPatients() {
  return [
    {
      id: 'p-maria',
      name: 'Maria Santos',
      weakSide: 'left',
      strokeDate: isoDate(daysAgo(104)),
      phase: 2,
      maxRaiseAngle: 120,
      nextCheckin: isoDate(daysAgo(-4)),
      bpLimitSys: 150,
    },
    {
      id: 'p-james',
      name: 'James Okonkwo',
      weakSide: 'right',
      strokeDate: isoDate(daysAgo(174)),
      phase: 2,
      maxRaiseAngle: 110,
      nextCheckin: isoDate(daysAgo(-2)),
      bpLimitSys: 145,
    },
    {
      id: 'p-priya',
      name: 'Priya Nair',
      weakSide: 'left',
      strokeDate: isoDate(daysAgo(65)),
      phase: 1,
      maxRaiseAngle: 100,
      nextCheckin: isoDate(daysAgo(-6)),
      bpLimitSys: 140,
    },
  ];
}

/**
 * Generate ~3 weeks of sessions for a patient.
 * skipDays = set of day offsets (from TODAY) to skip (missed sessions).
 * symmetryAt(dayOffset) and compensationAt(dayOffset) are functions.
 */
function generateSessions(patientId, { skipDays, symmetryAt, compensationAt, painAt, offsets }) {
  const sessions = [];
  const results = [];
  // Days 20 ago through yesterday — about 3 weeks. Today is left empty so no
  // seeded session is in the future, and the live demo upload is "today's".
  for (let ago = 20; ago >= 1; ago--) {
    if (skipDays.has(ago)) continue;
    // Skip some weekends lightly for realism unless it's a forced miss day.
    const d = daysAgo(ago);
    const dow = d.getUTCDay(); // 0 Sun … 6 Sat
    if ((dow === 0 || dow === 6) && ago % 3 === 0 && !skipDays.has(ago)) {
      // keep most weekend sessions for denser charts; skip every 3rd weekend day
      continue;
    }

    const startedAt = sessionStamp(d);
    const session = {
      id: store.makeId('sess'),
      patientId,
      startedAt,
      endedAt: endedStamp(startedAt),
      pain: painAt ? painAt(ago) : 2 + (ago % 3 === 0 ? 1 : 0),
      tiredness: 2 + (ago % 4 === 0 ? 1 : 0),
      avgHr: null,
      replayFile: null,
    };
    sessions.push(session);
    results.push(...buildResults(session.id, symmetryAt(ago), compensationAt(ago), offsets));
  }
  return { sessions, results };
}

function generateWatch(patientId, { restingHrAt, bpSysAt, stepsAt, extras }) {
  const rows = [];
  for (let ago = 20; ago >= 0; ago--) {
    const d = daysAgo(ago);
    const date = isoDate(d);
    rows.push({
      id: store.makeId('wd'),
      patientId,
      date,
      steps: stepsAt ? stepsAt(ago) : 3500 + ((20 - ago) * 80) % 2000,
      exerciseMin: 15 + (ago % 5) * 2,
      standHr: 8 + (ago % 3),
      restingHr: restingHrAt(ago),
      hrv: 35 + (ago % 7),
      sleepHr: 6.5 + (ago % 4) * 0.3,
      bpSys: bpSysAt(ago),
      bpDia: 78 + (ago % 5),
      falls: extras && extras.fallsOn && extras.fallsOn.has(ago) ? 1 : 0,
      weakArmActiveMin: 60 + (20 - ago) * 2,
      useRatio: Math.round((0.4 + (20 - ago) * 0.01) * 100) / 100,
    });
  }
  return rows;
}

function approvedPlan(patient, phase, sessionsPerWeek) {
  return {
    id: store.makeId('plan'),
    patientId: patient.id,
    phase,
    exercises: [
      { exercise: 'arm_raise', reps: 10, target: 85 + phase * 8 },
      { exercise: 'forward_reach', reps: 10, target: 125 + phase * 5 },
      { exercise: 'hand_open', reps: 12, target: 55 + phase * 8 },
    ],
    sessionsPerWeek,
    status: 'approved',
    approvedBy: 'Dr. Chen',
    nextCheckin: patient.nextCheckin,
    createdAt: daysAgo(21).toISOString(),
    approvedAt: daysAgo(21).toISOString(),
  };
}

function seed() {
  store.ensureDataDir();

  // Wipe collections so re-running is safe.
  for (const name of [
    'patients',
    'plans',
    'sessions',
    'exerciseResults',
    'watchDaily',
    'alerts',
  ]) {
    store.writeAll(name, []);
  }

  const patients = buildPatients();
  store.writeAll('patients', patients);

  const allSessions = [];
  const allResults = [];
  const allWatch = [];
  const allPlans = [];

  // ---- Maria: improving 45% → ~71%, good adherence ----
  {
    const maria = patients[0];
    const { sessions, results } = generateSessions(maria.id, {
      skipDays: new Set(), // rarely misses
      // Ends a little above 70 so her last 3 sessions clear the phase-2
      // target (65%) whichever weekend days get skipped.
      symmetryAt: (ago) => Math.round(lerp(45, 72, (20 - ago) / 20)),
      compensationAt: () => 12 + Math.round(Math.random() * 5),
      painAt: () => 2,
    });
    // Make compensation deterministic (no Math.random at runtime for stable demos)
    for (const r of results) {
      if (r.side === 'weak') {
        r.compRepPct = 10 + (r.exercise === 'arm_raise' ? 5 : 0);
        r.trunkLeanMax = 7;
        r.shoulderHikeMax = 0.02;
      }
    }
    allSessions.push(...sessions);
    allResults.push(...results);
    allWatch.push(
      ...generateWatch(maria.id, {
        restingHrAt: () => 68,
        bpSysAt: () => 128,
        stepsAt: (ago) => 4000 + (20 - ago) * 50,
      })
    );
    allPlans.push(approvedPlan(maria, 2, 5));
  }

  // ---- James: plateau ~55% last 2 weeks, missed recent sessions ----
  {
    const james = patients[1];
    const { sessions, results } = generateSessions(james.id, {
      // Miss last 4 days (adherence alert) and a couple earlier
      skipDays: new Set([0, 1, 2, 3, 10]),
      symmetryAt: (ago) => {
        // First week rises a bit, then flat ~55 for last 2 weeks
        if (ago > 14) return Math.round(lerp(48, 55, (20 - ago) / 6));
        return 54 + (ago % 3); // 54–56 range → plateau
      },
      compensationAt: () => 18,
      painAt: () => 3,
      // Hand opening lags the other exercises, so the plateau suggestion targets it.
      offsets: { hand_open: -6 },
    });
    for (const r of results) {
      if (r.side === 'weak') {
        r.compRepPct = 18;
        r.trunkLeanMax = 9;
        r.shoulderHikeMax = 0.025;
      }
    }
    allSessions.push(...sessions);
    allResults.push(...results);
    allWatch.push(
      ...generateWatch(james.id, {
        restingHrAt: () => 72,
        bpSysAt: () => 135,
        stepsAt: (ago) => 2800 + (ago % 5) * 100,
      })
    );
    allPlans.push(approvedPlan(james, 2, 5));
  }

  // ---- Priya: rising symmetry, high compensation, rising RHR ----
  {
    const priya = patients[2];
    const { sessions, results } = generateSessions(priya.id, {
      skipDays: new Set([7]),
      symmetryAt: (ago) => Math.round(lerp(40, 58, (20 - ago) / 20)),
      compensationAt: () => 55, // over 50% → compensation alert
      painAt: (ago) => (ago === 1 ? 4 : 3),
    });
    for (const r of results) {
      if (r.side === 'weak') {
        r.compRepPct = 55;
        r.trunkLeanMax = 18;
        r.shoulderHikeMax = 0.06;
      }
    }
    allSessions.push(...sessions);
    allResults.push(...results);
    allWatch.push(
      ...generateWatch(priya.id, {
        // Steady ~66 for first 2 weeks, then climbs last week
        restingHrAt: (ago) => {
          if (ago > 7) return 66;
          return 66 + Math.round(((7 - ago) / 7) * 14); // up to ~80
        },
        bpSysAt: (ago) => (ago === 0 ? 148 : 130), // latest day above limit 140
        stepsAt: (ago) => 3200 + (20 - ago) * 40,
        extras: { fallsOn: new Set() },
      })
    );
    allPlans.push(approvedPlan(priya, 1, 5));
  }

  store.writeAll('sessions', allSessions);
  store.writeAll('exerciseResults', allResults);
  store.writeAll('watchDaily', allWatch);
  store.writeAll('plans', allPlans);
  store.writeAll('alerts', []);

  // Run rules as of the seed "today" so alerts match the story.
  const summary = evaluateAll({ now: TODAY });

  console.log(`Seeded RehabTrack demo data (today = ${TODAY.toISOString().slice(0, 10)}).`);
  console.log(`  patients: ${patients.length}`);
  console.log(`  sessions: ${allSessions.length}`);
  console.log(`  exerciseResults: ${allResults.length}`);
  console.log(`  watchDaily: ${allWatch.length}`);
  console.log(`  plans: ${store.readAll('plans').length} (incl. suggestions from the rules engine)`);
  for (const s of summary) {
    const types = s.alertsCreated.map((a) => a.type).join(', ') || '(none)';
    console.log(`  alerts for ${s.patientId}: ${types}`);
  }
}

seed();
