// Langit Nusantara — audio.js: every sound is synthesised with WebAudio.
// One job: engine hum, wind, chimes, thuds. No audio files, no network.
export function createAudio() {
  return {
    ctx: null,
    muted: false,
    engineOsc: null,
    engineGain: null,
    windSource: null,
    windGain: null,
    windFilter: null,
    started: false,
  };
}

// Must be called from a user gesture at least once (autoplay policy).
export function ensureAudio(audio) {
  if (audio.started) {
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  audio.ctx = ctx;
  audio.started = true;

  // Engine: two detuned sawtooth oscillators through a low-pass filter.
  audio.engineOsc = ctx.createOscillator();
  audio.engineOsc.type = 'sawtooth';
  audio.engineOsc.frequency.value = 55;
  const engineOsc2 = ctx.createOscillator();
  engineOsc2.type = 'sawtooth';
  engineOsc2.frequency.value = 82;
  audio.engineGain = ctx.createGain();
  audio.engineGain.gain.value = 0;
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 420;
  audio.engineOsc.connect(engineFilter);
  engineOsc2.connect(engineFilter);
  engineFilter.connect(audio.engineGain);
  audio.engineGain.connect(ctx.destination);
  audio.engineOsc.start();
  engineOsc2.start();
  audio.engineOsc2 = engineOsc2;

  // Wind: looped noise buffer through a band-pass filter.
  const len = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  audio.windSource = ctx.createBufferSource();
  audio.windSource.buffer = buffer;
  audio.windSource.loop = true;
  audio.windFilter = ctx.createBiquadFilter();
  audio.windFilter.type = 'bandpass';
  audio.windFilter.frequency.value = 500;
  audio.windGain = ctx.createGain();
  audio.windGain.gain.value = 0;
  audio.windSource.connect(audio.windFilter);
  audio.windFilter.connect(audio.windGain);
  audio.windGain.connect(ctx.destination);
  audio.windSource.start();
}

export function setEngineSound(audio, throttle, speedKt) {
  if (!audio.ctx || audio.muted) {
    if (audio.engineGain) audio.engineGain.gain.value = 0;
    if (audio.windGain) audio.windGain.gain.value = 0;
    return;
  }
  const t = audio.ctx.currentTime;
  const freq = 48 + throttle * 0.9 + speedKt * 0.12;
  audio.engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
  audio.engineOsc2.frequency.setTargetAtTime(freq * 1.5, t, 0.1);
  audio.engineGain.gain.setTargetAtTime(0.02 + (throttle / 100) * 0.055, t, 0.15);
  audio.windGain.gain.setTargetAtTime(Math.min(0.09, (speedKt / 185) * 0.09), t, 0.2);
  audio.windFilter.frequency.setTargetAtTime(300 + speedKt * 4, t, 0.2);
}

function blip(audio, freq, dur, type, vol, when = 0) {
  if (!audio.ctx || audio.muted) return;
  const t = audio.ctx.currentTime + when;
  const osc = audio.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = audio.ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(audio.ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export function playRingChime(audio) {
  blip(audio, 880, 0.35, 'sine', 0.16);
  blip(audio, 1318, 0.4, 'sine', 0.12, 0.08);
}

export function playTouchdown(audio) {
  blip(audio, 90, 0.25, 'sine', 0.22);
  blip(audio, 60, 0.3, 'triangle', 0.18, 0.02);
}

export function playCrash(audio) {
  if (!audio.ctx || audio.muted) return;
  const t = audio.ctx.currentTime;
  const noise = audio.ctx.createBufferSource();
  const len = audio.ctx.sampleRate * 0.5;
  const buffer = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  noise.buffer = buffer;
  const gain = audio.ctx.createGain();
  gain.gain.value = 0.35;
  noise.connect(gain);
  gain.connect(audio.ctx.destination);
  noise.start(t);
  blip(audio, 55, 0.6, 'sine', 0.3);
}

export function playClick(audio) {
  blip(audio, 660, 0.08, 'square', 0.06);
}

export function toggleMute(audio) {
  audio.muted = !audio.muted;
  if (audio.ctx) {
    if (audio.engineGain) audio.engineGain.gain.value = 0;
    if (audio.windGain) audio.windGain.gain.value = 0;
  }
  return audio.muted;
}
