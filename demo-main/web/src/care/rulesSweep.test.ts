import { describe, expect, it, vi } from 'vitest';
import { createRulesSweep, hashString, type SweepDeps } from './rulesSweep';

function setup(overrides: Partial<SweepDeps> = {}) {
  const data: Record<string, string> = { a: 'a1', b: 'b1' };
  let day = '2026-10-24';
  const deps: SweepDeps = {
    listPatientIds: vi.fn(async () => Object.keys(data)),
    fingerprint: vi.fn(async (id: string) => data[id]),
    evaluate: vi.fn(async () => ({ alertsCreated: [], planSuggested: null })),
    today: () => day,
    ...overrides,
  };
  return { deps, data, setDay: (d: string) => (day = d), sweep: createRulesSweep(deps) };
}

describe('createRulesSweep', () => {
  it('evaluates every patient on the first pass', async () => {
    const { sweep, deps } = setup();
    const r = await sweep.run();
    expect(r.evaluated).toEqual(['a', 'b']);
    expect(deps.evaluate).toHaveBeenCalledTimes(2);
  });

  it('skips patients whose data has not changed', async () => {
    const { sweep, deps, data } = setup();
    await sweep.run();
    data.b = 'b2';
    const r = await sweep.run();
    expect(r).toEqual({ evaluated: ['b'], skipped: ['a'], failed: [] });
    expect(deps.evaluate).toHaveBeenCalledTimes(3);
  });

  it('re-evaluates everyone on a new day', async () => {
    const { sweep, setDay } = setup();
    await sweep.run();
    setDay('2026-10-25');
    expect((await sweep.run()).evaluated).toEqual(['a', 'b']);
  });

  it('retries a patient whose evaluation failed', async () => {
    const evaluate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const { sweep } = setup({ evaluate });
    const first = await sweep.run();
    expect(first.failed).toEqual(['a']);
    expect(first.evaluated).toEqual(['b']);
    expect((await sweep.run()).evaluated).toEqual(['a']);
  });

  it('stops quietly when evaluatePatient is not implemented', async () => {
    const err = Object.assign(new Error('nope'), { code: 'not_implemented' });
    const evaluate = vi.fn().mockRejectedValue(err);
    const { sweep } = setup({ evaluate });
    await expect(sweep.run()).resolves.toEqual({ evaluated: [], skipped: [], failed: [] });
    expect(sweep.disabled).toBe(true);
    await sweep.run();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('shares one pass between overlapping calls', async () => {
    const { sweep, deps } = setup();
    const [r1, r2] = await Promise.all([sweep.run(), sweep.run()]);
    expect(r1).toBe(r2);
    expect(deps.listPatientIds).toHaveBeenCalledTimes(1);
  });

  it('survives a failing patient list', async () => {
    const { sweep } = setup({ listPatientIds: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(sweep.run()).resolves.toEqual({ evaluated: [], skipped: [], failed: [] });
  });
});

describe('hashString', () => {
  it('is stable and sensitive to changes', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});
