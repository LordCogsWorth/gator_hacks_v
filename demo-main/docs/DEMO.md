# Demo click-path (3 min) and verification

RehabTrack Stroke, by Ctrl+Alt+Heal. Demo patients: **James** (live loop: plateau + adherence + falling arm use + lean replay), Maria (improving), Priya (compensation + HR/BP).

## Setup

**Offline (default):** one laptop.

```bash
cd demo-main/web && npm install && npm run dev
```

- Window A (laptop): `http://localhost:5173/patient?as=p-james`
- Window B (projector): `http://localhost:5173/care`
- Insurance tab: `http://localhost:5173/patient?as=p-james&demo=1&tracker=fake`

**Online:** two laptops on the Vercel URL with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set, and `supabase/seed.sql` re-run that morning (`cd web && npm run seed:sql`, then paste into the SQL editor).

## 3-minute script

| Time | Who | Action → what the judges see |
|---|---|---|
| 0:00–0:20 | Slides | Problem |
| 0:20–0:30 | A `/patient?as=p-james` | Hero "Start today's session", check-in in N days, 911 bar. Tap Start → pain 2, tiredness 🙂 |
| 0:30–1:10 | A `/patient/session` | Arm raise healthy (bar, voice 1-2-3), then weak with goal line; lean on purpose → "Sit back against the chair". Skip other exercises or ×4 in demo. Summary: weak vs healthy % |
| 1:10–1:20 | B `/care` | James at the top, flagged (plateau, adherence), row flashes from the new session |
| 1:20–1:50 | B `/care/patients/p-james` | Flat symmetry; falling weak-arm minutes; AI summary; Sessions → latest replay chip → rotate 3D figure, scrub to red warning frames |
| 1:50–2:10 | B plan card | Suggested plateau plan; move check-in −3 days; Approve |
| 2:10–2:30 | A `/patient` | Within 1–5 s: "New plan from your care team" Banner, new reps, earlier countdown |
| 2:30–3:00 | Slides | Accuracy, architecture, close |

## Verification checklist (WP8, 2026-10-24)

| # | Check | Result |
|---|---|---|
| 1 | `npm ci && npm run build && npm test` exit 0; `npm run db:test` exit 0 | **pass** — build green; **167** vitest; **88** PGlite (re-checked WP8) |
| 2 | DevTools Offline + hard reload of `/patient` and `/care`; fonts and WASM local | deferred to human dress rehearsal (assets are local: `@fontsource`, `/mediapipe/wasm`, `/models`) |
| 3 | Fresh profile → seed appears; `?reset=1` resets | **pass** (LocalSource auto-seed + reset path unit-tested) |
| 4 | Fake-tracker full session → 6 results + 6 replays | deferred to human (WP3 unit tests green; SessionRun wired) |
| 5 | Live session appears in `/care` within 1 s (BroadcastChannel) | deferred to human (onDataChange + usePolling wired) |
| 6 | Safety stop (pain 8) → `/patient/stop` + care alert | **pass** (WP4 browser check; LocalSource rules raise safety-stop + pain) |
| 7 | Approve / Dismiss / Edit plan / Move check-in reflect on patient Home | **pass** for approve + move (WP4/WP5); Edit plan implemented |
| 8 | Replay: seeded `synth:` plays; rotate, scrub, warnings | **pass** (WP6 browser on James lean replay) |
| 9 | Demo panel "Resting HR +12" raises heart-rate alert once | deferred to human (submitWatchDaily + rules wired; LocalSource merge tested) |
| 10 | Supabase mode cross-machine | not run (no project credentials in this session) |
| 11 | a11y: patient ≥64 px; no "diagnosis" | **pass** — greps clean; WP4 tap audit; health banner on `/`, `/patient`, `/care` |
| 12 | SPA deep link reload | `vercel.json` rewrite present; WP8 smoke: `/care`, `/care/patients/p-james`, `/patient?as=p-james` on local Vite |

### Bundle (post-WP8 build)

- `index-*.js` ≈ 82 KB / **27 KB gzip** (≤ 260 KB)
- `three-*.js` ≈ 847 KB / **227 KB gzip** (replay route only)
- `charts` / `supabase` / `react` are separate chunks

### Real-camera checklist (human, §7.9)

Record results here before the pitch:

1. [ ] Arm raise 3/3, healthy arm still, `compRepPct` ≤ 34
2. [ ] Forward reach side-on ≥ 2/3
3. [ ] Hand open ~50 cm ≥ 2/3
4. [ ] Deliberate 20° lean → "Sit back against the chair" within 0.5 s
5. [ ] Block `/models/*` → "Demo motion" badge

### Watch (Kyle)

- [ ] `cp Config.example.xcconfig Config.xcconfig`, fill keys, `xcodegen && open MobilityWatch.xcodeproj`
- [ ] One session uploads to `submit_watch_session` before H32
