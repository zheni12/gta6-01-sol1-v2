// ── vehicles.js — every car: meshes, player driving, traffic, parking.
// Exports: makeCarMesh, makeBlobShadow, Car, TrafficCar, updatePlayerCar,
// spawnParkedCars, nearestEnterable. police.js and missions.js build
// their special cars from Car; pedestrians.js borrows the blob shadow;
// main.js drives the player car through updatePlayerCar.
// Cars: procedural meshes, the player's arcade driving physics, traffic
// cars that circulate the block grid, and the parked cars waiting to be
// borrowed. Every car shares the Car shape: group, heading, vel, speed.

import { CAR_MODELS, CITY_EDGE, clamp, dist2D, rand, wrapAngle } from './config.js';
import { pushOutOfBoxes } from './world.js';

let nextCarId = 1;

const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.34, 12);
wheelGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.36, 10);
hubGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x15171c });
const hubMat = new THREE.MeshLambertMaterial({ color: 0xb9c1ca });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x101a28 });
const trimMat = new THREE.MeshLambertMaterial({ color: 0x22262e });
const seatMat = new THREE.MeshLambertMaterial({ color: 0x3a2e28 });

const smokeMat = new THREE.MeshBasicMaterial({ color: 0x555b63, transparent: true, opacity: 0.42, depthWrite: false });

// A soft dark ellipse on the ground under every car, so it sits IN the
// street instead of floating over flat colour.
const blobGeo = new THREE.CircleGeometry(1, 20);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.3, depthWrite: false });
export function makeBlobShadow(rx, rz) {
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(rx, rz, 1);
  m.position.y = 0.045;
  m.renderOrder = 1;
  return m;
}

function taxiSignTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd94a'; g.fillRect(0, 0, 128, 32);
  g.font = 'bold 23px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#1c1c22';
  g.fillText('TAXI', 64, 17);
  return new THREE.CanvasTexture(c);
}
let taxiTex = null;

export function makeCarMesh(color, kind, style = 'car') {
  const g = new THREE.Group();
  g.add(makeBlobShadow(1.35, 2.75));
  const paint = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.35), paint);
  body.position.y = 0.58;
  g.add(body);
  // The repaint handle: scenes recolor the hero/target car through this,
  // never through child indices (the blob shadow sits at index 0 now).
  g.userData.body = body;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.3, 0.7), paint);
  nose.position.set(0, 0.44, 2.05);
  g.add(nose);
  // Dark bumpers front and rear.
  for (const sz of [2.22, -2.22]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.2, 0.16), trimMat);
    bumper.position.set(0, 0.36, sz);
    g.add(bumper);
  }
  // Two-tone paint: a darker shade of the same colour bands the lower
  // body, so every car reads as styled sheet metal, not a painted brick.
  const shade = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color).multiplyScalar(0.64),
  });
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.24, 4.3), shade);
  skirt.position.y = 0.3;
  g.add(skirt);
  if (style !== 'van') {
    // Sloped hood and trunk decks: wedges pitched so the nose dives and
    // the tail falls away — the silhouette of a car, not a loaf.
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.14, 1.25), paint);
    hood.position.set(0, 0.7, 1.5);
    hood.rotation.x = 0.15;
    g.add(hood);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.14, 1.0), paint);
    trunk.position.set(0, 0.76, -1.65);
    trunk.rotation.x = -0.1;
    g.add(trunk);
  }
  // Wing mirrors on little stalks, whatever the silhouette.
  for (const sx of [-1.02, 1.02]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.2), trimMat);
    mirror.position.set(sx, style === 'van' ? 1.18 : 1.04, style === 'van' ? 0.72 : 0.55);
    g.add(mirror);
  }
  if (style === 'sport') {
    // A rear wing on two pylons, finished in the darker shade.
    for (const sx of [-0.62, 0.62]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.09), trimMat);
      pylon.position.set(sx, 1.0, -1.95);
      g.add(pylon);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.07, 0.44), shade);
    wing.position.set(0, 1.15, -1.98);
    wing.rotation.x = -0.06;
    g.add(wing);
  }
  if (style === 'convertible') {
    // Open top: a low glass windshield, two seats, no roof at all.
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.42, 0.09), glassMat);
    shield.position.set(0, 1.0, 0.62);
    shield.rotation.x = -0.28;
    g.add(shield);
    for (const sx of [-0.42, 0.42]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 0.55), seatMat);
      seat.position.set(sx, 0.92, -0.35);
      g.add(seat);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 1.15), paint);
    deck.position.set(0, 0.9, -1.45);
    g.add(deck);
  } else if (style !== 'van') {
    // A dark glass canopy with a thin painted roof over it — cruisers
    // included, so every car reads glass-and-metal, not a painted box.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.52, 2.0), glassMat);
    cabin.position.set(0, 1.08, -0.25);
    g.add(cabin);
    // Raked glass front and rear, leaning into the canopy so the cabin
    // reads as shaped glazing instead of a plain block.
    const shieldF = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.54, 0.07), glassMat);
    shieldF.position.set(0, 1.1, 0.78);
    shieldF.rotation.x = -0.32;
    g.add(shieldF);
    const shieldR = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.07), glassMat);
    shieldR.position.set(0, 1.1, -1.28);
    shieldR.rotation.x = 0.3;
    g.add(shieldR);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.09, 1.25), paint);
    roof.position.set(0, 1.37, -0.3);
    g.add(roof);
    if (style === 'taxi') {
      if (!taxiTex) taxiTex = taxiSignTexture();
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.26, 0.36),
        new THREE.MeshBasicMaterial({ map: taxiTex }));
      sign.position.set(0, 1.55, -0.3);
      g.add(sign);
    }
  }
  if (style === 'van') {
    // A tall cargo box over the rear two-thirds: the Bantam Van silhouette.
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.92, 1.15, 2.9), paint);
    box.position.set(0, 1.15, -0.72);
    g.add(box);
    // A glass windshield for the cab, ahead of the cargo box.
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.5, 0.1), glassMat);
    shield.position.set(0, 1.02, 0.78);
    shield.rotation.x = -0.15;
    g.add(shield);
  } else if (style === 'pickup') {
    // Low bed walls behind the cab: the Tern Pickup silhouette.
    for (const sx of [-0.86, 0.86]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 1.9), paint);
      wall.position.set(sx, 0.95, -1.25);
      g.add(wall);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.42, 0.14), paint);
    tail.position.set(0, 0.95, -2.18);
    g.add(tail);
  }
  // Damage smoke: a soft dark puff over the hood, scaled by the Car.
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), smokeMat);
  smoke.position.set(0, 1.25, 1.6);
  smoke.visible = false;
  g.add(smoke);
  g.userData.smoke = smoke;
  if (kind === 'police') {
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.3, 1.6), trimMat);
    band.position.set(0, 0.6, -0.2);
    g.add(band);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 0.46), trimMat);
    bar.position.set(0, 1.44, -0.25);
    g.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.32, 1.46, -0.25);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.set(0.32, 1.46, -0.25);
    g.add(blue);
    g.userData.barLights = [red, blue];
  }
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const sx of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), hl);
    h.position.set(sx, 0.62, 2.19);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xff3344 }));
    t.position.set(sx, 0.64, -2.19);
    g.add(t);
  }
  const wheels = [];
  const frontPivots = [];
  for (const [sx, sz] of [[-0.97, 1.45], [0.97, 1.45], [-0.97, -1.45], [0.97, -1.45]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.4, sz);
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    const hub = new THREE.Mesh(hubGeo, hubMat); // a pale hubcap that spins with the wheel
    w.add(hub);
    pivot.add(w);
    g.add(pivot);
    wheels.push(w);
    if (sz > 0) frontPivots.push(pivot);
  }
  g.userData.wheels = wheels;
  g.userData.frontPivots = frontPivots;
  return g;
}

// Silhouette follows the model: the van is a van, the roadster has no top,
// the little Pico works as a cab with a roof sign.
const STYLE_BY_MODEL = {
  'Bantam Van': 'van', 'Tern Pickup': 'pickup',
  'Corvina Roadster': 'convertible', 'Pico City': 'taxi',
  'Kestrel GT': 'sport', 'Sirocco Sport': 'sport',
};

export class Car {
  constructor(scene, color, kind) {
    this.id = nextCarId++;
    this.kind = kind;               // 'parked' | 'traffic' | 'police' | 'player'
    this.modelName = CAR_MODELS[(this.id - 1) % CAR_MODELS.length];
    this.style = kind === 'police' ? 'car' : (STYLE_BY_MODEL[this.modelName] || 'car');
    this.group = makeCarMesh(color, kind, this.style);
    this.heading = 0;
    this.vel = { x: 0, z: 0 };      // world velocity
    this.speed = 0;                 // signed forward speed
    this.radius = 1.85;
    this.owned = false;             // the player has taken this car before
    this.steerVis = 0;
    this.damage = 0;                // 0 = pristine … 1 = wrecked
    this.smokeT = Math.random() * 6;
    scene.add(this.group);
  }

  get wrecked() { return this.damage >= 1; }
  damagePercent() { return Math.round(clamp(this.damage, 0, 1) * 100); }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }
  setPos(x, z, heading) {
    this.group.position.set(x, 0, z);
    if (heading !== undefined) this.heading = heading;
    this.syncMesh(0);
  }

  syncMesh(dt) {
    this.group.rotation.y = this.heading;
    // Damage smoke puffs once a car is past half-wrecked, thicker as it dies.
    const smoke = this.group.userData.smoke;
    if (smoke) {
      if (this.damage > 0.45) {
        smoke.visible = true;
        this.smokeT += dt * 3;
        const s = 0.7 + (this.damage - 0.45) * 1.6 + Math.sin(this.smokeT) * 0.16;
        smoke.scale.set(s, s * (1.25 + Math.sin(this.smokeT * 1.7) * 0.2), s);
        smoke.position.y = 1.25 + (this.smokeT % 1) * 0.35;
      } else {
        smoke.visible = false;
      }
    }
    if (dt > 0) {
      const spin = (this.speed * dt) / 0.4;
      for (const w of this.group.userData.wheels) w.rotation.x += spin;
      for (const p of this.group.userData.frontPivots) p.rotation.y = this.steerVis * 0.42;
    }
  }

  dispose(scene) { scene.remove(this.group); }
}

// The player's driving: throttle/brake/reverse, speed-sensitive steering,
// and a lateral-velocity grip model so the handbrake breaks the rear loose.
// Returns the hardest building impact speed this step (0 = no hit).
export function updatePlayerCar(car, dt, input, colliders) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let fwd = car.vel.x * fx + car.vel.z * fz;
  let latX = car.vel.x - fx * fwd;
  let latZ = car.vel.z - fz * fwd;

  const up = input.isDown('KeyW', 'ArrowUp');
  const down = input.isDown('KeyS', 'ArrowDown');
  const hand = input.isDown('Space');
  // A bent car pulls less and tops out lower; a wreck barely crawls.
  const dmgMul = car.damage >= 1 ? 0.3 : car.damage > 0.6 ? 0.65 : 1;
  if (up) fwd += 44 * dt * (fwd < 0 ? 2.4 : 1) * dmgMul;
  if (down) fwd -= (fwd > 0.6 ? 58 : 27) * dt;
  if (!up && !down) fwd -= fwd * 0.55 * dt;
  fwd -= fwd * 0.22 * dt;
  if (hand) fwd -= fwd * 1.1 * dt;
  fwd = clamp(fwd, -18, 56 * dmgMul);

  const steer = input.axis('KeyA', 'KeyD') + input.axis('ArrowLeft', 'ArrowRight');
  const steerClamped = clamp(steer, -1, 1);
  car.steerVis = -steerClamped;
  const turnAuthority = clamp(fwd / 13, -1, 1);
  // Facing +z, the driver's right is -x, so a right turn decreases heading.
  car.heading -= steerClamped * 1.85 * turnAuthority * dt * (hand ? 1.3 : 1);

  const nfx = Math.sin(car.heading), nfz = Math.cos(car.heading);
  const grip = Math.exp(-(hand ? 1.7 : 9.5) * dt);
  latX *= grip; latZ *= grip;
  car.vel.x = nfx * fwd + latX;
  car.vel.z = nfz * fwd + latZ;
  car.speed = fwd;

  const pos = { x: car.x + car.vel.x * dt, z: car.z + car.vel.z * dt };
  const impact = pushOutOfBoxes(pos, car.radius, colliders, car.vel);
  pos.x = clamp(pos.x, -CITY_EDGE, CITY_EDGE);
  pos.z = clamp(pos.z, -CITY_EDGE, 250); // the beach and marina are drivable
  car.group.position.set(pos.x, 0, pos.z);
  car.syncMesh(dt);
  return impact;
}

// A traffic car loops the rectangle of road around one block, braking for
// anything solid ahead of it. Two lane offsets keep the directions apart.
export class TrafficCar extends Car {
  constructor(scene, color, cx, cz, dir, rng) {
    super(scene, color, 'traffic');
    this.cx = cx; this.cz = cz; this.dir = dir;
    this.half = dir > 0 ? 29.5 : 22.5;
    this.side = blockPerimeter(this.half) / 4;
    this.s = rand(rng, 0, blockPerimeter(this.half));
    this.cruise = rand(rng, 13, 20);
    this.speedNow = 0;
    this.place();
  }

  place() {
    const p = loopPoint(this, this.s);
    this.group.position.set(p.x, 0, p.z);
    this.heading = p.heading;
    this.syncMesh(0);
  }

  update(dt, obstacles) {
    if (this.wrecked) { // a wrecked car stays where it died, smoking
      this.speedNow = 0;
      this.speed = 0;
      this.syncMesh(dt);
      return;
    }
    let target = this.cruise;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const o of obstacles) {
      if (o === this) continue;
      const dx = o.x - this.x, dz = o.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 7 && (dx * fx + dz * fz) / (d || 1) > 0.45) { target = 0; break; }
      if (d < 4) { target = 0; break; }
    }
    const accel = target > this.speedNow ? 9 : 26;
    this.speedNow += clamp(target - this.speedNow, -accel * dt, accel * dt);
    this.s += this.dir * this.speedNow * dt;
    const per = blockPerimeter(this.half);
    this.s = ((this.s % per) + per) % per;
    const p = loopPoint(this, this.s);
    this.group.position.set(p.x, 0, p.z);
    const dh = wrapAngle(p.heading - this.heading);
    this.heading += dh * Math.min(1, dt * 7);
    this.speed = this.speedNow;
    this.syncMesh(dt);
  }
}

// Perimeter of the square traffic loop around a block (4 sides of 2·half).
function blockPerimeter(half) { return half * 8; }

// Point + heading at distance s along the block rectangle (counterclockwise
// for dir = 1 when seen from above with +x east and +z south).
function loopPoint(car, s) {
  const h = car.half, side = h * 2;
  const seg = Math.floor(s / side) % 4;
  const t = (s - seg * side) - h; // -h … +h along the segment
  switch (seg) {
    case 0: return { x: car.cx + t, z: car.cz - h, heading: Math.PI / 2 };        // north edge, east
    case 1: return { x: car.cx + h, z: car.cz + t, heading: 0 };                  // east edge, toward +z
    case 2: return { x: car.cx - t, z: car.cz + h, heading: -Math.PI / 2 };       // south edge, west
    default: return { x: car.cx - h, z: car.cz - t, heading: Math.PI };           // west edge, north
  }
}

// Parked cars placed on the world's parking spots, ready to be entered.
export function spawnParkedCars(scene, spots, colors, rng, count) {
  const cars = [];
  const shuffled = [...spots].sort(() => rng() - 0.5);
  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    const spot = shuffled[i];
    const car = new Car(scene, colors[i % colors.length], 'parked');
    car.setPos(spot.x + rand(rng, -0.5, 0.5), spot.z + rand(rng, -0.5, 0.5), spot.heading + rand(rng, -0.05, 0.05));
    cars.push(car);
  }
  return cars;
}

export function nearestEnterable(cars, x, z, maxDist) {
  let best = null, bestD = maxDist;
  for (const car of cars) {
    const d = dist2D(x, z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}
