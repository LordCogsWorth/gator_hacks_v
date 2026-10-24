/**
 * LocalSource round-trips: clientKey idempotency + one alert, watch merge (0-as-missing),
 * approve / save / dismiss transitions (mirror SQL RPC semantics).
 *
 * Uses synchronous reseed (not resetDb): awaiting IndexedDB clear inside navigator.locks hangs in jsdom.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { LocalSource } from './LocalSource';
import { DB_KEY, readDb, reseedNow, seedDb } from './db';
import { evaluate } from '../../rules/engine';
import type { ExerciseResult, SessionUploadBody } from '../../types';

function clearStorage() {
  try {
    localStorage.removeItem(DB_KEY);
  } catch {
    /* ignore */
  }
}

function result(exercise: 'arm_raise' | 'forward_reach' | 'hand_open', side: 'weak' | 'healthy', bestValue: number, compRepPct = 0): ExerciseResult {
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

beforeEach(() => {
  clearStorage();
  reseedNow();
});

afterEach(() => {
  clearStorage();
});

describe('LocalSource insertSession clientKey', () => {
  it('posts twice with the same clientKey → one session; compensation alert once', async () => {
    const source = new LocalSource();
    const body: SessionUploadBody = {
      clientKey: 'ck-roundtrip-1',
      patientId: 'p-maria',
      startedAt: new Date().toISOString(),
      endedAt: new Date(Date.now() + 60_000).toISOString(),
      pain: 2,
      tiredness: 2,
      results: [result('arm_raise', 'healthy', 160), result('arm_raise', 'weak', 100, 65)],
    };

    const first = await source.insertSession(body);
    const snap1 = await source.loadSnapshot('p-maria');
    const rules1 = evaluate(snap1, new Date());
    const applied1 = await source.applyRuleResults('p-maria', rules1.alerts, rules1.plan);

    const second = await source.insertSession(body);
    const snap2 = await source.loadSnapshot('p-maria');
    const rules2 = evaluate(snap2, new Date());
    const applied2 = await source.applyRuleResults('p-maria', rules2.alerts, rules2.plan);

    expect(second.session.id).toBe(first.session.id);
    expect(second.results).toHaveLength(first.results.length);

    const db = readDb();
    expect(db.sessions.filter((s) => s.clientKey === 'ck-roundtrip-1')).toHaveLength(1);
    expect(db.results.filter((r) => r.sessionId === first.session.id)).toHaveLength(2);

    expect(applied1.alertsCreated.some((a) => a.type === 'compensation')).toBe(true);
    expect(applied2.alertsCreated.filter((a) => a.type === 'compensation')).toHaveLength(0);
    expect(db.alerts.filter((a) => a.patientId === 'p-maria' && a.type === 'compensation' && !a.acknowledged)).toHaveLength(1);
  });

  it('rejects a clientKey that belongs to another patient', async () => {
    const source = new LocalSource();
    const body: SessionUploadBody = {
      clientKey: 'ck-owned',
      patientId: 'p-maria',
      startedAt: new Date().toISOString(),
      endedAt: new Date(Date.now() + 30_000).toISOString(),
      results: [result('arm_raise', 'healthy', 160), result('arm_raise', 'weak', 80)],
    };
    await source.insertSession(body);
    await expect(
      source.insertSession({ ...body, patientId: 'p-james' }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
  });
});

describe('LocalSource submitWatchDaily merge', () => {
  it('keeps previous values for omitted fields and treats 0 as missing for BP/RHR', async () => {
    const source = new LocalSource();
    const first = await source.submitWatchDaily({
      patientId: 'p-priya',
      date: '2026-10-20',
      steps: 4000,
      restingHr: 72,
      bpSys: 128,
      bpDia: 80,
      falls: 0,
    });
    expect(first.steps).toBe(4000);
    expect(first.restingHr).toBe(72);
    expect(first.bpSys).toBe(128);

    const merged = await source.submitWatchDaily({
      patientId: 'p-priya',
      date: '2026-10-20',
      steps: 4500,
      restingHr: 0, // no reading
      bpSys: 0,
      bpDia: 0,
    });
    expect(merged.id).toBe(first.id);
    expect(merged.steps).toBe(4500);
    expect(merged.restingHr).toBe(72);
    expect(merged.bpSys).toBe(128);
    expect(merged.bpDia).toBe(80);
    expect(merged.falls).toBe(0);
  });

  it('scales walkingSteadiness 0–1 to 0–100', async () => {
    const source = new LocalSource();
    const row = await source.submitWatchDaily({
      patientId: 'p-maria',
      date: '2026-10-19',
      walkingSteadiness: 0.85,
    });
    expect(row.walkingSteadiness).toBe(85);
  });

  it('throws not_found for an unknown patient', async () => {
    const source = new LocalSource();
    await expect(
      source.submitWatchDaily({ patientId: 'p-nobody', date: '2026-10-20', steps: 100 }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      source.submitWatchDaily({ patientId: 'p-nobody', date: '2026-10-20', steps: 100 }),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});

describe('LocalSource plan transitions', () => {
  it('approve supersedes the old approved plan and mirrors phase + check-in', async () => {
    const source = new LocalSource();
    const snap = await source.loadSnapshot('p-maria');
    const suggested = snap.plans.find((p) => p.status === 'suggested');
    expect(suggested).toBeDefined();

    const beforeApproved = snap.plans.find((p) => p.status === 'approved')!;
    const plan = await source.approvePlan(suggested!.id, {
      approvedBy: 'Dr. Test',
      phase: 3,
      nextCheckin: '2026-11-15',
    });

    expect(plan.status).toBe('approved');
    expect(plan.phase).toBe(3);
    expect(plan.nextCheckin).toBe('2026-11-15');
    expect(plan.approvedBy).toBe('Dr. Test');

    const after = await source.loadSnapshot('p-maria');
    expect(after.patient.phase).toBe(3);
    expect(after.patient.nextCheckin).toBe('2026-11-15');
    expect(after.plans.find((p) => p.id === beforeApproved.id)?.status).toBe('superseded');
    expect(after.plans.filter((p) => p.status === 'approved')).toHaveLength(1);
    expect(after.plans.filter((p) => p.status === 'suggested')).toHaveLength(0);
  });

  it('approve rejects a non-suggested plan with conflict', async () => {
    const source = new LocalSource();
    const approved = (await source.loadSnapshot('p-james')).plans.find((p) => p.status === 'approved')!;
    await expect(source.approvePlan(approved.id, { approvedBy: 'Dr. X' })).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('dismiss only works from suggested', async () => {
    const source = new LocalSource();
    const snap = await source.loadSnapshot('p-james');
    const suggested = snap.plans.find((p) => p.status === 'suggested');
    // James may have a plateau suggestion from seed
    if (!suggested) {
      // Force a suggestion via applyRuleResults so the dismiss path is exercised
      const out = evaluate(snap, new Date());
      if (out.plan) await source.applyRuleResults('p-james', [], out.plan);
    }
    const open = (await source.loadSnapshot('p-james')).plans.find((p) => p.status === 'suggested');
    expect(open).toBeDefined();

    const dismissed = await source.dismissPlan(open!.id, 'Dr. Y');
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.dismissedBy).toBe('Dr. Y');

    await expect(source.dismissPlan(dismissed.id, 'Dr. Y')).rejects.toMatchObject({ code: 'conflict' });

    const approved = (await source.loadSnapshot('p-james')).plans.find((p) => p.status === 'approved')!;
    await expect(source.dismissPlan(approved.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('savePlan creates a new approved plan, supersedes old, dismisses open suggestion', async () => {
    const source = new LocalSource();
    const before = await source.loadSnapshot('p-priya');
    const oldApproved = before.plans.find((p) => p.status === 'approved')!;
    const hadSuggestion = before.plans.some((p) => p.status === 'suggested');

    const plan = await source.savePlan('p-priya', {
      approvedBy: 'Dr. Edit',
      phase: 2,
      exercises: [
        { exercise: 'arm_raise', reps: 12, target: 100 },
        { exercise: 'forward_reach', reps: 10, target: 140 },
        { exercise: 'hand_open', reps: 12, target: 70 },
      ],
      sessionsPerWeek: 6,
      nextCheckin: '2026-11-20',
    });

    expect(plan.status).toBe('approved');
    expect(plan.phase).toBe(2);
    expect(plan.sessionsPerWeek).toBe(6);
    expect(plan.id).not.toBe(oldApproved.id);

    const after = await source.loadSnapshot('p-priya');
    expect(after.patient.phase).toBe(2);
    expect(after.patient.nextCheckin).toBe('2026-11-20');
    expect(after.plans.find((p) => p.id === oldApproved.id)?.status).toBe('superseded');
    expect(after.plans.filter((p) => p.status === 'approved')).toHaveLength(1);
    if (hadSuggestion) {
      expect(after.plans.some((p) => p.status === 'suggested')).toBe(false);
      expect(after.plans.some((p) => p.status === 'dismissed' && p.dismissedBy === 'Dr. Edit')).toBe(true);
    }
  });

  it('setNextCheckin updates patient and approved plan', async () => {
    const source = new LocalSource();
    const patient = await source.setNextCheckin('p-maria', '2026-12-01');
    expect(patient.nextCheckin).toBe('2026-12-01');
    const snap = await source.loadSnapshot('p-maria');
    expect(snap.plans.find((p) => p.status === 'approved')!.nextCheckin).toBe('2026-12-01');
  });

  it('ackAlert sets acknowledgedAt once', async () => {
    const source = new LocalSource();
    const open = (await source.loadSnapshot('p-james')).alerts.find((a) => !a.acknowledged);
    expect(open).toBeDefined();
    const ack = await source.ackAlert(open!.id);
    expect(ack.acknowledged).toBe(true);
    expect(ack.acknowledgedAt).toBeTruthy();
    const again = await source.ackAlert(open!.id);
    expect(again.acknowledgedAt).toBe(ack.acknowledgedAt);
  });
});

describe('LocalSource seed', () => {
  it('seeds three patients and James has open plateau + adherence', async () => {
    const source = new LocalSource();
    const all = await source.loadAllSnapshots();
    expect(all.map((s) => s.patient.id).sort()).toEqual(['p-james', 'p-maria', 'p-priya']);
    const james = all.find((s) => s.patient.id === 'p-james')!;
    const openTypes = james.alerts.filter((a) => !a.acknowledged).map((a) => a.type);
    expect(openTypes).toContain('plateau');
    expect(openTypes).toContain('adherence');
    expect(james.sessions.every((s) => s.avgHr != null)).toBe(true);
    expect(james.replays.some((r) => r.path.startsWith('synth:'))).toBe(true);
  });

  it('reseedNow restores the three demo patients', () => {
    expect(seedDb().patients).toHaveLength(3);
    reseedNow();
    expect(readDb().patients.map((p) => p.id).sort()).toEqual(['p-james', 'p-maria', 'p-priya']);
  });
});
