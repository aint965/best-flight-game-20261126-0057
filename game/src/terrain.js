// Langit Nusantara — terrain.js: builds the whole world from one seed.
// One job: islands, sea, sky, clouds, runways and rings. No gameplay logic here.
import * as THREE from 'three';
import { mulberry32, degToRad, clamp } from './config.js';

// Island layout: [x, z, radius, peakHeight, hasRunway, name]
// Runway islands are real airfield islands: a flat grass plateau carries the
// strip (with a hill offset to one side), so every runway sits on land, far
// from the water — never on a causeway over the sea.
export const ISLANDS = [
  { x: 0, z: 0, r: 620, h: 90, runway: true, name: 'Pulau Rumah', hill: { dx: 300, dz: -120, r: 260, h: 70 } },
  { x: 1500, z: -900, r: 420, h: 120, runway: true, name: 'Pulau Karang', hill: { dx: 220, dz: -100, r: 176, h: 84 } },
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
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 176;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 176);
  ctx.fillStyle = '#f5f2e8';
  ctx.font = 'bold 104px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Slope shading for cone hills, cheap and seeded-stable: per-vertex green
// shading — darker at the foot, lighter toward the peak, plus a per-wedge
// patch variation from a position hash. No rng() calls here, so the seeded
// stream (and therefore the trees and clouds after it) stays identical.
function shadeCone(geo, h) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const t = clamp((vy + h / 2) / h, 0, 1);
    const patch = 0.9 + 0.1 * Math.sin(Math.atan2(vz, vx) * 3 + vy * 0.13);
    const shade = (0.82 + 0.26 * t) * patch;
    colors[i * 3] = shade;
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
    const hillGeo = new THREE.ConeGeometry(def.hill.r, def.hill.h, 9, 2);
    shadeCone(hillGeo, def.hill.h);
    const hill = new THREE.Mesh(
      hillGeo,
      new THREE.MeshLambertMaterial({ color: 0x3f8f4f, flatShading: true, vertexColors: true }),
    );
    hill.position.set(def.hill.dx, PLATEAU_TOP - 2 + def.hill.h / 2, def.hill.dz);
    group.add(hill);
  } else {
    // Low-poly hill: a squashed cone with jittered rim vertices.
    const geo = new THREE.ConeGeometry(def.r, def.h, 9, 3);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      if (pos.getY(i) < def.h * 0.4) {
        pos.setX(i, vx * (1 + (rng() - 0.5) * 0.22));
        pos.setZ(i, vz * (1 + (rng() - 0.5) * 0.22));
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
  const treeCount = Math.floor(def.r / (def.runway ? 55 : 70));
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
  const numA = String(Math.round(((def.headingDeg + 360) % 360) / 10) || 36).padStart(2, '0');
  const numB = String(Math.round((((def.headingDeg + 180) % 360) / 10) || 36)).padStart(2, '0');
  const numGeo = new THREE.PlaneGeometry(15, 21);
  for (const [num, z, flip] of [[numA, def.length / 2 - 34, 0], [numB, -(def.length / 2 - 34), Math.PI]]) {
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
  scene.add(runwayMesh(HOME_RUNWAY, 'home', mats));
  scene.add(runwayMesh(HOP_RUNWAY, 'hop', mats));

  // Drifting clouds: clustered puffs in slightly different warm tints, so
  // they read as volume instead of one flat white blob.
  const cloudMats = [
    new THREE.MeshBasicMaterial({ color: 0xfff3e2, transparent: true, opacity: 0.95 }),
    new THREE.MeshBasicMaterial({ color: 0xfbe3d0, transparent: true, opacity: 0.92 }),
    new THREE.MeshBasicMaterial({ color: 0xe9e2ee, transparent: true, opacity: 0.9 }),
  ];
  for (let i = 0; i < 16; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(rng() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = 26 + rng() * 42;
      const puff = new THREE.Mesh(
        new THREE.IcosahedronGeometry(s, 0),
        cloudMats[Math.floor(rng() * cloudMats.length)],
      );
      puff.position.set((rng() - 0.5) * 150, (rng() - 0.5) * 14, (rng() - 0.5) * 70);
      puff.scale.y = 0.5;
      cloud.add(puff);
    }
    cloud.position.set((rng() - 0.5) * 6400, 420 + rng() * 260, (rng() - 0.5) * 6400);
    cloud.userData.drift = 2 + rng() * 4;
    scene.add(cloud);
    world.clouds.push(cloud);
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
  return best;
}

export function isOnRunway(x, z) {
  for (const def of [HOME_RUNWAY, HOP_RUNWAY]) {
    const a = degToRad(-def.headingDeg);
    const dx = x - def.x;
    const dz = z - def.z;
    const along = dx * Math.sin(a) + dz * Math.cos(a);
    const across = dx * Math.cos(a) - dz * Math.sin(a);
    if (Math.abs(along) < def.length / 2 && Math.abs(across) < def.width / 2 + 6) return def;
  }
  return null;
}
