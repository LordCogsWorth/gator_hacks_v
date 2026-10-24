/**
 * Unit tests for the rules engine.
 * Run with: npm test  (uses Node's built-in test runner — no extra libraries)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// evaluatePatient reads/writes the JSON store, so point the store at a temp
// folder BEFORE requiring rules.js (store.js reads REHAB_DATA_DIR on load).
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-rules-'));
process.env.REHAB_DATA_DIR = DATA_DIR;

const store = require('./store');
const {
  evaluatePatient,
  isCoolingDown,
  suggestPlanChange,
  symmetryForExercise,
  avgSymmetry,
  avgCompensation,
  isPlateau,
  isSetback,
  missedSessionStreak,
  restingHrSpike,
  shouldSuggestNextPhase,
  hasOpenAlert,
} = require('./rules');

function result(exercise, side, bestValue, compRepPct = 0) {
  return {
    exercise,
    side,
    bestValue,
    reps: 10,
    secPerRep: 3,
    smoothness: 1,
    fatigue: 1,
    trunkLeanMax: 5,
    shoulderHikeMax: 0.01,
    compRepPct,
  };
}

function entry(startedAt, symmetry, compensation = 10) {
  return {
    session: { id: 's', patientId: 'p', startedAt, pain: 2, tiredness: 2 },
    results: [],
    symmetry,
    compensation,
  };
}

describe('symmetryForExercise', () => {
  it('computes weak / healthy * 100', () => {
    const results = [
      result('arm_raise', 'healthy', 160),
      result('arm_raise', 'weak', 80),
    ];
    assert.equal(symmetryForExercise(results, 'arm_raise'), 50);
  });

  it('returns null when a side is missing', () => {
    const results = [result('arm_raise', 'healthy', 160)];
    assert.equal(symmetryForExercise(results, 'arm_raise'), null);
  });
});

describe('avgSymmetry / avgCompensation', () => {
  it('averages across exercises with both sides', () => {
    const results = [
      result('arm_raise', 'healthy', 100),
      result('arm_raise', 'weak', 50),
      result('forward_reach', 'healthy', 100),
      result('forward_reach', 'weak', 70),
    ];
    assert.equal(avgSymmetry(results), 60);
  });

  it('averages weak-arm compensation', () => {
    const results = [
      result('arm_raise', 'weak', 50, 40),
      result('forward_reach', 'weak', 50, 60),
      result('arm_raise', 'healthy', 100, 0),
    ];
    assert.equal(avgCompensation(results), 50);
  });
});

describe('isPlateau', () => {
  it('is true when last 2 weeks stay within a 5-point band', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [
      entry('2026-10-11T12:00:00.000Z', 54),
      entry('2026-10-13T12:00:00.000Z', 55),
      entry('2026-10-16T12:00:00.000Z', 56),
      entry('2026-10-20T12:00:00.000Z', 55),
      entry('2026-10-23T12:00:00.000Z', 54),
    ];
    assert.equal(isPlateau(timeline, now), true);
  });

  it('is false when symmetry is clearly rising', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [
      entry('2026-10-11T12:00:00.000Z', 45),
      entry('2026-10-14T12:00:00.000Z', 52),
      entry('2026-10-17T12:00:00.000Z', 60),
      entry('2026-10-21T12:00:00.000Z', 68),
    ];
    assert.equal(isPlateau(timeline, now), false);
  });
});

describe('isSetback', () => {
  it('flags a drop of 10+ points between last two sessions', () => {
    const timeline = [entry('2026-10-20T12:00:00.000Z', 70), entry('2026-10-22T12:00:00.000Z', 58)];
    assert.equal(isSetback(timeline), true);
  });

  it('ignores small drops', () => {
    const timeline = [entry('2026-10-20T12:00:00.000Z', 70), entry('2026-10-22T12:00:00.000Z', 65)];
    assert.equal(isSetback(timeline), false);
  });
});

describe('missedSessionStreak', () => {
  it('counts days since last session (minus 1 grace day)', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [entry('2026-10-20T12:00:00.000Z', 55)];
    // Oct 20 → Oct 24 = 4 day gap → 3 missed
    assert.equal(missedSessionStreak(timeline, now), 3);
  });

  it('is zero when the patient exercised today', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [entry('2026-10-24T08:00:00.000Z', 55)];
    assert.equal(missedSessionStreak(timeline, now), 0);
  });
});

describe('restingHrSpike', () => {
  it('flags when latest RHR is 10+ above the prior 2-week average', () => {
    const rows = [];
    for (let d = 1; d <= 14; d++) {
      const day = String(d).padStart(2, '0');
      rows.push({ date: `2026-10-${day}`, restingHr: 70 });
    }
    rows.push({ date: '2026-10-15', restingHr: 82 });
    const spike = restingHrSpike(rows);
    assert.ok(spike);
    assert.equal(spike.latest, 82);
    assert.equal(spike.avg, 70);
  });

  it('returns null when the rise is small', () => {
    const rows = [
      { date: '2026-10-01', restingHr: 70 },
      { date: '2026-10-08', restingHr: 71 },
      { date: '2026-10-15', restingHr: 74 },
    ];
    assert.equal(restingHrSpike(rows), null);
  });
});

describe('shouldSuggestNextPhase', () => {
  it('suggests when last 3 sessions beat the phase target with low compensation', () => {
    const patient = { phase: 1 };
    const timeline = [
      entry('2026-10-18T12:00:00.000Z', 55, 10),
      entry('2026-10-20T12:00:00.000Z', 58, 12),
      entry('2026-10-22T12:00:00.000Z', 60, 8),
    ];
    assert.equal(shouldSuggestNextPhase(patient, timeline), true);
  });

  it('does not suggest when compensation is high', () => {
    const patient = { phase: 1 };
    const timeline = [
      entry('2026-10-18T12:00:00.000Z', 55, 40),
      entry('2026-10-20T12:00:00.000Z', 58, 45),
      entry('2026-10-22T12:00:00.000Z', 60, 50),
    ];
    assert.equal(shouldSuggestNextPhase(patient, timeline), false);
  });
});

describe('hasOpenAlert', () => {
  it('detects an unacknowledged alert of the same type', () => {
    const alerts = [
      { patientId: 'p-maria', type: 'plateau', acknowledged: false },
      { patientId: 'p-maria', type: 'pain', acknowledged: true },
    ];
    assert.equal(hasOpenAlert(alerts, 'p-maria', 'plateau'), true);
    assert.equal(hasOpenAlert(alerts, 'p-maria', 'pain'), false);
    assert.equal(hasOpenAlert(alerts, 'p-james', 'plateau'), false);
  });
});

describe('isCoolingDown', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  const acked = (acknowledgedAt) => [
    { patientId: 'p', type: 'pain', acknowledged: true, acknowledgedAt },
  ];

  it('blocks when acknowledged recently and data is not newer', () => {
    const alerts = acked('2026-10-24T10:00:00.000Z');
    assert.equal(isCoolingDown(alerts, 'p', 'pain', '2026-10-24T09:00:00.000Z', now), true);
  });

  it('does not block when the data is newer than the acknowledgement', () => {
    const alerts = acked('2026-10-24T10:00:00.000Z');
    assert.equal(isCoolingDown(alerts, 'p', 'pain', '2026-10-24T11:00:00.000Z', now), false);
  });

  it('does not block once the 72h window has passed', () => {
    const alerts = acked('2026-10-20T10:00:00.000Z');
    assert.equal(isCoolingDown(alerts, 'p', 'pain', '2026-10-19T09:00:00.000Z', now), false);
  });
});

// ---------------------------------------------------------------------------
// evaluatePatient against a real (temporary) JSON store
// ---------------------------------------------------------------------------

describe('evaluatePatient', () => {
  const NOW = new Date('2026-10-24T12:00:00.000Z');
  const HOUR = 60 * 60 * 1000;

  // One patient whose sessions always trip the compensation rule (> 50%).
  function addSession(startedAt) {
    const id = store.makeId('sess');
    store.append('sessions', {
      id, patientId: 'p-test', startedAt, endedAt: startedAt, pain: 2, tiredness: 2, avgHr: null, replayFile: null,
    });
    const rows = [
      { ...result('arm_raise', 'healthy', 160), sessionId: id },
      { ...result('arm_raise', 'weak', 100, 60), sessionId: id },
    ];
    store.writeAll('exerciseResults', [...store.readAll('exerciseResults'), ...rows]);
  }

  function compensationAlerts() {
    return store.readAll('alerts').filter((a) => a.type === 'compensation');
  }

  function acknowledgeAll(at) {
    store.writeAll(
      'alerts',
      store.readAll('alerts').map((a) => ({ ...a, acknowledged: true, acknowledgedAt: at }))
    );
  }

  beforeEach(() => {
    for (const name of ['sessions', 'exerciseResults', 'watchDaily', 'alerts', 'plans']) {
      store.writeAll(name, []);
    }
    store.writeAll('patients', [
      { id: 'p-test', name: 'Test', weakSide: 'left', phase: 1, nextCheckin: '2026-10-30', bpLimitSys: 140 },
    ]);
    addSession('2026-10-24T09:00:00.000Z');
  });

  after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

  it('does not create a duplicate open alert', () => {
    const first = evaluatePatient('p-test', { now: NOW });
    assert.ok(first.alertsCreated.some((a) => a.type === 'compensation'));
    const second = evaluatePatient('p-test', { now: NOW });
    assert.equal(second.alertsCreated.length, 0);
    assert.equal(compensationAlerts().length, 1);
  });

  it('does not re-raise an acknowledged alert without newer data', () => {
    evaluatePatient('p-test', { now: NOW });
    acknowledgeAll(new Date(NOW.getTime() - HOUR).toISOString());
    const again = evaluatePatient('p-test', { now: NOW });
    assert.equal(again.alertsCreated.length, 0);
    assert.equal(compensationAlerts().length, 1);
  });

  it('re-raises an acknowledged alert when a newer session arrives', () => {
    evaluatePatient('p-test', { now: NOW });
    acknowledgeAll(new Date(NOW.getTime() - HOUR).toISOString());
    addSession(new Date(NOW.getTime() - 10 * 60 * 1000).toISOString()); // after the acknowledgement
    const again = evaluatePatient('p-test', { now: NOW });
    assert.ok(again.alertsCreated.some((a) => a.type === 'compensation'));
    assert.equal(compensationAlerts().filter((a) => !a.acknowledged).length, 1);
  });

  it('treats a re-posted watch day as old data, but a new day as newer', () => {
    store.writeAll('watchDaily', [{ id: 'wd-1', patientId: 'p-test', date: '2026-10-24', bpSys: 150 }]);
    assert.ok(evaluatePatient('p-test', { now: NOW }).alertsCreated.some((a) => a.type === 'blood-pressure'));
    acknowledgeAll(new Date(NOW.getTime() - HOUR).toISOString());

    // Same date again (e.g. Shortcut re-sent today's numbers): stays quiet.
    assert.equal(evaluatePatient('p-test', { now: NOW }).alertsCreated.length, 0);

    // Next day's reading is still high: raise it again.
    store.append('watchDaily', { id: 'wd-2', patientId: 'p-test', date: '2026-10-25', bpSys: 152 });
    const nextDay = new Date('2026-10-25T12:00:00.000Z');
    assert.ok(evaluatePatient('p-test', { now: nextDay }).alertsCreated.some((a) => a.type === 'blood-pressure'));
  });
});

describe('suggestPlanChange', () => {
  const NOW = new Date('2026-10-24T12:00:00.000Z');
  const plan = {
    sessionsPerWeek: 5,
    exercises: [
      { exercise: 'arm_raise', reps: 10, target: 100 },
      { exercise: 'forward_reach', reps: 10, target: 130 },
      { exercise: 'hand_open', reps: 12, target: 70 },
    ],
  };
  // Session entry whose hand_open lags the other exercises by 10 points.
  function entryWithResults(startedAt, sym, comp) {
    const e = entry(startedAt, sym, comp);
    e.results = [
      result('arm_raise', 'healthy', 100), result('arm_raise', 'weak', sym),
      result('forward_reach', 'healthy', 100), result('forward_reach', 'weak', sym),
      result('hand_open', 'healthy', 100), result('hand_open', 'weak', sym - 10),
    ];
    return e;
  }

  it('ready: suggests phase + 1 with targets +10% and a reason with the numbers', () => {
    const timeline = [70, 71, 72].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 10));
    const change = suggestPlanChange({ phase: 2, maxRaiseAngle: 180 }, timeline, plan, NOW);
    assert.equal(change.kind, 'phase-up');
    assert.equal(change.phase, 3);
    assert.deepEqual(change.exercises.map((e) => e.target), [110, 143, 77]);
    assert.deepEqual(change.basedOn, { sessions: 3, avgSymmetry: 71, avgCompensation: 10 });
    assert.match(change.reason, /71%.*phase 2 target of 65%/);
  });

  it('ready: caps the arm-raise target at the patient max angle', () => {
    const timeline = [70, 71, 72].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 10));
    const change = suggestPlanChange({ phase: 2, maxRaiseAngle: 105 }, timeline, plan, NOW);
    assert.equal(change.exercises[0].target, 105);
  });

  it('never suggests past phase 4', () => {
    const timeline = [95, 96, 97].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 5));
    assert.equal(suggestPlanChange({ phase: 4 }, timeline, plan, NOW), null);
  });

  it('plateau: same phase, more reps and -5% target on the weakest exercise', () => {
    const timeline = [55, 56, 55, 54, 55].map((v, i) => entryWithResults(`2026-10-1${5 + i}T12:00:00.000Z`, v, 15));
    const change = suggestPlanChange({ phase: 2 }, timeline, plan, NOW);
    assert.equal(change.kind, 'plateau');
    assert.equal(change.phase, 2);
    assert.deepEqual(change.exercises[2], { exercise: 'hand_open', reps: 14, target: 67 });
    assert.deepEqual(change.exercises[0], plan.exercises[0]); // others unchanged
    assert.equal(change.basedOn.sessions, 5);
    assert.match(change.reason, /between 54% and 56%.*hand open/);
  });

  it('compensation: same phase, reps -20% and targets -10%', () => {
    const timeline = [55, 56, 57].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 60));
    const change = suggestPlanChange({ phase: 1 }, timeline, plan, NOW);
    assert.equal(change.kind, 'compensation');
    assert.equal(change.phase, 1);
    assert.deepEqual(change.exercises.map((e) => [e.reps, e.target]), [[8, 90], [8, 117], [10, 63]]);
    assert.match(change.reason, /form/);
  });

  it('returns null when nothing stands out', () => {
    const timeline = [40, 48, 56].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 20));
    assert.equal(suggestPlanChange({ phase: 2 }, timeline, plan, NOW), null);
  });
});

describe('evaluatePatient plan suggestions', () => {
  const NOW = new Date('2026-10-24T12:00:00.000Z');

  // Three sessions with 60% compensation → compensation suggestion.
  beforeEach(() => {
    for (const name of ['sessions', 'exerciseResults', 'watchDaily', 'alerts', 'plans']) {
      store.writeAll(name, []);
    }
    store.writeAll('patients', [
      { id: 'p-test', name: 'Test', weakSide: 'left', phase: 1, nextCheckin: '2026-10-30', bpLimitSys: 140 },
    ]);
    const sessions = [];
    const results = [];
    for (const day of [21, 22, 23]) {
      const id = `sess-${day}`;
      sessions.push({ id, patientId: 'p-test', startedAt: `2026-10-${day}T09:00:00.000Z`, pain: 2, tiredness: 2 });
      results.push({ ...result('arm_raise', 'healthy', 160), sessionId: id });
      results.push({ ...result('arm_raise', 'weak', 100, 60), sessionId: id });
    }
    store.writeAll('sessions', sessions);
    store.writeAll('exerciseResults', results);
  });

  it('keeps at most one open suggested plan', () => {
    assert.ok(evaluatePatient('p-test', { now: NOW }).planSuggested);
    assert.equal(evaluatePatient('p-test', { now: NOW }).planSuggested, null);
    assert.equal(store.readAll('plans').filter((p) => p.status === 'suggested').length, 1);
  });

  it('does not re-suggest from sessions the care team already decided on', () => {
    const { planSuggested } = evaluatePatient('p-test', { now: NOW });
    store.writeAll('plans', [{ ...planSuggested, status: 'dismissed', dismissedAt: '2026-10-24T10:00:00.000Z' }]);
    assert.equal(evaluatePatient('p-test', { now: NOW }).planSuggested, null);
  });
});
