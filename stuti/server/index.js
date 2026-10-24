const express = require('express');
const fs = require('fs');
const path = require('path');

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

function broadcastMotion(sample) {
  const payload = `event: motion\ndata: ${JSON.stringify(sample)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
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
  broadcastMotion(record);
  return res.status(201).json({ ok: true });
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
    sessionId: 'simulated-session'
  };

  const record = {
    receivedAt: new Date().toISOString(),
    ...sample
  };

  fs.appendFileSync(DATA_FILE, JSON.stringify(record) + '\n', 'utf8');
  latestSample = record;
  broadcastMotion(record);
  return res.status(201).json({ ok: true, simulated: true, sample: record });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`kyle-motion-server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
