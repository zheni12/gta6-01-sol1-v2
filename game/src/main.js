// ── main.js — entry point: boot, shared state G, and the frame loop.
// Exports: none (side effects only); it publishes the live game object
// as window.__game for the screenshot harness. It constructs every other
// system (world, vehicles, police, peds, missions, crew, combat, hud,
// stats, saves, collectibles) and routes input, camera and HUD updates.
// SOLMAR HEAT — boot, the game state machine, and the main loop that ties
// the city, cars, police, pedestrians, missions, crew, combat, HUD and
// audio together. Also owns the player's progression: cash, RP and rank,
// district standing, health and armour, and the localStorage save.

import { BLOCK_CENTERS, PALETTE, RANKS, SAVE_KEY, clamp, dist2D, districtAt, mulberry32, wrapAngle } from './config.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { buildWorld } from './world.js';
import { TrafficCar, nearestEnterable, spawnParkedCars, updatePlayerCar } from './vehicles.js';
import { PoliceSystem } from './police.js';
import { Pedestrians } from './pedestrians.js';
import { Missions, MISSION_NAMES } from './missions.js';
import { Crew } from './crew.js';
import { Combat } from './combat.js';
import { HUD } from './hud.js';
import { Player } from './player.js';
import { CareerStats, actNameFor } from './stats.js';
import { SaveSlots } from './save.js';
import { Collectibles } from './collectibles.js';
import { applyShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 1e9);
const rng = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);
camera.position.set(0, 60, 150);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const world = buildWorld(scene, rng);
const input = new Input();
const audio = new AudioSys();
const hud = new HUD();
const player = new Player(scene);

// ---- shared game state -------------------------------------------------
const G = {
  scene, world, input, audio, hud, player,
  state: 'menu',
  cash: 100,
  rp: 0,
  standing: {},
  health: 100,
  armour: 25,
  hurtT: -99,
  missionIdx: 0,
  storyDone: false,
  inCar: false,
  playerCar: null,
  lastCar: null,
  traffic: [],
  parkedCars: [],
  targetCar: null,
  police: null,
  missions: null,
  peds: null,
  crew: null,
  combat: null,
  stats: null,
  saves: null,
  collectibles: null,
  saveSlot: 0,
  eyesOutT: 0,
  focusX: 6, focusZ: 76, focusHeading: Math.PI, focusSpeed: 0,
  focusVelX: 0, focusVelZ: 0,
  camSnap: true,
  toast: (msg) => hud.toast(msg),
};
window.__game = G;

G.snapCamera = () => { G.camSnap = true; };

G.saveGame = () => {
  try {
    const payload = {
      cash: G.cash, mission: G.missions ? G.missions.idx : G.missionIdx,
      storyDone: G.storyDone, rp: G.rp, standing: G.standing,
      stats: G.stats ? G.stats.toJSON() : null,
      collectibles: G.collectibles ? G.collectibles.foundList() : [],
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    // The same payload lands in the active save slot, with the summary
    // the title and pause screens print: act, mission, completion, cash.
    if (G.saves && G.stats) {
      const idx = G.missions ? G.missions.idx : G.missionIdx;
      G.saves.write(G.saveSlot, payload, {
        act: actNameFor(idx, G.storyDone),
        mission: G.storyDone || idx >= MISSION_NAMES.length ? 'Free Roam — Courier Work' : MISSION_NAMES[idx],
        completion: G.stats.completion(G),
        cash: G.cash,
        rp: G.rp,
      });
    }
  } catch (e) { /* storage off: progress lasts this visit only */ }
};

// Pause-screen save slots: write the current game into slot i.
G.saveToSlot = (i) => {
  G.saveSlot = i;
  G.saveGame();
  hud.toast(`Saved to slot ${i + 1} — ${actNameFor(G.missions ? G.missions.idx : 0, G.storyDone)}.`);
  hud.fillPause(G);
};

G.addCash = (n) => { G.cash += n; G.saveGame(); };

G.addRP = (n) => {
  const before = G.rp;
  G.rp += n;
  G.saveGame();
  // Crossing a rank threshold is worth a shout. The thresholds are the
  // RANKS ladder itself (minus the starting rank), never a second copy.
  const thresholds = RANKS.slice(1).map((r) => r.rp);
  for (const t of thresholds) {
    if (before < t && G.rp >= t) hud.toast(`RANK UP — the bay knows your name now. (+${n} RP)`);
  }
};

G.addStanding = (districtId, n) => {
  G.standing[districtId] = (G.standing[districtId] || 0) + n;
  G.saveGame();
};

// Damage lands on armour first; death is a trip to the curb, not the end.
let elapsedNow = 0;
G.hurtPlayer = (n) => {
  if (G.state !== 'playing') return;
  if (G.missions && G.missions.active && !G.missions.freeroam) G.missions.missionDamage += n;
  const absorbed = Math.min(G.armour, n * 0.6);
  G.armour -= absorbed;
  G.health -= (n - absorbed);
  G.hurtT = elapsedNow;
  audio.blip('hit');
  if (G.health <= 0) G.onWasted();
};

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    G.cash = typeof s.cash === 'number' ? s.cash : 100;
    G.rp = typeof s.rp === 'number' ? s.rp : 0;
    G.standing = s.standing && typeof s.standing === 'object' ? s.standing : {};
    G.missionIdx = typeof s.mission === 'number' ? s.mission : 0;
    G.storyDone = !!s.storyDone;
    if (G.stats && s.stats) G.stats.fromJSON(s.stats);
    if (G.collectibles && Array.isArray(s.collectibles)) G.collectibles.setFound(s.collectibles);
    return true;
  } catch (e) { return false; }
}

// ---- traffic & parked cars --------------------------------------------
{
  const blocks = [];
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) blocks.push([cx, cz]);
  }
  for (let i = 0; i < 32; i++) {
    const [cx, cz] = blocks[Math.floor(rng() * blocks.length)];
    const car = new TrafficCar(scene, PALETTE.carColors[i % PALETTE.carColors.length], cx, cz, i % 2 === 0 ? 1 : -1, rng);
    G.traffic.push(car);
  }
  G.parkedCars = spawnParkedCars(scene, world.parkingSpots, PALETTE.carColors, rng, 38);
  // The coupe Madame Okafor wants, painted teal so the brief matches the car.
  let best = null, bestD = 1e9;
  for (const car of G.parkedCars) {
    const d = dist2D(car.x, car.z, -128, -64);
    if (d < bestD) { bestD = d; best = car; }
  }
  G.targetCar = best;
  if (best) best.group.userData.body.material.color.setHex(0x12b5a5);
}

G.police = new PoliceSystem(scene, G);
G.peds = new Pedestrians(scene, world, rng, 60);
G.missions = new Missions(scene, G);
G.crew = new Crew(G);
G.combat = new Combat(scene, G);
G.stats = new CareerStats();
G.saves = new SaveSlots();
G.collectibles = new Collectibles(scene, G);
const police = G.police;
const missions = G.missions;
const peds = G.peds;

// ---- entering / leaving cars -------------------------------------------
G.enterCar = (car, silent = false) => {
  G.inCar = true;
  G.playerCar = car;
  car.kind = 'player';
  car.vel.x = 0; car.vel.z = 0;
  player.group.visible = false;
  if (!car.owned) {
    car.owned = true;
    if (G.stats) G.stats.carsStolen++;
    if (!silent) {
      police.addCrime(1);
      hud.toast('Vehicle stolen — the owner called it in.');
      audio.blip('steal');
    }
  }
  missions.notifyEnteredCar(car);
  audio.unlock();
  audio.setEngine(true, 0);
};

function exitCar() {
  const car = G.playerCar;
  if (!car) return;
  car.kind = 'parked';
  car.speed = 0;
  car.vel.x = 0; car.vel.z = 0;
  car.group.position.y = 0;
  car.group.rotation.x = 0;
  airJump = null;
  G.inCar = false;
  G.playerCar = null;
  G.lastCar = car;
  player.setPos(
    car.x - Math.cos(car.heading) * 2.5,
    car.z + Math.sin(car.heading) * 2.5,
    car.heading,
  );
  player.group.visible = true;
  audio.setEngine(false, 0);
}

// ---- state transitions ---------------------------------------------------
G.beginPlay = ({ fresh = false } = {}) => {
  if (fresh) {
    G.cash = 100;
    G.rp = 0;
    G.standing = {};
    G.missionIdx = 0;
    G.storyDone = false;
    if (G.stats) { G.stats = new CareerStats(); }
    if (G.collectibles) G.collectibles.setFound([]);
    G.saveGame();
  }
  G.health = 100;
  G.armour = Math.max(G.armour, 25);
  world.setTimeOfDay('day'); // the title hangs at dusk; the work is daylight
  for (const c of [...police.cars]) police.removeCar(c);
  police.setStars(0);
  police.busted = 0;
  if (G.inCar) exitCar();
  G.camDistMul = 1;
  G.camHeightMul = 1;
  G.demoDrive = false;
  player.setPos(6, 76, Math.PI);
  player.group.visible = true;
  missions.startAt(G.storyDone ? missions.defs.length : G.missionIdx);
  hud.showScreen(null);
  G.state = 'playing';
  G.snapCamera();
  audio.unlock();
};

function endRun(title, text) {
  for (const c of [...police.cars]) police.removeCar(c);
  police.setStars(0);
  if (G.inCar) exitCar();
  player.setPos(8, 72, Math.PI);
  player.group.visible = true;
  missions.onBusted();
  G.saveGame();
  document.getElementById('endTitle').textContent = title;
  document.getElementById('fineText').textContent = text;
  hud.showScreen('bustedScreen');
  G.state = 'busted';
}

G.onBusted = () => {
  if (G.state !== 'playing') return;
  const fine = 150 + 100 * police.starsInt;
  G.cash = Math.max(0, G.cash - fine);
  G.health = 100;
  endRun('BUSTED', `The Solmar Bay PD impounded your ride and fined you $${fine.toLocaleString('en-US')}.`);
  audio.blip('bust');
};

G.onWasted = () => {
  if (G.state !== 'playing') return;
  const bill = 200;
  G.cash = Math.max(0, G.cash - bill);
  G.health = 100;
  G.armour = 25;
  endRun('WASTED', `You woke up on a gurney at Solmar General. The bill: $${bill}. The crew says walk it off.`);
  audio.blip('bust');
};

G.onStoryComplete = () => {
  G.storyDone = true;
  G.saveGame();
  audio.blip('win');
  hud.showScreen('doneScreen');
  G.state = 'done';
};

// ---- buttons --------------------------------------------------------------
const hadSave = loadSave();
document.getElementById('continueBtn').style.display = hadSave && !G.storyDone ? 'block' : 'none';
document.getElementById('newBtn').addEventListener('click', () => G.beginPlay({ fresh: true }));
document.getElementById('continueBtn').addEventListener('click', () => G.beginPlay({}));
document.getElementById('helpBtn').addEventListener('click', () => {
  const panel = document.getElementById('helpPanel');
  const open = panel.classList.toggle('open');
  document.getElementById('helpBtn').textContent = open ? 'HOW TO PLAY ▴' : 'HOW TO PLAY ▾';
});
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('respawnBtn').addEventListener('click', () => {
  hud.showScreen(null);
  G.state = 'playing';
  G.snapCamera();
});
document.getElementById('roamBtn').addEventListener('click', () => {
  hud.showScreen(null);
  G.state = 'playing';
  missions.startAt(missions.defs.length); // free roam means courier work
});
renderer.domElement.addEventListener('pointerdown', () => {
  if (G.state === 'playing' && !G.inCar) G.combat.tryFire();
});

function resumeGame() {
  hud.showScreen(null);
  G.state = 'playing';
  if (G.inCar) audio.setEngine(true, 0);
}

function pauseGame() {
  hud.fillPause(G);
  hud.showScreen('pauseScreen');
  G.state = 'paused';
  audio.setEngine(false, 0);
}
G.pauseGame = pauseGame;

const TIME_CYCLE = ['day', 'dusk', 'night'];
function cycleTimeOfDay() {
  const next = TIME_CYCLE[(TIME_CYCLE.indexOf(world.timeOfDay) + 1) % TIME_CYCLE.length];
  world.setTimeOfDay(next);
  hud.toast(`Time of day: ${next.toUpperCase()}`);
}

// ---- per-frame simulation ---------------------------------------------------
let prevFocusX = G.focusX, prevFocusZ = G.focusZ;
let crashCooldown = 0;
let pedsHitSeen = 0;
let airJump = null;      // the live stunt-jump arc, while the car is airborne
let prevStarsSeen = 0;   // last frame's wanted level, for escape detection

function updateFocus(dt) {
  prevFocusX = G.focusX; prevFocusZ = G.focusZ;
  if (G.inCar && G.playerCar) {
    G.focusX = G.playerCar.x; G.focusZ = G.playerCar.z;
    G.focusHeading = G.playerCar.heading;
    G.focusSpeed = G.playerCar.speed;
    G.focusVelX = G.playerCar.vel.x; G.focusVelZ = G.playerCar.vel.z;
  } else {
    G.focusX = player.x; G.focusZ = player.z;
    G.focusHeading = player.heading;
    G.focusSpeed = player.speedNow;
    if (dt > 0) {
      G.focusVelX = (G.focusX - prevFocusX) / dt;
      G.focusVelZ = (G.focusZ - prevFocusZ) / dt;
    }
  }
}

function stepGame(dt, t) {
  crashCooldown = Math.max(0, crashCooldown - dt);
  G.crew.update(dt);

  // Slow recovery once the shooting and crashing stop.
  if (G.health > 0 && G.health < 100 && t - G.hurtT > 6) {
    G.health = Math.min(100, G.health + dt * 2.2);
  }

  // Move the player (or their car) first; everything else reacts to them.
  if (G.inCar && G.playerCar) {
    // Screenshot staging only: a gentle auto-throttle keeps the car rolling.
    if (G.demoDrive && G.playerCar.speed < 16) input.down.add('KeyW');
    const impact = updatePlayerCar(G.playerCar, dt, input, world.colliders);
    if (G.demoDrive) input.down.delete('KeyW');
    G.stats.distanceDriven += Math.abs(G.playerCar.speed) * dt;
    // Stunt ramps: cross one fast and lined up with it and the car
    // leaves the ground. The arc is simple gravity; a landing after a
    // real hang-time counts as a stunt jump and measures the leap.
    const pc0 = G.playerCar;
    if (!airJump) {
      for (const ramp of world.stuntRamps) {
        if (Math.abs(pc0.speed) > 15 && dist2D(pc0.x, pc0.z, ramp.x, ramp.z) < 3.4 &&
            Math.abs(wrapAngle(pc0.heading - ramp.heading)) < 0.5) {
          airJump = { vy: 6 + Math.abs(pc0.speed) * 0.17, t: 0, x: pc0.x, z: pc0.z };
          break;
        }
      }
    }
    if (airJump) {
      airJump.vy -= 24 * dt;
      airJump.t += dt;
      const y = Math.max(0, (pc0.group.position.y || 0) + airJump.vy * dt);
      pc0.group.position.y = y;
      pc0.group.rotation.x = clamp(-airJump.vy * 0.018, -0.3, 0.38);
      if (y <= 0 && airJump.vy < 0) {
        pc0.group.rotation.x = 0;
        const leap = dist2D(airJump.x, airJump.z, pc0.x, pc0.z);
        if (airJump.t > 0.45) {
          G.stats.stuntJumps++;
          G.stats.longestJump = Math.max(G.stats.longestJump, Math.round(leap));
          G.addRP(15);
          hud.toast(`STUNT JUMP — ${Math.round(leap)} m of air! +15 RP`);
          audio.blip('checkpoint');
          G.saveGame();
        }
        airJump = null;
      }
    }
    if (impact > 5 && crashCooldown <= 0) {
      audio.blip('hit');
      crashCooldown = 0.8;
      G.playerCar.damage = clamp(G.playerCar.damage + Math.max(0, impact - 7) * 0.006, 0, 1);
      if (impact > 13) G.hurtPlayer((impact - 13) * 0.7);
      if (impact > 10.5) {
        police.addCrime(0.4);
        hud.toast('Reckless driving draws attention.');
        crashCooldown = 2.2;
      }
    }
  } else {
    const cf = { x: G.focusX - camera.position.x, z: G.focusZ - camera.position.z };
    const len = Math.hypot(cf.x, cf.z) || 1;
    cf.x /= len; cf.z /= len;
    const cr = { x: -cf.z, z: cf.x };
    player.update(dt, input, world.colliders, cf, cr);
    // A drawn firearm shows in Ren's hand, right arm levelled.
    const gunOut = G.combat.slot > 0;
    player.group.userData.gun.visible = gunOut;
    if (gunOut) player.group.userData.limbs[1].rotation.x = -1.15;
    // On-foot combat and the crew, from the keyboard.
    if (input.pressed('KeyF')) G.combat.tryFire();
    if (input.pressed('Digit1')) G.combat.select(0);
    if (input.pressed('Digit2')) G.combat.select(1);
    if (input.pressed('Digit3')) G.combat.select(2);
  }
  if (input.pressed('KeyQ')) G.crew.use(0);
  if (input.pressed('KeyR')) G.crew.use(1);
  if (input.pressed('KeyC')) G.crew.use(2);
  if (input.pressed('KeyT')) cycleTimeOfDay();
  updateFocus(dt);

  // Car-to-car contact for the player's car — now with bent metal.
  if (G.inCar && G.playerCar) {
    const pc = G.playerCar;
    const others = [...G.traffic, ...G.parkedCars];
    if (missions.wreckTarget) others.push(missions.wreckTarget);
    for (const other of others) {
      if (other === pc) continue;
      const dx = pc.x - other.x, dz = pc.z - other.z;
      const d = Math.hypot(dx, dz);
      const minD = pc.radius + other.radius - 0.35;
      if (d > 0.01 && d < minD) {
        const nx = dx / d, nz = dz / d;
        const approach = -(pc.vel.x - (other.vel ? other.vel.x : 0)) * nx - (pc.vel.z - (other.vel ? other.vel.z : 0)) * nz;
        pc.group.position.x += nx * (minD - d) * 0.7;
        pc.group.position.z += nz * (minD - d) * 0.7;
        if (other.kind === 'parked') {
          other.group.position.x -= nx * (minD - d) * 0.3;
          other.group.position.z -= nz * (minD - d) * 0.3;
        } else if (other.speedNow !== undefined) {
          other.speedNow *= 0.35;
        }
        const vn = pc.vel.x * nx + pc.vel.z * nz;
        if (vn < 0) { pc.vel.x -= vn * nx * 1.5; pc.vel.z -= vn * nz * 1.5; }
        if (approach > 5) {
          // Bent metal on both cars; the wreck target feels it most.
          other.damage = clamp(other.damage + approach * (other.isWreckTarget ? 0.016 : 0.009), 0, 1);
          pc.damage = clamp(pc.damage + approach * 0.004, 0, 1);
        }
        if (approach > 8 && crashCooldown <= 0) {
          audio.blip('hit');
          police.addCrime(0.5);
          hud.toast(other.isWreckTarget ? 'You slammed the Regent!' : 'You rammed a car — witnesses are calling it in.');
          crashCooldown = 2.2;
        }
      }
    }
  }

  // Traffic, law, crowds, jobs.
  const obstacles = [];
  if (G.playerCar && G.inCar) obstacles.push(G.playerCar);
  for (const c of police.cars) obstacles.push(c);
  for (const c of G.traffic) obstacles.push(c);
  for (const car of G.traffic) car.update(dt, obstacles);
  police.update(dt);
  const threats = [...G.traffic];
  if (G.inCar && G.playerCar) threats.push(G.playerCar);
  if (missions.wreckTarget) threats.push(missions.wreckTarget);
  peds.update(dt, t, threats, G.inCar ? G.playerCar : null);
  if (peds.hitEvents > pedsHitSeen) {
    pedsHitSeen = peds.hitEvents;
    police.addCrime(1);
    hud.toast('You hit a pedestrian!');
    audio.blip('hit');
  }
  missions.update(dt, t);
  // An escape is real when a real pursuit cools all the way to zero
  // while the run is still live — not when a bust or a respawn clears it.
  if (prevStarsSeen >= 1.5 && police.stars === 0 && G.state === 'playing') {
    G.stats.copsEscaped++;
    hud.toast('You lost them. The bay forgets — for now.');
    G.saveGame();
  }
  prevStarsSeen = police.stars;
  G.collectibles.update(dt, t);
  G.combat.update(dt);
  audio.setSiren(police.stars > 0 ? clamp(1 - police.nearestDist / 55, 0, 1) : 0);

  // Enter / exit.
  if (input.pressed('KeyE')) {
    if (G.inCar) exitCar();
    else {
      const car = nearestEnterable(G.parkedCars, player.x, player.z, 3.6);
      if (car) G.enterCar(car);
    }
  }
  // Radio while driving.
  if (G.inCar && input.pressed('KeyM')) {
    hud.setRadio(audio.cycleRadio());
    hud.toast(`Radio: ${audio.stationName()}`);
  }
  audio.setEngine(G.inCar, G.inCar && G.playerCar ? G.playerCar.speed / 56 : 0);
  audio.update(dt, G.inCar && G.state === 'playing');

  // HUD prompts — contextual: the line names the cover the district
  // offers when a gun is out, not just the keys.
  if (!G.inCar) {
    const car = nearestEnterable(G.parkedCars, player.x, player.z, 3.6);
    if (car) hud.prompt(car.owned ? 'E — get in' : 'E — steal this car');
    else if (G.combat.slot > 0 && districtAt(player.x, player.z).id === 'market') {
      hud.prompt('F — fire · duck behind a stall to break their aim');
    } else if (G.combat.slot > 0 && districtAt(player.x, player.z).id === 'strand') {
      hud.prompt('F — fire · the promenade crowds are cover — use them');
    } else {
      hud.prompt('F — fight · 1/2/3 — weapons · Q/R/C — crew');
    }
  } else {
    hud.prompt('E — exit · M — radio · Space — handbrake');
  }
}

const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const fx = G.focusX, fz = G.focusZ, h = G.focusHeading;
  const dist = (G.inCar ? 10.5 + Math.abs(G.focusSpeed) * 0.07 : 7.6) * (G.camDistMul || 1);
  const height = (G.inCar ? 4.4 : 3.4) * (G.camHeightMul || 1);
  const desired = new THREE.Vector3(
    fx - Math.sin(h) * dist,
    height,
    fz - Math.cos(h) * dist,
  );
  if (G.camSnap) {
    camera.position.copy(desired);
    G.camSnap = false;
  } else {
    const k = 1 - Math.exp(-(G.inCar ? 5.5 : 8) * dt);
    camera.position.lerp(desired, k);
  }
  camTarget.set(fx + Math.sin(h) * 7, 1.7, fz + Math.cos(h) * 7);
  camera.lookAt(camTarget);
}

function refreshHud() {
  hud.setCash(G.cash);
  hud.setStars(police.stars, police.responseLabel());
  hud.setHealth(G.health, G.armour);
  hud.setSpeed(G.inCar && G.playerCar ? G.playerCar.speed * 2.2 : 0);
  hud.setObjective(G.state === 'playing' || G.state === 'paused' ? missions.objectiveText() : null);
  hud.setPolicePanel(G.state === 'playing' ? police.unitsInfo() : [], police.starsInt);
  hud.setCrew(G.crew.status());
  hud.setWeapons(G.combat.status());
  hud.setVehicle(G.inCar ? G.playerCar : null);
  const d = districtAt(G.focusX, G.focusZ);
  hud.setDistrict(d, G.standing[d.id] || 0);
  hud.setRank(G.rp);
  hud.setBusted(police.busted);
  hud.setTimer(missions.timerText(), missions.timerDanger());
  hud.setReticle(G.state === 'playing' && !G.inCar && G.combat.slot > 0);
  hud.drawMinimap(G);
}

// ---- boot -------------------------------------------------------------------
let last = performance.now();
let elapsed = 0;
let shotFrames = 0;

if (shotName) applyShot(shotName, G);
else {
  // The title screen hangs over the bay at sunset, the city alive below.
  world.setTimeOfDay('dusk');
  hud.fillTitle(G);
  hud.showScreen('startScreen');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
  last = now;
  elapsed += dt;
  elapsedNow = elapsed;
  const t = elapsed;

  if (input.pressed('Escape', 'KeyP')) {
    if (G.state === 'playing') pauseGame();
    else if (G.state === 'paused') resumeGame();
  }

  if (G.state === 'playing') {
    stepGame(dt, t);
  } else if (G.state === 'menu') {
    // The city idles behind the title: traffic circulates, crowds stroll.
    const obstacles = [...G.traffic];
    for (const car of G.traffic) car.update(dt, obstacles);
    peds.update(dt, t, G.traffic, null);
    police.update(dt);
    const a = G.menuOrbit !== undefined ? G.menuOrbit : t * 0.05;
    const camR = G.menuCam ? G.menuCam.r : 130;
    const camH = G.menuCam ? G.menuCam.h : 58;
    camera.position.set(Math.sin(a) * camR, camH, Math.cos(a) * camR + 10);
    camera.lookAt(0, 4, 10);
    updateFocus(0);
  }
  world.update(dt, t);

  // The title screen stands alone: no HUD chrome around the logo.
  const hudEl = document.getElementById('hud');
  const hudWanted = G.state !== 'menu';
  if ((hudEl.style.display !== 'none') !== hudWanted) {
    hudEl.style.display = hudWanted ? '' : 'none';
  }
  if (G.state !== 'menu') {
    if (G.state === 'playing' || G.state === 'paused') updateCamera(dt);
    refreshHud();
  }
  hud.update(dt);
  renderer.render(scene, camera);
  input.endFrame();

  if (shotName && ++shotFrames === 110) window.__shotReady = true;
}
requestAnimationFrame(frame);
