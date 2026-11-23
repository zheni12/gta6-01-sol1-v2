// shots.js — deterministic staging for the four screenshots. scripts/
// shoot.mjs loads the game with ?shot=<name>; main.js builds the world,
// steps the simulation a few seconds so the city is alive, then calls
// stageShot, which composes the exact frame: cast, cars, police, HUD
// state and light. When staging returns, main sets window.__SHOT_READY.

import { THREE } from './three.js';
import { Car } from './vehicles.js';
import { CAR_MODELS } from './config.js';
import { makePersonMesh } from './pedestrians.js';

function policeCarAt(game, x, z, heading, call, role) {
  const car = new Car(game.world.scene, CAR_MODELS[2], 0x1a2436, { x, z, heading, police: true });
  game.police.units.push({ kind: 'car', call, role, car, shootCd: 0 });
  return car;
}

function footOfficerAt(game, x, z, call) {
  const mesh = makePersonMesh({ shirt: 0x1c2f4a, skin: 0xf2c79b, pants: 0x141c28, cap: 0x1c2f4a });
  mesh.position.set(x, 0, z);
  mesh.rotation.y = Math.atan2(game.player.pos.x - x, game.player.pos.z - z);
  game.world.scene.add(mesh);
  game.police.units.push({ kind: 'foot', call, role: 'Foot officer', mesh, heading: mesh.rotation.y, shootCd: 9 });
  return mesh;
}

function fakeMission(game, title, objective, markerPos) {
  game.missions.current = {
    def: { id: 'staged', title, cash: 0, rp: 0 },
    stageIdx: 0, elapsed: 47, data: {}, story: true,
    stages: [{ objective, marker: () => markerPos, check: () => false }],
  };
  game.missions.refreshMarker();
}

export function stageShot(game, name) {
  const { player, police, world } = game;
  if (name === 'title') return stageTitle(game);
  if (name === 'cover') return stageCover(game);
  if (name === 'street') return stageStreet(game);
  if (name === 'stats') return stageStats(game);
  return false;
}

// 4-title: the logo over a live sunset aerial — sea, beach, promenade,
// boulevard traffic and skyline in one frame, menu and save slots below.
function stageTitle(game) {
  game.setHour(18.45);
  game.mode = 'title';
  // Two staged saves so the title cards read like a played game.
  writeStagedSaves(game);
  game.hud.showTitle();
  game.shotCamera = {
    pos: new THREE.Vector3(430, 165, 905),
    look: new THREE.Vector3(-60, 0, 120),
  };
  return true;
}

// 1-cover: a four-star chase on the Strand boulevard at sunset.
function stageCover(game) {
  const { player, police } = game;
  game.setHour(18.5);
  game.mode = 'play';
  const hero = game.parkedCars.find((c) => c.isHeroCoupe) || game.parkedCars[0];
  hero.parked = false;
  hero.mesh.position.set(30, 0, 447);
  hero.heading = Math.PI / 2;                    // east along the boulevard
  hero.mesh.rotation.y = hero.heading;
  hero.speed = 17;
  player.inCar = hero;
  player.pos.copy(hero.pos);
  player.camPitch = 0.24;
  // Look east-south-east from behind: the beach, boardwalk and sea fill
  // the right of the frame while the skyline runs ahead.
  player.camYaw = 1.22;
  // The response: two flankers behind, an interceptor pinned ahead, one
  // more alongside, and CONDOR-EYE overhead.
  policeCarAt(game, 6, 436, Math.PI / 2, 'KESTREL-1', 'Pursuit lead');
  policeCarAt(game, 2, 453, Math.PI / 2, 'OTTER-2', 'Flanker');
  const pin = policeCarAt(game, 86, 447, -Math.PI / 2, 'VIPER-4', 'Interceptor');
  pin.speed = 0;
  policeCarAt(game, 44, 431, Math.PI / 2, 'PALMA-3', 'Flanker');
  police.spawnHeli(player);
  const heli = police.units.find((u) => u.kind === 'heli');
  if (heli) heli.mesh.position.set(45, 15, 459);
  police.heat = 3.4;
  police.seen = true;
  // Civilian traffic ahead, fleeing the same way.
  for (const [x, z, model] of [[120, 449, 1], [150, 436, 3], [105, 436, 4]]) {
    const c = new Car(game.world.scene, CAR_MODELS[model], CAR_MODELS[model].colors[0], { x, z, heading: Math.PI / 2 });
    c.speed = 12;
    game.extraCars.push(c);
  }
  fakeMission(game, 'Vanish', 'Lose the heat — reach the Strand safehouse', { x: -64, z: 452 });
  game.hud.say('Mira Solano', 'Plates are hot and CONDOR-EYE has us, Ren — break their line of sight!');
  return true;
}

// A market stall built just for the street frame, so the shot always has
// its awnings and crates whatever the city's seed dealt elsewhere.
function stallAt(game, x, z, rotY, stripeA, stripeB) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g2 = c.getContext('2d');
  for (let i = 0; i < 8; i++) { g2.fillStyle = i % 2 ? stripeA : stripeB; g2.fillRect(i * 8, 0, 8, 64); }
  const tex = new THREE.CanvasTexture(c);
  const stall = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.2, 3.2),
    new THREE.MeshLambertMaterial({ color: 0xa9743f }));
  base.position.y = 1.1;
  base.castShadow = true;
  stall.add(base);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.18, 4.4),
    new THREE.MeshLambertMaterial({ map: tex }));
  roof.position.y = 3.1;
  roof.rotation.z = 0.08;
  stall.add(roof);
  const goods = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 2.2),
    new THREE.MeshLambertMaterial({ color: 0xd8642c }));
  goods.position.y = 2.45;
  stall.add(goods);
  stall.position.set(x, 0, z);
  stall.rotation.y = rotY;
  game.world.scene.add(stall);
  return stall;
}

// 2-street: dusk gunfight in the Old Market, a rival down, officers closing.
function stageStreet(game) {
  const { player, police, combat, effects } = game;
  game.setHour(19.15);
  game.mode = 'play';
  player.pos.set(-322, 0, 84);
  player.heading = -Math.PI / 2 + 0.25;          // facing west down the lane
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.heading;
  player.camYaw = player.heading;
  player.camPitch = 0.3;
  combat.unlockGuns();
  combat.current = 1;                            // Kestrel-9 in hand
  // Stalls crowd the lane the fight happens in.
  stallAt(game, -338, 66, 0.3, '#16a085', '#f5f0e6');
  stallAt(game, -342, 102, -0.2, '#e67e22', '#f5f0e6');
  stallAt(game, -358, 84, 1.2, '#8e44ad', '#f5f0e6');
  // The fallen rival, and two of his friends still up behind the stalls.
  const fallen = combat.spawnRival(-334, 82, { alerted: true });
  fallen.alive = false;
  fallen.mesh.rotation.x = -Math.PI / 2;
  fallen.mesh.position.y = 0.25;
  combat.spawnRival(-352, 72, { alerted: true });
  combat.spawnRival(-354, 94, { alerted: true });
  // SBPD foot officers closing in from the west, either side of the lane.
  footOfficerAt(game, -344, 62, 'FOOT-1');
  footOfficerAt(game, -342, 106, 'FOOT-2');
  policeCarAt(game, -356, 122, Math.PI / 2, 'KESTREL-1', 'Pursuit lead');
  police.heat = 2.4;
  police.seen = true;
  // Bystanders by the stalls.
  for (const [x, z, shirt] of [[-330, 64, 0xf2b21b], [-316, 100, 0xe8e3d8], [-340, 104, 0x2a9d8f], [-312, 66, 0xd95f43]]) {
    const m = makePersonMesh({ shirt, skin: 0xc68863, pants: 0x2b2d42 });
    m.position.set(x, 0, z);
    m.rotation.y = Math.random() * 6;
    game.world.scene.add(m);
  }
  // The held tracer from Ren's Kestrel to the fallen rival, muzzle lit.
  effects.holdTracers = true;
  const from = new THREE.Vector3(player.pos.x - 0.4, 1.45, player.pos.z - 0.2);
  const to = new THREE.Vector3(fallen.pos.x, 0.7, fallen.pos.z);
  effects.tracer(from, to, 0xffe9a3);
  effects.muzzle(from);
  fakeMission(game, 'Rival Wreck', 'Wreck the rival coupe and scatter its crew', { x: -446, z: 116 });
  game.shotPrompt = 'Mouse — fire · duck behind a stall to break their aim';
  game.hud.say('Kiki Amara', 'Two down the lane and SBPD foot units behind them — I count six guns, Ren.');
  return true;
}

// 3-stats: the pause dossier of a career well under way.
function stageStats(game) {
  game.setHour(11.2);
  game.mode = 'dossier';
  game.player.pos.set(60, 0, -40);
  const rich = {
    cash: 12480, rp: 1150,
    storyDone: ['first-wheels', 'parcel-run', 'vanish', 'rival-wreck', 'harbor-sprint'],
    medals: { 'first-wheels': 'gold', 'parcel-run': 'gold', 'vanish': 'silver', 'rival-wreck': 'gold', 'harbor-sprint': 'bronze' },
    missionTimes: { 'first-wheels': 121, 'parcel-run': 233, 'vanish': 188, 'rival-wreck': 240, 'harbor-sprint': 201 },
    courierDone: 5, racesWon: 1, stunts: 5, longestLeap: 23,
    takedowns: 6, carsStolen: 9, copsEscaped: 3, crewUses: 11,
    abilitiesUsed: ['mira', 'theo', 'kiki'],
    districtsWorked: ['strand', 'market', 'downtown', 'marina', 'heights'],
    distanceKm: 38.6, starsFound: 12, playSeconds: 2740,
  };
  game.stats.deserialize(rich);
  game.collectibles.restoreTaken([0, 1, 2, 4, 5, 7, 9, 11, 13, 15, 17, 19]);
  writeStagedSaves(game);
  fakeMission(game, 'Night Run', 'Reach the Heights overlook before the clock dies', { x: -436, z: -548 });
  game.hud.showDossier();
  return true;
}

// Two believable save slots, written through the real save system.
function writeStagedSaves(game) {
  const mk = (patch) => {
    const s = Object.create(Object.getPrototypeOf(game.stats));
    Object.assign(s, game.stats);
    s.reset();
    Object.assign(s, patch);
    return s;
  };
  const slot0 = mk({
    cash: 12480, rp: 1150,
    storyDone: ['first-wheels', 'parcel-run', 'vanish', 'rival-wreck', 'harbor-sprint'],
    medals: { 'first-wheels': 'gold' }, districtsWorked: ['strand', 'market', 'downtown'],
    starsFound: 12, courierDone: 5, racesWon: 1, stunts: 5, longestLeap: 23,
    takedowns: 6, carsStolen: 9, copsEscaped: 3, crewUses: 11,
    abilitiesUsed: ['mira', 'theo', 'kiki'], distanceKm: 38.6, playSeconds: 2740,
  });
  game.saves.write(0, slot0, [0, 1, 2, 4, 5, 7, 9, 11, 13, 15, 17, 19]);
  const slot1 = mk({
    cash: 1830, rp: 240, storyDone: ['first-wheels', 'parcel-run'],
    medals: { 'first-wheels': 'silver' }, districtsWorked: ['strand', 'market'],
    starsFound: 4, courierDone: 1, playSeconds: 640,
  });
  game.saves.write(1, slot1, [0, 3, 6, 10]);
}
