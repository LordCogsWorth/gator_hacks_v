// Demo controls (only with ?demo=1, remembered for this browser tab): a floating panel, bottom-left, with
// a patient switcher, "Reset demo data" (local data only), simulated Shortcut (watch) uploads, and the fake
// camera's simulated symmetry %, compensation % and "Speed up demo" (remembered per patient for the tab).
import { FlaskConical, HeartPulse, RotateCcw, Sun, TriangleAlert, X } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, dataMode, getPatientWatch, resetDemoData, submitWatchDaily } from '../api';
import { tracker } from '../camera';
import type { WatchDailyUpload } from '../types';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { PatientChoice, useIdentity, usePatientList } from './identity';
import { usePatientData } from './PatientData';

const KEY = 'rehabtrack.demo';
const SPEED_UP = 4; // tracker clock ×4: ≈ 1 minute for a 3-exercise session
const DEFAULT_COMPENSATION = 10;
const DEFAULT_RESTING_HR = 68;

export function demoEnabled(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberDemo(on: boolean) {
  try {
    if (on) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Not remembered; ?demo=1 works for this page load only.
  }
}

interface DemoValue {
  enabled: boolean;
  symmetryPct: number;
  compensationPct: number;
  speedUp: boolean;
  /** Shorter countdowns and pauses between rounds (demo speed-up on). */
  fast: boolean;
  set(patch: Partial<Pick<DemoValue, 'symmetryPct' | 'compensationPct' | 'speedUp'>>): void;
}

const Ctx = createContext<DemoValue | null>(null);

type DemoOptions = { symmetryPct: number; compensationPct: number; speedUp: boolean };

export function DemoProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { patient, summaries } = usePatientData();
  const settingsKey = `${KEY}.${patient.id}`;
  const [state, setState] = useState<DemoOptions>(() => {
    const latest = [...summaries].reverse().find((s) => s.average !== null)?.average ?? 70;
    const defaults = { symmetryPct: latest, compensationPct: DEFAULT_COMPENSATION, speedUp: true };
    try {
      return { ...defaults, ...JSON.parse(sessionStorage.getItem(settingsKey) ?? '{}') };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(settingsKey, JSON.stringify(state));
    } catch {
      // Not remembered across reloads.
    }
  }, [settingsKey, state]);

  // Drive the fake tracker (a real tracker has no setDemoOptions). Without ?demo=1 it uses its defaults.
  useEffect(() => {
    tracker.setDemoOptions?.(
      enabled
        ? { weakSide: patient.weakSide, symmetryPct: state.symmetryPct, compensationPct: state.compensationPct, speed: state.speedUp ? SPEED_UP : 1 }
        : { weakSide: patient.weakSide, symmetryPct: undefined, compensationPct: undefined, speed: 1 },
    );
  }, [enabled, patient.weakSide, state]);

  const value: DemoValue = {
    enabled,
    ...state,
    fast: enabled && state.speedUp,
    set: (patch) => setState((s) => ({ ...s, ...patch })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDemo must be used inside DemoProvider');
  return v;
}

/** Local calendar date, YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Preset = 'normal' | 'hr' | 'fall';

/** The Shortcut upload for a preset. `baselineHr` is the patient's usual resting heart rate. */
export function shortcutUpload(preset: Preset, patientId: string, date: string, baselineHr: number): WatchDailyUpload {
  const base = { patientId, date };
  if (preset === 'hr') return { ...base, restingHr: baselineHr + 12 };
  if (preset === 'fall') return { ...base, falls: 1 };
  return {
    ...base,
    steps: 4200,
    exerciseMin: 25,
    standHr: 9,
    restingHr: baselineHr,
    bpSys: 124,
    bpDia: 78,
    falls: 0,
    walkingSteadiness: 72,
  };
}

const PRESETS: { id: Preset; label: string; icon: ReactNode }[] = [
  { id: 'normal', label: 'Normal day', icon: <Sun /> },
  { id: 'hr', label: 'Resting HR +12', icon: <HeartPulse /> },
  { id: 'fall', label: 'Fall', icon: <TriangleAlert /> },
];

type Status = { tone: 'ok' | 'error'; text: string } | null;

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'not_implemented') return 'Not available with this data source yet.';
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/** Mean resting HR of the days before today (the rule's baseline), or a typical value. */
async function baselineRestingHr(patientId: string, today: string): Promise<number> {
  try {
    const days = (await getPatientWatch(patientId)).filter((d) => d.date < today && d.restingHr != null).slice(-7);
    if (!days.length) return DEFAULT_RESTING_HR;
    return Math.round(days.reduce((sum, d) => sum + d.restingHr!, 0) / days.length);
  } catch {
    return DEFAULT_RESTING_HR;
  }
}

/** Floating panel, bottom-left of every patient screen (only with ?demo=1). */
export function DemoPanel() {
  const demo = useDemo();
  const { patient, summaries, refresh } = usePatientData();
  const { switchPatient } = useIdentity();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  if (!demo.enabled) return null;
  const latest = [...summaries].reverse().find((s) => s.average !== null)?.average ?? null;

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    setStatus(null);
    try {
      setStatus({ tone: 'ok', text: await fn() });
    } catch (e) {
      setStatus({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const simulate = (preset: Preset) =>
    run(preset, async () => {
      const today = localDate();
      const body = shortcutUpload(preset, patient.id, today, await baselineRestingHr(patient.id, today));
      await submitWatchDaily(body);
      void refresh();
      const what = preset === 'hr' ? `resting HR ${body.restingHr} bpm` : preset === 'fall' ? 'a fall' : 'a normal day';
      return `Sent ${what} for ${today}. Check /care for alerts.`;
    });

  const reset = () =>
    run('reset', async () => {
      await resetDemoData();
      await refresh();
      return 'Demo data reset.';
    });

  if (!open) {
    return (
      <div className="fixed bottom-24 left-3 z-50 lg:bottom-4 lg:left-4">
        <Button variant="secondary" icon={<FlaskConical />} onClick={() => setOpen(true)} aria-expanded={false} className="shadow-raised">
          Demo
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-label="Demo controls"
      className="fixed bottom-24 left-3 z-50 max-h-[calc(100vh-8rem)] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-card border border-dashed border-text-muted/50 bg-surface p-4 text-base text-text shadow-modal lg:bottom-4 lg:left-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FlaskConical className="h-5 w-5" aria-hidden /> Demo controls
        </h2>
        <Button variant="ghost" icon={<X />} onClick={() => setOpen(false)} aria-label="Close demo controls" aria-expanded />
      </div>

      <div className="mt-3 space-y-5">
        <PatientSwitcher
          currentId={patient.id}
          onPick={(id) => {
            switchPatient(id);
            navigate('/patient');
          }}
        />

        <div>
          <h3 className="font-semibold">Simulate Shortcut upload (today)</h3>
          <div className="mt-2 grid gap-2">
            {PRESETS.map((p) => (
              <Button key={p.id} variant="secondary" icon={p.icon} loading={busy === p.id} disabled={busy !== null} onClick={() => void simulate(p.id)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {dataMode() === 'local' && (
          <Button variant="secondary" icon={<RotateCcw />} loading={busy === 'reset'} disabled={busy !== null} fullWidth onClick={() => void reset()}>
            Reset demo data
          </Button>
        )}

        {status && (
          <p role="status" className={cx('rounded-control border px-3 py-2', status.tone === 'ok' ? 'border-success/50 bg-success-soft' : 'border-danger/50 bg-danger-soft')}>
            {status.text}
          </p>
        )}

        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="font-semibold">Fake camera</h3>
          <label className="block">
            <span className="font-semibold">Simulated symmetry: {demo.symmetryPct}%</span>
            <span className="text-text-muted"> (weak-arm reach ÷ healthy; latest on file {latest ?? '—'}%)</span>
            <input
              type="range"
              min={10}
              max={100}
              value={demo.symmetryPct}
              onChange={(e) => demo.set({ symmetryPct: Number(e.target.value) })}
              className="mt-2 block min-h-tap w-full accent-primary"
            />
          </label>
          <label className="block">
            <span className="font-semibold">Simulated compensation: {demo.compensationPct}%</span>
            <span className="text-text-muted"> (weak-arm reps with a lean or shoulder hike; over 50% raises an alert)</span>
            <input
              type="range"
              min={0}
              max={100}
              value={demo.compensationPct}
              onChange={(e) => demo.set({ compensationPct: Number(e.target.value) })}
              className="mt-2 block min-h-tap w-full accent-primary"
            />
          </label>
          <Button variant="secondary" fullWidth aria-pressed={demo.speedUp} onClick={() => demo.set({ speedUp: !demo.speedUp })}>
            Speed up demo: {demo.speedUp ? 'on' : 'off'} (≈ 1 minute per session)
          </Button>
          <p className="text-sm text-text-muted">
            Values are simulated and change live. Below about 85% (forward reach) and 70% (hand open) the weak arm is kept just high enough for reps to
            count.
          </p>
        </div>

        <Button variant="ghost" href="/care" target="_blank" fullWidth>
          Open the care dashboard
        </Button>
      </div>
    </section>
  );
}

function PatientSwitcher({ currentId, onPick }: { currentId: string; onPick: (id: string) => void }) {
  const { patients, error, retry } = usePatientList();
  return (
    <div>
      <h3 className="font-semibold">Switch patient</h3>
      {error ? (
        <div className="mt-2 flex items-center gap-2 text-text-muted">
          Could not load patients.
          <Button variant="ghost" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {(patients ?? []).map((p) => (
            <li key={p.id}>
              <PatientChoice patient={p} onPick={onPick} current={p.id === currentId} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
