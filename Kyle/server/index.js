const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'movement_log.jsonl');
const WATCH_SOURCE = "Kyle's Apple Watch";
const clients = new Set();
let latestSample = null;

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));
// no-store so browsers always load the latest dashboard code during development
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasXYZVector(v) {
  return v && isNumber(v.x) && isNumber(v.y) && isNumber(v.z);
}

function validateSample(sample) {
  if (!sample || typeof sample !== 'object') {
    return 'Body must be a JSON object.';
  }

  if (typeof sample.timestamp !== 'string' || Number.isNaN(Date.parse(sample.timestamp))) {
    return 'timestamp must be a valid ISO date string.';
  }

  if (!hasXYZVector(sample.accel)) {
    return 'accel must contain numeric x, y, z.';
  }

  if (!hasXYZVector(sample.gyro)) {
    return 'gyro must contain numeric x, y, z.';
  }

  if (sample.heartRate != null && !isNumber(sample.heartRate)) {
    return 'heartRate must be numeric when provided.';
  }

  if (sample.source !== WATCH_SOURCE) {
    return `source must exactly be ${WATCH_SOURCE}.`;
  }

  if (typeof sample.sessionId !== 'string' || sample.sessionId.trim() === '') {
    return 'sessionId must be a non-empty string.';
  }

  return null;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'kyle-motion-server' });
});

app.get('/latest', (_req, res) => {
  res.json({ ok: true, latest: latestSample });
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  clients.add(res);

  if (latestSample) {
    res.write(`event: motion\ndata: ${JSON.stringify(latestSample)}\n\n`);
  }

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    res.end();
  });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function broadcastMotion(sample) {
  broadcast('motion', sample);
}

app.post('/ingest', (req, res) => {
  const sample = req.body;
  const error = validateSample(sample);

  if (error) {
    return res.status(400).json({ ok: false, error });
  }

  const record = {
    receivedAt: new Date().toISOString(),
    ...sample
  };

  fs.appendFileSync(DATA_FILE, JSON.stringify(record) + '\n', 'utf8');
  latestSample = record;
  trackSessionSample(record);
  broadcastMotion(record);
  return res.status(201).json({ ok: true });
});

// Batch upload used by the watch app (sends ~1s of samples per request).
app.post('/ingest/batch', (req, res) => {
  const samples = Array.isArray(req.body?.samples) ? req.body.samples : null;
  if (!samples || samples.length === 0 || samples.length > 500) {
    return res.status(400).json({ ok: false, error: 'samples must be an array of 1–500 samples.' });
  }
  for (const [i, s] of samples.entries()) {
    const error = validateSample(s);
    if (error) return res.status(400).json({ ok: false, error: `samples[${i}]: ${error}` });
  }
  return res.status(201).json({ ok: true, accepted: ingestBatch(samples) });
});

function ingestBatch(samples) {
  const receivedAt = new Date().toISOString();
  const lines = samples.map((s) => ({ receivedAt, ...s }));
  fs.appendFileSync(DATA_FILE, lines.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  for (const r of lines) trackSessionSample(r);
  latestSample = lines[lines.length - 1];
  broadcastMotion(latestSample);
  return lines.length;
}

// ============================================================
// Supabase Realtime relay: the watch broadcasts its live samples to the
// "watch-live" channel over the internet, so live mirroring works even when
// the watch can't reach this Mac on the local network (e.g. campus Wi-Fi).
// ============================================================
const RELAY_URL = process.env.SUPABASE_URL || 'https://qyzrzofwmdxcxztbgrix.supabase.co';
const RELAY_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5enJ6b2Z3bWR4Y3h6dGJncml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NzE4NzAsImV4cCI6MjEwODQ0Nzg3MH0.nbbC-DJkSMr8fCsJaNcNjIx1ipyFXsyXy9dOl1nQtrs';

function startRelay() {
  if (typeof WebSocket !== 'function' || !RELAY_KEY) return;
  const wsUrl = RELAY_URL.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${RELAY_KEY}&vsn=1.0.0`;
  let ref = 0;
  let heartbeat;
  const ws = new WebSocket(wsUrl);
  const send = (topic, event, payload) => ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) }));
  ws.onopen = () => {
    send('realtime:watch-live', 'phx_join', {
      config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [] },
      access_token: RELAY_KEY,
    });
    heartbeat = setInterval(() => send('phoenix', 'heartbeat', {}), 25_000);
    console.log('Supabase relay: listening for live watch data');
  };
  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.event !== 'broadcast' || msg.payload?.event !== 'samples') return;
    const samples = (msg.payload.payload?.samples || []).filter((s) => !validateSample(s));
    if (samples.length) ingestBatch(samples);
  };
  ws.onclose = () => {
    clearInterval(heartbeat);
    setTimeout(startRelay, 3000); // reconnect
  };
  ws.onerror = () => ws.close();
}
startRelay();

// ============================================================
// Recording sessions (started from the watch or the dashboard)
// ============================================================
let session = null; // active session
let lastSession = null; // summary of the last finished session

function newSessionId() {
  return `s-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
}

function trackSessionSample(r) {
  if (!session || r.sessionId !== session.id) return;
  const mag = Math.hypot(r.accel.x, r.accel.y, r.accel.z);
  session.samples += 1;
  session.peakAccel = Math.max(session.peakAccel, mag);
  if (isNumber(r.heartRate)) {
    session.hrSum += r.heartRate;
    session.hrCount += 1;
    session.hrMax = Math.max(session.hrMax, r.heartRate);
  }
}

function sessionInfo(s) {
  if (!s) return null;
  const end = s.endedAt ? Date.parse(s.endedAt) : Date.now();
  return {
    id: s.id,
    exercise: s.exercise,
    startedBy: s.startedBy,
    startedAt: s.startedAt,
    endedAt: s.endedAt || null,
    durationSec: Math.round((end - Date.parse(s.startedAt)) / 1000),
    samples: s.samples,
    peakAccel: Number(s.peakAccel.toFixed(3)),
    avgHeartRate: s.hrCount ? Math.round(s.hrSum / s.hrCount) : null,
    maxHeartRate: s.hrCount ? s.hrMax : null
  };
}

function startSession(startedBy, exercise) {
  if (session) return session;
  session = {
    id: newSessionId(),
    exercise: typeof exercise === 'string' && exercise.trim() ? exercise.trim().slice(0, 120) : 'Mobility session',
    startedBy,
    startedAt: new Date().toISOString(),
    samples: 0,
    peakAccel: 0,
    hrSum: 0,
    hrCount: 0,
    hrMax: 0
  };
  broadcast('session', { state: 'started', session: sessionInfo(session) });
  return session;
}

function stopSession(stoppedBy) {
  if (!session) return null;
  session.endedAt = new Date().toISOString();
  lastSession = sessionInfo(session);
  lastSession.stoppedBy = stoppedBy;
  session = null;
  broadcast('session', { state: 'stopped', session: lastSession });
  return lastSession;
}

const by = (req) => (req.body?.by === 'watch' ? 'watch' : 'dashboard');

app.get('/session', (_req, res) => {
  res.json({ ok: true, active: sessionInfo(session), last: lastSession });
});

app.post('/session/start', (req, res) => {
  const s = startSession(by(req), req.body?.exercise);
  res.status(201).json({ ok: true, active: sessionInfo(s) });
});

app.post('/session/stop', (req, res) => {
  const summary = stopSession(by(req));
  if (!summary) return res.status(409).json({ ok: false, error: 'No active session.' });
  return res.json({ ok: true, summary });
});

// ============================================================
// Prompts for the native watch app. The watch polls this and
// shows a local notification with a "Start session" button.
// ============================================================
const watchPrompts = [];
let promptSeq = 0;

function queueWatchPrompt(title, message) {
  const p = { seq: ++promptSeq, id: crypto.randomUUID(), at: new Date().toISOString(), title, message };
  watchPrompts.push(p);
  if (watchPrompts.length > 20) watchPrompts.shift();
  broadcast('prompt', p);
  return p;
}

app.get('/watch/info', (_req, res) => {
  const port = PORT;
  const lanUrls = Object.values(require('os').networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
  res.json({ ok: true, lanUrls, source: WATCH_SOURCE });
});

app.get('/watch/prompts', (req, res) => {
  const after = Number(req.query.after) || 0;
  res.json({ ok: true, latestSeq: promptSeq, prompts: watchPrompts.filter((p) => p.seq > after) });
});

app.post('/simulate', (_req, res) => {
  const now = Date.now();
  const t = now / 1000;
  const sample = {
    timestamp: new Date(now).toISOString(),
    accel: {
      x: Math.sin(t) * 0.2,
      y: Math.cos(t * 0.8) * 0.2,
      z: 0.9 + Math.sin(t * 0.5) * 0.05
    },
    gyro: {
      x: Math.sin(t * 0.6) * 0.08,
      y: Math.cos(t * 0.7) * 0.07,
      z: Math.sin(t * 0.9) * 0.09
    },
    heartRate: 76 + Math.round(Math.sin(t * 0.25) * 8),
    source: WATCH_SOURCE,
    sessionId: session ? session.id : 'simulated-session'
  };

  const record = {
    receivedAt: new Date().toISOString(),
    ...sample
  };

  fs.appendFileSync(DATA_FILE, JSON.stringify(record) + '\n', 'utf8');
  latestSample = record;
  trackSessionSample(record);
  broadcastMotion(record);
  return res.status(201).json({ ok: true, simulated: true, sample: record });
});

// ============================================================
// Watch alerts via ntfy (https://ntfy.sh)
// The ntfy iPhone app receives the push; iPhone notifications are
// mirrored to the paired Apple Watch automatically.
// ============================================================
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
const TOPIC_FILE = path.join(DATA_DIR, 'ntfy_topic.txt');

// Random, private topic name (anyone who knows it can read/send to it).
// Stored in server/data/, which is git-ignored.
function loadTopic() {
  if (process.env.NTFY_TOPIC) return process.env.NTFY_TOPIC.trim();
  if (fs.existsSync(TOPIC_FILE)) return fs.readFileSync(TOPIC_FILE, 'utf8').trim();
  const topic = `kyle-watch-${crypto.randomBytes(8).toString('hex')}`;
  fs.writeFileSync(TOPIC_FILE, topic + '\n', 'utf8');
  return topic;
}
const NTFY_TOPIC = loadTopic();

const alertLog = [];
let reminder = null; // { intervalMin, title, message, nextAt, timer }

function sendNtfy({ title, message, priority = 4, tags = ['muscle'] }) {
  return new Promise((resolve, reject) => {
    const url = new URL(NTFY_SERVER);
    const lib = url.protocol === 'http:' ? http : https;
    // JSON publishing keeps emoji/° etc. out of HTTP headers.
    const body = JSON.stringify({ topic: NTFY_TOPIC, title, message, priority, tags });
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data ? JSON.parse(data) : {});
          else reject(new Error(`ntfy responded ${res.statusCode}: ${data.slice(0, 200)}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('ntfy request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function deliverAlert(title, message, kind) {
  const entry = { at: new Date().toISOString(), title, message, kind, ok: false };
  entry.prompt = queueWatchPrompt(title, message).seq; // native watch app (always works on LAN)
  try {
    const r = await sendNtfy({ title, message });
    entry.ok = true;
    entry.id = r.id;
  } catch (err) {
    entry.error = err.message;
  }
  alertLog.unshift(entry);
  alertLog.length = Math.min(alertLog.length, 20);
  broadcast('alert', entry);
  return entry;
}

function validateAlert(body) {
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Time for your exercise';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return { error: 'message must be a non-empty string.' };
  if (message.length > 1000 || title.length > 120) return { error: 'title/message too long.' };
  return { title, message };
}

function reminderInfo() {
  return reminder ? { intervalMin: reminder.intervalMin, title: reminder.title, message: reminder.message, nextAt: reminder.nextAt } : null;
}

function stopReminder() {
  if (reminder) clearInterval(reminder.timer);
  reminder = null;
}

app.get('/alert/config', (_req, res) => {
  res.json({
    ok: true,
    server: NTFY_SERVER,
    topic: NTFY_TOPIC,
    subscribeUrl: `${NTFY_SERVER}/${NTFY_TOPIC}`,
    reminder: reminderInfo(),
    log: alertLog
  });
});

app.post('/alert', async (req, res) => {
  const v = validateAlert(req.body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const entry = await deliverAlert(v.title, v.message, 'now');
  return res.status(entry.ok ? 201 : 502).json({ ok: entry.ok, alert: entry, error: entry.error });
});

app.post('/alert/reminder', (req, res) => {
  const v = validateAlert(req.body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const intervalMin = Number(req.body.intervalMin);
  if (!Number.isFinite(intervalMin) || intervalMin < 1 || intervalMin > 240) {
    return res.status(400).json({ ok: false, error: 'intervalMin must be between 1 and 240.' });
  }
  stopReminder();
  const ms = intervalMin * 60000;
  reminder = { intervalMin, title: v.title, message: v.message, nextAt: new Date(Date.now() + ms).toISOString() };
  reminder.timer = setInterval(() => {
    reminder.nextAt = new Date(Date.now() + ms).toISOString();
    deliverAlert(reminder.title, reminder.message, 'reminder');
  }, ms);
  reminder.timer.unref?.();
  return res.status(201).json({ ok: true, reminder: reminderInfo() });
});

app.delete('/alert/reminder', (_req, res) => {
  stopReminder();
  res.json({ ok: true, reminder: null });
});

// Approved care plan → watch. RehabTrack's care dashboard POSTs here when a doctor approves (or edits)
// a plan; the watch gets a "New plan approved" prompt and fetches the exercise list from GET /plan.
const PLAN_EXERCISES = ['arm_raise', 'forward_reach', 'hand_open'];
let currentPlan = null;

app.get('/plan', (_req, res) => res.json({ ok: true, plan: currentPlan }));

app.post('/plan', (req, res) => {
  const b = req.body || {};
  const exercises = Array.isArray(b.exercises)
    ? b.exercises
        .filter((e) => e && PLAN_EXERCISES.includes(e.exercise))
        .map((e) => ({ exercise: e.exercise, reps: Math.max(1, Math.min(50, Math.round(Number(e.reps) || 10))) }))
    : [];
  if (!exercises.length) return res.status(400).json({ ok: false, error: 'exercises must list at least one exercise.' });
  currentPlan = {
    id: String(b.id || crypto.randomUUID()).slice(0, 64),
    patientId: String(b.patientId || '').slice(0, 64),
    patientName: String(b.patientName || '').slice(0, 80),
    phase: Number.isFinite(Number(b.phase)) ? Number(b.phase) : null,
    sessionsPerWeek: Number.isFinite(Number(b.sessionsPerWeek)) ? Number(b.sessionsPerWeek) : null,
    approvedBy: String(b.approvedBy || 'your care team').slice(0, 80),
    approvedAt: new Date().toISOString(),
    exercises,
  };
  const names = { arm_raise: 'Arm raise', forward_reach: 'Forward reach', hand_open: 'Hand open' };
  const list = exercises.map((e) => `${names[e.exercise]} ×${e.reps}`).join(', ');
  const prompt = queueWatchPrompt('New plan approved', `${currentPlan.approvedBy} approved your plan: ${list}`);
  broadcast('plan', currentPlan);
  res.status(201).json({ ok: true, plan: currentPlan, prompt });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`kyle-motion-server listening on http://localhost:${PORT}`);
    const lan = Object.values(require('os').networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => `http://${i.address}:${PORT}`);
    if (lan.length) console.log(`Watch app server URL: ${lan.join('  or  ')}`);
  });
}

module.exports = app;
