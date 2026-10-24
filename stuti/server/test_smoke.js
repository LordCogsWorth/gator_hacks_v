const http = require('http');
const app = require('./index');

function request({ method, path, port, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        });
      }
    );

    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const health = await request({ method: 'GET', path: '/health', port });
    if (health.status !== 200 || !health.body?.ok) {
      throw new Error('Health check failed');
    }

    const validSample = {
      timestamp: new Date().toISOString(),
      accel: { x: 0.1, y: -0.2, z: 0.95 },
      gyro: { x: 0.02, y: 0.01, z: -0.03 },
      heartRate: 88,
      source: "Kyle's Apple Watch",
      sessionId: 'smoke-session-1'
    };

    const ingestOk = await request({ method: 'POST', path: '/ingest', port, body: validSample });
    if (ingestOk.status !== 201 || !ingestOk.body?.ok) {
      throw new Error('Valid ingest failed');
    }

    const latest = await request({ method: 'GET', path: '/latest', port });
    if (latest.status !== 200 || latest.body?.latest?.source !== "Kyle's Apple Watch") {
      throw new Error('Latest sample endpoint failed');
    }

    const invalidSample = {
      ...validSample,
      source: 'Wrong Watch Name'
    };

    const ingestBad = await request({ method: 'POST', path: '/ingest', port, body: invalidSample });
    if (ingestBad.status !== 400 || ingestBad.body?.ok !== false) {
      throw new Error('Invalid ingest validation failed');
    }

    console.log('Smoke tests passed.');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
