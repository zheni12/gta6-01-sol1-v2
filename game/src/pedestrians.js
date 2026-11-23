// ── pedestrians.js — the crowd: wandering, fleeing, seated, browsing.
// Exports: Pedestrians (spawn, per-frame update, staging helpers for
// shots.js). main.js polls hitEvents to raise police heat; combat.js
// downs figures via forceFall(); world.js supplies benches and stalls.
// Pedestrians: low-poly figures who stroll the sidewalks, sprint away from
// reckless cars, and go down when clipped — which the law notices. They
// vary in height and build; some wear caps, Strand strollers carry
// surfboards, and a few glide past on scooters.

import { BLOCK_CENTERS, clamp, dist2D, pick, rand, wrapAngle } from './config.js';
import { pushOutOfBoxes } from './world.js';
import { makeBlobShadow } from './vehicles.js';

// The same tight tropical grade as the car fleet: coral, marigold,
// turquoise, sea-blue, warm white, pastel pink, sage — nobody clashes.
const SHIRTS = [0xff6b5e, 0xffc53d, 0x2ec4b6, 0x277da1, 0xf5f0e6, 0xf48498, 0xe58e26, 0x7fb069];
const PANTS = [0x2c3440, 0x51606e, 0xcbb59a, 0xf0ead8, 0x37424e];
const HAIR = [0x1c1a17, 0x4a3220, 0x8a6a42, 0xd8cfc0];
const SKIN = [0xf2c9a0, 0xc98d5e, 0x8a5a34, 0x6e4226];
const BOARD_COLORS = [0xff5964, 0xffd94a, 0x4ecdc4, 0xf48498, 0x7fb069];

function makeFigure(rng) {
  const g = new THREE.Group();
  g.add(makeBlobShadow(0.62, 0.62));
  const shirt = new THREE.MeshLambertMaterial({ color: pick(rng, SHIRTS) });
  const skin = new THREE.MeshLambertMaterial({ color: pick(rng, SKIN) });
  const pants = new THREE.MeshLambertMaterial({ color: pick(rng, PANTS) });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
  torso.position.y = 1.12;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 8, 7), skin);
  head.position.y = 1.72;
  g.add(head);
  // One in four wears a cap with a little brim.
  if (rng() < 0.25) {
    const capMat = new THREE.MeshLambertMaterial({ color: pick(rng, SHIRTS) });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.09, 0.37), capMat);
    cap.position.y = 1.9;
    g.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.24), capMat);
    brim.position.set(0, 1.86, 0.27);
    g.add(brim);
  } else if (rng() < 0.6) {
    // The rest show hair: a flattened cap of it over the crown.
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshLambertMaterial({ color: pick(rng, HAIR) }));
    hair.scale.set(1, 0.62, 1);
    hair.position.y = 1.79;
    g.add(hair);
  }
  const limbs = [];
  for (const sx of [-0.42, 0.42]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.16), shirt);
    arm.geometry.translate(0, -0.26, 0);
    arm.position.set(sx, 1.42, 0);
    g.add(arm);
    limbs.push(arm);
  }
  for (const sx of [-0.17, 0.17]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.2), pants);
    leg.geometry.translate(0, -0.36, 0);
    leg.position.set(sx, 0.78, 0);
    g.add(leg);
    limbs.push(leg);
  }
  g.userData.limbs = limbs;
  return g;
}

export class Pedestrians {
  constructor(scene, world, rng, count = 26) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.peds = [];
    this.hitEvents = 0; // main polls this counter for wanted/crime handling
    for (let i = 0; i < count; i++) {
      const group = makeFigure(rng);
      // No two alike: a little taller or shorter, a little broader or not.
      const build = rand(rng, 0.95, 1.05);
      group.scale.set(build, rand(rng, 0.92, 1.09), build);
      scene.add(group);
      const ped = {
        group, x: 0, z: 0, heading: rand(rng, 0, Math.PI * 2),
        tx: 0, tz: 0, state: 'wander', timer: rand(rng, 0, 3), phase: rand(rng, 0, 6),
        board: null, scooter: false,
      };
      // A few residents get everywhere on a scooter: deck, wheels, stem.
      if (i % 15 === 7) {
        ped.scooter = true;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 1.15),
          new THREE.MeshLambertMaterial({ color: 0x2c3440 }));
        deck.position.y = 0.1;
        group.add(deck);
        const wheelG = new THREE.CylinderGeometry(0.11, 0.11, 0.07, 9);
        wheelG.rotateZ(Math.PI / 2);
        const wheelM = new THREE.MeshLambertMaterial({ color: 0x15171c });
        for (const sz of [0.5, -0.5]) {
          const w = new THREE.Mesh(wheelG, wheelM);
          w.position.set(0, 0.11, sz);
          group.add(w);
        }
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 6),
          new THREE.MeshLambertMaterial({ color: 0x9aa2ac }));
        stem.position.set(0, 0.55, 0.56);
        stem.rotation.x = 0.18;
        group.add(stem);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.06), stem.material);
        bar.position.set(0, 1.0, 0.65);
        group.add(bar);
      }
      this.placeOnSidewalk(ped);
      ped.tx = ped.x; ped.tz = ped.z;
      this.peds.push(ped);
    }
    // Ambient life from the first frame: a few residents already sit on
    // benches and browse the boardwalk stalls, so no screenshot — and no
    // first minute of play — ever catches a city of mannequins.
    let seated = 0;
    for (const spot of this.world.benchSpots) {
      if (seated >= 4) break;
      if (this.rng() < 0.45) continue;
      const ped = this.peds.find((p) => !p.staged && !p.scooter && p.state !== 'fallen');
      if (!ped) break;
      this.seatAt(ped, spot);
      seated++;
    }
    let browsing = 0;
    for (const spot of this.world.stallSpots) {
      if (browsing >= 3) break;
      const ped = this.peds.find((p) => !p.staged && !p.scooter && p.state !== 'fallen');
      if (!ped) break;
      ped.staged = true;
      ped.state = 'browse';
      ped.x = spot.x + rand(this.rng, -1.6, 1.6);
      ped.z = 235.2;
      ped.heading = 0; // facing the stall and its goods
      ped.group.position.set(ped.x, 0, ped.z);
      ped.group.rotation.y = 0;
      browsing++;
    }
  }

  // Park a pedestrian on a bench: seated pose, facing the bench's view.
  seatAt(ped, spot) {
    ped.staged = true;
    ped.state = 'sit';
    ped.x = spot.x; ped.z = spot.z;
    ped.heading = spot.heading;
    ped.group.position.set(spot.x, -0.08, spot.z);
    ped.group.rotation.y = spot.heading;
  }

  // Screenshot staging: seat pedestrians on the benches nearest a point.
  stageSitters(nearX, nearZ, n) {
    const spots = [...this.world.benchSpots]
      .sort((a, b) => dist2D(nearX, nearZ, a.x, a.z) - dist2D(nearX, nearZ, b.x, b.z));
    let placed = 0;
    for (const spot of spots) {
      if (placed >= n) break;
      const ped = this.peds.find((p) => !p.staged && !p.scooter && p.state !== 'fallen');
      if (!ped) break;
      this.seatAt(ped, spot);
      placed++;
    }
  }

  // Screenshot staging: browsers standing at a spot, facing a heading —
  // a market stall front, a shop window, the marina rail.
  stageBrowsers(x, z, n, heading) {
    let placed = 0;
    for (const ped of this.peds) {
      if (placed >= n) break;
      if (ped.staged || ped.scooter || ped.state === 'fallen') continue;
      ped.staged = true;
      ped.state = 'browse';
      ped.x = x + (placed - (n - 1) / 2) * 1.7;
      ped.z = z + (placed % 2 ? 0.5 : -0.3);
      ped.heading = heading;
      ped.group.position.set(ped.x, 0, ped.z);
      ped.group.rotation.y = heading;
      placed++;
    }
  }

  // Screenshot staging: pedestrians mid-crossing, walking a straight line
  // across a road in direction (dx, dz) — crosswalk traffic, not props.
  stageCrossers(x, z, n, dx, dz) {
    let placed = 0;
    for (const ped of this.peds) {
      if (placed >= n) break;
      if (ped.staged || ped.scooter || ped.state === 'fallen') continue;
      ped.staged = true;
      ped.state = 'wander';
      ped.x = x + (placed - (n - 1) / 2) * 2.1 * (dz !== 0 ? 1 : 0.3);
      ped.z = z + (placed - (n - 1) / 2) * 2.1 * (dx !== 0 ? 1 : 0.3);
      ped.tx = ped.x + dx * 38;
      ped.tz = ped.z + dz * 38;
      ped.heading = Math.atan2(dx, dz);
      ped.group.position.set(ped.x, 0, ped.z);
      ped.group.rotation.y = ped.heading;
      placed++;
    }
  }

  // Screenshot staging: a scooter rider gliding through the frame.
  stageScooter(x, z, heading) {
    const ped = this.peds.find((p) => p.scooter && !p.staged && p.state !== 'fallen');
    if (!ped) return;
    ped.staged = true;
    ped.state = 'wander';
    ped.x = x; ped.z = z;
    ped.heading = heading;
    ped.tx = x + Math.sin(heading) * 70;
    ped.tz = z + Math.cos(heading) * 70;
    ped.group.position.set(x, 0.13, z);
    ped.group.rotation.y = heading;
  }

  placeOnSidewalk(ped) {
    if (this.rng() < 0.22) {
      // The Strand: stroll the promenade, the boardwalk or the sand.
      ped.x = rand(this.rng, -212, 212);
      ped.z = pick(this.rng, [214, 222, 232, 248]) + rand(this.rng, -3, 4);
      ped.group.position.set(ped.x, 0, ped.z);
      // Beachgoers carry their board; it stays home on inland spawns.
      if (!ped.board && this.rng() < 0.4) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.9, 0.07),
          new THREE.MeshLambertMaterial({ color: pick(this.rng, BOARD_COLORS) }));
        board.position.set(0.5, 1.18, 0);
        board.rotation.z = 0.1;
        ped.group.add(board);
        ped.board = board;
      }
      if (ped.board) ped.board.visible = true;
      return;
    }
    if (ped.board) ped.board.visible = false;
    const cx = pick(this.rng, BLOCK_CENTERS);
    const cz = pick(this.rng, BLOCK_CENTERS);
    const edge = 24 + this.rng() * 3;
    ped.x = cx + (this.rng() > 0.5 ? edge : -edge) + rand(this.rng, -14, 14);
    ped.z = cz + (this.rng() > 0.5 ? edge : -edge) + rand(this.rng, -14, 14);
    ped.group.position.set(ped.x, 0, ped.z);
  }

  // Down a pedestrian from outside (a punch, a shot): the law notices
  // through the same hitEvents counter the main loop already polls.
  forceFall(ped) {
    if (ped.state === 'fallen') return;
    ped.state = 'fallen';
    ped.timer = 6;
    ped.group.rotation.x = -Math.PI / 2;
    ped.group.position.y = 0.25;
    this.hitEvents++;
  }

  // Screenshot staging: gather a crowd around a point. A ped already
  // staged by an earlier call keeps its post, so crowds accumulate.
  stageCrowd(x, z, n, radius = 12) {
    let placed = 0;
    for (const ped of this.peds) {
      if (placed >= n) break;
      if (ped.state === 'fallen' || ped.staged) continue;
      ped.staged = true;
      ped.x = clamp(x + rand(this.rng, -radius, radius), -216, 216);
      ped.z = clamp(z + rand(this.rng, -radius, radius), -216, 246);
      ped.group.position.set(ped.x, 0, ped.z);
      this.pickTarget(ped);
      placed++;
    }
  }

  pickTarget(ped) {
    ped.tx = clamp(ped.x + rand(this.rng, -70, 70), -214, 214);
    ped.tz = clamp(ped.z + rand(this.rng, -70, 70), -214, 232);
  }

  update(dt, t, threats, playerCar) {
    for (const ped of this.peds) {
      const g = ped.group;
      if (ped.state === 'fallen') {
        ped.timer -= dt;
        if (ped.timer <= 0) {
          ped.state = 'wander';
          g.rotation.x = 0;
          this.placeOnSidewalk(ped);
          this.pickTarget(ped);
        }
        continue;
      }
      // Seated on a bench: legs folded, arms resting, a slight sway —
      // a person watching the bay go by, not a walker paused mid-stride.
      if (ped.state === 'sit') {
        const [aL, aR, lL, lR] = g.userData.limbs;
        lL.rotation.x = -0.95; lR.rotation.x = -0.88;
        aL.rotation.x = -0.5 + Math.sin(t * 0.9 + ped.phase) * 0.05;
        aR.rotation.x = -0.45 + Math.cos(t * 0.7 + ped.phase) * 0.05;
        g.position.set(ped.x, -0.08, ped.z);
        g.rotation.set(0, ped.heading, Math.sin(t * 0.9 + ped.phase) * 0.03);
        continue;
      }
      // Browsing a stall: standing at the goods, one arm raised to them,
      // a small shopper's bob as they weigh up a purchase.
      if (ped.state === 'browse') {
        const [aL, aR, lL, lR] = g.userData.limbs;
        lL.rotation.x = 0.04; lR.rotation.x = -0.04;
        aL.rotation.x = -0.65 + Math.sin(t * 1.1 + ped.phase) * 0.07;
        aR.rotation.x = -0.18;
        g.position.set(ped.x, 0.02 + 0.02 * Math.sin(t * 1.3 + ped.phase), ped.z);
        g.rotation.set(0, ped.heading, 0);
        continue;
      }
      // Flee the nearest fast, close car.
      let fleeX = 0, fleeZ = 0, fleeing = false;
      for (const car of threats) {
        const d = dist2D(ped.x, ped.z, car.x, car.z);
        if (d < 10 && Math.abs(car.speed) > 7) {
          fleeX = (ped.x - car.x) / (d || 1);
          fleeZ = (ped.z - car.z) / (d || 1);
          fleeing = true;
          break;
        }
      }
      let speed = 0;
      if (fleeing) {
        ped.state = 'flee';
        const want = Math.atan2(fleeX, fleeZ);
        ped.heading += wrapAngle(want - ped.heading) * Math.min(1, dt * 10);
        speed = 6.4;
      } else {
        if (ped.state === 'flee') { ped.state = 'wander'; this.pickTarget(ped); }
        const dx = ped.tx - ped.x, dz = ped.tz - ped.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) this.pickTarget(ped);
        else {
          const want = Math.atan2(dx, dz);
          ped.heading += wrapAngle(want - ped.heading) * Math.min(1, dt * 6);
          speed = ped.scooter ? 3.6 : 2.1; // scooters glide, walkers stroll
        }
      }
      ped.x += Math.sin(ped.heading) * speed * dt;
      ped.z += Math.cos(ped.heading) * speed * dt;
      const pos = { x: ped.x, z: ped.z };
      pushOutOfBoxes(pos, 0.55, this.world.colliders, null);
      ped.x = clamp(pos.x, -218, 218);
      ped.z = clamp(pos.z, -218, 246);
      g.position.set(ped.x, 0, ped.z);
      if (ped.scooter && ped.state !== 'fallen') g.position.y = 0.13; // feet on the deck
      g.rotation.y = ped.heading;
      const swing = ped.scooter ? 0
        : Math.sin(t * (speed > 3 ? 11 : 7) + ped.phase) * (speed > 0.1 ? 0.55 : 0.05);
      const [aL, aR, lL, lR] = g.userData.limbs;
      aL.rotation.x = swing; aR.rotation.x = -swing;
      lL.rotation.x = -swing; lR.rotation.x = swing;

      // Clipped by the player's car: down, and the law takes note.
      if (playerCar && Math.abs(playerCar.speed) > 5.5 &&
          dist2D(ped.x, ped.z, playerCar.x, playerCar.z) < 1.95) {
        ped.state = 'fallen';
        ped.timer = 4.5;
        g.rotation.x = -Math.PI / 2;
        g.position.y = 0.25;
        this.hitEvents++;
      } else if (g.position.y !== 0 && !ped.scooter) {
        g.position.y = 0;
      }
    }
  }
}
