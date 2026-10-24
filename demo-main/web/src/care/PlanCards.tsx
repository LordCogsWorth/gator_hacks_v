import { Check, ClipboardList, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { approvePlan, dismissPlan, savePlan } from '../api';
import type { Exercise, Patient, Plan, PlanExercise, SavePlanBody } from '../types';
import { EXERCISE_LABELS, PLAN_KIND_LABELS, TARGET_UNITS } from '../types';
import { Badge, Button, Card, EmptyState, ERROR_CLASS, INPUT_CLASS, LABEL_CLASS, cx } from '../ui';
import { addDays, formatDay, isValidCheckin, MAX_CHECKIN_DAYS, shortDateTime, todayISO } from './dates';
import { errorMessage } from './errors';

const DEFAULT_APPROVER = 'Dr. Chen';
export const DEFAULT_MAX_PHASE = 4;
const MAX_REPS = 200;
const MAX_TARGET: Record<Exercise, number> = { arm_raise: 180, forward_reach: 180, hand_open: 100 };

const CELL_INPUT =
  'min-h-tap w-24 rounded-control border border-text-muted/40 bg-surface px-3 text-base tabular-nums text-text ' +
  'hover:border-text-muted/70 focus-visible:border-focus disabled:opacity-50';

/** After approve / dismiss / save: a message for the page and the new approved plan's id (none after a dismiss). */
export type PlanDone = (message: string, approvedPlanId?: string) => Promise<void> | void;

// Form values are kept as strings so the inputs can be cleared while typing.
interface Draft {
  phase: string;
  exercises: { exercise: Exercise; reps: string; target: string }[];
  sessionsPerWeek: string;
  nextCheckin: string;
  approvedBy: string;
}

/** What the draft is compared against (the plan in force). */
interface Baseline {
  phase: number;
  exercises: PlanExercise[];
  sessionsPerWeek: number | null;
  nextCheckin: string;
}

/** A check-in the data layer will accept: the given one, else two weeks out. */
function usableCheckin(date: string, today: string) {
  return isValidCheckin(date, today) ? date : addDays(today, 14);
}

function draftFrom(plan: Plan, nextCheckin: string): Draft {
  return {
    phase: String(plan.phase),
    exercises: plan.exercises.map((e) => ({ exercise: e.exercise, reps: String(e.reps), target: String(e.target) })),
    sessionsPerWeek: String(plan.sessionsPerWeek),
    nextCheckin,
    approvedBy: DEFAULT_APPROVER,
  };
}

/** Problems with the draft (empty = OK to save). */
function draftProblems(d: Draft, today: string, maxPhase: number): string[] {
  const problems: string[] = [];
  const phase = Number(d.phase);
  if (!Number.isInteger(phase) || phase < 1 || phase > maxPhase) problems.push(`Phase must be 1–${maxPhase}`);
  for (const e of d.exercises) {
    const label = EXERCISE_LABELS[e.exercise];
    const reps = Number(e.reps);
    if (!e.reps.trim() || !Number.isInteger(reps) || reps < 1 || reps > MAX_REPS) problems.push(`${label}: reps must be a whole number 1–${MAX_REPS}`);
    const target = Number(e.target);
    const max = MAX_TARGET[e.exercise];
    if (!e.target.trim() || !Number.isFinite(target) || target <= 0 || target > max) {
      problems.push(`${label}: target must be above 0 and at most ${max}${TARGET_UNITS[e.exercise]}`);
    }
  }
  const spw = Number(d.sessionsPerWeek);
  if (!Number.isInteger(spw) || spw < 1 || spw > 14) problems.push('Sessions per week must be 1–14');
  if (!isValidCheckin(d.nextCheckin, today)) problems.push(`Next check-in must be between today and ${MAX_CHECKIN_DAYS} days from now`);
  if (!d.approvedBy.trim()) problems.push('Enter who is approving');
  return problems;
}

function draftBody(d: Draft): SavePlanBody {
  return {
    approvedBy: d.approvedBy.trim(),
    phase: Number(d.phase),
    exercises: d.exercises.map((e) => ({ exercise: e.exercise, reps: Number(e.reps), target: Number(e.target) })),
    sessionsPerWeek: Number(d.sessionsPerWeek),
    nextCheckin: d.nextCheckin,
  };
}

/** "▲ 2" / "▼ 5" next to an edited value, or nothing if unchanged/unknown. */
function Change({ from, to }: { from: number | null | undefined; to: number }) {
  if (from == null || !Number.isFinite(to) || from === to) return null;
  const diff = Math.round((to - from) * 10) / 10;
  return (
    <span className="ml-2 whitespace-nowrap text-sm font-semibold text-primary">
      <span aria-hidden>{diff > 0 ? '▲' : '▼'}</span>
      <span className="sr-only">{diff > 0 ? 'up' : 'down'}</span> {Math.abs(diff)}
    </span>
  );
}

function cell(changed: boolean) {
  return cx('px-3 py-2', changed && 'bg-primary-soft');
}

/** Current plan vs the draft, with the draft editable. Shared by the suggestion review and "Edit plan". */
function PlanDiffTable({
  draft,
  setDraft,
  baseline,
  maxPhase,
  today,
  draftHeading,
  onCheckinEdit,
}: {
  draft: Draft;
  setDraft: (update: (d: Draft) => Draft) => void;
  baseline: Baseline;
  maxPhase: number;
  today: string;
  draftHeading: string;
  onCheckinEdit?: () => void;
}) {
  const currentByExercise = new Map(baseline.exercises.map((e) => [e.exercise, e]));
  const setExercise = (i: number, field: 'reps' | 'target', value: string) =>
    setDraft((d) => ({ ...d, exercises: d.exercises.map((e, j) => (j === i ? { ...e, [field]: value } : e)) }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-base">
        <thead className="bg-surface-2 text-sm uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              <span className="sr-only">Setting</span>
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">Current</th>
            <th scope="col" className="px-3 py-2 font-semibold">{draftHeading}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <th scope="row" className="px-3 py-2 font-semibold text-text">Phase</th>
            <td className="px-3 py-2 tabular-nums text-text">{baseline.phase}</td>
            <td className={cell(Number(draft.phase) !== baseline.phase)}>
              <select
                aria-label="Phase"
                className={cx(CELL_INPUT, 'w-32')}
                value={draft.phase}
                onChange={(ev) => setDraft((d) => ({ ...d, phase: ev.target.value }))}
              >
                {Array.from({ length: maxPhase }, (_, i) => String(i + 1)).map((p) => (
                  <option key={p} value={p}>
                    Phase {p}
                  </option>
                ))}
              </select>
              <Change from={baseline.phase} to={Number(draft.phase)} />
            </td>
          </tr>
          {draft.exercises.map((e, i) => {
            const cur = currentByExercise.get(e.exercise);
            const unit = TARGET_UNITS[e.exercise];
            const label = EXERCISE_LABELS[e.exercise];
            const changed = !cur || Number(e.reps) !== cur.reps || Number(e.target) !== cur.target;
            return (
              <tr key={e.exercise} className="border-t border-border">
                <th scope="row" className="px-3 py-2 font-semibold text-text">{label}</th>
                <td className="px-3 py-2 tabular-nums text-text">{cur ? `${cur.reps} reps · ${cur.target}${unit}` : '—'}</td>
                <td className={cell(changed)}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={MAX_REPS}
                        step={1}
                        inputMode="numeric"
                        aria-label={`${label} reps`}
                        className={CELL_INPUT}
                        value={e.reps}
                        onChange={(ev) => setExercise(i, 'reps', ev.target.value)}
                      />
                      <span className="text-text-muted">reps</span>
                      <Change from={cur?.reps} to={Number(e.reps)} />
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={MAX_TARGET[e.exercise]}
                        inputMode="decimal"
                        aria-label={`${label} target`}
                        className={CELL_INPUT}
                        value={e.target}
                        onChange={(ev) => setExercise(i, 'target', ev.target.value)}
                      />
                      <span className="text-text-muted">{unit}</span>
                      <Change from={cur?.target} to={Number(e.target)} />
                    </label>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-border">
            <th scope="row" className="px-3 py-2 font-semibold text-text">Sessions / week</th>
            <td className="px-3 py-2 tabular-nums text-text">{baseline.sessionsPerWeek ?? '—'}</td>
            <td className={cell(Number(draft.sessionsPerWeek) !== baseline.sessionsPerWeek)}>
              <input
                type="number"
                min={1}
                max={14}
                step={1}
                inputMode="numeric"
                aria-label="Sessions per week"
                className={CELL_INPUT}
                value={draft.sessionsPerWeek}
                onChange={(ev) => setDraft((d) => ({ ...d, sessionsPerWeek: ev.target.value }))}
              />
              <Change from={baseline.sessionsPerWeek} to={Number(draft.sessionsPerWeek)} />
            </td>
          </tr>
          <tr className="border-t border-border">
            <th scope="row" className="px-3 py-2 font-semibold text-text">Next check-in</th>
            <td className="px-3 py-2 text-text">{formatDay(baseline.nextCheckin)}</td>
            <td className={cell(draft.nextCheckin !== baseline.nextCheckin)}>
              <input
                type="date"
                aria-label="Next check-in"
                min={today}
                max={addDays(today, MAX_CHECKIN_DAYS)}
                className={cx(CELL_INPUT, 'w-48')}
                value={draft.nextCheckin}
                onChange={(ev) => {
                  onCheckinEdit?.();
                  setDraft((d) => ({ ...d, nextCheckin: ev.target.value }));
                }}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ApproverField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className={cx(LABEL_CLASS, 'w-64')}>
      Approved by
      <input type="text" className={INPUT_CLASS} value={value} onChange={(ev) => onChange(ev.target.value)} />
    </label>
  );
}

function Problems({ problems, error }: { problems: string[]; error: string | null }) {
  return (
    <>
      {problems.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-base text-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className={cx(ERROR_CLASS, 'text-base')}>
          {error}
        </p>
      )}
    </>
  );
}

export function SuggestedPlanCard({
  plan,
  approvedPlan,
  patient,
  maxPhase = DEFAULT_MAX_PHASE,
  onDone,
}: {
  plan: Plan;
  approvedPlan: Plan | null;
  patient: Patient;
  maxPhase?: number;
  onDone: PlanDone;
}) {
  const today = todayISO();
  // Parent renders this with key={plan.id}, so polling doesn't reset edits.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(plan, usableCheckin(patient.nextCheckin, today)));
  const [checkinTouched, setCheckinTouched] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Until edited here, the check-in follows the patient's ("Next check-in" above), so approving never undoes a move.
  useEffect(() => {
    if (!checkinTouched) setDraft((d) => ({ ...d, nextCheckin: usableCheckin(patient.nextCheckin, todayISO()) }));
  }, [patient.nextCheckin, checkinTouched]);

  const problems = draftProblems(draft, today, maxPhase);
  const baseline: Baseline = {
    phase: approvedPlan?.phase ?? patient.phase,
    exercises: approvedPlan?.exercises ?? [],
    sessionsPerWeek: approvedPlan?.sessionsPerWeek ?? null,
    nextCheckin: patient.nextCheckin,
  };

  async function onApprove() {
    setBusy('approve');
    setError(null);
    try {
      const approved = await approvePlan(plan.id, draftBody(draft));
      await onDone(`Plan approved by ${approved.approvedBy}. ${patient.name}'s app now shows the phase ${approved.phase} plan.`, approved.id);
    } catch (e) {
      setError(errorMessage(e, 'Could not approve the plan'));
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
      setError(errorMessage(e, 'Could not dismiss the suggestion'));
      setBusy(null);
    }
  }

  return (
    <Card
      tone="primary"
      icon={<ClipboardList />}
      title="Suggested plan"
      subtitle="Drafted by the rules engine. Review, edit if needed, then approve."
      action={plan.kind && <Badge tone="primary">{PLAN_KIND_LABELS[plan.kind]}</Badge>}
    >
      {plan.reason && <p className="border-l-4 border-primary pl-4 text-lg leading-snug text-text">{plan.reason}</p>}
      {plan.basedOn && (
        <p className="mt-2 text-sm text-text-muted">
          Based on {plan.basedOn.sessions} session{plan.basedOn.sessions === 1 ? '' : 's'}
          {plan.basedOn.avgSymmetry != null && ` · average symmetry ${plan.basedOn.avgSymmetry}%`}
          {plan.basedOn.avgCompensation != null && ` · average compensation ${plan.basedOn.avgCompensation}%`}
        </p>
      )}

      <div className="mt-4">
        <PlanDiffTable
          draft={draft}
          setDraft={setDraft}
          baseline={baseline}
          maxPhase={maxPhase}
          today={today}
          draftHeading="Suggested (editable)"
          onCheckinEdit={() => setCheckinTouched(true)}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <ApproverField value={draft.approvedBy} onChange={(v) => setDraft((d) => ({ ...d, approvedBy: v }))} />
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon={<X />} loading={busy === 'dismiss'} disabled={busy !== null} onClick={onDismiss}>
            Dismiss
          </Button>
          <Button icon={<Check />} loading={busy === 'approve'} disabled={busy !== null || problems.length > 0} onClick={onApprove}>
            Approve plan
          </Button>
        </div>
      </div>
      <Problems problems={problems} error={error} />
    </Card>
  );
}

/** The plan the patient is following right now, with an inline "Edit plan" editor (→ api.savePlan). */
export function CurrentPlanCard({
  plan,
  patient,
  maxPhase = DEFAULT_MAX_PHASE,
  justApproved,
  onDone,
}: {
  plan: Plan;
  patient: Patient;
  maxPhase?: number;
  justApproved: boolean;
  onDone: PlanDone;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO();
  const problems = draft ? draftProblems(draft, today, maxPhase) : [];

  function startEdit() {
    setError(null);
    setDraft(draftFrom(plan, usableCheckin(patient.nextCheckin, today)));
  }

  async function onSave() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await savePlan(patient.id, draftBody(draft));
      setDraft(null);
      await onDone(`New plan saved by ${saved.approvedBy}. ${patient.name}'s app now shows the phase ${saved.phase} plan.`, saved.id);
    } catch (e) {
      setError(errorMessage(e, 'Could not save the plan'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      tone={justApproved ? 'primary' : 'default'}
      icon={<ClipboardList />}
      title={`Current plan · Phase ${plan.phase}`}
      subtitle={`Approved by ${plan.approvedBy ?? '—'}${plan.approvedAt ? ` · ${shortDateTime(plan.approvedAt)}` : ''}`}
      action={
        <>
          {justApproved && <Badge tone="success">Just approved</Badge>}
          {!draft && (
            <Button variant="secondary" icon={<Pencil />} onClick={startEdit}>
              Edit plan
            </Button>
          )}
        </>
      }
    >
      {draft ? (
        <>
          <PlanDiffTable
            draft={draft}
            setDraft={(update) => setDraft((d) => (d ? update(d) : d))}
            baseline={{ phase: plan.phase, exercises: plan.exercises, sessionsPerWeek: plan.sessionsPerWeek, nextCheckin: patient.nextCheckin }}
            maxPhase={maxPhase}
            today={today}
            draftHeading="New plan"
          />
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <ApproverField value={draft.approvedBy} onChange={(v) => setDraft((d) => (d ? { ...d, approvedBy: v } : d))} />
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button icon={<Check />} loading={busy} disabled={problems.length > 0} onClick={onSave}>
                Save and approve
              </Button>
            </div>
          </div>
          <Problems problems={problems} error={error} />
        </>
      ) : (
        <>
          <ul className="flex flex-wrap gap-3">
            {plan.exercises.map((e) => (
              <li key={e.exercise} className="rounded-control border border-border bg-surface-2 px-4 py-2 text-base">
                <span className="font-semibold text-text">{EXERCISE_LABELS[e.exercise]}</span>
                <span className="ml-2 tabular-nums text-text">
                  {e.reps} reps · target {e.target}
                  {TARGET_UNITS[e.exercise]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-base text-text-muted">
            {plan.sessionsPerWeek} sessions / week · next check-in{' '}
            <span className="font-semibold text-text">{formatDay(patient.nextCheckin)}</span>
          </p>
        </>
      )}
    </Card>
  );
}

export function NoPlanCard() {
  return (
    <EmptyState icon={<ClipboardList />} title="No approved plan yet">
      The rules engine drafts a plan once there are enough sessions to compare.
    </EmptyState>
  );
}
