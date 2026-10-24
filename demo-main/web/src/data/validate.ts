/**
 * Request-body validation (port of Raghav/api/validate.js). Ranges mirror the CHECK constraints and RPC checks
 * in supabase/migrations/0001_init.sql, so a body that passes here is accepted by both data sources.
 * Camera metrics outside the DB range are clamped (an outlier frame shouldn't lose a whole session).
 *
 * Each validator returns { errors, value }; `value` is only meaningful when errors is empty.
 * `assertValid` turns errors into ApiError('invalid').
 */
import { EXERCISES } from '../rules/constants';
import type {
  ApprovePlanBody,
  Exercise,
  ExerciseResult,
  PlanExercise,
  ReplayFile,
  SavePlanBody,
  Side,
  StopReason,
  WatchDaily,
} from '../types';
import { REPLAY_JOINTS } from '../types';
import { invalid, type FieldError } from './errors';

export { EXERCISES };
export const SIDES: Side[] = ['weak', 'healthy'];
export const STOP_REASONS: StopReason[] = ['pain', 'dizziness', 'other'];

export const REPLAY_FPS = 15;
export const REPLAY_MAX_SECONDS = 120;
export const REPLAY_MAX_FRAMES = REPLAY_FPS * REPLAY_MAX_SECONDS;
const REPLAY_WARNING_TYPES = ['lean', 'shoulder_hike'];
const MAX_FRAME_ERRORS = 5;

/** DB ranges for exercise_results; values outside are clamped. */
export const RESULT_RANGES = {
  bestValue: [0, 180],
  reps: [0, 200],
  secPerRep: [0, 120],
  smoothness: [0, 50],
  fatigue: [0, 5],
  trunkLeanMax: [0, 90],
  shoulderHikeMax: [0, 0.5],
  compRepPct: [0, 100],
} as const;
const RESULT_NUMBER_FIELDS = Object.keys(RESULT_RANGES) as (keyof typeof RESULT_RANGES)[];
const OPTIONAL_RESULT_RANGES = { reachCm: [0, 150], closedMin: [0, 100] } as const;

/** DB ranges for watch_daily. */
export const WATCH_RANGES = {
  steps: [0, 100000],
  exerciseMin: [0, 1440],
  standHr: [0, 24],
  restingHr: [25, 220],
  hrv: [0, 300],
  sleepHr: [0, 24],
  bpSys: [50, 260],
  bpDia: [30, 160],
  falls: [0, 50],
  walkingSteadiness: [0, 100],
  weakArmActiveMin: [0, 1440],
  useRatio: [0, 3],
} as const;
export type WatchField = keyof typeof WATCH_RANGES;
export const WATCH_NUMBER_FIELDS = Object.keys(WATCH_RANGES) as WatchField[];
/** The Shortcut sends 0 when there is no reading: 0 means "no data" for these. */
const ZERO_IS_MISSING: WatchField[] = ['restingHr', 'hrv', 'bpSys', 'bpDia', 'walkingSteadiness'];

/** Session duration limit (DB: ended_at - started_at < 3 hours). */
const MAX_SESSION_MS = 3 * 3_600_000 - 1000;
const MAX_TEXT = 80;

const MIN_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface Validation<T> {
  errors: FieldError[];
  value: T;
}

export function assertValid<T>(v: Validation<T>, what: string): T {
  if (v.errors.length > 0) {
    const first = v.errors[0];
    throw invalid(`${what}: ${first.field} ${first.message}`, v.errors);
  }
  return v.value;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** ISO-8601 string or epoch ms → normalised ISO string ("…Z"), or null. The rules sort these as strings. */
export function toIsoTimestamp(v: unknown): string | null {
  if (isFiniteNumber(v)) {
    if (v < MIN_EPOCH_MS || v > MAX_EPOCH_MS) return null;
    return new Date(v).toISOString();
  }
  if (typeof v === 'string' && ISO_PREFIX.test(v)) {
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) return null;
    return new Date(ms).toISOString();
  }
  return null;
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDateOnly(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_ONLY.test(v)) return false;
  const d = new Date(v + 'T00:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Local calendar date YYYY-MM-DD (the browser's "today"). */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

function checkText(errors: FieldError[], field: string, v: unknown, required: boolean): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (v !== undefined && v !== null && typeof v !== 'string') {
    errors.push({ field, message: 'must be a string' });
    return null;
  }
  if (!s) {
    if (required) errors.push({ field, message: 'is required (string)' });
    return null;
  }
  if (s.length > MAX_TEXT) {
    errors.push({ field, message: `must be at most ${MAX_TEXT} characters` });
    return null;
  }
  return s;
}

/** Optional whole number in [min, max]. null/undefined = not sent. */
function checkOptionalInt(errors: FieldError[], field: string, v: unknown, min: number, max: number): number | null {
  if (v === undefined || v === null) return null;
  if (!isFiniteNumber(v) || !Number.isInteger(v) || v < min || v > max) {
    errors.push({ field, message: `must be a whole number from ${min} to ${max}` });
    return null;
  }
  return v;
}

function checkRequiredInt(errors: FieldError[], field: string, v: unknown, min: number, max: number): number {
  if (v === undefined || v === null) {
    errors.push({ field, message: `is required (whole number ${min} to ${max})` });
    return min;
  }
  return checkOptionalInt(errors, field, v, min, max) ?? min;
}

// ---- sessions ----

export interface CleanSession {
  clientKey: string | null;
  patientId: string;
  startedAt: string;
  endedAt: string;
  pain: number | null;
  tiredness: number | null;
  stopReason: StopReason | null;
  results: ExerciseResult[];
}

/** postSession() body. results may be empty only with a stopReason (safety stop). */
export function validateSession(body: unknown): Validation<CleanSession> {
  const errors: FieldError[] = [];
  const empty: CleanSession = {
    clientKey: null, patientId: '', startedAt: '', endedAt: '', pain: null, tiredness: null, stopReason: null, results: [],
  };
  if (!isPlainObject(body)) return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: empty };

  if (typeof body.patientId !== 'string' || !body.patientId.trim()) {
    errors.push({ field: 'patientId', message: 'is required (string)' });
  }
  let clientKey: string | null = null;
  if (body.clientKey !== undefined && body.clientKey !== null) {
    if (typeof body.clientKey !== 'string' || body.clientKey.length > 64) {
      errors.push({ field: 'clientKey', message: 'must be a string of at most 64 characters' });
    } else {
      clientKey = body.clientKey.trim() || null;
    }
  }

  const startedAt = toIsoTimestamp(body.startedAt);
  if (!startedAt) errors.push({ field: 'startedAt', message: 'must be an ISO-8601 string or epoch milliseconds' });
  let endedAt = toIsoTimestamp(body.endedAt);
  if (!endedAt) errors.push({ field: 'endedAt', message: 'must be an ISO-8601 string or epoch milliseconds' });
  if (startedAt && endedAt) {
    const ms = Date.parse(endedAt) - Date.parse(startedAt);
    if (ms < 0) errors.push({ field: 'endedAt', message: 'is before startedAt' });
    // A tab left open for hours shouldn't lose the session: cap the duration like the DB requires.
    else if (ms > MAX_SESSION_MS) endedAt = new Date(Date.parse(startedAt) + MAX_SESSION_MS).toISOString();
  }

  const pain = checkOptionalInt(errors, 'pain', body.pain, 0, 10);
  const tiredness = checkOptionalInt(errors, 'tiredness', body.tiredness, 1, 5);

  let stopReason: StopReason | null = null;
  if (body.stopReason !== undefined && body.stopReason !== null) {
    if (STOP_REASONS.includes(body.stopReason as StopReason)) stopReason = body.stopReason as StopReason;
    else errors.push({ field: 'stopReason', message: `must be one of ${STOP_REASONS.join(', ')} when sent` });
  }

  const results: ExerciseResult[] = [];
  const minResults = stopReason ? 0 : 1;
  if (!Array.isArray(body.results) || body.results.length < minResults || body.results.length > 6) {
    errors.push({
      field: 'results',
      message: 'must be an array of 1 to 6 exercise results (0 to 6 when stopReason is given)',
    });
  } else {
    const seen = new Set<string>();
    body.results.forEach((r: unknown, i: number) => {
      const at = `results[${i}]`;
      if (!isPlainObject(r)) {
        errors.push({ field: at, message: 'must be an object' });
        return;
      }
      if (!EXERCISES.includes(r.exercise as Exercise)) {
        errors.push({ field: `${at}.exercise`, message: `must be one of ${EXERCISES.join(', ')}` });
      }
      if (!SIDES.includes(r.side as Side)) {
        errors.push({ field: `${at}.side`, message: `must be one of ${SIDES.join(', ')}` });
      }
      for (const f of RESULT_NUMBER_FIELDS) {
        if (!isFiniteNumber(r[f])) errors.push({ field: `${at}.${f}`, message: 'must be a finite number' });
      }
      if (isFiniteNumber(r.compRepPct) && (r.compRepPct < 0 || r.compRepPct > 100)) {
        errors.push({ field: `${at}.compRepPct`, message: 'must be from 0 to 100' });
      }
      for (const f of Object.keys(OPTIONAL_RESULT_RANGES) as (keyof typeof OPTIONAL_RESULT_RANGES)[]) {
        if (r[f] !== undefined && r[f] !== null && !isFiniteNumber(r[f])) {
          errors.push({ field: `${at}.${f}`, message: 'must be a finite number when sent' });
        }
      }
      // Two rows for the same exercise + side would make symmetry ambiguous.
      const key = `${String(r.exercise)}/${String(r.side)}`;
      if (seen.has(key)) errors.push({ field: at, message: `duplicate ${key} result` });
      seen.add(key);

      const clean: Record<string, unknown> = { exercise: r.exercise, side: r.side };
      for (const f of RESULT_NUMBER_FIELDS) {
        const [lo, hi] = RESULT_RANGES[f];
        const n = isFiniteNumber(r[f]) ? clamp(r[f] as number, lo, hi) : r[f];
        clean[f] = f === 'reps' && isFiniteNumber(n) ? Math.round(n) : n;
      }
      for (const f of Object.keys(OPTIONAL_RESULT_RANGES) as (keyof typeof OPTIONAL_RESULT_RANGES)[]) {
        if (isFiniteNumber(r[f])) {
          const [lo, hi] = OPTIONAL_RESULT_RANGES[f];
          clean[f] = clamp(r[f] as number, lo, hi);
        }
      }
      results.push(clean as unknown as ExerciseResult);
    });
  }

  return {
    errors,
    value: {
      clientKey,
      patientId: typeof body.patientId === 'string' ? body.patientId.trim() : '',
      startedAt: startedAt ?? '',
      endedAt: endedAt ?? '',
      pain,
      tiredness,
      stopReason,
      results,
    },
  };
}

// ---- watch daily ----

export type WatchFields = Partial<Record<WatchField, number>>;

/**
 * Number from a Shortcut body: JSON numbers or numeric strings (commas allowed, "1,234"). Blank → null.
 * Returns undefined when the value is not a number.
 */
function parseLooseNumber(v: unknown): number | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/,/g, '').trim();
  if (!s) return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * submitWatchDaily() body. `fields` holds only values that were actually sent (merge keeps the rest).
 * Like the RPC: 0 is "no reading" for resting HR, HRV, BP and walking steadiness; walking steadiness 0–1 is
 * scaled to 0–100; dates may be at most tomorrow (local).
 */
export function validateWatchDaily(
  body: unknown,
  today = localDate(),
): Validation<{ patientId: string; date: string; fields: WatchFields }> {
  const errors: FieldError[] = [];
  if (!isPlainObject(body)) {
    return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: { patientId: '', date: '', fields: {} } };
  }
  if (typeof body.patientId !== 'string' || !body.patientId.trim()) {
    errors.push({ field: 'patientId', message: 'is required (string)' });
  }
  if (!isValidDateOnly(body.date)) {
    errors.push({ field: 'date', message: 'must be a real date in YYYY-MM-DD form' });
  } else if (body.date > addDays(today, 1)) {
    errors.push({ field: 'date', message: `${body.date} is in the future` });
  }

  const fields: WatchFields = {};
  for (const f of WATCH_NUMBER_FIELDS) {
    let n = parseLooseNumber(body[f]);
    if (n === undefined) {
      errors.push({ field: f, message: 'must be a finite number' });
      continue;
    }
    if (n === null) continue;
    if (f === 'walkingSteadiness' && n > 0 && n <= 1) n = n * 100;
    if (n === 0 && ZERO_IS_MISSING.includes(f)) continue;
    const [lo, hi] = WATCH_RANGES[f];
    if (n < lo || n > hi) {
      errors.push({ field: f, message: `must be a number from ${lo} to ${hi}` });
      continue;
    }
    fields[f] = n;
  }

  return {
    errors,
    value: { patientId: typeof body.patientId === 'string' ? body.patientId.trim() : '', date: String(body.date ?? ''), fields },
  };
}

/** Merge a validated upload into the stored row: omitted fields keep their previous value. */
export function mergeWatchDaily(
  prev: WatchDaily | undefined,
  id: string,
  patientId: string,
  date: string,
  fields: WatchFields,
): WatchDaily {
  const row = { id: prev?.id ?? id, patientId, date } as WatchDaily;
  for (const f of WATCH_NUMBER_FIELDS) {
    row[f] = f in fields ? (fields[f] as number) : (prev?.[f] ?? null);
  }
  return row;
}

// ---- replays ----

/** uploadReplay() body (a ReplayFile). value keeps only contract fields. */
export function validateReplay(body: unknown): Validation<ReplayFile> {
  const errors: FieldError[] = [];
  if (!isPlainObject(body)) {
    return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: body as unknown as ReplayFile };
  }
  if (body.fps !== REPLAY_FPS) errors.push({ field: 'fps', message: `must be ${REPLAY_FPS}` });
  if (!EXERCISES.includes(body.exercise as Exercise)) {
    errors.push({ field: 'exercise', message: `must be one of ${EXERCISES.join(', ')}` });
  }
  if (!SIDES.includes(body.side as Side)) {
    errors.push({ field: 'side', message: `must be one of ${SIDES.join(', ')}` });
  }
  const joints = body.joints;
  if (
    !Array.isArray(joints) ||
    joints.length !== REPLAY_JOINTS.length ||
    joints.some((j, i) => j !== REPLAY_JOINTS[i])
  ) {
    errors.push({
      field: 'joints',
      message: `must be the ${REPLAY_JOINTS.length} joints in contract order: ${REPLAY_JOINTS.join(', ')}`,
    });
  }

  const frames = body.frames;
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > REPLAY_MAX_FRAMES) {
    errors.push({
      field: 'frames',
      message: `must be an array of 1 to ${REPLAY_MAX_FRAMES} frames (${REPLAY_FPS} fps × ${REPLAY_MAX_SECONDS} s)`,
    });
  } else {
    let frameErrors = 0;
    for (let f = 0; f < frames.length && frameErrors < MAX_FRAME_ERRORS; f++) {
      const frame = frames[f];
      const ok =
        Array.isArray(frame) &&
        frame.length === REPLAY_JOINTS.length &&
        frame.every((p) => Array.isArray(p) && p.length === 3 && p.every(isFiniteNumber));
      if (!ok) {
        errors.push({ field: `frames[${f}]`, message: `must be ${REPLAY_JOINTS.length} [x, y, z] triples of finite numbers` });
        frameErrors++;
      }
    }
  }

  const warnings = body.warnings;
  if (warnings !== undefined) {
    const frameCount = Array.isArray(frames) ? frames.length : 0;
    if (!Array.isArray(warnings)) {
      errors.push({ field: 'warnings', message: 'must be an array when sent' });
    } else {
      warnings.forEach((w: unknown, i: number) => {
        if (
          !isPlainObject(w) ||
          !Number.isInteger(w.frame) ||
          (w.frame as number) < 0 ||
          (w.frame as number) >= frameCount ||
          !REPLAY_WARNING_TYPES.includes(w.type as string)
        ) {
          errors.push({
            field: `warnings[${i}]`,
            message: `must be { frame: index of a frame, type: ${REPLAY_WARNING_TYPES.join(' | ')} }`,
          });
        }
      });
    }
  }

  return {
    errors,
    value: {
      fps: REPLAY_FPS,
      exercise: body.exercise as Exercise,
      side: body.side as Side,
      joints: Array.isArray(joints) ? (joints as string[]) : [],
      frames: (Array.isArray(frames) ? frames : []) as ReplayFile['frames'],
      warnings: Array.isArray(warnings)
        ? warnings.map((w: { frame: number; type: 'lean' | 'shoulder_hike' }) => ({ frame: w?.frame, type: w?.type }))
        : [],
    },
  };
}

// ---- plans ----

/** PlanExercise[]: 1–6 distinct exercises, whole reps 1..200, 0 < target ≤ 180 (the DB's clean_exercises). */
function checkExercises(errors: FieldError[], v: unknown): PlanExercise[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 6) {
    errors.push({ field: 'exercises', message: 'must be an array of 1 to 6 items' });
    return [];
  }
  const out: PlanExercise[] = [];
  const seen = new Set<string>();
  v.forEach((e: unknown, i: number) => {
    const at = `exercises[${i}]`;
    if (!isPlainObject(e) || !EXERCISES.includes(e.exercise as Exercise)) {
      errors.push({ field: `${at}.exercise`, message: `must be one of ${EXERCISES.join(', ')}` });
      return;
    }
    if (seen.has(e.exercise as string)) errors.push({ field: at, message: `duplicates ${String(e.exercise)}` });
    seen.add(e.exercise as string);
    const reps = e.reps;
    if (!isFiniteNumber(reps) || !Number.isInteger(reps) || reps < 1 || reps > 200) {
      errors.push({ field: `${at}.reps`, message: 'must be a whole number from 1 to 200' });
    }
    if (!isFiniteNumber(e.target) || e.target <= 0 || e.target > 180) {
      errors.push({ field: `${at}.target`, message: 'must be a number above 0 and at most 180' });
    }
    out.push({ exercise: e.exercise as Exercise, reps: reps as number, target: e.target as number });
  });
  return out;
}

/** approvePlan() body: approvedBy plus optional overrides. */
export function validateApproval(body: unknown): Validation<ApprovePlanBody> {
  const errors: FieldError[] = [];
  if (!isPlainObject(body)) {
    return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: { approvedBy: '' } };
  }
  const value: ApprovePlanBody = { approvedBy: checkText(errors, 'approvedBy', body.approvedBy, true) ?? '' };
  const phase = checkOptionalInt(errors, 'phase', body.phase, 1, 4);
  if (phase !== null) value.phase = phase;
  if (body.exercises !== undefined && body.exercises !== null) value.exercises = checkExercises(errors, body.exercises);
  const spw = checkOptionalInt(errors, 'sessionsPerWeek', body.sessionsPerWeek, 1, 14);
  if (spw !== null) value.sessionsPerWeek = spw;
  if (body.nextCheckin !== undefined && body.nextCheckin !== null && body.nextCheckin !== '') {
    if (!isValidDateOnly(body.nextCheckin)) {
      errors.push({ field: 'nextCheckin', message: 'must be a real date in YYYY-MM-DD form' });
    } else {
      value.nextCheckin = body.nextCheckin;
    }
  }
  return { errors, value };
}

/** savePlan() body: every field required. */
export function validateSavePlan(body: unknown): Validation<SavePlanBody> {
  const errors: FieldError[] = [];
  const empty: SavePlanBody = { approvedBy: '', phase: 1, exercises: [], sessionsPerWeek: 1, nextCheckin: '' };
  if (!isPlainObject(body)) return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: empty };
  const approvedBy = checkText(errors, 'approvedBy', body.approvedBy, true) ?? '';
  const phase = checkRequiredInt(errors, 'phase', body.phase, 1, 4);
  const exercises = checkExercises(errors, body.exercises);
  const sessionsPerWeek = checkRequiredInt(errors, 'sessionsPerWeek', body.sessionsPerWeek, 1, 14);
  if (!isValidDateOnly(body.nextCheckin)) {
    errors.push({ field: 'nextCheckin', message: 'must be a real date in YYYY-MM-DD form' });
  }
  return { errors, value: { approvedBy, phase, exercises, sessionsPerWeek, nextCheckin: String(body.nextCheckin ?? '') } };
}

/** setNextCheckin(): a real date from today to today + 180 (local). */
export function validateNextCheckin(date: unknown, today = localDate()): Validation<string> {
  if (!isValidDateOnly(date)) {
    return { errors: [{ field: 'nextCheckin', message: 'must be a real date in YYYY-MM-DD form' }], value: '' };
  }
  if (date < today || date > addDays(today, 180)) {
    return { errors: [{ field: 'nextCheckin', message: 'must be between today and 180 days from now' }], value: date };
  }
  return { errors: [], value: date };
}

/** dismissPlan(): optional dismissedBy (≤ 80 characters). */
export function validateDismissedBy(by: unknown): Validation<string | null> {
  const errors: FieldError[] = [];
  const value = checkText(errors, 'dismissedBy', by, false);
  return { errors, value };
}
