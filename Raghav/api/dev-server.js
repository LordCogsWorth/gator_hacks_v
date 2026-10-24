/**
 * Standalone API server for local development.
 *
 * Listens on port 8081 and mounts the shared router at /api.
 * CORS allows any localhost origin so Lucas's patient app (port 5174)
 * and the care dashboard (port 5173) can call us from the browser.
 *
 * Later, Kyle can mount the same router into main/server/index.js instead:
 *   app.use('/api', require('../../Raghav/api/router'));
 */

const express = require('express');
const cors = require('cors');
const router = require('./router');

const PORT = process.env.PORT || 8081;
const app = express();

// Allow any localhost / 127.0.0.1 origin (any port) during the hackathon.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // curl / same-origin
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  })
);

app.use(express.json({ limit: '2mb' }));
app.use('/api', router);

app.listen(PORT, () => {
  console.log(`RehabTrack API listening on http://localhost:${PORT}`);
  console.log(`  health: http://localhost:${PORT}/api/health`);
});
