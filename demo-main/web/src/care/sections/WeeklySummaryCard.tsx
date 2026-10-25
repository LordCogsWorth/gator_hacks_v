import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPatientCameraAnalyses, getWeeklySummary } from '../../api';
import type { CameraAnalysis, WeeklySummary } from '../../types';
import { Badge, Button, Card, cx, ERROR_CLASS, Spinner } from '../../ui';
import { askGemma, computeBaseline, loadStoredPlan, parsePlan, planData, planPrompt, storePlan, type BaselineRow, type PlanInput, type StoredPlan } from '../aiPlan';
import { formatDay, shortDateTime } from '../dates';
import { errorMessage, isNotImplemented } from '../errors';

/**
 * Weekly summary: an AI rehab plan from Gemma for the clinician to review. At the top, where the patient is
 * struggling and their current baseline (numbers worked out in aiPlan.ts, not by the model); then suggested
 * exercises. Before the first Generate, the stored two-sentence summary (if any) is shown instead.
 */
export function WeeklySummaryCard({ patientId, firstName, data }: { patientId: string; firstName: string; data: Omit<PlanInput, 'cameraAnalyses'> }) {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [stored, setStored] = useState<StoredPlan | null>(() => loadStoredPlan(patientId));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStored(loadStoredPlan(patientId));
    setError(null);
    getWeeklySummary(patientId).then(
      (s) => !cancelled && setSummary(s),
      (e) => {
        if (cancelled) return;
        setSummary(null);
        if (!isNotImplemented(e)) console.warn('Weekly summary not loaded', e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  async function onGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const cameraAnalyses = await getPatientCameraAnalyses(patientId).catch(() => [] as CameraAnalysis[]);
      const input: PlanInput = { ...data, cameraAnalyses };
      const out = await askGemma(planPrompt(planData(input)));
      const next: StoredPlan = {
        plan: parsePlan(out.text),
        raw: out.text,
        model: out.model,
        createdAt: new Date().toISOString(),
        baseline: computeBaseline(input),
      };
      storePlan(patientId, next);
      setStored(next);
    } catch (e) {
      setError(errorMessage(e, 'Could not generate the plan'));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card
      icon={<Sparkles />}
      title="Weekly summary"
      action={
        <>
          <Badge tone="info">AI draft for clinician review</Badge>
          <Button variant={stored ? 'secondary' : 'primary'} icon={<Sparkles />} loading={generating} onClick={onGenerate}>
            {stored ? 'Regenerate' : 'Generate AI plan'}
          </Button>
        </>
      }
      footer={
        stored ? (
          <p className="text-sm text-text-muted">
            Written by {stored.model} · {shortDateTime(stored.createdAt)} · Suggestions only: a clinician reviews and approves every plan
            change.
          </p>
        ) : summary ? (
          <p className="text-sm text-text-muted">
            {summary.model} · week of {formatDay(summary.weekStart)} · {summary.source === 'llm' ? 'generated' : 'pre-generated'}{' '}
            {shortDateTime(summary.createdAt)}
          </p>
        ) : undefined
      }
    >
      {generating && !stored ? (
        <Spinner label={`Asking Gemma about ${firstName}… (this can take up to a minute)`} className="text-text-muted" />
      ) : stored ? (
        <PlanView stored={stored} firstName={firstName} />
      ) : (
        <div className="space-y-2">
          {summary && <p className="max-w-prose text-lg leading-relaxed text-text">{summary.text}</p>}
          <p className="text-base text-text-muted">
            Press <b>Generate AI plan</b> for where {firstName} is struggling, their current baseline, and suggested exercises from Gemma.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </Card>
  );
}

function PlanView({ stored, firstName }: { stored: StoredPlan; firstName: string }) {
  const { plan, baseline } = stored;
  return (
    <div className="space-y-6">
      {plan?.summary && <p className="max-w-prose text-lg leading-relaxed text-text">{plan.summary}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. Where the patient is struggling */}
        <section aria-label="Where the patient is struggling" className="rounded-card border border-warning/50 bg-warning-soft p-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-text">
            <TriangleAlert className="h-5 w-5 text-warning" aria-hidden />
            Where {firstName} is struggling
          </h3>
          {plan?.struggling.length ? (
            <ul className="mt-3 space-y-2">
              {plan.struggling.map((s) => (
                <li key={s.area} className="text-base text-text">
                  <b>{s.area}.</b> {s.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-base text-text-muted">Gemma did not list any areas this time.</p>
          )}
        </section>

        {/* 2. Current baseline (measured numbers) */}
        <section aria-label="Current baseline" className="rounded-card border border-border bg-surface-2 p-4">
          <h3 className="text-lg font-semibold text-text">Current baseline</h3>
          {plan?.baselineNote && <p className="mt-1 text-base text-text-muted">{plan.baselineNote}</p>}
          <BaselineTable rows={baseline} />
        </section>
      </div>

      {/* 3. Suggested program */}
      {plan ? (
        <section aria-label="Suggested exercises">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-text">Suggested exercises</h3>
            {plan.program.sessionsPerWeek != null && (
              <Badge tone="neutral" dot={false}>
                {plan.program.sessionsPerWeek} sessions / week
              </Badge>
            )}
          </div>
          {plan.program.focus && <p className="mt-1 max-w-prose text-base text-text-muted">{plan.program.focus}</p>}
          <ol className="mt-3 grid gap-3 md:grid-cols-2">
            {plan.program.exercises.map((e, i) => (
              <li key={`${e.name}-${i}`} className="rounded-card border border-border bg-surface p-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-lg font-semibold text-primary">{i + 1}.</span>
                  <span className="text-lg font-semibold text-text">{e.name}</span>
                </div>
                {e.dose && <p className="mt-1 text-base font-medium text-text">{e.dose}</p>}
                {e.why && <p className="mt-1 text-base text-text-muted">{e.why}</p>}
              </li>
            ))}
          </ol>
          {plan.cautions.length > 0 && (
            <div className="mt-4 rounded-card border border-danger/40 bg-danger-soft p-4">
              <h4 className="text-base font-semibold text-text">Cautions</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-text">
                {plan.cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section aria-label="Gemma's answer">
          <h3 className="text-lg font-semibold text-text">Gemma's answer</h3>
          <p className="mt-1 whitespace-pre-wrap text-base text-text">{stored.raw}</p>
        </section>
      )}
    </div>
  );
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

function BaselineTable({ rows }: { rows: BaselineRow[] }) {
  if (!rows.length) return <p className="mt-2 text-base text-text-muted">Not enough session data yet.</p>;
  return (
    <table className="mt-3 w-full text-left text-base">
      <thead>
        <tr className="text-sm text-text-muted">
          <th className="pb-1 font-medium">Measure</th>
          <th className="pb-1 text-right font-medium">Now</th>
          <th className="pb-1 text-right font-medium">4 weeks ago</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const Icon = r.trend ? TREND_ICON[r.trend] : null;
          const good = r.trend === 'flat' || r.trend === null ? null : (r.trend === 'up') === r.higherIsBetter;
          return (
            <tr key={r.measure} className="border-t border-border">
              <td className="py-1.5 pr-2 text-text">{r.measure}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums text-text">
                <span className="inline-flex items-center gap-1">
                  {Icon && (
                    <Icon
                      aria-label={good === null ? 'about the same' : good ? 'better' : 'worse'}
                      className={cx('h-4 w-4', good === null ? 'text-text-muted' : good ? 'text-success' : 'text-danger')}
                    />
                  )}
                  {r.now}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums text-text-muted">{r.before ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
