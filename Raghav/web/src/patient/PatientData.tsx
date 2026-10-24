// Loads the current patient's record, approved plan and sessions from the API, and keeps
// them fresh: polls every 5 s (while the tab is visible) so a plan the care team just
// approved shows up on its own.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import type { Patient, Plan, Session } from '../types';
import { usePolling } from '../usePolling';
import { loadPatientSnapshot, summarize, type PatientSnapshot, type SessionSummary } from './api';

interface PatientDataValue {
  patient: Patient;
  plan: Plan | null;
  sessions: Session[];
  summaries: SessionSummary[];
  /** A different approved plan than the one shown before arrived (or was approved since the last session). */
  newPlan: boolean;
  dismissNewPlan(): void;
  /** Re-fetch now (e.g. after saving a session). */
  refresh(): Promise<void>;
  /** Last polling error, cleared on the next success. */
  connectionError: string | null;
}

const Ctx = createContext<PatientDataValue | null>(null);

export function PatientDataProvider({
  patientId,
  children,
  onUnknownPatient,
}: {
  patientId: string;
  children: ReactNode;
  onUnknownPatient: () => void;
}) {
  const [snapshot, setSnapshot] = useState<PatientSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [livePlanId, setLivePlanId] = useState<string | null>(null);
  // The banner stays dismissed for that plan on this device.
  const dismissedKey = `rehabtrack.${patientId}.dismissedPlan`;
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(dismissedKey);
    } catch {
      return null;
    }
  });
  const seenPlanId = useRef<string | null | undefined>(undefined);

  const apply = useCallback((s: PatientSnapshot) => {
    const planId = s.plan?.id ?? null;
    // A different approved plan than the one already on screen = the care team approved a new one.
    if (seenPlanId.current !== undefined && planId && planId !== seenPlanId.current) setLivePlanId(planId);
    seenPlanId.current = planId;
    setSnapshot(s);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await loadPatientSnapshot(patientId));
      setLoadError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.message === 'Patient not found') {
        onUnknownPatient();
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'Could not reach the care team');
    }
  }, [patientId, apply, onUnknownPatient]);

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(async () => {
    if (!snapshot) return;
    try {
      apply(await loadPatientSnapshot(patientId));
      setConnectionError(null);
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : 'Lost connection');
    }
  });

  const value = useMemo<PatientDataValue | null>(() => {
    if (!snapshot) return null;
    const { patient, plan, sessions } = snapshot;
    const last = sessions[sessions.length - 1];
    const approvedAt = plan ? plan.approvedAt ?? plan.createdAt : null;
    const approvedSinceLastSession = !!plan && !!approvedAt && (!last || approvedAt > last.startedAt);
    return {
      patient,
      plan,
      sessions,
      summaries: summarize(sessions),
      newPlan: !!plan && plan.id !== dismissedPlanId && (plan.id === livePlanId || approvedSinceLastSession),
      dismissNewPlan: () => {
        const id = plan?.id ?? null;
        setDismissedPlanId(id);
        try {
          if (id) localStorage.setItem(dismissedKey, id);
        } catch {
          // Dismissed for this visit only.
        }
      },
      refresh: load,
      connectionError,
    };
  }, [snapshot, dismissedPlanId, dismissedKey, livePlanId, load, connectionError]);

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-center text-neutral-50">
        {loadError ? (
          <div className="max-w-md space-y-4 text-xl">
            <p className="text-2xl font-semibold">Can't reach your care team right now.</p>
            <p className="text-neutral-400">{loadError}</p>
            <button
              onClick={() => void load()}
              className="min-h-[60px] rounded-xl bg-neutral-100 px-8 text-xl font-semibold text-neutral-950"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="text-2xl text-neutral-300">Loading your plan…</p>
        )}
      </div>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePatientData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePatientData must be used inside PatientDataProvider');
  return v;
}
