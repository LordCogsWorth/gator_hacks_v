// Extras: 3D muscle model, weakness findings, exercise recommendations, ntfy → Apple Watch, watch preview.
import * as THREE from 'three';

const IDX = { nose: 0, sh: [1, 2], el: [3, 4], wr: [5, 6], hip: [7, 8] }; // positions in REPLAY_JOINTS, [L, R]
// id, name, function, from, to, t0, t1, width, sideways offset
const MUSCLES = [
  ['deltoid', 'Deltoid', 'Lifts the arm out to the side and forward (30–90°).', 'sh', 'el', -0.05, 0.5, 0.045, 0],
  ['supraspinatus', 'Supraspinatus', 'Starts the arm raise (first 30°) and keeps the shoulder centered.', 'sh', 'el', -0.2, 0.12, 0.03, 0],
  ['trapezius_upper', 'Upper trapezius', 'Lifts the shoulder blade. Overworks when the shoulder hikes.', 'nose', 'sh', 0.1, 1, 0.03, 0],
  ['serratus_anterior', 'Serratus anterior', 'Rotates the shoulder blade upward above 90°.', 'sh', 'hip', 0.2, 0.65, 0.045, 0.03],
  ['latissimus_dorsi', 'Latissimus dorsi', 'Pulls the arm down. Tightness limits reach.', 'hip', 'sh', 0.1, 0.9, 0.05, -0.03],
  ['biceps', 'Biceps', 'Bends the elbow.', 'sh', 'el', 0.2, 0.95, 0.03, 0.02],
  ['triceps', 'Triceps', 'Straightens the elbow.', 'sh', 'el', 0.1, 0.95, 0.03, -0.02],
  ['forearm_extensors', 'Wrist & finger extensors', 'Open the hand and lift the wrist.', 'el', 'wr', 0, 0.85, 0.025, 0.015],
  ['forearm_flexors', 'Wrist & finger flexors', 'Close the hand. Tightness keeps the fist curled.', 'el', 'wr', 0, 0.85, 0.025, -0.015]
];
const COL = { likely: 0xff2d2d, possible: 0xff9f1c, minor: 0xffd166 };
const STAT = { likely: 'Likely affected', possible: 'Possibly involved', minor: 'Minor', normal: 'Normal' };
const statusOf = (s) => (s >= 0.6 ? 'likely' : s >= 0.3 ? 'possible' : s > 0 ? 'minor' : 'normal');

const EXERCISES = [
  ['scaption', 'Scaption raises', '2 × 10, light or no weight', 'Thumbs up, raise your arms slightly in front of your sides to shoulder height, lower slowly.', ['supraspinatus', 'deltoid']],
  ['wall_walk', 'Wall finger walks', '5 slow walks', 'Face a wall, walk your fingers up as high as is comfortable, hold 5 s, walk back down.', ['deltoid', 'supraspinatus']],
  ['wall_slides', 'Wall slides', '2 × 10 slow reps', 'Back and forearms on a wall, slide your arms up overhead and back down.', ['serratus_anterior', 'trapezius_upper']],
  ['serratus_punch', 'Serratus punches', '2 × 12 each arm', 'Lying on your back, reach to the ceiling and push the shoulder blade up off the floor.', ['serratus_anterior']],
  ['lat_stretch', 'Overhead lat stretch', '3 × 30 s each side', 'Hold a doorframe overhead and sit your hips back to stretch the side of your back.', ['latissimus_dorsi']],
  ['table_slide', 'Forward table slides', '2 × 10', 'Slide your hand forward on a table, straighten the elbow, return slowly.', ['triceps', 'biceps']],
  ['finger_lift', 'Finger extension lifts', '2 × 10, hold 3 s', 'Forearm on a table palm down, lift your fingers off the table and hold.', ['forearm_extensors']],
  ['flexor_stretch', 'Gentle finger flexor stretch', '3 × 30 s', 'Arm out, palm up, use the other hand to ease the fingers back until you feel a mild stretch.', ['forearm_flexors']]
];

export function initExtras({ scene, cam, R, pts, say }) {
  const $ = (id) => document.getElementById(id);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(1.5, 3, 2.5); scene.add(key);

  const prof = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; prof.push(new THREE.Vector2(0.05 + 0.95 * Math.pow(Math.sin(Math.PI * t), 0.7), t - 0.5)); }
  const spindle = new THREE.LatheGeometry(prof, 16);
  const muscles = [];
  for (const [id, name, fn, a, b, t0, t1, w, ox] of MUSCLES) {
    for (const s of [0, 1]) {
      const mesh = new THREE.Mesh(spindle, new THREE.MeshStandardMaterial({ color: 0x9f1d1d, roughness: 0.55, transparent: true, opacity: 0.85, emissive: 0x000000 }));
      const m = { id, name, fn, a, b, t0, t1, w, ox: s ? -ox : ox, s, mesh, key: `${id}_${s ? 'R' : 'L'}`, label: `${s ? 'Right' : 'Left'} ${name.toLowerCase()}`, score: 0, status: 'normal', reasons: [] };
      mesh.userData.m = m; scene.add(mesh); muscles.push(m);
    }
  }
  const P = (k, s) => pts[Array.isArray(IDX[k]) ? IDX[k][s] : IDX[k]];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  let selected = null;

  function update() {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
    for (const m of muscles) {
      A.lerpVectors(P(m.a, m.s), P(m.b, m.s), m.t0); B.lerpVectors(P(m.a, m.s), P(m.b, m.s), m.t1);
      const d = B.clone().sub(A), len = d.length();
      if (len < 1e-3) continue;
      m.mesh.position.copy(A).add(B).multiplyScalar(0.5); m.mesh.position.x += m.ox;
      m.mesh.quaternion.setFromUnitVectors(Y, d.normalize());
      m.mesh.scale.set(m.w, len, m.w);
      const col = m.status === 'normal' ? (m === selected ? 0x60a5fa : 0) : COL[m.status];
      m.mesh.material.emissive.setHex(col);
      m.mesh.material.emissiveIntensity = m.status === 'normal' ? (m === selected ? 0.5 : 0) : m.status === 'likely' ? 0.45 + 0.4 * pulse : 0.3;
    }
  }

  function select(m) {
    selected = m;
    $('muscleInfo').innerHTML = m ? `<b>${m.label}</b> · ${STAT[m.status]}<br>${m.fn}${m.reasons.length ? '<ul style="margin:4px 0 0;padding-left:16px">' + m.reasons.map((r) => `<li>${r}</li>`).join('') + '</ul>' : ''}` : 'Click a muscle on the 3D figure for details.';
  }
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  R.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  R.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = R.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, cam);
    select(ray.intersectObjects(muscles.map((m) => m.mesh))[0]?.object.userData.m || null);
  });
  select(null);

  // ---- weakness findings from the session report (weak arm vs healthy arm) ----
  function findings(r) {
    const sym = r.symmetryPct;
    muscles.forEach((m) => { m.score = 0; m.reasons = []; });
    const side = r.weakSide, add = (id, w, why) => {
      const m = muscles.find((x) => x.id === id && x.s === (side === 'R' ? 1 : 0));
      if (!m) return;
      m.score = Math.max(m.score, Math.min(1, w));
      if (!m.reasons.includes(why)) m.reasons.push(why);
    };
    if (sym != null && sym < 85) {
      const sev = Math.min(1, Math.max(0.25, (90 - sym) / 50)), best = r.weak.best, gap = `Weak side reaches ${sym}% of the healthy side.`;
      if (r.exercise === 'arm_raise') {
        const ph = best < 30 ? 'supraspinatus drives the first 30°' : best < 90 ? 'the deltoid drives 30–90°' : 'above 90° the shoulder blade must rotate upward';
        if (best < 30) { add('supraspinatus', sev, `Peak ${best}°: ${ph}.`); add('deltoid', 0.7 * sev, 'The deltoid takes over after 30°, which was not reached.'); }
        else if (best < 90) { add('deltoid', sev, `Peak ${best}°: ${ph}.`); add('supraspinatus', 0.6 * sev, 'Keeps the joint centered while the deltoid lifts.'); }
        else { add('serratus_anterior', sev, `Peak ${best}°: ${ph}.`); add('trapezius_upper', 0.7 * sev, 'Pairs with serratus for upward rotation.'); add('deltoid', 0.5 * sev, 'Working near end range.'); }
        add('latissimus_dorsi', 0.35 * sev, 'Tight lats can block full overhead reach.');
      } else if (r.exercise === 'forward_reach') {
        add('triceps', sev, `Elbow only straightens to ${best}°. The triceps straightens the elbow.`);
        add('biceps', 0.4 * sev, 'A tight biceps can resist straightening.');
        add('deltoid', 0.4 * sev, 'Front of the deltoid lifts the arm forward.');
      } else {
        add('forearm_extensors', sev, `Hand opens to ${best}% of palm size. Extensors open the fingers.`);
        add('forearm_flexors', 0.6 * sev, 'Tight finger flexors keep the fist curled.');
      }
      for (const m of muscles) if (m.score && m.s === (side === 'R' ? 1 : 0)) m.reasons.unshift(gap);
    }
    if (r.weak.compPct > 25) {
      add('trapezius_upper', 0.5, `Compensation on ${r.weak.compPct}% of weak-arm reps (shoulder hike or trunk lean).`);
      if (r.exercise === 'arm_raise') add('serratus_anterior', 0.35, 'Compensation can mean the shoulder blade is not rotating upward well.');
    }
    muscles.forEach((m) => { m.status = statusOf(m.score); });
    const flagged = muscles.filter((m) => m.status !== 'normal').sort((a, b) => b.score - a.score);
    $('findings').innerHTML = flagged.length
      ? flagged.slice(0, 6).map((m) => `<p style="margin:4px 0"><span class="pill" style="background:#${COL[m.status].toString(16)}">${STAT[m.status]}</span> ${m.label} (${Math.round(m.score * 100)}%): ${m.reasons[0]}</p>`).join('') + '<p class="sub">Estimates from one camera, not a medical diagnosis.</p>'
      : '<p style="color:#22c55e">✓ No weak muscles flagged for this exercise.</p>';
    select(flagged[0] || null);
    fillExercises(flagged);
  }

  // ---- exercises → watch ----
  const topic = localStorage.getItem('rehabTopic') || (() => { const t = 'rehabtrack-' + Math.random().toString(36).slice(2, 12); localStorage.setItem('rehabTopic', t); return t; })();
  $('ntfyTopic').textContent = topic;
  function fillExercises(flagged = []) {
    const score = (e) => e[4].reduce((s, id) => s + Math.max(0, ...flagged.filter((m) => m.id === id).map((m) => m.score)), 0);
    const rec = EXERCISES.filter((e) => score(e) > 0).sort((a, b) => score(b) - score(a)), opt = (e) => `<option value="${e[0]}">${e[1]} (${e[2]})</option>`;
    $('exPick').innerHTML = (rec.length ? `<optgroup label="Recommended for you">${rec.map(opt).join('')}</optgroup>` : '') + `<optgroup label="All exercises">${EXERCISES.filter((e) => !rec.includes(e)).map(opt).join('')}</optgroup>`;
    if (rec.length) $('exPick').value = rec[0][0];
    preview();
  }
  const alertData = () => { const e = EXERCISES.find((x) => x[0] === $('exPick').value); return { title: `Exercise: ${e[1]}`, message: `${e[2]}. ${e[3]}` }; };
  function preview() { const a = alertData(); $('exPrev').innerHTML = `<b>${a.title}</b> · ${a.message}`; $('wName').textContent = a.title.replace('Exercise: ', ''); $('wHint').textContent = a.message.split('. ')[0]; }
  const log = (ok, t, err) => { $('sendLog').innerHTML = `<div style="color:${ok ? '#22c55e' : '#ef4444'}">${new Date().toLocaleTimeString()} · ${ok ? 'sent' : 'failed'} · ${t}${err ? ' — ' + err : ''}</div>` + $('sendLog').innerHTML; };
  async function send() {
    const a = alertData();
    try {
      const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic, title: a.title, message: a.message }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      log(true, a.title);
    } catch (e) { log(false, a.title, e.message); }
  }
  let rem = null;
  $('exPick').onchange = preview;
  $('sendEx').onclick = send;
  $('remBtn').onclick = () => {
    if (rem) { clearInterval(rem); rem = null; $('remBtn').textContent = 'Start reminders'; return; }
    rem = setInterval(send, Math.max(1, +$('remMin').value || 30) * 60000);
    $('remBtn').textContent = 'Stop reminders'; say('Reminders run while this tab stays open.');
  };
  fillExercises();

  // ---- watch preview: mirrors what the watch would show during tracking ----
  function live(o) {
    const unit = $('exSel').value === 'hand_open' ? '%' : '°';
    $('wVal').textContent = `${Math.round(o.value)}${unit}`;
    $('wReps').textContent = `${o.reps} reps`;
    $('wHint').textContent = o.flagged ? 'Sit tall, keep shoulder down' : o.calibrating ? 'Rest your arm…' : 'Good, keep going';
    $('watchScr').style.borderColor = o.flagged ? '#f97316' : '#2b2f36';
  }
  return { update, findings, live };
}