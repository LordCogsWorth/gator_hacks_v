// Counts reps from a stream of angle / opening values and builds the per-arm metrics of an
// ExerciseResult (Raghav/docs/CONTRACTS.md §3). The app builds results, not the camera module.
import type { ExerciseResult } from '../../types';

interface Rep {
  start: number;
  peak: number;
  speedBursts: number;
  compensated: boolean;
}

/** Every ExerciseResult number for one round (exercise + arm). */
export type RoundStats = Omit<ExerciseResult, 'id' | 'sessionId' | 'exercise' | 'side'>;

/** Below this many reps the first 3 and last 3 overlap, so fatigue is reported as 1.0 (no drop measured). */
const MIN_REPS_FOR_FATIGUE = 6;

export class RepCounter {
  private reps: Rep[] = [];
  private current: Rep | null = null;
  private lastBelowRest = 0;
  private last: { v: number; t: number } | null = null;
  private lastSpeed = 0;
  private rising = false;
  private bestSeen = 0;
  private leanMax = 0;
  private hikeMax = 0;

  constructor(private restAt: number, private upAt: number) {}

  /** Feed one smoothed value (lean in degrees, hike in metres). Returns true when a rep has just been completed. */
  push(v: number, t: number, compensating: boolean, lean: number, hike: number): boolean {
    this.bestSeen = Math.max(this.bestSeen, v);
    this.leanMax = Math.max(this.leanMax, lean);
    this.hikeMax = Math.max(this.hikeMax, hike);

    // Smoothness: count bursts of speed (local speed peaks) while a rep is under way.
    if (this.last && t > this.last.t) {
      const speed = Math.abs(v - this.last.v) / ((t - this.last.t) / 1000);
      const nowRising = speed > this.lastSpeed;
      if (this.current && this.rising && !nowRising && this.lastSpeed > 15) this.current.speedBursts++;
      this.rising = nowRising;
      this.lastSpeed = speed;
    }
    this.last = { v, t };

    if (v < this.restAt) {
      this.lastBelowRest = t;
      if (this.current) {
        this.reps.push(this.current);
        this.current = null;
        return true;
      }
    } else if (!this.current && v > this.upAt) {
      this.current = { start: this.lastBelowRest || t, peak: v, speedBursts: 0, compensated: false };
    }
    if (this.current) {
      this.current.peak = Math.max(this.current.peak, v);
      if (compensating) this.current.compensated = true;
    }
    return false;
  }

  get count() {
    return this.reps.length;
  }

  stats(): RoundStats {
    const reps = this.reps;
    const n = reps.length;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const starts = reps.map((r) => r.start);
    const gaps = starts.slice(1).map((s, i) => (s - starts[i]) / 1000);
    const first3 = avg(reps.slice(0, 3).map((r) => r.peak));
    const last3 = avg(reps.slice(-3).map((r) => r.peak));
    return {
      bestValue: Math.round(n ? Math.max(...reps.map((r) => r.peak)) : this.bestSeen),
      reps: n,
      secPerRep: +avg(gaps).toFixed(1),
      smoothness: +avg(reps.map((r) => Math.max(1, r.speedBursts))).toFixed(1),
      // Last 3 reps' reach ÷ first 3 reps' reach (1.0 = no drop). Too few reps to compare: 1.0.
      fatigue: n >= MIN_REPS_FOR_FATIGUE && first3 > 0 ? +(last3 / first3).toFixed(2) : 1,
      trunkLeanMax: Math.round(this.leanMax),
      shoulderHikeMax: +this.hikeMax.toFixed(3),
      compRepPct: n ? Math.round((reps.filter((r) => r.compensated).length / n) * 100) : 0,
    };
  }
}
