// ── shots.js — screenshot staging for the four portfolio scenes.
// Exports: applyShot(name, G). Called by main.js when a ?shot= query is
// present (see shots.json / scripts/shoot.mjs); it drives the game's
// real systems into composed frames — it is not part of normal play.
// ?shot= staging: boot straight into a composed, deterministic scene with
// the HUD live and no start screen, so screenshots show the real game.
// The portfolio is a deliberate spread, one system story per frame:
//   1-cover  — the Strand chase on the coast road: sea, beach, promenade,
//              towers and the pursuit in a single frame.
//   2-street — on-foot combat in Old Market at dusk: aim line and reticle,
//              a fallen rival, stalls, crowd, officers closing on foot.
//   3-stats  — the pause dossier: full city map, completion ring,
//              checklist, career stats, medals and save slots.
//   4-title  — the title screen over a live aerial of the bay at sunset.
// Every scene is staged AHEAD of the camera and built from the game's
// real systems — the counters on the stats screen are dressed values in
// the same CareerStats object the game itself fills.

function placeTrafficOnRoad(car, blockCz, roadZ, atX) {
  car.cz = blockCz;
  const h = car.half, side = h * 2, per = side * 4;
  const edges = [
    { seg: 0, fixed: car.cz - h },   // north edge, travelling +x
    { seg: 2, fixed: car.cz + h },   // south edge, travelling -x
  ];
  for (const e of edges) {
    if (Math.abs(e.fixed - roadZ) > 4) continue;
    let s;
    if (e.seg === 0) s = (atX - car.cx) + h;
    else s = 2 * side + (car.cx - atX) + h;
    car.s = ((s % per) + per) % per;
    car.dir = 1;
    car.speedNow = 14;
    car.place();
    return true;
  }
  return false;
}

// Put a traffic car on the east edge of a block's loop — the coast road.
function placeTrafficOnCoast(car, blockCz, atZ, cruise) {
  const h = car.half, side = h * 2, per = side * 4;
  car.cx = 160;
  car.cz = blockCz;
  car.s = ((side + (atZ - blockCz) + h) % per + per) % per;
  car.dir = 1;
  car.speedNow = cruise || 13;
  if (cruise) car.cruise = cruise;
  car.place();
}

// Place a traffic car on a horizontal road through placeTrafficOnRoad.
// The loop centre is pinned so atX sits at the START of the car's segment
// (east end for westbound, west end for eastbound): the car then runs
// straight for a full segment instead of turning off at the next corner
// mid-scene, and the segment maths always lands it exactly at atX.
function placeRoad(car, blockCz, roadZ, atX, cruise) {
  car.cx = atX + (roadZ < blockCz ? 27 : -27);
  if (placeTrafficOnRoad(car, blockCz, roadZ, atX) && cruise) {
    car.cruise = cruise;
    car.speedNow = cruise;
  }
}

// Park spare cars as set dressing: rows of [x, z, heading] along a curb.
function parkRow(spares, from, spots) {
  for (let i = 0; i < spots.length; i++) {
    const car = spares[from + i];
    if (car) car.setPos(spots[i][0], spots[i][1], spots[i][2]);
  }
}

function dressStats(G, cash, rp, standing) {
  G.cash = cash;
  G.rp = rp;
  G.standing = standing;
  G.hud.setCash(G.cash);
  G.hud.setRadio(G.audio.stationName());
}

// Dress a pedestrian as an SBPD foot officer: navy torso and arms (they
// share one material), dark trousers — then walk them at the player.
function makeOfficer(G, ped, x, z) {
  for (const child of ped.group.children) {
    const h = child.geometry && child.geometry.parameters && child.geometry.parameters.height;
    if (h === 0.72) child.material.color.setHex(0x22355c);       // torso + arms
    else if (h === 0.78) child.material.color.setHex(0x161d29);  // legs
  }
  ped.staged = true;
  ped.state = 'wander';
  ped.x = x; ped.z = z;
  ped.tx = G.player.x; ped.tz = G.player.z;
  ped.heading = Math.atan2(G.player.x - x, G.player.z - z);
  ped.group.position.set(x, 0, z);
  ped.group.rotation.y = ped.heading;
}

export function applyShot(name, G) {
  if (name === 'title') {
    // The title screen: no run starts — the game sits in its menu state,
    // the city idling below the camera at sunset, two save slots already
    // written by earlier careers.
    G.world.setTimeOfDay('dusk');
    G.saves.write(0, {}, {
      act: 'Act III — Wreck the Regent', mission: 'Wreck the Regent',
      completion: 58.3, cash: 5120, rp: 480,
    });
    G.saves.write(1, {}, {
      act: 'Act V — The Marina Job', mission: 'The Marina Job',
      completion: 86.1, cash: 12480, rp: 1150,
    });
    // Pin the camera LOW over the water, south-east of the island,
    // looking north-west up the shore: the frame stacks sea and foam
    // at the bottom, then wet sand, beach, boardwalk and promenade,
    // the Strand boulevard with its traffic, and the tower skyline
    // behind — one sunset panorama, filled edge to edge.
    G.menuOrbit = 0.31;
    G.menuCam = { r: 295, h: 27 };
    // The boulevard alive for the menu: a westbound stream spread the
    // whole length of the Strand road, coast-road traffic climbing the
    // east shore, parked rows on the south curb.
    placeRoad(G.traffic[0], 160, 192, 168, 13);
    placeRoad(G.traffic[2], 160, 192, 118, 13);
    placeRoad(G.traffic[4], 160, 192, 62, 13);
    placeRoad(G.traffic[6], 160, 192, 6, 13);
    placeRoad(G.traffic[8], 160, 192, -58, 13);
    placeRoad(G.traffic[10], 160, 192, -124, 13);
    placeRoad(G.traffic[12], 160, 192, -178, 13);
    placeTrafficOnCoast(G.traffic[14], 160, 150, 12);
    placeTrafficOnCoast(G.traffic[16], 96, 96, 12);
    placeTrafficOnCoast(G.traffic[18], 32, 30, 12);
    const spare = G.parkedCars.filter((c) => c !== G.targetCar);
    parkRow(spare, 0, [
      [168, 198.5, Math.PI / 2], [138, 198.5, Math.PI / 2], [104, 198.5, Math.PI / 2],
      [66, 198.5, Math.PI / 2], [22, 198.5, Math.PI / 2], [-30, 198.5, Math.PI / 2],
      [-84, 198.5, Math.PI / 2], [-140, 198.5, Math.PI / 2],
    ]);
    parkRow(spare, 8, [
      [176.5, 150, 0], [176.5, 108, 0], [176.5, 58, 0],
    ]);
    // People on the shore strip: promenade strollers, bench sitters
    // watching the sunset, browsers at the boardwalk stalls, a crowd
    // down on the sand among the umbrellas.
    G.peds.stageCrowd(-40, 210, 6, 14);
    G.peds.stageCrowd(90, 208, 5, 12);
    G.peds.stageCrowd(30, 240, 5, 10);
    G.peds.stageCrowd(-110, 238, 4, 10);
    G.peds.stageSitters(20, 214.5, 3);
    G.peds.stageSitters(120, 214.5, 2);
    G.peds.stageBrowsers(-66, 234.8, 2, 0);
    G.peds.stageBrowsers(56, 234.8, 2, 0);
    G.peds.stageCrossers(150, 196, 2, 0, 1);
    G.hud.fillTitle(G);
    G.hud.showScreen('startScreen');
    return;
  }

  G.beginPlay({ fresh: true, shot: true });
  G.cash = 1240;
  G.hud.setCash(G.cash);

  if (name === 'cover') {
    // The chase runs NORTH up the coast road (x=189.5 lane) toward the
    // Strand junction, camera behind and low: towers of the east column
    // on the left, the east promenade on the right, and dead ahead the
    // promenade crossing, the beach and the sea filling the top of the
    // frame. Varied terrain in one shot, not a sliver at the edge.
    G.missions.startAt(3);
    dressStats(G, 8450, 720, { strand: 84, bankrow: 40, market: 25, midtown: 44 });
    G.health = 82; G.armour = 55;
    // A sport-silhouette hero — spoiler, raked glass, two-tone paint.
    const car = G.parkedCars.find((c) => c !== G.targetCar && c.style === 'sport')
      || G.parkedCars.find((c) => c !== G.targetCar && c.style === 'car')
      || G.parkedCars.find((c) => c !== G.targetCar) || G.parkedCars[0];
    G.enterCar(car, true);
    car.group.userData.body.material.color.setHex(0xff6b35);
    car.modelName = 'Sirocco Sport';
    car.damage = 0.22;
    // Demo-drive cruise (~16 u/s, held by the auto-throttle): the end
    // position varies with the machine's frame rate, so the dressing
    // below spans the whole plausible stretch, z 90–200 — the frame is
    // composed wherever along it the shutter catches the convoy.
    car.setPos(189.5, 55, 0);
    car.vel.x = 0; car.vel.z = 26; car.speed = 26;
    G.demoDrive = true;
    G.camDistMul = 0.92;
    G.camHeightMul = 0.82;
    G.police.setStars(4);
    G.police.heliStage = { dx: -20, dz: 34, dy: 15 };
    G.police.heli.cone.visible = false; // a searchlight beam reads wrong at noon
    // Flankers spawned already in formation off the rear quarters, a
    // third unit trailing — the followOffset maths is heading-relative,
    // so the formation holds as the convoy runs north.
    // Two units ride AHEAD of the hero, flanking the lane at mid-frame
    // distance (a trailing offset puts them on top of the chase camera
    // — two giant quarter-panels and nothing else). A third trails.
    const p1 = G.police.spawnAt(194, 61, 0); p1.followOffset = { back: -6, side: -4.5 };
    const p2 = G.police.spawnAt(185, 61, 0); p2.followOffset = { back: -6, side: 4.5 };
    const p3 = G.police.spawnAt(189.5, 31, 0); p3.followOffset = { back: 24, side: 0 };
    // Intercept cruisers pinned along the run: one on the promenade
    // shoulder mid-stretch, two more at the junction and on the Strand,
    // noses angled at the road the convoy is about to cross.
    G.police.spawnAt(200, 150, -0.7, 'block');
    G.police.spawnAt(178, 203, 0.8, 'block');
    G.police.spawnAt(150, 198.5, Math.PI / 2 + 0.4, 'block');
    G.police.holdSpawns = true;
    // Northbound traffic just ahead in the lane, pulling away gently
    // and turning the Strand corner as the convoy arrives, so the
    // junction ahead is alive with crossing traffic.
    placeTrafficOnCoast(G.traffic[4], 160, 168, 14);
    placeTrafficOnCoast(G.traffic[6], 160, 186, 13);
    // Westbound Strand traffic crossing the junction ahead.
    placeRoad(G.traffic[10], 160, 192, 140, 16);
    placeRoad(G.traffic[12], 160, 192, 118, 16);
    // Parked rows: the west curb of the coast road, the Strand curb.
    const spare = G.parkedCars.filter((c) => c !== car && c !== G.targetCar);
    parkRow(spare, 0, [
      [176.5, 104, 0], [176.5, 122, 0], [176.5, 140, 0],
      [176.5, 164, 0], [176.5, 188, 0],
    ]);
    parkRow(spare, 5, [
      [150, 198.5, Math.PI / 2], [128, 198.5, Math.PI / 2],
    ]);
    // People living in the frame: promenade strollers east and south,
    // crowds crossing the coast road at two depths, sitters on the
    // promenade benches, browsers at the boardwalk stall by the beach.
    G.peds.stageCrowd(150, 208, 5, 12);
    G.peds.stageCrowd(205, 182, 5, 10);
    G.peds.stageCrowd(205, 120, 4, 10);
    G.peds.stageCrowd(160, 182, 4, 10);
    G.peds.stageCrossers(184, 194, 3, 1, 0);
    G.peds.stageCrossers(184, 122, 2, 1, 0);
    G.peds.stageSitters(190, 212, 2);
    G.peds.stageBrowsers(180, 234.8, 2, 0);
    G.snapCamera();
    return;
  }

  if (name === 'street') {
    // On-foot combat in Old Market at dusk: Ren's pistol is up, the shot
    // hangs in the air as a tracer, a rival is down in front of the
    // market hall stall, and the law answers on wheels AND on foot.
    G.world.setTimeOfDay('dusk');
    G.missions.startAt(1);
    dressStats(G, 2310, 260, { market: 47, strand: 30 });
    G.health = 64; G.armour = 20;
    G.combat.select(1);
    G.camDistMul = 1.05;
    G.camHeightMul = 1.0;
    G.player.setPos(-79, -74, 1.17);
    // Crowd first, so the named pieces below get fresh pedestrians.
    G.peds.stageCrowd(-84, -60, 6, 9);
    G.peds.stageCrowd(-62, -84, 5, 8);
    G.peds.stageBrowsers(-66.5, -72.5, 2, 2.2);
    G.peds.stageCrossers(-56, -80, 3, 0, 1);
    // Two SBPD officers on foot, closing on Ren from either side.
    const off1 = G.peds.peds.find((p) => !p.staged && !p.scooter && p.state !== 'fallen');
    if (off1) makeOfficer(G, off1, -64, -78);
    const off2 = G.peds.peds.find((p) => !p.staged && !p.scooter && p.state !== 'fallen');
    if (off2) makeOfficer(G, off2, -90, -62);
    // The rival, down in front of the stall — staged last so nothing
    // moves him, and the crime counter stays clean. He lies far enough
    // ahead to clear the dialogue box in frame, in a coral shirt loud
    // enough that a body on the ground cannot be missed.
    const victim = G.peds.peds.find((p) => !p.staged && p.state !== 'fallen') || G.peds.peds[30];
    for (const child of victim.group.children) {
      const h = child.geometry && child.geometry.parameters && child.geometry.parameters.height;
      if (h === 0.72) child.material.color.setHex(0xe85447);
    }
    victim.x = -69; victim.z = -68;
    victim.group.position.set(victim.x, 0, victim.z);
    G.peds.forceFall(victim);
    victim.timer = 999; // stay down until the shutter has fired
    G.peds.hitEvents = 0; // staged, not a fresh crime
    // The shot itself: a held tracer from Ren's muzzle to the rival,
    // and the muzzle flash frozen with it.
    const fx = Math.sin(1.17), fz = Math.cos(1.17);
    const from = { x: G.player.x + fx * 0.7, y: 1.35, z: G.player.z + fz * 0.7 };
    G.combat.stageTracer(from, { x: victim.x, y: 0.5, z: victim.z });
    G.combat.flash.position.set(from.x, from.y, from.z);
    G.combat.flash.visible = true;
    G.combat.flashT = 999;
    // Traffic on the cross street: two eastbound, one oncoming.
    placeRoad(G.traffic[0], -32, -64, -20);
    placeRoad(G.traffic[2], -32, -64, -52, 9);
    placeRoad(G.traffic[4], -96, -64, 10, 13);
    // Parked cars hug both curbs around the intersection.
    const spare = G.parkedCars.filter((c) => c !== G.targetCar);
    parkRow(spare, 0, [
      [-50, -74.5, Math.PI / 2], [-38, -53.5, Math.PI / 2], [-26, -74.5, Math.PI / 2],
      [-58, -53.5, Math.PI / 2], [-74.5, -44, 0], [-53.5, -46, 0],
    ]);
    G.police.setStars(2);
    // One cruiser already angled across the street; one more rolling in.
    G.police.spawnAt(-54, -75, Math.PI / 2 + 0.5, 'block');
    const p2 = G.police.spawnAt(-112, -64, Math.PI / 2);
    p2.speedCap = 8;
    G.police.holdSpawns = true;
    G.snapCamera();
    return;
  }

  if (name === 'stats') {
    // The pause dossier, mid-career: five of seven story jobs done, a
    // medal row with one B in it, a dozen stars found, the Strand chase
    // frozen behind the panel. All of it lives in the same CareerStats
    // and save-slot objects the game itself writes.
    G.missions.startAt(5);
    dressStats(G, 8450, 720, { strand: 84, bankrow: 66, market: 47, midtown: 44, palm: 22 });
    Object.assign(G.stats, {
      carsStolen: 23, copsEscaped: 9, distanceDriven: 48200, longestJump: 31,
      takedowns: 14, racesWon: 1, stuntJumps: 5, districtJobs: 5, crewAbilitiesUsed: 17,
    });
    G.stats.medals = { 0: 'S', 1: 'A', 2: 'A', 3: 'B', 4: 'A' };
    G.collectibles.setFound([0, 1, 2, 4, 5, 7, 8, 10, 12, 14, 16, 18]);
    const car = G.parkedCars.find((c) => c !== G.targetCar && c.style === 'sport')
      || G.parkedCars.find((c) => c !== G.targetCar) || G.parkedCars[0];
    G.enterCar(car, true);
    car.setPos(96, 189.5, -Math.PI / 2);
    G.saveGame(); // slot 1 now holds this career, exactly as in play
    G.pauseGame();
    return;
  }

  // Unknown shot name: the cover scene.
  applyShot('cover', G);
}
