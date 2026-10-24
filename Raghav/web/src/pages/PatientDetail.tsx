import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  acknowledgeAlert,
  getConfig,
  getPatient,
  getPatientSessions,
  getPatientWatch,
} from '../api';
import { CurrentPlanCard, SuggestedPlanCard } from '../components/PlanCards';
import { usePolling } from '../usePolling';
import type { Alert, ApiConfig, PatientDetailResponse, Session, WatchDaily } from '../types';
import { ALERT_LABELS, EXERCISE_LABELS, type Exercise } from '../types';

const EXERCISES: Exercise[] = ['arm_raise', 'forward_reach', 'hand_open'];
const CHART_COLORS = ['#0f766e', '#0369a1', '#b45309'];

function shortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-foam bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-xl font-semibold text-ink">{title}</h2>
      <div className="h-64 w-full">{children}</div>
    </section>
  );
}

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PatientDetailResponse | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [watch, setWatch] = useState<WatchDaily[]>([]);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [justApprovedId, setJustApprovedId] = useState<string | null>(null);

  // Which patient is on screen, so a slow response for the previous one is dropped.
  const idRef = useRef(id);
  idRef.current = id;

  const load = useCallback(async (patientId: string) => {
    const [d, s, w] = await Promise.all([
      getPatient(patientId),
      getPatientSessions(patientId),
      getPatientWatch(patientId),
    ]);
    if (idRef.current !== patientId) return null;
    setDetail(d);
    setSessions(s);
    setWatch(w);
    return d;
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    setJustApprovedId(null);
    (async () => {
      try {
        await load(id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, load]);

  // Phase targets for the chart. The page still works without them.
  useEffect(() => {
    getConfig().then(setConfig, () => setConfig(null));
  }, []);

  // Refresh every 5s so new uploads and alerts show up during the demo.
  usePolling(async () => {
    if (!id || loading) return;
    try {
      await load(id);
      setPollError(null);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : 'Lost connection to the API');
    }
  });

  async function onAcknowledge(alert: Alert) {
    setAcking(alert.id);
    try {
      await acknowledgeAlert(alert.id);
      if (id) await load(id);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : 'Could not acknowledge alert');
    } finally {
      setAcking(null);
    }
  }

  async function onPlanDone(message: string, approvedPlanId?: string) {
    setNotice(message);
    setJustApprovedId(approvedPlanId ?? null);
    if (!id) return;
    // The change is already saved; a failed refresh shouldn't look like a failed approval.
    try {
      await load(id);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : 'Could not refresh');
    }
  }

  if (loading) {
    return <p className="text-lg text-slate-600">Loading patient…</p>;
  }

  if (error && !detail) {
    return (
      <div className="rounded-lg border border-amber-300 bg-alert-soft px-5 py-4 text-lg">
        <p className="font-semibold text-alert">{error}</p>
        <Link to="/" className="mt-2 inline-block text-teal-deep underline">
          Back to patients
        </Link>
      </div>
    );
  }

  if (!detail) return null;

  const { patient, openAlerts, approvedPlan, plan } = detail;
  const suggestedPlan = plan?.status === 'suggested' ? plan : null;
  const phaseTarget = config?.phaseTargets[String(patient.phase)];

  // Symmetry over time per exercise (for line chart)
  const symmetryRows = sessions.map((s) => {
    const row: Record<string, string | number | null> = {
      date: shortDate(s.startedAt),
      startedAt: s.startedAt,
    };
    for (const ex of EXERCISES) {
      const v = s.symmetryByExercise?.[ex];
      row[ex] = v != null ? Math.round(v) : null;
    }
    return row;
  });

  const checkinRows = sessions.map((s) => ({
    date: shortDate(s.startedAt),
    pain: s.pain,
    tiredness: s.tiredness,
    compensation: s.compensation != null ? Math.round(s.compensation) : null,
  }));

  const watchRows = watch.map((w) => ({
    date: shortDate(w.date + 'T12:00:00.000Z'),
    restingHr: w.restingHr,
    bpSys: w.bpSys,
    steps: w.steps,
    weakArmActiveMin: w.weakArmActiveMin,
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="text-base text-teal-deep hover:underline">
          ← All patients
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-ink">{patient.name}</h1>
            <p className="mt-1 text-lg text-slate-600">
              Weak side <span className="font-semibold capitalize text-ink">{patient.weakSide}</span>
              {' · '}Phase {patient.phase}
              {' · '}Next check-in{' '}
              <span className="font-semibold text-ink">{patient.nextCheckin}</span>
            </p>
          </div>
          {approvedPlan && (
            <p className="rounded-lg bg-teal-soft px-4 py-2 text-base text-teal-deep">
              Plan: {approvedPlan.sessionsPerWeek} sessions / week · approved by{' '}
              {approvedPlan.approvedBy}
            </p>
          )}
        </div>
      </div>

      {pollError && (
        <p className="rounded-lg border border-amber-300 bg-alert-soft px-4 py-2 text-base text-alert">
          Can't reach the API ({pollError}). Showing the last data; retrying every 5 seconds.
        </p>
      )}

      {/* Alerts */}
      <section className="rounded-xl border border-foam bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-ink">Open alerts for care team</h2>
        {openAlerts.length === 0 ? (
          <p className="mt-3 text-lg text-slate-500">No open alerts.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {openAlerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-alert-soft/60 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-alert">
                    {ALERT_LABELS[a.type]}
                  </p>
                  <p className="mt-1 text-base text-slate-800">{a.detail}</p>
                </div>
                <button
                  type="button"
                  disabled={acking === a.id}
                  onClick={() => onAcknowledge(a)}
                  className="rounded-lg bg-white px-4 py-2 text-base font-semibold text-teal-deep shadow-sm ring-1 ring-foam hover:bg-mist disabled:opacity-60"
                >
                  {acking === a.id ? 'Saving…' : 'Acknowledge'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Plan: suggestion to review, else the plan in force */}
      {notice && (
        <p className="rounded-lg bg-teal-soft px-4 py-3 text-lg font-semibold text-teal-deep">{notice}</p>
      )}
      {suggestedPlan ? (
        <SuggestedPlanCard
          key={suggestedPlan.id}
          plan={suggestedPlan}
          approvedPlan={approvedPlan}
          patient={patient}
          onDone={onPlanDone}
        />
      ) : (
        approvedPlan && (
          <CurrentPlanCard plan={approvedPlan} justApproved={approvedPlan.id === justApprovedId} />
        )
      )}

      {/* Symmetry chart */}
      <ChartCard title="Symmetry % over time (weak ÷ healthy × 100)">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={symmetryRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
            <Tooltip />
            <Legend />
            {phaseTarget != null && (
              <ReferenceLine
                y={phaseTarget}
                stroke="#334155"
                strokeDasharray="6 4"
                label={{ value: `Phase ${patient.phase} target ${phaseTarget}%`, position: 'insideTopLeft', fill: '#334155', fontSize: 12 }}
              />
            )}
            {EXERCISES.map((ex, i) => (
              <Line
                key={ex}
                type="monotone"
                dataKey={ex}
                name={EXERCISE_LABELS[ex]}
                stroke={CHART_COLORS[i]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Compensation rate (% of weak-arm reps)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={checkinRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="compensation"
                name="Compensation"
                stroke="#b45309"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Pain (0–10) and tiredness (1–5)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={checkinRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pain" name="Pain" stroke="#be123c" strokeWidth={2} dot={false} />
              <Line
                type="monotone"
                dataKey="tiredness"
                name="Tiredness"
                stroke="#0369a1"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Resting heart rate (Watch)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={watchRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit=" bpm" width={56} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="restingHr"
                name="Resting HR"
                stroke="#0f766e"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Blood pressure — systolic (Watch)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={watchRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit=" mmHg" width={64} domain={[(min: number) => Math.floor((min - 10) / 10) * 10, (max: number) => Math.ceil((max + 5) / 10) * 10]} />
              <Tooltip />
              <ReferenceLine
                y={patient.bpLimitSys}
                stroke="#be123c"
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
                label={{ value: `Limit ${patient.bpLimitSys}`, position: 'insideTopLeft', fill: '#be123c', fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="bpSys"
                name="Systolic"
                stroke="#b45309"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Daily steps (Watch)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={watchRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={56} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="steps"
                name="Steps"
                stroke="#0369a1"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Weak-arm active minutes (Watch)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={watchRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit=" min" width={56} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="weakArmActiveMin"
                name="Weak-arm use"
                stroke="#0f766e"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
