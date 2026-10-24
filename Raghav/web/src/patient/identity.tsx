// Who the patient app is acting as. No login yet: ?as=<patientId> or the "Who are you?"
// picker on first visit, remembered in localStorage. Default suggestion: p-maria.
import { createContext, useContext, useEffect, useState } from 'react';
import { getPatients } from '../api';
import { BRAND_NAME, BrandMark } from '../Brand';
import type { PatientSummary } from '../types';

export const DEFAULT_PATIENT_ID = 'p-maria';
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

/** Fetches GET /patients for the pickers. */
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
      (e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not reach the API'),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return { patients, error, retry: () => setAttempt((a) => a + 1) };
}

/** First-visit screen: pick which patient this device belongs to. */
export function WhoAreYou({ onPick, notice }: { onPick: (id: string) => void; notice?: string }) {
  const { patients, error, retry } = usePatientList();
  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-10 text-neutral-50">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="font-brand text-xl font-semibold">{BRAND_NAME}</span>
        </div>
        <h1 className="text-4xl font-semibold">Who are you?</h1>
        {notice && <p className="rounded-xl border border-amber-700 bg-amber-950 p-4 text-lg text-amber-100">{notice}</p>}
        {error && (
          <div className="space-y-3 text-xl">
            <p>Can't reach your care team right now ({error}).</p>
            <button onClick={retry} className="min-h-[60px] rounded-xl bg-neutral-100 px-8 font-semibold text-neutral-950">
              Try again
            </button>
          </div>
        )}
        {!patients && !error && <p className="text-xl text-neutral-300">Loading…</p>}
        <ul className="space-y-3">
          {patients?.map((p) => (
            <li key={p.id}>
              <PatientChoice patient={p} onPick={onPick} />
            </li>
          ))}
        </ul>
        <p className="text-base text-neutral-500">Demo: there is no login yet. You can switch later in Settings.</p>
      </div>
    </div>
  );
}

export function PatientChoice({ patient, onPick, current }: { patient: PatientSummary; onPick: (id: string) => void; current?: boolean }) {
  return (
    <button
      onClick={() => onPick(patient.id)}
      disabled={current}
      className="flex min-h-[72px] w-full items-center justify-between gap-3 rounded-2xl border border-neutral-700 bg-neutral-900 px-5 text-left text-xl hover:bg-neutral-800 disabled:opacity-60"
    >
      <span className="font-semibold">{patient.name}</span>
      <span className="text-base text-neutral-400">
        {current ? 'You' : patient.id === DEFAULT_PATIENT_ID ? 'Default' : patient.id}
      </span>
    </button>
  );
}
