/**
 * Simple JSON-file storage.
 * Each "collection" is one file under api/data/ (e.g. patients.json).
 * Safe for a hackathon demo — no database needed.
 *
 * Set REHAB_DATA_DIR to use a different folder (tests use a temp dir).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.REHAB_DATA_DIR || path.join(__dirname, 'data');
// Replays are large, so each one is its own file: replays/<key>.json
const REPLAY_DIR = path.join(DATA_DIR, 'replays');

/** Make sure the data folder exists. */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Full path to a collection file. */
function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

/**
 * Read a whole collection as an array.
 * Returns [] if the file does not exist yet.
 */
function readAll(name) {
  ensureDataDir();
  const file = filePath(name);
  if (!fs.existsSync(file)) {
    return [];
  }
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) {
    return [];
  }
  return JSON.parse(raw);
}

/**
 * Overwrite a whole collection with a new array.
 * Writes to a temp file then renames, so a crash mid-write can't leave
 * half a JSON file behind.
 */
function writeAll(name, items) {
  ensureDataDir();
  const file = filePath(name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Find one item by id. Returns undefined if not found.
 */
function findById(name, id) {
  return readAll(name).find((item) => item.id === id);
}

/**
 * Insert or replace one item (matched by id).
 */
function upsert(name, item) {
  const items = readAll(name);
  const index = items.findIndex((x) => x.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
  writeAll(name, items);
  return item;
}

/**
 * Append a new item (does not check for duplicates).
 */
function append(name, item) {
  const items = readAll(name);
  items.push(item);
  writeAll(name, items);
  return item;
}

/**
 * Update items that match a filter function.
 * updater receives the item and returns the new item.
 */
function updateWhere(name, matchFn, updater) {
  const items = readAll(name);
  const next = items.map((item) => (matchFn(item) ? updater(item) : item));
  writeAll(name, next);
  return next;
}

/** Write one replay file (atomic, like writeAll). key = "<sessionId>-<exercise>-<side>". */
function writeReplay(key, replay) {
  fs.mkdirSync(REPLAY_DIR, { recursive: true });
  const file = path.join(REPLAY_DIR, `${key}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(replay) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** Read one replay file, or null if it doesn't exist. Also returns when it was written. */
function readReplay(key) {
  const file = path.join(REPLAY_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  return {
    replay: JSON.parse(fs.readFileSync(file, 'utf8')),
    uploadedAt: fs.statSync(file).mtime.toISOString(),
  };
}

/** Delete every replay file (seed uses this when it resets demo data). */
function clearReplays() {
  fs.rmSync(REPLAY_DIR, { recursive: true, force: true });
}

/**
 * Make a short unique-ish id like "sess-abc123".
 */
function makeId(prefix) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}${rand}`;
}

module.exports = {
  DATA_DIR,
  REPLAY_DIR,
  readAll,
  writeAll,
  findById,
  upsert,
  append,
  updateWhere,
  makeId,
  ensureDataDir,
  writeReplay,
  readReplay,
  clearReplays,
};
