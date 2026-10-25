import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { computeBaseline, parsePlan } from './aiPlan';

const NOW = Date.parse('2026-10-25T12:00:00Z');

function session(daysAgo: number, weakRaise: number, sym: number, comp: number, pain: number): Session {
  return {
    id: `s${daysAgo}`,
    patientId: 'p',
    startedAt: new Date(NOW - daysAgo * 86_400_000).toISOString(),
    endedAt: new Date(NOW - daysAgo * 86_400_000).toISOString(),
    pain,
    tiredness: 2,
    stopReason: null,
    avgHr: null,
    replays: [],
    results: [
      { exercise: 'arm_raise', side: 'weak', bestValue: weakRaise, reps: 8, secPerRep: 3, smoothness: 2, fatigue: 1, trunkLeanMax: 4, shoulderHikeMax: 0, compRepPct: comp },
    ],
    symmetry: sym,
    compensation: comp,
    symmetryByExercise: { arm_raise: sym, forward_reach: null, hand_open: null },
  };
}

describe('computeBaseline', () => {
  const sessions = [session(20, 60, 50, 30, 4), session(18, 62, 52, 28, 4), session(16, 64, 54, 26, 3), session(4, 80, 70, 12, 2), session(2, 82, 72, 10, 2), session(1, 84, 74, 8, 2)];

  it('compares the latest 3 sessions with the first 3 of the last 4 weeks', () => {
    const rows = computeBaseline({ sessions, watch: [] }, NOW);
    const raise = rows.find((r) => r.measure.includes('weak arm best'))!;
    expect(raise.now).toBe('82°');
    expect(raise.before).toBe('62°');
    expect(raise.trend).toBe('up');
    const comp = rows.find((r) => r.measure.startsWith('Compensation'))!;
    expect(comp.now).toBe('10%');
    expect(comp.trend).toBe('down');
    expect(comp.higherIsBetter).toBe(false);
  });

  it('has no "before" with too few sessions', () => {
    const rows = computeBaseline({ sessions: sessions.slice(-2), watch: [] }, NOW);
    expect(rows.every((r) => r.before === null && r.trend === null)).toBe(true);
  });
});

describe('parsePlan', () => {
  const answer = {
    summary: 'Improving.',
    struggling: [{ area: 'Shoulder elevation', detail: 'Weak arm reaches 82°.' }],
    baselineNote: 'Up from 62°.',
    program: { focus: 'Lift height', sessionsPerWeek: 5, exercises: [{ name: 'Wall walks', dose: '2 x 8', why: 'Shoulder elevation' }] },
    cautions: [],
  };

  it('reads JSON, also inside code fences or extra words', () => {
    expect(parsePlan(JSON.stringify(answer))?.program.exercises[0].name).toBe('Wall walks');
    expect(parsePlan('Here you go:\n```json\n' + JSON.stringify(answer) + '\n```')?.struggling[0].area).toBe('Shoulder elevation');
  });

  it('returns null for plain text or empty plans', () => {
    expect(parsePlan('The patient is doing well.')).toBeNull();
    expect(parsePlan('{"summary": "x"}')).toBeNull();
  });
});
