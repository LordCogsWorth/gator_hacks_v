import { UserX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { getConfig, getPatient, getPatientSessions, getPatientWatch, getPatientWatchSessions } from '../api';
import type { ApiConfig, PatientDetailResponse, Session, WatchDaily, WatchSession } from '../types';
import { Badge, Banner, Button, EmptyState, PageHeader, Spinner } from '../ui';
import { usePolling } from '../usePolling';
import { daysBetween, todayISO } from './dates';
import { errorMessage } from './errors';
import { CurrentPlanCard, DEFAULT_MAX_PHASE, NoPlanCard, SuggestedPlanCard } from './PlanCards';
import { AlertsPanel } from './sections/AlertsPanel';
import { CameraCharts } from './sections/CameraCharts';
import { CheckinControl } from './sections/CheckinControl';
import { SessionList } from './sections/SessionList';
import { WatchCharts } from './sections/WatchCharts';
import { WatchSessionTable } from './sections/WatchSessionTable';
import { CameraAnalysisView, useCameraAnalyses } from '../ui/CameraAnalysisView';

/** Newest first; the latest is shown in full, older ones as compact rows. */
function CameraAnalysesList({ patientId }: { patientId: string }) {
  const rows = useCameraAnalyses(patientId);
  if (rows === null) return <p className="text-text-muted">Loading…</p>;
  if (rows.length === 0) return <p className="text-text-muted">No camera analyses yet. They appear when the patient clicks Analyze during a session.</p>;
  return (
    <div className="space-y-4">
      {rows.map((a, i) => (
        <div key={a.id} className="rounded-card border border-border bg-surface p-4">
          <CameraAnalysisView a={a} compact={i > 0} />
        </div>
      ))}
    </div>
  );
}
import { WeeklySummaryCard } from './sections/WeeklySummaryCard';

interface PageData {
  detail: PatientDetailResponse;
  sessions: Session[];
  watch: WatchDaily[];
  watchSessions: WatchSession[];
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-semibold text-text">{title}</h2>
        {subtitle && <p className="text-base text-text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PageData | null>(null);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [justApprovedId, setJustApprovedId] = useState<string | null>(null);

  // Which patient is on screen, so a slow response for the previous one is dropped.
  const idRef = useRef(id);
  idRef.current = id;

  const load = useCallback(async (patientId: string) => {
    const [detail, sessions, watch, watchSessions] = await Promise.all([
      getPatient(patientId),
      getPatientSessions(patientId),
      getPatientWatch(patientId),
      // Optional series: the page works without it.
      getPatientWatchSessions(patientId).catch(() => [] as WatchSession[]),
    ]);
    if (idRef.current !== patientId) return;
    setData({ detail, sessions, watch, watchSessions });
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);
    setNotice(null);
    setJustApprovedId(null);
    load(id)
      .catch((e) => {
        if (!cancelled) setError({ message: errorMessage(e, 'Could not load this patient'), notFound: (e as { code?: string })?.code === 'not_found' });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, load]);

  // Phase targets for the symmetry chart. The page still works without them.
  useEffect(() => {
    getConfig().then(setConfig, () => setConfig(null));
  }, []);

  // Refresh every 5 s so new uploads and alerts show up during the demo.
  usePolling(async () => {
    if (!id || loading) return;
    try {
      await load(id);
      setPollError(null);
    } catch (e) {
      setPollError(errorMessage(e, 'Lost connection'));
    }
  });

  /** After a write: show the message and reload. The change is saved even if the reload fails. */
  async function afterChange(message?: string, approvedPlanId?: string) {
    if (message) setNotice(message);
    if (approvedPlanId !== undefined) setJustApprovedId(approvedPlanId);
    if (!id) return;
    try {
      await load(id);
      setPollError(null);
    } catch (e) {
      setPollError(errorMessage(e, 'Could not refresh'));
    }
  }

  if (loading) {
    return <Spinner label="Loading patient…" className="text-lg text-text-muted" />;
  }

  if (!data) {
    return (
      <EmptyState
        icon={<UserX />}
        title={error?.notFound ? 'Patient not found' : 'Could not load this patient'}
        action={
          <Button variant="secondary" to="/care">
            Back to patients
          </Button>
        }
      >
        {error?.notFound ? `There is no patient with id "${id}".` : error?.message}
      </EmptyState>
    );
  }

  const { detail, sessions, watch, watchSessions } = data;
  const { patient, openAlerts, approvedPlan, plan } = detail;
  const suggestedPlan = plan?.status === 'suggested' ? plan : null;
  const phaseTarget = config?.phaseTargets[String(patient.phase)] ?? null;
  const maxPhase = config?.maxPhase ?? DEFAULT_MAX_PHASE;
  const daysSinceStroke = daysBetween(patient.strokeDate, todayISO());

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ to: '/care', label: 'All patients' }}
        eyebrow="Patient"
        title={patient.name}
        meta={
          <>
            <Badge tone="neutral" dot={false}>
              Weak side: <span className="capitalize">{patient.weakSide}</span>
            </Badge>
            <Badge tone="primary" dot={false}>
              Phase {patient.phase}
            </Badge>
            <Badge tone="neutral" dot={false}>
              {daysSinceStroke >= 0 ? `Day ${daysSinceStroke} since stroke` : 'Stroke date in the future'}
            </Badge>
            {approvedPlan && (
              <Badge tone="neutral" dot={false}>
                Goal {approvedPlan.sessionsPerWeek} sessions / week
              </Badge>
            )}
          </>
        }
        actions={<CheckinControl patient={patient} onMoved={(m) => afterChange(m)} />}
      />

      {pollError && (
        <Banner tone="warning" title="Showing the last data we loaded">
          {pollError} Retrying every 5 seconds.
        </Banner>
      )}
      {notice && <Banner tone="success" title={notice} onDismiss={() => setNotice(null)} />}

      <AlertsPanel alerts={openAlerts} patient={patient} onChanged={(m) => afterChange(m)} />

      <WeeklySummaryCard
        patientId={patient.id}
        firstName={patient.name.split(' ')[0]}
        data={{ detail, sessions, watch, watchSessions }}
      />

      {suggestedPlan ? (
        <SuggestedPlanCard
          key={suggestedPlan.id}
          plan={suggestedPlan}
          approvedPlan={approvedPlan}
          patient={patient}
          maxPhase={maxPhase}
          onDone={afterChange}
        />
      ) : approvedPlan ? (
        <CurrentPlanCard
          key={approvedPlan.id}
          plan={approvedPlan}
          patient={patient}
          maxPhase={maxPhase}
          justApproved={approvedPlan.id === justApprovedId}
          onDone={afterChange}
        />
      ) : (
        <NoPlanCard />
      )}

      <Section title="Camera progress" subtitle="From the patient's webcam sessions">
        <CameraCharts sessions={sessions} patient={patient} phaseTarget={phaseTarget} />
      </Section>

      <Section title="Watch trends" subtitle="Daily Apple Watch data and watch exercise sessions">
        <WatchCharts watch={watch} watchSessions={watchSessions} patient={patient} />
      </Section>

      <Section title="Watch exercise rounds" subtitle="Every round recorded by the Apple Watch app">
        <WatchSessionTable rows={watchSessions} patient={patient} />
      </Section>

      <Section title="Camera analyses" subtitle="Every Analyze run from the patient's camera: arm raise, joint ranges, likely weak muscles">
        <CameraAnalysesList patientId={patient.id} />
      </Section>

      <Section title="Sessions">
        <SessionList sessions={sessions} patientId={patient.id} />
      </Section>
    </div>
  );
}
