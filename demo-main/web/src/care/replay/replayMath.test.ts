import { describe, expect, it } from 'vitest';
import { REPLAY_JOINTS } from '../../types';
import { synthReplay } from '../../data/seed/replaySynth';
import {
  BONES,
  MID_SHOULDER,
  angleAt,
  angleSeries,
  bodySideFor,
  boneSegments,
  frameAngles,
  sceneOrigin,
  scenePoints,
  toScene,
  warningMask,
  warningRuns,
  type Vec3,
} from './replayMath';

describe('replayMath', () => {
  it('toScene flips y (down → up) and z (toward camera → +z), keeps x', () => {
    expect(toScene([0.2, -0.5, -0.1])).toEqual([0.2, 0.5, 0.1]);
    expect(toScene([-0.1, 0.4, 0.3])).toEqual([-0.1, -0.4, -0.3]);
  });

  it('BONES are the 12 contract pairs and every index is < 13', () => {
    expect(BONES).toHaveLength(12);
    for (const [a, b] of BONES) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(REPLAY_JOINTS.length);
      expect(b).toBeLessThan(REPLAY_JOINTS.length);
    }
  });

  it('centres frame 0 on the mid-hip and appends the mid-shoulder for the neck bone', () => {
    const r = synthReplay({ seed: 't', exercise: 'arm_raise', side: 'weak', weakSide: 'left', peakDeg: 100 });
    const origin = sceneOrigin(r);
    const pts = scenePoints(r.frames[0], origin);
    expect(pts).toHaveLength(REPLAY_JOINTS.length + 1);
    const midHip = pts[7].map((c, i) => (c + pts[8][i]) / 2);
    midHip.forEach((c) => expect(Math.abs(c)).toBeLessThan(1e-9));
    expect(pts[MID_SHOULDER][1]).toBeGreaterThan(0.4); // shoulders above the hips in scene space
    expect(boneSegments(pts)).toHaveLength((BONES.length + 1) * 2);
  });

  it('angleAt measures the angle at the middle point', () => {
    expect(angleAt([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90, 6);
    expect(angleAt([1, 0, 0], [0, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 6);
  });

  it('frameAngles: arm_raise uses hip-shoulder-elbow of the requested side; hand_open has no angle', () => {
    const frame: Vec3[] = REPLAY_JOINTS.map(() => [0, 0, 0] as Vec3);
    frame[1] = [0.2, -0.5, 0]; // left shoulder
    frame[2] = [-0.2, -0.5, 0];
    frame[3] = [0.48, -0.5, 0]; // left elbow straight out sideways
    frame[4] = [-0.2, -0.22, 0]; // right elbow hanging
    frame[5] = [0.74, -0.5, 0];
    frame[6] = [-0.2, 0.04, 0];
    frame[7] = [0.2, 0, 0];
    frame[8] = [-0.2, 0, 0];
    expect(frameAngles(frame, 'arm_raise', 'left').angle).toBeCloseTo(90, 6);
    expect(frameAngles(frame, 'arm_raise', 'right').angle).toBeCloseTo(0, 6);
    expect(frameAngles(frame, 'forward_reach', 'left').angle).toBeCloseTo(180, 6);
    expect(frameAngles(frame, 'hand_open', 'left').angle).toBeNull();
    expect(frameAngles(frame, 'arm_raise', 'left').lean).toBeCloseTo(0, 6);
  });

  it('synth peaks land on peakDeg as measured by frameAngles', () => {
    const raise = synthReplay({ seed: 'p', exercise: 'arm_raise', side: 'weak', weakSide: 'right', peakDeg: 110 });
    const rs = angleSeries(raise, 'right');
    expect(Math.max(...rs.map((r) => r.angle ?? 0))).toBeCloseTo(110, -0.3);
    const reach = synthReplay({ seed: 'p', exercise: 'forward_reach', side: 'healthy', weakSide: 'right', peakDeg: 160 });
    const fs = angleSeries(reach, bodySideFor('healthy', 'right'));
    expect(Math.max(...fs.map((r) => r.angle ?? 0))).toBeCloseTo(160, -0.3);
  });

  it('bodySideFor maps weak/healthy onto the patient', () => {
    expect(bodySideFor('weak', 'left')).toBe('left');
    expect(bodySideFor('healthy', 'left')).toBe('right');
    expect(bodySideFor('healthy', 'right')).toBe('left');
  });

  it('warningMask pads ±3 frames and warningRuns merges adjacent frames', () => {
    const mask = warningMask(20, [{ frame: 10, type: 'lean' }]);
    expect(mask.filter(Boolean)).toHaveLength(7);
    expect(mask[6]).toBe(false);
    expect(mask[7]).toBe(true);
    expect(mask[13]).toBe(true);
    expect(mask[14]).toBe(false);
    expect(warningMask(5, [{ frame: 0, type: 'lean' }]).filter(Boolean)).toHaveLength(4);
    const runs = warningRuns([
      { frame: 5, type: 'lean' },
      { frame: 3, type: 'lean' },
      { frame: 4, type: 'shoulder_hike' },
      { frame: 9, type: 'lean' },
    ]);
    expect(runs.map((r) => [r.start, r.end])).toEqual([
      [3, 5],
      [9, 9],
    ]);
  });
});
