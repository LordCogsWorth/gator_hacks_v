import { RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dataMode, getWeeklySummary, refreshWeeklySummary } from '../../api';
import type { WeeklySummary } from '../../types';
import { Badge, Button, Card, ERROR_CLASS, Spinner } from '../../ui';
import { formatDay, shortDateTime } from '../dates';
import { errorMessage, isNotImplemented } from '../errors';

/** The two-sentence weekly summary, clearly marked as an AI draft for the clinician to check. */
export function WeeklySummaryCard({ patientId }: { patientId: string }) {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRegenerate = dataMode() === 'supabase';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getWeeklySummary(patientId)
      .then(
        (s) => !cancelled && setSummary(s),
        (e) => {
          if (cancelled) return;
          setSummary(null);
          if (!isNotImplemented(e)) setError(errorMessage(e, 'Could not load the summary'));
        },
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  async function onRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      setSummary(await refreshWeeklySummary(patientId));
    } catch (e) {
      setError(errorMessage(e, 'Could not regenerate the summary'));
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Card
      icon={<Sparkles />}
      title="Weekly summary"
      action={
        <>
          <Badge tone="info">AI draft for clinician review</Badge>
          {canRegenerate && (
            <Button variant="secondary" icon={<RefreshCw />} loading={regenerating} onClick={onRegenerate}>
              Regenerate
            </Button>
          )}
        </>
      }
      footer={
        summary ? (
          <p className="text-sm text-text-muted">
            {summary.model} · week of {formatDay(summary.weekStart)} · {summary.source === 'llm' ? 'generated' : 'pre-generated'}{' '}
            {shortDateTime(summary.createdAt)}
          </p>
        ) : undefined
      }
    >
      {loading ? (
        <Spinner label="Loading summary…" className="text-text-muted" />
      ) : summary ? (
        <p className="max-w-prose text-lg leading-relaxed text-text">{summary.text}</p>
      ) : (
        <p className="text-base text-text-muted">No summary for this week yet.</p>
      )}
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </Card>
  );
}
