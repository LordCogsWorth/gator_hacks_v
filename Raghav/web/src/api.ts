/**
 * All HTTP calls to Raghav's API go through this file.
 * Base URL comes from VITE_API_BASE (default http://localhost:8081/api).
 */

import type {
  Alert,
  ApiConfig,
  ApprovePlanBody,
  PatientDetailResponse,
  Plan,
  PatientSummary,
  Session,
  WatchDaily,
} from './types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8081/api';

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
    throw new Error(message);
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
