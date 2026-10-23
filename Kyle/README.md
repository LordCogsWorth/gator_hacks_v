# Kyle Movement Tracking (Apple Watch)

This folder contains a local ingest service for motion data from **Kyle's Apple Watch**.

## Data contract

POST `/ingest` expects JSON:

- `timestamp` (ISO-8601 string)
- `accel`: `{ x, y, z }` (numbers)
- `gyro`: `{ x, y, z }` (numbers)
- `heartRate` (optional number)
- `source` (must be exactly `Kyle's Apple Watch`)
- `sessionId` (non-empty string)

## Quick start

1. Install dependencies:

```bash
cd Kyle
npm install
```

2. Run server:

```bash
npm start
```

Server runs on `http://localhost:8080`.

## Endpoints

- `GET /health` → health check
- `POST /ingest` → append a movement sample to `server/data/movement_log.jsonl`

## Run smoke tests

```bash
cd Kyle
npm test
```

## Notes

- Empty directories are tracked using `.gitkeep`.
- Keep watch source as `Kyle's Apple Watch` for validation consistency.
