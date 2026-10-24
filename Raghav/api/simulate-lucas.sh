#!/usr/bin/env bash
# Simulates Lucas's patient app uploading sessions for p-maria:
#   1. a good session  -> expect 201 (session saved, rules run)
#   2. a bad session   -> expect 400 with every field error listed, nothing saved
#
# Usage: bash simulate-lucas.sh [base-url]
#   default base-url: http://localhost:8081/api  (use the API's "on your LAN" URL from another laptop)

set -euo pipefail
BASE="${1:-http://localhost:8081/api}"
NOW_MS=$(( $(date +%s) * 1000 ))
START_MS=$(( NOW_MS - 12 * 60 * 1000 ))   # session started 12 minutes ago

# Preflight: GET /config only exists in the current API. A 404 means the server
# on this port is still running old code (restart `npm start`), which would
# save bad data instead of rejecting it.
CONFIG_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/config" || true)
if [ "$CONFIG_STATUS" != "200" ]; then
  echo "!! $BASE/config returned HTTP $CONFIG_STATUS."
  echo "!! The API is not running, or is running old code. Restart it: cd Raghav/api && npm start"
  exit 1
fi

count_sessions() {
  curl -s "$BASE/patients/p-maria/sessions" | grep -o '"id":"sess-' | wc -l | tr -d ' '
}

echo "== Maria's sessions before: $(count_sessions)"

echo
echo "== 1. Good session (epoch-ms timestamps, 6 results)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/sessions" \
  -H 'Content-Type: application/json' \
  -d @- <<JSON
{
  "patientId": "p-maria",
  "startedAt": $START_MS,
  "endedAt": $NOW_MS,
  "pain": 2,
  "tiredness": 2,
  "results": [
    { "exercise": "arm_raise",     "side": "healthy", "bestValue": 162, "reps": 10, "secPerRep": 3.0, "smoothness": 1.1, "fatigue": 0.98, "trunkLeanMax": 3, "shoulderHikeMax": 0.01, "compRepPct": 0 },
    { "exercise": "arm_raise",     "side": "weak",    "bestValue": 116, "reps": 10, "secPerRep": 4.1, "smoothness": 2.2, "fatigue": 0.92, "trunkLeanMax": 6, "shoulderHikeMax": 0.02, "compRepPct": 10 },
    { "exercise": "forward_reach", "side": "healthy", "bestValue": 150, "reps": 10, "secPerRep": 3.2, "smoothness": 1.2, "fatigue": 0.97, "trunkLeanMax": 3, "shoulderHikeMax": 0.01, "compRepPct": 0 },
    { "exercise": "forward_reach", "side": "weak",    "bestValue": 108, "reps": 10, "secPerRep": 4.4, "smoothness": 2.5, "fatigue": 0.90, "trunkLeanMax": 7, "shoulderHikeMax": 0.02, "compRepPct": 10 },
    { "exercise": "hand_open",     "side": "healthy", "bestValue": 90,  "reps": 12, "secPerRep": 2.5, "smoothness": 1.0, "fatigue": 0.99, "trunkLeanMax": 2, "shoulderHikeMax": 0.01, "compRepPct": 0 },
    { "exercise": "hand_open",     "side": "weak",    "bestValue": 65,  "reps": 12, "secPerRep": 3.6, "smoothness": 2.0, "fatigue": 0.93, "trunkLeanMax": 4, "shoulderHikeMax": 0.01, "compRepPct": 8 }
  ]
}
JSON

echo
echo "== 2. Bad session (epoch SECONDS, pain 14, unknown exercise, reps as text, compRepPct 140)"
curl -s -w '\nHTTP %{http_code}\n' -X POST "$BASE/sessions" \
  -H 'Content-Type: application/json' \
  -d @- <<JSON
{
  "patientId": "p-maria",
  "startedAt": $(( START_MS / 1000 )),
  "endedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pain": 14,
  "results": [
    { "exercise": "jumping_jacks", "side": "weak", "bestValue": 100, "reps": "ten", "secPerRep": 4, "smoothness": 2, "fatigue": 0.9, "trunkLeanMax": 6, "shoulderHikeMax": 0.02, "compRepPct": 140 }
  ]
}
JSON

echo
echo "== Maria's sessions after: $(count_sessions)  (should be before + 1: the bad upload wrote nothing)"
echo "== API still healthy: $(curl -s -o /dev/null -w '%{http_code}' "$BASE/patients")"
