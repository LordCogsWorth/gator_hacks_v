// Who the patient app is acting as. No login yet: ?as=<patientId>, else the id remembered in localStorage,
// else p-maria. The "Who are you?" picker only shows with ?pick=1 or when the id is unknown.
import { ChevronRight } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { getPatients } from '../api';
import { BrandLockup } from '../Brand';
import type { PatientSummary } from '../types';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Spinner } from '../ui/Spinner';
import { useSpeakOnMount } from './voice/useVoice';

export const DEFAULT_PATIENT_ID: string = import.meta.env.VITE_DEFAULT_PATIENT_ID || 'p-maria';
const KEY = 'rehabtrack.patientId';

export function storedPatientId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberPatientId(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Not remembered; still used for this visit.
  }
}

/** The patient to act as on first render, or null to show the picker (?pick=1). */
export function resolvePatientId(params: URLSearchParams, stored: string | null): string | null {
  if (params.get('pick') === '1') return null;
  return params.get('as') || stored || DEFAULT_PATIENT_ID;
}

interface Identity {
  patientId: string;
  /** Switch to another patient (demo), or null to show the picker again. */
  switchPatient(id: string | null): void;
}

const Ctx = createContext<Identity | null>(null);
export const IdentityProvider = Ctx.Provider;

export function useIdentity() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIdentity must be used inside IdentityProvider');
  return v;
}

/** Fetches the patient list for the pickers. */
export function usePatientList() {
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    getPatients().then(
      (list) => {
        if (cancelled) return;
        // The default demo patient first, then by name.
        setPatients([...list].sort((a, b) => Number(b.id === DEFAULT_PATIENT_ID) - Number(a.id === DEFAULT_PATIENT_ID) || a.name.localeCompare(b.name)));
      },
      (e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load the patient list'),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return { patients, error, retry: () => setAttempt((a) => a + 1) };
}

/** "Who are you?": pick which patient this device belongs to. */
export function WhoAreYou({ onPick, notice }: { onPick: (id: string) => void; notice?: string }) {
  const { patients, error, retry } = usePatientList();
  useSpeakOnMount('Who are you? Tap your name.');
  return (
    <div className="min-h-screen bg-bg px-4 py-10 text-text">
      <div className="mx-auto max-w-xl space-y-6">
        <BrandLockup />
        <h1 className="text-4xl font-semibold">Who are you?</h1>
        {notice && <Banner tone="warning" title={notice} />}
        {error && (
          <Banner tone="danger" title="Can't reach your care team right now." action={<Button onClick={retry}>Try again</Button>}>
            {error}
          </Banner>
        )}
        {!patients && !error && <Spinner label="Loading…" />}
        <ul className="space-y-3">
          {patients?.map((p) => (
            <li key={p.id}>
              <PatientChoice patient={p} onPick={onPick} />
            </li>
          ))}
        </ul>
        <p className="text-base text-text-muted">Demo: there is no login yet. Add ?as=&lt;patient id&gt; to the address to switch later.</p>
      </div>
    </div>
  );
}

export function PatientChoice({ patient, onPick, current, compact }: { patient: PatientSummary; onPick: (id: string) => void; current?: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onPick(patient.id)}
      disabled={current}
      aria-current={current || undefined}
      className={cx(
        'flex min-h-tap w-full items-center justify-between gap-3 rounded-card border px-5 text-left transition-colors',
        compact ? 'text-lg' : 'text-xl',
        current ? 'border-primary/50 bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2',
      )}
    >
      <span className="font-semibold">{patient.name}</span>
      <span className="flex items-center gap-1 text-base text-text-muted">
        {current ? 'You' : patient.id === DEFAULT_PATIENT_ID ? 'Default' : patient.id}
        {!current && <ChevronRight className="h-5 w-5" aria-hidden />}
      </span>
    </button>
  );
}
