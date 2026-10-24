// Loads the current patient's record, approved plan and sessions from the API, and keeps
// them fresh: polls every 5 s (while the tab is visible) so a plan the care team just
// approved shows up on its own.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import type { Patient, Plan, Session } from '../types';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { usePolling } from '../usePolling';
import { loadPatientSnapshot, summarize, type PatientSnapshot, type SessionSummary } from './api';

interface PatientDataValue {
  patient: Patient;
  plan: Plan | null;
  sessions: Session[];
  summaries: SessionSummary[];
  /** The approved plan is newer than the last one this device has seen. */
  newPlan: boolean;
  /** Mark the current plan as seen (hides the banner). */
  dismissNewPlan(): void;
  /** Re-fetch now (e.g. after saving a session). */
  refresh(): Promise<void>;
  /** Last polling error, cleared on the next success. */
  connectionError: string | null;
}

const Ctx = createContext<PatientDataValue | null>(null);

const planTime = (plan: Plan) => Date.parse(plan.approvedAt ?? plan.createdAt);

/**
 * Is `plan` new to this device? `seenAt` is the approval time of the last plan the patient saw here.
 * On a first visit (nothing seen yet) a plan counts as new when it was approved after the last session.
 */
export function isNewPlan(plan: Plan | null, seenAt: string | null, lastSessionStartedAt: string | null): boolean {
  if (!plan) return false;
  const approved = planTime(plan);
  if (Number.isNaN(approved)) return false;
  const since = seenAt ?? lastSessionStartedAt;
  return since === null || approved > Date.parse(since);
}

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
  const seenKey = `rehabtrack.${patientId}.planSeenAt`;
  const [seenAt, setSeenAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(seenKey);
    } catch {
      return null;
    }
  });

  const load = useCallback(async () => {
    try {
      setSnapshot(await loadPatientSnapshot(patientId));
      setLoadError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') {
        onUnknownPatient();
        return;
      }
      setLoadError(e instanceof Error ? e.message : 'Could not reach the care team');
    }
  }, [patientId, onUnknownPatient]);

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(async () => {
    if (!snapshot) return;
    try {
      setSnapshot(await loadPatientSnapshot(patientId));
      setConnectionError(null);
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : 'Lost connection');
    }
  });

  const value = useMemo<PatientDataValue | null>(() => {
    if (!snapshot) return null;
    const { patient, plan, sessions } = snapshot;
    const last = sessions[sessions.length - 1];
    return {
      patient,
      plan,
      sessions,
      summaries: summarize(sessions),
      newPlan: isNewPlan(plan, seenAt, last?.startedAt ?? null),
      dismissNewPlan: () => {
        if (!plan) return;
        const at = new Date(planTime(plan)).toISOString();
        setSeenAt(at);
        try {
          localStorage.setItem(seenKey, at);
        } catch {
          // Dismissed for this visit only.
        }
      },
      refresh: load,
      connectionError,
    };
  }, [snapshot, seenAt, seenKey, load, connectionError]);

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-center text-text">
        {loadError ? (
          <div className="max-w-md space-y-4 text-xl" role="alert">
            <p className="text-2xl font-semibold">Can't reach your care team right now.</p>
            <p className="text-text-muted">{loadError}</p>
            <Button size="xl" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <Spinner label="Loading your plan…" className="text-2xl text-text-muted" />
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
