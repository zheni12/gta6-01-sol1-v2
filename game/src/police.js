// ── police.js — the wanted system: stars, pursuit units, helicopter.
// Exports: PoliceSystem (addCrime/setStars, per-frame update, unitsInfo
// for the HUD). Fed by combat.js gunfire, main.js crashes and crew.js
// ghost plates; it calls back into G.hurtPlayer and G.onBusted.
// The law: a 1–5 star wanted level. Patrol cars cruise the grid while
// the city is calm; once stars rise, named units with set roles pursue —
// rammers, flankers, pursuit drivers — a helicopter joins at 4 stars and
// roadblocks roll out at 5. Standing close and slow fills the BUSTED
// meter. Every unit carries a callsign the HUD response panel lists.

import { CITY_EDGE, ROAD_LINES, clamp, dist2D, wrapAngle } from './config.js';
import { Car } from './vehicles.js';
import { pushOutOfBoxes } from './world.js';

const CALLSIGNS = ['KESTREL', 'OSPREY', 'FALCON', 'HERON', 'IBIS', 'MARLIN', 'CONDOR', 'EGRET'];
const ROLES = ['RAMMER', 'FLANKER', 'PURSUIT', 'INTERCEPT', 'SHORE PATROL'];
const PATROL_ROUTE = [[-128, -128], [128, -128], [128, 128], [-128, 128]];

export class PoliceSystem {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.stars = 0;          // float; the HUD shows the ceiling
    this.cars = [];
    this.time = 0;
    this.lastCrimeT = -99;
    this.spawnT = 0;
    this.busted = 0;         // 0 … 1
    this.nearestDist = 999;
    this.unitSeq = 0;
    this.blockT = 0;         // roadblock respawn cooldown
    this.ghostT = 0;         // crew ghost-plates: spawns held while > 0
    this.heliStage = null;   // screenshot staging: fixed heli offset
    this.buildHelicopter();
  }

  buildHelicopter() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x22262e });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 5.2), bodyMat);
    g.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x9fd8ff }));
    glass.position.set(0, 0.1, 2.2);
    g.add(glass);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4.6), bodyMat);
    tail.position.set(0, 0.3, -4.4);
    g.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x11131a }));
    rotor.position.y = 1.15;
    g.add(rotor);
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.3), rotor.material);
    tailRotor.position.set(0.35, 0.3, -6.6);
    g.add(tailRotor);
    // Visible spotlight cone plus a real spotlight aimed at the player.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(9, 38, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff2b0, transparent: true, opacity: 0.13,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    cone.position.y = -19.5;
    g.add(cone);
    const spot = new THREE.SpotLight(0xfff6c9, 1.6, 120, 0.42, 0.5, 0.5);
    g.add(spot);
    g.add(spot.target);
    spot.position.set(0, 0, 0);
    this.heli = { group: g, rotor, spot, cone };
    g.visible = false;
    this.scene.add(g);
  }

  addCrime(amount) {
    this.stars = clamp(this.stars + amount, 0, 5);
    this.lastCrimeT = this.time;
  }

  setStars(n) {
    this.stars = clamp(n, 0, 5);
    this.lastCrimeT = this.time;
  }

  get starsInt() { return Math.ceil(this.stars); }

  // The one-line summary the HUD prints under the stars.
  responseLabel() {
    const s = this.starsInt;
    if (s <= 0) return '';
    if (s === 1) return 'PURSUIT ACTIVE';
    if (s === 2) return 'UNITS RESPONDING';
    if (s === 3) return 'FELONY PURSUIT';
    if (s === 4) return 'AIR UNIT DEPLOYED';
    return 'ROADBLOCKS OUT · AIR UNIT UP';
  }

  // Live unit list for the HUD response panel, nearest first.
  unitsInfo() {
    const px = this.G.focusX, pz = this.G.focusZ;
    return this.cars
      .map((c) => ({
        callsign: c.callsign || 'UNIT',
        // System roadblocks read ROADBLOCK; a staged cruiser holding a
        // shoulder (screenshot scenes) keeps its own pursuit role.
        role: c.mode === 'block' ? (c.autoBlock ? 'ROADBLOCK' : (c.role || 'INTERCEPT'))
          : c.mode === 'patrol' ? 'PATROL' : (c.role || 'PURSUIT'),
        dist: Math.round(dist2D(px, pz, c.x, c.z)),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 6);
  }

  spawnPoint(px, pz) {
    // A road intersection at least ~60 units away from the player.
    let best = null, bestD = -1;
    for (let tries = 0; tries < 8; tries++) {
      const x = ROAD_LINES[Math.floor(Math.random() * ROAD_LINES.length)];
      const z = ROAD_LINES[Math.floor(Math.random() * ROAD_LINES.length)];
      const d = dist2D(px, pz, x, z);
      if (d > 55 && d < 110) return { x, z };
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    return best || { x: 0, z: -192 };
  }

  spawnAt(x, z, heading, mode = 'pursuit') {
    const car = new Car(this.scene, 0xf5f6fa, 'police');
    car.setPos(x, z, heading || 0);
    const n = this.unitSeq++;
    car.callsign = `${CALLSIGNS[n % CALLSIGNS.length]}-${1 + (n % 4)}`;
    car.role = ROLES[n % ROLES.length];
    car.mode = mode;
    car.wpIdx = n % PATROL_ROUTE.length;
    car.stuckT = 0;
    car.ramT = 0;
    car.hitT = 0;
    car.deadT = 0;
    car.lastX = x; car.lastZ = z;
    this.cars.push(car);
    return car;
  }

  removeCar(car) {
    car.dispose(this.scene);
    this.cars.splice(this.cars.indexOf(car), 1);
  }

  // Two cruisers parked nose-across the road ahead of the player.
  spawnRoadblock(px, pz, heading) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const ax = clamp(px + fx * 58, -205, 205);
    const az = clamp(pz + fz * 58, -205, 240);
    for (const side of [-2.4, 2.4]) {
      const bx = ax - fz * side, bz = az + fx * side;
      const car = this.spawnAt(bx, bz, heading + Math.PI / 2 + (side > 0 ? 0.3 : -0.3), 'block');
      car.autoBlock = true; // the system cleans up only its own roadblocks
      car.speed = 0;
    }
  }

  update(dt) {
    this.time += dt;
    const G = this.G;
    const px = G.focusX, pz = G.focusZ;
    const pSpeed = G.focusSpeed;
    if (G.eyesOutT > 0) G.eyesOutT -= dt;
    if (this.ghostT > 0) this.ghostT -= dt;
    const spawnsHeld = this.holdSpawns || this.ghostT > 0;

    // Decay: no crime lately and nobody close enough to see you. A
    // lookout's "eyes out" call makes the heat bleed off far faster.
    this.nearestDist = 999;
    for (const c of this.cars) this.nearestDist = Math.min(this.nearestDist, dist2D(px, pz, c.x, c.z));
    if (this.stars > 0 && this.time - this.lastCrimeT > 7 && this.nearestDist > 55) {
      const rate = G.eyesOutT > 0 ? 0.3 : 0.055;
      this.stars = Math.max(0, this.stars - dt * rate);
      if (this.stars === 0) this.busted = 0;
    }

    // Maintain the force the star level calls for.
    const wantPursuit = this.stars <= 0 ? 0 : Math.min(1 + Math.ceil(this.stars), 5);
    this.spawnT -= dt;
    this.blockT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.1;
      const pursuit = this.cars.filter((c) => c.mode === 'pursuit');
      const patrols = this.cars.filter((c) => c.mode === 'patrol');
      if (this.stars > 0) {
        for (const p of patrols) p.mode = 'pursuit'; // patrols join the chase
        if (pursuit.length + patrols.length < wantPursuit && !spawnsHeld) {
          const s = this.spawnPoint(px, pz);
          this.spawnAt(s.x, s.z, Math.atan2(px - s.x, pz - s.z));
        } else if (pursuit.length > wantPursuit) {
          let far = null, farD = -1;
          for (const c of pursuit) {
            const d = dist2D(px, pz, c.x, c.z);
            if (d > farD) { farD = d; far = c; }
          }
          if (far && farD > 90) this.removeCar(far);
        }
      } else if (!spawnsHeld && patrols.length < 2) {
        // A calm city still shows the law: two cruisers on the grid.
        const s = this.spawnPoint(px, pz);
        this.spawnAt(s.x, s.z, 0, 'patrol');
      }
      // Roadblocks belong to 5 stars only.
      const blocks = this.cars.filter((c) => c.mode === 'block' && c.autoBlock);
      if (this.stars >= 5 && !spawnsHeld) {
        if (blocks.length < 2 && this.blockT <= 0) {
          this.spawnRoadblock(px, pz, G.focusHeading);
          this.blockT = 14;
        }
      } else {
        for (const b of blocks) this.removeCar(b);
      }
    }

    const maxPursuit = 41 + this.stars * 3.4;
    for (const car of [...this.cars]) {
      const d = dist2D(px, pz, car.x, car.z);
      car.hitT = Math.max(0, (car.hitT || 0) - dt);

      if (car.wrecked) {
        // A wrecked unit stops, smokes, and is towed off the board.
        car.speed = Math.max(0, car.speed - 40 * dt);
        car.group.position.x += Math.sin(car.heading) * car.speed * dt;
        car.group.position.z += Math.cos(car.heading) * car.speed * dt;
        car.syncMesh(dt);
        car.deadT += dt;
        if (car.deadT > 6) this.removeCar(car);
        continue;
      }

      let tx, tz, target;
      if (car.mode === 'block') {
        target = 0; // a roadblock holds its ground, lights rolling
        tx = car.x; tz = car.z;
        car.speed = Math.max(0, car.speed - 40 * dt);
      } else if (car.mode === 'patrol') {
        const wp = PATROL_ROUTE[car.wpIdx % PATROL_ROUTE.length];
        tx = wp[0]; tz = wp[1];
        target = 16;
        if (dist2D(car.x, car.z, tx, tz) < 8) car.wpIdx++;
      } else if (car.followOffset && G.playerCar) {
        // Staged formation (screenshot scenes): hold a trailing offset from
        // the player's car instead of hunting it.
        const h = G.playerCar.heading;
        const fx2 = Math.sin(h), fz2 = Math.cos(h);
        tx = px - fx2 * car.followOffset.back - fz2 * car.followOffset.side;
        tz = pz - fz2 * car.followOffset.back + fx2 * car.followOffset.side;
        target = clamp(Math.abs(pSpeed) + dist2D(tx, tz, car.x, car.z) * 0.7, 0, 36);
      } else {
        const lead = clamp(d / 40, 0, 0.7);
        tx = px + G.focusVelX * lead;
        tz = pz + G.focusVelZ * lead;
        target = maxPursuit;
        if (car.role === 'RAMMER') target = maxPursuit + 2.5;
        if (car.role === 'FLANKER') {
          // Flankers aim beside the player, not at them.
          tx += -G.focusVelZ * 0.35 + 6;
          tz += G.focusVelX * 0.35;
        }
        if (car.speedCap) target = Math.min(target, car.speedCap);
        if (d < 16) target = Math.min(target, Math.abs(pSpeed) + 12);
        if (d < 7) target = Math.min(target, Math.abs(pSpeed) + 3);
      }
      const want = Math.atan2(tx - car.x, tz - car.z);
      const dh = wrapAngle(want - car.heading);
      car.heading += clamp(dh, -2.3 * dt, 2.3 * dt);
      car.speed += clamp(target - car.speed, -34 * dt, 26 * dt);
      const pos = { x: car.x + Math.sin(car.heading) * car.speed * dt, z: car.z + Math.cos(car.heading) * car.speed * dt };
      const vel = { x: Math.sin(car.heading) * car.speed, z: Math.cos(car.heading) * car.speed };
      pushOutOfBoxes(pos, car.radius, G.world.colliders, vel);
      pos.x = clamp(pos.x, -CITY_EDGE, CITY_EDGE);
      pos.z = clamp(pos.z, -CITY_EDGE, 250); // 250: units may chase onto the shore
      // Separation: never interpenetrate the player's car or another unit.
      const others = G.playerCar && G.inCar ? [G.playerCar, ...this.cars] : this.cars;
      for (const o of others) {
        if (o === car) continue;
        const dx = pos.x - o.x, dz = pos.z - o.z;
        const dd = Math.hypot(dx, dz);
        if (dd > 0.01 && dd < 3.3) {
          pos.x = o.x + (dx / dd) * 3.3;
          pos.z = o.z + (dz / dd) * 3.3;
        }
      }
      car.group.position.set(pos.x, 0, pos.z);
      car.vel.x = vel.x; car.vel.z = vel.z;
      car.syncMesh(dt);
      // Flash the light bar.
      const lights = car.group.userData.barLights;
      if (lights) {
        const phase = Math.floor(this.time * 6 + car.id) % 2;
        lights[0].material.color.setHex(phase ? 0xff2222 : 0x551111);
        lights[1].material.color.setHex(phase ? 0x112255 : 0x2266ff);
      }
      // Stuck against a wall? Re-deploy nearer the action (pursuit only).
      car.stuckT += dt;
      if (car.stuckT > 2.5) {
        car.stuckT = 0;
        if (car.mode === 'pursuit' && dist2D(car.lastX, car.lastZ, car.x, car.z) < 1.2 && d > 25) {
          const s = this.spawnPoint(px, pz);
          car.setPos(s.x, s.z, Math.atan2(px - s.x, pz - s.z));
          car.speed = 12;
        }
        car.lastX = car.x; car.lastZ = car.z;
      }
      // The ram: a shove with a cooldown, so contact rattles the player's
      // car instead of launching it.
      car.ramT = Math.max(0, (car.ramT || 0) - dt);
      if (G.playerCar && car.ramT <= 0 && dist2D(car.x, car.z, G.playerCar.x, G.playerCar.z) < 3.4) {
        const pc = G.playerCar;
        const dx = pc.x - car.x, dz = pc.z - car.z;
        const dd = Math.hypot(dx, dz) || 1;
        pc.vel.x += (dx / dd) * 7;
        pc.vel.z += (dz / dd) * 7;
        car.ramT = 0.6;
        this.lastCrimeT = this.time; // contact keeps the heat on
      }
      // Running down a suspect on foot hurts — and the crew notices.
      if (!G.inCar && G.hurtPlayer && car.mode === 'pursuit' && car.hitT <= 0 &&
          Math.abs(car.speed) > 6 && d < 2.4) {
        G.hurtPlayer(9);
        car.hitT = 1.2;
      }
    }

    // Helicopter from 4 stars: orbits the player, spotlight pinned on them.
    const heliOn = this.stars >= 4;
    this.heli.group.visible = heliOn;
    if (heliOn) {
      const h = this.heli;
      let ox, oz, oy = 37;
      if (this.heliStage) {
        ox = px + this.heliStage.dx;
        oz = pz + this.heliStage.dz;
        oy = this.heliStage.dy || 16;
      } else {
        ox = px + Math.sin(this.time * 0.35) * 16;
        oz = pz + Math.cos(this.time * 0.35) * 16;
      }
      h.group.position.set(ox, oy, oz);
      h.group.rotation.y = Math.atan2(px - ox, pz - oz);
      h.rotor.rotation.y += dt * 28;
      // The cone is modelled 38 tall; squash it when staged low for shots.
      const coneScale = oy / 37;
      h.cone.scale.set(1, coneScale, 1);
      h.cone.position.y = -19.5 * coneScale;
      h.spot.target.position.set(px - ox, -oy, pz - oz);
      h.cone.rotation.x = clamp((px - ox) / oy, -0.4, 0.4);
      h.cone.rotation.z = clamp(-(pz - oz) / oy, -0.4, 0.4);
    }

    // BUSTED: close officers + a slow or stopped player.
    if (this.stars > 0 && this.nearestDist < 10.5 && Math.abs(pSpeed) < 3.2) {
      this.busted = clamp(this.busted + dt / 2.6, 0, 1);
      if (this.busted >= 1) {
        this.busted = 0;
        G.onBusted();
      }
    } else {
      this.busted = clamp(this.busted - dt * 1.4, 0, 1);
    }
  }
}
