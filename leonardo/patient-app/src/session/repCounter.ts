// Counts reps from a stream of angle / opening values and builds the per-arm metrics in the brief.

interface Rep {
  start: number;
  peak: number;
  speedBursts: number;
  compensated: boolean;
}

export interface RoundStats {
  best_value: number;
  reps: number;
  sec_per_rep: number;
  smoothness: number;
  fatigue: number;
  trunk_lean_max: number;
  shoulder_hike_max: number;
  comp_rep_pct: number;
}

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

  /** Feed one smoothed value. Returns true when a rep has just been completed. */
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
      best_value: Math.round(n ? Math.max(...reps.map((r) => r.peak)) : this.bestSeen),
      reps: n,
      sec_per_rep: +avg(gaps).toFixed(1),
      smoothness: +avg(reps.map((r) => Math.max(1, r.speedBursts))).toFixed(1),
      // % drop in reach from the first 3 reps to the last 3 (needs at least 4 reps).
      fatigue: n >= 4 && first3 > 0 ? Math.round(((first3 - last3) / first3) * 100) : 0,
      trunk_lean_max: Math.round(this.leanMax),
      shoulder_hike_max: +this.hikeMax.toFixed(2),
      comp_rep_pct: n ? Math.round((reps.filter((r) => r.compensated).length / n) * 100) : 0,
    };
  }
}
