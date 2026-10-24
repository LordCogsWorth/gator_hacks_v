/**
 * Fixture tests for snake→camel mappers and PostgREST / SQLSTATE → ApiError mapping (WP2 contracts).
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import {
  alertFromRow,
  iso,
  normWatchDaily,
  patientFromRow,
  planFromRow,
  resultFromRow,
  sessionFromRow,
  toApiError,
  watchDailyFromRow,
  watchSessionFromRow,
} from './mappers';

describe('iso', () => {
  it('normalises Postgres +00:00 to Z', () => {
    expect(iso('2026-10-24T15:00:00+00:00')).toBe('2026-10-24T15:00:00.000Z');
  });

  it('returns empty for nullish', () => {
    expect(iso(null)).toBe('');
    expect(iso(undefined)).toBe('');
  });
});

describe('fromRow mappers', () => {
  it('patientFromRow', () => {
    expect(
      patientFromRow({
        id: 'p-maria',
        name: 'Maria Santos',
        weak_side: 'left',
        stroke_date: '2026-07-12',
        phase: 2,
        max_raise_angle: 120,
        next_checkin: '2026-10-28',
        bp_limit_sys: 150,
      }),
    ).toEqual({
      id: 'p-maria',
      name: 'Maria Santos',
      weakSide: 'left',
      strokeDate: '2026-07-12',
      phase: 2,
      maxRaiseAngle: 120,
      nextCheckin: '2026-10-28',
      bpLimitSys: 150,
    });
  });

  it('sessionFromRow with replay keys and ISO times', () => {
    const row = sessionFromRow(
      {
        id: 'sess-1',
        patient_id: 'p-james',
        started_at: '2026-10-20T15:00:00+00:00',
        ended_at: '2026-10-20T15:20:00+00:00',
        pain: 2,
        tiredness: 3,
        stop_reason: null,
        avg_hr: 78,
      },
      ['sess-1-arm_raise-weak'],
    );
    expect(row.startedAt).toBe('2026-10-20T15:00:00.000Z');
    expect(row.endedAt).toBe('2026-10-20T15:20:00.000Z');
    expect(row.avgHr).toBe(78);
    expect(row.replays).toEqual(['sess-1-arm_raise-weak']);
    expect(row.stopReason).toBeNull();
  });

  it('resultFromRow stringifies bigint ids', () => {
    const r = resultFromRow({
      id: 42,
      session_id: 'sess-1',
      exercise: 'arm_raise',
      side: 'weak',
      best_value: 80,
      reps: 10,
      sec_per_rep: 3.2,
      smoothness: 1.1,
      fatigue: 1,
      trunk_lean_max: 8,
      shoulder_hike_max: 0.02,
      comp_rep_pct: 20,
      reach_cm: null,
      closed_min: null,
    });
    expect(r.id).toBe('42');
    expect(r.sessionId).toBe('sess-1');
    expect(r.reachCm).toBeNull();
  });

  it('planFromRow keeps basedOn and optional timestamps', () => {
    const p = planFromRow({
      id: 'plan-1',
      patient_id: 'p-maria',
      phase: 2,
      exercises: [{ exercise: 'arm_raise', reps: 10, target: 90 }],
      sessions_per_week: 5,
      status: 'suggested',
      approved_by: null,
      next_checkin: '2026-11-01',
      created_at: '2026-10-24T06:00:00+00:00',
      kind: 'phase-up',
      reason: 'Ready',
      based_on: { sessions: 3, avgSymmetry: 71, avgCompensation: 10 },
    });
    expect(p.status).toBe('suggested');
    expect(p.kind).toBe('phase-up');
    expect(p.basedOn).toEqual({ sessions: 3, avgSymmetry: 71, avgCompensation: 10 });
    expect(p.createdAt).toBe('2026-10-24T06:00:00.000Z');
    expect(p.approvedAt).toBeUndefined();
  });

  it('watchDailyFromRow stringifies id and maps snake fields', () => {
    const w = watchDailyFromRow({
      id: 7,
      patient_id: 'p-priya',
      date: '2026-10-24',
      steps: 5000,
      exercise_min: 20,
      stand_hr: 10,
      resting_hr: 74,
      hrv: 40,
      sleep_hr: 7,
      bp_sys: 142,
      bp_dia: 88,
      falls: 0,
      walking_steadiness: 80,
      weak_arm_active_min: 55,
      use_ratio: 0.42,
    });
    expect(w.id).toBe('7');
    expect(w.patientId).toBe('p-priya');
    expect(w.restingHr).toBe(74);
    expect(w.walkingSteadiness).toBe(80);
    expect(w.weakArmActiveMin).toBe(55);
  });

  it('watchSessionFromRow maps duration_sec and omits trace', () => {
    const w = watchSessionFromRow({
      id: 3,
      session_id: 'uuid-1',
      patient_id: 'p-maria',
      exercise: 'arm_raise',
      arm: 'left',
      started_at: '2026-10-10T18:00:00+00:00',
      ended_at: '2026-10-10T18:06:00+00:00',
      duration_sec: 360,
      target_reps: 10,
      reps: 10,
      attempts: 12,
      best_elevation_deg: 90,
      completed: true,
      avg_hr: 80,
      max_hr: 95,
      min_hr: 70,
      app_session_id: null,
    });
    expect(w.id).toBe('3');
    expect(w.sessionId).toBe('uuid-1');
    expect(w.durationSec).toBe(360);
    expect(w.completed).toBe(true);
    expect(w).not.toHaveProperty('trace');
  });

  it('alertFromRow', () => {
    const a = alertFromRow({
      id: 'al-1',
      patient_id: 'p-james',
      type: 'plateau',
      detail: 'Flat',
      created_at: '2026-10-24T06:00:00Z',
      acknowledged: false,
      acknowledged_at: null,
    });
    expect(a).toEqual({
      id: 'al-1',
      patientId: 'p-james',
      type: 'plateau',
      detail: 'Flat',
      createdAt: '2026-10-24T06:00:00.000Z',
      acknowledged: false,
    });
  });
});

describe('normWatchDaily (RPC shape)', () => {
  it('strips ok/updatedAt and keeps WatchDaily fields', () => {
    const w = normWatchDaily({
      ok: true,
      updatedAt: '2026-10-24T12:00:00Z',
      id: '9',
      patientId: 'p-maria',
      date: '2026-10-24',
      steps: 1000,
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
    expect(w).not.toHaveProperty('ok');
    expect(w).not.toHaveProperty('updatedAt');
    expect(w.restingHr).toBe(70);
    expect(w.id).toBe('9');
  });
});

describe('toApiError', () => {
  it('maps PT* and SQLSTATE codes', () => {
    expect(toApiError({ code: 'PT400', message: 'bad' })).toMatchObject({ status: 400, code: 'invalid' });
    expect(toApiError({ code: 'PT404', message: 'Unknown patient' })).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Unknown patient',
    });
    expect(toApiError({ code: 'PT409', message: 'conflict' })).toMatchObject({ status: 409, code: 'conflict' });
    expect(toApiError({ code: '23514', message: 'check' })).toMatchObject({ status: 400, code: 'invalid' });
    expect(toApiError({ code: '22P02', message: 'bad' })).toMatchObject({ status: 400, code: 'invalid' });
    expect(toApiError({ code: '22007', message: 'bad date' })).toMatchObject({ status: 400, code: 'invalid' });
    expect(toApiError({ code: '22008', message: 'oob' })).toMatchObject({ status: 400, code: 'invalid' });
    expect(toApiError({ code: '23505', message: 'unique' })).toMatchObject({ status: 409, code: 'conflict' });
    expect(toApiError({ code: '23503', message: 'fk' })).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('passes through ApiError and maps network failures', () => {
    const existing = new ApiError('x', 404, 'not_found');
    expect(toApiError(existing)).toBe(existing);
    expect(toApiError({ message: 'Failed to fetch' })).toMatchObject({ status: 0, code: 'network' });
    expect(toApiError({ name: 'AbortError', message: 'aborted' })).toMatchObject({ status: 0, code: 'network' });
  });
});
