/**
 * All HTTP calls to Raghav's API go through this file.
 * Base URL comes from VITE_API_BASE (default http://localhost:8081/api).
 */

import type {
  Alert,
  ApiConfig,
  ApprovePlanBody,
  Exercise,
  PatientDetailResponse,
  Plan,
  PatientSummary,
  ReplayFile,
  ReplaySummary,
  ReplayUploadResponse,
  Session,
  SessionUploadBody,
  SessionUploadResponse,
  Side,
  WatchDaily,
} from './types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8081/api';

/** An error answer from the API, with its HTTP status. (Network failures stay plain fetch errors.) */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export function getPatients() {
  return request<PatientSummary[]>('/patients');
}

export function getPatient(id: string) {
  return request<PatientDetailResponse>(`/patients/${id}`);
}

export function getPatientSessions(id: string) {
  return request<Session[]>(`/patients/${id}/sessions`);
}

export function getPatientWatch(id: string) {
  return request<WatchDaily[]>(`/patients/${id}/watch`);
}

/** Today's approved plan, or null when the care team hasn't approved one yet (404). */
export async function getApprovedPlan(id: string): Promise<Plan | null> {
  try {
    return await request<Plan>(`/patients/${id}/plan`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.message.startsWith('No approved plan')) return null;
    throw e;
  }
}

export function postSession(body: SessionUploadBody) {
  return request<SessionUploadResponse>('/sessions', { method: 'POST', body: JSON.stringify(body) });
}

export function uploadReplay(sessionId: string, replay: ReplayFile) {
  return request<ReplayUploadResponse>(`/sessions/${sessionId}/replay`, {
    method: 'POST',
    body: JSON.stringify(replay),
  });
}

export function getSessionReplays(sessionId: string) {
  return request<ReplaySummary[]>(`/sessions/${sessionId}/replays`);
}

export function getSessionReplay(sessionId: string, exercise: Exercise, side: Side) {
  return request<ReplayFile>(`/sessions/${sessionId}/replays/${exercise}/${side}`);
}

export function getOpenAlerts() {
  return request<Alert[]>('/alerts');
}

export function acknowledgeAlert(id: string) {
  return request<Alert>(`/alerts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ acknowledged: true }),
  });
}

export function approvePlan(id: string, body: ApprovePlanBody) {
  return request<Plan>(`/plans/${id}/approve`, { method: 'POST', body: JSON.stringify(body) });
}

export function dismissPlan(id: string, dismissedBy?: string) {
  return request<Plan>(`/plans/${id}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ dismissedBy }),
  });
}

// Rule constants rarely change, so fetch them once per page load.
let configPromise: Promise<ApiConfig> | null = null;
export function getConfig() {
  if (!configPromise) {
    configPromise = request<ApiConfig>('/config').catch((e) => {
      configPromise = null; // let the next caller retry
      throw e;
    });
  }
  return configPromise;
}

export { BASE as API_BASE };
