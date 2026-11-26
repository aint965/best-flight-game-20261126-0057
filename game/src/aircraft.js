// Langit Nusantara — aircraft.js: the bush plane, built from primitives.
// One job: build the visible aircraft and animate its propeller and lights.
import * as THREE from 'three';

export function buildAircraft() {
  const plane = new THREE.Group();
  // Phong, not Lambert: a real paint job catches a highlight from the low
  // sun instead of shading flat like a cartoon.
  const paint = new THREE.MeshPhongMaterial({ color: 0xe8542f, shininess: 55, specular: 0x7a2a18, flatShading: true }); // warm coral-red
  const cream = new THREE.MeshPhongMaterial({ color: 0xfff3dd, shininess: 35, specular: 0x555544, flatShading: true });
  const dark = new THREE.MeshPhongMaterial({ color: 0x2e3440, shininess: 30, specular: 0x222222, flatShading: true });
  const metal = new THREE.MeshPhongMaterial({ color: 0x9aa5b1, shininess: 80, specular: 0x666666, flatShading: true });

  // Fuselage: tapered cylinder pointing forward (-Z is forward in our flight model).
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 7.4, 10), paint);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.y = 0.2;
  plane.add(fuselage);
  // Nose cowling.
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.1, 1.6, 10), cream);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.2, -4.2);
  plane.add(nose);
  // Canopy: glossy dark bubble — high shininess so it reads as glass.
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 12, 8),
    new THREE.MeshPhongMaterial({ color: 0x1d3247, shininess: 130, specular: 0xaaccff, flatShading: true }),
  );
  canopy.scale.set(0.95, 0.75, 1.7);
  canopy.position.set(0, 1.15, -0.9);
  plane.add(canopy);
  // High wing with a cream stripe.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.32, 2.4), cream);
  wing.position.set(0, 1.05, -0.4);
  plane.add(wing);
  const wingStripe = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.34, 0.5), paint);
  wingStripe.position.set(0, 1.05, -1.2);
  plane.add(wingStripe);
  // Wing struts: the diagonal braces every bush plane has — they give the
  // high wing its structure and stop it reading as a flat slab.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.9, 6), metal);
    strut.position.set(side * 2.8, 0.38, -0.4);
    strut.rotation.z = -side * 1.26;
    plane.add(strut);
  }
  // Tail: horizontal stabiliser + vertical fin.
  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.24, 1.5), cream);
  tailWing.position.set(0, 0.55, 3.4);
  plane.add(tailWing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.4, 2.0), paint);
  fin.position.set(0, 1.5, 3.5);
  plane.add(fin);
  // Propeller: hub + two blades, spins in animatePropeller.
  const prop = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 8), dark);
  hub.rotation.x = Math.PI / 2;
  prop.add(hub);
  const bladeGeo = new THREE.BoxGeometry(0.42, 3.4, 0.14);
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x1f242e });
  const bladeA = new THREE.Mesh(bladeGeo, bladeMat);
  const bladeB = new THREE.Mesh(bladeGeo, bladeMat);
  bladeB.rotation.z = Math.PI / 2;
  prop.add(bladeA);
  prop.add(bladeB);
  prop.position.set(0, 0.2, -5.15);
  plane.add(prop);
  // Prop blur disc: a faint translucent disc that appears once the engine is
  // turning fast, the way a spinning propeller reads in real life.
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(3.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  propDisc.position.set(0, 0.2, -5.2);
  propDisc.visible = false;
  plane.add(propDisc);
  // Fixed landing gear: two wheels + struts.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), metal);
    strut.position.set(side * 1.1, -1.1, -0.6);
    strut.rotation.z = side * 0.35;
    plane.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.35, -1.85, -0.6);
    plane.add(wheel);
  }
  // Navigation lights: red port, green starboard, white tail.
  const navLights = [];
  const mkLight = (color, x, y, z) => {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color }),
    );
    lamp.position.set(x, y, z);
    plane.add(lamp);
    navLights.push(lamp);
    return lamp;
  };
  mkLight(0xff2a2a, -6.8, 1.05, -0.4);
  mkLight(0x2aff5a, 6.8, 1.05, -0.4);
  mkLight(0xffffff, 0, 0.9, 4.3);
  // Landing light under the nose.
  const landingLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff6c0 }),
  );
  landingLight.position.set(0, -0.5, -4.6);
  plane.add(landingLight);

  plane.userData.propeller = prop;
  plane.userData.propDisc = propDisc;
  plane.userData.navLights = navLights;
  return plane;
}

// Spin the propeller faster with throttle; blink the nav lights.
export function animateAircraft(plane, throttle, timeSec, dt) {
  const prop = plane.userData.propeller;
  if (prop) prop.rotation.z += dt * (4 + throttle * 0.55);
  const disc = plane.userData.propDisc;
  if (disc) {
    disc.visible = throttle > 25;
    disc.material.opacity = 0.05 + throttle * 0.0006;
  }
  const blink = Math.sin(timeSec * 4) > 0;
  for (const lamp of plane.userData.navLights) lamp.visible = blink || lamp === plane.userData.navLights[2];
}
