// Langit Nusantara — input.js: keyboard + on-screen mouse controls.
// One job: collect what the pilot is asking for and hand it to the flight model.
import { FLIGHT } from './config.js';

export function createInput() {
  return {
    keys: new Set(),
    // Stick positions, -1..1. Pitch +1 = pull up, roll +1 = bank right.
    pitch: 0,
    roll: 0,
    yaw: 0,
    brake: false,
    throttleDelta: 0,
    // Edge-triggered actions, consumed by main.js each frame.
    pressed: new Set(),
    mouseThrottle: null, // 0..100 while the slider is dragged, else null
  };
}

const KEYMAP = {
  KeyW: 'pitchUp', ArrowUp: 'pitchUp',
  KeyS: 'pitchDown', ArrowDown: 'pitchDown',
  KeyA: 'rollLeft', ArrowLeft: 'rollLeft',
  KeyD: 'rollRight', ArrowRight: 'rollRight',
  KeyQ: 'yawLeft', KeyE: 'yawRight',
  ShiftLeft: 'throttleUp', ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown', ControlRight: 'throttleDown', MetaLeft: 'throttleDown', MetaRight: 'throttleDown',
  Space: 'brake',
};

export function bindInput(input, callbacks) {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const action = KEYMAP[event.code];
    if (action) {
      event.preventDefault();
      input.keys.add(action);
      if (event.code === 'KeyR') input.pressed.add('restart');
      if (event.code === 'KeyP') input.pressed.add('pause');
      if (event.code === 'KeyM') input.pressed.add('mute');
      if (event.code === 'KeyC') input.pressed.add('camera');
      if (event.code === 'Enter') input.pressed.add('confirm');
      if (event.code.startsWith('Digit')) input.pressed.add(event.code);
    } else if (event.code === 'KeyR') input.pressed.add('restart');
    else if (event.code === 'KeyP') input.pressed.add('pause');
    else if (event.code === 'KeyM') input.pressed.add('mute');
    else if (event.code === 'KeyC') input.pressed.add('camera');
    else if (event.code === 'Enter') input.pressed.add('confirm');
    else if (event.code.startsWith('Digit')) input.pressed.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    const action = KEYMAP[event.code];
    if (action) input.keys.delete(action);
  });
  window.addEventListener('blur', () => input.keys.clear());

  // On-screen buttons (mouse / touch): pause, mute, restart, camera, missions.
  for (const [id, action] of [
    ['btn-pause', 'pause'], ['btn-mute', 'mute'], ['btn-restart', 'restart'], ['btn-camera', 'camera'],
  ]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => input.pressed.add(action));
  }
  const slider = document.getElementById('throttle-slider');
  if (slider) {
    const setFromEvent = (event) => {
      const rect = slider.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
      input.mouseThrottle = Math.round(ratio * 100);
    };
    slider.addEventListener('pointerdown', (event) => {
      slider.setPointerCapture(event.pointerId);
      setFromEvent(event);
    });
    slider.addEventListener('pointermove', (event) => {
      if (event.buttons) setFromEvent(event);
    });
    slider.addEventListener('pointerup', () => { input.mouseThrottle = null; });
  }
  // Mission cards on the title screen are clickable.
  for (const card of document.querySelectorAll('.mission-card')) {
    card.addEventListener('click', () => callbacks.onMission(card.dataset.mission));
  }
  const startBtn = document.getElementById('btn-start');
  if (startBtn) startBtn.addEventListener('click', () => callbacks.onStart());
}

// Resolve the held keys into a stick frame for this tick.
export function pollInput(input) {
  const k = input.keys;
  input.pitch = (k.has('pitchUp') ? 1 : 0) - (k.has('pitchDown') ? 1 : 0);
  input.roll = (k.has('rollRight') ? 1 : 0) - (k.has('rollLeft') ? 1 : 0);
  input.yaw = (k.has('yawRight') ? 1 : 0) - (k.has('yawLeft') ? 1 : 0);
  input.brake = k.has('brake');
  input.throttleDelta = (k.has('throttleUp') ? FLIGHT.throttleStep : 0)
    - (k.has('throttleDown') ? FLIGHT.throttleStep : 0);
  return input;
}
