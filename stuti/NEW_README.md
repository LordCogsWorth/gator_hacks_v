# ArmSense: Apple Watch arm-movement tracking

A local ingest service and live dashboard for motion data from an Apple Watch. The dashboard uses the camera and the watch together to measure arm raise, hold time, wrist height, steps, arm use ratio, improvement since the last session, and affected vs healthy side.

## Data contract

`POST /ingest` expects JSON:

- `timestamp` (ISO-8601 string)
- `accel`: `{ x, y, z }` (numbers, in g, including gravity)
- `gyro`: `{ x, y, z }` (numbers, in rad/s)
- `heartRate` (optional number)
- `source` (must be exactly `Apple Watch`)
- `sessionId` (non-empty string)

Send about 20 to 50 samples per second. Gaps longer than 0.2 s are ignored by hold-time tracking.

## Files

- `server/` ingest service (`npm start`)
- `app.js` dashboard logic (camera, 3D model, test)
- `armsense.js` metrics module imported by `app.js` (keep it in the same folder)
- `index.html` must load the dashboard with `<script type="module" src="app.js"></script>`

## Run it

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open `http://localhost:8080` in Chrome or Edge. Allow camera access.

4. In another terminal, send demo data (about 20 samples per second):

```bash
while true; do curl -s -X POST http://localhost:8080/simulate > /dev/null; sleep 0.05; done
```

Or send one sample by hand:

```bash
curl -X POST http://localhost:8080/ingest -H 'Content-Type: application/json' -d '{"timestamp":"2026-10-24T10:00:00.000Z","accel":{"x":0.02,"y":0.98,"z":0.05},"gyro":{"x":0.01,"y":0,"z":0},"heartRate":80,"source":"Apple Watch","sessionId":"s-001"}'
```

5. Enter the person's standing height, choose the affected side, and click **Analyze**. Raise both arms and hold for a moment.

## Using a real watch

- The watchOS app must POST to `http://<computer-LAN-IP>:8080/ingest`. The watch and computer must be on the same Wi-Fi, and the server must listen on `0.0.0.0`.
- Local HTTP needs an App Transport Security exception in the watch app during development.
- For the arm use ratio, record one session with the watch on each wrist (same task and location).

## Endpoints

- `GET /health` health check
- `GET /latest` most recently received sample
- `GET /events` Server-Sent Events stream for the live dashboard
- `POST /ingest` append a sample to `server/data/movement_log.jsonl`
- `POST /simulate` generate one synthetic sample

## Tests

```bash
npm test
```

## Notes

- Session history is stored in the browser (`armsenseHistory`), so improvement % compares with the last session on the same browser.
- This is a research and monitoring tool, not a medical device. Validate on healthy volunteers before use with patients.
- Empty directories are tracked using `.gitkeep`.