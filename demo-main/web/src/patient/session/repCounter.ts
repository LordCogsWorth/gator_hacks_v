// Counts reps from a stream of angle / opening values and builds the per-arm metrics of an
// ExerciseResult (CONVERGENCE_PLAN §5.1, §7.4). The app builds results, not the camera module.
// Hysteresis (Stuti's rehab.js): a rep opens when the value leaves rest (> restAt), counts only if it
// reached upAt, and ends back at rest (≤ restAt); a movement that never reaches upAt is discarded.
import type { ExerciseResult } from '../../types';

/** Every ExerciseResult number for one round (exercise + arm). */
export type RoundStats = Omit<ExerciseResult, 'id' | 'sessionId' | 'exercise' | 'side'>;

export interface Thresholds {
  restAt: number;
  upAt: number;
}

/** Numbers measured outside the counter, passed through to the result. */
export interface RoundExtras {
  trunkLeanMax?: number;
  shoulderHikeMax?: number;
  /** hand_open only: lowest opening over the active frames, %. */
  closedMin?: number | null;
}

interface OpenRep {
  t0: number;
  peak: number;
  speeds: number[];
  comp: boolean;
  top: boolean;
  reach: number | null;
}

interface Rep {
  peak: number;
  /** Seconds from leaving rest to being back at rest. */
  dur: number;
  bursts: number;
  comp: boolean;
  reach: number | null;
}

/** Below this many reps the first 3 and last 3 overlap, so fatigue is reported as 1.0 (no drop measured). */
const MIN_REPS_FOR_FATIGUE = 6;
const BURST_MIN_FRACTION = 0.25;

/**
 * Movement smoothness: the number of peaks in the 3-point-smoothed speed curve above 25 % of its maximum.
 * One smooth push is 1 (so a smooth up-and-down rep is about 2); a jerky movement has more.
 */
export function bursts(s: number[]): number {
  const n = s.length;
  if (n < 5) return 1;
  const m = s.map((_, i) => (s[Math.max(0, i - 1)] + s[i] + s[Math.min(n - 1, i + 1)]) / 3);
  const max = Math.max(...m);
  let count = 0;
  for (let i = 1; i < n - 1; i++) if (m[i] > m[i - 1] && m[i] >= m[i + 1] && m[i] > BURST_MIN_FRACTION * max) count++;
  return Math.max(1, count);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export class RepCounter {
  readonly restAt: number;
  readonly upAt: number;
  private reps: Rep[] = [];
  private current: OpenRep | null = null;
  private last: { v: number; t: number } | null = null;
  private maxSeen = 0;

  constructor({ restAt, upAt }: Thresholds) {
    this.restAt = restAt;
    this.upAt = upAt;
  }

  /**
   * Feed one value at frame time `t` (ms). `compensating` is the debounced flag for this frame;
   * `reachM` the working arm's shoulder-to-wrist distance (forward_reach only).
   * Returns true when a rep has just been counted.
   */
  push(v: number, t: number, compensating: boolean, reachM: number | null = null): boolean {
    this.maxSeen = Math.max(this.maxSeen, v);
    const prev = this.last;
    this.last = { v, t };

    if (!this.current && v > this.restAt) this.current = { t0: t, peak: v, speeds: [], comp: false, top: false, reach: null };
    const r = this.current;
    if (!r) return false;

    if (prev && t > prev.t) r.speeds.push(Math.abs(v - prev.v) / ((t - prev.t) / 1000));
    r.peak = Math.max(r.peak, v);
    r.comp ||= compensating;
    r.top ||= v >= this.upAt;
    if (reachM !== null) r.reach = Math.max(r.reach ?? 0, reachM);

    if (v > this.restAt) return false;
    this.current = null;
    if (!r.top) return false;
    this.reps.push({ peak: r.peak, dur: (t - r.t0) / 1000, bursts: bursts(r.speeds), comp: r.comp, reach: r.reach });
    return true;
  }

  get count(): number {
    return this.reps.length;
  }

  stats(extra: RoundExtras = {}): RoundStats {
    const reps = this.reps;
    const n = reps.length;
    const first3 = mean(reps.slice(0, 3).map((r) => r.peak));
    const last3 = mean(reps.slice(-3).map((r) => r.peak));
    const reaches = reps.flatMap((r) => (r.reach === null ? [] : [r.reach]));
    const stats: RoundStats = {
      // With no counted reps the weak arm still gets a number: the highest value seen.
      bestValue: Math.round(n ? Math.max(...reps.map((r) => r.peak)) : this.maxSeen),
      reps: n,
      secPerRep: +mean(reps.map((r) => r.dur)).toFixed(1),
      smoothness: n ? +mean(reps.map((r) => r.bursts)).toFixed(1) : 1,
      // Last 3 reps' peak ÷ first 3 reps' peak (1.0 = no drop). Too few reps to compare: 1.0.
      fatigue: n >= MIN_REPS_FOR_FATIGUE && first3 > 0 ? +(last3 / first3).toFixed(2) : 1,
      trunkLeanMax: extra.trunkLeanMax ?? 0,
      shoulderHikeMax: extra.shoulderHikeMax ?? 0,
      compRepPct: n ? Math.round((reps.filter((r) => r.comp).length / n) * 100) : 0,
    };
    if (reaches.length) stats.reachCm = Math.round(Math.max(...reaches) * 100);
    if (extra.closedMin !== undefined) stats.closedMin = extra.closedMin === null ? null : Math.round(extra.closedMin);
    return stats;
  }
}
