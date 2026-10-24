// RehabTrack: biomechanics, rep counting, compensation, hand opening, 3D replay recording.
// Upper-body joints for replay: nose, shoulders, elbows, wrists, hips, pinky + index (L then R).
export const REPLAY_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 17, 18, 19, 20];
// Bones as positions inside REPLAY_JOINTS
export const BONES = [[0, 1], [0, 2], [1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [5, 9], [5, 11], [6, 10], [6, 12]];

// Starting values only. Tune on real patients (therapist-adjustable in the UI).
export const CFG = {
  leanDeg: 12,      // trunk lean above rest baseline
  hikeFrac: 0.10,   // shoulder hike above rest baseline, as a fraction of shoulder width
  flagFrames: 3,    // consecutive frames over threshold before a rep is flagged
  minVis: 0.5,
  baselineFrames: 15,
  ex: {
    arm_raise:     { label: 'Shoulder angle',   unit: '°', up: 70,  down: 35 },
    forward_reach: { label: 'Elbow extension',  unit: '°', up: 150, down: 115 },
    hand_open:     { label: 'Hand opening',     unit: '%', up: 160, down: 130 }
  }
};
const REC_MS = 60; // ~15 fps replay sampling
const D = Math.PI / 180;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
function angle(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)], v = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const m = Math.hypot(...u) * Math.hypot(...v);
  if (m < 1e-8) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / m))) / D;
}
class Smooth {
  constructor(n = 5) { this.n = n; this.b = []; }
  push(v) { this.b.push(v); if (this.b.length > this.n) this.b.shift(); return this.b.reduce((a, x) => a + x, 0) / this.b.length; }
}
// Smoothness = number of peaks in the 3-point-smoothed speed curve above 25% of that rep's max speed.
function bursts(s) {
  if (s.length < 5) return 0;
  const m = s.map((_, i) => (s[Math.max(0, i - 1)] + s[i] + s[Math.min(s.length - 1, i + 1)]) / 3);
  const mx = Math.max(...m);
  let n = 0;
  for (let i = 1; i < m.length - 1; i++) if (m[i] > m[i - 1] && m[i] >= m[i + 1] && m[i] > 0.25 * mx) n++;
  return n;
}

export class ArmTracker {
  constructor(ex, role, weak) {
    this.ex = ex;
    this.side = role === 'weak' ? weak : (weak === 'L' ? 'R' : 'L');
    this.sm = new Smooth(5);
    this.cur = null; this.reps = [];
    this.best = 0; this.closed = Infinity; this.reachM = 0;
    this.last = null; this.lastT = 0; this.streak = 0;
    this.base = { n: 0, lean: 0, hike: 0 };
  }

  // f = { lm, wl, hands:[{side,wl}], t }. Returns null for frames that fail the confidence check.
  process(f) {
    const L = this.side === 'L';
    const sh = L ? 11 : 12, el = L ? 13 : 14, wr = L ? 15 : 16, hip = L ? 23 : 24, ot = L ? 12 : 11;
    let raw, lean = 0, hike = 0;

    if (this.ex === 'hand_open') {
      const h = f.hands?.find((x) => x.side === this.side);
      if (!h) return null;
      const w = h.wl, palm = dist(w[0], w[9]);
      if (palm < 1e-4) return null;
      raw = ([4, 8, 12, 16, 20].reduce((a, i) => a + dist(w[0], w[i]), 0) / 5 / palm) * 100; // 3D distances, palm-normalised
    } else {
      const { lm, wl } = f;
      if (!lm || !wl) return null;
      const ok = (i) => (lm[i]?.visibility ?? 1) >= CFG.minVis;
      if (![sh, el, wr, hip].every(ok)) return null;
      raw = this.ex === 'arm_raise' ? angle(wl[hip], wl[sh], wl[el]) : angle(wl[sh], wl[el], wl[wr]);

      // Trunk lean: 3D angle of hip→shoulder line from vertical (sideways in arm raise, forward flexion in reach)
      const both = [11, 12, 23, 24].every(ok);
      const mid = (a, b) => ({ x: (wl[a].x + wl[b].x) / 2, y: (wl[a].y + wl[b].y) / 2, z: (wl[a].z + wl[b].z) / 2 });
      const top = both ? mid(11, 12) : wl[sh], bot = both ? mid(23, 24) : wl[hip];
      const rawLean = Math.acos(Math.max(-1, Math.min(1, (bot.y - top.y) / (dist(top, bot) || 1)))) / D;
      // Shoulder hike: same-frame height difference / shoulder width (arm raise only; far shoulder is hidden in side-on reach)
      const rawHike = this.ex === 'arm_raise' && ok(ot) ? (wl[ot].y - wl[sh].y) / (dist(wl[11], wl[12]) || 1) : 0;

      if (this.base.n < CFG.baselineFrames) { // rest-pose baseline from the first frames
        this.base.n++;
        this.base.lean += (rawLean - this.base.lean) / this.base.n;
        this.base.hike += (rawHike - this.base.hike) / this.base.n;
      } else {
        lean = Math.abs(rawLean - this.base.lean);
        hike = Math.max(0, rawHike - this.base.hike);
      }
      if (this.ex === 'forward_reach') this.reachM = Math.max(this.reachM, dist(wl[sh], wl[wr]));
    }

    const v = this.sm.push(raw);
    this.best = Math.max(this.best, v);
    if (this.ex === 'hand_open') this.closed = Math.min(this.closed, v);
    this.streak = lean > CFG.leanDeg || hike > CFG.hikeFrac ? this.streak + 1 : 0;
    const flagged = this.streak >= CFG.flagFrames;

    const dt = this.lastT ? (f.t - this.lastT) / 1000 : 0.05;
    const speed = this.last == null ? 0 : Math.abs(v - this.last) / Math.max(dt, 0.001);
    this.last = v; this.lastT = f.t;
    this.count(v, speed, flagged, f.t);
    return { value: v, reps: this.reps.length, lean, hike, flagged, calibrating: this.ex !== 'hand_open' && this.base.n < CFG.baselineFrames };
  }

  // Hysteresis: a rep starts leaving "down", counts only after crossing "up", ends back at "down".
  count(v, speed, flag, t) {
    const c = CFG.ex[this.ex];
    if (!this.cur && v > c.down) this.cur = { t0: t, peak: v, sp: [], comp: false, top: false };
    const r = this.cur;
    if (!r) return;
    r.sp.push(speed); r.peak = Math.max(r.peak, v); r.comp = r.comp || flag;
    if (v >= c.up) r.top = true;
    if (v <= c.down) {
      if (r.top) { r.dur = (t - r.t0) / 1000; r.bursts = bursts(r.sp); this.reps.push(r); }
      this.cur = null;
    }
  }

  summary() {
    const n = this.reps.length, avg = (k) => (n ? this.reps.reduce((a, r) => a + r[k], 0) / n : 0), r1 = (x) => Math.round(x * 10) / 10;
    let fatiguePct = 0;
    if (n >= 6) {
      const m = (a) => a.reduce((s, r) => s + r.peak, 0) / 3, f = m(this.reps.slice(0, 3)), l = m(this.reps.slice(-3));
      fatiguePct = Math.round(((l - f) / Math.max(1, f)) * 100);
    }
    return {
      best: Math.round(this.best), reps: n, avgDuration: r1(avg('dur')), bursts: r1(avg('bursts')),
      compPct: n ? Math.round((this.reps.filter((r) => r.comp).length / n) * 100) : 0, fatiguePct,
      reachCm: Math.round(this.reachM * 100), closedMin: this.closed === Infinity ? null : Math.round(this.closed)
    };
  }
}

export class RehabSession {
  constructor(exercise = 'arm_raise', weakSide = 'L') {
    this.exercise = exercise; this.weakSide = weakSide; this.active = false; this.role = null;
    this.t = { healthy: new ArmTracker(exercise, 'healthy', weakSide), weak: new ArmTracker(exercise, 'weak', weakSide) };
    this.frames3D = []; this.lastRec = 0; this.sm = null;
  }
  start(role) { this.role = role; this.active = true; this.t[role] = new ArmTracker(this.exercise, role, this.weakSide); }
  stop() { this.active = false; }

  feed(f) {
    if (!this.active) return null;
    const res = this.t[this.role].process(f);
    if (f.wl && this.exercise !== 'hand_open' && f.t - this.lastRec >= REC_MS) { // light smoothing, then ~15 fps log
      this.lastRec = f.t;
      const cur = REPLAY_JOINTS.flatMap((i) => [f.wl[i].x, f.wl[i].y, f.wl[i].z]);
      this.sm = this.sm ? this.sm.map((p, k) => p + 0.5 * (cur[k] - p)) : cur;
      this.frames3D.push({ t: Math.round(f.t), role: this.role, j: this.sm.map((x) => Math.round(x * 1000) / 1000) });
    }
    return res;
  }

  report() {
    const healthy = this.t.healthy.summary(), weak = this.t.weak.summary();
    return {
      exercise: this.exercise, weakSide: this.weakSide, healthy, weak,
      symmetryPct: healthy.best > 0 && weak.best > 0 ? Math.round((weak.best / healthy.best) * 100) : null,
      thresholds: { leanDeg: CFG.leanDeg, hikeFrac: CFG.hikeFrac }, recordedFrames: this.frames3D.length
    };
  }

  replayJSON() {
    return JSON.stringify({
      metadata: { exercise: this.exercise, weakSide: this.weakSide, recordedAt: new Date().toISOString(), fps: 15, units: 'm', jointIds: REPLAY_JOINTS },
      frames: this.frames3D
    });
  }
}

export function ruleSuggestions(r) {
  const t = [];
  if (r.symmetryPct != null) t.push(`Symmetry ${r.symmetryPct}% (weak ${r.weak.best} vs healthy ${r.healthy.best}). Check the healthy arm is a fair reference.`);
  if (r.weak.compPct > 25) t.push(`⚠️ Compensation on ${r.weak.compPct}% of weak-arm reps. Cue trunk stability.`);
  if (r.weak.fatiguePct <= -15) t.push(`📉 Peak dropped ${Math.abs(r.weak.fatiguePct)}% by the last reps. Consider a shorter set.`);
  if (r.weak.bursts > 4) t.push('⚡ Movement is jerky (many speed peaks per rep). Try slow, rhythmic reps.');
  if (r.exercise === 'hand_open' && r.weak.closedMin != null) t.push(`Hand range: closed ${r.weak.closedMin}% to open ${r.weak.best}% of palm size.`);
  return t;
}

export async function askGemma(report) {
  const res = await fetch('http://localhost:8081/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).text;
}