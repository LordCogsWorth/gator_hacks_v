# Watch daily data: iPhone Shortcut → Supabase

Gets the Apple Health data that the watch app doesn't collect (blood pressure, falls, walking steadiness, steps…) from the
patient's iPhone into Supabase, once a day. This is contract §6 in [`Raghav/docs/CONTRACTS.md`](../../Raghav/docs/CONTRACTS.md),
with Supabase as the backend instead of `POST /api/watch/daily`.

```
Apple Watch ──(syncs on its own)──▶ iPhone Health app ──Shortcut──▶ Supabase ◀── care-team dashboard (signed in)
```

Everything goes over the internet, so the iPhone, the Mac and the clinician can be on any network (or cellular).

| File | What it is |
|------|------------|
| [`schema.sql`](schema.sql) | Table, access rules and the `submit_watch_daily` function. Run once in Supabase. |
| [`check.html`](check.html) | Small sign-in page that lists the rows, to check data is arriving. Not the real dashboard (that's Raghav's). |

## How it works

- The Shortcut POSTs the **contract JSON exactly** (`patientId`, `date`, `steps`, `restingHr`, `bpSys`…) to
  `https://<project>.supabase.co/rest/v1/rpc/submit_watch_daily`.
- That function checks the body and saves it to the `watch_daily` table. Posting the same `patientId` + `date`
  again replaces that day. Missing fields are saved as empty, and numbers sent as text (`"1,234"`) are accepted.
- The anon key (built into the Shortcut) can **only call that function**. It can't read or change the table.
- **Only signed-in users can read** the table. Create clinician accounts in Supabase → Authentication.

### Table columns (for whoever reads the data)

The table uses Postgres-style names; the function maps the contract names onto them:

| Contract field | Column |
|---|---|
| `patientId` | `patient_id` |
| `date` | `date` |
| `steps`, `falls` | same |
| `exerciseMin`, `standHr`, `restingHr` | `exercise_min`, `stand_hr`, `resting_hr` |
| `bpSys`, `bpDia` | `bp_sys`, `bp_dia` |
| `walkingSteadiness` | `walking_steadiness` |
| `weakArmActiveMin`, `useRatio` | `weak_arm_active_min`, `use_ratio` |

**Changes from contract §6** (tell Raghav so `CONTRACTS.md` and the dashboard match):

- Removed `hrv` and `sleepHr`: weak signals for stroke follow-up. An older Shortcut that still sends them is fine; they're ignored.
- Added `walkingSteadiness`: iPhone Walking Steadiness %, Apple's fall-risk score. Measured by the iPhone while walking.
- Walking steadiness may be sent as `0.85` or `85`; both are stored as 85. A value of 0 for resting HR, blood
  pressure or walking steadiness is stored as empty, since Shortcuts sends 0 when there's no reading.

Plus `created_at` and `updated_at`. Example read with supabase-js (signed in):
`supabase.from('watch_daily').select('*').eq('patient_id', 'p-maria').order('date')`.

## Setup

### 1. Supabase (once, in a browser)

1. Open the team's Supabase project (or create one at https://supabase.com).
2. **SQL Editor** → paste all of [`schema.sql`](schema.sql) → **Run**.
3. **Authentication → Users → Add user**: create a login for yourself (and each clinician).
   Tick "Auto Confirm User".
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Check it works without the phone

Open [`check.html`](check.html) in a browser (double-click it). Under **Supabase project**, paste the URL
and key, then sign in with the user from step 1.3. Click **Send test row**: a `p-test` row should appear.

### 3. Build the Shortcut (on the iPhone paired with the watch)

AirDrop the URL and anon key to the phone so you can paste them. In Shortcuts, tap **+** and add these
actions in order (search for each by name):

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

- URL: `https://YOUR-PROJECT.supabase.co/rest/v1/rpc/submit_watch_daily`
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

Tap ▶. Success shows `{"ok": true, "patientId": "p-maria", "date": "…", "updatedAt": "…"}`, and the row
appears on `check.html` within a few seconds. iOS asks for Health permission on the first run.

**Adding more metrics:** repeat steps 7–9 for each Health type, then add a JSON field named exactly as in the
contract:

| Health type | How to read it | JSON field |
|---|---|---|
| Exercise Minutes | Start Date is today, Group By Day → Calculate Statistics → Sum | `exerciseMin` |
| Stand Minutes | Start Date is today, Group By **Hour** → Count Items | `standHr` |
| Blood Pressure Systolic / Diastolic | Last 7 days, Latest First, Limit 1 → Get Details → Value | `bpSys` / `bpDia` |
| Number of Times Fallen | Start Date is today → Calculate Statistics → Sum | `falls` |
| Walking Steadiness | Last 30 days, Latest First, Limit 1 → Get Details → Value | `walkingSteadiness` |

Each one ends with **Set Variable** (named like the JSON field), placed above Get Contents of URL.
Walking Steadiness is updated about once a week, hence the longer date range, and needs the iPhone carried
while walking. Falls need **Fall Detection** on: iPhone's Watch app → **Emergency SOS → Fall Detection**.

### 4. Run it daily

Shortcuts → **Automation** → **+** → **Time of Day** (e.g. 9 PM, when the day is mostly done and the phone is
usually unlocked; Health data can't be read while it's locked) → **Run Immediately** → choose the Shortcut.
Running it again the same day replaces that day's row.

## 5. Share it with patients (one tap to install)

Build the Shortcut once (step 3), then share it. Patients don't build anything.

**Ask for the patient ID on install** (so each patient sends their own ID instead of `p-maria`):

1. Open the Shortcut in the editor and tap the **ⓘ** (or the name at the top → **Details**).
2. Go to **Setup** → **Add Question**. Choose the `patientId` value in the Get Contents of URL body.
3. Question: "Enter the patient ID from your care team". Default answer: leave blank.

**Get the link:**

1. In the Shortcuts list, long-press the Shortcut → **Share** → **Copy iCloud Link**.
2. Send the link to the patient (text or email), or turn it into a QR code for a printed handout.

**What the patient does:**

1. Open the link on their iPhone → **Add Shortcut** → type their patient ID when asked.
2. Run it once and tap **Allow** for Health access.
3. Set up the daily automation (step 4). Automations aren't included in shared links, so the patient
   has to do this one themselves, or the care team does it with them at enrollment. It's about five taps.

If you change the Shortcut later, copy a new iCloud link. Patients who already added the old one keep the
old version until they add the new one.

## Troubleshooting

| Shortcut result | Fix |
|-----------------|-----|
| `Invalid API key` / 401 | Re-paste the anon key in both `apikey` and `Authorization` |
| `Could not find the function` / 404 | Run `schema.sql`; check the URL ends in `/rest/v1/rpc/submit_watch_daily` |
| `patientId is required` | JSON field must be named exactly `patientId` |
| `date must be YYYY-MM-DD` | Check the Format Date custom format is `yyyy-MM-dd` |
| `steps must be a number` | That variable isn't a number; check the Health action before it |
| Steps is empty | No data for today yet; add a sample in the Health app to test |

## Security note

Any device with the anon key can *submit* data for any `patientId`, but nobody can read data without
signing in. Fine for the hackathon. For real patients, give each patient their own login or upload token,
and limit clinicians to their own patients.
