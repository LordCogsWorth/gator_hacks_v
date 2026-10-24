/**
 * The UI's only data entry point (CONVERGENCE_PLAN §6.1). UI code imports from here, never from data/*.
 * Behind it: data/index.ts picks LocalSource (offline, in-browser) or SupabaseSource. Writes are validated
 * (data/validate.ts), applied by the source, then the rules engine runs for the patient (runRules).
 */

import type {
  Alert,
  ApiConfig,
  ApprovePlanBody,
  DataMode,
  Exercise,
  Patient,
  PatientDetailResponse,
  PatientSummary,
  Plan,
  ReplayFile,
  ReplaySummary,
  ReplayUploadResponse,
  SavePlanBody,
  Session,
  SessionUploadBody,
  SessionUploadResponse,
  Side,
  WatchDaily,
  WatchDailyUpload,
  WatchSession,
  WeeklySummary,
} from './types';
import { invalid, notFound, notImplemented } from './data/errors';
import { dataMode as currentDataMode, getSource, onDataChange as subscribe } from './data/index';
import { enrichSessions, patientDetail, patientSummary, replaySummary, sortSummaries } from './data/derive';
import {
  EXERCISES,
  SIDES,
  assertValid,
  validateApproval,
  validateDismissedBy,
  validateReplay,
  validateSavePlan,
  validateSession,
  validateWatchDaily,
} from './data/validate';
import type { RuleResults } from './data/source';
import { evaluate } from './rules/engine';
import { API_CONFIG } from './rules/constants';
import { parseSynthPath, synthReplay } from './data/seed/replaySynth';

export { ApiError } from './data/errors';
export type { ApiErrorCode, FieldError } from './data/errors';
export { healthCheck, offlineDataUrl, switchToOfflineData } from './data/index';
export type { HealthResult } from './data/index';

/** Run the rules engine for one patient and write what it finds (deduped by the source). */
async function runRules(patientId: string, now = new Date()): Promise<RuleResults> {
  const source = getSource();
  const { alerts, plan } = evaluate(await source.loadSnapshot(patientId), now);
  if (alerts.length === 0 && !plan) return { alertsCreated: [], planSuggested: null };
  return source.applyRuleResults(patientId, alerts, plan);
}

/** After a write: the write already succeeded, so a rules failure is logged, not thrown. */
async function runRulesAfterWrite(patientId: string): Promise<RuleResults> {
  try {
    return await runRules(patientId);
  } catch (e) {
    console.warn(`[rehabtrack] rules for ${patientId} failed:`, e);
    return { alertsCreated: [], planSuggested: null };
  }
}

export async function getPatients(): Promise<PatientSummary[]> {
  const now = new Date();
  const snapshots = await getSource().loadAllSnapshots();
  return sortSummaries(snapshots.map((s) => patientSummary(s, now)));
}

export async function getPatient(id: string): Promise<PatientDetailResponse> {
  return patientDetail(await getSource().loadSnapshot(id));
}

/** Oldest first, with symmetry, compensation, per-exercise symmetry and replay keys. */
export async function getPatientSessions(id: string): Promise<Session[]> {
  return enrichSessions(await getSource().loadSnapshot(id));
}

/** Sorted by date. */
export async function getPatientWatch(id: string): Promise<WatchDaily[]> {
  const { watch } = await getSource().loadSnapshot(id);
  return [...watch].sort((a, b) => a.date.localeCompare(b.date));
}

/** The approved plan, or null when the care team hasn't approved one yet. */
export async function getApprovedPlan(id: string): Promise<Plan | null> {
  return (await getPatient(id)).approvedPlan ?? null;
}

/** Idempotent on body.clientKey: re-sending returns the saved session (and creates no new alerts). */
export async function postSession(body: SessionUploadBody): Promise<SessionUploadResponse> {
  const clean = assertValid(validateSession(body), 'Invalid session');
  const { session, results } = await getSource().insertSession({ ...clean, clientKey: clean.clientKey ?? undefined });
  const rules = await runRulesAfterWrite(session.patientId);
  return { session, results, alertsCreated: rules.alertsCreated, planSuggested: rules.planSuggested };
}

export async function uploadReplay(sessionId: string, replay: ReplayFile): Promise<ReplayUploadResponse> {
  const clean = assertValid(validateReplay(replay), 'Invalid replay');
  const source = getSource();
  const row = await source.putReplay(sessionId, clean, {
    sessionId,
    exercise: clean.exercise,
    side: clean.side,
    fps: clean.fps,
    frameCount: clean.frames.length,
    seconds: Math.round((clean.frames.length / clean.fps) * 10) / 10,
    warningCount: clean.warnings?.length ?? 0,
  });
  const replays = (await source.listReplays(sessionId)).map((r) => replaySummary(r).key);
  return { sessionId, replays, replay: replaySummary(row) };
}

export async function getSessionReplays(sessionId: string): Promise<ReplaySummary[]> {
  return (await getSource().listReplays(sessionId)).map(replaySummary);
}

/** One full ReplayFile. Seeded `synth:` replays are generated in the browser (no network, no storage). */
export async function getSessionReplay(sessionId: string, exercise: Exercise, side: Side): Promise<ReplayFile> {
  if (!EXERCISES.includes(exercise) || !SIDES.includes(side)) {
    throw invalid(`exercise must be one of ${EXERCISES.join(', ')} and side one of ${SIDES.join(', ')}`);
  }
  const source = getSource();
  const row = (await source.listReplays(sessionId)).find((r) => r.exercise === exercise && r.side === side);
  if (!row) throw notFound('Replay not found');
  const synth = parseSynthPath(row.path);
  return synth ? synthReplay(synth) : source.readReplay(row);
}

export async function acknowledgeAlert(id: string): Promise<Alert> {
  const alert = await getSource().ackAlert(id);
  await runRulesAfterWrite(alert.patientId);
  return alert;
}

export async function approvePlan(id: string, body: ApprovePlanBody): Promise<Plan> {
  const clean = assertValid(validateApproval(body), 'Invalid plan approval');
  const plan = await getSource().approvePlan(id, clean);
  await runRulesAfterWrite(plan.patientId);
  return plan;
}

export async function dismissPlan(id: string, dismissedBy?: string): Promise<Plan> {
  const by = assertValid(validateDismissedBy(dismissedBy ?? null), 'Invalid dismissal');
  const plan = await getSource().dismissPlan(id, by ?? undefined);
  await runRulesAfterWrite(plan.patientId);
  return plan;
}

/** Rule constants (no I/O). */
export function getConfig(): Promise<ApiConfig> {
  return Promise.resolve(API_CONFIG);
}

/** Apple Watch exercise sessions, newest first, max 50, no trace. */
export function getPatientWatchSessions(id: string): Promise<WatchSession[]> {
  return getSource().listWatchSessions(id);
}

/** Clinician edits the plan without a suggestion → a new approved plan (any open suggestion is dismissed). */
export async function savePlan(patientId: string, body: SavePlanBody): Promise<Plan> {
  const clean = assertValid(validateSavePlan(body), 'Invalid plan');
  const plan = await getSource().savePlan(patientId, clean);
  await runRulesAfterWrite(patientId);
  return plan;
}

/** Move the next check-in (YYYY-MM-DD, today … today+180). */
export function setNextCheckin(patientId: string, date: string): Promise<Patient> {
  return getSource().setNextCheckin(patientId, date);
}

/** Merge one day of watch data (Shortcut / demo panel), then run the rules. */
export async function submitWatchDaily(body: WatchDailyUpload): Promise<WatchDaily> {
  assertValid(validateWatchDaily(body), 'Invalid watch daily data');
  const row = await getSource().submitWatchDaily(body);
  await runRulesAfterWrite(row.patientId);
  return row;
}

/** Latest weekly summary, or null. */
export function getWeeklySummary(id: string): Promise<WeeklySummary | null> {
  return getSource().getWeeklySummary(id);
}

/** Regenerate via the Edge Function (Supabase mode only; throws not_implemented locally). */
export async function refreshWeeklySummary(id: string): Promise<WeeklySummary> {
  const source = getSource();
  if (!source.refreshWeeklySummary) throw notImplemented('Live summaries need Supabase mode');
  return source.refreshWeeklySummary(id);
}

/** Run the rules engine for one patient (used by the care-side 60 s sweep). */
export function evaluatePatient(id: string, now?: Date): Promise<{ alertsCreated: Alert[]; planSuggested: Plan | null }> {
  return runRules(id, now ?? new Date());
}

/** Local mode: reseed the in-browser demo data. Supabase mode: throws not_implemented (re-run seed.sql). */
export async function resetDemoData(): Promise<void> {
  const source = getSource();
  if (!source.reset) throw notImplemented('Supabase mode: re-run supabase/seed.sql to reset the demo data');
  await source.reset();
}

/** Which data source this window uses. */
export function dataMode(): DataMode {
  return currentDataMode();
}

/** Called after any data change (this tab, and other tabs in local mode). Returns an unsubscribe. */
export function onDataChange(cb: () => void): () => void {
  return subscribe(cb);
}
