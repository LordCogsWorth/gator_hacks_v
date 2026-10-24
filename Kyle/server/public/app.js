import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Config
// ============================================================
const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_FULL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const VIS_MIN = 0.5;
const SMOOTH = 0.35;
const HIP_H = 0.95; // hip height of the 3D model (m)
const TEST_SECONDS = 8;
const SERIES = 60;
const REPORT_KEY = 'kyleMobilityReport';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const setStatus = (t) => (statusEl.textContent = t);
window.addEventListener('unhandledrejection', (e) => setStatus(`Error: ${e.reason?.message || e.reason}`));

// ============================================================
// Joints / math
// ============================================================
const JOINTS = {
  shoulderL: { name: 'Left shoulder (raise)', tri: [23, 11, 13], rom: 180, mode: 'raw' },
  shoulderR: { name: 'Right shoulder (raise)', tri: [24, 12, 14], rom: 180, mode: 'raw' },
  elbowL: { name: 'Left elbow (bend)', tri: [11, 13, 15], rom: 150, mode: 'flex' },
  elbowR: { name: 'Right elbow (bend)', tri: [12, 14, 16], rom: 150, mode: 'flex' },
  hipL: { name: 'Left hip (bend)', tri: [11, 23, 25], rom: 120, mode: 'flex' },
  hipR: { name: 'Right hip (bend)', tri: [12, 24, 26], rom: 120, mode: 'flex' },
  kneeL: { name: 'Left knee (bend)', tri: [23, 25, 27], rom: 135, mode: 'flex' },
  kneeR: { name: 'Right knee (bend)', tri: [24, 26, 28], rom: 135, mode: 'flex' }
};
const SIDE_IDX = {
  L: { Sh: 11, El: 13, Wr: 15, Hand: 19, Hip: 23, Kn: 25, An: 27, Heel: 29, Toe: 31, Ear: 7 },
  R: { Sh: 12, El: 14, Wr: 16, Hand: 20, Hip: 24, Kn: 26, An: 28, Heel: 30, Toe: 32, Ear: 8 }
};

function angleAt(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const m1 = Math.hypot(...v1), m2 = Math.hypot(...v2);
  if (!m1 || !m2) return null;
  const dot = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (m1 * m2);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}
const pct = (deg, rom) => Math.round(Math.min(1, Math.max(0, deg / rom)) * 100);
const cls = (p) => (p >= 85 ? 'ok' : p >= 60 ? 'mid' : 'bad');
const colorCss = (p) => (p >= 85 ? '#22c55e' : p >= 60 ? '#f59e0b' : '#ef4444');
const vis = (lm, i) => lm[i].visibility ?? 1;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// ============================================================
// State
// ============================================================
const S = {
  cur: {}, peak: {}, vel: {}, lastT: 0,
  camSpeed: 0, camPeak: 0, heightEst: null, bodyVisible: false,
  watch: null, watchT: 0, hr: [], acc: [],
  report: null, findings: {},
  follow: true, labels: false, focusKey: null, fps: 0,
  test: { phase: 'idle', start: 0, side: {}, maxSpeed: 0, hr: [], ws: [] }
};

// ============================================================
// Pose processing (angles, speed, height)
// ============================================================
function processPose(lm, wl, now) {
  const dt = S.lastT ? (now - S.lastT) / 1000 : 0;
  S.lastT = now;
  for (const [k, j] of Object.entries(JOINTS)) {
    const [a, b, c] = j.tri;
    if ([a, b, c].some((i) => vis(lm, i) < VIS_MIN)) {
      S.vel[k] *= 0.8;
      continue;
    }
    const raw = angleAt(wl[a], wl[b], wl[c]);
    if (raw == null) continue;
    const val = Math.max(0, j.mode === 'raw' ? raw : 180 - raw);
    const prev = S.cur[k];
    const sm = prev == null ? val : prev + SMOOTH * (val - prev);
    if (prev != null && dt > 0 && dt < 0.5) S.vel[k] += 0.3 * ((sm - prev) / dt - S.vel[k]);
    S.cur[k] = sm;
    if (sm > S.peak[k]) S.peak[k] = sm;
  }
  S.camSpeed = Math.max(Math.abs(S.vel.shoulderL), Math.abs(S.vel.shoulderR));
  S.camPeak = Math.max(S.camPeak, S.camSpeed);
  S.bodyVisible = [11, 12, 13, 14].every((i) => vis(lm, i) > VIS_MIN);

  // Height: nose→heel + ~11 cm to the top of the head (needs full body in frame)
  if ([0, 29, 30].every((i) => vis(lm, i) > VIS_MIN)) {
    const hx = (wl[29].x + wl[30].x) / 2, hy = (wl[29].y + wl[30].y) / 2, hz = (wl[29].z + wl[30].z) / 2;
    const h = (Math.hypot(wl[0].x - hx, wl[0].y - hy, wl[0].z - hz) + 0.11) * 100;
    if (h > 100 && h < 250) S.heightEst = S.heightEst == null ? h : S.heightEst + 0.05 * (h - S.heightEst);
  }
}

function heightCm() {
  const v = parseFloat($('heightInput').value);
  if (v >= 100 && v <= 250) return { cm: v, src: 'entered' };
  if (S.heightEst) return { cm: S.heightEst, src: 'camera est.' };
  return null;
}

// ============================================================
// 3D scene
// ============================================================
const threeEl = $('three');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.transform = 'scaleX(-1)'; // mirror, like the camera feed
threeEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);
const cam3 = new THREE.PerspectiveCamera(38, 4 / 3, 0.01, 50);
cam3.position.set(0, 1.25, 2.9);
const controls = new OrbitControls(cam3, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 6;
controls.target.set(0, 1.15, 0);

scene.add(new THREE.HemisphereLight(0xfff4ee, 0x1e293b, 1.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(1.5, 3, 2.5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.8);
rimLight.position.set(-2, 2, -2.5);
scene.add(rimLight);
const floor = new THREE.GridHelper(3, 12, 0x334155, 0x1e293b);
scene.add(floor);

function resize3() {
  const w = threeEl.clientWidth, h = threeEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  cam3.aspect = w / h;
  cam3.updateProjectionMatrix();
}
new ResizeObserver(resize3).observe(threeEl);

// Muscle fiber texture: red striations with pale tendons at each end
function fiberTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  for (let x = 0; x < 128; x++) {
    g.fillStyle = `hsl(${352 + Math.random() * 10}, ${58 + Math.random() * 14}%, ${24 + Math.random() * 16}%)`;
    g.fillRect(x, 0, 1, 256);
  }
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(236,226,214,1)');
  grad.addColorStop(0.1, 'rgba(236,226,214,0)');
  grad.addColorStop(0.9, 'rgba(236,226,214,0)');
  grad.addColorStop(1, 'rgba(236,226,214,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}
const FIBER = fiberTexture();

// Fusiform (spindle) muscle belly: radius 1, height 1, centered
const spindle = (() => {
  const pts = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(0.04 + 0.96 * Math.pow(Math.sin(Math.PI * t), 0.7), t - 0.5));
  }
  return new THREE.LatheGeometry(pts, 24);
})();
const ellipsoid = new THREE.SphereGeometry(1, 28, 18).scale(1, 0.5, 1); // height 1
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);

// Place a unit mesh between A and B with width w, depth d, depth axis ≈ normal
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
function place(mesh, A, B, w, d, normal) {
  _y.subVectors(B, A);
  const len = _y.length();
  if (len < 1e-4) return;
  _y.divideScalar(len);
  _z.copy(normal).addScaledVector(_y, -normal.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  mesh.quaternion.setFromRotationMatrix(_m);
  mesh.position.addVectors(A, B).multiplyScalar(0.5);
  mesh.scale.set(w, len, d);
}

// ---------- Rest pose (MediaPipe world coords: x = subject's left, y down, z toward camera = negative) ----------
const REST = (() => {
  const a = Array.from({ length: 33 }, () => ({ x: 0, y: -0.3, z: 0 }));
  const set = (i, x, y, z = 0) => (a[i] = { x, y, z });
  set(0, 0, -0.66, -0.09);
  set(7, 0.075, -0.63, 0);
  set(8, -0.075, -0.63, 0);
  for (const s of [1, -1]) {
    const L = s === 1;
    set(L ? 11 : 12, 0.18 * s, -0.48);
    set(L ? 13 : 14, 0.21 * s, -0.2, 0);
    set(L ? 15 : 16, 0.23 * s, 0.05, -0.03);
    set(L ? 19 : 20, 0.235 * s, 0.13, -0.04);
    set(L ? 23 : 24, 0.1 * s, 0);
    set(L ? 25 : 26, 0.105 * s, 0.44, -0.01);
    set(L ? 27 : 28, 0.1 * s, 0.86, 0.02);
    set(L ? 29 : 30, 0.1 * s, 0.91, 0.06);
    set(L ? 31 : 32, 0.11 * s, 0.93, -0.1);
  }
  return a;
})();
const conv = (p, out = new THREE.Vector3()) => out.set(p.x, -p.y + HIP_H, -p.z);
const P = REST.map((p) => conv(p));
const RESTV = REST.map((p) => conv(p));
const _t = new THREE.Vector3();

function updatePose(lm, wl) {
  for (let i = 0; i < 33; i++) {
    if (vis(lm, i) < 0.35) continue; // keep last good / rest position for hidden joints
    P[i].lerp(conv(wl[i], _t), 0.5);
  }
}

// ---------- Body frame + anatomical reference points ----------
const fr = {
  midSh: new THREE.Vector3(), midHip: new THREE.Vector3(), Up: new THREE.Vector3(),
  F: new THREE.Vector3(), Xl: new THREE.Vector3(), headC: new THREE.Vector3(), chest: new THREE.Vector3()
};
function computeFrame() {
  fr.midSh.addVectors(P[11], P[12]).multiplyScalar(0.5);
  fr.midHip.addVectors(P[23], P[24]).multiplyScalar(0.5);
  fr.Up.subVectors(fr.midSh, fr.midHip).normalize();
  fr.Xl.subVectors(P[11], P[12]).normalize();
  fr.F.crossVectors(fr.Xl, fr.Up).normalize();
  fr.Up.crossVectors(fr.F, fr.Xl).normalize();
  fr.headC.addVectors(P[7], P[8]).multiplyScalar(0.5);
  fr.chest.lerpVectors(fr.midSh, fr.midHip, 0.3);
}

function sidePoints(side) {
  const s = side === 'L' ? 1 : -1;
  const { midSh, midHip, Up, F, Xl } = fr;
  const Xs = Xl.clone().multiplyScalar(s);
  const L = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, t);
  const add = (v, ...terms) => {
    for (const [d, k] of terms) v.addScaledVector(d, k);
    return v;
  };
  const p = { Xs };
  for (const [n, i] of Object.entries(SIDE_IDX[side])) p[n] = P[i];
  p.neckSide = add(midSh.clone(), [Xs, 0.045], [Up, 0.04]);
  p.neckTopSide = add(midSh.clone(), [Xs, 0.03], [Up, 0.12]);
  p.scapTop = add(L(midSh, midHip, 0.05), [Xs, 0.08]);
  p.scapMed = add(L(midSh, midHip, 0.2), [Xs, 0.07]);
  p.scapLow = add(L(midSh, midHip, 0.38), [Xs, 0.1]);
  p.spineT = add(L(midSh, midHip, 0.1), [Xs, 0.01]);
  p.spineMidSide = add(L(midSh, midHip, 0.3), [Xs, 0.012]);
  p.spineLowSide = add(L(midSh, midHip, 0.6), [Xs, 0.015]);
  p.clav = add(midSh.clone(), [Xs, 0.02], [F, 0.04]);
  p.pelvisSide = add(L(midHip, p.Hip, 0.4), [Up, 0.12]);
  p.midHipSide = add(midHip.clone(), [Xs, 0.03]);
  p.sternumSide = add(L(midSh, midHip, 0.15), [Xs, 0.01]);
  p.sternumLow = add(L(midSh, midHip, 0.3), [Xs, 0.06]);
  p.ribHigh = L(p.Sh, p.Hip, 0.2);
  p.ribLow = L(p.Sh, p.Hip, 0.55);
  p.absTop = add(L(midSh, midHip, 0.32), [Xs, 0.035]);
  p.absBot = add(midHip.clone(), [Xs, 0.03], [Up, -0.03]);
  p.hipTop = add(p.Hip.clone(), [Up, 0.1]);
  return p;
}

// ---------- Muscles ----------
// [id, name, region, function, from, to, t0, t1, forward offset, outward offset, width, depth]
const DEFS = [
  ['deltoid_anterior', 'Anterior deltoid', 'Shoulder', 'Raises the arm forward (flexion).', 'Sh', 'El', -0.08, 0.45, 0.035, 0.012, 0.032, 0.026],
  ['deltoid_middle', 'Lateral deltoid', 'Shoulder', 'Raises the arm out to the side (abduction, mainly 30–90°).', 'Sh', 'El', -0.1, 0.47, 0, 0.04, 0.036, 0.03],
  ['deltoid_posterior', 'Posterior deltoid', 'Shoulder', 'Moves the arm backward (extension).', 'Sh', 'El', -0.08, 0.45, -0.035, 0.012, 0.032, 0.026],
  ['supraspinatus', 'Supraspinatus', 'Rotator cuff', 'Starts the arm raise (first 0–30°) and keeps the joint centered.', 'neckSide', 'Sh', 0.05, 0.95, -0.03, 0, 0.016, 0.014],
  ['infraspinatus', 'Infraspinatus', 'Rotator cuff', 'External rotation; stabilizes the shoulder joint.', 'scapMed', 'Sh', 0, 0.9, -0.085, 0, 0.04, 0.012],
  ['teres_minor', 'Teres minor', 'Rotator cuff', 'External rotation; shoulder stabilizer.', 'scapLow', 'Sh', 0, 0.85, -0.08, 0, 0.016, 0.012],
  ['subscapularis', 'Subscapularis', 'Rotator cuff', 'Internal rotation (deep, under the shoulder blade).', 'scapMed', 'Sh', 0.05, 0.85, -0.055, 0, 0.032, 0.008],
  ['teres_major', 'Teres major', 'Shoulder', 'Pulls the arm down and back; internal rotation.', 'scapLow', 'El', 0, 0.3, -0.07, 0, 0.02, 0.016],
  ['trapezius_upper', 'Upper trapezius', 'Upper back', 'Lifts and rotates the shoulder blade upward.', 'neckTopSide', 'Sh', 0, 0.95, -0.04, 0, 0.03, 0.014],
  ['trapezius_middle', 'Middle trapezius', 'Upper back', 'Pulls the shoulder blades together.', 'spineT', 'Sh', 0, 0.85, -0.09, 0, 0.035, 0.01],
  ['trapezius_lower', 'Lower trapezius', 'Upper back', 'Rotates the shoulder blade upward for overhead reach.', 'spineLowSide', 'scapMed', 0, 1.05, -0.095, 0, 0.028, 0.01],
  ['rhomboids', 'Rhomboids', 'Upper back', 'Retracts and stabilizes the shoulder blade.', 'spineMidSide', 'scapMed', 0, 1, -0.088, 0, 0.025, 0.01],
  ['levator_scapulae', 'Levator scapulae', 'Neck', 'Lifts the shoulder blade.', 'Ear', 'scapTop', 0.25, 1, -0.04, 0, 0.011, 0.011],
  ['sternocleidomastoid', 'Sternocleidomastoid', 'Neck', 'Turns and bends the head.', 'clav', 'Ear', 0, 0.95, 0.02, 0, 0.013, 0.013],
  ['latissimus_dorsi', 'Latissimus dorsi', 'Back', 'Pulls the arm down; tightness limits overhead reach.', 'pelvisSide', 'Sh', 0, 0.85, -0.075, 0.01, 0.065, 0.018],
  ['erector_spinae', 'Erector spinae', 'Back', 'Extends and stabilizes the spine.', 'midHipSide', 'neckSide', 0.03, 0.85, -0.1, 0, 0.02, 0.02],
  ['pectoralis_major', 'Pectoralis major', 'Chest', 'Brings the arm across the body; helps raise it forward.', 'sternumSide', 'Sh', 0, 0.97, 0.085, 0, 0.065, 0.02],
  ['pectoralis_minor', 'Pectoralis minor', 'Chest', 'Tilts the shoulder blade; tightness limits overhead reach.', 'sternumLow', 'Sh', 0, 0.8, 0.07, 0, 0.028, 0.01],
  ['serratus_anterior', 'Serratus anterior', 'Chest wall', 'Rotates the shoulder blade upward to raise the arm above 90°.', 'ribLow', 'ribHigh', 0, 1, 0.02, 0.02, 0.03, 0.035],
  ['coracobrachialis', 'Coracobrachialis', 'Upper arm', 'Assists forward raise and pulling the arm in.', 'Sh', 'El', 0.1, 0.5, 0.012, -0.02, 0.013, 0.013],
  ['biceps_brachii', 'Biceps brachii', 'Upper arm', 'Bends the elbow; long head assists forward raise.', 'Sh', 'El', 0.18, 0.95, 0.035, 0, 0.028, 0.028],
  ['brachialis', 'Brachialis', 'Upper arm', 'Main elbow flexor.', 'Sh', 'El', 0.55, 1.02, 0.018, 0.016, 0.022, 0.02],
  ['triceps_brachii', 'Triceps brachii', 'Upper arm', 'Straightens the elbow.', 'Sh', 'El', 0.08, 0.98, -0.034, 0, 0.032, 0.03],
  ['brachioradialis', 'Brachioradialis', 'Forearm', 'Bends the elbow (thumb-up position).', 'El', 'Wr', -0.08, 0.65, 0.008, 0.025, 0.02, 0.02],
  ['forearm_flexors', 'Wrist & finger flexors', 'Forearm', 'Grip and wrist flexion.', 'El', 'Wr', 0, 0.85, 0.016, -0.014, 0.02, 0.018],
  ['forearm_extensors', 'Wrist & finger extensors', 'Forearm', 'Wrist and finger extension.', 'El', 'Wr', 0, 0.85, -0.016, 0.008, 0.02, 0.018],
  ['rectus_abdominis', 'Rectus abdominis', 'Core', 'Bends the trunk forward.', 'absTop', 'absBot', 0, 1, 0.1, 0, 0.026, 0.012],
  ['external_oblique', 'External oblique', 'Core', 'Trunk rotation and side bending.', 'ribLow', 'Hip', 0.1, 0.85, 0.06, 0.02, 0.045, 0.018],
  ['gluteus_maximus', 'Gluteus maximus', 'Hip', 'Hip extension (standing up, climbing).', 'hipTop', 'Kn', 0, 0.3, -0.085, 0, 0.07, 0.04],
  ['gluteus_medius', 'Gluteus medius', 'Hip', 'Hip abduction and pelvic stability.', 'hipTop', 'Kn', -0.1, 0.12, -0.02, 0.06, 0.045, 0.03],
  ['iliopsoas', 'Iliopsoas', 'Hip', 'Hip flexion.', 'spineLowSide', 'Kn', 0, 0.3, 0.04, 0, 0.022, 0.02],
  ['rectus_femoris', 'Rectus femoris', 'Thigh', 'Hip flexion and knee extension.', 'Hip', 'Kn', 0.1, 0.95, 0.055, 0, 0.034, 0.03],
  ['vastus_lateralis', 'Vastus lateralis', 'Thigh', 'Knee extension.', 'Hip', 'Kn', 0.15, 0.95, 0.02, 0.045, 0.034, 0.034],
  ['vastus_medialis', 'Vastus medialis', 'Thigh', 'Knee extension; kneecap tracking.', 'Hip', 'Kn', 0.55, 1, 0.035, -0.035, 0.03, 0.03],
  ['adductors', 'Adductors', 'Thigh', 'Pull the leg inward.', 'Hip', 'Kn', 0.05, 0.65, 0, -0.05, 0.038, 0.04],
  ['hamstrings', 'Hamstrings', 'Thigh', 'Knee flexion and hip extension.', 'Hip', 'Kn', 0.08, 0.92, -0.055, 0, 0.048, 0.04],
  ['gastrocnemius', 'Gastrocnemius', 'Lower leg', 'Points the foot; assists knee flexion.', 'Kn', 'An', 0.05, 0.55, -0.042, 0, 0.04, 0.036],
  ['soleus', 'Soleus', 'Lower leg', 'Points the foot.', 'Kn', 'An', 0.3, 0.85, -0.032, 0, 0.034, 0.03],
  ['tibialis_anterior', 'Tibialis anterior', 'Lower leg', 'Lifts the foot (dorsiflexion).', 'Kn', 'An', 0.05, 0.85, 0.03, 0.014, 0.018, 0.018]
].map(([id, name, region, fn, a, b, t0, t1, f, o, w, d]) => ({ id, name, region, fn, a, b, t0, t1, f, o, w, d }));

const COLORS = { likely: 0xff2d2d, possible: 0xff9f1c, minor: 0xffd166 };
const STATUS_LABEL = { likely: 'Likely affected', possible: 'Possibly involved', minor: 'Minor', normal: 'Normal' };
const statusOf = (score) => (score >= 0.6 ? 'likely' : score >= 0.3 ? 'possible' : score > 0 ? 'minor' : 'normal');

const labelLayer = document.createElement('div');
labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;';
threeEl.appendChild(labelLayer);
function makeLabel(css) {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;transform:translate(-50%,-50%);white-space:nowrap;display:none;' + css;
  labelLayer.appendChild(d);
  return d;
}

const muscles = [];
for (const def of DEFS) {
  for (const side of ['L', 'R']) {
    const mesh = new THREE.Mesh(
      spindle,
      new THREE.MeshStandardMaterial({ map: FIBER, color: 0xffffff, roughness: 0.5, metalness: 0.05, emissive: 0x000000 })
    );
    const key = `${def.id}_${side}`;
    mesh.userData.key = key;
    scene.add(mesh);
    const label = `${side === 'L' ? 'Left' : 'Right'} ${def.name.charAt(0).toLowerCase()}${def.name.slice(1)}`;
    muscles.push({
      key, def, side, label, mesh, score: 0, status: 'normal', reasons: [], act: 0,
      labelEl: makeLabel('font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(2,6,23,.85);color:#e5e7eb;')
    });
  }
}
const byKey = Object.fromEntries(muscles.map((m) => [m.key, m]));

// ---------- Skin (translucent body) + skeleton ----------
const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8cdb8, transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.9 });
const skinMeshes = Array.from({ length: 16 }, () => {
  const m = new THREE.Mesh(ellipsoid, skinMat);
  scene.add(m);
  return m;
});
const skeleton = new THREE.Group();
scene.add(skeleton);
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
const boneMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 });
const boneMeshes = BONES.map(() => {
  const m = new THREE.Mesh(cylinder, boneMat);
  skeleton.add(m);
  return m;
});
const JOINT_IDX = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const jointMeshes = JOINT_IDX.map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), boneMat);
  skeleton.add(m);
  return m;
});

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _off = new THREE.Vector3(), _dir = new THREE.Vector3(), _n = new THREE.Vector3();
function seg(mesh, A, B, t0, t1, w, d) {
  _a.lerpVectors(A, B, t0);
  _b.lerpVectors(A, B, t1);
  place(mesh, _a, _b, w, d, fr.F);
}

function updateBody() {
  computeFrame();
  const sp = { L: sidePoints('L'), R: sidePoints('R') };

  for (const m of muscles) {
    const p = sp[m.side];
    const d = m.def;
    const A = p[d.a], B = p[d.b];
    if (!A || !B) continue;
    _dir.subVectors(B, A).normalize();
    _off.set(0, 0, 0).addScaledVector(fr.F, d.f).addScaledVector(p.Xs, d.o);
    _off.addScaledVector(_dir, -_off.dot(_dir));
    _n.copy(_off.lengthSq() > 1e-6 ? _off : fr.F).normalize();
    _a.lerpVectors(A, B, d.t0).add(_off);
    _b.lerpVectors(A, B, d.t1).add(_off);
    place(m.mesh, _a, _b, d.w, d.d, _n);
  }

  let i = 0;
  const k = skinMeshes;
  seg(k[i++], fr.midHip, fr.midSh, -0.1, 1.08, 0.165, 0.1); // torso
  seg(k[i++], fr.midHip, fr.midSh, -0.35, 0.25, 0.155, 0.1); // pelvis
  const headLow = fr.headC.clone().addScaledVector(fr.Up, -0.11);
  const headTop = fr.headC.clone().addScaledVector(fr.Up, 0.12);
  seg(k[i++], fr.midSh, headLow, -0.1, 1.1, 0.045, 0.045); // neck
  seg(k[i++], headLow, headTop, 0, 1, 0.085, 0.1); // head
  for (const s of ['L', 'R']) {
    const p = sp[s];
    seg(k[i++], p.Sh, p.El, -0.12, 1.08, 0.048, 0.048);
    seg(k[i++], p.El, p.Wr, -0.05, 1.05, 0.04, 0.038);
    seg(k[i++], p.Wr, p.Hand, -0.1, 1.4, 0.03, 0.014);
    seg(k[i++], p.Hip, p.Kn, -0.15, 1.05, 0.075, 0.075);
    seg(k[i++], p.Kn, p.An, -0.05, 1.05, 0.052, 0.052);
    seg(k[i++], p.Heel, p.Toe, -0.1, 1.1, 0.04, 0.025);
  }

  if (skeleton.visible) {
    BONES.forEach(([a, b], j) => seg(boneMeshes[j], P[a], P[b], 0, 1, 0.007, 0.007));
    JOINT_IDX.forEach((idx, j) => jointMeshes[j].position.copy(P[idx]));
  }
}

// "Working now" activity from the live joint angles and speeds
function activity(side) {
  const sh = S.cur['shoulder' + side] ?? 0, shv = Math.abs(S.vel['shoulder' + side] || 0);
  const el = S.cur['elbow' + side] ?? 0, elv = S.vel['elbow' + side] || 0;
  const hipv = Math.abs(S.vel['hip' + side] || 0), knv = Math.abs(S.vel['knee' + side] || 0);
  const c = (v) => Math.min(1, Math.max(0, v));
  const shoulder = c((sh - 25) / 120 + shv / 200);
  const overhead = sh > 80 ? c((sh - 80) / 80 + shv / 250) : 0;
  const flex = c((el - 30) / 120 + Math.max(0, elv) / 200);
  const ext = c(Math.max(0, -elv) / 150);
  const hip = c(hipv / 150), knee = c(knv / 150);
  return {
    deltoid_anterior: shoulder, deltoid_middle: shoulder, deltoid_posterior: shoulder * 0.5,
    supraspinatus: shoulder, infraspinatus: shoulder * 0.6, teres_minor: shoulder * 0.5,
    trapezius_upper: Math.max(shoulder * 0.5, overhead), trapezius_lower: overhead, serratus_anterior: overhead,
    biceps_brachii: flex, brachialis: flex, brachioradialis: flex * 0.8, triceps_brachii: ext,
    iliopsoas: hip, rectus_femoris: Math.max(hip, knee * 0.6), gluteus_maximus: hip * 0.6,
    hamstrings: knee, vastus_lateralis: knee * 0.6, vastus_medialis: knee * 0.6, gastrocnemius: knee * 0.4
  };
}

// ---------- Selection, labels, views ----------
let selected = null;
const armLab = {
  L: makeLabel('font-size:13px;font-weight:800;padding:3px 8px;border-radius:8px;background:rgba(2,6,23,.85);border:1px solid #334155;'),
  R: makeLabel('font-size:13px;font-weight:800;padding:3px 8px;border-radius:8px;background:rgba(2,6,23,.85);border:1px solid #334155;')
};
const _p = new THREE.Vector3();
function toScreen(v) {
  _p.copy(v).project(cam3);
  const w = threeEl.clientWidth, h = threeEl.clientHeight;
  return { x: w - ((_p.x + 1) / 2) * w, y: ((1 - _p.y) / 2) * h, ok: _p.z < 1 }; // mirrored x
}
function putLabel(el, v) {
  const s = toScreen(v);
  el.style.display = s.ok ? 'block' : 'none';
  el.style.left = `${s.x}px`;
  el.style.top = `${s.y}px`;
}

function select(m) {
  selected = m;
  S.focusKey = m ? m.key : null;
  renderInfo();
}
function renderInfo() {
  const el = $('info');
  if (!selected) {
    el.style.display = 'none';
    return;
  }
  const m = selected;
  el.style.display = 'block';
  const pill = m.status === 'normal' ? '<span class="sub">No issue found</span>' : `<span class="pill" style="background:${hex(COLORS[m.status])}">${STATUS_LABEL[m.status]}</span>`;
  el.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><b>${m.label}</b><span id="infoClose" style="cursor:pointer">✕</span></div>
    <div style="margin:4px 0">${pill} <span class="sub">${m.def.region}</span></div>
    <div>${m.def.fn}</div>
    <div class="sub mono" style="margin-top:4px">Working now: <span id="infoAct">0%</span></div>
    ${m.reasons.length ? `<ul style="margin:6px 0 0;padding-left:16px">${m.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>` : ''}`;
  $('infoClose').onclick = () => select(null);
}

const camGoal = { pos: null };
function setView(name) {
  S.focusKey = null;
  const off = { front: [0, 0.15, 2.8], back: [0, 0.15, -2.8], side: [2.8, 0.15, 0] }[name];
  camGoal.pos = fr.chest.clone().add(new THREE.Vector3(...off));
}
function focusAffected() {
  const flagged = muscles.filter((m) => m.status === 'likely' || m.status === 'possible').sort((a, b) => b.score - a.score);
  if (!flagged.length) {
    setStatus('No affected muscles yet — run Analyze first.');
    return;
  }
  const m = flagged[0];
  select(m);
  const dir = fr.F.clone().multiplyScalar(m.def.f < 0 ? -1 : 1);
  camGoal.pos = m.mesh.position.clone().addScaledVector(dir, 1.1).addScaledVector(fr.Up, 0.15);
}

document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$('focusBtn').onclick = focusAffected;
const toggle = (id, fn) => {
  const b = $(id);
  b.onclick = () => b.classList.toggle('on', fn());
};
toggle('labelsBtn', () => (S.labels = !S.labels));
toggle('skelBtn', () => (skeleton.visible = !skeleton.visible));
toggle('followBtn', () => (S.follow = !S.follow));

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downXY = null;
renderer.domElement.addEventListener('pointerdown', (e) => (downXY = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(-(((e.clientX - r.left) / r.width) * 2 - 1), -((e.clientY - r.top) / r.height) * 2 + 1); // mirrored x
  raycaster.setFromCamera(pointer, cam3);
  const hit = raycaster.intersectObjects(muscles.map((m) => m.mesh))[0];
  select(hit ? byKey[hit.object.userData.key] : null);
});

// ---------- Render loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  if (!S.follow) P.forEach((v, i) => v.lerp(RESTV[i], 0.08));
  updateBody();

  const goal = S.focusKey ? byKey[S.focusKey].mesh.position : fr.chest;
  controls.target.lerp(goal, 0.1);
  if (camGoal.pos) {
    cam3.position.lerp(camGoal.pos, 0.08);
    if (cam3.position.distanceTo(camGoal.pos) < 0.01) camGoal.pos = null;
  }
  controls.update();

  const actL = activity('L'), actR = activity('R');
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  for (const m of muscles) {
    const target = (m.side === 'L' ? actL : actR)[m.def.id] || 0;
    m.act += 0.2 * (target - m.act);
    let col = 0x000000, inten = 0;
    if (m.status !== 'normal') {
      col = COLORS[m.status];
      inten = m.status === 'likely' ? 0.45 + 0.45 * pulse : m.status === 'possible' ? 0.3 + 0.25 * pulse : 0.2;
    } else if (m.act > 0.05) {
      col = 0x22d3ee;
      inten = 0.15 + 0.6 * m.act;
    }
    if (m === selected) {
      if (!col) col = 0x60a5fa;
      inten = Math.max(inten, 0.5 + 0.3 * pulse);
    }
    m.mesh.material.emissive.setHex(col);
    m.mesh.material.emissiveIntensity = inten;

    const showLabel = m === selected || (S.labels && m.status !== 'normal');
    if (showLabel) {
      m.labelEl.textContent = m.label;
      m.labelEl.style.border = `1px solid ${m.status === 'normal' ? '#60a5fa' : hex(COLORS[m.status])}`;
      putLabel(m.labelEl, m.mesh.position);
    } else m.labelEl.style.display = 'none';
  }

  for (const s of ['L', 'R']) {
    const c = S.cur['shoulder' + s];
    const el = armLab[s];
    if (c == null) {
      el.style.display = 'none';
      continue;
    }
    const p = pct(c, 180);
    el.textContent = `${s} ${p}%`;
    el.style.color = colorCss(p);
    putLabel(el, P[s === 'L' ? 13 : 14].clone().addScaledVector(fr.Up, 0.08));
  }
  renderer.render(scene, cam3);
}

// ============================================================
// Camera + pose tracking
// ============================================================
let landmarker = null, delegateName = '', looping = false, lastVideoTime = -1, frames = 0, fpsT = 0, lastPanel = 0;
let handLandmarker = null, handDelegate = '';
// Per-hand live metrics, keyed by 'L' / 'R' (the person's own left/right).
const HANDS = { L: null, R: null };
const hud = () =>
  ($('hud').textContent = landmarker
    ? `Pose: ${delegateName} · Hands: ${handLandmarker ? handDelegate : 'loading…'} · ${S.fps} fps · body ${S.bodyVisible ? 'detected ✓' : 'not detected'} · hands ${['L', 'R'].filter((k) => HANDS[k]).length}`
    : 'Pose model: loading…');

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// Create a MediaPipe task, trying GPU first (except Safari), falling back to CPU.
async function createTask(Task, vision, options) {
  const make = (delegate) => Task.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate } });
  // Safari's GPU path is unreliable for MediaPipe, so use CPU there.
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  if (!isSafari) {
    try {
      return [await withTimeout(make('GPU'), 20000), 'GPU'];
    } catch (err) {
      console.warn(`${Task.name || 'Task'} GPU failed, using CPU`, err);
    }
  }
  return [await make('CPU'), 'CPU'];
}

async function initLandmarker() {
  hud();
  const mod = await import(VISION_URL);
  const vision = await mod.FilesetResolver.forVisionTasks(WASM_URL);
  [landmarker, delegateName] = await createTask(mod.PoseLandmarker, vision, {
    baseOptions: { modelAssetPath: MODEL_FULL },
    runningMode: 'VIDEO',
    numPoses: 1
  });
  hud();
  // Hand model loads in the background; pose tracking works without it.
  createTask(mod.HandLandmarker, vision, {
    baseOptions: { modelAssetPath: HAND_MODEL },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  })
    .then(([h, d]) => {
      handLandmarker = h;
      handDelegate = d;
      hud();
    })
    .catch((err) => {
      console.warn('Hand landmarker failed to load', err);
      handDelegate = 'unavailable';
    });
}

// ---------- Hand metrics ----------
const HAND_CONN = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
const v3 = (a, b) => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
const ang3 = (u, v) => {
  const d = u.x * v.x + u.y * v.y + u.z * v.z;
  const n = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, d / n))) * 180) / Math.PI;
};
// Openness: average straightness of the 4 fingers (MCP→PIP→TIP), 0 = fist, 100 = flat open hand.
function handOpenness(w) {
  const fingers = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
  const bend = fingers.map(([m, p, t]) => ang3(v3(w[m], w[p]), v3(w[p], w[t])));
  const avg = bend.reduce((a, b) => a + b, 0) / bend.length; // ~0° straight, ~100°+ curled
  return Math.round(Math.max(0, Math.min(100, 100 - (avg / 100) * 100)));
}
// Wrist bend: angle between forearm (pose elbow→wrist) and hand (wrist→middle MCP), image space.
function wristBend(poseLm, side, hand) {
  if (!poseLm) return null;
  const [el, wr] = side === 'L' ? [13, 15] : [14, 16];
  if (vis(poseLm, el) < 0.5) return null;
  const fore = { x: poseLm[wr].x - poseLm[el].x, y: poseLm[wr].y - poseLm[el].y, z: 0 };
  const h = { x: hand[9].x - hand[0].x, y: hand[9].y - hand[0].y, z: 0 };
  return Math.round(ang3(fore, h));
}

function processHands(res, poseLm, now) {
  const seen = { L: false, R: false };
  (res?.landmarks || []).forEach((lm, i) => {
    // MediaPipe labels handedness for a mirrored (selfie) image, so 'Left' = person's left on an unmirrored webcam frame.
    const label = res.handednesses?.[i]?.[0]?.categoryName;
    const side = label === 'Left' ? 'R' : 'L';
    const world = res.worldLandmarks?.[i] || lm;
    const open = handOpenness(world);
    const prev = HANDS[side];
    HANDS[side] = {
      lm,
      open: prev ? Math.round(prev.open + (open - prev.open) * 0.4) : open,
      wrist: wristBend(poseLm, side, lm),
      t: now
    };
    seen[side] = true;
  });
  for (const k of ['L', 'R']) if (!seen[k] && HANDS[k] && now - HANDS[k].t > 400) HANDS[k] = null;
}

function renderHands() {
  for (const k of ['L', 'R']) {
    const h = HANDS[k];
    $('hand' + k).textContent = h ? `${h.open}% open${h.wrist != null ? ` · ${h.wrist}°` : ''}${h.open < 25 ? ' (fist)' : ''}` : '--';
  }
}

function drawHands() {
  const w = overlay.width, h = overlay.height;
  octx.lineWidth = Math.max(2, w / 400);
  for (const k of ['L', 'R']) {
    const hd = HANDS[k];
    if (!hd) continue;
    const lm = hd.lm;
    octx.strokeStyle = k === 'L' ? '#a78bfa' : '#f472b6';
    for (const [a, b] of HAND_CONN) {
      octx.beginPath();
      octx.moveTo(lm[a].x * w, lm[a].y * h);
      octx.lineTo(lm[b].x * w, lm[b].y * h);
      octx.stroke();
    }
    octx.fillStyle = '#fde68a';
    for (const p of lm) {
      octx.beginPath();
      octx.arc(p.x * w, p.y * h, Math.max(2, w / 350), 0, Math.PI * 2);
      octx.fill();
    }
  }
}

const OVERLAY_CONN = [[11, 12], [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32]];
const LEFT_ARM = new Set([11, 13, 15, 19]), RIGHT_ARM = new Set([12, 14, 16, 20]);
function drawOverlay(lm) {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);
  octx.lineWidth = Math.max(3, w / 220);
  octx.lineCap = 'round';
  const armCol = (side) => {
    const c = S.cur['shoulder' + side];
    return c == null ? '#38bdf8' : colorCss(pct(c, 180));
  };
  for (const [a, b] of OVERLAY_CONN) {
    if (vis(lm, a) < 0.4 || vis(lm, b) < 0.4) continue;
    const isL = LEFT_ARM.has(a) && LEFT_ARM.has(b) && !(a === 11 && b === 12);
    const isR = RIGHT_ARM.has(a) && RIGHT_ARM.has(b);
    octx.strokeStyle = isL ? armCol('L') : isR ? armCol('R') : '#38bdf8';
    octx.beginPath();
    octx.moveTo(lm[a].x * w, lm[a].y * h);
    octx.lineTo(lm[b].x * w, lm[b].y * h);
    octx.stroke();
  }
  octx.fillStyle = '#f8fafc';
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if (vis(lm, i) < 0.4) continue;
    octx.beginPath();
    octx.arc(lm[i].x * w, lm[i].y * h, Math.max(4, w / 200), 0, Math.PI * 2);
    octx.fill();
  }
}

function startLoop() {
  if (looping) return;
  looping = true;
  requestAnimationFrame(loop);
}
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  if (now - fpsT > 1000) {
    S.fps = frames;
    frames = 0;
    fpsT = now;
    hud();
  }
  if (now - lastPanel > 120) {
    renderPanels();
    lastPanel = now;
  }
  if (!landmarker || video.readyState < 2 || !video.videoWidth) return;
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  let res;
  try {
    res = landmarker.detectForVideo(video, now);
  } catch (err) {
    console.error(err);
    setStatus(`Pose tracking error: ${err.message}`);
    return;
  }
  frames++;
  const lm = res.landmarks?.[0], wl = res.worldLandmarks?.[0];
  if (handLandmarker) {
    try {
      processHands(handLandmarker.detectForVideo(video, now + 0.001), lm, now);
    } catch (err) {
      console.warn('Hand tracking error', err);
    }
  }
  if (lm && wl) {
    processPose(lm, wl, now);
    if (S.follow) updatePose(lm, wl);
    drawOverlay(lm);
    if (S.test.phase === 'recording') recordTestFrame(lm, wl);
  } else {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    S.bodyVisible = false;
  }
  drawHands();
  renderHands();
}

// ============================================================
// Arm-raise test + diagnosis
// ============================================================
function setBanner(phase, big, msg, progress) {
  $('testBanner').style.display = 'block';
  $('testPhase').textContent = phase;
  $('testBig').textContent = big;
  $('testMsg').textContent = msg;
  $('testBar').style.width = `${progress}%`;
}
const hideBanner = () => ($('testBanner').style.display = 'none');

function raisePlane(wl, sh, el) {
  const arm = { x: wl[el].x - wl[sh].x, z: wl[el].z - wl[sh].z };
  const ax = { x: wl[12].x - wl[11].x, z: wl[12].z - wl[11].z };
  const n = Math.hypot(ax.x, ax.z) || 1;
  const lateral = Math.abs((arm.x * ax.x + arm.z * ax.z) / n);
  const forward = Math.abs((arm.x * -ax.z + arm.z * ax.x) / n);
  return forward > lateral ? 'flexion' : 'abduction';
}

function recordTestFrame(lm, wl) {
  const T = S.test;
  for (const [side, key, sh, el] of [['L', 'shoulderL', 11, 13], ['R', 'shoulderR', 12, 14]]) {
    const v = S.cur[key];
    if (v == null || vis(lm, el) < VIS_MIN) continue;
    const s = T.side[side];
    if (v > s.peak) {
      s.peak = v;
      if (v > 40) s.plane = raisePlane(wl, sh, el);
    }
  }
  T.maxSpeed = Math.max(T.maxSpeed, S.camSpeed);
}

function waitForBody(timeoutMs = 15000) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (S.bodyVisible) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      setBanner('Finding you', '…', 'Step back until your shoulders, elbows and hips are in view.', 0);
      setTimeout(check, 200);
    };
    check();
  });
}

function runTest() {
  return new Promise((resolve) => {
    const T = S.test;
    T.side = { L: { peak: 0, plane: 'abduction' }, R: { peak: 0, plane: 'abduction' } };
    T.maxSpeed = 0;
    T.hr = [];
    T.ws = [];
    T.phase = 'countdown';
    let n = 3;
    const tick = () => {
      if (n > 0) {
        setBanner('Get ready', String(n), 'Face the camera, arms relaxed at your sides.', 0);
        n -= 1;
        setTimeout(tick, 1000);
        return;
      }
      T.phase = 'recording';
      T.start = performance.now();
      rec();
    };
    const rec = () => {
      const el = (performance.now() - T.start) / 1000;
      if (el >= TEST_SECONDS) {
        T.phase = 'idle';
        finishTest();
        resolve();
        return;
      }
      const best = Math.max(T.side.L.peak, T.side.R.peak);
      setBanner('Recording', `${pct(best, 180)}%`, 'Raise BOTH arms as high as you can, hold 1 second, then lower.', (el / TEST_SECONDS) * 100);
      if (S.watch) {
        if (S.watch.heartRate != null) T.hr.push(S.watch.heartRate);
        T.ws.push(watchSpeed(S.watch));
      }
      setTimeout(rec, 100);
    };
    tick();
  });
}

function finishTest() {
  const T = S.test;
  const side = (s) => (s.peak > 5 ? { peakDeg: Math.round(s.peak), pct: pct(s.peak, 180), plane: s.plane } : null);
  const L_ = side(T.side.L), R_ = side(T.side.R);
  if (!L_ && !R_) {
    setBanner('No arm movement detected', '--', 'Make sure your shoulders and elbows are in view, then click Analyze again.', 0);
    return;
  }
  const h = heightCm();
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const report = {
    createdAt: new Date().toISOString(),
    shoulder: { L: L_, R: R_ },
    maxArmSpeedDegS: Math.round(T.maxSpeed),
    vitals: {
      heartRate: T.hr.length ? Math.round(avg(T.hr)) : null,
      watchSpeed: T.ws.length ? Math.max(...T.ws) : null,
      simulated: S.watch?.sessionId === 'simulated-session'
    },
    heightCm: h ? Math.round(h.cm) : null
  };
  localStorage.setItem(REPORT_KEY, JSON.stringify(report));
  S.report = report;
  S.findings = analyzeReport(report);
  applyFindings();
  hideBanner();
  showDiagnosis(report);
  focusAffected();
  refreshExercises();
}

// Which muscles are likely involved, based on where each arm stopped.
function analyzeReport(report) {
  const out = {};
  const add = (key, w, reason) => {
    const e = out[key] || (out[key] = { score: 0, reasons: [] });
    e.score = Math.max(e.score, Math.min(1, w));
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
  };
  for (const side of ['L', 'R']) {
    const s = report.shoulder[side];
    if (!s) continue;
    const other = report.shoulder[side === 'L' ? 'R' : 'L'];
    const gap = other ? other.pct - s.pct : 0;
    if (s.pct >= 85 && gap < 15) continue;
    const sev = Math.min(1, Math.max(0.25, (90 - s.pct) / 50, gap / 40));
    const sideName = side === 'L' ? 'Left' : 'Right';
    const k = (id) => `${id}_${side}`;
    const deg = s.peakDeg;
    const prime = s.plane === 'flexion' ? 'deltoid_anterior' : 'deltoid_middle';
    const move = s.plane === 'flexion' ? 'forward raise' : 'side raise';
    if (deg < 30) {
      add(k('supraspinatus'), sev, `${sideName} ${move} stopped at ${deg}° — supraspinatus drives the first 0–30°.`);
      add(k(prime), 0.7 * sev, 'The deltoid takes over after 30°, which was never reached.');
    } else if (deg < 90) {
      add(k(prime), sev, `${sideName} ${move} stopped at ${deg}° — the deltoid drives 30–90°.`);
      add(k('supraspinatus'), 0.6 * sev, 'Rotator cuff keeps the joint centered while the deltoid lifts.');
      add(k('infraspinatus'), 0.4 * sev, 'Rotator cuff stabilizer during elevation.');
      add(k('teres_minor'), 0.35 * sev, 'Rotator cuff stabilizer during elevation.');
      if (s.plane === 'flexion') {
        add(k('pectoralis_major'), 0.5 * sev, 'Assists the forward raise.');
        add(k('coracobrachialis'), 0.4 * sev, 'Assists the forward raise.');
        add(k('biceps_brachii'), 0.35 * sev, 'Long head assists the forward raise.');
      }
    } else {
      add(k('serratus_anterior'), sev, `${sideName} ${move} stopped at ${deg}° — above 90° the shoulder blade must rotate upward (serratus anterior).`);
      add(k('trapezius_lower'), 0.85 * sev, 'Lower trapezius rotates the shoulder blade upward overhead.');
      add(k('trapezius_upper'), 0.7 * sev, 'Upper trapezius pairs with serratus for upward rotation.');
      add(k(prime), 0.5 * sev, 'Deltoid is still working near end range.');
    }
    add(k('latissimus_dorsi'), 0.35 * sev, 'Tight lats can block full overhead reach.');
    add(k('pectoralis_minor'), 0.3 * sev, 'A tight pec minor tilts the shoulder blade and limits reach.');
    if (gap >= 15) {
      for (const id of Object.keys(out)) if (id.endsWith('_' + side)) add(id, out[id].score, `${sideName} side is ${gap} points weaker than the other side.`);
    }
  }
  return out;
}

function applyFindings() {
  for (const m of muscles) {
    const f = S.findings[m.key];
    m.score = f ? f.score : 0;
    m.reasons = f ? f.reasons : [];
    m.status = statusOf(m.score);
  }
  renderInfo();
  renderFindings();
}

function showDiagnosis(r) {
  const { L: l, R: rr } = r.shoulder;
  const sides = [['Left', l], ['Right', rr]].filter(([, s]) => s);
  const [badName, bad] = sides.reduce((a, b) => (b[1].pct < a[1].pct ? b : a));
  const gap = l && rr ? Math.abs(l.pct - rr.pct) : 0;
  const ok = bad.pct >= 85 && gap < 15;
  const verdict = ok
    ? 'Both arms are within normal range. No clear weakness detected.'
    : `${badName} arm is the weaker side${gap >= 15 ? ` (${gap} points lower than the other arm)` : ''}.`;
  const box = (name, s) =>
    s
      ? `<div style="flex:1;min-width:150px;padding:12px;border-radius:10px;border:2px solid ${!ok && name === badName ? colorCss(s.pct) : '#1f2937'}">
          <div class="label">${name} arm</div>
          <div style="font-size:44px;font-weight:800;color:${colorCss(s.pct)}">${s.pct}%</div>
          <div class="sub mono">${s.peakDeg}° of 180° · ${s.plane === 'flexion' ? 'forward' : 'side'} raise</div></div>`
      : `<div style="flex:1;min-width:150px;padding:12px;border-radius:10px;border:1px solid #1f2937"><div class="label">${name} arm</div><div class="sub">not detected</div></div>`;
  const sideKey = badName === 'Left' ? 'L' : 'R';
  const top = muscles.filter((m) => m.side === sideKey && m.status !== 'normal').sort((a, b) => b.score - a.score).slice(0, 5);
  const el = $('result');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="label">Diagnosis · arm-raise test</div>
    <div style="font-size:20px;font-weight:700;margin:6px 0 10px">${verdict}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">${box('Left', l)}${box('Right', rr)}
      <div style="flex:1;min-width:150px;padding:12px;border-radius:10px;border:1px solid #1f2937">
        <div class="label">Watch + camera${r.vitals.simulated ? ' (watch data simulated)' : ''}</div>
        <div class="stat"><span>Heart rate</span><span class="mono">${r.vitals.heartRate ?? '--'} BPM</span></div>
        <div class="stat"><span>Wrist speed</span><span class="mono">${r.vitals.watchSpeed != null ? r.vitals.watchSpeed.toFixed(2) + ' m/s' : '--'}</span></div>
        <div class="stat"><span>Arm speed</span><span class="mono">${r.maxArmSpeedDegS} °/s</span></div>
        <div class="stat"><span>Height</span><span class="mono">${r.heightCm ? r.heightCm + ' cm' : '--'}</span></div>
      </div>
    </div>
    ${top.length ? `<div style="margin-top:10px"><span class="label">Muscles likely involved (${badName.toLowerCase()} side)</span>
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${top
        .map((m) => `<button data-mkey="${m.key}" style="border-color:${hex(COLORS[m.status])}">${m.def.name} · ${Math.round(m.score * 100)}%</button>`)
        .join('')}</div></div>` : ''}
    <p class="sub" style="margin-top:8px">Click a muscle to zoom to it on the 3D model. Estimate from one camera, not a medical diagnosis.</p>`;
  el.querySelectorAll('[data-mkey]').forEach((b) => {
    b.onclick = () => {
      const m = byKey[b.dataset.mkey];
      select(m);
      camGoal.pos = m.mesh.position.clone().addScaledVector(fr.F, m.def.f < 0 ? -1.1 : 1.1).addScaledVector(fr.Up, 0.15);
    };
  });
}

function renderFindings() {
  const out = [];
  if (S.report) {
    const flagged = muscles.filter((m) => m.status !== 'normal').sort((a, b) => b.score - a.score);
    for (const m of flagged.slice(0, 8)) {
      const c = m.status === 'likely' ? 'bad' : m.status === 'possible' ? 'mid' : '';
      out.push(`<p class="${c}">${m.status === 'likely' ? '⚠' : '•'} ${m.label}: ${STATUS_LABEL[m.status].toLowerCase()} (${Math.round(m.score * 100)}%) — ${m.reasons[0] || ''}</p>`);
    }
    if (!flagged.length) out.push('<p class="ok">✓ Arm-raise test: no weak shoulder muscles detected.</p>');
  }
  for (const base of ['elbow', 'hip', 'knee']) {
    for (const side of ['L', 'R']) {
      const k = base + side;
      const pk = S.peak[k];
      if (!pk) continue;
      const p = pct(pk, JOINTS[k].rom);
      if (p < 60) out.push(`<p class="bad">⚠ ${JOINTS[k].name}: only ${p}% of normal range so far.</p>`);
    }
  }
  $('findings').innerHTML = out.length ? out.join('') : '<p class="sub">Click Analyze and raise both arms to find weak muscles.</p>';
}

// ============================================================
// Panels
// ============================================================
function renderPanels() {
  for (const s of ['L', 'R']) {
    const c = S.cur['shoulder' + s];
    const pk = S.peak['shoulder' + s];
    const p = c == null ? null : pct(c, 180);
    $('arm' + s).textContent = p == null ? '--%' : `${p}%`;
    $('arm' + s).className = 'big ' + (p == null ? '' : cls(p));
    $('arm' + s + 'Bar').style.width = `${p ?? 0}%`;
    $('arm' + s + 'Bar').style.background = p == null ? '#1f2937' : colorCss(p);
    $('arm' + s + 'Deg').textContent = `${c == null ? '--' : c.toFixed(0)}° of 180° · peak ${pk ? pct(pk, 180) + '%' : '--'}`;
  }
  $('camSpeed').textContent = `${S.camSpeed.toFixed(0)} °/s`;
  $('camPeak').textContent = `${S.camPeak.toFixed(0)} °/s`;
  const best = Math.max(S.peak.shoulderL, S.peak.shoulderR);
  $('armPeak').textContent = best ? `${pct(best, 180)}% (${best.toFixed(0)}°)` : '--';
  const h = heightCm();
  $('heightOut').textContent = h ? `${h.cm.toFixed(0)} cm · ${(h.cm / 30.48).toFixed(2)} ft (${h.src})` : '-- (enter it, or show full body)';

  $('jointTable').innerHTML = Object.entries(JOINTS)
    .map(([k, j]) => {
      const cur = S.cur[k], pk = S.peak[k], p = pct(pk, j.rom);
      const st = !pk ? '<span class="sub">no data</span>' : `<span class="pill" style="background:${colorCss(p)}">${p >= 85 ? 'normal' : p >= 60 ? 'limited' : 'weak'}</span>`;
      return `<tr><td>${j.name}</td><td class="mono">${cur == null ? '--' : cur.toFixed(0) + '°'}</td><td class="mono">${pk ? pk.toFixed(0) + '°' : '--'}</td><td class="mono ${pk ? cls(p) : ''}">${pk ? p + '%' : '--'}</td><td>${st}</td></tr>`;
    })
    .join('');

  if (selected && $('infoAct')) $('infoAct').textContent = `${Math.round(selected.act * 100)}%`;
}

// ============================================================
// Apple Watch live stream
// ============================================================
function watchSpeed(w) {
  if (w.speed != null) return w.speed;
  const omega = Math.hypot(w.gyro.x, w.gyro.y, w.gyro.z); // rad/s
  const h = heightCm();
  return omega * (((h ? h.cm : 175) * 0.33) / 100); // ω × arm length
}

function spark(canvas, data, color) {
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  if (data.length < 2) return;
  let lo = Math.min(...data), hi = Math.max(...data);
  if (hi - lo < 1e-6) {
    hi += 1;
    lo -= 1;
  }
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  data.forEach((v, i) => {
    const x = (i / (SERIES - 1)) * w;
    const y = h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.stroke();
}

function renderWatch() {
  const w = S.watch;
  if (!w) return;
  $('hr').textContent = w.heartRate != null ? Math.round(w.heartRate) : '--';
  $('wSpeed').textContent = `${watchSpeed(w).toFixed(2)} m/s`;
  const g = Math.hypot(w.accel.x, w.accel.y, w.accel.z);
  $('wAccel').textContent = `${g.toFixed(2)} g`;
  $('wGyro').textContent = `${((Math.hypot(w.gyro.x, w.gyro.y, w.gyro.z) * 180) / Math.PI).toFixed(0)} °/s`;
  const known = new Set(['timestamp', 'receivedAt', 'accel', 'gyro', 'heartRate', 'source', 'sessionId', 'speed']);
  $('wExtra').innerHTML = Object.entries(w)
    .filter(([k]) => !known.has(k))
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('<br>');
  spark($('hrChart'), S.hr, '#22c55e');
  spark($('accelChart'), S.acc, '#38bdf8');
}

const events = new EventSource('/events');
events.onopen = () => ($('wConn').textContent = 'connected · waiting for data');
events.onerror = () => ($('wConn').textContent = 'reconnecting…');
events.addEventListener('motion', (e) => {
  const w = JSON.parse(e.data);
  S.watch = w;
  S.watchT = Date.now();
  if (w.heartRate != null) S.hr.push(w.heartRate);
  S.acc.push(Math.hypot(w.accel.x, w.accel.y, w.accel.z));
  if (S.hr.length > SERIES) S.hr.shift();
  if (S.acc.length > SERIES) S.acc.shift();
  renderWatch();
});
setInterval(() => {
  if (!S.watch) return;
  const age = (Date.now() - S.watchT) / 1000;
  const sim = S.watch.sessionId === 'simulated-session' ? ' · SIMULATED data' : '';
  $('wConn').textContent = age < 5 ? `live${sim}` : `no new data for ${age.toFixed(0)}s`;
}, 1000);

// ============================================================
// Analyze button (camera is started by the inline script in index.html)
// ============================================================
async function analyze() {
  const btn = $('analyzeBtn');
  if (S.test.phase !== 'idle') return;
  btn.disabled = true;
  $('result').style.display = 'none';
  hideBanner();
  try {
    startLoop();
    if (!landmarker) {
      setBanner('Loading', '…', 'Downloading the pose model (first time takes ~10s)…', 10);
      await initLandmarker();
    }
    setStatus(
      S.watch
        ? `Tracking live · watch connected (${S.watch.heartRate != null ? Math.round(S.watch.heartRate) : '--'} BPM)`
        : 'Tracking live · no watch data yet (test runs on camera only)'
    );
    if (!(await waitForBody())) {
      setBanner('Could not see you', '--', 'Step back so your shoulders and elbows are in view, with good light, then click Analyze again.', 0);
      return;
    }
    await runTest();
  } catch (err) {
    console.error(err);
    setBanner('Error', '!', err.message, 0);
    setStatus(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Analyze again';
  }
}
window.__analyze = analyze;

// ============================================================
// Exercise alerts → Apple Watch (via ntfy on the iPhone)
// ============================================================
const EXERCISES = [
  { id: 'wall_slides', name: 'Wall slides', dose: '2 × 10 slow reps', how: 'Back and forearms against a wall, slide your arms up overhead and back down.', targets: ['serratus_anterior', 'trapezius_lower', 'trapezius_upper'] },
  { id: 'serratus_punch', name: 'Serratus punches', dose: '2 × 12 each arm', how: 'Lying on your back, reach your arm to the ceiling and push the shoulder blade up off the floor, then lower.', targets: ['serratus_anterior'] },
  { id: 'prone_y', name: 'Prone Y raises', dose: '2 × 10', how: 'Face down, thumbs up, lift your arms into a Y and squeeze your lower shoulder blades.', targets: ['trapezius_lower', 'trapezius_middle', 'rhomboids'] },
  { id: 'scaption', name: 'Scaption raises', dose: '2 × 10, light or no weight', how: 'Thumbs up, raise your arms slightly in front of your sides to shoulder height, lower slowly.', targets: ['supraspinatus', 'deltoid_middle', 'deltoid_anterior'] },
  { id: 'side_ext_rot', name: 'Side-lying external rotation', dose: '2 × 12 each side', how: 'Lying on your side, elbow bent 90° against your ribs, rotate your forearm up toward the ceiling.', targets: ['infraspinatus', 'teres_minor'] },
  { id: 'wall_walk', name: 'Wall finger walks', dose: '5 slow walks', how: 'Face a wall, walk your fingers up as high as is comfortable, hold 5 s, walk back down.', targets: ['deltoid_anterior', 'deltoid_middle', 'supraspinatus'] },
  { id: 'pendulum', name: 'Pendulum swings', dose: '1 minute each arm', how: 'Lean on a table, let the arm hang loose and swing it in small circles.', targets: ['supraspinatus', 'deltoid_middle'] },
  { id: 'doorway_stretch', name: 'Doorway chest stretch', dose: '3 × 30 s', how: 'Forearms on a doorframe at shoulder height, step through gently until you feel a chest stretch.', targets: ['pectoralis_major', 'pectoralis_minor'] },
  { id: 'lat_stretch', name: 'Overhead lat stretch', dose: '3 × 30 s each side', how: 'Hold a doorframe overhead and sit your hips back and away to stretch the side of your back.', targets: ['latissimus_dorsi', 'teres_major'] },
  { id: 'arm_circles', name: 'Arm circles', dose: '30 s forward, 30 s back', how: 'Arms out to the sides, start with small circles and make them bigger.', targets: ['deltoid_anterior', 'deltoid_middle', 'deltoid_posterior'] }
];
const exById = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

function weakSide() {
  const r = S.report;
  if (!r) return '';
  const { L: l, R: rr } = r.shoulder;
  if (l && rr) return l.pct === rr.pct ? '' : l.pct < rr.pct ? 'Left' : 'Right';
  return l ? 'Left' : rr ? 'Right' : '';
}

// Rank exercises by how much they target the muscles flagged on the weak side.
function recommendedExercises() {
  const side = weakSide();
  const sides = side ? [side[0]] : ['L', 'R'];
  return EXERCISES.map((e) => ({
    e,
    score: e.targets.reduce((s, id) => s + Math.max(...sides.map((sd) => S.findings[`${id}_${sd}`]?.score || 0)), 0)
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}

function refreshExercises() {
  const sel = $('exSelect');
  const prev = sel.value;
  const rec = recommendedExercises();
  const opt = (e) => `<option value="${e.id}">${e.name} (${e.dose})</option>`;
  sel.innerHTML =
    (rec.length ? `<optgroup label="Recommended for you">${rec.map(opt).join('')}</optgroup>` : '') +
    `<optgroup label="All exercises">${EXERCISES.filter((e) => !rec.includes(e)).map(opt).join('')}</optgroup>`;
  sel.value = rec.length ? rec[0].id : prev || EXERCISES[0].id;
  $('exSide').value = weakSide();
  renderExPreview();
}

function buildAlert() {
  const e = exById[$('exSelect').value];
  const side = $('exSide').value;
  const why = e.targets.map((id) => muscles.find((m) => m.def.id === id)?.def.name).filter(Boolean).slice(0, 2).join(' & ');
  return {
    title: `Exercise: ${e.name}${side ? ` (${side.toLowerCase()} side)` : ''}`,
    message: `${e.dose}. ${e.how}${why ? ` Targets: ${why}.` : ''}`
  };
}

function renderExPreview() {
  const a = buildAlert();
  $('exPreview').innerHTML = `Preview: <b style="color:#e5e7eb">${a.title}</b> · ${a.message}`;
}

function logAlert(entry) {
  const el = $('alertLog');
  const line = `${new Date(entry.at).toLocaleTimeString()} · ${entry.ok ? '✓ sent' : '✗ failed'}${entry.kind === 'reminder' ? ' (reminder)' : ''} · ${entry.title}${entry.error ? ` — ${entry.error}` : ''}`;
  el.innerHTML = `<div class="${entry.ok ? 'ok' : 'bad'}">${line}</div>` + el.innerHTML;
  while (el.children.length > 8) el.removeChild(el.lastChild);
}

async function postJSON(url, body, method = 'POST') {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function renderReminder(rem) {
  $('remindBtn').textContent = rem ? 'Stop reminders' : 'Start reminders';
  $('remindBtn').classList.toggle('on', !!rem);
  $('remindStatus').textContent = rem ? `every ${rem.intervalMin} min · next ${new Date(rem.nextAt).toLocaleTimeString()}` : '';
}

let reminderOn = false;
$('sendExBtn').onclick = async () => {
  const btn = $('sendExBtn');
  btn.disabled = true;
  try {
    await postJSON('/alert', buildAlert()); // result is logged via the SSE 'alert' event
  } catch (err) {
    logAlert({ at: new Date().toISOString(), ok: false, title: buildAlert().title, error: err.message });
  } finally {
    btn.disabled = false;
  }
};
$('remindBtn').onclick = async () => {
  try {
    if (reminderOn) {
      await postJSON('/alert/reminder', null, 'DELETE');
      reminderOn = false;
      renderReminder(null);
    } else {
      const j = await postJSON('/alert/reminder', { ...buildAlert(), intervalMin: Number($('remindMin').value) });
      reminderOn = true;
      renderReminder(j.reminder);
    }
  } catch (err) {
    $('remindStatus').textContent = `Error: ${err.message}`;
  }
};
$('exSelect').onchange = renderExPreview;
$('exSide').onchange = renderExPreview;
$('alertSetupToggle').onclick = () => {
  const el = $('alertSetup');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
};
events.addEventListener('alert', (e) => logAlert(JSON.parse(e.data)));

fetch('/alert/config')
  .then((r) => r.json())
  .then((c) => {
    $('ntfyTopic').textContent = c.topic;
    reminderOn = !!c.reminder;
    renderReminder(c.reminder);
    c.log.slice().reverse().forEach(logAlert);
    if (!c.log.length) $('alertSetup').style.display = 'block'; // show setup until the first alert is sent
  })
  .catch(() => ($('ntfyTopic').textContent = 'unavailable (is the server running?)'));
refreshExercises();

// ============================================================
// Watch app simulator (mirrors Kyle/watch-app on the real watch)
// ============================================================
const W = { screen: 'idle', active: null, timer: null };
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function wsShow(name) {
  W.screen = name;
  document.querySelectorAll('#watchScreen .ws').forEach((el) => el.classList.toggle('active', el.dataset.screen === name));
}

function wsTick() {
  const now = new Date();
  $('wsClock').textContent = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (W.active) {
    $('wsTimer').textContent = fmtDur((Date.now() - Date.parse(W.active.startedAt)) / 1000);
  }
}
setInterval(wsTick, 500);
wsTick();

function wsNotify(p) {
  if (W.active) return; // don't interrupt a recording
  $('wsNTitle').textContent = p.title;
  $('wsNBody').textContent = p.message;
  wsShow('notify');
}

function wsStarted(info) {
  W.active = info;
  W.samples = 0;
  $('wsExercise').textContent = info.exercise;
  $('wsSamples').textContent = '0';
  wsShow('recording');
  $('status').textContent = `Session started from the ${info.startedBy} — recording watch motion${window.__camStream ? ' and camera' : ''}.`;
  // camera analysis runs too if the camera is already on (browsers need a click to turn it on)
  if (window.__camStream && S.test.phase === 'idle') analyze();
}

function wsStopped(sum) {
  W.active = null;
  $('wsSumTime').textContent = fmtDur(sum.durationSec);
  $('wsSumHR').textContent = sum.avgHeartRate ? `${sum.avgHeartRate} bpm` : '--';
  $('wsSumPeak').textContent = `${sum.peakAccel.toFixed(2)} g`;
  $('wsSumN').textContent = String(sum.samples);
  wsShow('summary');
  $('status').textContent = `Session saved: ${fmtDur(sum.durationSec)}, ${sum.samples} watch samples (stopped from the ${sum.stoppedBy}).`;
}

document.querySelectorAll('#watchScreen [data-act]').forEach((b) => {
  b.addEventListener('click', async () => {
    const act = b.dataset.act;
    try {
      if (act === 'start') {
        const ex = W.screen === 'notify' ? $('wsNTitle').textContent.replace(/^Exercise:\s*/, '') : 'Mobility session';
        await postJSON('/session/start', { by: 'watch', exercise: ex });
      } else if (act === 'stop') {
        await postJSON('/session/stop', { by: 'watch' });
      } else {
        wsShow('idle');
      }
    } catch (err) {
      $('status').textContent = `Watch: ${err.message}`;
    }
  });
});

$('wsPromptBtn').onclick = async () => {
  try {
    await postJSON('/alert', buildAlert());
  } catch {
    /* ntfy may fail offline; the watch prompt is still queued and shown via SSE */
  }
};

events.addEventListener('prompt', (e) => wsNotify(JSON.parse(e.data)));
events.addEventListener('session', (e) => {
  const d = JSON.parse(e.data);
  if (d.state === 'started') wsStarted(d.session);
  else wsStopped(d.session);
});
events.addEventListener('motion', (e) => {
  if (!W.active) return;
  const m = JSON.parse(e.data);
  if (m.sessionId !== W.active.id) return;
  W.samples += 1;
  $('wsSamples').textContent = String(W.samples);
  if (m.heartRate) $('wsHR').textContent = Math.round(m.heartRate);
  $('wsMotion').textContent = `${Math.hypot(m.accel.x, m.accel.y, m.accel.z).toFixed(2)} g`;
});

fetch('/session')
  .then((r) => r.json())
  .then((s) => (s.active ? wsStarted(s.active) : wsShow('idle')))
  .catch(() => wsShow('idle'));
fetch('/watch/info')
  .then((r) => r.json())
  .then((i) => ($('wsLan').textContent = i.lanUrls[0] || 'no Wi-Fi address found'))
  .catch(() => {});

function resetSession() {
  for (const k of Object.keys(JOINTS)) {
    S.cur[k] = null;
    S.peak[k] = 0;
    S.vel[k] = 0;
  }
  S.camSpeed = 0;
  S.camPeak = 0;
  S.report = null;
  S.findings = {};
  select(null);
  applyFindings();
  $('result').style.display = 'none';
  renderPanels();
  if (typeof refreshExercises === 'function' && $('exSelect').options.length) refreshExercises();
}
$('resetBtn').onclick = resetSession;
$('heightInput').addEventListener('input', renderPanels);

// ============================================================
// Start
// ============================================================
resetSession();
resize3();
animate();
setStatus('Ready. Click “Analyze”: camera + body tracking start, the 3D model follows you, then the arm-raise test runs.');
