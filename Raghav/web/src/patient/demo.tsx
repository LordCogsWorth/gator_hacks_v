// Demo controls for the fake camera (only with ?demo=1, remembered for this browser tab):
// simulated symmetry %, simulated compensation %, and "Speed up demo" (also remembered per patient for the tab).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { tracker } from '../camera';
import { usePatientData } from './PatientData';

const KEY = 'rehabtrack.demo';
const SPEED_UP = 4; // tracker clock ×4: ≈ 1 minute for a 3-exercise session
const DEFAULT_COMPENSATION = 10;

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

type Settings = { symmetryPct: number; compensationPct: number; speedUp: boolean };

export function DemoProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { patient, summaries } = usePatientData();
  const settingsKey = `${KEY}.${patient.id}`;
  const [state, setState] = useState<Settings>(() => {
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

/** Collapsible panel at the bottom of every patient screen (only with ?demo=1). */
export function DemoPanel() {
  const demo = useDemo();
  const { summaries } = usePatientData();
  if (!demo.enabled) return null;
  const latest = [...summaries].reverse().find((s) => s.average !== null)?.average ?? null;

  return (
    <details className="mt-8 rounded-2xl border border-dashed border-neutral-600 bg-neutral-900 px-5 py-4 text-base text-neutral-300">
      <summary className="min-h-[44px] cursor-pointer pt-2 text-lg font-semibold text-neutral-400">Demo controls</summary>
      <div className="mt-4 space-y-5">
        <label className="block">
          <span className="font-semibold text-neutral-100">Simulated symmetry: {demo.symmetryPct}%</span>
          <span className="text-neutral-400"> (weak-arm reach ÷ healthy; latest on file {latest ?? '—'}%)</span>
          <input
            type="range"
            min={10}
            max={100}
            value={demo.symmetryPct}
            onChange={(e) => demo.set({ symmetryPct: Number(e.target.value) })}
            className="mt-2 block w-full accent-neutral-100"
          />
        </label>
        <label className="block">
          <span className="font-semibold text-neutral-100">Simulated compensation: {demo.compensationPct}%</span>
          <span className="text-neutral-400"> (weak-arm reps with a lean or shoulder hike; over 50% raises an alert)</span>
          <input
            type="range"
            min={0}
            max={100}
            value={demo.compensationPct}
            onChange={(e) => demo.set({ compensationPct: Number(e.target.value) })}
            className="mt-2 block w-full accent-neutral-100"
          />
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={demo.speedUp}
            onChange={(e) => demo.set({ speedUp: e.target.checked })}
            className="h-6 w-6 accent-neutral-100"
          />
          <span className="font-semibold text-neutral-100">Speed up demo</span>
          <span className="text-neutral-400">(≈ 1 minute per session)</span>
        </label>
        <p className="text-sm text-neutral-500">
          Fake camera: values are simulated and change live. Below about 80% (forward reach) and 70% (hand open) the weak arm
          is kept just high enough for reps to count. Switch patient in Settings ·{' '}
          <Link to="/care" className="underline">
            Care dashboard
          </Link>
        </p>
      </div>
    </details>
  );
}
