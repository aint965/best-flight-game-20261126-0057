// Langit Nusantara: Island Hopper — main.js: scene, camera, game loop, states.
// One job: wire every module together and run the game.
import * as THREE from 'three';
import { FLIGHT, MISSIONS, clamp, lerp, wrapAngle, degToRad, radToDeg } from './config.js';
import { buildWorld, HOME_RUNWAY, HOP_RUNWAY } from './terrain.js';
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
  const mission = SHOT === 'hop' ? getMission('hop') : getMission('rings');
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
    // Cover: ring 1 already banked (+250 pts), ring 2 big ahead at ~210 m —
    // the ring reads at a glance, Pulau Karang's island sits ahead-right.
    missionState.ringIndex = 1;
    missionState.score = 250;
    missionState.combo = 1;
    missionState.rings[0].visible = false;
    const ring = missionState.rings[1];
    flight.x = 550; flight.y = 185; flight.z = -950;
    flight.speedKt = 125; flight.throttle = 68; flight.onGround = false;
    flight.heading = Math.atan2(-(ring.position.x - flight.x), -(ring.position.z - flight.z));
  } else if (SHOT === 'hop') {
    // Island Hop, second leg: home strip already landed (+750 pts), now on
    // final approach to Pulau Karang's strip from the south-east, low and
    // descending — a different mission, a different angle, a different sky.
    // Staged ~75 m to the plane's own right of the centreline so the lit
    // strip reads BESIDE the fuselage instead of hiding behind it (the
    // autopilot still curves the plane back toward the strip, but the
    // capture happens before it has closed the offset).
    missionState.landingsDone = ['home'];
    missionState.score = 750;
    flight.x = 1822; flight.y = 110; flight.z = 212;
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
    missionState.ringIndex = 1;
    missionState.score = 250;
    missionState.combo = 1;
    missionState.rings[0].visible = false;
    flight.x = 60; flight.y = 85; flight.z = 1250;
    flight.heading = 0; flight.speedKt = 105; flight.throttle = 42; flight.onGround = false;
    flight.pitch = degToRad(-4);
  }
}

// Autopilot for shot modes: hold a steady, good-looking flight path.
function shotAutopilot(dt) {
  if (!SHOT || SHOT === 'start') return { pitch: 0, roll: 0, yaw: 0, brake: false, throttleDelta: 0 };
  const target = nextTarget(missionState);
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

  // Rings spin gently; clouds drift.
  for (const ring of missionState.rings) ring.rotation.z += dt * 0.25;
  for (const cloud of world.clouds) {
    cloud.position.x += cloud.userData.drift * dt;
    if (cloud.position.x > 3400) cloud.position.x = -3400;
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
  startMission,
  version: 'langit-nusantara-1.0',
};
requestAnimationFrame(frame);
