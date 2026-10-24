// Trunk lean and shoulder hike during the active part of a round, measured from the rest baseline
// (CONVERGENCE_PLAN §7.3). Only a debounced `compensating` drives the banner, the voice, replay warnings
// and the rep's comp flag, so a single noisy frame never counts.
import { clamp, deg, dot, type Vec3 } from '../../camera/geometry';
import type { Exercise } from '../../types';
import type { Baseline } from './baseline';

/** Degrees between the current and the resting trunk direction. */
export const LEAN_FROM_REST_DEG = 12;
/** Fraction of shoulder width above the resting shoulder height (after the allowance). */
export const HIKE_FROM_REST = 0.1;
/** Without a baseline: absolute trunk angle from vertical, and absolute shoulder hike. */
export const LEAN_ABSOLUTE_DEG = 15;
export const HIKE_ABSOLUTE = 0.12;
/** Consecutive frames over a limit before it counts. */
export const DEBOUNCE_FRAMES = 3;
export const DEFAULT_SHOULDER_WIDTH_M = 0.36;
const ALLOWANCE_PER_DEG = 0.0012;

/** The shoulder blade rises naturally once the arm is above 90°: 0.108 of shoulder width at 180°. */
export function hikeAllowance(shoulderAngleDeg: number | null): number {
  return shoulderAngleDeg === null ? 0 : Math.max(0, shoulderAngleDeg - 90) * ALLOWANCE_PER_DEG;
}

/** True angle between the current and resting trunk vectors (both unit length), in degrees. */
export function leanFromRest(T: Vec3, T0: Vec3): number {
  return deg(Math.acos(clamp(dot(T, T0), -1, 1)));
}

export interface CompensationInput {
  trunkVec: Vec3 | null;
  /** Absolute, for the no-baseline fallback. */
  trunkLeanDeg: number | null;
  /** Absolute, fraction of shoulder width. */
  shoulderHike: number | null;
  /** The working arm's shoulder angle (arm_raise allowance). */
  shoulderAngle: number | null;
  shoulderWidthM: number | null;
}

export interface CompensationReading {
  /** Degrees from rest (absolute degrees from vertical without a baseline). */
  lean: number;
  /** Fraction of shoulder width; always 0 outside arm_raise. */
  hike: number;
  /** This frame is over a limit. */
  over: boolean;
  /** Over a limit for DEBOUNCE_FRAMES frames in a row. */
  compensating: boolean;
  /** What to tell the patient while compensating. */
  kind: 'lean' | 'shoulder_hike' | null;
}

export class CompensationMonitor {
  private streak = 0;
  private leanMax = 0;
  private hikeMaxM = 0;

  constructor(
    private exercise: Exercise,
    private baseline: Baseline | null,
  ) {}

  push(f: CompensationInput): CompensationReading {
    const b = this.baseline;
    let lean = 0;
    if (b) {
      if (f.trunkVec) lean = leanFromRest(f.trunkVec, b.T0);
    } else {
      lean = f.trunkLeanDeg ?? 0;
    }

    let hike = 0;
    if (this.exercise === 'arm_raise' && f.shoulderHike !== null) {
      hike = b
        ? Math.max(0, f.shoulderHike - b.hike0 - hikeAllowance(f.shoulderAngle))
        : Math.max(0, f.shoulderHike);
    }

    const leanOver = lean > (b ? LEAN_FROM_REST_DEG : LEAN_ABSOLUTE_DEG);
    const hikeOver = hike > (b ? HIKE_FROM_REST : HIKE_ABSOLUTE);
    const over = leanOver || hikeOver;
    this.streak = over ? this.streak + 1 : 0;
    const compensating = this.streak >= DEBOUNCE_FRAMES;

    this.leanMax = Math.max(this.leanMax, lean);
    this.hikeMaxM = Math.max(this.hikeMaxM, hike * (f.shoulderWidthM ?? DEFAULT_SHOULDER_WIDTH_M));
    return { lean, hike, over, compensating, kind: compensating ? (leanOver ? 'lean' : 'shoulder_hike') : null };
  }

  /** ExerciseResult.trunkLeanMax (degrees from rest) and shoulderHikeMax (metres above rest). */
  metrics(): { trunkLeanMax: number; shoulderHikeMax: number } {
    return { trunkLeanMax: Math.round(this.leanMax), shoulderHikeMax: Math.round(this.hikeMaxM * 1000) / 1000 };
  }
}