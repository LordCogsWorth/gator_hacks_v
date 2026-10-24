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
