import { useEffect } from 'react';
import { evaluatePatient, getPatients, getPatientSessions, getPatientWatch } from '../api';
import { todayISO } from './dates';
import { createRulesSweep, hashString, type RulesSweep } from './rulesSweep';

export const SWEEP_INTERVAL_MS = 60_000;

async function dataFingerprint(patientId: string): Promise<string> {
  const [sessions, watch] = await Promise.all([getPatientSessions(patientId), getPatientWatch(patientId)]);
  const last = sessions[sessions.length - 1];
  return `${sessions.length}:${last?.id ?? ''}:${last?.endedAt ?? ''}|${watch.length}:${hashString(JSON.stringify(watch))}`;
}

// One sweeper per page load, so its memory of what was already evaluated survives remounts.
let shared: RulesSweep | null = null;
function sharedSweep(): RulesSweep {
  shared ??= createRulesSweep({
    listPatientIds: async () => (await getPatients()).map((p) => p.id),
    fingerprint: dataFingerprint,
    evaluate: (id) => evaluatePatient(id),
    today: () => todayISO(),
  });
  return shared;
}

/**
 * Runs the rules engine for every patient on mount and every 60 s while the tab is visible, so watch
 * rows that arrived with no app open (iPhone Shortcut) still raise alerts. Patients whose sessions and
 * watch data haven't changed since the last pass are skipped.
 */
export function useRulesSweep(intervalMs = SWEEP_INTERVAL_MS) {
  useEffect(() => {
    const sweep = sharedSweep();
    const tick = () => {
      if (!document.hidden && !sweep.disabled) void sweep.run();
    };
    tick();
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs]);
}
