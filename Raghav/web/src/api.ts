/**
 * All HTTP calls to Raghav's API go through this file.
 * Base URL comes from VITE_API_BASE (default http://localhost:8081/api).
 */

import type {
  Alert,
  PatientDetailResponse,
  PatientSummary,
  Session,
  WatchDaily,
} from './types';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8081/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
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

export { BASE as API_BASE };
