// Langit Nusantara — terrain.js: builds the whole world from one seed.
// One job: islands, sea, sky, clouds, runways and rings. No gameplay logic here.
import * as THREE from 'three';
import { mulberry32, degToRad } from './config.js';

// Island layout: [x, z, radius, peakHeight, hasRunway, name]
export const ISLANDS = [
  { x: 0, z: 0, r: 620, h: 90, runway: true, name: 'Pulau Rumah' },
  { x: 1500, z: -900, r: 420, h: 120, runway: true, name: 'Pulau Karang' },
  { x: -1300, z: -1100, r: 380, h: 70, runway: false, name: 'Pulau Kelapa' },
  { x: 900, z: 1400, r: 300, h: 55, runway: false, name: 'Pulau Pasir' },
  { x: -1700, z: 900, r: 460, h: 140, runway: false, name: 'Pulau Gunung' },
  { x: 2600, z: 600, r: 240, h: 40, runway: false, name: 'Pulau Terumbu' },
  { x: -2600, z: -400, r: 260, h: 48, runway: false, name: 'Pulau Ombak' },
  { x: 400, z: -2400, r: 200, h: 36, runway: false, name: 'Pulau Kecil' },
];

export const HOME_RUNWAY = { x: 0, z: 780, headingDeg: 0, length: 420, width: 26 };
export const HOP_RUNWAY = { x: 1500, z: -300, headingDeg: 25, length: 340, width: 22 };
// Runways sit on causeways reaching out from the shore, so the strip is flat:
// the island hills never poke through them.

function islandMesh(def, rng) {
  const group = new THREE.Group();
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
  const hill = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: 0x3f8f4f, flatShading: true }),
  );
  hill.position.y = def.h / 2 - 4;
  group.add(hill);
  // Sandy beach ring hugging the waterline.
  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(def.r * 1.02, def.r * 1.12, 7, 12),
    new THREE.MeshLambertMaterial({ color: 0xe8d49a, flatShading: true }),
  );
  beach.position.y = 1;
  group.add(beach);
  // A few palm-ish trees: trunk + two crossed leaf cones.
  const treeCount = Math.floor(def.r / 90);
  for (let i = 0; i < treeCount; i++) {
    const a = rng() * Math.PI * 2;
    const d = def.r * (0.25 + rng() * 0.55);
    const wx = def.x + Math.cos(a) * d;
    const wz = def.z + Math.sin(a) * d;
    // Keep trees off the runway strips.
    if (isOnRunway(wx, wz)) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 2, 16, 5),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
    );
    trunk.position.y = 8;
    tree.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(9, 12, 6),
      new THREE.MeshLambertMaterial({ color: 0x2f7a3d, flatShading: true }),
    );
    leaves.position.y = 20;
    tree.add(leaves);
    tree.position.set(Math.cos(a) * d, def.h * 0.28, Math.sin(a) * d);
    group.add(tree);
  }
  group.position.set(def.x, 0, def.z);
  return group;
}

function runwayMesh(def, label) {
  const group = new THREE.Group();
  // Causeway base: the strip sits on reclaimed land, flat above the sea.
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(def.width + 14, 5, def.length + 24),
    new THREE.MeshLambertMaterial({ color: 0x8a7a5c, flatShading: true }),
  );
  base.position.y = 0;
  group.add(base);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(def.width, 1.2, def.length),
    new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
  );
  strip.position.y = 2.2;
  group.add(strip);
  // Centreline dashes.
  const dashGeo = new THREE.BoxGeometry(2, 0.4, 14);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f2e8 });
  for (let i = -4; i <= 4; i++) {
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(0, 3, i * 38);
    group.add(dash);
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

  // Warm late-afternoon sky: gradient dome + haze fog.
  const skyGeo = new THREE.SphereGeometry(9000, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f6fb8) },
      mid: { value: new THREE.Color(0xf7b267) },
      low: { value: new THREE.Color(0xffd9a0) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.18 ? mix(mid, top, smoothstep(0.18, 0.75, h)) : mix(low, mid, smoothstep(-0.08, 0.18, h)); gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xf2c98d, 2200, 7500);

  // Sun: light + visible disc low in the west.
  const sunLight = new THREE.DirectionalLight(0xffe0b3, 1.6);
  sunLight.position.set(-2600, 1500, -1800);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffe8cc, 0.75));
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(260, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false }),
  );
  sunDisc.position.set(-5200, 900, -3600);
  sunDisc.lookAt(0, 300, 0);
  scene.add(sunDisc);

  // Sea: big flat plane with a warm blue. Phong, not Lambert, so the low
  // sun throws a real specular glitter path across the water instead of a
  // dead flat fill — the cheapest way to make the sea read as sea.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(16000, 16000),
    new THREE.MeshPhongMaterial({ color: 0x2478a8, shininess: 90, specular: 0x9fc4dd }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  scene.add(sea);

  for (const def of ISLANDS) scene.add(islandMesh(def, rng));
  scene.add(runwayMesh(HOME_RUNWAY, 'home'));
  scene.add(runwayMesh(HOP_RUNWAY, 'hop'));

  // Drifting low-poly clouds: unlit warm white so they read as clouds at dusk.
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffeedd, transparent: true, opacity: 0.95 });
  for (let i = 0; i < 16; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rng() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = 26 + rng() * 42;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), cloudMat);
      puff.position.set((rng() - 0.5) * 130, (rng() - 0.5) * 14, (rng() - 0.5) * 60);
      puff.scale.y = 0.55;
      cloud.add(puff);
    }
    cloud.position.set((rng() - 0.5) * 6400, 420 + rng() * 260, (rng() - 0.5) * 6400);
    cloud.userData.drift = 2 + rng() * 4;
    scene.add(cloud);
    world.clouds.push(cloud);
  }
  return world;
}

// Height of the ground (island hill, runway strip or sea level 0) at x,z.
export function groundHeightAt(x, z) {
  if (isOnRunway(x, z)) return 2.4; // flat strip top
  let best = 0;
  for (const def of ISLANDS) {
    const dx = x - def.x;
    const dz = z - def.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < def.r * 1.05) {
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
