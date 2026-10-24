// Rest pose for one round (exercise + arm), collected while the countdown runs (CONVERGENCE_PLAN §7.2).
// Lean and shoulder hike are then measured from this pose, so camera tilt and posture don't count as compensation,
// and the rep thresholds start from where this patient's arm actually rests.
import { add, angleDeg, normalize, type Vec3 } from '../../camera/geometry';

export interface BaselineSample {
  trunkVec: Vec3 | null;
  /** TrackingFrame.shoulderHike (absolute, fraction of shoulder width). */
  hike: number | null;
  /** This exercise's reading (shoulder or elbow angle); null where it isn't baseline-relative (hand_open). */
  value: number | null;
}

export interface Baseline {
  /** Mean resting trunk direction (unit vector). */
  T0: Vec3;
  hike0: number;
  v0: number | null;
  /** False when accepted on timeout before the window was steady. */
  stable: boolean;
}

export const BASELINE_FRAMES = 15;
export const BASELINE_TIMEOUT_MS = 4000;
const MAX_TRUNK_SPREAD_DEG = 3;
const MAX_HIKE_STD = 0.02;
const MAX_VALUE_STD = 4;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export class RestBaseline {
  private window: (BaselineSample & { trunkVec: Vec3 })[] = [];

  /** Add one frame. Frames without a trunk vector are skipped. */
  push(s: BaselineSample): void {
    if (!s.trunkVec) return;
    this.window.push({ ...s, trunkVec: s.trunkVec });
    if (this.window.length > BASELINE_FRAMES) this.window.shift();
  }

  get size(): number {
    return this.window.length;
  }

  /** A full window where the trunk, shoulder and arm all held still. */
  get ready(): boolean {
    const w = this.window;
    if (w.length < BASELINE_FRAMES) return false;
    const T = this.meanTrunk();
    if (!T || w.some((s) => (angleDeg(s.trunkVec, T) ?? 0) >= MAX_TRUNK_SPREAD_DEG)) return false;
    if (std(this.hikes()) >= MAX_HIKE_STD) return false;
    return std(this.values()) < MAX_VALUE_STD;
  }

  /** The baseline now: steady if `ready`, else the current window as it is (timeout), or null with no trunk frames at all. */
  result(): Baseline | null {
    const T0 = this.meanTrunk();
    if (!T0) return null;
    const hikes = this.hikes();
    const values = this.values();
    return {
      T0,
      hike0: hikes.length ? mean(hikes) : 0,
      v0: values.length ? mean(values) : null,
      stable: this.ready,
    };
  }

  private meanTrunk(): Vec3 | null {
    if (!this.window.length) return null;
    return normalize(this.window.reduce((sum, s) => add(sum, s.trunkVec), { x: 0, y: 0, z: 0 }));
  }

  private hikes(): number[] {
    return this.window.flatMap((s) => (s.hike === null ? [] : [s.hike]));
  }

  private values(): number[] {
    return this.window.flatMap((s) => (s.value === null ? [] : [s.value]));
  }
}
