// ── player.js — Ren Kadir on foot: model, movement, walk-cycle swing.
// Exports: makeRen (the figure builder), Player (position/heading state
// + update). main.js feeds it camera-relative input axes; combat.js
// reads its heading to aim, and main.js toggles the gun in its hand.
// Ren Kadir on foot: a low-poly courier with a teal jacket, WASD movement
// relative to the camera, a walk/run swing, and simple building collision.

import { clamp, wrapAngle } from './config.js';
import { pushOutOfBoxes } from './world.js';
import { makeBlobShadow } from './vehicles.js';

export function makeRen() {
  const g = new THREE.Group();
  g.add(makeBlobShadow(0.62, 0.62));
  const jacket = new THREE.MeshLambertMaterial({ color: 0x12b5a5 });
  const skin = new THREE.MeshLambertMaterial({ color: 0x8a5a34 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x1f2733 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.74, 0.36), jacket);
  torso.position.y = 1.13;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), skin);
  head.position.y = 1.74;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.12, 8),
    new THREE.MeshLambertMaterial({ color: 0xd64541 }));
  cap.position.y = 1.92;
  g.add(cap);
  const limbs = [];
  for (const sx of [-0.45, 0.45]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.64, 0.17), jacket);
    arm.geometry.translate(0, -0.27, 0);
    arm.position.set(sx, 1.44, 0);
    g.add(arm);
    limbs.push(arm);
  }
  for (const sx of [-0.18, 0.18]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.8, 0.21), pants);
    leg.geometry.translate(0, -0.37, 0);
    leg.position.set(sx, 0.8, 0);
    g.add(leg);
    limbs.push(leg);
  }
  // The Kestrel-9 in his right hand — shown when a firearm slot is live.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.52),
    new THREE.MeshLambertMaterial({ color: 0x14161c }));
  gun.position.set(0.45, 0.82, 0.3);
  gun.visible = false;
  g.add(gun);
  g.userData.gun = gun;
  g.userData.limbs = limbs;
  return g;
}

export class Player {
  constructor(scene) {
    this.group = makeRen();
    this.heading = Math.PI;
    this.speedNow = 0;
    this.phase = 0;
    scene.add(this.group);
    this.setPos(6, 76, Math.PI);
  }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }

  setPos(x, z, heading) {
    this.group.position.set(x, 0, z);
    if (heading !== undefined) this.heading = heading;
    this.group.rotation.y = this.heading;
  }

  // camF/camR: the camera's ground-projected forward and right vectors.
  update(dt, input, colliders, camF, camR) {
    const ix = input.axis('KeyA', 'KeyD') + input.axis('ArrowLeft', 'ArrowRight');
    const iz = input.axis('KeyS', 'KeyW') + input.axis('ArrowDown', 'ArrowUp');
    let mx = camR.x * ix + camF.x * iz;
    let mz = camR.z * ix + camF.z * iz;
    const len = Math.hypot(mx, mz);
    const running = input.isDown('ShiftLeft', 'ShiftRight');
    const targetSpeed = len > 0.01 ? (running ? 11.5 : 6.4) : 0;
    if (len > 0.01) {
      mx /= len; mz /= len;
      const want = Math.atan2(mx, mz);
      const dh = wrapAngle(want - this.heading);
      this.heading += dh * Math.min(1, dt * 12);
    }
    this.speedNow += clamp(targetSpeed - this.speedNow, -40 * dt, 30 * dt);
    // Move along the input direction; the heading only steers the model.
    const pos = {
      x: this.x + mx * this.speedNow * dt,
      z: this.z + mz * this.speedNow * dt,
    };
    pushOutOfBoxes(pos, 0.7, colliders, null);
    pos.x = clamp(pos.x, -220, 220);
    // The beach is walkable; the water is not, except along the pier.
    const onPier = Math.abs(pos.x - 128) < 5.5;
    pos.z = clamp(pos.z, -220, onPier ? 316 : 250);
    this.group.position.set(pos.x, 0, pos.z);
    this.group.rotation.y = this.heading;
    this.phase += dt * (this.speedNow > 8 ? 11 : 7.5);
    const swing = Math.sin(this.phase) * clamp(this.speedNow / 8, 0, 1) * 0.6;
    const [aL, aR, lL, lR] = this.group.userData.limbs;
    aL.rotation.x = swing; aR.rotation.x = -swing;
    lL.rotation.x = -swing; lR.rotation.x = swing;
  }
}
