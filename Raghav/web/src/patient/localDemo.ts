// Demo-only, not yet backed by the API.
//
// Messages, physician connections and profile extras (phone, gender) live in this
// browser's localStorage, per patient. The physician list is hardcoded; the default
// physician is Dr. Chen, the clinician who approves plans in the API seed.
// When the API gets these endpoints, replace this file and keep the function names.
import { useEffect, useState } from 'react';

export type Gender = 'female' | 'male' | 'other' | 'prefer_not';

export interface Profile {
  phone: string;
  gender: Gender;
}

export interface Physician {
  id: string;
  name: string;
  role: string;
  clinic: string;
  email: string;
}

/** A patient ↔ physician connection, like a friend request. The physician would accept it from the care dashboard. */
export interface PhysicianLink {
  physicianId: string;
  status: 'pending' | 'accepted';
  requestedAt: string;
  removed?: boolean;
}

export interface Message {
  id: string;
  physicianId: string;
  from: 'patient' | 'physician';
  text: string;
  sentAt: string;
}

const DAY = 86_400_000;
const daysFromNow = (n: number, hour = 10) => {
  const d = new Date(Date.now() + n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** Physician accounts on the care-team side. Patients find them by email. */
const PHYSICIANS: Physician[] = [
  { id: 'dr-chen', name: 'Dr. Lisa Chen', role: 'Physical therapist', clinic: 'Gainesville Rehab Center', email: 'lchen@rehabclinic.org' },
  { id: 'dr-patel', name: 'Dr. Anita Patel', role: 'Occupational therapist', clinic: 'Gainesville Rehab Center', email: 'apatel@rehabclinic.org' },
  { id: 'dr-okafor', name: 'Dr. James Okafor', role: 'Neurologist', clinic: 'UF Health Neurology', email: 'jokafor@ufhealth.org' },
];

const DEFAULT_LINKS: PhysicianLink[] = [{ physicianId: 'dr-chen', status: 'accepted', requestedAt: daysFromNow(-60) }];

const DEFAULT_PROFILE: Profile = { phone: '(352) 555-0142', gender: 'prefer_not' };

function seedMessages(patientId: string, firstName: string): Message[] {
  return [
    { id: `${patientId}-m1`, physicianId: 'dr-chen', from: 'physician', text: `Hi ${firstName}, I approved your exercise plan. Go at a comfortable pace.`, sentAt: daysFromNow(-14, 9) },
    { id: `${patientId}-m2`, physicianId: 'dr-chen', from: 'patient', text: 'Thank you. My shoulder felt a little sore after the arm raises.', sentAt: daysFromNow(-13, 18) },
    { id: `${patientId}-m3`, physicianId: 'dr-chen', from: 'physician', text: 'That is normal at first. Only lift as high as is comfortable, and tell me if the pain goes above 5.', sentAt: daysFromNow(-13, 19) },
    { id: `${patientId}-m4`, physicianId: 'dr-chen', from: 'physician', text: 'I look at your sessions between visits. Keep it up!', sentAt: daysFromNow(-2, 11) },
  ];
}

const key = (patientId: string, what: 'profile' | 'links' | 'messages') => `rehabtrack.${patientId}.${what}`;

// Keys from the standalone patient app (fake sessions, results and multi-MB replays). Drop them once
// so they can't fill this origin's storage quota.
try {
  Object.keys(localStorage)
    .filter((k) => /^rehabtrack\.(sessions|results|profile|links|messages|replay\..*)$/.test(k))
    .forEach((k) => localStorage.removeItem(k));
} catch {
  // Storage unavailable.
}

// Screens that show this data re-render when it changes.
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
export function useDataChanges() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(k: string, value: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(value));
  } catch {
    // Not saved; the change only lasts until the page reloads.
  }
  changed();
}

// --- Profile extras (name comes from the API) ---

export function getProfile(patientId: string): Profile {
  return { ...DEFAULT_PROFILE, ...read<Partial<Profile>>(key(patientId, 'profile'), {}) };
}

export function updateProfile(patientId: string, profile: Profile) {
  write(key(patientId, 'profile'), profile);
}

// --- Physicians: the patient sends a request; the physician accepts it on the care side. ---

export function getPhysician(id: string): Physician | undefined {
  return PHYSICIANS.find((p) => p.id === id);
}

export function findPhysicianByEmail(email: string): Physician | undefined {
  const e = email.trim().toLowerCase();
  return PHYSICIANS.find((p) => p.email.toLowerCase() === e);
}

/** Emails shown as a hint under "Add a physician" (everyone not connected by default). */
export const DEMO_PHYSICIAN_EMAILS = PHYSICIANS.filter((p) => !DEFAULT_LINKS.some((l) => l.physicianId === p.id)).map((p) => p.email);

export function getLinks(patientId: string): PhysicianLink[] {
  const local = read<PhysicianLink[]>(key(patientId, 'links'), []);
  const ids = new Set(local.map((l) => l.physicianId));
  return [...DEFAULT_LINKS.filter((l) => !ids.has(l.physicianId)), ...local].filter((l) => !l.removed);
}

function setLink(patientId: string, link: PhysicianLink) {
  const others = read<PhysicianLink[]>(key(patientId, 'links'), []).filter((l) => l.physicianId !== link.physicianId);
  write(key(patientId, 'links'), [...others, link]);
}

export function requestPhysician(patientId: string, physicianId: string) {
  setLink(patientId, { physicianId, status: 'pending', requestedAt: new Date().toISOString() });
}

export function removePhysician(patientId: string, physicianId: string) {
  setLink(patientId, { physicianId, status: 'pending', requestedAt: '', removed: true });
}

// --- Messages with connected physicians ---

export function getMessages(patient: { id: string; name: string }, physicianId: string): Message[] {
  const firstName = patient.name.split(/\s+/)[0] || patient.name;
  return [...seedMessages(patient.id, firstName), ...read<Message[]>(key(patient.id, 'messages'), [])]
    .filter((m) => m.physicianId === physicianId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

function addMessage(patientId: string, m: Omit<Message, 'id' | 'sentAt'>) {
  const msg: Message = { ...m, id: crypto.randomUUID?.() ?? String(Date.now()), sentAt: new Date().toISOString() };
  write(key(patientId, 'messages'), [...read<Message[]>(key(patientId, 'messages'), []), msg]);
}

export function sendMessage(patientId: string, physicianId: string, text: string) {
  addMessage(patientId, { physicianId, from: 'patient', text });
  // Until the care dashboard can reply, the physician sends a short automatic answer.
  window.setTimeout(() => {
    addMessage(patientId, { physicianId, from: 'physician', text: "Thanks for your message. I'll take a look and get back to you today." });
  }, 2500);
}
