# RehabTrack — Project Brief

Hackathon: GatorHack V (36 hours). This file is the reference for anyone (human or coding agent) working on the project.

## 1. What we are building

**Pitch:** Stroke recovery depends on daily repetition at home, but the care team can't see what happens there. RehabTrack measures the weak arm against the healthy arm every session with a camera, tracks heart health and arm use with an Apple Watch, and gives the care team what they need to adjust the plan between visits.

**Scope:** adults with one-sided arm and hand weakness after a stroke, doing seated exercises at home. Not legs, walking, speech or memory.

**Three parts:**

1. **Patient web app** — guided exercise sessions with live camera feedback, today's plan, check-in countdown.
2. **Care-team dashboard** — progress trends, alerts, 3D replay of sessions, one-click approval of the next plan.
3. **Apple Watch data** — native watch app (motion + heart rate) and an iPhone Shortcut (daily Health data).

**Principles:**

- No model training. Pretrained MediaPipe models find body and hand points; our code does geometry.
- The healthy arm is the target. Main progress number = weak arm as a % of the healthy arm ("symmetry %").
- The care team decides. The app suggests; a clinician approves every plan change.
- Not an emergency or diagnostic device. Never use the word "diagnosis" in the UI. The patient app always shows stroke warning signs (face drooping, arm weakness, speech difficulty: call 911).

## 2. Stroke basics (for non-medical teammates)

A stroke happens when blood stops reaching part of the brain. Each side of the brain controls the opposite side of the body, so one side often becomes weak (hemiparesis).

| Problem | What you see | What we measure |
| --- | --- | --- |
| Weakness | Can't lift the arm as high | Arm-raise angle |
| Stiffness (spasticity) | Elbow stays bent, hand curls into a fist | Elbow straightening, hand opening |
| Poor control | Slow, jerky movement | Time per rep, smoothness |
| Compensation ("cheating") | Leans the body or hikes the shoulder to lift the arm | Trunk lean, shoulder hike |
| Learned non-use | Stops using the weak arm | Weak-arm use from the Watch |

Recovery comes from the brain rewiring through lots of repetition (neuroplasticity), ideally daily.

## 3. Team and ownership

| Person | Owns | Folder |
| --- | --- | --- |
| Raghav | Backend API (shared by everyone) + care-team dashboard | `Raghav/` |
| Lucas | Patient web app (calls Raghav's API over HTTP) | `Raghav/web/src/patient/` (moved from `leonardo/patient-app`) |
| Stuti | Camera module: MediaPipe pose + hand tracking, angles, reps, compensation, 3D replay recording | `stuti/` |
| Kyle | Watch app + Express watch server (already in `main/`), iPhone Shortcut, overall integration | `Kyle/`, `main/` |
| Justin | Watch / iPhone data with Kyle | `justin/` |

Rule: each person only edits their own folder. `main/` is the integration folder owned by Kyle. Code is merged into `main/` near the end.

## 4. Rehab workflow (the loop)

0. **Enrollment (once):** care team sets weak side, safe exercises, max arm-raise angle, blood pressure limit.
1. **Daily session:** patient does exercises with the camera, healthy arm first, then weak arm. Quick pain (0–10) and tiredness (1–5) check-in.
2. **Backend:** saves results, runs rules, raises alerts, drafts a suggested next plan.
3. **Care team reviews:** trends, alerts, 3D replay; flagged patients first.
4. **Care team approves the plan:** edits exercises/reps/targets, sets next check-in date.
5. **Patient sees the new plan** and the countdown to the next check-in. Back to step 1.

The Apple Watch feeds the backend daily in parallel (heart rate, blood pressure, activity, weak-arm use).

## 5. Patient session flow (Lucas)

1. Home: big "Start today's session" button, today's exercises, days to next check-in, stroke warning signs link.
2. Check-in: pain slider, tiredness scale.
3. Camera setup: waits until shoulders, elbows and wrists are visible.
4. Each exercise: healthy arm first (sets the target), then weak arm with the healthy arm's mark as the goal. Live warning on lean or shoulder hike.
5. Summary: symmetry % per exercise vs last week.
6. Upload: POST the session and results to the API.

Accessibility: buttons at least 60 px tall, voice prompts, no typing, one-hand use, high contrast.

## 6. Exercises and camera metrics (Stuti)

| Exercise | Camera position | Main number |
| --- | --- | --- |
| `arm_raise` (to the side) | Facing camera, ~2 m | Shoulder angle |
| `forward_reach` | Weak side toward camera | Elbow straightening angle |
| `hand_open` (open / close fist) | Palm toward camera, ~50 cm | Hand opening % |

Per exercise, per arm: best value, reps, seconds per rep, smoothness, fatigue (last 3 reps vs first 3), max trunk lean, max shoulder hike, % of reps with compensation.

Symmetry % = weak arm best ÷ healthy arm best × 100.

3D replay: 13 main joints at 15 fps, estimated 3D coordinates. For watching, not for measuring.

## 7. Apple Watch data (Kyle, Justin)

- **Native watch app** (exists in `main/watch-app/`): streams raw motion (accel, gyro) and heart rate to Kyle's Express server during sessions; receives exercise prompts.
- **iPhone Shortcut:** sends one day of Health data (steps, exercise minutes, stand hours, resting heart rate, HRV, sleep, blood pressure, falls) to `POST /api/watch/daily`.
- **Stretch:** weak-arm active minutes and use ratio (weak ÷ healthy) from wrist motion.
- Always keep a recorded fallback data file for the demo.

## 8. Care team: approvals and alerts (Raghav)

Needs care-team approval: enrollment settings, making exercises harder or easier, changing frequency, setting the next check-in.
Automatic: drafting a suggested plan, raising alerts, reminders, live form corrections, safety stop (pain 7+).

| Alert | Trigger |
| --- | --- |
| plateau | Symmetry flat for 2 weeks |
| setback | Symmetry drops 10+ points |
| compensation | Compensation in over 50% of reps |
| adherence | 3 missed sessions in a row |
| pain | Pain reported 7+ |
| safety-stop | Patient stopped a session early (pain 7+ at check-in, or felt dizzy / unwell) |
| heart-rate | Resting HR 10+ bpm above 2-week average |
| blood-pressure | Systolic above the patient's limit |
| fall | Any fall recorded |

Suggest next phase when symmetry is above target in the last 3 sessions and compensation is under 20%.
Also suggest a same-phase change on a plateau (more reps, easier target on the weakest exercise) or when compensation averages over 50% (fewer reps, lower targets, focus on form). Every suggestion carries a plain-language reason; a clinician approves or dismisses it. Exact rules: `Raghav/api/API.md` → Plans.

## 9. Architecture

- **Kyle's Express server** (`main/server/index.js`, port 8080): watch ingest (`/ingest`, `/ingest/batch`), recording sessions, live stream (`/events`), watch alerts and prompts.
- **Raghav's API** (`Raghav/api`, port 8081 during development): an `express.Router()` for patients, plans, sessions, results, watch daily data and alerts. JSON-file storage. Will be mounted into Kyle's server at `/api` when merging, so the project ends up with one backend.
- **Care dashboard** (`Raghav/web`, `/care` area): React + Vite + TypeScript + Tailwind + Recharts (+ Three.js for replay).
- **Patient app** (Lucas): the `/patient` area of the same web app as the dashboard (`Raghav/web`); calls Raghav's API; uses Stuti's camera module through the `CameraTracker` contract.
- All camera processing runs in the patient's browser; no video is uploaded, only numbers and skeleton recordings.

There is no Supabase. Do not add another backend.

## 10. Demo (3 minutes)

1. Problem in one line.
2. Patient: arm raise, healthy then weak arm; live feedback; lean warning; summary.
3. Care team: flagged patient, plateau, watch trends, 3D replay showing the lean; approve the suggested plan, move check-in earlier.
4. Patient home shows the new plan.
5. Close: accuracy number on a public stroke dataset; next steps.

Demo patients: Maria (improving), James (plateau, missed sessions), Priya (compensating, resting HR rising).
