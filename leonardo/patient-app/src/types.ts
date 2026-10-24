// Shapes match the team's Supabase tables (see leonardo/docs/team-brief.txt).

export type Side = 'left' | 'right';
export type ArmRole = 'healthy' | 'weak';
export type ExerciseId = 'arm_raise' | 'forward_reach' | 'hand_open';

export interface Patient {
  id: string;
  name: string;
  weak_side: Side;
  stroke_date: string;
  phase: number;
  max_raise_angle: number;
  next_checkin: string;
}

export interface PlanExercise {
  name: ExerciseId;
  reps: number;
  target: number;
}

export interface Plan {
  id: string;
  patient_id: string;
  phase: number;
  exercises: PlanExercise[];
  sessions_per_week: number;
  status: 'suggested' | 'approved';
  approved_by: string | null;
  next_checkin: string;
  created_at: string;
}

export interface Session {
  id: string;
  patient_id: string;
  started_at: string;
  pain: number;
  tiredness: number;
  avg_hr: number | null;
  replay_file: string | null;
}

export interface ExerciseResult {
  id: string;
  session_id: string;
  exercise: ExerciseId;
  side: ArmRole;
  best_value: number;
  reps: number;
  sec_per_rep: number;
  smoothness: number;
  fatigue: number;
  trunk_lean_max: number;
  shoulder_hike_max: number;
  comp_rep_pct: number;
}
