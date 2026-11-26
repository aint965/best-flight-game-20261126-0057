// Langit Nusantara — hud.js: every instrument the pilot reads.
// One job: DOM readouts, artificial horizon, compass strip and minimap.
import { formatTime, clamp, radToDeg } from './config.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  return {
    horizonCtx: $('horizon').getContext('2d'),
    mapCtx: $('minimap').getContext('2d'),
    lastScore: -1,
  };
}

function setText(id, value) {
  const el = $(id);
  if (el && el.textContent !== String(value)) el.textContent = value;
}

function setBar(id, pct, warnAt) {
  const el = $(id);
  if (!el) return;
  el.style.width = `${clamp(pct, 0, 100)}%`;
  el.classList.toggle('warn', pct <= warnAt);
}

// Compass strip: headings N/E/S/W scrolling under a fixed lubber line.
function drawCompass(ctx, headingDeg) {
  const w = 360;
  const h = 34;
  ctx.clearRect(0, 0, w, h);
  // Near-opaque backing: the strip is drawn over the 3D sky, and a bright
  // cloud drifting behind it used to show through the old 0.55 fill and
  // wash out the heading letters.
  ctx.fillStyle = 'rgba(8, 18, 30, 0.88)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labels = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
  for (let deg = -360; deg <= 720; deg += 5) {
    let rel = ((deg - headingDeg) % 360 + 540) % 360 - 180;
    const x = w / 2 + rel * 2.4;
    if (x < -10 || x > w + 10) continue;
    const label = labels.find(([d]) => d === ((deg % 360) + 360) % 360);
    const isText = label || deg % 30 === 0;
    // Text is centre-aligned: keep it clear of the canvas edges so a
    // heading or degree number is never half-clipped by the strip border.
    // Ticks are 1.5 px wide and may run right up to the edge.
    if (isText && (x < 18 || x > w - 18)) continue;
    if (label) {
      ctx.fillStyle = '#ffd166';
      ctx.fillText(label[1], x, h / 2);
    } else if (deg % 30 === 0) {
      ctx.fillStyle = '#cfe3f5';
      ctx.fillText(String(((deg % 360) + 360) % 360), x, h / 2);
    } else {
      ctx.fillStyle = '#8fb0cc';
      ctx.fillRect(x, h / 2 - 5, 1.5, 10);
    }
  }
  // Lubber line.
  ctx.fillStyle = '#ff5a3c';
  ctx.fillRect(w / 2 - 1.5, 0, 3, 10);
}

// Artificial horizon: sky/ground split rotated by roll, shifted by pitch.
function drawHorizon(ctx, pitchRad, rollRad) {
  const w = 150;
  const h = 150;
  const cx = w / 2;
  const cy = h / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-rollRad);
  const pitchPx = clamp(pitchRad, -0.6, 0.6) * 90;
  ctx.fillStyle = '#3f8fd2';
  ctx.fillRect(-80, -80 + pitchPx, 160, 80);
  ctx.fillStyle = '#8a6b46';
  ctx.fillRect(-80, pitchPx, 160, 80);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-80, pitchPx - 1, 160, 2);
  ctx.restore();
  // Fixed aircraft symbol.
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy);
  ctx.lineTo(cx - 10, cy);
  ctx.moveTo(cx + 10, cy);
  ctx.lineTo(cx + 34, cy);
  ctx.moveTo(cx, cy - 4);
  ctx.lineTo(cx, cy + 4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.stroke();
}

// Minimap: islands, runways, rings, plane arrow, next-objective marker.
function drawMinimap(ctx, state, rings, nextRingIndex, homeRunway, hopRunway) {
  const w = 170;
  const h = 170;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(10, 30, 52, 0.72)';
  ctx.fillRect(0, 0, w, h);
  const scale = w / 9000;
  const toMap = (x, z) => [w / 2 + x * scale, h / 2 + z * scale];
  // Sea + islands. Round 8: the volcano and the misty islands are on the
  // map too — grey for the hero volcano, pale blue-grey for the misty ones.
  ctx.fillStyle = '#1e6f9e';
  ctx.fillRect(4, 4, w - 8, h - 8);
  for (const isl of [
    [0, 0, 620, '#3f8f4f'], [1500, -900, 420, '#3f8f4f'], [-1300, -1100, 380, '#3f8f4f'], [900, 1400, 300, '#3f8f4f'],
    [-1700, 900, 460, '#3f8f4f'], [2600, 600, 240, '#3f8f4f'], [-2600, -400, 260, '#3f8f4f'], [400, -2400, 200, '#3f8f4f'],
    [3900, 0, 1000, '#6b7a72'], [3200, -2800, 520, '#7d99a8'], [-3400, -2600, 430, '#7d99a8'], [3300, 2400, 380, '#7d99a8'],
  ]) {
    const [mx, my] = toMap(isl[0], isl[1]);
    ctx.fillStyle = isl[3];
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(2, isl[2] * scale), 0, Math.PI * 2);
    ctx.fill();
  }
  // Runways.
  ctx.fillStyle = '#f5f2e8';
  for (const r of [homeRunway, hopRunway]) {
    const [mx, my] = toMap(r.x, r.z);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate((r.headingDeg * Math.PI) / 180);
    ctx.fillRect(-1.5, -6, 3, 12);
    ctx.restore();
  }
  // Rings: next one pulses gold, the rest dim.
  rings.forEach((ring, i) => {
    const [mx, my] = toMap(ring.position.x, ring.position.z);
    ctx.fillStyle = i === nextRingIndex ? '#ffc93c' : 'rgba(255, 201, 60, 0.45)';
    ctx.beginPath();
    ctx.arc(mx, my, i === nextRingIndex ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // Plane arrow.
  const [px, py] = toMap(state.x, state.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.PI - state.heading);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2.5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function updateHud(hud, view) {
  const { readouts, state, mission, score, bestScore, timeLeft, elapsedSec, objectiveText, rings, nextRingIndex } = view;
  setText('hud-alt', readouts.altitudeFt.toLocaleString('en-US'));
  setText('hud-speed', readouts.speedKt);
  setText('hud-hdg', String(readouts.headingDeg).padStart(3, '0'));
  setText('hud-vsi', (readouts.verticalSpeedFpm >= 0 ? '+' : '') + readouts.verticalSpeedFpm);
  setText('hud-thr', `${Math.round(state.throttle)}%`);
  setText('hud-fuel-num', `${Math.round(state.fuel)}%`);
  setText('hud-score', score.toLocaleString('en-US'));
  setText('hud-best', bestScore.toLocaleString('en-US'));
  setText('hud-mission', mission ? mission.name.toUpperCase() : 'FREE FLIGHT');
  setText('hud-objective', objectiveText);
  // TIME always reads live: the countdown on a timed sortie, the elapsed
  // sortie time everywhere else (a pilot wants to know how long she has
  // been airborne, and a screenshot should never show a dead "--:--").
  setText('hud-timer', mission && mission.timeLimitSec ? formatTime(timeLeft) : formatTime(elapsedSec || 0));
  // Round 8: Storm Courier's front panel — distance + ETA, only on that
  // sortie. The front starts 17 km out and closes as the 4:00 window runs
  // down; the bar drains with it and turns red under 30 s.
  const stormPanel = $('storm-panel');
  if (stormPanel) {
    const isStorm = mission && mission.id === 'storm';
    stormPanel.style.display = isStorm ? '' : 'none';
    if (isStorm) {
      const frac = mission.timeLimitSec > 0 ? clamp(timeLeft / mission.timeLimitSec, 0, 1) : 1;
      setText('hud-front-num', `${(17 * frac).toFixed(1)} KM`);
      setText('hud-front-eta', `ETA ${formatTime(timeLeft)}`);
      setBar('front-bar', frac * 100, 12.5);
    }
  }
  setText('hud-damage-num', `${Math.round(state.damage)}%`);
  setBar('fuel-bar', state.fuel, 25);
  setBar('damage-bar', state.damage, 60);
  $('hud-stall').classList.toggle('show', readouts.stalled);
  $('hud-timer').classList.toggle('urgent', mission && mission.timeLimitSec > 0 && timeLeft < 30);
  const compass = $('compass');
  if (compass) drawCompass(compass.getContext('2d'), readouts.headingDeg);
  drawHorizon(hud.horizonCtx, state.pitch, state.roll);
  drawMinimap(hud.mapCtx, state, rings, nextRingIndex, { x: 0, z: 180, headingDeg: 0 }, { x: 1500, z: -760, headingDeg: 25 });
  // Throttle slider fill, now horizontal (landscape): the fill grows from
  // the left as throttle rises, and the knob reads THR + the live percent.
  const fill = $('throttle-fill');
  if (fill) fill.style.width = `${clamp(state.throttle, 0, 100)}%`;
  setText('throttle-knob-text', `THR ${Math.round(state.throttle)}%`);
}

// Big centre-screen banners (title, pause, game over, mission complete).
export function showOverlay(id) {
  for (const overlay of document.querySelectorAll('.overlay')) overlay.classList.remove('show');
  if (id) {
    const el = $(id);
    if (el) el.classList.add('show');
  }
}

export function setEndScreen({ title, lines, win }) {
  setText('end-title', title);
  const box = $('end-lines');
  if (box) box.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  const el = $('overlay-end');
  if (el) el.classList.toggle('win', !!win);
}
