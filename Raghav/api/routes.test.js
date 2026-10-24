/**
 * HTTP tests for router.js: mounts the router on an ephemeral port and calls
 * it with fetch, against a temporary data folder.
 * Run with: npm test
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// Point the store at a temp folder BEFORE anything requires store.js.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rehab-routes-'));
process.env.REHAB_DATA_DIR = DATA_DIR;

const express = require('express');
const store = require('./store');
const router = require('./router');

let server;
let base;

function post(urlPath, body, rawBody) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody ?? JSON.stringify(body),
  });
}

function result(exercise, side, bestValue) {
  return {
    exercise, side, bestValue,
    reps: 10, secPerRep: 3, smoothness: 1.2, fatigue: 0.95,
    trunkLeanMax: 4, shoulderHikeMax: 0.01, compRepPct: 10,
  };
}

function goodSession(overrides = {}) {
  return {
    patientId: 'p-test',
    startedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    endedAt: new Date().toISOString(),
    pain: 2,
    tiredness: 2,
    results: [result('arm_raise', 'healthy', 160), result('arm_raise', 'weak', 100)],
    ...overrides,
  };
}

before(async () => {
  // Mount exactly like a host server would: no body parser of our own.
  const app = express();
  app.use('/api', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(() => {
  for (const name of ['sessions', 'exerciseResults', 'watchDaily', 'alerts', 'plans']) {
    store.writeAll(name, []);
  }
  store.writeAll('patients', [
    { id: 'p-test', name: 'Test Patient', weakSide: 'left', strokeDate: '2026-07-01', phase: 1, maxRaiseAngle: 120, nextCheckin: '2026-10-30', bpLimitSys: 140 },
  ]);
});

after(() => {
  server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('POST /sessions', () => {
  it('rejects a bad session with 400, lists every field error, and writes nothing', async () => {
    const res = await post('/sessions', {
      patientId: 'p-test',
      startedAt: 'yesterday',
      endedAt: new Date().toISOString(),
      pain: 14,
      results: [{ ...result('arm_raise', 'weak', 100), exercise: 'jumping', reps: 'ten', compRepPct: 140 }],
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid session');
    const fields = body.details.map((d) => d.field);
    for (const f of ['startedAt', 'pain', 'results[0].exercise', 'results[0].reps', 'results[0].compRepPct']) {
      assert.ok(fields.includes(f), `expected an error for ${f}, got ${fields.join(', ')}`);
    }
    assert.equal(store.readAll('sessions').length, 0);
    assert.equal(store.readAll('exerciseResults').length, 0);
  });

  it('rejects an empty results array and more than 6 results', async () => {
    for (const results of [[], Array.from({ length: 7 }, () => result('arm_raise', 'weak', 90))]) {
      const res = await post('/sessions', goodSession({ results }));
      assert.equal(res.status, 400);
    }
  });

  it('saves a valid session with 201', async () => {
    const res = await post('/sessions', goodSession());
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.session.patientId, 'p-test');
    assert.equal(body.results.length, 2);
    assert.ok(Array.isArray(body.alertsCreated));
    assert.equal(store.readAll('sessions').length, 1);
    assert.equal(store.readAll('exerciseResults').length, 2);
  });

  it('accepts epoch-ms timestamps and stores them as ISO strings', async () => {
    const started = Date.parse('2026-10-24T15:30:00.000Z');
    const res = await post('/sessions', goodSession({ startedAt: started, endedAt: started + 12 * 60 * 1000 }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.session.startedAt, '2026-10-24T15:30:00.000Z');
    assert.equal(body.session.endedAt, '2026-10-24T15:42:00.000Z');
    // The list endpoint (which runs the rules) still works afterwards.
    assert.equal((await fetch(`${base}/patients`)).status, 200);
  });

  it('returns 404 for an unknown patient', async () => {
    const res = await post('/sessions', goodSession({ patientId: 'p-nobody' }));
    assert.equal(res.status, 404);
  });
});

describe('POST /watch/daily', () => {
  it('merges into an existing day without nulling fields that were not sent', async () => {
    let res = await post('/watch/daily', { patientId: 'p-test', date: '2026-10-24', steps: 4200, restingHr: 68 });
    assert.equal(res.status, 201);

    res = await post('/watch/daily', { patientId: 'p-test', date: '2026-10-24', bpSys: 132, restingHr: 70 });
    assert.equal(res.status, 201);
    const { watchDaily } = await res.json();
    assert.equal(watchDaily.steps, 4200); // kept
    assert.equal(watchDaily.restingHr, 70); // overwritten
    assert.equal(watchDaily.bpSys, 132); // added
    assert.equal(store.readAll('watchDaily').length, 1);
  });

  it('rejects a bad date and non-numeric fields', async () => {
    const res = await post('/watch/daily', { patientId: 'p-test', date: '10/24/2026', steps: 'lots' });
    assert.equal(res.status, 400);
    const fields = (await res.json()).details.map((d) => d.field);
    assert.deepEqual(fields.sort(), ['date', 'steps']);
    assert.equal(store.readAll('watchDaily').length, 0);
  });
});

describe('PATCH /alerts/:id', () => {
  it('sets acknowledgedAt', async () => {
    store.writeAll('alerts', [
      { id: 'alert-1', patientId: 'p-test', type: 'pain', detail: 'x', createdAt: '2026-10-24T12:00:00.000Z', acknowledged: false },
    ]);
    const res = await fetch(`${base}/alerts/alert-1`, { method: 'PATCH' });
    assert.equal(res.status, 200);
    const alert = await res.json();
    assert.equal(alert.acknowledged, true);
    assert.ok(!Number.isNaN(Date.parse(alert.acknowledgedAt)));
  });
});

describe('errors are JSON', () => {
  it('answers malformed JSON with 400 { error }', async () => {
    const res = await post('/sessions', null, '{"patientId": ');
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.ok((await res.json()).error);
  });

  it('answers an unknown route with 404 { error }', async () => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    assert.ok((await res.json()).error);
  });
});
