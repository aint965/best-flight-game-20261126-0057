// Langit Nusantara: Island Hopper — main.js: scene, camera, game loop, states.
// One job: wire every module together and run the game.
import * as THREE from 'three';
import { FLIGHT, MISSIONS, clamp, lerp, wrapAngle, degToRad, radToDeg } from './config.js';
import { buildWorld, HOME_RUNWAY, HOP_RUNWAY, groundHeightAt } from './terrain.js';
import { buildAircraft, animateAircraft } from './aircraft.js';
import { createFlightState, stepFlight, flightReadouts } from './physics.js';
import { createInput, bindInput, pollInput } from './input.js';
import { createAudio, ensureAudio, setEngineSound, playRingChime, playTouchdown, playCrash, playClick, toggleMute } from './audio.js';
import { createHud, updateHud, showOverlay, setEndScreen } from './hud.js';
import { getMission, createMissionState, buildRings, clearRings, updateMission, nextTarget, objectiveText, nextRingDistance } from './missions.js';

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot'); // start | cruise | rings | landing
const SEED = Number(params.get('seed') || 1);

// --- Renderer / scene -------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000);
const world = buildWorld(scene, SEED);
const plane = buildAircraft();
scene.add(plane);

// Soft contact shadow under the plane: a radial-gradient blob that follows
// the aircraft at ground level, fading and widening with altitude. Real
// shadow maps over a 4 km archipelago would be blocky; this is the cheap,
// honest way a low sun throws a shadow under a bush plane.
const blobShadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(12, 22, 32, 0.55)');
  grad.addColorStop(1, 'rgba(12, 22, 32, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 11),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  scene.add(mesh);
  return mesh;
})();

// --- State ------------------------------------------------------------------
const flight = createFlightState();
const input = createInput();
const audio = createAudio();
const hud = createHud();
let mode = 'title'; // title | flying | paused | over | complete
let missionId = 'rings';
let missionState = createMissionState(getMission(missionId), SEED);
let cameraMode = 0; // 0 chase, 1 near, 2 cockpit-ish
let bestScore = 0;
try { bestScore = Number(window.localStorage.getItem('langit-nusantara-best') || 0) || 0; } catch { bestScore = 0; }
let timeSec = 0;
let toastUntil = 0;
let toastText = '';
// Round 6: sim time of the last ring pass — the rings-shot autopilot holds
// wings level for a while after a pass so the capture at the pass itself
// catches a level aeroplane, not one already banking hard at the next ring.
let lastRingPassSec = -100;

function showToast(text, seconds = 2.5) {
  toastText = text;
  toastUntil = timeSec + seconds;
  const el = document.getElementById('toast');
  if (el) { el.textContent = text; el.classList.add('show'); }
}

// --- Mission setup ----------------------------------------------------------
function startMission(id) {
  missionId = id;
  const mission = getMission(id);
  clearRings(scene, missionState);
  missionState = createMissionState(mission, SEED);
  buildRings(scene, missionState);
  flight.x = HOME_RUNWAY.x;
  flight.z = HOME_RUNWAY.z + HOME_RUNWAY.length / 2 - 60;
  flight.y = 4.8; // strip top (2.4) + gear height
  flight.heading = 0;
  flight.pitch = 0;
  flight.roll = 0;
  flight.speedKt = 0;
  flight.throttle = 0;
  flight.fuel = mission.startFuel;
  flight.damage = 0;
  flight.onGround = true;
  flight.crashed = false;
  flight.landed = false;
  flight.windKt = mission.wind;
  flight.windDir = degToRad(135); // crosswind from the south-east
  mode = 'flying';
  showOverlay(null);
  document.getElementById('hud').classList.add('show');
  ensureAudio(audio);
  playClick(audio);
  showToast(`${mission.tag} — ${mission.name}: ${mission.goal}`, 4);
}

function endSortie(win, title, lines) {
  mode = win ? 'complete' : 'over';
  const total = missionState.score;
  if (total > bestScore) {
    bestScore = total;
    try { window.localStorage.setItem('langit-nusantara-best', String(bestScore)); } catch { /* offline play: storage may be unavailable */ }
  }
  setEndScreen({ title, lines, win });
  showOverlay('overlay-end');
  document.getElementById('hud').classList.remove('show');
  if (!win) playCrash(audio);
}

// --- Camera -----------------------------------------------------------------
const camPos = new THREE.Vector3(0, 200, 900);
const camLook = new THREE.Vector3(0, 100, 0);
// Where the chase camera is heading (test hook: the screenshot driver waits
// for the camera to settle there before capturing, so shots are framed the
// way a player sees them instead of mid-lerp from the spawn point).
const camGoal = new THREE.Vector3();
let camGoalSet = false;
function updateCamera(dt) {
  const fwd = new THREE.Vector3(-Math.sin(flight.heading), 0, -Math.cos(flight.heading));
  const up = new THREE.Vector3(0, 1, 0);
  const planePos = new THREE.Vector3(flight.x, flight.y, flight.z);
  let desired;
  let look;
  if (cameraMode === 2) {
    // Cockpit-ish: just behind the canopy, looking down the nose.
    desired = planePos.clone().addScaledVector(fwd, -1.5).add(new THREE.Vector3(0, 2.6, 0));
    look = planePos.clone().addScaledVector(fwd, 120).add(new THREE.Vector3(0, Math.sin(flight.pitch) * 40, 0));
  } else if (cameraMode === 1) {
    desired = planePos.clone().addScaledVector(fwd, -11).add(new THREE.Vector3(0, 4, 0));
    look = planePos.clone().addScaledVector(fwd, 50);
  } else {
    desired = planePos.clone().addScaledVector(fwd, -21).add(new THREE.Vector3(0, 6, 0));
    look = planePos.clone().addScaledVector(fwd, 60).add(new THREE.Vector3(0, 4, 0));
  }
  camGoal.copy(desired);
  camGoalSet = true;
  const k = 1 - Math.exp(-dt * (mode === 'title' ? 1.2 : 5));
  camPos.lerp(desired, k);
  camLook.lerp(look, 1 - Math.exp(-dt * 7));
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  camera.lookAt(camLook);
  // Bank the camera a little with the plane so turns feel alive.
  camera.rotateZ(flight.roll * 0.18);
}

// --- Shot modes: deterministic staged scenes, no input needed ---------------
// Every shot stages a MID-SORTIE moment, not a cold start: the HUD reads a
// live timer and a real score, the way a player actually sees the game.
function stageShot() {
  if (!SHOT) return;
  const mission = SHOT === 'hop' ? getMission('hop') : SHOT === 'storm' ? getMission('storm') : getMission('rings');
  // Round 9: the storm shot flies the Storm Courier sortie, so the wall
  // is visible (main loop shows it only when missionId === 'storm') and
  // the HUD STORM FRONT panel reads live.
  if (SHOT === 'storm') missionId = 'storm';
  clearRings(scene, missionState);
  missionState = createMissionState(mission, SEED);
  buildRings(scene, missionState);
  document.getElementById('hud').classList.add('show');
  if (SHOT === 'start') {
    mode = 'title';
    flight.x = HOME_RUNWAY.x; flight.z = HOME_RUNWAY.z; flight.y = 4.8;
    flight.heading = degToRad(-35); flight.speedKt = 0; flight.throttle = 0; flight.onGround = true;
    showOverlay('overlay-title');
    return;
  }
  mode = 'flying';
  showOverlay(null);
  if (SHOT === 'cruise') {
    // Cover: rings 1-2 already banked (+500 pts), ring 3 big ahead — and
    // the plane flies ESE straight at it, so the hero volcano (3900, 0)
    // rises directly behind the gold ring: the cover finally has depth
    // (sea → Karang island → ring → volcano), not a flat sea horizon.
    // The old staging flew NE at ring 2, which put the volcano 62 deg
    // off-axis — out of frame entirely (round 8, first pass).
    missionState.ringIndex = 2;
    missionState.score = 500;
    missionState.combo = 2;
    missionState.rings[0].visible = false;
    missionState.rings[1].visible = false;
    const ring = missionState.rings[2];
    flight.x = 1198; flight.y = 185; flight.z = -757;
    flight.speedKt = 125; flight.throttle = 68; flight.onGround = false;
    flight.heading = Math.atan2(-(ring.position.x - flight.x), -(ring.position.z - flight.z));
  } else if (SHOT === 'hop') {
    // Island Hop, second leg: home strip already landed (+750 pts), now on
    // final approach to Pulau Karang's strip from the north-east, low and
    // descending — a different mission, a different angle, a different sky.
    // Round 6: the plane flies a parallel offset pass 200 m WEST of the
    // strip (the hill is on the east side), on the same heading as the
    // strip, so the whole lit strip — markings, numbers, edge lights —
    // reads BESIDE the fuselage instead of hiding behind it. The autopilot
    // aims at the offset point (see shotAutopilot), so the offset survives
    // to the capture instead of curving back to the centreline.
    // Round 7: the offset is 86 m, not 200 m, and the plane stages 258 m
    // along-track south-east of the strip centre — at capture the strip
    // spans the right half of the frame 150-400 m out, its "03" number
    // ~165 m from the camera instead of a distant strip 600 m away.
    missionState.landingsDone = ['home'];
    missionState.score = 750;
    flight.x = 1586; flight.y = 85; flight.z = -512;
    flight.heading = degToRad(25); flight.speedKt = 105; flight.throttle = 42; flight.onGround = false;
    flight.pitch = degToRad(-3);
  } else if (SHOT === 'rings') {
    // Fly-through: close behind ring 1 (~175 m) so the driver catches the
    // pass itself — score ticks to 250 and the toast fires in the shot.
    const ring = missionState.rings[0];
    flight.x = ring.position.x + 30; flight.y = ring.position.y + 6; flight.z = ring.position.z + 175;
    flight.speedKt = 130; flight.throttle = 72; flight.onGround = false;
    // Aim straight at the ring so the shot catches the fly-through.
    flight.heading = Math.atan2(-(ring.position.x - flight.x), -(ring.position.z - flight.z));
  } else if (SHOT === 'landing') {
    // Home-strip final: one ring already banked (+250 pts), gear down in
    // spirit, descending on the lit runway.
    // Round 6: staged CLOSE — 450 m south of the strip centre, 45 m up,
    // 150 m east of the centreline, sitting on the glide path the
    // autopilot below already encodes (85 - (1250 - z) * 0.05 = 45 at
    // z = 450). The strip is now the big subject of the frame, its
    // threshold, markings and "36" clear beside the nose instead of a
    // small strip 1.2 km away.
    // Round 7: closer still — staged 360 m south, 34 m up, 70 m east of
    // the centreline, so at capture (~80 m of travel in) the plane sits
    // ~130 m from the "36" numbers, the strip runs diagonally from the
    // left frame edge to the centre, and the home hill (moved east and
    // lowered in round 7) sits at the right edge instead of dominating
    // the middle of the frame.
    // Round 9: closer again — staged 300 m south, 38 m up (on the glide
    // path: 85 - (1250 - 300) * 0.05 = 37.5), so at capture the plane sits
    // ~50 m from the "36" numbers and they read at a glance; the strip
    // still runs the full frame to the horizon, and the river crossing
    // (z ≈ 0-80, 20 m wide now) sits mid-frame ahead, in the approach
    // path instead of behind the camera.
    missionState.ringIndex = 1;
    missionState.score = 250;
    missionState.combo = 1;
    missionState.rings[0].visible = false;
    flight.x = 70; flight.y = 38; flight.z = 300;
    flight.heading = 0; flight.speedKt = 105; flight.throttle = 42; flight.onGround = false;
    flight.pitch = degToRad(0);
  } else if (SHOT === 'storm') {
    // Round 9: Storm Courier dossier shot — the plane cruises east at
    // 200 m over the sea toward the dark wall, which fills the frame
    // ahead; the volcano peeks at the left edge, the HUD STORM FRONT
    // panel reads live (front distance + ETA counting down). The
    // autopilot below holds a level east course — it never chases the
    // courier rings, because this shot is about the front, not the rings.
    flight.x = 2200; flight.y = 200; flight.z = -1400;
    flight.heading = -Math.PI / 2; flight.speedKt = 120; flight.throttle = 68; flight.onGround = false;
    flight.pitch = 0; flight.roll = 0;
  }
}

// Autopilot for shot modes: hold a steady, good-looking flight path.
function shotAutopilot(dt) {
  if (!SHOT || SHOT === 'start') return { pitch: 0, roll: 0, yaw: 0, brake: false, throttleDelta: 0 };
  // Round 6: for 2 s after a ring pass, hold wings level and hold altitude
  // instead of banking hard toward the next ring. The screenshot driver
  // captures right at the pass (score ticks, toast fires), and the old code
  // caught the plane mid-bank toward ring 2 (roll ~30 deg, V/S +1400 fpm).
  // The toast lives 2.5 s, so the capture still shows score + toast — now
  // with a level aeroplane centred in the gold ring.
  if (SHOT === 'rings' && timeSec - lastRingPassSec < 2) {
    return {
      // A touch of nose-down cancels the climb the 72% throttle would
      // otherwise give at level pitch, so V/S reads near zero.
      pitch: clamp(-flight.pitch * 3 - 0.1, -0.6, 0.6),
      roll: clamp(-flight.roll * 3, -1, 1),
      yaw: 0,
      brake: false,
      throttleDelta: 0,
    };
  }
  // Round 9: the storm shot holds a level east cruise toward the wall —
  // heading -PI/2, 200 m — instead of chasing the courier rings. The
  // rings stay in the mission (the HUD objective still tells the story),
  // but the shot is about the front, and a banking turn toward ring 1
  // would swing the wall out of frame within seconds.
  if (SHOT === 'storm') {
    const headingErr = wrapAngle(-Math.PI / 2 - flight.heading);
    const desiredRoll = clamp(-headingErr * 1.4, -0.5, 0.5);
    return {
      pitch: clamp((200 - flight.y) / 60 - flight.pitch * 2, -0.6, 0.6),
      roll: clamp((desiredRoll - flight.roll) * 2, -1, 1),
      yaw: 0,
      brake: false,
      throttleDelta: 0,
    };
  }
  let target = nextTarget(missionState);
  // Round 6: the hop shot flies a parallel offset pass 200 m west of the
  // Karang strip, so the autopilot aims at the offset point (200 m west of
  // the strip centre: 1500 - 200*cos(25 deg), -900 + 200*sin(25 deg)), not
  // at the strip itself — otherwise it curves back to the centreline and
  // the strip ends up hiding behind the fuselage again.
  // Round 7: the offset is 86 m west (1500 - 86*cos(25 deg),
  // -900 + 86*sin(25 deg)) — the strip stays big beside the fuselage.
  if (SHOT === 'hop') target = { x: 1422, y: 60, z: -864, kind: 'runway', runway: HOP_RUNWAY };
  // Round 6: the landing shot holds its offset course straight at a point
  // beyond the home strip on the same easting, instead of turning toward
  // ring 2 — the strip stays big and whole beside the nose.
  // Round 7: same easting as the new staging (x = 70).
  if (SHOT === 'landing') target = { x: 70, y: 60, z: -1000, kind: 'runway', runway: HOME_RUNWAY };
  const desiredHeading = Math.atan2(-(target.x - flight.x), -(target.z - flight.z));
  const headingErr = wrapAngle(desiredHeading - flight.heading);
  // Roll sign: a LEFT bank (roll < 0) turns the nose LEFT, which in this
  // heading convention means heading INCREASES (turnRate = -sin(roll) * k).
  // So when the target sits to the left (headingErr < 0, heading must
  // decrease), the bank must be RIGHT (roll > 0) — the opposite sign from
  // headingErr. (The first version had this backwards: the plane banked
  // hard away from every ring after passing one.)
  const desiredRoll = clamp(-headingErr * 1.4, -0.5, 0.5);
  const rollErr = desiredRoll - flight.roll;
  // Hold a steady glide path on approaches: the hop final descends on a
  // fixed slope toward the strip instead of levelling off at cruise height.
  // On ring sorties, hold the next ring's height so the plane flies through
  // the ring's centre instead of grazing its lower edge.
  const hDist = Math.hypot(target.x - flight.x, target.z - flight.z);
  const altTarget = SHOT === 'landing' ? Math.max(20, 85 - (1250 - flight.z) * 0.05)
    : SHOT === 'hop' ? clamp(hDist * 0.16, 15, 110)
    : (SHOT === 'rings' || SHOT === 'cruise' ? target.y + 6 : 170);
  const altErr = clamp((altTarget - flight.y) / 60, -0.4, 0.4);
  return {
    pitch: clamp(altErr - flight.pitch * 2, -0.6, 0.6),
    roll: clamp(rollErr * 2, -1, 1),
    yaw: 0,
    brake: false,
    throttleDelta: 0,
  };
}

// --- Input wiring -----------------------------------------------------------
bindInput(input, {
  onMission: (id) => {
    missionId = id;
    for (const card of document.querySelectorAll('.mission-card')) card.classList.toggle('selected', card.dataset.mission === id);
    const mission = getMission(id);
    const blurb = document.getElementById('mission-blurb');
    if (blurb) blurb.textContent = mission.blurb;
    playClick(audio);
    ensureAudio(audio);
  },
  onStart: () => startMission(missionId),
});
document.getElementById('btn-fly-again')?.addEventListener('click', () => startMission(missionId));
document.getElementById('btn-title')?.addEventListener('click', () => {
  mode = 'title';
  showOverlay('overlay-title');
  document.getElementById('hud').classList.remove('show');
});
document.getElementById('btn-resume')?.addEventListener('click', () => {
  mode = 'flying';
  showOverlay(null);
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
// First click anywhere wakes the audio engine.
window.addEventListener('pointerdown', () => ensureAudio(audio), { once: true });

// --- Main loop --------------------------------------------------------------
let lastNow = performance.now();
let frames = 0;
const clock = { dt: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;
  timeSec += dt;
  clock.dt = dt;
  frames += 1;

  // Edge-triggered actions.
  for (const action of input.pressed) {
    if (action === 'restart' && mode !== 'title') startMission(missionId);
    if (action === 'pause' && (mode === 'flying' || mode === 'paused')) {
      mode = mode === 'flying' ? 'paused' : 'flying';
      showOverlay(mode === 'paused' ? 'overlay-pause' : null);
    }
    if (action === 'mute') {
      const muted = toggleMute(audio);
      document.getElementById('btn-mute').textContent = muted ? '🔇 Sound' : '🔊 Sound';
      showToast(muted ? 'Sound off' : 'Sound on', 1.2);
    }
    if (action === 'camera') {
      cameraMode = (cameraMode + 1) % 3;
      showToast(['Chase camera', 'Near camera', 'Cockpit camera'][cameraMode], 1.2);
    }
    if (action === 'confirm' && mode === 'title') startMission(missionId);
    if (action === 'Digit1') { missionId = 'rings'; document.querySelector('.mission-card[data-mission="rings"]')?.click(); }
    if (action === 'Digit2') { missionId = 'hop'; document.querySelector('.mission-card[data-mission="hop"]')?.click(); }
    if (action === 'Digit3') { missionId = 'storm'; document.querySelector('.mission-card[data-mission="storm"]')?.click(); }
  }
  input.pressed.clear();

  // Title screen: slow orbit around the parked plane.
  if (mode === 'title') {
    const t = timeSec * 0.08;
    flight.heading = degToRad(-35) + Math.sin(t) * 0.15;
    camPos.lerp(new THREE.Vector3(
      flight.x + Math.sin(t * 2.2) * 34,
      14,
      flight.z + Math.cos(t * 2.2) * 34,
    ), 1 - Math.exp(-dt * 2));
    camera.position.copy(camPos);
    camera.lookAt(flight.x, 6, flight.z);
  }

  if (mode === 'flying') {
    pollInput(input);
    let stick;
    if (SHOT) {
      stick = shotAutopilot(dt);
      flight.throttle = SHOT === 'landing' || SHOT === 'hop' ? 42 : SHOT === 'rings' ? 72 : 68;
    } else {
      stick = {
        pitch: input.pitch,
        roll: input.roll,
        yaw: input.yaw,
        brake: input.brake,
        throttleDelta: input.throttleDelta,
      };
      if (input.mouseThrottle !== null) flight.throttle = input.mouseThrottle;
    }
    const wasLanded = flight.landed;
    const wasCrashed = flight.crashed;
    const prevRing = missionState.ringIndex;
    stepFlight(flight, stick, dt);
    updateMission(missionState, flight, dt, timeSec, {
      onRing: (n, gained, combo) => {
        lastRingPassSec = timeSec;
        playRingChime(audio);
        showToast(`Ring ${n} — +${gained} pts${combo > 1 ? ` (combo x${combo})` : ''}`);
      },
      onLanding: (strip, gained) => {
        playTouchdown(audio);
        showToast(`Touchdown on ${strip === 'home' ? 'the home strip' : 'Pulau Karang'} — +${gained} pts, refuelled`);
      },
    });
    if (flight.crashed && !wasCrashed) {
      endSortie(false, 'CRASHED', [
        missionState.failReason || flight.crashReason,
        `Score ${missionState.score.toLocaleString('en-US')} pts — best ${Math.max(bestScore, missionState.score).toLocaleString('en-US')} pts`,
        'Press R or Fly Again to try another sortie.',
      ]);
    } else if (missionState.failed && !flight.crashed) {
      endSortie(false, 'SORTIE FAILED', [
        missionState.failReason,
        `Score ${missionState.score.toLocaleString('en-US')} pts — best ${Math.max(bestScore, missionState.score).toLocaleString('en-US')} pts`,
        'Press R or Fly Again to try another sortie.',
      ]);
    } else if (missionState.complete) {
      endSortie(true, 'SORTIE COMPLETE', [
        `${missionState.mission.name} finished — ${objectiveText(missionState)}`,
        `Score ${missionState.score.toLocaleString('en-US')} pts — best ${Math.max(bestScore, missionState.score).toLocaleString('en-US')} pts`,
        'Press R or Fly Again for another sortie.',
      ]);
    }
    setEngineSound(audio, flight.throttle, flight.speedKt);
  }

  // Plane transform + prop + lights.
  plane.position.set(flight.x, flight.y, flight.z);
  plane.rotation.set(flight.pitch, flight.heading, flight.roll, 'YXZ');
  animateAircraft(plane, flight.throttle, timeSec, dt);
  // Contact shadow: track the plane at ground level, fading with height.
  const shadowGround = groundHeightAt(flight.x, flight.z);
  const heightAbove = Math.max(0, flight.y - shadowGround);
  blobShadow.position.set(flight.x, shadowGround + 0.5, flight.z);
  const shadowScale = 1 + heightAbove * 0.004;
  blobShadow.scale.set(shadowScale, shadowScale, 1);
  blobShadow.material.opacity = clamp(0.9 - heightAbove / 160, 0.12, 0.9);

  // Rings spin gently; clouds drift.
  for (const ring of missionState.rings) ring.rotation.z += dt * 0.25;
  for (const cloud of world.clouds) {
    cloud.position.x += cloud.userData.drift * dt;
    if (cloud.position.x > 3400) cloud.position.x = -3400;
  }
  // Round 8: cloud shadows ride the ground under their clouds, offset east
  // because the sun sits in the west. On steep ground the shadow fades out
  // instead of cutting through the slope — a flat blob on a hillside would
  // read as a dark smear, not a shadow.
  for (const s of world.cloudShadows || []) {
    const cx = s.cloud.position.x + 100;
    const cz = s.cloud.position.z + 30;
    const g0 = groundHeightAt(cx, cz);
    const spread = Math.max(
      Math.abs(groundHeightAt(cx + 80, cz) - g0),
      Math.abs(groundHeightAt(cx - 80, cz) - g0),
    );
    s.blob.position.set(cx, g0 + 0.6, cz);
    s.blob.material.opacity = s.baseOpacity * clamp(1 - spread / 40, 0.25, 1);
  }
  // Round 8: the storm front is only ever visible on the Storm Courier
  // sortie, and it advances from 4.2 km to 2.8 km as the courier clock
  // runs down — the pilot watches the wall close in.
  if (world.stormWall) {
    const isStorm = missionId === 'storm';
    world.stormWall.visible = isStorm && mode !== 'title';
    if (isStorm && missionState.mission.timeLimitSec > 0) {
      const elapsed = missionState.mission.timeLimitSec - missionState.timeLeft;
      world.stormWall.position.x = 4200 - clamp(elapsed / 240, 0, 1) * 1400;
    }
  }

  if (mode !== 'title') updateCamera(dt);

  // HUD + target arrow.
  const target = nextTarget(missionState);
  const dist = Math.round(Math.hypot(target.x - flight.x, target.y - flight.y, target.z - flight.z));
  const bearing = Math.atan2(-(target.x - flight.x), -(target.z - flight.z));
  const relBearing = wrapAngle(bearing - flight.heading);
  const arrow = document.getElementById('target-arrow');
  if (arrow) {
    arrow.style.transform = `rotate(${radToDeg(relBearing)}deg)`;
    arrow.textContent = '▲';
  }
  const distEl = document.getElementById('target-dist');
  if (distEl) distEl.textContent = `${target.kind === 'ring' ? '◉ RING' : '🛬 RUNWAY'} ${dist.toLocaleString('en-US')} m`;
  if (timeSec > toastUntil) document.getElementById('toast')?.classList.remove('show');
  if (mode === 'flying' || mode === 'paused' || SHOT) {
    updateHud(hud, {
      readouts: flightReadouts(flight),
      state: flight,
      mission: missionState.mission,
      score: missionState.score,
      bestScore,
      timeLeft: missionState.timeLeft,
      elapsedSec: timeSec,
      objectiveText: objectiveText(missionState),
      rings: missionState.rings,
      nextRingIndex: missionState.ringIndex,
    });
  }

  renderer.render(scene, camera);
  if (frames === 3) window.__ready = true;
}

// --- Boot -------------------------------------------------------------------
stageShot();
const camParam = Number(params.get('cam') || 0);
if (camParam >= 0 && camParam <= 2) cameraMode = camParam;
if (!SHOT) {
  showOverlay('overlay-title');
  document.getElementById('hud').classList.remove('show');
}
// Pre-select the first mission card and fill the title blurb.
document.querySelector('.mission-card[data-mission="rings"]')?.classList.add('selected');
const blurb = document.getElementById('mission-blurb');
if (blurb) blurb.textContent = getMission('rings').blurb;

// Test/verification hook: the screenshot driver reads this, never the player.
window.__game = {
  get mode() { return mode; },
  get flight() { return flight; },
  get mission() { return missionState; },
  get shot() { return SHOT; },
  // True once the chase camera has converged on its staged framing. The
  // goal moves with the plane, so the camera trails it by a steady ~11 m
  // (22% of the gap closed per 0.05 s frame against ~3 m of forward motion
  // per frame) — 15 m is the converged band, not 0.
  get camSettled() { return camGoalSet && camera.position.distanceTo(camGoal) < 15; },
  // Verification hook: ground height at any point (used to prove the strips
  // sit on land, not water, and that a landing is physically possible).
  groundAt: (x, z) => groundHeightAt(x, z),
  startMission,
  version: 'langit-nusantara-1.0',
};
requestAnimationFrame(frame);
