// ArmSense: hold time, steps, arm use ratio, session improvement and side symmetry.
// Watch sample schema: { timestamp (ISO-8601), accel{x,y,z} in g incl. gravity, gyro{x,y,z} in rad/s,
//                        heartRate?, source: 'Apple Watch', sessionId }
export const BRAND = 'ArmSense';
const SOURCE = 'Apple Watch';
const HIST_KEY = 'armsenseHistory';
// armAxis = watch axis pointing along the forearm; pitchRateAxis = gyro axis that raises/lowers the arm.
// Verify both on your wrist setup (worn side and crown direction flip signs).
const CFG = { armAxis: 'y', pitchRateAxis: 'x', alpha: 0.98, holdTolDeg: 10, holdGyro: 0.35, minHoldS: 1,
  epochS: 1, shoulderFrac: 0.818, armFrac: 0.332, activeThr: 0.02, stepThr: 0.15, stepRefractoryS: 0.3 };

const load = () => { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; } };
const save = (h) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-200))); } catch { /* storage full */ } };
export const improvementPct = (cur, prev, eps = 1) => (cur == null || prev == null ? null : ((cur - prev) / Math.max(prev, eps)) * 100);
export const symmetryIndex = (affected, healthy) => (affected == null || !healthy ? null : (affected / healthy) * 100);
const ratio = (a, b) => (a == null || !b ? null : a / b);
const same = (e, side, task, loc) => e.side === side && e.task === task && e.location === loc;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export class ArmSense {
  constructor({ onWarn = () => {} } = {}) { this.warn = onWarn; this.reset(); }
  reset() { this.s = null; this.pitch = null; this.lastT = null; this.lp = null; this.cam = {}; }

  // Validates the schema and updates the arm-elevation estimate. Returns false for a bad sample.
  ingest(w) {
    const ok = w && w.source === SOURCE && typeof w.sessionId === 'string' && w.sessionId.trim() &&
      w.accel && w.gyro && !Number.isNaN(Date.parse(w.timestamp));
    if (!ok) { this.warn(`Rejected watch sample: needs source "${SOURCE}", sessionId, timestamp, accel, gyro`); return false; }
    const t = Date.parse(w.timestamp) / 1000;
    const dt = this.lastT == null ? 0 : Math.min(0.2, Math.max(0, t - this.lastT));
    this.lastT = t;
    const a = w.accel, A = CFG.armAxis, o = ['x', 'y', 'z'].filter((k) => k !== A);
    const accPitch = (Math.atan2(a[A], Math.hypot(a[o[0]], a[o[1]])) * 180) / Math.PI;
    const rate = (w.gyro[CFG.pitchRateAxis] * 180) / Math.PI;
    this.pitch = this.pitch == null ? accPitch : CFG.alpha * (this.pitch + rate * dt) + (1 - CFG.alpha) * accPitch;
    if (this.s && dt > 0) this.track(w, t, dt);
    return true;
  }

  // heightCm = the person's standing height (entered once); it scales shoulder height and arm length.
  startTest(heightCm = null) {
    this.cam = {}; this.lp = null; this.heightCm = heightCm;
    this.s = { n: 0, epochs: [], eSum: 0, eN: 0, eT: null, steps: 0, lastStep: -9, mLp: null, prevHp: 0,
      target: null, stable: 0, run: 0, best: 0, total: 0, hr: [], peakPitch: -90,
      maxH: null, hSum: 0, hN: 0 };
  }

  track(w, t, dt) {
    const s = this.s, v = [w.accel.x, w.accel.y, w.accel.z];
    s.n++;
    if (w.heartRate != null) s.hr.push(w.heartRate);
    s.peakPitch = Math.max(s.peakPitch, this.pitch);
    const h = this.wristHeightM(this.pitch);   // watch-derived height above the floor
    if (h != null) s.maxH = Math.max(s.maxH ?? h, h);
    // arm use: movement intensity with gravity removed, averaged per epoch
    this.lp = this.lp ? this.lp.map((p, i) => p + 0.02 * (v[i] - p)) : v.slice();
    s.eSum += Math.hypot(...v.map((x, i) => x - this.lp[i])); s.eN++; s.eT ??= t;
    if (t - s.eT >= CFG.epochS) { s.epochs.push(s.eSum / s.eN); s.eSum = 0; s.eN = 0; s.eT = t; }
    // steps: upward crossing of the high-passed acceleration magnitude
    const mag = Math.hypot(...v);
    s.mLp = s.mLp == null ? mag : s.mLp + 0.02 * (mag - s.mLp);
    const hp = mag - s.mLp;
    if (hp > CFG.stepThr && s.prevHp <= CFG.stepThr && t - s.lastStep > CFG.stepRefractoryS) { s.steps++; s.lastStep = t; }
    s.prevHp = hp;
    // hold: latch a target once the arm is raised and steady, then time how long it stays there
    const calm = Math.hypot(w.gyro.x, w.gyro.y, w.gyro.z) < CFG.holdGyro;
    if (s.target == null) {
      if (this.pitch > 30 && calm) { s.stable += dt; if (s.stable >= 0.5) s.target = this.pitch; } else s.stable = 0;
    } else if (Math.abs(this.pitch - s.target) < CFG.holdTolDeg && calm) {
      s.run += dt; s.total += dt; s.best = Math.max(s.best, s.run);
      if (h != null) { s.hSum += h; s.hN++; }
    } else s.run = 0;
  }

  endTest() {
    const s = this.s; this.s = null;
    if (!s || s.n < 25) return null;
    return { holdTimeS: s.best >= CFG.minHoldS ? s.best : 0, totalHoldS: s.total, steps: s.steps,
      activeFraction: s.epochs.filter((e) => e > CFG.activeThr).length / Math.max(1, s.epochs.length),
      meanActivity: mean(s.epochs), peakElevationDeg: s.peakPitch, avgHr: mean(s.hr),
      maxHeightM: s.maxH, holdHeightM: s.hN ? s.hSum / s.hN : null };
  }

  // Camera hold (works without a watch): time the shoulder angle stays within tolerance of its peak.
  camUpdate(side, deg, tSec) {
    const c = (this.cam[side] ||= { peak: 0, run: 0, best: 0, last: tSec });
    const dt = Math.min(0.2, tSec - c.last); c.last = tSec; c.peak = Math.max(c.peak, deg);
    c.run = c.peak >= 40 && deg >= c.peak - CFG.holdTolDeg ? c.run + dt : 0;
    c.best = Math.max(c.best, c.run);
  }

  // Wrist height above the floor (m), from the watch only: shoulder height + arm length x sin(elevation).
  // Assumes a straight arm, so the forearm angle equals the whole-arm angle. Barometer is too coarse for this.
  wristHeightM(pitchDeg) {
    if (!this.heightCm) return null;
    const H = this.heightCm / 100;
    return this.shoulderFrac(H) + CFG.armFrac * H * Math.sin((pitchDeg * Math.PI) / 180);
  }
  shoulderFrac(H) { return CFG.shoulderFrac * H; }

  // Compares with the previous session (same side, task, location) and with the healthy side.
  buildReport({ wm, affected, watchSide, task, location, camPct, sessionId }) {
    const healthy = affected === 'L' ? 'R' : 'L';
    const hist = load();
    const camHold = { L: this.cam.L?.best ?? null, R: this.cam.R?.best ?? null };
    const prev = hist.filter((e) => same(e, watchSide, task, location) && e.holdTimeS != null).pop();
    const prevCam = hist.filter((e) => e.task === task && e.location === location && e.camPct?.[affected] != null).pop();
    const prevUse = hist.filter((e) => same(e, affected, task, location) && e.armUseDuration != null).pop();
    const entry = { ts: Date.now(), sessionId, side: watchSide, task, location, ...(wm || {}), camPct, camHold };
    hist.push(entry);
    const last = (side) => hist.filter((e) => same(e, side, task, location) && e.holdTimeS != null).pop();
    const weak = last(affected), good = last(healthy);
    const armUse = { duration: ratio(weak?.activeFraction, good?.activeFraction), magnitude: ratio(weak?.meanActivity, good?.meanActivity) };
    if (watchSide === affected) entry.armUseDuration = armUse.duration;
    save(hist);
    return {
      brand: BRAND, sessionId, task, location, affected, watchSide, hasWatch: !!wm,
      holdTimeS: wm?.holdTimeS ?? null, steps: wm?.steps ?? null,
      maxHeightM: wm?.maxHeightM ?? null, holdHeightM: wm?.holdHeightM ?? null, camHoldS: camHold[affected],
      holdImprovementPct: improvementPct(wm?.holdTimeS, prev?.holdTimeS),
      camImprovementPct: improvementPct(camPct[affected], prevCam?.camPct[affected], 5),
      holdSymmetryPct: symmetryIndex(weak?.holdTimeS, good?.holdTimeS),
      camSymmetryPct: symmetryIndex(camPct[affected], camPct[healthy]),
      armUse, useImprovementPct: improvementPct(armUse.duration, prevUse?.armUseDuration, 0.05)
    };
  }

  html(a) {
    if (!a) return '';
    const f = (v, d = 1, u = '') => (v == null || Number.isNaN(v) ? '--' : v.toFixed(d) + u);
    const d = (v) => (v == null ? '' : ` <span class="${v >= 0 ? 'ok' : 'bad'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(0)}%</span>`);
    const row = (k, v) => `<div class="stat"><span>${k}</span><span class="mono">${v}</span></div>`;
    const side = a.affected === 'L' ? 'Left' : 'Right';
    return `<div style="margin-top:10px;padding:12px;border-radius:10px;border:1px solid #1f2937">
      <div class="label">${BRAND} · ${side} (affected) vs last session and healthy side</div>
      ${row('Hold time (watch)', f(a.holdTimeS, 1, ' s') + d(a.holdImprovementPct))}
      ${row('Hold time (camera)', f(a.camHoldS, 1, ' s'))}
      ${row('Raise vs last session', d(a.camImprovementPct) || '--')}
      ${row('Wrist height, held (watch)', f(a.holdHeightM, 2, ' m'))}
      ${row('Wrist height, max (watch)', f(a.maxHeightM, 2, ' m'))}
      ${row('Steps', a.steps ?? '--')}
      ${row('Arm use ratio (time)', f(a.armUse.duration, 2) + d(a.useImprovementPct))}
      ${row('Arm use ratio (movement)', f(a.armUse.magnitude, 2))}
      ${row('Raise symmetry', f(a.camSymmetryPct, 0, '%'))}
      ${row('Hold symmetry', f(a.holdSymmetryPct, 0, '%'))}
      <p class="sub">${a.hasWatch ? '' : 'No watch data this run. '}Arm use ratio needs a watch session on each wrist (same task and location); 1.0 = equal use.</p></div>`;
  }
}