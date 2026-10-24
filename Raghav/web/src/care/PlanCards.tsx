import { useState } from 'react';
import { approvePlan, dismissPlan } from '../api';
import type { Exercise, Patient, Plan } from '../types';
import { EXERCISE_LABELS, PLAN_KIND_LABELS, TARGET_UNITS } from '../types';

const DEFAULT_APPROVER = 'Dr. Chen';

const inputClass =
  'w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-base tabular-nums text-ink focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal-soft';

function formatDate(date: string) {
  const d = new Date(date + 'T12:00:00');
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "+10" / "−5" next to an edited value, or nothing if unchanged/unknown. */
function Delta({ from, to }: { from: number | undefined; to: number }) {
  if (from === undefined || !Number.isFinite(to) || from === to) return null;
  const diff = to - from;
  return (
    <span className={`ml-1 text-sm font-semibold ${diff > 0 ? 'text-teal-deep' : 'text-alert'}`}>
      {diff > 0 ? '+' : '−'}
      {Math.abs(Math.round(diff * 10) / 10)}
    </span>
  );
}

/** Table cell that turns teal when the suggested value differs from the approved one. */
function changedCell(changed: boolean) {
  return `px-3 py-2 ${changed ? 'bg-teal-soft/70' : ''}`;
}

// Form values are kept as strings so the inputs can be cleared while typing.
interface Draft {
  exercises: { exercise: Exercise; reps: string; target: string }[];
  sessionsPerWeek: string;
  nextCheckin: string;
  approvedBy: string;
}

function draftFrom(plan: Plan): Draft {
  return {
    exercises: plan.exercises.map((e) => ({
      exercise: e.exercise,
      reps: String(e.reps),
      target: String(e.target),
    })),
    sessionsPerWeek: String(plan.sessionsPerWeek),
    nextCheckin: plan.nextCheckin,
    approvedBy: DEFAULT_APPROVER,
  };
}

/** Returns a list of problems with the draft (empty = OK to approve). */
function draftProblems(d: Draft): string[] {
  const problems: string[] = [];
  for (const e of d.exercises) {
    const reps = Number(e.reps);
    if (!Number.isInteger(reps) || reps < 1) problems.push(`${EXERCISE_LABELS[e.exercise]}: reps must be a whole number ≥ 1`);
    const target = Number(e.target);
    if (!e.target.trim() || !Number.isFinite(target) || target <= 0) {
      problems.push(`${EXERCISE_LABELS[e.exercise]}: target must be a positive number`);
    }
  }
  const spw = Number(d.sessionsPerWeek);
  if (!Number.isInteger(spw) || spw < 1 || spw > 14) problems.push('Sessions per week must be 1–14');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.nextCheckin)) problems.push('Pick a next check-in date');
  if (!d.approvedBy.trim()) problems.push('Enter who is approving');
  return problems;
}

export function SuggestedPlanCard({
  plan,
  approvedPlan,
  patient,
  onDone,
}: {
  plan: Plan;
  approvedPlan: Plan | null;
  patient: Patient;
  /** Called after approve/dismiss succeeds, with a message for the page
   *  and the approved plan's id (undefined after a dismiss). */
  onDone: (message: string, approvedPlanId?: string) => Promise<void> | void;
}) {
  // Parent renders this with key={plan.id}, so polling doesn't reset edits.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(plan));
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problems = draftProblems(draft);
  const currentByExercise = new Map(approvedPlan?.exercises.map((e) => [e.exercise, e]));
  const currentPhase = approvedPlan?.phase ?? patient.phase;

  function setExercise(i: number, field: 'reps' | 'target', value: string) {
    setDraft((d) => ({
      ...d,
      exercises: d.exercises.map((e, j) => (j === i ? { ...e, [field]: value } : e)),
    }));
  }

  async function onApprove() {
    setBusy('approve');
    setError(null);
    try {
      const approved = await approvePlan(plan.id, {
        approvedBy: draft.approvedBy.trim(),
        exercises: draft.exercises.map((e) => ({
          exercise: e.exercise,
          reps: Number(e.reps),
          target: Number(e.target),
        })),
        sessionsPerWeek: Number(draft.sessionsPerWeek),
        nextCheckin: draft.nextCheckin,
      });
      await onDone(
        `Plan approved by ${approved.approvedBy}. ${patient.name}'s app now shows the phase ${approved.phase} plan.`,
        approved.id
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve plan');
      setBusy(null);
    }
  }

  async function onDismiss() {
    setBusy('dismiss');
    setError(null);
    try {
      await dismissPlan(plan.id, draft.approvedBy.trim() || undefined);
      await onDone('Suggestion dismissed. The current plan stays in place.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not dismiss plan');
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border-2 border-teal/40 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-ink">
          Suggested plan
          {plan.kind && (
            <span className="ml-3 rounded bg-teal-soft px-2 py-0.5 align-middle text-sm font-semibold text-teal-deep">
              {PLAN_KIND_LABELS[plan.kind]}
            </span>
          )}
        </h2>
        <p className="text-sm text-slate-500">Drafted by the rules engine · needs clinician approval</p>
      </div>

      {plan.reason && (
        <p className="mt-3 border-l-4 border-teal pl-4 text-lg leading-snug text-slate-800">{plan.reason}</p>
      )}
      {plan.basedOn && (
        <p className="mt-2 text-sm text-slate-500">
          Based on {plan.basedOn.sessions} session{plan.basedOn.sessions === 1 ? '' : 's'}
          {plan.basedOn.avgSymmetry != null && ` · avg symmetry ${plan.basedOn.avgSymmetry}%`}
          {plan.basedOn.avgCompensation != null && ` · avg compensation ${plan.basedOn.avgCompensation}%`}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-base">
          <thead className="text-sm uppercase tracking-wide text-slate-500">
            <tr className="border-b border-foam">
              <th className="px-3 py-2 font-semibold" />
              <th className="px-3 py-2 font-semibold">Current (approved)</th>
              <th className="px-3 py-2 font-semibold">Suggested — edit before approving</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-foam">
              <th className="px-3 py-2 font-semibold text-ink">Phase</th>
              <td className="px-3 py-2 tabular-nums">{currentPhase}</td>
              <td className={changedCell(plan.phase !== currentPhase)}>
                <span className="font-semibold tabular-nums">{plan.phase}</span>
                <Delta from={currentPhase} to={plan.phase} />
              </td>
            </tr>
            {draft.exercises.map((e, i) => {
              const cur = currentByExercise.get(e.exercise);
              const unit = TARGET_UNITS[e.exercise];
              const changed = !cur || Number(e.reps) !== cur.reps || Number(e.target) !== cur.target;
              return (
                <tr key={e.exercise} className="border-b border-foam">
                  <th className="px-3 py-2 font-semibold text-ink">{EXERCISE_LABELS[e.exercise]}</th>
                  <td className="px-3 py-2 tabular-nums text-slate-700">
                    {cur ? `${cur.reps} reps · ${cur.target}${unit}` : '—'}
                  </td>
                  <td className={changedCell(changed)}>
                    <label className="mr-3 inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        aria-label={`${EXERCISE_LABELS[e.exercise]} reps`}
                        className={inputClass}
                        value={e.reps}
                        onChange={(ev) => setExercise(i, 'reps', ev.target.value)}
                      />
                      <span className="text-slate-600">reps</span>
                      <Delta from={cur?.reps} to={Number(e.reps)} />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        inputMode="decimal"
                        aria-label={`${EXERCISE_LABELS[e.exercise]} target`}
                        className={inputClass}
                        value={e.target}
                        onChange={(ev) => setExercise(i, 'target', ev.target.value)}
                      />
                      <span className="text-slate-600">{unit}</span>
                      <Delta from={cur?.target} to={Number(e.target)} />
                    </label>
                  </td>
                </tr>
              );
            })}
            <tr className="border-b border-foam">
              <th className="px-3 py-2 font-semibold text-ink">Sessions / week</th>
              <td className="px-3 py-2 tabular-nums">{approvedPlan?.sessionsPerWeek ?? '—'}</td>
              <td className={changedCell(Number(draft.sessionsPerWeek) !== approvedPlan?.sessionsPerWeek)}>
                <input
                  type="number"
                  min={1}
                  max={14}
                  step={1}
                  aria-label="Sessions per week"
                  className={inputClass}
                  value={draft.sessionsPerWeek}
                  onChange={(ev) => setDraft((d) => ({ ...d, sessionsPerWeek: ev.target.value }))}
                />
                <Delta from={approvedPlan?.sessionsPerWeek} to={Number(draft.sessionsPerWeek)} />
              </td>
            </tr>
            <tr>
              <th className="px-3 py-2 font-semibold text-ink">Next check-in</th>
              <td className="px-3 py-2">{formatDate(approvedPlan?.nextCheckin ?? patient.nextCheckin)}</td>
              <td className={changedCell(draft.nextCheckin !== (approvedPlan?.nextCheckin ?? patient.nextCheckin))}>
                <input
                  type="date"
                  aria-label="Next check-in"
                  className={`${inputClass} w-44`}
                  value={draft.nextCheckin}
                  onChange={(ev) => setDraft((d) => ({ ...d, nextCheckin: ev.target.value }))}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <label className="flex flex-col gap-1 text-sm font-semibold text-slate-600">
          Approved by
          <input
            type="text"
            className={`${inputClass} w-56 text-lg`}
            value={draft.approvedBy}
            onChange={(ev) => setDraft((d) => ({ ...d, approvedBy: ev.target.value }))}
          />
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={onDismiss}
            className="rounded-lg bg-white px-5 py-3 text-lg font-semibold text-slate-700 shadow-sm ring-1 ring-slate-300 hover:bg-mist disabled:opacity-60"
          >
            {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
          <button
            type="button"
            disabled={busy !== null || problems.length > 0}
            onClick={onApprove}
            className="rounded-lg bg-teal px-6 py-3 text-lg font-semibold text-white shadow-sm hover:bg-teal-deep disabled:opacity-50"
          >
            {busy === 'approve' ? 'Approving…' : 'Approve plan'}
          </button>
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-base text-alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-base font-semibold text-alert">{error}</p>}
    </section>
  );
}

/** The plan the patient is following right now. */
export function CurrentPlanCard({ plan, justApproved }: { plan: Plan; justApproved: boolean }) {
  return (
    <section
      className={`rounded-xl border bg-white p-5 shadow-sm transition-colors ${
        justApproved ? 'border-teal ring-2 ring-teal-soft' : 'border-foam'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-ink">
          Current plan · Phase {plan.phase}
          {justApproved && (
            <span className="ml-3 rounded bg-teal px-2 py-0.5 align-middle text-sm font-semibold text-white">
              Just approved
            </span>
          )}
        </h2>
        <p className="text-sm text-slate-500">
          Approved by {plan.approvedBy ?? '—'}
          {plan.approvedAt && ` · ${new Date(plan.approvedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-3">
        {plan.exercises.map((e) => (
          <li key={e.exercise} className="rounded-lg bg-mist px-4 py-2 text-base">
            <span className="font-semibold text-ink">{EXERCISE_LABELS[e.exercise]}</span>
            <span className="ml-2 tabular-nums text-slate-700">
              {e.reps} reps · target {e.target}
              {TARGET_UNITS[e.exercise]}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-base text-slate-600">
        {plan.sessionsPerWeek} sessions / week · next check-in{' '}
        <span className="font-semibold text-ink">{formatDate(plan.nextCheckin)}</span>
      </p>
    </section>
  );
}
