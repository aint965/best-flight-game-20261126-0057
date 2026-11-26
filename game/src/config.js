// Langit Nusantara: Island Hopper — shared tuning, mission data and a seeded RNG.
// One job: every number the rest of the game agrees on lives here.
export const GAME_TITLE = 'Langit Nusantara';
export const GAME_SUBTITLE = 'Island Hopper';

// Flight envelope (game units: 1 unit = 1 metre, speeds shown in knots).
export const FLIGHT = {
  minFlyingSpeedKt: 55, // below this the wing stalls and the nose drops
  cruiseSpeedKt: 120,
  maxSpeedKt: 185,
  climbRate: 9, // m/s at full power, level flight
  sinkRate: 4.5, // m/s gliding with throttle idle
  rollRate: 1.9, // rad/s at full stick
  pitchRate: 1.1,
  yawRate: 0.55,
  maxBankDeg: 62,
  maxPitchDeg: 38,
  throttleStep: 34, // % per second while Shift/Ctrl held
  fuelDrainPerSec: 0.055, // % fuel per second at 100% throttle
  fuelDrainIdle: 0.012,
  runwayLength: 420,
  runwayWidth: 26,
};

// Scoring.
export const SCORE = {
  ring: 250,
  ringComboBonus: 50,
  landing: 500,
  softLandingBonus: 250,
  islandHopLanding: 750,
  timeBonusPerSec: 10,
};

// The three sorties. Each has a different goal, so each sortie plays differently.
export const MISSIONS = [
  {
    id: 'rings',
    name: 'Ring Run',
    tag: 'SORTIE 1',
    goal: 'Fly through all 8 glowing rings in order',
    rings: 8,
    timeLimitSec: 0, // no clock: pure flying skill
    wind: 0,
    startFuel: 100,
    blurb: 'Eight rings over the lagoon. Smooth turns win — every ring is 250 pts, chained rings pay a combo bonus.',
  },
  {
    id: 'hop',
    name: 'Island Hop',
    tag: 'SORTIE 2',
    goal: 'Land on both island runways, then return home',
    rings: 0,
    timeLimitSec: 0,
    wind: 3,
    startFuel: 100,
    blurb: 'Two short strips, two landings. Touch down gently on each runway to refuel and bank 750 pts.',
  },
  {
    id: 'storm',
    name: 'Storm Courier',
    tag: 'SORTIE 3',
    goal: 'Fly 6 rings, then land home before the clock runs out',
    rings: 6,
    timeLimitSec: 240,
    wind: 11,
    startFuel: 100,
    blurb: 'A courier run in a crosswind, against the clock. Rings first, then a landing — late means no bonus at all.',
  },
];

// Deterministic RNG so every ?shot= scene stages the same world.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

// Wrap an angle to [-PI, PI].
export function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
