/**
 * Unit tests for the rules engine.
 * Run with: npm test  (uses Node's built-in test runner — no extra libraries)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
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
