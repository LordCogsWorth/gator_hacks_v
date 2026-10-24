/**
 * Standalone API server for local development.
 *
 * Listens on 0.0.0.0:8081 (reachable from other laptops on the same Wi-Fi)
 * and mounts the shared router at /api. The router parses JSON and formats
 * errors itself, so nothing else is needed here except CORS.
 *
 * CORS allows browser origins from:
 *   - localhost / 127.0.0.1 (any port)
 *   - private LAN addresses: 10.x.x.x, 172.16–31.x.x, 192.168.x.x (any port)
 *   - anything listed in ALLOWED_ORIGINS (comma-separated, exact match),
 *     e.g. ALLOWED_ORIGINS=https://rehab.example.com,http://my-laptop.local:5174
 *
 * Later, Kyle can mount the same router into main/server/index.js instead:
 *   app.use('/api', require('../../Raghav/api/router'));
 */

const os = require('os');
const express = require('express');
const cors = require('cors');
const router = require('./router');

const PORT = process.env.PORT || 8081;
const HOST = '0.0.0.0';

const LOCAL_OR_LAN_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

function isAllowedOrigin(origin) {
  return LOCAL_OR_LAN_ORIGIN.test(origin) || EXTRA_ORIGINS.includes(origin);
}

/** IPv4 addresses of this machine's network interfaces (skips 127.0.0.1). */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // curl / same-origin
      return callback(null, isAllowedOrigin(origin));
    },
  })
);

app.use('/api', router);

app.listen(PORT, HOST, () => {
  console.log(`RehabTrack API listening on http://localhost:${PORT}`);
  console.log(`  health: http://localhost:${PORT}/api/health`);
  for (const ip of lanAddresses()) {
    console.log(`  on your LAN: http://${ip}:${PORT}/api`);
  }
  if (EXTRA_ORIGINS.length > 0) {
    console.log(`  extra CORS origins: ${EXTRA_ORIGINS.join(', ')}`);
  }
});
