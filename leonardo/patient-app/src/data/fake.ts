// Hardcoded demo data. Dates are relative to today so the demo always looks current.
import type { ExerciseId, ExerciseResult, Patient, Plan, Session } from '../types';

const DAY = 86_400_000;
const daysFromNow = (n: number, hour = 10) => {
  const d = new Date(Date.now() + n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const fakePatient: Patient = {
  id: 'p1',
  name: 'Maria',
  weak_side: 'right',
  stroke_date: daysFromNow(-70).slice(0, 10),
  phase: 1,
  max_raise_angle: 120,
  next_checkin: daysFromNow(5).slice(0, 10),
};

export const fakePlan: Plan = {
  id: 'plan1',
  patient_id: 'p1',
  phase: 1,
  exercises: [
    { name: 'arm_raise', reps: 8, target: 90 },
    { name: 'forward_reach', reps: 8, target: 150 },
    { name: 'hand_open', reps: 8, target: 70 },
  ],
  sessions_per_week: 5,
  status: 'approved',
  approved_by: 'Dr. Patel',
  next_checkin: fakePatient.next_checkin,
  created_at: daysFromNow(-14),
};

// Healthy-arm best and the weak arm's symmetry % creeping up over three weeks.
const HEALTHY_BEST: Record<ExerciseId, number> = { arm_raise: 150, forward_reach: 172, hand_open: 92 };
const START_SYM: Record<ExerciseId, number> = { arm_raise: 50, forward_reach: 70, hand_open: 52 };

// Session days, as days ago. Most recent four in a row gives a 4-day streak.
const SESSION_DAYS = [21, 20, 18, 17, 15, 14, 13, 11, 10, 8, 7, 6, 4, 3, 2, 1];

export const fakeSessions: Session[] = [];
export const fakeResults: ExerciseResult[] = [];

SESSION_DAYS.forEach((ago, i) => {
  const id = `hist${i}`;
  fakeSessions.push({
    id,
    patient_id: 'p1',
    started_at: daysFromNow(-ago),
    pain: 2 + (i % 3),
    tiredness: 2 + (i % 2),
    avg_hr: 88 + (i % 5),
    replay_file: null,
  });
  (Object.keys(HEALTHY_BEST) as ExerciseId[]).forEach((ex) => {
    const healthy = HEALTHY_BEST[ex];
    const sym = START_SYM[ex] + i * 0.6;
    const base = { session_id: id, exercise: ex, reps: 8, sec_per_rep: 3.2, smoothness: 1.5, fatigue: 5, trunk_lean_max: 6, shoulder_hike_max: 0.04, comp_rep_pct: 10 };
    fakeResults.push({ ...base, id: `${id}-${ex}-h`, side: 'healthy', best_value: healthy });
    fakeResults.push({ ...base, id: `${id}-${ex}-w`, side: 'weak', best_value: Math.round((healthy * sym) / 100), sec_per_rep: 4.1, smoothness: 3, comp_rep_pct: 25 });
  });
});
