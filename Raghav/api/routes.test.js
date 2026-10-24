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

describe('POST /sessions safety stop (stopReason)', () => {
  it('accepts results: [] with a stopReason, stores it, and raises a safety-stop alert', async () => {
    const res = await post('/sessions', goodSession({ pain: 8, results: [], stopReason: 'pain' }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.session.stopReason, 'pain');
    assert.equal(body.results.length, 0);
    assert.ok(body.alertsCreated.some((a) => a.type === 'safety-stop'));

    const sessions = await (await fetch(`${base}/patients/p-test/sessions`)).json();
    assert.equal(sessions[0].stopReason, 'pain');
    assert.equal(sessions[0].symmetry, null);
  });

  it('accepts partial results with a stopReason', async () => {
    const res = await post('/sessions', goodSession({ stopReason: 'dizziness' }));
    assert.equal(res.status, 201);
    assert.equal((await res.json()).results.length, 2);
  });

  it('rejects an unknown stopReason and still rejects results: [] without one', async () => {
    let res = await post('/sessions', goodSession({ results: [], stopReason: 'bored' }));
    assert.equal(res.status, 400);
    const fields = (await res.json()).details.map((d) => d.field);
    assert.ok(fields.includes('stopReason'));
    res = await post('/sessions', goodSession({ results: [], stopReason: null }));
    assert.equal(res.status, 400);
    assert.equal(store.readAll('sessions').length, 0);
  });

  it('returns stopReason null for normal sessions and keeps the list symmetry from the last scored session', async () => {
    await post('/sessions', goodSession({ startedAt: '2026-10-23T15:00:00.000Z', endedAt: '2026-10-23T15:10:00.000Z' }));
    await post('/sessions', goodSession({ results: [], stopReason: 'other' }));
    const sessions = await (await fetch(`${base}/patients/p-test/sessions`)).json();
    assert.equal(sessions[0].stopReason, null);
    const list = await (await fetch(`${base}/patients`)).json();
    assert.equal(list[0].latestSymmetry, 63); // 100 / 160, from the session before the stop
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

describe('POST /plans/:id/approve', () => {
  const exercises = [{ exercise: 'arm_raise', reps: 10, target: 100 }];
  beforeEach(() => {
    store.writeAll('plans', [
      { id: 'plan-old', patientId: 'p-test', phase: 1, exercises, sessionsPerWeek: 5, status: 'approved', approvedBy: 'Dr. Chen', nextCheckin: '2026-10-30', createdAt: '2026-10-01T12:00:00.000Z' },
      { id: 'plan-new', patientId: 'p-test', phase: 2, exercises, sessionsPerWeek: 5, status: 'suggested', approvedBy: null, nextCheckin: '2026-10-30', createdAt: '2026-10-24T12:00:00.000Z', reason: 'Ready', basedOn: { sessions: 3, avgSymmetry: 70, avgCompensation: 10 } },
      { id: 'plan-gone', patientId: 'p-test', phase: 2, exercises, sessionsPerWeek: 5, status: 'dismissed', approvedBy: null, nextCheckin: '2026-10-30', createdAt: '2026-10-20T12:00:00.000Z' },
    ]);
  });

  it('approves with edits and supersedes the previous approved plan', async () => {
    const res = await post('/plans/plan-new/approve', { approvedBy: 'Dr. Chen', sessionsPerWeek: 6, nextCheckin: '2026-11-04' });
    assert.equal(res.status, 200);
    const plan = await res.json();
    assert.equal(plan.status, 'approved');
    assert.equal(plan.sessionsPerWeek, 6);
    assert.ok(plan.approvedAt);
    const byId = Object.fromEntries(store.readAll('plans').map((p) => [p.id, p]));
    assert.equal(byId['plan-old'].status, 'superseded');
    assert.equal(store.findById('patients', 'p-test').phase, 2);
    const current = await (await fetch(`${base}/patients/p-test/plan`)).json();
    assert.equal(current.id, 'plan-new');
  });

  it('rejects bad edits with 400 and a dismissed plan with 409', async () => {
    let res = await post('/plans/plan-new/approve', { approvedBy: '', sessionsPerWeek: 0 });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).details.map((d) => d.field).sort(), ['approvedBy', 'sessionsPerWeek']);
    res = await post('/plans/plan-gone/approve', { approvedBy: 'Dr. Chen' });
    assert.equal(res.status, 409);
  });
});

describe('POST /plans/:id/dismiss and GET /config', () => {
  beforeEach(() => {
    store.writeAll('plans', [
      { id: 'plan-s', patientId: 'p-test', phase: 2, exercises: [], sessionsPerWeek: 5, status: 'suggested', approvedBy: null, nextCheckin: '2026-10-30', createdAt: '2026-10-24T12:00:00.000Z' },
    ]);
  });

  it('dismisses a suggested plan once', async () => {
    let res = await post('/plans/plan-s/dismiss', { dismissedBy: 'Dr. Chen' });
    assert.equal(res.status, 200);
    const plan = await res.json();
    assert.equal(plan.status, 'dismissed');
    assert.ok(plan.dismissedAt);
    res = await post('/plans/plan-s/dismiss', {});
    assert.equal(res.status, 409);
  });

  it('exposes the phase targets', async () => {
    const config = await (await fetch(`${base}/config`)).json();
    assert.equal(config.phaseTargets['2'], 65);
    assert.equal(config.maxPhase, 4);
  });
});

describe('replays', () => {
  const JOINTS = [
    'nose', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ];

  function replay(overrides = {}, frameCount = 30) {
    const frame = JOINTS.map((_, j) => [0.1 * j, -0.5, 0]);
    return {
      fps: 15,
      exercise: 'arm_raise',
      side: 'weak',
      joints: JOINTS,
      frames: Array.from({ length: frameCount }, () => frame),
      warnings: [{ frame: 3, type: 'lean' }],
      ...overrides,
    };
  }

  async function newSession() {
    const res = await post('/sessions', goodSession());
    return (await res.json()).session;
  }

  it('new sessions start with an empty replays list', async () => {
    const session = await newSession();
    assert.deepEqual(session.replays, []);
  });

  it('stores a valid replay with 201, records the key, and replaces on re-upload', async () => {
    const session = await newSession();
    let res = await post(`/sessions/${session.id}/replay`, replay());
    assert.equal(res.status, 201);
    const body = await res.json();
    const key = `${session.id}-arm_raise-weak`;
    assert.deepEqual(body.replays, [key]);
    assert.equal(body.replay.frameCount, 30);
    assert.equal(body.replay.warningCount, 1);
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'replays', `${key}.json`)));

    res = await post(`/sessions/${session.id}/replay`, replay({}, 45));
    assert.equal(res.status, 201);
    await post(`/sessions/${session.id}/replay`, replay({ side: 'healthy', warnings: undefined }));
    assert.deepEqual(store.findById('sessions', session.id).replays, [key, `${session.id}-arm_raise-healthy`]);

    const list = await (await fetch(`${base}/sessions/${session.id}/replays`)).json();
    assert.deepEqual(list.map((r) => [r.side, r.frameCount]), [['weak', 45], ['healthy', 30]]);

    const one = await (await fetch(`${base}/sessions/${session.id}/replays/arm_raise/weak`)).json();
    assert.equal(one.frames.length, 45);
    assert.deepEqual(one.joints, JOINTS);
    assert.equal(one.fps, 15);
  });

  it('rejects a bad replay with 400, lists the problems, and stores nothing', async () => {
    const session = await newSession();
    const badFrames = replay().frames.slice();
    badFrames[2] = badFrames[2].slice(0, 12);
    badFrames[4] = badFrames[4].map((p, j) => (j === 0 ? [0, 'x', 0] : p));
    const res = await post(`/sessions/${session.id}/replay`, replay({
      fps: 30,
      exercise: 'jumping',
      joints: [...JOINTS].reverse(),
      frames: badFrames,
      warnings: [{ frame: 99, type: 'lean' }],
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid replay');
    assert.deepEqual(body.details.map((d) => d.field).sort(), [
      'exercise', 'fps', 'frames[2]', 'frames[4]', 'joints', 'warnings[0]',
    ]);
    assert.deepEqual(store.findById('sessions', session.id).replays, []);
    assert.equal(fs.existsSync(path.join(DATA_DIR, 'replays', `${session.id}-jumping-weak.json`)), false);
  });

  it('rejects more than 120 s of frames and an empty recording', async () => {
    const session = await newSession();
    let res = await post(`/sessions/${session.id}/replay`, replay({}, 15 * 120 + 1));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details[0].field, 'frames');
    res = await post(`/sessions/${session.id}/replay`, replay({ warnings: [] }, 0));
    assert.equal(res.status, 400);
    // Exactly 120 s is allowed.
    res = await post(`/sessions/${session.id}/replay`, replay({}, 15 * 120));
    assert.equal(res.status, 201);
  });

  it('answers 404 for an unknown session or a replay that was never uploaded', async () => {
    let res = await post('/sessions/sess-nope/replay', replay());
    assert.equal(res.status, 404);
    res = await fetch(`${base}/sessions/sess-nope/replays`);
    assert.equal(res.status, 404);
    const session = await newSession();
    res = await fetch(`${base}/sessions/${session.id}/replays/hand_open/weak`);
    assert.equal(res.status, 404);
    res = await fetch(`${base}/sessions/${session.id}/replays/jumping/weak`);
    assert.equal(res.status, 400);
  });
});
