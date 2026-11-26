// Langit Nusantara — missions.js: sorties, rings and scoring.
// One job: know what the pilot must do next and what it is worth.
import * as THREE from 'three';
import { MISSIONS, SCORE, clamp, mulberry32 } from './config.js';
import { makeRing, HOME_RUNWAY, HOP_RUNWAY } from './terrain.js';

export function getMission(id) {
  return MISSIONS.find((m) => m.id === id) || MISSIONS[0];
}

export function createMissionState(mission, seed = 1) {
  const rng = mulberry32(seed * 7919 + mission.id.length * 131);
  const state = {
    mission,
    ringIndex: 0,
    rings: [],
    ringsTotal: mission.rings,
    combo: 0,
    score: 0,
    timeLeft: mission.timeLimitSec,
    landingsDone: [],
    landingsNeeded: mission.id === 'hop' ? 2 : mission.id === 'storm' ? 1 : 0,
    complete: false,
    failed: false,
    failReason: '',
    message: '',
    messageUntil: 0,
  };
  return state;
}

// Lay out rings along a scenic loop over the lagoon between the islands.
export function buildRings(scene, missionState) {
  const mission = missionState.mission;
  const spots = [
    [0, 150, -500], [700, 190, -1100], [1400, 220, -700], [1100, 170, 300],
    [300, 200, 900], [-700, 180, 500], [-1400, 210, -300], [-800, 160, -1000],
  ];
  const count = mission.rings;
  for (let i = 0; i < count; i++) {
    const [x, y, z] = spots[i % spots.length];
    const ring = makeRing(16);
    ring.position.set(x, y, z);
    ring.userData.index = i;
    scene.add(ring);
    missionState.rings.push(ring);
  }
  return missionState.rings;
}

export function clearRings(scene, missionState) {
  for (const ring of missionState.rings) scene.remove(ring);
  missionState.rings = [];
  missionState.ringIndex = 0;
}

// Distance from the plane to the centre of the next ring.
export function nextRingDistance(flight, missionState) {
  const ring = missionState.rings[missionState.ringIndex];
  if (!ring) return null;
  const dx = ring.position.x - flight.x;
  const dy = ring.position.y - flight.y;
  const dz = ring.position.z - flight.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// The next thing the pilot should fly toward: ring or runway.
export function nextTarget(missionState) {
  if (missionState.ringIndex < missionState.rings.length) {
    const r = missionState.rings[missionState.ringIndex];
    return { x: r.position.x, y: r.position.y, z: r.position.z, kind: 'ring' };
  }
  if (missionState.mission.id === 'hop') {
    const next = missionState.landingsDone.includes('home') ? HOP_RUNWAY : HOME_RUNWAY;
    return { x: next.x, y: 60, z: next.z, kind: 'runway', runway: next };
  }
  return { x: HOME_RUNWAY.x, y: 60, z: HOME_RUNWAY.z, kind: 'runway', runway: HOME_RUNWAY };
}

export function objectiveText(missionState) {
  const m = missionState.mission;
  if (m.id === 'rings') return `Rings ${Math.min(missionState.ringIndex, m.rings)}/${m.rings} — next ring ${missionState.ringIndex + 1}`;
  if (m.id === 'hop') {
    const done = missionState.landingsDone.length;
    return done === 0 ? 'Land on the home strip, then Pulau Karang' : done === 1 ? 'One down — land on Pulau Karang' : 'Both strips done — fly home';
  }
  if (m.id === 'storm') {
    if (missionState.ringIndex < m.rings) return `Courier rings ${missionState.ringIndex}/${m.rings}, then land home`;
    return 'Rings done — land on the home strip before the clock ends';
  }
  return m.goal;
}

// Called every frame: ring pass detection, landing bookkeeping, clock.
export function updateMission(missionState, flight, dt, nowSec, events) {
  const m = missionState.mission;
  // Clock (Storm Courier only).
  if (m.timeLimitSec > 0 && !missionState.complete && !missionState.failed) {
    missionState.timeLeft -= dt;
    if (missionState.timeLeft <= 0) {
      missionState.timeLeft = 0;
      missionState.failed = true;
      missionState.failReason = 'Out of time — the courier window closed';
    }
  }
  // Ring pass: within the torus radius and close in height.
  const ring = missionState.rings[missionState.ringIndex];
  if (ring && !missionState.complete) {
    const dx = ring.position.x - flight.x;
    const dy = ring.position.y - flight.y;
    const dz = ring.position.z - flight.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 21) { // ring radius 20 + a little grace
      missionState.ringIndex += 1;
      missionState.combo += 1;
      const gained = SCORE.ring + SCORE.ringComboBonus * (missionState.combo - 1);
      missionState.score += gained;
      events.onRing(missionState.ringIndex, gained, missionState.combo);
      ring.visible = false;
    }
  }
  // Landing bookkeeping.
  if (flight.landed && !flight._landingCounted) {
    flight._landingCounted = true;
    const onHome = Math.abs(flight.x - HOME_RUNWAY.x) < 300 && Math.abs(flight.z - HOME_RUNWAY.z) < 300;
    const onHop = Math.abs(flight.x - HOP_RUNWAY.x) < 300 && Math.abs(flight.z - HOP_RUNWAY.z) < 300;
    const strip = onHome ? 'home' : onHop ? 'hop' : null;
    if (strip && !missionState.landingsDone.includes(strip)) {
      missionState.landingsDone.push(strip);
      const gained = m.id === 'hop' ? SCORE.islandHopLanding : SCORE.landing + SCORE.softLandingBonus;
      missionState.score += gained;
      events.onLanding(strip, gained);
    }
    // Mission complete?
    if (m.id === 'hop' && missionState.landingsDone.length >= 2) {
      missionState.complete = true;
    } else if (m.id === 'storm' && missionState.ringIndex >= m.rings && strip === 'home') {
      missionState.complete = true;
      missionState.score += Math.round(missionState.timeLeft) * SCORE.timeBonusPerSec;
    } else if (m.id === 'rings' && missionState.ringIndex >= m.rings) {
      missionState.complete = true;
    }
  }
  if (!flight.landed) flight._landingCounted = false;
  if (flight.crashed && !missionState.failed) {
    missionState.failed = true;
    missionState.failReason = flight.crashReason || 'Crashed';
  }
  if (flight.fuel <= 0 && !flight.onGround && !missionState.failed) {
    missionState.failed = true;
    missionState.failReason = 'Out of fuel — the engine quit over the sea';
  }
  return missionState;
}
