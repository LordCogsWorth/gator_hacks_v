const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'movement_log.jsonl');
const WATCH_SOURCE = "Kyle's Apple Watch";

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));

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
  return res.status(201).json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`kyle-motion-server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
