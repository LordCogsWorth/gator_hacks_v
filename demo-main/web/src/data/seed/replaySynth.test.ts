import { describe, expect, it } from 'vitest';
import type { ReplayFile } from '../../types';
import { validateReplay } from '../validate';
import { parseSynthPath, synthPath, synthReplay, type SynthParams } from './replaySynth';

const james: SynthParams = { seed: 'james-lean', exercise: 'arm_raise', side: 'weak', weakSide: 'left', peakDeg: 95, reps: 5, leanReps: [3, 5], hikeReps: [] };

describe('synthReplay', () => {
  const cases: SynthParams[] = [
    james,
    { seed: 'priya', exercise: 'arm_raise', side: 'weak', weakSide: 'right', peakDeg: 120, hikeReps: [2, 4] },
    { seed: 'm', exercise: 'forward_reach', side: 'healthy', weakSide: 'right', peakDeg: 160 },
    { seed: 'm', exercise: 'forward_reach', side: 'weak', weakSide: 'right', peakDeg: 40 },
    { seed: 'm', exercise: 'hand_open', side: 'weak', weakSide: 'left', peakDeg: 60, reps: 8 },
    { seed: 'big', exercise: 'arm_raise', side: 'healthy', weakSide: 'left', peakDeg: 175, reps: 50 },
  ];

  it.each(cases)('passes the replay checks: $seed $exercise $side', (p) => {
    const r = synthReplay(p);
    const v = validateReplay(r);
    expect(v.errors).toEqual([]);
    expect(v.value.warnings).toEqual(r.warnings);
    expect(r.frames.length).toBeLessThanOrEqual(600);
    expect(r.exercise).toBe(p.exercise);
    expect(r.side).toBe(p.side);
  });

  it('lean reps produce lean warnings only inside those reps', () => {
    const r = synthReplay(james);
    const lean = (r.warnings ?? []).filter((w) => w.type === 'lean');
    expect(lean.length).toBeGreaterThan(0);
    const repOf = (f: number) => Math.floor((f - 15) / 48) + 1;
    expect(new Set(lean.map((w) => repOf(w.frame)))).toEqual(new Set([3, 5]));
    expect(synthReplay({ ...james, leanReps: [] }).warnings).toEqual([]);
  });

  it('hike reps produce shoulder_hike warnings and lift the active shoulder ~5 cm', () => {
    const p: SynthParams = { seed: 'h', exercise: 'arm_raise', side: 'weak', weakSide: 'right', peakDeg: 100, reps: 3, hikeReps: [2] };
    const r = synthReplay(p);
    const hikes = (r.warnings ?? []).filter((w) => w.type === 'shoulder_hike');
    expect(hikes.length).toBeGreaterThan(0);
    const peakFrame = 15 + 48 + 24;
    const restY = r.frames[0][2][1];
    expect(restY - r.frames[peakFrame][2][1]).toBeGreaterThan(0.04); // y is down: hiking makes y smaller
    expect(Math.abs(r.frames[0][1][1] - r.frames[peakFrame][1][1])).toBeLessThan(0.01); // other shoulder stays
  });

  it('moves the weak arm for side weak and the other arm for side healthy', () => {
    const wrist = (r: ReplayFile, j: number) => Math.max(...r.frames.map((f) => -f[j][1])) - Math.min(...r.frames.map((f) => -f[j][1]));
    const weak = synthReplay({ ...james, leanReps: [] });
    expect(wrist(weak, 5)).toBeGreaterThan(0.3); // left wrist travels
    expect(wrist(weak, 6)).toBeLessThan(0.02);
    const healthy = synthReplay({ ...james, side: 'healthy', leanReps: [] });
    expect(wrist(healthy, 6)).toBeGreaterThan(0.3);
    expect(wrist(healthy, 5)).toBeLessThan(0.02);
  });

  it('is deterministic: same params → identical output; another seed differs', () => {
    expect(synthReplay(james)).toEqual(synthReplay({ ...james }));
    expect(synthReplay({ ...james, seed: 'other' }).frames).not.toEqual(synthReplay(james).frames);
  });

  it('seated skeleton: hips centred, shoulders ~0.5 m above, knees forward, z toward camera negative', () => {
    const f = synthReplay(james).frames[0];
    expect(Math.abs((f[7][0] + f[8][0]) / 2)).toBeLessThan(0.005);
    expect((f[7][1] + f[8][1]) / 2 - (f[1][1] + f[2][1]) / 2).toBeCloseTo(0.5, 1);
    expect(f[9][2]).toBeLessThan(-0.35);
    expect(f[1][0]).toBeGreaterThan(0); // left shoulder at +x
  });
});

describe('synthPath / parseSynthPath', () => {
  it('round-trips', () => {
    const p: SynthParams = { ...james, hikeReps: [1, 4] };
    expect(parseSynthPath(synthPath(p))).toEqual(p);
    expect(synthPath(james)).toBe('synth:v1;seed=james-lean;ex=arm_raise;side=weak;ws=left;peak=95;reps=5;lean=3,5;hike=');
  });

  it('defaults and rejects', () => {
    const p = parseSynthPath('synth:v1;seed=x;ex=hand_open;side=healthy;ws=right;peak=50');
    expect(p).toEqual({ seed: 'x', exercise: 'hand_open', side: 'healthy', weakSide: 'right', peakDeg: 50, reps: 5, leanReps: [], hikeReps: [] });
    expect(parseSynthPath('sess-1/arm_raise-weak.json')).toBeNull();
    expect(parseSynthPath('synth:v1;ex=walk;side=weak;ws=left;peak=1')).toBeNull();
  });
});
