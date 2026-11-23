// ── combat.js — on-foot weapons: fists, Kestrel-9 pistol, Brute SG.
// Exports: WEAPON_DEFS (slot table), Combat (fire/ammo/tracer state).
// main.js routes F/click input here; hits land on pedestrians.js figures
// and vehicles.js cars, and gunfire raises police.js heat via addCrime.
// On-foot combat: three weapon slots — fists, the Kestrel-9 pistol and
// the Brute scattergun — with ammo, a hitscan shot resolved against
// pedestrians and cars, a muzzle flash and a fading tracer. Gunfire is
// loud: every shot is a crime the law answers.

import { clamp, dist2D } from './config.js';

export const WEAPON_DEFS = [
  { name: 'FISTS', ammo: Infinity, range: 2.6, cooldown: 0.38, carDamage: 0.02, spread: 0.05 },
  { name: 'KESTREL-9', ammo: 48, range: 46, cooldown: 0.24, carDamage: 0.16, spread: 0.035 },
  { name: 'BRUTE SG', ammo: 14, range: 26, cooldown: 0.85, carDamage: 0.3, spread: 0.11 },
];

const FLASH_TIME = 0.05;  // seconds the muzzle flash stays lit
const TRACER_LIFE = 0.09; // seconds a tracer line takes to fade out

export class Combat {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.slot = 1; // start on the pistol — fists are slot 0
    this.ammo = WEAPON_DEFS.map((w) => w.ammo);
    this.coolT = 0;
    this.effects = [];
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0 }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashT = 0;
  }

  weapon() { return WEAPON_DEFS[this.slot]; }

  status() {
    return WEAPON_DEFS.map((w, i) => ({
      name: w.name,
      ammo: this.ammo[i],
      active: i === this.slot,
    }));
  }

  select(i) {
    if (i >= 0 && i < WEAPON_DEFS.length) this.slot = i;
  }

  addAmmo(n) {
    for (let i = 1; i < WEAPON_DEFS.length; i++) {
      if (this.ammo[i] !== Infinity) this.ammo[i] += n;
    }
  }

  // One shot from the player, along their heading. On foot only.
  tryFire() {
    const G = this.G;
    if (G.inCar || this.coolT > 0) return false;
    const w = this.weapon();
    if (this.ammo[this.slot] <= 0) {
      G.hud.toast(`${w.name} is empty — finish a job to restock.`);
      this.coolT = 0.4;
      return false;
    }
    this.coolT = w.cooldown;
    if (this.ammo[this.slot] !== Infinity) this.ammo[this.slot]--;

    const px = G.player.x, pz = G.player.z;
    const fx = Math.sin(G.player.heading), fz = Math.cos(G.player.heading);
    const from = { x: px + fx * 0.7, y: 1.35, z: pz + fz * 0.7 };

    // Nearest valid target inside the spread cone: a pedestrian first,
    // then any car (traffic, parked, the wreck target, a police unit).
    let hit = null, hitD = w.range;
    const testTarget = (x, z, obj, kind) => {
      const dx = x - px, dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > w.range || d < 0.01) return;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 1 - w.spread * 4 && d > 3) return;
      if (d < hitD) { hitD = d; hit = { obj, kind, x, z }; }
    };
    for (const ped of G.peds.peds) if (ped.state !== 'fallen') testTarget(ped.x, ped.z, ped, 'ped');
    const cars = [...G.traffic, ...G.parkedCars, ...G.police.cars];
    if (G.missions.wreckTarget && !G.missions.wreckTarget.wrecked) {
      cars.push(G.missions.wreckTarget);
    }
    for (const car of cars) testTarget(car.x, car.z, car, 'car');

    const endD = hit ? hitD : w.range;
    const to = { x: px + fx * endD, y: 1.15, z: pz + fz * endD };
    if (this.slot > 0) this.spawnTracer(from, to);
    this.flash.position.set(from.x, from.y, from.z);
    this.flash.visible = true;
    this.flashT = FLASH_TIME;

    if (hit) {
      if (hit.kind === 'ped') {
        G.peds.forceFall(hit.obj);
        if (this.slot > 0 && G.stats) G.stats.takedowns++;
        G.hud.toast('You dropped a pedestrian!');
      } else {
        hit.obj.damage = clamp(hit.obj.damage + w.carDamage, 0, 1);
        if (hit.obj.kind === 'police') G.police.addCrime(0.8);
      }
    }
    if (this.slot > 0) {
      G.audio.blip('shot');
      G.police.addCrime(0.55); // gunfire carries across the bay
    }
    return true;
  }

  spawnTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({ line, life: TRACER_LIFE });
  }

  // A tracer that stays lit — screenshot staging freezes the shot mid-air.
  stageTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({ line, life: 999, hold: true });
  }

  update(dt) {
    this.coolT = Math.max(0, this.coolT - dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.material.opacity = Math.max(0, Math.min(this.flashT / FLASH_TIME, 1)) * 0.95;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    for (const fx of [...this.effects]) {
      if (fx.hold) { fx.line.material.opacity = 0.95; continue; }
      fx.life -= dt;
      fx.line.material.opacity = Math.max(0, fx.life / TRACER_LIFE) * 0.9;
      if (fx.life <= 0) {
        this.scene.remove(fx.line);
        fx.line.geometry.dispose();
        fx.line.material.dispose();
        this.effects.splice(this.effects.indexOf(fx), 1);
      }
    }
  }
}
