// Langit Nusantara — physics.js: the arcade flight model.
// One job: turn stick + throttle inputs into position, speed and attitude.
// Units: metres, seconds, radians. Forward is -Z of the aircraft's heading.
import { FLIGHT, clamp, wrapAngle, degToRad } from './config.js';
import { groundHeightAt, isOnRunway } from './terrain.js';

export function createFlightState() {
  return {
    // Position and attitude.
    x: 0, y: 120, z: 700,
    heading: 0, // radians, 0 = north (-Z)
    pitch: 0, // radians, + = nose up
    roll: 0, // radians, + = bank right
    speedKt: 0,
    throttle: 0, // 0..100
    // Rates and resources.
    verticalSpeed: 0, // m/s, + = climbing
    fuel: 100,
    damage: 0, // 0..100
    onGround: true,
    crashed: false,
    landed: false,
    crashReason: '',
    windKt: 0,
    windDir: 0,
  };
}

// One fixed step. `input` is { pitch: -1..1, roll: -1..1, throttleDelta, brake }.
export function stepFlight(state, input, dt) {
  if (state.crashed) return state;

  // Throttle: Shift/Ctrl move it, clamped 0..100.
  state.throttle = clamp(state.throttle + input.throttleDelta * dt, 0, 100);

  // Fuel: drains with throttle; empty tank means the engine quits.
  const drain = FLIGHT.fuelDrainIdle + (FLIGHT.fuelDrainPerSec - FLIGHT.fuelDrainIdle) * (state.throttle / 100);
  state.fuel = Math.max(0, state.fuel - drain * dt);
  const thrust = state.fuel > 0 ? state.throttle / 100 : 0;

  // Stick: pitch and roll rates, softened at very low speed.
  const authority = clamp(state.speedKt / 40, 0.25, 1);
  const targetRoll = clamp(input.roll * degToRad(FLIGHT.maxBankDeg), -degToRad(FLIGHT.maxBankDeg), degToRad(FLIGHT.maxBankDeg));
  state.roll += (targetRoll - state.roll) * Math.min(1, dt * 3.2);
  const targetPitch = clamp(input.pitch * degToRad(FLIGHT.maxPitchDeg), -degToRad(FLIGHT.maxPitchDeg), degToRad(FLIGHT.maxPitchDeg));
  state.pitch += (targetPitch - state.pitch) * Math.min(1, dt * 2.6);

  // Gentle auto-coordination: a bank turns the nose.
  const turnRate = -Math.sin(state.roll) * 0.55 * clamp(state.speedKt / 100, 0.3, 1.4);
  state.heading = wrapAngle(state.heading + turnRate * dt + input.yaw * FLIGHT.yawRate * dt * authority);

  // Speed: thrust pulls toward a throttle-dependent target; drag and brakes pull back.
  const targetSpeed = 30 + thrust * (FLIGHT.maxSpeedKt - 30);
  const accel = (targetSpeed - state.speedKt) * 0.22 - (input.brake ? 26 : 0);
  state.speedKt = Math.max(0, state.speedKt + accel * dt);

  // Lift: below flying speed the wing cannot hold the plane up.
  const hasLift = state.speedKt >= FLIGHT.minFlyingSpeedKt;
  let climb = 0;
  if (hasLift) {
    const liftFactor = clamp((state.speedKt - FLIGHT.minFlyingSpeedKt) / 60, 0, 1);
    climb = Math.sin(state.pitch) * state.speedKt * 0.514 * liftFactor;
    climb += (thrust - 0.45) * FLIGHT.climbRate * liftFactor;
  } else if (!state.onGround) {
    climb = -FLIGHT.sinkRate * 1.6; // stall sink
  }
  if (input.brake && hasLift) climb -= 2;
  state.verticalSpeed = climb;

  // Takeoff rotation: fast enough and pulling back lifts the wheels off.
  if (state.onGround && hasLift && state.pitch > 0.04) state.onGround = false;

  // Wind pushes the plane sideways (Storm Courier).
  const windX = Math.sin(state.windDir) * state.windKt * 0.514 * dt;
  const windZ = Math.cos(state.windDir) * state.windKt * 0.514 * dt;

  // Move.
  const speedMs = state.speedKt * 0.514;
  const forwardX = -Math.sin(state.heading) * Math.cos(state.pitch);
  const forwardZ = -Math.cos(state.heading) * Math.cos(state.pitch);
  state.x += forwardX * speedMs * dt + windX;
  state.z += forwardZ * speedMs * dt + windZ;
  state.y += climb * dt;

  // Ground contact.
  const ground = groundHeightAt(state.x, state.z);
  const runway = isOnRunway(state.x, state.z);
  if (state.y <= ground + 2.4) {
    state.y = ground + 2.4;
    const touchdownVs = -state.verticalSpeed;
    if (!state.onGround && touchdownVs > 0.5) {
      // Touchdown verdict: soft on a runway = landing; hard or off-strip = damage or crash.
      if (runway && Math.abs(touchdownVs) < 5 && Math.abs(state.roll) < 0.35 && state.speedKt < 130) {
        state.landed = true;
        state.fuel = 100; // refuel on the strip
      } else if (Math.abs(touchdownVs) > 9 || Math.abs(state.roll) > 0.6 || state.speedKt > 150) {
        state.crashed = true;
        state.crashReason = runway ? 'Hard landing — the gear gave way' : 'Crashed into the terrain';
      } else {
        state.damage = Math.min(100, state.damage + 25 + Math.abs(touchdownVs) * 4);
        if (state.damage >= 100) {
          state.crashed = true;
          state.crashReason = 'Airframe damage — the plane broke apart';
        }
      }
    }
    state.onGround = true;
    if (state.crashed) state.speedKt = 0;
    else state.speedKt = Math.max(0, state.speedKt - 6 * dt); // light rolling friction
  } else {
    state.onGround = false;
    state.landed = false;
  }

  // Out of fuel in the air: glide down, and a water/terrain hit ends it.
  if (state.fuel <= 0 && !state.onGround) {
    state.verticalSpeed = -FLIGHT.sinkRate * 1.6;
  }
  // Hard limits: stay inside the archipelago.
  state.x = clamp(state.x, -4200, 4200);
  state.z = clamp(state.z, -4200, 4200);
  state.y = clamp(state.y, 0, 1500);
  return state;
}

// Readouts for the HUD (knots, feet, degrees).
export function flightReadouts(state) {
  return {
    altitudeFt: Math.max(0, Math.round(state.y * 3.28084)),
    speedKt: Math.round(state.speedKt),
    headingDeg: Math.round((( -state.heading * 180) / Math.PI % 360 + 360) % 360),
    verticalSpeedFpm: Math.round(state.verticalSpeed * 196.85),
    stalled: state.speedKt < FLIGHT.minFlyingSpeedKt && !state.onGround,
  };
}
