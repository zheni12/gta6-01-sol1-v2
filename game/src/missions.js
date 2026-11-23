// ── missions.js — the seven story jobs plus endless courier work.
// Exports: MISSION_NAMES, Missions (stage machine: goto / steal / vanish
// / wreck / race). main.js calls update() per frame and is told about
// car entries; progress pays out through G.addCash/addRP/addStanding,
// and finished story jobs are graded into stats.js medals.
// The story of Ren Kadir, told as staged jobs for fixer Madame Okafor:
// steal, fetch, deliver hot, wreck a rival's car, race the Harbor Sprint,
// beat a clock, and run the Marina Job getaway. Every job is a chain of
// stages with dialogue; finishing a stage pays RP and earns standing in
// the district it ended in. After the story, endless courier jobs remain.

import { CITY_EDGE, clamp, dist2D, districtAt, wrapAngle } from './config.js';
import { Car } from './vehicles.js';
import { pushOutOfBoxes } from './world.js';

export const MISSION_NAMES = [
  'First Wheels',
  'Cross-Town Package',
  'Hot Delivery',
  'Wreck the Regent',
  'Harbor Sprint Cup',
  'The Clock Is Ticking',
  'The Marina Job',
];

const OKAFOR = { who: 'MADAME OKAFOR', color: '#ffc93c' };
const MIRA = { who: 'MIRA SOLANO', color: '#ff9f43' };
const KIKI = { who: 'KIKI AMARA', color: '#b78bff' };
const THEO = { who: 'THEO LINDQVIST', color: '#54c8ff' };

export class Missions {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.idx = 0;
    this.stageIdx = 0;
    this.timerLeft = null;
    this.gateIdx = 0;
    this.active = false;
    this.done = false;
    this.freeroam = false;
    this.jobSeq = 0;
    this.jobStages = null;
    this.wreckTarget = null;
    this.missionT = 0;      // seconds on the current story mission
    this.missionDamage = 0; // damage taken during it — medals grade on both
    this.defs = this.buildDefs();
    this.buildMarker();
    this.buildGates();
  }

  buildDefs() {
    const L = this.G.world.landmarks;
    const G = this.G;
    return [
      // 1 — steal the coupe, deliver it to the garage.
      [
        { kind: 'steal', text: 'Steal the marked teal coupe for Madame Okafor.', rp: 20,
          say: { ...OKAFOR, line: 'Ren. A teal Vireo coupe, parked uptown. Bring it to my garage — quietly.' } },
        { kind: 'goto', x: L.garage.x, z: L.garage.z, radius: 8, text: "Deliver the coupe to Okafor's Garage.", pay: 400, rp: 30,
          say: { ...MIRA, line: 'I know that coupe. Half the bay will report it — keep moving.' } },
      ],
      // 2 — a package across town, then a second stop at the hotel.
      [
        { kind: 'goto', x: L.packageSpot.x, z: L.packageSpot.z, radius: 7, text: 'Pick up the package at the north-west docks.', rp: 20,
          say: { ...OKAFOR, line: 'A package waits at the docks. No names, no questions, no scratches.' },
          onDone: () => G.toast('Package secured. Okafor is pleased.') },
        { kind: 'goto', x: L.hotel.x, z: L.hotel.z, radius: 8, text: 'Drop the package at Hotel Solmar, south entrance.', pay: 350, rp: 25,
          say: { ...KIKI, line: 'Hotel doorman is one of ours. Roll up slow, look rich.' } },
      ],
      // 3 — the drop is watched: deliver, then vanish at Palm Court.
      [
        { kind: 'goto', x: L.pickupSpot.x, z: L.pickupSpot.z, radius: 7, text: 'Collect the second package across town.', rp: 20,
          say: { ...OKAFOR, line: 'Same again, other side of the bay. This one pays better. It also bites.' },
          onDone: () => { G.police.setStars(3); G.toast('Ambush! The drop was watched — lose the heat and deliver!'); G.audio.blip('steal'); } },
        { kind: 'goto', x: L.safehouse.x, z: L.safehouse.z, radius: 8, text: 'Deliver to Palm Court while the heat is on you.', pay: 600, rp: 25,
          say: { ...MIRA, line: 'They are on us! Palm Court, now — I will run interference.' } },
        { kind: 'vanish', x: L.safehouse.x, z: L.safehouse.z, radius: 16, text: 'Lay low at Palm Court until the stars burn out.', pay: 250, rp: 30,
          say: { ...KIKI, line: 'Kill the engine and breathe. I will call it when the streets forget us.' } },
      ],
      // 4 — wreck the Regent before it reaches the marina, then vanish.
      [
        { kind: 'wreck', text: "Wreck Madame Okafor's rival's Regent before it reaches the marina.", rp: 35,
          say: { ...OKAFOR, line: 'A red Regent Luxe is running my money to the marina. See that it never arrives.' } },
        { kind: 'vanish', x: L.garage.x, z: L.garage.z, radius: 16, text: "Get back to Okafor's Garage and let the heat die.", pay: 900, rp: 35,
          say: { ...MIRA, line: 'It is done? Then run, Ren. Garage. Lights off. Radio silence.' } },
      ],
      // 5 — the Harbor Sprint checkpoint race.
      [
        { kind: 'race', text: 'Win the Harbor Sprint: hit every checkpoint before the clock dies.', time: 85, pay: 650, rp: 40,
          say: { ...THEO, line: 'Eight gates, one clock, my engine. Do not embarrass any of us.' },
          gates: [
            { x: -64, z: -64, heading: Math.PI / 2 }, { x: 0, z: -64, heading: Math.PI / 2 },
            { x: 64, z: -64, heading: Math.PI / 2 }, { x: 64, z: 0, heading: 0 },
            { x: 64, z: 64, heading: 0 }, { x: 0, z: 64, heading: -Math.PI / 2 },
            { x: -64, z: 64, heading: -Math.PI / 2 }, { x: -64, z: 0, heading: Math.PI },
          ] },
      ],
      // 6 — a timed run to the marina.
      [
        { kind: 'goto', x: L.marina.x, z: L.marina.z, radius: 9, text: 'Rush the documents to the marina — the boat will not wait.', time: 70, pay: 750, rp: 35,
          say: { ...OKAFOR, line: 'Documents. Marina. Seventy seconds of your best driving, Ren.' } },
      ],
      // 7 — the Marina Job: hit the bank at 5 stars, then run the bay.
      [
        { kind: 'goto', x: L.bank.x, z: L.bank.z, radius: 8, text: 'Hit Solmar Bank. Walk in, walk out rich.', rp: 30,
          say: { ...OKAFOR, line: 'Today we stop being couriers. The bank, Ren. Then the boat. Then legend.' },
          onDone: () => { G.police.setStars(5); G.toast('Alarm tripped! Every unit in Solmar Bay is coming.'); G.audio.blip('steal'); } },
        { kind: 'goto', x: L.marina.x, z: L.marina.z, radius: 9, text: 'GET TO THE MARINA. Do not stop for anyone.', pay: 2500, rp: 60,
          say: { ...KIKI, line: 'Roadblocks on the grid, bird in the sky — the pier is the only door left. GO.' } },
      ],
    ];
  }

  buildMarker() {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.3, 34, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc93c, transparent: true, opacity: 0.19,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 17;
    g.add(beam);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.16, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffc93c }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    g.add(ring);
    g.visible = false;
    this.marker = g;
    this.scene.add(g);
  }

  buildGates() {
    this.gateMeshes = [];
    const geo = new THREE.TorusGeometry(3.8, 0.3, 8, 22);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x8a6a1c }));
      m.visible = false;
      m.position.y = 3.4;
      this.scene.add(m);
      this.gateMeshes.push(m);
    }
  }

  currentStages() {
    return this.freeroam ? this.jobStages : this.defs[this.idx];
  }

  startAt(idx) {
    this.clearWreck();
    this.missionT = 0;
    this.missionDamage = 0;
    this.idx = idx;
    this.stageIdx = 0;
    this.done = false;
    this.freeroam = idx >= this.defs.length;
    if (this.freeroam) {
      this.genJob();
    }
    this.active = true;
    this.beginStage();
    if (!this.freeroam) this.G.toast(`New job: ${MISSION_NAMES[this.idx]}`);
  }

  // Endless paid work once the story is told: fetch, then deliver.
  genJob() {
    const L = this.G.world.landmarks;
    const spots = [L.packageSpot, L.hotel, L.bank, L.safehouse, L.garage, L.pickupSpot];
    const a = spots[this.jobSeq % spots.length];
    const b = spots[(this.jobSeq + 3) % spots.length];
    this.jobSeq++;
    const pay = 220 + Math.round(dist2D(a.x, a.z, b.x, b.z) * 0.9);
    this.jobStages = [
      { kind: 'goto', x: a.x, z: a.z, radius: 8, text: 'Pick up the courier package.', rp: 10,
        say: { ...OKAFOR, line: 'The bay always needs a driver, Ren. Fetch, deliver, repeat.' } },
      { kind: 'goto', x: b.x, z: b.z, radius: 8, text: 'Deliver the package across the bay.', pay, rp: 15 },
    ];
    this.stageIdx = 0;
  }

  stage() { return this.active ? this.currentStages()[this.stageIdx] : null; }

  beginStage() {
    const st = this.stage();
    this.timerLeft = st && st.time ? st.time : null;
    this.gateIdx = 0;
    this.refreshGates();
    if (st && st.kind === 'wreck') this.spawnWreckTarget();
    else this.clearWreck();
    if (st && st.say) this.G.hud.showDialogue(st.say.who, st.say.line, st.say.color, 5.2);
  }

  refreshGates() {
    const st = this.stage();
    const isRace = st && st.kind === 'race';
    this.gateMeshes.forEach((m, i) => {
      if (isRace && i < st.gates.length) {
        const gate = st.gates[i];
        m.visible = true;
        m.position.x = gate.x;
        m.position.z = gate.z;
        m.rotation.y = gate.heading;
        m.material.color.setHex(i === this.gateIdx ? 0x39e75f : i < this.gateIdx ? 0x1c4d2a : 0x8a6a1c);
      } else {
        m.visible = false;
      }
    });
  }

  // The Regent: a dark-red Luxe that runs a fixed route to the marina.
  spawnWreckTarget() {
    this.clearWreck();
    const L = this.G.world.landmarks;
    const car = new Car(this.scene, 0x8a1f2d, 'traffic');
    car.modelName = 'Regent Luxe';
    car.isWreckTarget = true;
    car.setPos(L.pickupSpot.x, L.pickupSpot.z, Math.PI);
    car.waypoints = [
      { x: 128, z: -64 }, { x: 128, z: 64 }, { x: 128, z: 192 }, { x: L.marina.x, z: L.marina.z },
    ];
    car.wpIdx = 0;
    car.cruiseSpeed = 17.5;
    this.wreckTarget = car;
  }

  clearWreck() {
    if (this.wreckTarget) {
      this.wreckTarget.dispose(this.scene);
      this.wreckTarget = null;
    }
  }

  updateWreckTarget(dt) {
    const car = this.wreckTarget;
    if (!car) return;
    if (car.wrecked) {
      car.speed = 0;
      car.syncMesh(dt);
      this.G.toast('The Regent is wrecked. Okafor sends her regards.');
      this.advance();
      return;
    }
    const wp = car.waypoints[car.wpIdx];
    if (!wp) { this.fail('The Regent reached the marina!'); return; }
    if (dist2D(car.x, car.z, wp.x, wp.z) < 9) {
      car.wpIdx++;
      if (car.wpIdx >= car.waypoints.length) { this.fail('The Regent reached the marina!'); return; }
    }
    const target = car.waypoints[car.wpIdx];
    const want = Math.atan2(target.x - car.x, target.z - car.z);
    const dh = wrapAngle(want - car.heading);
    car.heading += clamp(dh, -1.9 * dt, 1.9 * dt);
    car.speed += clamp(car.cruiseSpeed - car.speed, -20 * dt, 14 * dt);
    const pos = {
      x: car.x + Math.sin(car.heading) * car.speed * dt,
      z: car.z + Math.cos(car.heading) * car.speed * dt,
    };
    const vel = { x: Math.sin(car.heading) * car.speed, z: Math.cos(car.heading) * car.speed };
    pushOutOfBoxes(pos, car.radius, this.G.world.colliders, vel);
    pos.x = clamp(pos.x, -CITY_EDGE, CITY_EDGE);
    pos.z = clamp(pos.z, -CITY_EDGE, 250); // 250: the marina overshoot
    car.group.position.set(pos.x, 0, pos.z);
    car.vel.x = vel.x; car.vel.z = vel.z;
    car.syncMesh(dt);
  }

  markerTarget() {
    const st = this.stage();
    if (!st) return null;
    if (st.kind === 'steal') {
      const car = this.G.targetCar;
      return car ? { x: car.x, z: car.z } : null;
    }
    if (st.kind === 'wreck' && this.wreckTarget) {
      return { x: this.wreckTarget.x, z: this.wreckTarget.z };
    }
    if (st.kind === 'race') {
      const gate = st.gates[this.gateIdx];
      return gate ? { x: gate.x, z: gate.z } : null;
    }
    return { x: st.x, z: st.z };
  }

  objectiveText() {
    const st = this.stage();
    if (!st) return null;
    const stages = this.currentStages();
    const next = stages[this.stageIdx + 1];
    return {
      title: this.freeroam ? `COURIER JOB ${this.jobSeq}` : `JOB ${this.idx + 1} · ${MISSION_NAMES[this.idx]}`,
      text: st.text,
      stage: this.stageIdx + 1,
      total: stages.length,
      next: next ? next.text : 'Final stage — finish it.',
    };
  }

  notifyEnteredCar(car) {
    const st = this.stage();
    if (st && st.kind === 'steal' && car === this.G.targetCar) {
      this.G.toast('That is the one. Take it to the garage.');
      this.advance();
    }
  }

  advance() {
    const st = this.stage();
    if (!st) return;
    if (st.onDone) st.onDone();
    if (st.kind === 'race' && this.G.stats) this.G.stats.racesWon++;
    if (st.pay) {
      this.G.addCash(st.pay);
      this.G.toast(`Job done: +$${st.pay.toLocaleString('en-US')}`);
      this.G.audio.blip('cash');
    }
    // Progression: RP for the stage, standing where the stage ended.
    if (this.G.addRP) this.G.addRP(st.rp || 10);
    if (this.G.addStanding) {
      const at = st.x !== undefined ? st : { x: this.G.focusX, z: this.G.focusZ };
      this.G.addStanding(districtAt(at.x, at.z).id, 14);
    }
    if (this.G.combat) this.G.combat.addAmmo(4); // Okafor keeps the crew stocked
    this.stageIdx++;
    if (this.stageIdx >= this.currentStages().length) {
      if (this.freeroam) {
        if (this.G.stats) this.G.stats.districtJobs++;
        this.genJob();
        this.beginStage();
        return;
      }
      // A finished story mission earns its medal: graded on the clock
      // and on how much of Ren the job left standing.
      if (this.G.stats) this.G.stats.recordMission(this.idx, this.missionT, this.missionDamage);
      this.missionT = 0;
      this.missionDamage = 0;
      this.idx++;
      this.stageIdx = 0;
      this.G.saveGame();
      if (this.idx >= this.defs.length) {
        this.active = false;
        this.done = true;
        this.marker.visible = false;
        this.refreshGates();
        this.clearWreck();
        this.G.onStoryComplete();
        return;
      }
      this.G.toast(`New job: ${MISSION_NAMES[this.idx]}`);
    }
    this.beginStage();
  }

  fail(reason) {
    if (!this.active) return;
    this.G.toast(`${reason} The job restarts.`);
    this.stageIdx = 0;
    this.beginStage();
  }

  // Being busted mid-delivery, mid-wreck or mid-heist loses the job.
  onBusted() {
    if (this.active && !this.freeroam && (this.idx === 2 || this.idx === 3 || this.idx === 6)) {
      this.fail('Busted!');
    }
  }

  update(dt, t) {
    if (this.active && !this.freeroam) this.missionT += dt;
    const st = this.stage();
    const target = this.markerTarget();
    if (st && target && st.kind !== 'race') {
      this.marker.visible = true;
      this.marker.position.set(target.x, 0, target.z);
      this.marker.rotation.y = t * 0.8;
    } else {
      this.marker.visible = false;
    }
    if (!st) return;

    if (this.timerLeft !== null) {
      this.timerLeft -= dt;
      if (this.timerLeft <= 0) {
        this.timerLeft = null;
        this.fail(st.kind === 'race' ? 'Out of time!' : 'Too slow!');
        return;
      }
    }

    const G = this.G;
    if (st.kind === 'goto') {
      if (dist2D(G.focusX, G.focusZ, st.x, st.z) < st.radius) this.advance();
    } else if (st.kind === 'vanish') {
      // Inside the zone the streets forget you — if you can stay there.
      if (dist2D(G.focusX, G.focusZ, st.x, st.z) < st.radius) {
        G.police.stars = Math.max(0, G.police.stars - dt * 0.22);
        G.police.ghostT = Math.max(G.police.ghostT, 0.4);
        if (G.police.stars <= 0.02) {
          G.police.setStars(0);
          this.advance();
        }
      }
    } else if (st.kind === 'wreck') {
      this.updateWreckTarget(dt);
    } else if (st.kind === 'race') {
      const gate = st.gates[this.gateIdx];
      if (gate && G.inCar && dist2D(G.focusX, G.focusZ, gate.x, gate.z) < 5.6) {
        this.gateIdx++;
        G.audio.blip('checkpoint');
        if (this.gateIdx >= st.gates.length) {
          this.timerLeft = null;
          this.advance();
        } else {
          this.refreshGates();
        }
      }
    }
  }

  timerText() {
    if (this.timerLeft === null) return null;
    const s = Math.max(0, this.timerLeft);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  timerDanger() { return this.timerLeft !== null && this.timerLeft < 10; }
}
