# iPhone Shortcut → Supabase (watch daily data, Route A)

Gets the Apple Health data that the watch app doesn't collect (steps, resting heart rate, blood pressure, falls,
walking steadiness…) from the patient's iPhone into Supabase once a day. The care dashboard (`/care`) charts it and
the rules engine raises heart-rate, blood-pressure and fall alerts from it.

```
Apple Watch ──(syncs on its own)──▶ iPhone Health app ──Shortcut──▶ Supabase rpc/submit_watch_daily ──▶ watch_daily ◀── /care
```

Everything goes over the internet, so the iPhone and the clinician can be on any network (or cellular).
Adapted from Justin's `justin/watch-daily/README.md`. The backend is `demo-main/supabase/migrations/0001_init.sql`.

## How it works

- The Shortcut POSTs the contract JSON as-is to `https://<project-ref>.supabase.co/rest/v1/rpc/submit_watch_daily`
  with the anon key.
- The function checks the body and saves it to `watch_daily` (one row per patient per day).
- **Merge semantics:** posting the same `patientId` + `date` again **updates only the fields you send**. Omitted or
  blank fields keep their previous value, so you can send heart rate in one run and blood pressure in another.
  (Justin's original version replaced the whole day; this one merges.)
- Numbers may be sent as text with commas (`"1,234"`).
- A value of **0** for `restingHr`, `hrv`, `bpSys`, `bpDia` or `walkingSteadiness` means "no reading" (Shortcuts sends 0
  when there is no data) and keeps the previous value.
- `walkingSteadiness` may be `0.85` or `85`; both are stored as 85.
- The `patientId` must already exist (`p-maria`, `p-james`, `p-priya` in the demo). Unknown ids are rejected.
- Out-of-range values (for example `bpSys: 99999`), `NaN`, `Infinity`, impossible dates (`2026-02-30`) and dates more
  than one day in the future are rejected with an error message.
- The anon key can only call the write functions; it cannot write tables directly. In this demo anyone with the anon
  key can also **read** the (fake) data, so the dashboard works without a login.

### Fields

| JSON field | Column | Notes |
|---|---|---|
| `patientId` | `patient_id` | required, must exist |
| `date` | `date` | required, `YYYY-MM-DD` |
| `steps` | `steps` | 0–100000 |
| `exerciseMin` | `exercise_min` | 0–1440 |
| `standHr` | `stand_hr` | 0–24 |
| `restingHr` | `resting_hr` | 25–220, 0 = no reading |
| `hrv` | `hrv` | optional, 0–300, not charted |
| `sleepHr` | `sleep_hr` | optional, 0–24, not charted |
| `bpSys` / `bpDia` | `bp_sys` / `bp_dia` | 50–260 / 30–160, 0 = no reading |
| `falls` | `falls` | 0–50 |
| `walkingSteadiness` | `walking_steadiness` | 0–100 %, not charted |
| `weakArmActiveMin`, `useRatio` | `weak_arm_active_min`, `use_ratio` | not from the Shortcut; seeded demo data |

Success returns the stored day, for example
`{"ok": true, "patientId": "p-maria", "date": "2026-10-24", "steps": 4210, "restingHr": 68, …, "updatedAt": "…"}`.

## 1. Supabase (once)

Apply the migration and seed as described in [`../supabase/README.md`](../supabase/README.md). Then, in
**Project Settings → API**, copy the **Project URL** and the **anon public** key.

## 2. Check it works without the phone

```sh
curl -s "https://<project-ref>.supabase.co/rest/v1/rpc/submit_watch_daily" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
  -d '{"patientId":"p-maria","date":"'"$(date +%F)"'","steps":"4,210","restingHr":68}'
# then merge a second reading into the same day:
curl -s "https://<project-ref>.supabase.co/rest/v1/rpc/submit_watch_daily" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
  -d '{"patientId":"p-maria","date":"'"$(date +%F)"'","bpSys":128,"bpDia":80}'
```
The second response still shows `steps` and `restingHr` from the first. You can also open
[`../tools/watch-check.html`](../tools/watch-check.html) in a browser, paste the URL and anon key, and click
**Send test row**.

## 3. Build the Shortcut (on the iPhone paired with the watch)

AirDrop the URL and anon key to the phone so you can paste them. In Shortcuts, tap **+** and add these actions in
order (search for each by name):

| # | Action | Settings |
|---|--------|----------|
| 1 | **Date** | Current Date |
| 2 | **Format Date** | Date Format: Custom → `yyyy-MM-dd` |
| 3 | **Set Variable** | Name: `date` |
| 4 | **Find Health Samples** | Type **Steps**, filter: Start Date **is today** |
| 5 | **Calculate Statistics** | **Sum** of Health Samples |
| 6 | **Set Variable** | Name: `steps` |
| 7 | **Find Health Samples** | Type **Resting Heart Rate**, Sort by Start Date, Latest First, Limit **1** |
| 8 | **Get Details of Health Sample** | **Value** |
| 9 | **Set Variable** | Name: `restingHr` |
| 10 | **Get Contents of URL** | see below |
| 11 | **Show Result** | (delete once it works) |

**Get Contents of URL** (tap "Show More"):

- URL: `https://YOUR-PROJECT-REF.supabase.co/rest/v1/rpc/submit_watch_daily`
- Method: **POST**
- Headers:
  - `apikey` = *anon key*
  - `Authorization` = `Bearer ` + *anon key* (one space after Bearer)
  - `Content-Type` = `application/json`
- Request Body: **JSON**
  - `patientId` (Text) = `p-maria` (the patient's ID)
  - `date` (Text) = variable `date`
  - `steps` (Number) = variable `steps`
  - `restingHr` (Number) = variable `restingHr`

Tap ▶. Success shows `{"ok": true, "patientId": "p-maria", "date": "…", …}`. iOS asks for Health permission on the
first run.

**Adding more metrics:** repeat steps 7–9 for each Health type, then add a JSON field named exactly as in the table:

| Health type | How to read it | JSON field |
|---|---|---|
| Exercise Minutes | Start Date is today, Group By Day → Calculate Statistics → Sum | `exerciseMin` |
| Stand Minutes | Start Date is today, Group By **Hour** → Count Items | `standHr` |
| Blood Pressure Systolic / Diastolic | Last 7 days, Latest First, Limit 1 → Get Details → Value | `bpSys` / `bpDia` |
| Number of Times Fallen | Start Date is today → Calculate Statistics → Sum | `falls` |
| Walking Steadiness | Last 30 days, Latest First, Limit 1 → Get Details → Value | `walkingSteadiness` |

Each one ends with **Set Variable** (named like the JSON field), placed above Get Contents of URL. Walking Steadiness
updates about once a week and needs the iPhone carried while walking. Falls need **Fall Detection** on: iPhone's
Watch app → **Emergency SOS → Fall Detection**.

## 4. Run it daily

Shortcuts → **Automation** → **+** → **Time of Day** (e.g. 9 PM, when the day is mostly done and the phone is usually
unlocked; Health data can't be read while it's locked) → **Run Immediately** → choose the Shortcut. Running it again
the same day updates that day's row (merge).

## 5. Share it with patients (one tap to install)

**Ask for the patient ID on install:**
1. Open the Shortcut in the editor and tap the **ⓘ** (or the name at the top → **Details**).
2. **Setup** → **Add Question**. Choose the `patientId` value in the Get Contents of URL body.
3. Question: "Enter the patient ID from your care team". Default answer: blank.

**Get the link:** long-press the Shortcut → **Share** → **Copy iCloud Link**, and send it (or print it as a QR code).

**What the patient does:** open the link → **Add Shortcut** → type their patient ID → run it once and **Allow** Health
access → set up the daily automation (step 4; automations are not included in shared links).

If you change the Shortcut later, share a new iCloud link.

## Troubleshooting

| Shortcut result | Fix |
|-----------------|-----|
| `Invalid API key` / 401 | Re-paste the anon key in both `apikey` and `Authorization` |
| `Could not find the function` / 404 with no `Unknown patient` text | Apply `0001_init.sql`; check the URL ends in `/rest/v1/rpc/submit_watch_daily` |
| `Unknown patient` (404) | The `patientId` isn't in `patients`. Use a demo id, or re-run `seed.sql` |
| `patientId is required` | JSON field must be named exactly `patientId` |
| `date must be YYYY-MM-DD` / `date must be a real YYYY-MM-DD` | Check the Format Date custom format is `yyyy-MM-dd` |
| `steps must be a number` | That variable isn't a number; check the Health action before it |
| `violates check constraint "watch_daily_bp_sys_check"` | A value is out of range (see the Fields table) |
| Steps is empty | No data for today yet; add a sample in the Health app to test |

## Security note

Any device with the anon key can *submit* data for an existing demo `patientId` and can read the demo tables. Fine
for a hackathon with fake data. For real patients: give each patient their own login or upload token, replace the
`demo_read` policies with per-clinician access, and rotate the anon key.
