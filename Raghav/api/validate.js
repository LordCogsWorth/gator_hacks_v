/**
 * Request-body validation for the API.
 *
 * Each validator returns { errors, value }:
 *   errors — array of { field, message }; empty when the body is OK
 *   value  — cleaned-up copy of the body (only meaningful when errors is empty)
 *
 * Validators never touch the store, so routes can validate BEFORE writing anything.
 */

const EXERCISES = ['arm_raise', 'forward_reach', 'hand_open'];
const SIDES = ['weak', 'healthy'];

// Numeric fields every ExerciseResult must carry (see docs/CONTRACTS.md §3).
const RESULT_NUMBER_FIELDS = [
  'bestValue',
  'reps',
  'secPerRep',
  'smoothness',
  'fatigue',
  'trunkLeanMax',
  'shoulderHikeMax',
  'compRepPct',
];

// Optional numeric fields on a watch daily row (see docs/CONTRACTS.md §6).
const WATCH_NUMBER_FIELDS = [
  'steps',
  'exerciseMin',
  'standHr',
  'restingHr',
  'hrv',
  'sleepHr',
  'bpSys',
  'bpDia',
  'falls',
  'weakArmActiveMin',
  'useRatio',
];

// Epoch-ms timestamps must land between these years. Catches apps that send
// epoch *seconds* by mistake (which would otherwise become a 1970 date).
const MIN_EPOCH_MS = Date.UTC(2000, 0, 1);
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Accept an ISO-8601 string or epoch milliseconds; return a normalized
 * ISO string (always UTC "…Z"), or null if invalid.
 * Normalizing matters: the rules engine sorts timestamps as strings.
 */
function toIsoTimestamp(v) {
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
function isValidDateOnly(v) {
  if (typeof v !== 'string' || !DATE_ONLY.test(v)) return false;
  const d = new Date(v + 'T00:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Optional number in [min, max]. null/undefined count as "not sent". */
function checkOptionalRange(errors, field, v, min, max) {
  if (v === undefined || v === null) return null;
  if (!isFiniteNumber(v) || v < min || v > max) {
    errors.push({ field, message: `must be a number from ${min} to ${max}` });
    return null;
  }
  return v;
}

/**
 * POST /sessions body.
 * value: { patientId, startedAt, endedAt, pain, tiredness, results[] }
 */
function validateSession(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: null };
  }

  if (typeof body.patientId !== 'string' || !body.patientId.trim()) {
    errors.push({ field: 'patientId', message: 'is required (string)' });
  }

  const startedAt = toIsoTimestamp(body.startedAt);
  if (!startedAt) {
    errors.push({ field: 'startedAt', message: 'must be an ISO-8601 string or epoch milliseconds' });
  }
  const endedAt = toIsoTimestamp(body.endedAt);
  if (!endedAt) {
    errors.push({ field: 'endedAt', message: 'must be an ISO-8601 string or epoch milliseconds' });
  }

  const pain = checkOptionalRange(errors, 'pain', body.pain, 0, 10);
  const tiredness = checkOptionalRange(errors, 'tiredness', body.tiredness, 1, 5);

  const results = [];
  if (!Array.isArray(body.results) || body.results.length < 1 || body.results.length > 6) {
    errors.push({ field: 'results', message: 'must be an array of 1 to 6 exercise results' });
  } else {
    const seen = new Set();
    body.results.forEach((r, i) => {
      const at = `results[${i}]`;
      if (!isPlainObject(r)) {
        errors.push({ field: at, message: 'must be an object' });
        return;
      }
      if (!EXERCISES.includes(r.exercise)) {
        errors.push({ field: `${at}.exercise`, message: `must be one of ${EXERCISES.join(', ')}` });
      }
      if (!SIDES.includes(r.side)) {
        errors.push({ field: `${at}.side`, message: `must be one of ${SIDES.join(', ')}` });
      }
      for (const f of RESULT_NUMBER_FIELDS) {
        if (!isFiniteNumber(r[f])) {
          errors.push({ field: `${at}.${f}`, message: 'must be a finite number' });
        }
      }
      if (isFiniteNumber(r.compRepPct) && (r.compRepPct < 0 || r.compRepPct > 100)) {
        errors.push({ field: `${at}.compRepPct`, message: 'must be from 0 to 100' });
      }
      // Two rows for the same exercise + side would make symmetry ambiguous.
      const key = `${r.exercise}/${r.side}`;
      if (seen.has(key)) {
        errors.push({ field: at, message: `duplicate ${key} result` });
      }
      seen.add(key);

      const clean = { exercise: r.exercise, side: r.side };
      for (const f of RESULT_NUMBER_FIELDS) clean[f] = r[f];
      results.push(clean);
    });
  }

  return {
    errors,
    value: { patientId: body.patientId, startedAt, endedAt, pain, tiredness, results },
  };
}

/**
 * POST /watch/daily body.
 * value: { patientId, date, fields } where fields only holds numbers that
 * were actually sent (null/undefined are skipped so a merge keeps old values).
 */
function validateWatchDaily(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: null };
  }
  if (typeof body.patientId !== 'string' || !body.patientId.trim()) {
    errors.push({ field: 'patientId', message: 'is required (string)' });
  }
  if (!isValidDateOnly(body.date)) {
    errors.push({ field: 'date', message: 'must be a real date in YYYY-MM-DD form' });
  }

  const fields = {};
  for (const f of WATCH_NUMBER_FIELDS) {
    const v = body[f];
    if (v === undefined || v === null) continue;
    if (!isFiniteNumber(v)) {
      errors.push({ field: f, message: 'must be a finite number' });
      continue;
    }
    fields[f] = v;
  }

  return { errors, value: { patientId: body.patientId, date: body.date, fields } };
}

/**
 * POST /plans/:id/approve body. Every field except approvedBy is optional.
 */
function validateApproval(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: [{ field: 'body', message: 'must be a JSON object' }], value: null };
  }
  if (typeof body.approvedBy !== 'string' || !body.approvedBy.trim()) {
    errors.push({ field: 'approvedBy', message: 'is required (string)' });
  }
  if (body.exercises !== undefined) {
    if (!Array.isArray(body.exercises) || body.exercises.length === 0) {
      errors.push({ field: 'exercises', message: 'must be a non-empty array' });
    } else {
      body.exercises.forEach((e, i) => {
        const at = `exercises[${i}]`;
        if (!isPlainObject(e) || !EXERCISES.includes(e.exercise)) {
          errors.push({ field: `${at}.exercise`, message: `must be one of ${EXERCISES.join(', ')}` });
          return;
        }
        if (!Number.isInteger(e.reps) || e.reps < 1) {
          errors.push({ field: `${at}.reps`, message: 'must be a whole number of at least 1' });
        }
        if (!isFiniteNumber(e.target) || e.target <= 0) {
          errors.push({ field: `${at}.target`, message: 'must be a positive number' });
        }
      });
    }
  }
  if (
    body.sessionsPerWeek !== undefined &&
    (!Number.isInteger(body.sessionsPerWeek) || body.sessionsPerWeek < 1 || body.sessionsPerWeek > 14)
  ) {
    errors.push({ field: 'sessionsPerWeek', message: 'must be a whole number from 1 to 14' });
  }
  if (body.nextCheckin !== undefined && !isValidDateOnly(body.nextCheckin)) {
    errors.push({ field: 'nextCheckin', message: 'must be a real date in YYYY-MM-DD form' });
  }
  return { errors, value: body };
}

module.exports = {
  EXERCISES,
  SIDES,
  WATCH_NUMBER_FIELDS,
  toIsoTimestamp,
  isValidDateOnly,
  validateSession,
  validateWatchDaily,
  validateApproval,
};
