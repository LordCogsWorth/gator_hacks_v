/**
 * Simple JSON-file storage.
 * Each "collection" is one file under api/data/ (e.g. patients.json).
 * Safe for a hackathon demo — no database needed.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

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
 */
function writeAll(name, items) {
  ensureDataDir();
  fs.writeFileSync(filePath(name), JSON.stringify(items, null, 2) + '\n', 'utf8');
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
  readAll,
  writeAll,
  findById,
  upsert,
  append,
  updateWhere,
  makeId,
  ensureDataDir,
};
