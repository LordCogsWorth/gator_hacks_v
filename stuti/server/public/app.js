import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RehabSession, askGemma, ruleSuggestions, REPLAY_JOINTS, BONES, CFG } from './rehab.js';
import { initExtras } from './weakness.js';

const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const POSE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const HAND = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const $ = (id) => document.getElementById(id);
const video = $('video'), ov = $('overlay'), octx = ov.getContext('2d');
const say = (t) => ($('status').textContent = t);
window.addEventListener('unhandledrejection', (e) => say(`Error: ${e.reason?.message || e.reason}`));

let mod, vision, pose, hand, RS = null, stream = null, lastDet = 0, lastVT = -1, frames = 0, fpsT = 0, fps = 0;
let replay = null, timer = null;
const isHand = () => $('exSel').value === 'hand_open';

// ---------- 3D stick figure ----------
const el3 = $('three');
const R = new THREE.WebGLRenderer({ antialias: true });
R.setPixelRatio(devicePixelRatio);
el3.appendChild(R.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);
const cam = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 50);
cam.position.set(0, 0.35, 2.2);
const ctrl = new OrbitControls(cam, R.domElement);
ctrl.target.set(0, 0.25, 0);
scene.add(new THREE.GridHelper(3, 12, 0x334155, 0x1e293b));
const pts = REPLAY_JOINTS.map(() => new THREE.Vector3());
const balls = pts.map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), new THREE.MeshBasicMaterial({ color: 0x38bdf8 })); scene.add(m); return m; });
const lineG = new THREE.BufferGeometry();
lineG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
scene.add(new THREE.LineSegments(lineG, new THREE.LineBasicMaterial({ color: 0xe2e8f0 })));
balls.forEach((b) => (b.visible = false));
new ResizeObserver(() => {
  const w = el3.clientWidth, h = el3.clientHeight;
  if (w && h) { R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
}).observe(el3);

const X = initExtras({ scene, cam, R, pts, say });
// p = 13 {x,y,z} in MediaPipe world coords (y down); flipped to mirror the selfie view
function setFigure(p, snap) {
  p.forEach((q, i) => {
    const t = new THREE.Vector3(-q.x, -q.y, -q.z);
    snap ? pts[i].copy(t) : pts[i].lerp(t, 0.5);
    balls[i].position.copy(pts[i]);
  });
  const a = lineG.attributes.position;
  BONES.forEach(([i, j], k) => { a.setXYZ(k * 2, pts[i].x, pts[i].y, pts[i].z); a.setXYZ(k * 2 + 1, pts[j].x, pts[j].y, pts[j].z); });
  a.needsUpdate = true;
}

// ---------- models (hand model loads only for the hand exercise) ----------
async function task(T, opts) {
  for (const d of ['GPU', 'CPU']) {
    try { return await T.createFromOptions(vision, { ...opts, baseOptions: { ...opts.baseOptions, delegate: d } }); }
    catch (e) { console.warn(d, 'failed', e); }
  }
  throw new Error('Could not load the model');
}
async function ensureModels() {
  if (!mod) { mod = await import(`${V}/vision_bundle.mjs`); vision = await mod.FilesetResolver.forVisionTasks(`${V}/wasm`); }
  if (isHand() && !hand) { $('hud').textContent = 'loading hand model…'; hand = await task(mod.HandLandmarker, { baseOptions: { modelAssetPath: HAND }, runningMode: 'VIDEO', numHands: 2 }); }
  if (!isHand() && !pose) { $('hud').textContent = 'loading pose model…'; pose = await task(mod.PoseLandmarker, { baseOptions: { modelAssetPath: POSE }, runningMode: 'VIDEO', numPoses: 1 }); }
  $('hud').textContent = isHand() ? 'Hand model active' : 'Pose model active';
}
async function startCam() {
  if (stream) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs http://localhost or https. Open the app from a local server, not a file.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
  } catch (e) {
    throw new Error(e.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in the browser and OS privacy settings.' : e.name === 'NotReadableError' ? 'Camera is in use by another app.' : e.message);
  }
  video.srcObject = stream;
  await video.play();
  $('camBtn').textContent = 'Camera on';
}

// ---------- overlay ----------
function drawPose(lm) {
  const w = ov.width, h = ov.height;
  octx.strokeStyle = '#38bdf8'; octx.lineWidth = 3;
  const ok = (i) => (lm[i].visibility ?? 1) >= 0.5;
  for (const [a, b] of BONES) {
    const i = REPLAY_JOINTS[a], j = REPLAY_JOINTS[b];
    if (!ok(i) || !ok(j)) continue;
    octx.beginPath(); octx.moveTo(lm[i].x * w, lm[i].y * h); octx.lineTo(lm[j].x * w, lm[j].y * h); octx.stroke();
  }
  octx.fillStyle = '#f8fafc';
  for (const i of REPLAY_JOINTS) if (ok(i)) { octx.beginPath(); octx.arc(lm[i].x * w, lm[i].y * h, 4, 0, 7); octx.fill(); }
}
function drawHands(hands) {
  octx.fillStyle = '#fde68a';
  for (const hd of hands) for (const p of hd.lm) { octx.beginPath(); octx.arc(p.x * ov.width, p.y * ov.height, 3, 0, 7); octx.fill(); }
}

// ---------- live readout ----------
function showLive(o) {
  X.live(o);
  const c = CFG.ex[$('exSel').value];
  $('liveLabel').textContent = c.label;
  $('liveMetric').textContent = `${Math.round(o.value)}${c.unit}`;
  $('liveReps').textContent = o.reps;
  $('liveLean').textContent = o.calibrating ? 'rest…' : `${o.lean.toFixed(1)}°`;
  $('liveHike').textContent = o.calibrating || $('exSel').value !== 'arm_raise' ? '--' : `${(o.hike * 100).toFixed(0)}%`;
  $('compAlert').style.display = o.flagged ? 'block' : 'none';
}

// ---------- main loop (~15-20 fps detection; only the model the exercise needs runs) ----------
function loop() {
  requestAnimationFrame(loop);
  ctrl.update(); X.update(); R.render(scene, cam);
  const now = performance.now();
  if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; if (stream) $('hud').textContent = `${isHand() ? 'Hand' : 'Pose'} · ${fps} fps`; }
  if (video.readyState < 2 || !video.videoWidth || now - lastDet < 50 || video.currentTime === lastVT) return;
  lastDet = now; lastVT = video.currentTime;
  if (ov.width !== video.videoWidth) { ov.width = video.videoWidth; ov.height = video.videoHeight; }
  octx.clearRect(0, 0, ov.width, ov.height);
  let lm, wl, hands = [];
  try {
    if (isHand() && hand) {
      const r = hand.detectForVideo(video, now), hs = r.handedness || r.handednesses || [];
      // MediaPipe assumes a mirrored image, so its "Left" label is the person's right hand here
      hands = (r.landmarks || []).map((l, i) => ({ side: hs[i]?.[0]?.categoryName === 'Left' ? 'R' : 'L', lm: l, wl: r.worldLandmarks?.[i] || l }));
      drawHands(hands);
    } else if (!isHand() && pose) {
      const r = pose.detectForVideo(video, now);
      lm = r.landmarks?.[0]; wl = r.worldLandmarks?.[0];
      if (lm) drawPose(lm);
      if (wl && !replay) setFigure(REPLAY_JOINTS.map((i) => wl[i]));
    } else return;
  } catch (e) { say(`Tracking error: ${e.message}`); return; }
  frames++;
  if (RS?.active) { const o = RS.feed({ lm, wl, hands, t: now }); if (o) showLive(o); }
}

// ---------- recording ----------
async function rec(role) {
  try {
    await startCam();
    await ensureModels();
    if (!RS) RS = new RehabSession($('exSel').value, $('weakSel').value);
    RS.start(role);
    $('liveReps').textContent = '0';
    say(`Recording ${role.toUpperCase()} arm. Rest the arm for 1 second, then repeat the movement across the camera's view.`);
  } catch (e) { say(e.message); }
}
const resetSession = () => { RS = null; $('compAlert').style.display = 'none'; ensureModels().catch((e) => say(e.message)); };
$('exSel').onchange = $('weakSel').onchange = resetSession;
$('camBtn').onclick = () => startCam().then(() => ensureModels()).catch((e) => say(e.message));
$('recHealthy').onclick = () => rec('healthy');
$('recWeak').onclick = () => rec('weak');
$('leanTh').oninput = (e) => (CFG.leanDeg = +e.target.value || 12);
$('hikeTh').oninput = (e) => (CFG.hikeFrac = (+e.target.value || 10) / 100);

const row = (l, h, w) => `<tr><td>${l}</td><td>${h}</td><td>${w}</td></tr>`;
$('recStop').onclick = async () => {
  if (!RS) return;
  RS.stop();
  $('compAlert').style.display = 'none';
  const r = RS.report(), h = r.healthy, w = r.weak, c = CFG.ex[r.exercise], u = c.unit;
  X.findings(r);
  $('rehabOut').innerHTML = `
    <b>${c.label}</b> · weak side ${r.weakSide} · symmetry <span class="pill">${r.symmetryPct != null ? r.symmetryPct + '%' : 'record both arms'}</span>
    <table style="margin-top:8px"><thead><tr><th>Metric</th><th>Healthy</th><th>Weak</th></tr></thead><tbody>
    ${row('Best ' + c.label.toLowerCase(), h.best + u, w.best + u)}
    ${r.exercise === 'forward_reach' ? row('Best reach', h.reachCm + ' cm', w.reachCm + ' cm') : ''}
    ${r.exercise === 'hand_open' ? row('Closed (fist) value', (h.closedMin ?? '--') + u, (w.closedMin ?? '--') + u) : ''}
    ${row('Reps', h.reps, w.reps)}${row('Avg time per rep', h.avgDuration + ' s', w.avgDuration + ' s')}
    ${row('Smoothness (speed peaks/rep)', h.bursts, w.bursts)}${row('Reps with compensation', h.compPct + '%', w.compPct + '%')}
    ${row('Fatigue (last 3 vs first 3)', h.fatiguePct + '%', w.fatiguePct + '%')}</tbody></table>
    <p>${ruleSuggestions(r).join('<br>')}</p>`;
  if (r.exercise === 'hand_open' && !w.reps) $('rehabOut').innerHTML += '<p class="sub">No hand reps detected. If the model lost the hand, ask the patient to open it toward the camera as far as they can.</p>';
  if (r.symmetryPct == null) return;
  $('gemmaOut').textContent = 'Requesting Gemma assessment…';
  try { $('gemmaOut').textContent = await askGemma(r); }
  catch { $('gemmaOut').textContent = 'Gemma server unreachable. Start it with: node gemma-server.mjs'; }
};

// ---------- 3D replay ----------
function loadReplay(f) {
  if (!f.length) { $('replayInfo').textContent = 'No frames recorded (arm exercises only).'; return false; }
  clearInterval(timer);
  replay = { f, i: 0 };
  $('scrub').max = f.length - 1;
  showFrame(0);
  return true;
}
function showFrame(i) {
  const fr = replay.f[i]; if (!fr) return;
  replay.i = i; $('scrub').value = i;
  setFigure(REPLAY_JOINTS.map((_, k) => ({ x: fr.j[k * 3], y: fr.j[k * 3 + 1], z: fr.j[k * 3 + 2] })), true);
  $('replayInfo').textContent = `frame ${i + 1}/${replay.f.length} · ${fr.role} arm · ${((fr.t - replay.f[0].t) / 1000).toFixed(1)} s`;
}
$('playBtn').onclick = () => {
  if (!replay && !loadReplay(RS?.frames3D || [])) return;
  clearInterval(timer);
  if (replay.i >= replay.f.length - 1) replay.i = 0;
  timer = setInterval(() => (replay.i + 1 >= replay.f.length ? clearInterval(timer) : showFrame(replay.i + 1)), 1000 / 15);
};
$('scrub').oninput = (e) => { if (!replay && !loadReplay(RS?.frames3D || [])) return; clearInterval(timer); showFrame(+e.target.value); };
$('liveBtn').onclick = () => { clearInterval(timer); replay = null; $('replayInfo').textContent = 'Live view.'; };
$('saveBtn').onclick = () => {
  if (!RS?.frames3D.length) return say('Nothing to save yet. Record an arm exercise first.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([RS.replayJSON()], { type: 'application/json' }));
  a.download = `rehab-session-${Date.now()}.json`; a.click();
};
$('loadFile').onchange = async (e) => {
  try { loadReplay(JSON.parse(await e.target.files[0].text()).frames || []); } catch { say('That file is not a RehabTrack replay.'); }
};

loop();