# RehabTrack — Patient app (Lucas)

The patient side of RehabTrack: today's plan, check-in, guided camera exercises with voice, and the session summary.
Built with React + Vite + TypeScript + Tailwind. Uses fake data for now; no login.

## Run it

You need Node.js 18 or newer.

```bash
cd leonardo/patient-app
npm install
npm run dev
```

Open http://localhost:5173/patient in Chrome and allow the camera.
With no camera (or before Stuti's module is plugged in), the skeleton and numbers are fake demo motion.

## Screens (`src/screens/`)

| Route | Screen | What it does |
| --- | --- | --- |
| `/patient` | `Dashboard.tsx` | Stats, coach avatar with the 3 exercises, start session, care team, progress chart, recent sessions |
| `/patient/checkin` | `CheckIn.tsx` | Pain 0–10 slider + tiredness emoji. Pain 7+ → safety stop |
| `/patient/session` | `SessionRun.tsx` | For each exercise: coach avatar explains it (`components/ExerciseAvatar.tsx`) → camera setup → healthy arm → weak arm. Voice rep count, goal line, "Sit back" warning |
| `/patient/summary` | `Summary.tsx` | "Weak arm reached 64% of your healthy arm — up from 58% last week", streak, save |
| `/patient/stop` | `SafetyStop.tsx` | Pain or dizziness: end the session, show advice |
| `/patient/sessions` | `History.tsx` | Every past session, newest first; tap one for each arm's numbers |
| `/patient/messages` | `Messages.tsx` | Text chat with connected physicians (demo auto-reply until the care dashboard is wired) |
| `/patient/settings` | `Settings.tsx` | Edit name, phone, gender; add a physician by email (sends a request they accept) |

The site layout (sidebar, top bar, red "Call 911" button on every screen) is in `components/Layout.tsx`. The progress chart is `components/ProgressChart.tsx`.

## Where things live

- `src/camera/types.ts`: the **contract with Stuti's camera module** (see below).
- `src/camera/fakeTracker.ts`: fake motion that follows that contract.
- `src/camera/index.ts`: picks which tracker is used. Swapping in Stuti's module is a one-line change here.
- `src/session/repCounter.ts`: counts reps, then computes best value, time per rep, smoothness, fatigue and compensation %.
- `src/api.ts`: every data read and save goes through here. Today it uses fake data plus localStorage; later it switches to Supabase.
- `src/data/fake.ts`: the demo patient (Maria, weak right arm), her plan, and 3 weeks of past sessions.
- `src/data/exercises.ts`: text, camera position and rep thresholds for each exercise.

## For Stuti: camera module contract

The patient app only talks to this interface (full comments in `src/camera/types.ts`):

```ts
interface CameraTracker {
  start(video: HTMLVideoElement): Promise<void>;  // the app opens the webcam and passes the playing <video>
  stop(): void;
  configure(opts: { exercise: 'arm_raise' | 'forward_reach' | 'hand_open'; activeSide: 'left' | 'right' }): void;
  onFrame(cb: (frame: TrackingFrame) => void): () => void;  // returns unsubscribe
}
```

Each `TrackingFrame` has: which shoulders, elbows and wrists are visible; `shoulderAngle`, `elbowAngle` and `handOpening` per side (null when confidence is under 0.5, averaged over 5 frames); `trunkLeanDeg`; `shoulderHike` (active shoulder above the other, as a fraction of shoulder width); and the 13 main joints in 2D (for drawing) and 3D (for the replay).
The patient app does the rep counting, symmetry %, voice and the 15 fps replay sampling.
If your module returns something different, I'll write an adapter on my side so you don't have to change yours.
