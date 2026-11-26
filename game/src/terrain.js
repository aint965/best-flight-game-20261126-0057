// Langit Nusantara — terrain.js: builds the whole world from one seed.
// One job: islands, sea, sky, clouds, runways and rings. No gameplay logic here.
import * as THREE from 'three';
import { mulberry32, degToRad, clamp } from './config.js';

// Island layout: [x, z, radius, peakHeight, hasRunway, name]
// Runway islands are real airfield islands: a flat grass plateau carries the
// strip (with a hill offset to one side), so every runway sits on land, far
// from the water — never on a causeway over the sea.
export const ISLANDS = [
  { x: 0, z: 0, r: 620, h: 90, runway: true, name: 'Pulau Rumah', hill: { dx: 340, dz: -220, r: 190, h: 48 } },
  { x: 1500, z: -900, r: 420, h: 120, runway: true, name: 'Pulau Karang', hill: { dx: 220, dz: -120, r: 150, h: 55 } },
  { x: -1300, z: -1100, r: 380, h: 70, runway: false, name: 'Pulau Kelapa' },
  { x: 900, z: 1400, r: 300, h: 55, runway: false, name: 'Pulau Pasir' },
  { x: -1700, z: 900, r: 460, h: 140, runway: false, name: 'Pulau Gunung' },
  { x: 2600, z: 600, r: 240, h: 40, runway: false, name: 'Pulau Terumbu' },
  { x: -2600, z: -400, r: 260, h: 48, runway: false, name: 'Pulau Ombak' },
  { x: 400, z: -2400, r: 200, h: 36, runway: false, name: 'Pulau Kecil' },
];

// Runways sit ON their islands, centred on the grass plateau with land on
// every side: the strip top (2.4 in groundHeightAt) matches the plateau.
export const HOME_RUNWAY = { x: 0, z: 0, headingDeg: 0, length: 420, width: 26 };
export const HOP_RUNWAY = { x: 1500, z: -900, headingDeg: 25, length: 340, width: 22 };
// Flat grass plateau top for airfield islands.
export const PLATEAU_TOP = 2.5;

// Round 8 — backdrop scenery (NOT in ISLANDS on purpose: no gameplay, no
// runway logic, no trees). A tall volcanic hero island far east, so the
// cover shot's gold ring flies in front of a real mountain instead of a
// flat sea horizon, plus three misty islands further out that read as
// hazed silhouettes. All static geometry built once; the fog does the
// hazing, no per-frame cost. The volcano stands on the cover shot's line
// of sight: from the cover camera the volcano centre and ring 2 share
// almost the same bearing, so the mountain rises directly behind the ring.
export const HERO_VOLCANO = { x: 3900, z: 0, r: 1000, h: 650 };
export const MISTY_ISLANDS = [
  { x: 3200, z: -2800, r: 520, h: 190 },
  { x: -3400, z: -2600, r: 430, h: 150 },
  { x: 3300, z: 2400, r: 380, h: 120 },
];

// --- Procedural canvas textures (no external assets) ------------------------
// Every texture is drawn in code from the seeded rng, so the world stays
// deterministic and offline: mottled grass, speckled asphalt, grainy sand,
// a near-white sea shimmer, and a soft radial glow for the sun.
function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, size, rng, count, colors, rMin, rMax, alphaMin, alphaMax) {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alphaMin + rng() * (alphaMax - alphaMin);
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const r = rMin + rng() * (rMax - rMin);
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, r, r * (0.6 + rng() * 0.8), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function grassTexture(rng) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#4d8a48';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, rng, 420, ['#3c7a38', '#5da254', '#6cb45c', '#2f6b32', '#7fae56', '#8a9a4b'], 4, 22, 0.2, 0.5);
    speckle(ctx, s, rng, 1600, ['#356b31', '#69a854', '#4d8a48', '#8fae62'], 0.6, 2.2, 0.25, 0.6);
  }, 6);
}

function asphaltTexture(rng) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#3d4148';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, rng, 2600, ['#2e3238', '#4a4f58', '#565b64', '#363a41'], 0.5, 2.4, 0.25, 0.6);
    // Faint darker patches: old repairs and tyre wear, never a flat fill.
    speckle(ctx, s, rng, 26, ['#33373e', '#2b2f36'], 12, 42, 0.12, 0.25);
  }, 1);
}

function sandTexture(rng) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#e8d49a';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, rng, 500, ['#dcc184', '#f2e2b0', '#cbb27e', '#e2cf9e'], 2, 12, 0.2, 0.45);
    speckle(ctx, s, rng, 1400, ['#c9ab72', '#f5e7ba', '#d8c088'], 0.5, 1.8, 0.25, 0.55);
  }, 4);
}

function seaShimmerTexture(rng) {
  // Near-white noise: it only modulates the sea's blue a little, so the
  // water reads as a surface instead of a flat fill.
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#f2f7f5';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, rng, 900, ['#dcebe8', '#ffffff', '#c8dedd', '#e6efec'], 1, 7, 0.15, 0.4);
  }, 30);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
  g.addColorStop(0.35, 'rgba(255, 214, 150, 0.45)');
  g.addColorStop(1, 'rgba(255, 200, 130, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function numberTexture(text) {
  // Round 7: runway numbers must read from the chase camera 130-170 m out,
  // where a flat-painted digit is crushed by foreshortening — so the digits
  // are as wide as the strip allows (20 m across, both digits ~45 px on
  // screen at capture distance), set in Arial Black 900, pure white with a
  // dark outline so they hold against both fresh asphalt and sun-bleached
  // patches. The canvas is wider than tall because two digits sit side by
  // side; the plane geometry below is 20 wide x 26 tall.
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 320);
  ctx.font = '900 170px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(18, 20, 24, 0.9)';
  ctx.strokeText(text, 128, 164);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 164);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Slope shading for hills, cheap and seeded-stable: per-vertex green
// shading — darker at the foot, lighter toward the peak, plus two layers of
// per-wedge patch variation from a position hash (a coarse 3-wedge wash and
// a finer 7-wedge speckle), so a hill reads as mottled ground instead of a
// smooth cone. No rng() calls here, so the seeded stream (and therefore
// the trees and clouds after it) stays identical.
function shadeCone(geo, h) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const t = clamp((vy + h / 2) / h, 0, 1);
    const a = Math.atan2(vz, vx);
    const wash = Math.sin(a * 3 + vy * 0.13);
    const fine = Math.sin(a * 7 - vy * 0.05);
    const patch = 0.88 + 0.09 * wash + 0.05 * fine;
    // Darker, damper base band; drier, sunlit peak.
    const shade = (0.78 + 0.3 * t) * patch;
    colors[i * 3] = shade * (1 + 0.06 * t);
    colors[i * 3 + 1] = shade * (0.96 + 0.04 * patch);
    colors[i * 3 + 2] = shade * 0.94;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makeTree(rng) {
  // A palm-ish tree that reads as a tree, not a cone on a stick: a leaning
  // trunk plus three layered leaf crowns in slightly different greens.
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 2.0, 16, 5),
    new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
  );
  trunk.position.y = 8;
  trunk.rotation.z = (rng() - 0.5) * 0.16;
  tree.add(trunk);
  const greens = [0x2f7a3d, 0x35873f, 0x2a6b36];
  const layers = [
    { r: 9.5, h: 11, y: 19 },
    { r: 7.5, h: 9, y: 25 },
    { r: 5, h: 8, y: 30 },
  ];
  layers.forEach((L, i) => {
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(L.r, L.h, 7),
      new THREE.MeshLambertMaterial({ color: greens[i % greens.length], flatShading: true }),
    );
    crown.position.y = L.y;
    tree.add(crown);
  });
  return tree;
}

// Round 8 — a pine: one tall dark cone on a short trunk, for the dense
// clusters that make a hillside read as forest instead of a bare cone.
function makePine(rng) {
  const pine = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.3, 8, 5),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2a }),
  );
  trunk.position.y = 4;
  pine.add(trunk);
  const layers = [
    { r: 6.5, h: 15, y: 12 },
    { r: 4.5, h: 12, y: 20 },
  ];
  const greens = [0x245e30, 0x2a6b36];
  layers.forEach((L, i) => {
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(L.r, L.h, 7),
      new THREE.MeshLambertMaterial({ color: greens[i % greens.length], flatShading: true }),
    );
    crown.position.y = L.y;
    pine.add(crown);
  });
  return pine;
}

// Round 8 — a flat ribbon of water following a polyline: the home island's
// river, a blue guide line across the plateau. Built as a triangle strip
// 0.15 m above the grass so it never z-fights; the path stays 35+ m clear
// of the home strip on every side, so no landing ever touches water.
function riverMesh(points, width) {
  const verts = [];
  const idx = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    let dx = nx - px;
    let dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const ox = (-dz * width) / 2;
    const oz = (dx * width) / 2;
    verts.push(x + ox, 2.65, z + oz, x - ox, 2.65, z - oz);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0x4aa8d8, transparent: true, opacity: 0.92 }),
  );
  mesh.renderOrder = 1;
  return mesh;
}

function islandMesh(def, rng, mats) {
  const group = new THREE.Group();
  if (def.runway) {
    // Airfield island: a flat grass plateau carries the strip, with a hill
    // offset to one side (clear of the runway corridor) for relief.
    const plateau = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.98, def.r * 1.04, 5, 28),
      new THREE.MeshLambertMaterial({ map: mats.grass, flatShading: true }),
    );
    plateau.position.y = 0; // top at PLATEAU_TOP (2.5)
    group.add(plateau);
    const hillGeo = new THREE.ConeGeometry(def.hill.r, def.hill.h, 12, 3);
    // Round 7: break the perfect-cone silhouette — jitter every ring below
    // the apex, strongest at the foot, so the ridge line is uneven instead
    // of a straight triangle edge.
    {
      const pos = hillGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = clamp((y + def.hill.h / 2) / def.hill.h, 0, 1);
        if (t < 0.98) {
          const amp = 0.1 * (1 - t);
          pos.setX(i, pos.getX(i) * (1 + (rng() - 0.5) * amp));
          pos.setZ(i, pos.getZ(i) * (1 + (rng() - 0.5) * amp));
        }
      }
      hillGeo.computeVertexNormals();
    }
    shadeCone(hillGeo, def.hill.h);
    const hill = new THREE.Mesh(
      hillGeo,
      new THREE.MeshLambertMaterial({ color: 0x3f8f4f, flatShading: true, vertexColors: true }),
    );
    hill.position.set(def.hill.dx, PLATEAU_TOP - 2 + def.hill.h / 2, def.hill.dz);
    group.add(hill);
    // Round 7: scrub trees hugging the lower slopes — a bare cone reads as
    // a pyramid, a cone with trees on its skirt reads as a hill. Each tree
    // sits on the cone profile (same formula groundHeightAt uses), scaled
    // down so none pokes above the apex.
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      const f = 0.3 + rng() * 0.45; // fraction of the hill radius out
      const sx = def.hill.dx + Math.cos(a) * def.hill.r * f;
      const sz = def.hill.dz + Math.sin(a) * def.hill.r * f;
      const sy = PLATEAU_TOP - 2 + def.hill.h * (1 - f);
      const slopeTree = makeTree(rng);
      const s = 0.5 + rng() * 0.2;
      slopeTree.scale.setScalar(s);
      slopeTree.position.set(sx, sy, sz);
      group.add(slopeTree);
    }
  } else {
    // Low-poly hill: a squashed cone with jittered vertices on every ring
    // below the apex (round 7: the old rim-only jitter still left a
    // straight triangle ridge; now the whole silhouette is uneven).
    const geo = new THREE.ConeGeometry(def.r, def.h, 12, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = clamp((y + def.h / 2) / def.h, 0, 1);
      if (t < 0.98) {
        const amp = 0.16 * (1 - t * 0.6);
        pos.setX(i, pos.getX(i) * (1 + (rng() - 0.5) * amp));
        pos.setZ(i, pos.getZ(i) * (1 + (rng() - 0.5) * amp));
      }
    }
    geo.computeVertexNormals();
    shadeCone(geo, def.h);
    const hill = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: 0x3f8f4f, flatShading: true, vertexColors: true }),
    );
    hill.position.y = def.h / 2 - 4;
    group.add(hill);
  }
  // Sandy beach ring hugging the waterline. Its top cap sits BELOW the
  // grass plateau (1.5 vs 2.5), so from above you see grass in the middle
  // and only a sand rim around the edge — a solid disc here would bury the
  // plateau and the runway under sand (round 5, first pass).
  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(def.r * 1.02, def.r * 1.12, 7, 12),
    new THREE.MeshLambertMaterial({ map: mats.sand, flatShading: true }),
  );
  beach.position.y = -2;
  group.add(beach);
  // Trees on the grass: kept off the runway strips and, on airfield islands,
  // off the hill cone so none floats or buries itself.
  // Round 8: denser forest on the wild islands (divisor 48, was 70).
  const treeCount = Math.floor(def.r / (def.runway ? 55 : 48));
  for (let i = 0; i < treeCount; i++) {
    const a = rng() * Math.PI * 2;
    const d = def.r * (0.25 + rng() * 0.55);
    const wx = def.x + Math.cos(a) * d;
    const wz = def.z + Math.sin(a) * d;
    if (isOnRunway(wx, wz)) continue;
    if (def.runway) {
      const hx = Math.cos(a) * d - def.hill.dx;
      const hz = Math.sin(a) * d - def.hill.dz;
      if (Math.sqrt(hx * hx + hz * hz) < def.hill.r * 0.95) continue;
    }
    const tree = makeTree(rng);
    tree.position.set(Math.cos(a) * d, def.runway ? PLATEAU_TOP : def.h * 0.28, Math.sin(a) * d);
    group.add(tree);
  }
  // Round 8 — the plateau reads less empty: a river, patchwork fields and
  // dense pine clusters. All positions are fixed (never rng-streamed), and
  // the jitter below uses a per-island seeded rng so the main rng stream —
  // and therefore every tree and cloud placed before round 8 — is untouched.
  const rng8 = mulberry32(0x8badf00d + def.x * 7 + def.z * 13);
  if (def.runway) {
    // Field patches: flat coloured discs on the grass, clear of the strip
    // and the hill on both airfield islands.
    const fields = def.name === 'Pulau Rumah'
      ? [[-250, 150, 55, 0x6b9e4a], [-350, -100, 65, 0x8aa84b], [250, 250, 50, 0x5c8a3e], [-150, 420, 60, 0xa8a04b], [350, 120, 45, 0x7fae56]]
      : [[280, -280, 45, 0x8aa84b], [-280, 280, 55, 0x6b9e4a]];
    for (const [fx, fz, fr, fc] of fields) {
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(fr, 20),
        new THREE.MeshLambertMaterial({ color: fc, flatShading: true }),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(fx, 2.6, fz);
      patch.renderOrder = 1;
      group.add(patch);
    }
    // Pine clusters: six dark pines huddled together read as forest.
    const clusters = def.name === 'Pulau Rumah'
      ? [[-300, 80], [-420, -180], [280, 380], [480, 60]]
      : [[350, 80], [-120, -280]];
    for (const [cx, cz] of clusters) {
      for (let i = 0; i < 6; i++) {
        const pine = makePine(rng8);
        const s = 0.9 + rng8() * 0.4;
        pine.scale.setScalar(s);
        pine.position.set(cx + (rng8() - 0.5) * 56, PLATEAU_TOP, cz + (rng8() - 0.5) * 56);
        group.add(pine);
      }
    }
  }
  if (def.name === 'Pulau Rumah') {
    // The river: from the hill foot, winding west to the shore. Every point
    // is 35+ m from the strip centreline; the source pond sits outside the
    // hill foot so the ribbon never dives under the cone.
    group.add(riverMesh([
      [140, -300], [90, -200], [60, -100], [55, -10], [40, 80],
      [-40, 150], [-160, 220], [-300, 290], [-430, 350], [-480, 350],
    ], 14));
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(26, 20),
      new THREE.MeshBasicMaterial({ color: 0x4aa8d8, transparent: true, opacity: 0.92 }),
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(140, 2.65, -300);
    pond.renderOrder = 1;
    group.add(pond);
  }
  group.position.set(def.x, 0, def.z);
  return group;
}

function runwayMesh(def, label, mats) {
  const group = new THREE.Group();
  // Mown-grass shoulder, flush with the plateau: the strip reads as asphalt
  // laid on land, not a slab floating over water.
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(def.width + 14, 1.6, def.length + 24),
    new THREE.MeshLambertMaterial({ color: 0x4a7038, flatShading: true }),
  );
  base.position.y = 1.7; // top at 2.5 = plateau top
  group.add(base);
  // Asphalt strip with a speckled procedural texture, not a flat fill.
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, 1.2, def.length),
    new THREE.MeshLambertMaterial({ map: mats.asphalt }),
  );
  strip.position.y = 2.2;
  group.add(strip);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f2e8 });
  // Centreline dashes.
  const dashGeo = new THREE.BoxGeometry(2, 0.4, 14);
  for (let i = -4; i <= 4; i++) {
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(0, 3, i * 38);
    group.add(dash);
  }
  // Edge stripes: thin white lines down both sides of the asphalt.
  const edgeGeo = new THREE.BoxGeometry(1, 0.35, def.length - 12);
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(edgeGeo, dashMat);
    edge.position.set(side * (def.width / 2 - 1.5), 2.95, 0);
    group.add(edge);
  }
  // Threshold bars.
  const barGeo = new THREE.BoxGeometry(4, 0.4, 10);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const bar = new THREE.Mesh(barGeo, dashMat);
      bar.position.set(side * 7, 3, end * (def.length / 2 - 16));
      group.add(bar);
    }
  }
  // Touchdown zone: pairs of bars 60 m and 120 m past each threshold.
  const tzGeo = new THREE.BoxGeometry(3, 0.4, 9);
  for (const end of [-1, 1]) {
    for (const dist of [60, 120]) {
      for (const side of [-1, 1]) {
        const tz = new THREE.Mesh(tzGeo, dashMat);
        tz.position.set(side * 6.5, 3, end * (def.length / 2 - dist));
        group.add(tz);
      }
    }
  }
  // Runway numbers, painted to be read by the landing pilot: the number is
  // the strip heading in tens of degrees (home 36/18, Karang 03/21).
  // Round 7: the plane is 20 m wide (the full strip width) x 26 m tall
  // and sits 40 m past each threshold, so the digits are as large as the
  // strip allows and face the pilot on final instead of hiding mid-strip.
  const numA = String(Math.round(((def.headingDeg + 360) % 360) / 10) || 36).padStart(2, '0');
  const numB = String(Math.round((((def.headingDeg + 180) % 360) / 10) || 36)).padStart(2, '0');
  const numGeo = new THREE.PlaneGeometry(20, 26);
  for (const [num, z, flip] of [[numA, def.length / 2 - 40, 0], [numB, -(def.length / 2 - 40), Math.PI]]) {
    const holder = new THREE.Group();
    const face = new THREE.Mesh(
      numGeo,
      new THREE.MeshBasicMaterial({ map: numberTexture(num), transparent: true }),
    );
    face.rotation.x = -Math.PI / 2;
    holder.add(face);
    holder.position.set(0, 3.05, z);
    holder.rotation.y = flip;
    group.add(holder);
  }
  // Edge lights: warm amber, emissive so they glow at dusk.
  const lightGeo = new THREE.SphereGeometry(1.6, 8, 6);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  for (let i = -6; i <= 6; i++) {
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(lightGeo, lightMat);
      lamp.position.set(side * (def.width / 2 + 3), 3.4, i * (def.length / 13));
      group.add(lamp);
    }
  }
  // Approach lights on the home strip.
  if (label === 'home') {
    const appMat = new THREE.MeshBasicMaterial({ color: 0x7dff9a });
    for (let i = 1; i <= 4; i++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), appMat);
      lamp.position.set(0, 3.2, def.length / 2 + i * 26);
      group.add(lamp);
    }
  }
  group.position.set(def.x, 0, def.z);
  group.rotation.y = degToRad(def.headingDeg);
  return group;
}

export function makeRing(radius = 20) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 2, 10, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc93c }),
  );
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 4.2, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.28 }),
  );
  ring.add(glow);
  return ring;
}

export function buildWorld(scene, seed = 1) {
  const rng = mulberry32(seed);
  const world = { rings: [], clouds: [], islands: ISLANDS };
  const mats = {
    grass: grassTexture(rng),
    asphalt: asphaltTexture(rng),
    sand: sandTexture(rng),
    sea: seaShimmerTexture(rng),
  };

  // Late-afternoon sky, softened: a natural blue-to-gold gradient, not a
  // flat saturated orange. The haze fog warms the horizon.
  const skyGeo = new THREE.SphereGeometry(9000, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x4a7fc1) },
      mid: { value: new THREE.Color(0xf0b877) },
      low: { value: new THREE.Color(0xffdca6) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.5, h)) : mix(low, mid, smoothstep(-0.08, 0.08, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xeec9a0, 2200, 7500);

  // Sun: light + visible disc low in the west, with a soft glow sprite
  // around it so it reads as a low sun, not a flat coin.
  const sunLight = new THREE.DirectionalLight(0xffe0b3, 1.6);
  sunLight.position.set(-2600, 1500, -1800);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffe8cc, 0.75));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.8,
  }));
  glow.scale.set(1700, 1700, 1);
  glow.position.set(-5300, 920, -3670);
  scene.add(glow);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(260, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false }),
  );
  sunDisc.position.set(-5200, 900, -3600);
  sunDisc.lookAt(0, 300, 0);
  scene.add(sunDisc);

  // Sea: a big flat plane with a warm blue. Phong, not Lambert, so the low
  // sun throws a real specular glitter path across the water instead of a
  // dead flat fill — the cheapest way to make the sea read as sea. A subtle
  // procedural shimmer breaks the flat colour, and a pale lagoon ring around
  // each island grades the water from shallow turquoise to deep blue.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(16000, 16000),
    new THREE.MeshPhongMaterial({ color: 0x2478a8, map: mats.sea, shininess: 90, specular: 0x9fc4dd }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  scene.add(sea);

  for (const def of ISLANDS) {
    scene.add(islandMesh(def, rng, mats));
    const lagoon = new THREE.Mesh(
      new THREE.RingGeometry(def.r * 0.98, def.r * 1.9, 40),
      new THREE.MeshBasicMaterial({ color: 0x3fb8a6, transparent: true, opacity: 0.26, depthWrite: false }),
    );
    lagoon.rotation.x = -Math.PI / 2;
    lagoon.position.set(def.x, 0.25, def.z);
    lagoon.renderOrder = 1;
    scene.add(lagoon);
  }
  // Round 8 — the hero volcano and the misty islands. The volcano is a
  // big jittered cone (same recipe as the wild islands, darker rock) with
  // a pale ash cap, a dark crater, its own beach ring and lagoon, and a
  // small white lighthouse with a glowing lamp on its western shoulder —
  // the side the cover camera sees. The misty islands are plain pale
  // cones; the fog hazes them into silhouettes. All of it is static
  // geometry: built once, never touched per frame.
  {
    const v = HERO_VOLCANO;
    const vGeo = new THREE.ConeGeometry(v.r, v.h, 14, 4);
    {
      const pos = vGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = clamp((y + v.h / 2) / v.h, 0, 1);
        if (t < 0.98) {
          const amp = 0.14 * (1 - t * 0.6);
          pos.setX(i, pos.getX(i) * (1 + (rng() - 0.5) * amp));
          pos.setZ(i, pos.getZ(i) * (1 + (rng() - 0.5) * amp));
        }
      }
      vGeo.computeVertexNormals();
    }
    shadeCone(vGeo, v.h);
    const volcano = new THREE.Mesh(
      vGeo,
      new THREE.MeshLambertMaterial({ color: 0x55684f, flatShading: true, vertexColors: true }),
    );
    volcano.position.set(v.x, v.h / 2 - 4, v.z);
    scene.add(volcano);
    // Pale ash cap: a cone with the same slope, apex at the volcano apex.
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(231, 150, 14, 1),
      new THREE.MeshLambertMaterial({ color: 0xe8e2d4, flatShading: true }),
    );
    cap.position.set(v.x, v.h - 4 - 75, v.z);
    scene.add(cap);
    // Dark crater mouth at the very top.
    const crater = new THREE.Mesh(
      new THREE.CylinderGeometry(58, 58, 10, 14),
      new THREE.MeshLambertMaterial({ color: 0x2b2b2b, flatShading: true }),
    );
    crater.position.set(v.x, v.h - 4 - 2, v.z);
    scene.add(crater);
    // Beach ring + lagoon, same as the other islands.
    const vBeach = new THREE.Mesh(
      new THREE.CylinderGeometry(v.r * 1.02, v.r * 1.12, 7, 14),
      new THREE.MeshLambertMaterial({ map: mats.sand, flatShading: true }),
    );
    vBeach.position.set(v.x, -2, v.z);
    scene.add(vBeach);
    const vLagoon = new THREE.Mesh(
      new THREE.RingGeometry(v.r * 0.98, v.r * 1.9, 40),
      new THREE.MeshBasicMaterial({ color: 0x3fb8a6, transparent: true, opacity: 0.26, depthWrite: false }),
    );
    vLagoon.rotation.x = -Math.PI / 2;
    vLagoon.position.set(v.x, 0.25, v.z);
    vLagoon.renderOrder = 1;
    scene.add(vLagoon);
    // Lighthouse on the western shoulder (cone height there ~548 m): a
    // white tower with a red band and roof, and a warm glow sprite at the
    // lamp so the light reads even at 3.5 km.
    const light = new THREE.Group();
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(3.5, 4.5, 26, 8),
      new THREE.MeshLambertMaterial({ color: 0xf5f2e8 }),
    );
    tower.position.y = 13;
    light.add(tower);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.2, 6, 8),
      new THREE.MeshLambertMaterial({ color: 0xc23b2e }),
    );
    band.position.y = 9;
    light.add(band);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(5, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0xc23b2e }),
    );
    roof.position.y = 29;
    light.add(roof);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(3, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
    );
    lamp.position.y = 24;
    light.add(lamp);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.9,
    }));
    lampGlow.scale.set(110, 110, 1);
    lampGlow.position.y = 24;
    light.add(lampGlow);
    light.position.set(v.x - 150, v.h * (1 - 150 / v.r) - 4, v.z + 30);
    scene.add(light);
    // Misty islands: plain pale cones, no trees, no beach detail — the
    // fog turns them into distant silhouettes.
    for (const m of MISTY_ISLANDS) {
      const mGeo = new THREE.ConeGeometry(m.r, m.h, 12, 3);
      const pos = mGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = clamp((y + m.h / 2) / m.h, 0, 1);
        if (t < 0.98) {
          const amp = 0.12 * (1 - t * 0.6);
          pos.setX(i, pos.getX(i) * (1 + (rng() - 0.5) * amp));
          pos.setZ(i, pos.getZ(i) * (1 + (rng() - 0.5) * amp));
        }
      }
      mGeo.computeVertexNormals();
      const misty = new THREE.Mesh(
        mGeo,
        new THREE.MeshLambertMaterial({ color: 0x9db4c0, flatShading: true }),
      );
      misty.position.set(m.x, m.h / 2 - 4, m.z);
      scene.add(misty);
    }
  }
  scene.add(runwayMesh(HOME_RUNWAY, 'home', mats));
  scene.add(runwayMesh(HOP_RUNWAY, 'hop', mats));

  // Drifting clouds, round 8: the round-7 sphere stacks still read as flat
  // ellipses from a distance, so the puffs are taller now (up to 0.8 of
  // their width instead of 0.5), there are more of them per cloud, and a
  // few clouds hang LOW over the islands (y 240-320) so the pilot flies
  // under real cloud bellies instead of past distant white smudges.
  // Each cloud also throws a soft shadow: a dark radial blob riding the
  // ground directly under it (main.js moves it every frame), offset east
  // because the sun sits in the west.
  const cloudMats = [
    new THREE.MeshBasicMaterial({ color: 0xfff6e8, transparent: true, opacity: 0.95 }),
    new THREE.MeshBasicMaterial({ color: 0xfbe3d0, transparent: true, opacity: 0.9 }),
    new THREE.MeshBasicMaterial({ color: 0xe9dfe8, transparent: true, opacity: 0.62 }),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38 }),
    new THREE.MeshBasicMaterial({ color: 0xcfc4d6, transparent: true, opacity: 0.5 }),
  ];
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(10, 20, 35, 0.55)');
    grad.addColorStop(0.7, 'rgba(10, 20, 35, 0.22)');
    grad.addColorStop(1, 'rgba(10, 20, 35, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  world.cloudShadows = [];
  const lowCloudSpots = [
    [200, 280, -1400], [1700, 300, -200], [-400, 260, 1200], [900, 300, 1400],
  ];
  for (let i = 0; i < 22; i++) {
    const cloud = new THREE.Group();
    const isLow = i >= 18;
    const puffs = 7 + Math.floor(rng() * 5);
    for (let p = 0; p < puffs; p++) {
      const isBase = p === 0;
      const isShadow = !isBase && p % 4 === 0;
      const isTower = !isBase && !isShadow && p % 5 === 0;
      const s = isBase ? 60 + rng() * 45 : isTower ? 16 + rng() * 18 : 18 + rng() * 55;
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(s, 12, 8),
        cloudMats[isBase ? 1 : isShadow ? (rng() < 0.5 ? 2 : 4) : rng() < 0.25 ? 3 : 0],
      );
      puff.position.set(
        (rng() - 0.5) * 170,
        isBase ? 0 : isShadow ? -9 - rng() * 5 : isTower ? 14 + rng() * 10 : 3 + rng() * 12,
        (rng() - 0.5) * 80,
      );
      puff.scale.set(
        1.5 + rng() * 0.7,
        isTower ? 0.9 + rng() * 0.3 : 0.5 + rng() * 0.3,
        1.0 + rng() * 0.3,
      );
      cloud.add(puff);
    }
    if (isLow) {
      const [lx, ly, lz] = lowCloudSpots[i - 18];
      cloud.position.set(lx, ly, lz);
    } else {
      cloud.position.set((rng() - 0.5) * 6400, 420 + rng() * 260, (rng() - 0.5) * 6400);
    }
    cloud.userData.drift = 2 + rng() * 4;
    scene.add(cloud);
    world.clouds.push(cloud);
    // Its shadow: a soft dark ellipse on the ground below, sized to the
    // cloud, following it every frame (see main.js).
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 200),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 2;
    scene.add(blob);
    world.cloudShadows.push({ cloud, blob, baseOpacity: 0.16 });
  }
  // Round 8: the Storm Courier front — a dark wall of storm cloud in the
  // far east, visible ONLY while flying that sortie (main.js toggles
  // visibility by mission). It starts 4.2 km out and closes to 2.8 km as
  // the 4:00 courier window runs down, so the pilot watches the sky darken.
  {
    const stormWall = new THREE.Group();
    const wallMats = [
      new THREE.MeshBasicMaterial({ color: 0x3a4556, transparent: true, opacity: 0.96 }),
      new THREE.MeshBasicMaterial({ color: 0x2f3848, transparent: true, opacity: 0.96 }),
      new THREE.MeshBasicMaterial({ color: 0x6b7688, transparent: true, opacity: 0.9 }),
    ];
    // A solid dark backplane so the wall reads as a front, not a row of puffs.
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(2800, 750),
      new THREE.MeshBasicMaterial({ color: 0x333e50, transparent: true, opacity: 0.6 }),
    );
    back.rotation.y = -Math.PI / 2; // face west, toward the islands
    back.position.set(0, 380, 0);
    stormWall.add(back);
    for (let i = 0; i < 16; i++) {
      const z = -1300 + i * 173 + (rng() - 0.5) * 60;
      const s = 130 + rng() * 130;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8), wallMats[i % 2]);
      puff.position.set((rng() - 0.5) * 160, 120 + rng() * 420, z);
      puff.scale.set(0.7 + rng() * 0.4, 0.55 + rng() * 0.35, 1.1 + rng() * 0.5);
      stormWall.add(puff);
    }
    // Lit rim on top: a few pale puffs catching the last sun.
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(90 + rng() * 60, 10, 8), wallMats[2]);
      puff.position.set((rng() - 0.5) * 120, 620 + rng() * 90, -1000 + i * 650 + (rng() - 0.5) * 80);
      puff.scale.set(1.4, 0.5, 1.0);
      stormWall.add(puff);
    }
    stormWall.position.set(4200, 0, 0);
    stormWall.visible = false;
    scene.add(stormWall);
    world.stormWall = stormWall;
  }
  return world;
}

// Height of the ground (island plateau/hill, runway strip or sea level 0) at x,z.
export function groundHeightAt(x, z) {
  if (isOnRunway(x, z)) return 2.4; // flat strip top
  let best = 0;
  for (const def of ISLANDS) {
    const dx = x - def.x;
    const dz = z - def.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (def.runway) {
      if (d < def.r * 0.98) {
        let h = PLATEAU_TOP;
        const hx = dx - def.hill.dx;
        const hz = dz - def.hill.dz;
        const hd = Math.sqrt(hx * hx + hz * hz);
        if (hd < def.hill.r) {
          h = Math.max(h, PLATEAU_TOP - 2 + def.hill.h * (1 - hd / def.hill.r));
        }
        if (h > best) best = h;
      }
    } else if (d < def.r * 1.05) {
      // Cone profile: peak at centre, beach at the rim.
      const h = Math.max(0, def.h * (1 - d / (def.r * 1.05)) - 4);
      if (h > best) best = h;
    }
  }
  // Round 8: scenery cones are real ground too — a pilot can fly into the
  // volcano's slopes, so the height function must know them. (They are not
  // in ISLANDS on purpose: no runways, no trees, no lagoon logic there.)
  for (const def of [HERO_VOLCANO, ...MISTY_ISLANDS]) {
    const dx = x - def.x;
    const dz = z - def.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < def.r * 1.05) {
      const h = Math.max(0, def.h * (1 - d / (def.r * 1.05)) - 4);
      if (h > best) best = h;
    }
  }
  return best;
}

export function isOnRunway(x, z) {
  for (const def of [HOME_RUNWAY, HOP_RUNWAY]) {
    // Round 7 fix: this rotated the offset the WRONG way (by +heading
    // instead of -heading), so for the 25 deg Karang strip the test was off
    // by twice the heading — a point on the strip centreline 140 m out
    // measured 107 m "across" and failed. The home strip (heading 0) was
    // unaffected, which is why the bug hid: only a dead-centre Karang
    // touchdown ever counted as a landing, and groundHeightAt returned
    // plateau 2.5 instead of strip 2.4 everywhere else on the strip.
    // Inverting R_y(heading) means rotating by +heading here: local
    // along = dx*sin(h) + dz*cos(h), across = dx*cos(h) - dz*sin(h).
    const a = degToRad(def.headingDeg);
    const dx = x - def.x;
    const dz = z - def.z;
    const along = dx * Math.sin(a) + dz * Math.cos(a);
    const across = dx * Math.cos(a) - dz * Math.sin(a);
    if (Math.abs(along) < def.length / 2 && Math.abs(across) < def.width / 2 + 6) return def;
  }
  return null;
}
