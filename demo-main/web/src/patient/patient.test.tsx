import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../types';
import { localDate, shortcutUpload } from './demo';
import { DEFAULT_PATIENT_ID, resolvePatientId } from './identity';
import { isNewPlan } from './PatientData';
import { TodayCard } from './screens/Dashboard';
import { newClientKey } from './session/SessionContext';

const plan: Plan = {
  id: 'plan-1',
  patientId: 'p-james',
  phase: 2,
  exercises: [
    { exercise: 'arm_raise', reps: 10, target: 90 },
    { exercise: 'forward_reach', reps: 8, target: 140 },
    { exercise: 'hand_open', reps: 12, target: 80 },
  ],
  sessionsPerWeek: 5,
  status: 'approved',
  approvedBy: 'Dr. Lee',
  nextCheckin: '2026-11-01',
  createdAt: '2026-10-01T10:00:00.000Z',
  approvedAt: '2026-10-20T10:00:00.000Z',
};

describe('resolvePatientId', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('defaults to p-maria', () => expect(resolvePatientId(q(''), null)).toBe(DEFAULT_PATIENT_ID));
  it('prefers ?as over the remembered id', () => expect(resolvePatientId(q('as=p-james'), 'p-priya')).toBe('p-james'));
  it('uses the remembered id', () => expect(resolvePatientId(q(''), 'p-priya')).toBe('p-priya'));
  it('shows the picker only with ?pick=1', () => {
    expect(resolvePatientId(q('pick=1'), 'p-priya')).toBeNull();
    expect(resolvePatientId(q('pick=1&as=p-james'), null)).toBeNull();
  });
});

describe('isNewPlan', () => {
  it('is false without a plan', () => expect(isNewPlan(null, null, null)).toBe(false));
  it('first visit: new when approved after the last session', () => {
    expect(isNewPlan(plan, null, '2026-10-19T09:00:00.000Z')).toBe(true);
    expect(isNewPlan(plan, null, '2026-10-21T09:00:00.000Z')).toBe(false);
    expect(isNewPlan(plan, null, null)).toBe(true);
  });
  it('after a dismissal: new only when approved later than the seen time', () => {
    expect(isNewPlan(plan, '2026-10-20T10:00:00.000Z', null)).toBe(false);
    expect(isNewPlan(plan, '2026-10-15T10:00:00.000Z', '2026-10-23T09:00:00.000Z')).toBe(true);
  });
});

describe('TodayCard (Home hero)', () => {
  const html = (p: Plan | null, done = false) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <TodayCard plan={p} doneToday={done} onStart={() => undefined} />
      </MemoryRouter>,
    );

  it('renders an xl Start button and one chip per exercise', () => {
    const out = html(plan);
    expect(out).toContain("Start today&#x27;s session");
    expect(out).toMatch(/<button[^>]*class="[^"]*min-h-16[^"]*text-xl/);
    expect(out).toContain('10 reps · goal 90°');
    expect((out.match(/<li class="[^"]*bg-primary-soft/g) ?? []).length).toBe(3);
  });

  it('says when today is done', () => {
    expect(html(plan, true)).toContain('Start another session');
  });

  it('has no Start without a plan', () => {
    expect(html(null)).not.toContain('<button');
  });
});

describe('demo helpers', () => {
  it('builds the Shortcut presets', () => {
    expect(shortcutUpload('hr', 'p-james', '2026-10-24', 70)).toEqual({ patientId: 'p-james', date: '2026-10-24', restingHr: 82 });
    expect(shortcutUpload('fall', 'p-james', '2026-10-24', 70)).toEqual({ patientId: 'p-james', date: '2026-10-24', falls: 1 });
    expect(shortcutUpload('normal', 'p-james', '2026-10-24', 70)).toMatchObject({ restingHr: 70, falls: 0 });
  });
  it('formats the local date', () => expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05'));
});

describe('newClientKey', () => {
  it('returns distinct v4 UUIDs', () => {
    const a = newClientKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newClientKey()).not.toBe(a);
  });
});
