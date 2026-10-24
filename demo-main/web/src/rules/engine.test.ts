/**
 * Rules engine tests — port of Raghav/api/rules.test.js (+ rule cases from routes.test.js),
 * plus CONVERGENCE_PLAN §6.3 fixes: (a) empty missedSessionStreak, (b) setback vs mean of prior 3,
 * BP and fall alerts.
 */
import { describe, expect, it } from 'vitest';
import type { Alert, Exercise, ExerciseResult, Patient, Plan, WatchDaily } from '../types';
import type { NewAlert, SessionRow, Snapshot } from '../data/source';
import type { TimelineEntry } from './engine';
import {
  avgCompensation,
  avgSymmetry,
  evaluate,
  hasOpenAlert,
  isCoolingDown,
  isPlateau,
  isSetback,
  missedSessionStreak,
  restingHrSpike,
  safetyStopDetail,
  sessionTimeline,
  setbackInfo,
  shouldSuggestNextPhase,
  suggestPlanChange,
  symmetryForExercise,
} from './engine';

function result(exercise: Exercise, side: 'weak' | 'healthy', bestValue: number, compRepPct = 0): ExerciseResult {
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

function entry(startedAt: string, symmetry: number | null, compensation: number | null = 10): TimelineEntry {
  const session: SessionRow = {
    id: 's',
    patientId: 'p',
    startedAt,
    endedAt: startedAt,
    pain: 2,
    tiredness: 2,
    stopReason: null,
    avgHr: null,
    replays: [],
  };
  return { session, results: [], symmetry, compensation };
}

const PATIENT: Patient = {
  id: 'p-test',
  name: 'Test',
  weakSide: 'left',
  strokeDate: '2026-01-01',
  phase: 1,
  maxRaiseAngle: 120,
  nextCheckin: '2026-10-30',
  bpLimitSys: 140,
};

function snap(partial: Partial<Snapshot> & { patient?: Patient }): Snapshot {
  const patient = partial.patient ?? PATIENT;
  return {
    patient,
    sessions: [],
    results: [],
    replays: [],
    watch: [],
    alerts: [],
    plans: [],
    ...partial,
  };
}

function sessionRow(
  id: string,
  startedAt: string,
  extras: Partial<SessionRow> = {},
): SessionRow {
  return {
    id,
    patientId: PATIENT.id,
    startedAt,
    endedAt: startedAt,
    pain: 2,
    tiredness: 2,
    stopReason: null,
    avgHr: null,
    replays: [],
    ...extras,
  };
}

describe('symmetryForExercise', () => {
  it('computes weak / healthy * 100', () => {
    const results = [result('arm_raise', 'healthy', 160), result('arm_raise', 'weak', 80)];
    expect(symmetryForExercise(results, 'arm_raise')).toBe(50);
  });

  it('returns null when a side is missing', () => {
    expect(symmetryForExercise([result('arm_raise', 'healthy', 160)], 'arm_raise')).toBeNull();
  });

  it('returns null when healthy best is 0', () => {
    const results = [result('arm_raise', 'healthy', 0), result('arm_raise', 'weak', 40)];
    expect(symmetryForExercise(results, 'arm_raise')).toBeNull();
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
    expect(avgSymmetry(results)).toBe(60);
  });

  it('averages weak-arm compensation', () => {
    const results = [
      result('arm_raise', 'weak', 50, 40),
      result('forward_reach', 'weak', 50, 60),
      result('arm_raise', 'healthy', 100, 0),
    ];
    expect(avgCompensation(results)).toBe(50);
  });

  it('returns null when no paired exercises', () => {
    expect(avgSymmetry([result('arm_raise', 'healthy', 100)])).toBeNull();
  });

  it('returns null when no weak-arm results', () => {
    expect(avgCompensation([result('arm_raise', 'healthy', 100)])).toBeNull();
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
    expect(isPlateau(timeline, now)).toBe(true);
  });

  it('is false when symmetry is clearly rising', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [
      entry('2026-10-11T12:00:00.000Z', 45),
      entry('2026-10-14T12:00:00.000Z', 52),
      entry('2026-10-17T12:00:00.000Z', 60),
      entry('2026-10-21T12:00:00.000Z', 68),
    ];
    expect(isPlateau(timeline, now)).toBe(false);
  });

  it('is false with fewer than 4 scored sessions', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [
      entry('2026-10-20T12:00:00.000Z', 55),
      entry('2026-10-21T12:00:00.000Z', 55),
      entry('2026-10-22T12:00:00.000Z', 55),
    ];
    expect(isPlateau(timeline, now)).toBe(false);
  });
});

describe('isSetback / setbackInfo', () => {
  it('flags a drop of 10+ vs the previous session alone', () => {
    const timeline = [entry('2026-10-20T12:00:00.000Z', 70), entry('2026-10-22T12:00:00.000Z', 58)];
    expect(isSetback(timeline)).toBe(true);
  });

  it('ignores small drops', () => {
    const timeline = [entry('2026-10-20T12:00:00.000Z', 70), entry('2026-10-22T12:00:00.000Z', 65)];
    expect(isSetback(timeline)).toBe(false);
  });

  it('compares latest to the mean of the previous 3 scored sessions', () => {
    // mean of 70, 72, 68 = 70; latest 59 → drop 11 ≥ 10
    const timeline = [
      entry('2026-10-16T12:00:00.000Z', 70),
      entry('2026-10-18T12:00:00.000Z', 72),
      entry('2026-10-20T12:00:00.000Z', 68),
      entry('2026-10-22T12:00:00.000Z', 59),
    ];
    const info = setbackInfo(timeline);
    expect(info).not.toBeNull();
    expect(info!.sessions).toBe(3);
    expect(info!.baseline).toBeCloseTo(70, 5);
    expect(info!.latest).toBe(59);
    expect(isSetback(timeline)).toBe(true);
  });

  it('needs at least two scored sessions', () => {
    expect(isSetback([entry('2026-10-22T12:00:00.000Z', 50)])).toBe(false);
    expect(setbackInfo([])).toBeNull();
  });

  it('ignores unscored sessions in the baseline window', () => {
    const timeline = [
      entry('2026-10-16T12:00:00.000Z', 80),
      entry('2026-10-18T12:00:00.000Z', null),
      entry('2026-10-20T12:00:00.000Z', 80),
      entry('2026-10-22T12:00:00.000Z', 65),
    ];
    // scored: 80, 80, 65 → baseline mean of prior 2 = 80, drop 15
    expect(isSetback(timeline)).toBe(true);
    expect(setbackInfo(timeline)!.sessions).toBe(2);
  });
});

describe('missedSessionStreak', () => {
  it('counts days since last session (minus 1 grace day)', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [entry('2026-10-20T12:00:00.000Z', 55)];
    expect(missedSessionStreak(timeline, now)).toBe(3);
  });

  it('is zero when the patient exercised today', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const timeline = [entry('2026-10-24T08:00:00.000Z', 55)];
    expect(missedSessionStreak(timeline, now)).toBe(0);
  });

  it('returns 0 when the patient has no sessions (fix a)', () => {
    expect(missedSessionStreak([], new Date('2026-10-24T12:00:00.000Z'))).toBe(0);
  });
});

describe('restingHrSpike', () => {
  it('flags when latest RHR is 10+ above the prior 2-week average', () => {
    const rows: Pick<WatchDaily, 'date' | 'restingHr'>[] = [];
    for (let d = 1; d <= 14; d++) {
      rows.push({ date: `2026-10-${String(d).padStart(2, '0')}`, restingHr: 70 });
    }
    rows.push({ date: '2026-10-15', restingHr: 82 });
    const spike = restingHrSpike(rows);
    expect(spike).not.toBeNull();
    expect(spike!.latest).toBe(82);
    expect(spike!.avg).toBe(70);
  });

  it('returns null when the rise is small', () => {
    const rows = [
      { date: '2026-10-01', restingHr: 70 },
      { date: '2026-10-08', restingHr: 71 },
      { date: '2026-10-15', restingHr: 74 },
    ];
    expect(restingHrSpike(rows)).toBeNull();
  });

  it('returns null with fewer than 3 readings', () => {
    expect(restingHrSpike([{ date: '2026-10-01', restingHr: 70 }, { date: '2026-10-02', restingHr: 90 }])).toBeNull();
  });
});

describe('shouldSuggestNextPhase', () => {
  it('suggests when last 3 sessions beat the phase target with low compensation', () => {
    const timeline = [
      entry('2026-10-18T12:00:00.000Z', 55, 10),
      entry('2026-10-20T12:00:00.000Z', 58, 12),
      entry('2026-10-22T12:00:00.000Z', 60, 8),
    ];
    expect(shouldSuggestNextPhase({ phase: 1 }, timeline)).toBe(true);
  });

  it('does not suggest when compensation is high', () => {
    const timeline = [
      entry('2026-10-18T12:00:00.000Z', 55, 40),
      entry('2026-10-20T12:00:00.000Z', 58, 45),
      entry('2026-10-22T12:00:00.000Z', 60, 50),
    ];
    expect(shouldSuggestNextPhase({ phase: 1 }, timeline)).toBe(false);
  });

  it('does not suggest with fewer than 3 sessions', () => {
    expect(shouldSuggestNextPhase({ phase: 1 }, [entry('2026-10-22T12:00:00.000Z', 60, 8)])).toBe(false);
  });
});

describe('hasOpenAlert', () => {
  it('detects an unacknowledged alert of the same type', () => {
    const alerts = [
      { patientId: 'p-maria', type: 'plateau' as const, acknowledged: false },
      { patientId: 'p-maria', type: 'pain' as const, acknowledged: true },
    ];
    expect(hasOpenAlert(alerts, 'p-maria', 'plateau')).toBe(true);
    expect(hasOpenAlert(alerts, 'p-maria', 'pain')).toBe(false);
    expect(hasOpenAlert(alerts, 'p-james', 'plateau')).toBe(false);
  });
});

describe('isCoolingDown', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  const acked = (acknowledgedAt: string) => [
    { patientId: 'p', type: 'pain' as const, acknowledged: true, acknowledgedAt },
  ];

  it('blocks when acknowledged recently and data is not newer', () => {
    expect(isCoolingDown(acked('2026-10-24T10:00:00.000Z'), 'p', 'pain', '2026-10-24T09:00:00.000Z', now)).toBe(true);
  });

  it('does not block when the data is newer than the acknowledgement', () => {
    expect(isCoolingDown(acked('2026-10-24T10:00:00.000Z'), 'p', 'pain', '2026-10-24T11:00:00.000Z', now)).toBe(false);
  });

  it('does not block once the 72h window has passed', () => {
    expect(isCoolingDown(acked('2026-10-20T10:00:00.000Z'), 'p', 'pain', '2026-10-19T09:00:00.000Z', now)).toBe(false);
  });
});

describe('safetyStopDetail', () => {
  it('mentions pain and empty results', () => {
    const e = entry('2026-10-24T09:00:00.000Z', null);
    e.session = { ...e.session, stopReason: 'pain', pain: 8 };
    e.results = [];
    expect(safetyStopDetail(e)).toMatch(/because of pain/);
    expect(safetyStopDetail(e)).toMatch(/No exercises were recorded/);
  });

  it('mentions dizziness and partial results', () => {
    const e = entry('2026-10-24T09:00:00.000Z', 50);
    e.session = { ...e.session, stopReason: 'dizziness', pain: 3 };
    e.results = [result('arm_raise', 'healthy', 160)];
    expect(safetyStopDetail(e)).toMatch(/dizziness/);
    expect(safetyStopDetail(e)).toMatch(/1 exercise result/);
  });
});

describe('sessionTimeline', () => {
  it('orders sessions oldest first and attaches results', () => {
    const sessions = [
      sessionRow('b', '2026-10-22T09:00:00.000Z'),
      sessionRow('a', '2026-10-20T09:00:00.000Z'),
    ];
    const results = [
      { ...result('arm_raise', 'healthy', 100), sessionId: 'a' },
      { ...result('arm_raise', 'weak', 50), sessionId: 'a' },
      { ...result('arm_raise', 'healthy', 100), sessionId: 'b' },
      { ...result('arm_raise', 'weak', 60), sessionId: 'b' },
    ];
    const tl = sessionTimeline(PATIENT.id, sessions, results);
    expect(tl.map((t) => t.session.id)).toEqual(['a', 'b']);
    expect(tl[0].symmetry).toBe(50);
    expect(tl[1].symmetry).toBe(60);
  });
});

describe('suggestPlanChange', () => {
  const NOW = new Date('2026-10-24T12:00:00.000Z');
  const plan = {
    sessionsPerWeek: 5,
    exercises: [
      { exercise: 'arm_raise' as const, reps: 10, target: 100 },
      { exercise: 'forward_reach' as const, reps: 10, target: 130 },
      { exercise: 'hand_open' as const, reps: 12, target: 70 },
    ],
  };

  function entryWithResults(startedAt: string, sym: number, comp: number) {
    const e = entry(startedAt, sym, comp);
    e.results = [
      result('arm_raise', 'healthy', 100),
      result('arm_raise', 'weak', sym),
      result('forward_reach', 'healthy', 100),
      result('forward_reach', 'weak', sym),
      result('hand_open', 'healthy', 100),
      result('hand_open', 'weak', sym - 10),
    ];
    return e;
  }

  it('ready: suggests phase + 1 with targets +10% and a reason with the numbers', () => {
    const timeline = [70, 71, 72].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 10));
    const change = suggestPlanChange({ phase: 2, maxRaiseAngle: 180 }, timeline, plan, NOW);
    expect(change!.kind).toBe('phase-up');
    expect(change!.phase).toBe(3);
    expect(change!.exercises.map((e) => e.target)).toEqual([110, 143, 77]);
    expect(change!.basedOn).toEqual({ sessions: 3, avgSymmetry: 71, avgCompensation: 10 });
    expect(change!.reason).toMatch(/71%.*phase 2 target of 65%/);
  });

  it('ready: caps the arm-raise target at the patient max angle', () => {
    const timeline = [70, 71, 72].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 10));
    const change = suggestPlanChange({ phase: 2, maxRaiseAngle: 105 }, timeline, plan, NOW);
    expect(change!.exercises[0].target).toBe(105);
  });

  it('never suggests past phase 4', () => {
    const timeline = [95, 96, 97].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 5));
    expect(suggestPlanChange({ phase: 4 }, timeline, plan, NOW)).toBeNull();
  });

  it('plateau: same phase, more reps and -5% target on the weakest exercise', () => {
    const timeline = [55, 56, 55, 54, 55].map((v, i) => entryWithResults(`2026-10-1${5 + i}T12:00:00.000Z`, v, 15));
    const change = suggestPlanChange({ phase: 2 }, timeline, plan, NOW);
    expect(change!.kind).toBe('plateau');
    expect(change!.phase).toBe(2);
    expect(change!.exercises[2]).toEqual({ exercise: 'hand_open', reps: 14, target: 67 });
    expect(change!.exercises[0]).toEqual(plan.exercises[0]);
    expect(change!.basedOn.sessions).toBe(5);
    expect(change!.reason).toMatch(/between 54% and 56%.*hand open/);
  });

  it('compensation: same phase, reps -20% and targets -10%', () => {
    const timeline = [55, 56, 57].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 60));
    const change = suggestPlanChange({ phase: 1 }, timeline, plan, NOW);
    expect(change!.kind).toBe('compensation');
    expect(change!.phase).toBe(1);
    expect(change!.exercises.map((e) => [e.reps, e.target])).toEqual([
      [8, 90],
      [8, 117],
      [10, 63],
    ]);
    expect(change!.reason).toMatch(/form/);
  });

  it('returns null when nothing stands out', () => {
    const timeline = [40, 48, 56].map((v, i) => entry(`2026-10-2${i}T12:00:00.000Z`, v, 20));
    expect(suggestPlanChange({ phase: 2 }, timeline, plan, NOW)).toBeNull();
  });
});

describe('evaluate', () => {
  const NOW = new Date('2026-10-24T12:00:00.000Z');

  function compensationSession(id: string, startedAt: string): { session: SessionRow; results: ExerciseResult[] } {
    return {
      session: sessionRow(id, startedAt),
      results: [
        { ...result('arm_raise', 'healthy', 160), sessionId: id },
        { ...result('arm_raise', 'weak', 100, 60), sessionId: id },
      ],
    };
  }

  it('does not create a duplicate open alert', () => {
    const { session, results } = compensationSession('s1', '2026-10-24T09:00:00.000Z');
    const first = evaluate(snap({ sessions: [session], results }), NOW);
    expect(first.alerts.some((a) => a.type === 'compensation')).toBe(true);
    const open: Alert[] = first.alerts.map((a) => ({ ...a, id: 'al-1', acknowledged: false }));
    const second = evaluate(snap({ sessions: [session], results, alerts: open }), NOW);
    expect(second.alerts).toHaveLength(0);
  });

  it('does not re-raise an acknowledged alert without newer data', () => {
    const { session, results } = compensationSession('s1', '2026-10-24T09:00:00.000Z');
    const ack: Alert = {
      id: 'al-1',
      patientId: PATIENT.id,
      type: 'compensation',
      detail: 'x',
      createdAt: '2026-10-24T09:00:00.000Z',
      acknowledged: true,
      acknowledgedAt: '2026-10-24T11:00:00.000Z',
    };
    const again = evaluate(snap({ sessions: [session], results, alerts: [ack] }), NOW);
    expect(again.alerts.filter((a) => a.type === 'compensation')).toHaveLength(0);
  });

  it('re-raises an acknowledged alert when a newer session arrives', () => {
    const first = compensationSession('s1', '2026-10-24T09:00:00.000Z');
    const second = compensationSession('s2', '2026-10-24T11:30:00.000Z');
    const ack: Alert = {
      id: 'al-1',
      patientId: PATIENT.id,
      type: 'compensation',
      detail: 'x',
      createdAt: '2026-10-24T09:00:00.000Z',
      acknowledged: true,
      acknowledgedAt: '2026-10-24T11:00:00.000Z',
    };
    const out = evaluate(
      snap({
        sessions: [first.session, second.session],
        results: [...first.results, ...second.results],
        alerts: [ack],
      }),
      NOW,
    );
    expect(out.alerts.some((a) => a.type === 'compensation')).toBe(true);
  });

  it('treats a re-posted watch day as old data, but a new day as newer', () => {
    const watch: WatchDaily[] = [
      {
        id: '1',
        patientId: PATIENT.id,
        date: '2026-10-24',
        steps: null,
        exerciseMin: null,
        standHr: null,
        restingHr: null,
        hrv: null,
        sleepHr: null,
        bpSys: 150,
        bpDia: 90,
        falls: null,
        walkingSteadiness: null,
        weakArmActiveMin: null,
        useRatio: null,
      },
    ];
    const first = evaluate(snap({ watch }), NOW);
    expect(first.alerts.some((a) => a.type === 'blood-pressure')).toBe(true);

    const ack: Alert = {
      id: 'al-bp',
      patientId: PATIENT.id,
      type: 'blood-pressure',
      detail: 'x',
      createdAt: NOW.toISOString(),
      acknowledged: true,
      acknowledgedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    };
    expect(evaluate(snap({ watch, alerts: [ack] }), NOW).alerts).toHaveLength(0);

    const nextDayWatch = [
      ...watch,
      { ...watch[0], id: '2', date: '2026-10-25', bpSys: 152 },
    ];
    const nextDay = new Date('2026-10-25T12:00:00.000Z');
    expect(evaluate(snap({ watch: nextDayWatch, alerts: [ack] }), nextDay).alerts.some((a) => a.type === 'blood-pressure')).toBe(
      true,
    );
  });

  it('raises safety-stop and pain for a stopped session with no results', () => {
    const session = sessionRow('s-stop', '2026-10-24T09:00:00.000Z', { stopReason: 'pain', pain: 8 });
    const { alerts } = evaluate(snap({ sessions: [session], results: [] }), NOW);
    const types = alerts.map((a) => a.type);
    expect(types).toContain('safety-stop');
    expect(types).toContain('pain');
    expect(alerts.find((a) => a.type === 'safety-stop')!.detail).toMatch(/because of pain/);
    expect(alerts.find((a) => a.type === 'safety-stop')!.detail).toMatch(/No exercises were recorded/);
  });

  it('only looks at the latest session for safety-stop', () => {
    const stopped = sessionRow('s-old', '2026-10-23T09:00:00.000Z', { stopReason: 'other', pain: null });
    const ok = sessionRow('s-ok', '2026-10-24T09:00:00.000Z');
    const results = [
      { ...result('arm_raise', 'healthy', 160), sessionId: 's-ok' },
      { ...result('arm_raise', 'weak', 100), sessionId: 's-ok' },
    ];
    const { alerts } = evaluate(snap({ sessions: [stopped, ok], results }), NOW);
    expect(alerts.filter((a) => a.type === 'safety-stop')).toHaveLength(0);
  });

  it('setback alert detail ends with Consider an earlier check-in.', () => {
    const sessions = [
      sessionRow('s1', '2026-10-16T12:00:00.000Z'),
      sessionRow('s2', '2026-10-18T12:00:00.000Z'),
      sessionRow('s3', '2026-10-20T12:00:00.000Z'),
      sessionRow('s4', '2026-10-22T12:00:00.000Z'),
    ];
    const mk = (id: string, weak: number) => [
      { ...result('arm_raise', 'healthy', 100), sessionId: id },
      { ...result('arm_raise', 'weak', weak), sessionId: id },
    ];
    const results = [...mk('s1', 70), ...mk('s2', 72), ...mk('s3', 68), ...mk('s4', 55)];
    const { alerts } = evaluate(snap({ sessions, results }), NOW);
    const setback = alerts.find((a) => a.type === 'setback');
    expect(setback).toBeDefined();
    expect(setback!.detail.endsWith('Consider an earlier check-in.')).toBe(true);
  });

  it('raises blood-pressure when latest systolic exceeds the patient limit', () => {
    const watch: WatchDaily[] = [
      {
        id: '1',
        patientId: PATIENT.id,
        date: '2026-10-24',
        steps: null,
        exerciseMin: null,
        standHr: null,
        restingHr: 70,
        hrv: null,
        sleepHr: null,
        bpSys: 155,
        bpDia: 88,
        falls: 0,
        walkingSteadiness: null,
        weakArmActiveMin: null,
        useRatio: null,
      },
    ];
    const { alerts } = evaluate(snap({ watch }), NOW);
    const bp = alerts.find((a) => a.type === 'blood-pressure');
    expect(bp).toBeDefined();
    expect(bp!.detail).toMatch(/155/);
    expect(bp!.detail).toMatch(/140/);
  });

  it('does not raise blood-pressure at or under the limit', () => {
    const watch: WatchDaily[] = [
      {
        id: '1',
        patientId: PATIENT.id,
        date: '2026-10-24',
        steps: null,
        exerciseMin: null,
        standHr: null,
        restingHr: null,
        hrv: null,
        sleepHr: null,
        bpSys: 140,
        bpDia: 80,
        falls: null,
        walkingSteadiness: null,
        weakArmActiveMin: null,
        useRatio: null,
      },
    ];
    expect(evaluate(snap({ watch }), NOW).alerts.filter((a) => a.type === 'blood-pressure')).toHaveLength(0);
  });

  it('raises fall when falls > 0 on the latest watch day', () => {
    const watch: WatchDaily[] = [
      {
        id: '1',
        patientId: PATIENT.id,
        date: '2026-10-24',
        steps: null,
        exerciseMin: null,
        standHr: null,
        restingHr: null,
        hrv: null,
        sleepHr: null,
        bpSys: null,
        bpDia: null,
        falls: 2,
        walkingSteadiness: null,
        weakArmActiveMin: null,
        useRatio: null,
      },
    ];
    const { alerts } = evaluate(snap({ watch }), NOW);
    const fall = alerts.find((a) => a.type === 'fall');
    expect(fall).toBeDefined();
    expect(fall!.detail).toMatch(/2 fall/);
  });

  it('does not raise fall when falls is 0', () => {
    const watch: WatchDaily[] = [
      {
        id: '1',
        patientId: PATIENT.id,
        date: '2026-10-24',
        steps: null,
        exerciseMin: null,
        standHr: null,
        restingHr: null,
        hrv: null,
        sleepHr: null,
        bpSys: null,
        bpDia: null,
        falls: 0,
        walkingSteadiness: null,
        weakArmActiveMin: null,
        useRatio: null,
      },
    ];
    expect(evaluate(snap({ watch }), NOW).alerts.filter((a) => a.type === 'fall')).toHaveLength(0);
  });

  it('raises adherence when missed days ≥ 3, not when timeline is empty', () => {
    const empty = evaluate(snap({}), NOW);
    expect(empty.alerts.filter((a) => a.type === 'adherence')).toHaveLength(0);

    const session = sessionRow('s1', '2026-10-20T09:00:00.000Z');
    const results = [
      { ...result('arm_raise', 'healthy', 100), sessionId: 's1' },
      { ...result('arm_raise', 'weak', 50), sessionId: 's1' },
    ];
    const { alerts } = evaluate(snap({ sessions: [session], results }), NOW);
    expect(alerts.some((a) => a.type === 'adherence')).toBe(true);
  });

  it('keeps at most one open suggested plan', () => {
    const sessions: SessionRow[] = [];
    const results: ExerciseResult[] = [];
    for (const day of [21, 22, 23]) {
      const id = `sess-${day}`;
      sessions.push(sessionRow(id, `2026-10-${day}T09:00:00.000Z`));
      results.push({ ...result('arm_raise', 'healthy', 160), sessionId: id });
      results.push({ ...result('arm_raise', 'weak', 100, 60), sessionId: id });
    }
    const first = evaluate(snap({ sessions, results }), NOW);
    expect(first.plan).not.toBeNull();
    expect(first.plan!.kind).toBe('compensation');

    const suggested: Plan = {
      ...first.plan!,
      id: 'plan-1',
      status: 'suggested',
      approvedBy: null,
    };
    const second = evaluate(snap({ sessions, results, plans: [suggested] }), NOW);
    expect(second.plan).toBeNull();
  });

  it('does not re-suggest from sessions the care team already decided on', () => {
    const sessions: SessionRow[] = [];
    const results: ExerciseResult[] = [];
    for (const day of [21, 22, 23]) {
      const id = `sess-${day}`;
      sessions.push(sessionRow(id, `2026-10-${day}T09:00:00.000Z`));
      results.push({ ...result('arm_raise', 'healthy', 160), sessionId: id });
      results.push({ ...result('arm_raise', 'weak', 100, 60), sessionId: id });
    }
    const first = evaluate(snap({ sessions, results }), NOW);
    const dismissed: Plan = {
      ...first.plan!,
      id: 'plan-1',
      status: 'dismissed',
      approvedBy: null,
      dismissedAt: '2026-10-24T10:00:00.000Z',
    };
    expect(evaluate(snap({ sessions, results, plans: [dismissed] }), NOW).plan).toBeNull();
  });

  it('raises heart-rate on a resting HR spike', () => {
    const watch: WatchDaily[] = [];
    for (let d = 1; d <= 14; d++) {
      watch.push({
        id: String(d),
        patientId: PATIENT.id,
        date: `2026-10-${String(d).padStart(2, '0')}`,
        steps: null,
        exerciseMin: null,
        standHr: null,
        restingHr: 70,
        hrv: null,
        sleepHr: null,
        bpSys: null,
        bpDia: null,
        falls: null,
        walkingSteadiness: null,
        weakArmActiveMin: null,
        useRatio: null,
      });
    }
    watch.push({ ...watch[0], id: '15', date: '2026-10-15', restingHr: 85 });
    const { alerts } = evaluate(snap({ watch }), new Date('2026-10-15T12:00:00.000Z'));
    expect(alerts.some((a) => a.type === 'heart-rate')).toBe(true);
  });
});

/** Smoke: NewAlert shape from evaluate is applyRuleResults-ready. */
describe('evaluate output shape', () => {
  it('alerts omit id/acknowledged fields', () => {
    const session = sessionRow('s1', '2026-10-24T09:00:00.000Z', { stopReason: 'pain', pain: 9 });
    const alerts: NewAlert[] = evaluate(snap({ sessions: [session] }), new Date('2026-10-24T12:00:00.000Z')).alerts;
    for (const a of alerts) {
      expect(a).toHaveProperty('patientId');
      expect(a).toHaveProperty('type');
      expect(a).toHaveProperty('detail');
      expect(a).toHaveProperty('createdAt');
      expect(a).not.toHaveProperty('id');
      expect(a).not.toHaveProperty('acknowledged');
    }
  });
});
