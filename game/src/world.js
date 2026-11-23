// ── world.js — Solmar Bay itself: terrain, buildings, props, lighting.
// Exports: buildWorld (returns the world object: colliders, parking /
// bench / stall spots, stuntRamps, landmarks, setTimeOfDay, update) and
// pushOutOfBoxes, the collision solver every mover shares. Built once by
// main.js from the seeded rng; config.js supplies grid and palettes.
// Solmar Bay: a sun-soaked island city built entirely from procedural
// meshes — road grid, tower blocks with lit windows, palms, streetlights,
// a beach boardwalk with stalls and umbrellas, the ocean and a marina.
// Owns the lighting rig (day / dusk / night), the building collision
// boxes and the circle-vs-box push-out every mover uses.

import { BLOCK, BLOCK_CENTERS, PALETTE, ROAD, ROAD_LINES, TIMES_OF_DAY, clamp, pick, rand } from './config.js';

// Push a circle (pos = {x, z} mutated in place) out of every AABB.
// Returns the hardest impact speed along the push normal, for crash checks.
export function pushOutOfBoxes(pos, radius, boxes, vel) {
  let impact = 0;
  for (const b of boxes) {
    const nx = clamp(pos.x, b.x0, b.x1);
    const nz = clamp(pos.z, b.z0, b.z1);
    let dx = pos.x - nx;
    let dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 < 1e-6) {
      // Centre inside the box: leave by the shallowest face.
      const left = pos.x - b.x0, right = b.x1 - pos.x, top = pos.z - b.z0, bot = b.z1 - pos.z;
      const m = Math.min(left, right, top, bot);
      if (m === left) { pos.x = b.x0 - radius; dx = -1; dz = 0; }
      else if (m === right) { pos.x = b.x1 + radius; dx = 1; dz = 0; }
      else if (m === top) { pos.z = b.z0 - radius; dx = 0; dz = -1; }
      else { pos.z = b.z1 + radius; dx = 0; dz = 1; }
    } else {
      const d = Math.sqrt(d2);
      dx /= d; dz /= d;
      pos.x = nx + dx * radius;
      pos.z = nz + dz * radius;
    }
    if (vel) {
      const vn = vel.x * dx + vel.z * dz;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        vel.x -= vn * dx * 1.3;
        vel.z -= vn * dz * 1.3;
      }
    }
  }
  return impact;
}

// Facade windows on a fine grid, so a tower reads as hundreds of lit
// rooms from the air instead of a coarse checker. `darkRatio` is the
// share of windows left dark; the dusk set keeps far more windows lit
// and burns warmer, so the sunset city glows instead of going flat.
function windowTexture(rng, darkRatio, cols, rows, warm = false) {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#2a3242'; g.fillRect(0, 0, 192, 384);
  const cw = 192 / cols, ch = 384 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rng() > darkRatio;
      if (lit) {
        const cool = warm ? rng() > 0.78 : rng() > 0.45;
        g.fillStyle = cool ? '#a8d8ff' : (rng() > 0.5 ? '#ffd98a' : '#ffc46b');
      } else {
        g.fillStyle = warm ? '#3d3648' : '#46536a';
      }
      g.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.2, cw * 0.6, ch * 0.6);
    }
  }
  return new THREE.CanvasTexture(c);
}

// A vertical sky gradient — deep zenith, bright middle, warm horizon —
// painted once per time of day and used as the scene background, so the
// light feels like weather instead of a flat fill.
function skyTexture(top, mid, horizon) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, mid);
  grad.addColorStop(0.78, horizon);
  grad.addColorStop(1, horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  return new THREE.CanvasTexture(c);
}

const SKIES = {
  day: ['#2b6fd6', '#59b7e8', '#ffdfae'],
  dusk: ['#241a3e', '#53355e', '#ff9a5c'],
  night: ['#040814', '#0d1526', '#2a4a73'],
};

// Speckled sand: a white canvas freckled with warm grit, multiplied over
// the ground colour so the beach reads as grain up close instead of one
// flat fill stretching to the horizon.
function sandTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  const tones = ['#d8c39a', '#c8ab74', '#e8d4a8', '#bfa06a', '#efe0ba'];
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = tones[Math.floor(rng() * tones.length)];
    g.globalAlpha = 0.25 + rng() * 0.4;
    const s = 1 + rng() * 2.2;
    g.fillRect(rng() * 256, rng() * 256, s, s);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(11, 11);
  return tex;
}

function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.font = 'bold 54px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg;
  g.fillText(text, 256, 52);
  return new THREE.CanvasTexture(c);
}

const TINTS = [0xe8dcc8, 0xc4d4e2, 0xf2c4ae, 0xb4cbe8, 0xe2daea, 0xcde4cc, 0xf6e2ac, 0xdbb2bc];

export function buildWorld(scene, rng) {
  const ISLAND_SPAN = 452; // the island slab's width/depth; ground planes match it
  const colliders = [];
  const parkingSpots = [];
  const benchSpots = [];   // {x, z, heading} — where a sitter faces the view
  const stallSpots = [];   // {x, z} — boardwalk stalls, browsers stand in front
  const boats = [];
  const waves = [];

  // ---- lighting rig ------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xcfeaff, 0x8a7a5a, 1.05);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xfff3cf, 1.25);
  sunLight.position.set(-140, 260, -160);
  scene.add(sunLight);
  const ambient = new THREE.AmbientLight(0x8899bb, 0.35);
  scene.add(ambient);
  scene.fog = new THREE.Fog(PALETTE.fog, 210, 980);

  // The sun (or moon) disc, repositioned by setTimeOfDay.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(30, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  scene.add(sunDisc);

  const skyTextures = {};
  for (const [mode, cols] of Object.entries(SKIES)) skyTextures[mode] = skyTexture(...cols);

  function setTimeOfDay(mode) {
    const t = TIMES_OF_DAY[mode] || TIMES_OF_DAY.day;
    scene.background = skyTextures[mode] || skyTextures.day;
    scene.fog.color.setHex(t.fog);
    scene.fog.near = t.fogNear;
    scene.fog.far = t.fogFar;
    sunLight.color.setHex(t.sunColor);
    sunLight.intensity = t.sunIntensity;
    sunLight.position.set(t.sunPos[0], t.sunPos[1], t.sunPos[2]);
    hemi.color.setHex(t.hemiSky);
    hemi.groundColor.setHex(t.hemiGround);
    hemi.intensity = t.hemiIntensity;
    ambient.color.setHex(t.ambient);
    ambient.intensity = t.ambientIntensity;
    sunDisc.material.color.setHex(t.sunDisc);
    const dir = new THREE.Vector3(t.sunPos[0], Math.max(t.sunPos[1], 120), t.sunPos[2]).normalize();
    sunDisc.position.copy(dir.multiplyScalar(760));
    sunDisc.lookAt(0, 30, 0);
    // Facades follow the light: day faces are half-lit, dusk and night
    // faces burn warm with most windows on.
    const texSet = mode === 'day' ? winTexes : winTexesDusk;
    for (const f of facadeMats) {
      if (f.mat.map !== texSet[f.idx]) { f.mat.map = texSet[f.idx]; f.mat.needsUpdate = true; }
    }
    world.timeOfDay = mode;
  }

  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

  // Base island (sand) under everything, then the city slab.
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground, map: sandTexture(rng) }),
  );
  base.rotation.x = -Math.PI / 2; base.position.y = -0.08;
  scene.add(base);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(ISLAND_SPAN, 1, ISLAND_SPAN), lambert(PALETTE.slab));
  slab.position.y = -0.5;
  scene.add(slab);

  // Roads: dark strips along every grid line, both directions.
  const roadMat = lambert(PALETTE.road);
  for (const line of ROAD_LINES) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, ISLAND_SPAN), roadMat);
    v.rotation.x = -Math.PI / 2; v.position.set(line, 0.02, 0);
    scene.add(v);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(ISLAND_SPAN, ROAD), roadMat);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.021, line);
    scene.add(h);
  }
  // The Strand promenade: a paler cruise strip along the beach road.
  const strand = new THREE.Mesh(new THREE.PlaneGeometry(ISLAND_SPAN, 7), lambert(0xcbb59a));
  strand.rotation.x = -Math.PI / 2; strand.position.set(0, 0.03, 207);
  scene.add(strand);
  // The same promenade turns the corner and runs down the east coast road,
  // so the shore reads as one continuous leisure strip.
  const strandE = new THREE.Mesh(new THREE.PlaneGeometry(7, ISLAND_SPAN), lambert(0xcbb59a));
  strandE.rotation.x = -Math.PI / 2; strandE.position.set(207, 0.03, 0);
  scene.add(strandE);
  // Dune-grass strips between promenade and boardwalk, and down the east
  // side too — a band of green that separates pavement from sand.
  const grassMat = lambert(0x639e4a);
  const grassN = new THREE.Mesh(new THREE.PlaneGeometry(ISLAND_SPAN, 3.6), grassMat);
  grassN.rotation.x = -Math.PI / 2; grassN.position.set(0, 0.025, 219.6);
  scene.add(grassN);
  const grassE = new THREE.Mesh(new THREE.PlaneGeometry(3.6, ISLAND_SPAN), grassMat);
  grassE.rotation.x = -Math.PI / 2; grassE.position.set(219.6, 0.025, 0);
  scene.add(grassE);

  // Painted crosswalks at every junction: worn zebra bars on all four
  // approaches, instanced in one draw. Plus scuffed, tyre-darkened patches
  // scattered over the asphalt so the roads look driven on, not printed.
  {
    const dummy = new THREE.Object3D();
    const bars = [];
    for (const lx of ROAD_LINES) {
      for (const lz of ROAD_LINES) {
        // Crossing the vertical road (walking east-west): bars lie in a
        // band just outside the junction box, repeated across the road.
        for (const bz of [lz - ROAD / 2 - 2.2, lz + ROAD / 2 + 2.2]) {
          for (let bx = lx - ROAD / 2 + 2.6; bx <= lx + ROAD / 2 - 2.6; bx += 2.3) {
            bars.push([bx, bz, 0]);
          }
        }
        // Crossing the horizontal road (walking north-south).
        for (const bx of [lx - ROAD / 2 - 2.2, lx + ROAD / 2 + 2.2]) {
          for (let bz = lz - ROAD / 2 + 2.6; bz <= lz + ROAD / 2 - 2.6; bz += 2.3) {
            bars.push([bx, bz, Math.PI / 2]);
          }
        }
      }
    }
    const barGeo = new THREE.PlaneGeometry(1.15, 3.1);
    const barMat = new THREE.MeshBasicMaterial({ color: 0xe3ddc8, transparent: true, opacity: 0.62 });
    const crosswalks = new THREE.InstancedMesh(barGeo, barMat, bars.length);
    bars.forEach(([x, z, ry], i) => {
      dummy.position.set(x, 0.045, z);
      dummy.rotation.set(-Math.PI / 2, 0, ry);
      dummy.updateMatrix();
      crosswalks.setMatrixAt(i, dummy.matrix);
    });
    crosswalks.renderOrder = 1;
    scene.add(crosswalks);

    const scuffGeo = new THREE.CircleGeometry(1, 12);
    const scuffMat = new THREE.MeshBasicMaterial({ color: 0x06080c, transparent: true, opacity: 0.13, depthWrite: false });
    const scuffs = new THREE.InstancedMesh(scuffGeo, scuffMat, 52);
    for (let i = 0; i < 52; i++) {
      const onVert = rng() > 0.5;
      const line = pick(rng, ROAD_LINES) + rand(rng, -6, 6);
      const t = rand(rng, -205, 205);
      dummy.position.set(onVert ? line : t, 0.032, onVert ? t : line);
      dummy.rotation.set(-Math.PI / 2, 0, rand(rng, 0, Math.PI));
      dummy.scale.set(rand(rng, 1.6, 4.6), rand(rng, 0.8, 2.0), 1);
      dummy.updateMatrix();
      scuffs.setMatrixAt(i, dummy.matrix);
    }
    dummy.scale.set(1, 1, 1);
    scuffs.renderOrder = 1;
    scene.add(scuffs);
  }

  // Dashed centre lines, instanced.
  {
    const geo = new THREE.PlaneGeometry(0.35, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8d8c8 });
    const spots = [];
    for (const line of ROAD_LINES) {
      for (let t = -216; t <= 216; t += 10) {
        if (!ROAD_LINES.some((l) => Math.abs(t - l) < 15)) { spots.push([line, t, 0]); spots.push([t, line, 1]); }
      }
    }
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    const dummy = new THREE.Object3D();
    spots.forEach(([x, z, horiz], i) => {
      dummy.position.set(x, 0.035, z);
      dummy.rotation.set(-Math.PI / 2, 0, horiz ? Math.PI / 2 : 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(inst);
  }

  // Buildings, block by block. A few blocks are landmarks or parking lots.
  // Three window patterns — density and lit ratio differ — so towers do
  // not all wear the same face. A parallel dusk set keeps the windows
  // burning after sunset; setTimeOfDay swaps each facade between them.
  const winTexes = [
    windowTexture(rng, 0.42, 12, 28),
    windowTexture(rng, 0.55, 9, 20),
    windowTexture(rng, 0.3, 14, 34),
  ];
  const winTexesDusk = [
    windowTexture(rng, 0.16, 12, 28, true),
    windowTexture(rng, 0.24, 9, 20, true),
    windowTexture(rng, 0.12, 14, 34, true),
  ];
  const facadeMats = []; // { mat, idx } — every building face, for the swap
  const roofMat = lambert(0x3a3f47);
  const walkMat = lambert(PALETTE.walk);
  const LANDMARKS = {
    bank: { cx: 96, cz: -96 },
    garage: { cx: -160, cz: 32 },
    safehouse: { cx: 160, cz: 96 },
    hotel: { cx: -32, cz: 160 },
  };
  const landmarkAt = (cx, cz) => Object.entries(LANDMARKS).find(([, v]) => v.cx === cx && v.cz === cz)?.[0];

  function addSign(x, y, z, w, text, bg, fg, rotY = 0) {
    const s = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.19),
      new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) }),
    );
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    scene.add(s);
    return s;
  }

  const SHOP_SIGNS = [
    { text: 'CAFE BRISA', bg: '#2e1a08', fg: '#ffb347' },
    { text: 'SURF SHACK', bg: '#0d4a5a', fg: '#aef2ff' },
    { text: 'PAWN & CO', bg: '#101c2e', fg: '#53e9ff' },
    { text: 'DELI MAR', bg: '#2e0d16', fg: '#ff7a59' },
    { text: 'BARBER SOL', bg: '#131a2e', fg: '#b78bff' },
    { text: 'FLORIST LIA', bg: '#10302a', fg: '#7fe8c9' },
    { text: 'TACOS REY', bg: '#40102a', fg: '#ff9fd0' },
    { text: 'BYTE REPAIR', bg: '#1c0b2e', fg: '#ff5fd2' },
  ];
  const AWNING_COLORS = [0xff6b35, 0x00b8a9, 0xf48498, 0xffc53d, 0x277da1, 0xe85447];

  const ROOF_ADS = [
    { text: 'SOLMAR AIR', bg: '#0d2436', fg: '#7fe8c9' },
    { text: 'BAY RADIO 98.1', bg: '#2e0d16', fg: '#ff7a59' },
    { text: 'DRINK SOLA COLA', bg: '#7a1030', fg: '#ffe9a8' },
    { text: 'SURF SHACK', bg: '#0d4a5a', fg: '#aef2ff' },
  ];

  function addBuilding(x, z, w, d, h, tint, sign) {
    const texIdx = Math.abs(Math.round(x * 3 + z * 7)) % winTexes.length;
    const mat = new THREE.MeshLambertMaterial({ map: winTexes[texIdx], color: tint });
    facadeMats.push({ mat, idx: texIdx });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2 + 0.15, z);
    scene.add(b);
    // A position hash dresses the roofline without touching the shared
    // rng stream, so the seeded city layout never shifts: stepped crown
    // tiers on tall towers, extra AC boxes, and — on the tallest — a
    // rooftop billboard facing the bay.
    const hash = Math.abs(Math.round(x * 13 + z * 29)) % 10;
    if (h >= 30 && hash < 5) {
      const crownH = Math.max(2.2, h * 0.16);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, crownH, d * 0.62), mat);
      crown.position.set(x, h + 0.15 + crownH / 2, z);
      scene.add(crown);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.68, 0.4, d * 0.68), roofMat);
      cap.position.set(x, h + 0.15 + crownH + 0.2, z);
      scene.add(cap);
    }
    if (h >= 36 && hash >= 7) {
      const ad = ROOF_ADS[Math.abs(Math.round(x + z)) % ROOF_ADS.length];
      const bw = Math.min(w * 0.85, 17);
      const postMat = lambert(0x2c313a);
      for (const px of [-bw * 0.32, bw * 0.32]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.35), postMat);
        post.position.set(x + px, h + 1.9, z);
        scene.add(post);
      }
      const board = new THREE.Mesh(new THREE.BoxGeometry(bw, 3.6, 0.3), postMat);
      board.position.set(x, h + 4.6, z);
      scene.add(board);
      addSign(x, h + 4.6, z + 0.22, bw * 0.94, ad.text, ad.bg, ad.fg);
    }
    if (h >= 14 && hash % 3 === 0) {
      const ac2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 2), lambert(0x8b95a1));
      ac2.position.set(x - w * 0.26, h + 1.1, z + d * 0.24);
      scene.add(ac2);
    }
    // Ground-floor life on the plainer buildings: a darker storefront
    // band, a striped awning over the pavement, and — half the time — a
    // little shop sign of its own above the awning.
    if (!sign && h <= 36 && rng() < 0.62) {
      const bandMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(tint).multiplyScalar(0.5),
      });
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 2.5, d + 0.4), bandMat);
      band.position.set(x, 1.25, z);
      scene.add(band);
      const awnMat = lambert(pick(rng, AWNING_COLORS));
      const awnW = Math.min(w * 0.62, 11);
      for (const face of [1, -1]) {
        if (face < 0 && rng() < 0.5) continue; // some shops dress one side only
        const awn = new THREE.Mesh(new THREE.BoxGeometry(awnW, 0.16, 1.7), awnMat);
        awn.position.set(x, 2.95, z + face * (d / 2 + 0.85));
        awn.rotation.x = face * 0.32;
        scene.add(awn);
      }
      if (rng() < 0.55) {
        const s = pick(rng, SHOP_SIGNS);
        addSign(x, 4.15, z + d / 2 + 0.07, Math.min(w * 0.7, 12), s.text, s.bg, s.fg);
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.5, d + 0.7), roofMat);
    roof.position.set(x, h + 0.4, z);
    scene.add(roof);
    // Rooftop clutter on taller towers: AC boxes and a water tank.
    if (h > 26) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 2.6), lambert(0x9aa2ac));
      ac.position.set(x + w * 0.22, h + 1.3, z - d * 0.2);
      scene.add(ac);
      if (rng() > 0.5) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.4, 9), lambert(0x8a6a4a));
        tank.position.set(x - w * 0.24, h + 2.3, z + d * 0.18);
        scene.add(tank);
      }
    }
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
    if (sign) addSign(x, h - 2.2, z + d / 2 + 0.06, Math.min(w * 0.9, 22), sign.text, sign.bg, sign.fg);
  }

  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(BLOCK + 8, 0.3, BLOCK + 8), walkMat);
      walk.position.set(cx, 0.0, cz);
      scene.add(walk);
      const lm = landmarkAt(cx, cz);
      if (lm === 'bank') { addBuilding(cx, cz, 30, 30, 52, 0xf2d492, { text: 'SOLMAR BANK', bg: '#3a2f10', fg: '#ffd94a' }); continue; }
      if (lm === 'garage') { addBuilding(cx, cz, 34, 26, 9, 0xd88f4a, { text: "OKAFOR'S GARAGE", bg: '#40260e', fg: '#ffb36b' }); continue; }
      if (lm === 'safehouse') { addBuilding(cx, cz, 24, 24, 20, 0x9fd8c9, { text: 'PALM COURT', bg: '#10302a', fg: '#7fe8c9' }); continue; }
      if (lm === 'hotel') { addBuilding(cx, cz, 28, 28, 44, 0xf2a8c0, { text: 'HOTEL SOLMAR', bg: '#40102a', fg: '#ff9fd0' }); continue; }
      const roll = rng();
      if (roll < 0.15) {
        // Open parking lot: four spots, no tower.
        for (const dx of [-10, 10]) {
          for (const dz of [-9, 9]) parkingSpots.push({ x: cx + dx, z: cz + dz, heading: 0 });
        }
        continue;
      }
      if (roll < 0.45) {
        addBuilding(cx, cz, rand(rng, 26, 32), rand(rng, 26, 32), rand(rng, 18, 58), pick(rng, TINTS));
      } else if (roll < 0.75) {
        // Four to a block, but never four the same: one corner — picked
        // by hash so it varies block to block — rises as the block's
        // tower while its neighbours stay low, so the skyline steps
        // inside every block instead of slabbing.
        const tallCorner = Math.abs(Math.round(cx * 5 + cz * 11)) % 4;
        let ci = 0;
        for (const dx of [-10.5, 10.5]) {
          for (const dz of [-10.5, 10.5]) {
            if (rng() < 0.85) {
              const hgt = ci === tallCorner ? rand(rng, 26, 44) : rand(rng, 8, 24);
              addBuilding(cx + dx, cz + dz, 17, 17, hgt, pick(rng, TINTS));
            }
            ci++;
          }
        }
      } else {
        addBuilding(cx - 10, cz, 18, 30, rand(rng, 14, 38), pick(rng, TINTS));
        addBuilding(cx + 11, cz, 16, 22, rand(rng, 8, 24), pick(rng, TINTS));
      }
      // Curbside parking along the south edge of most blocks.
      if (rng() < 0.62) {
        parkingSpots.push({ x: cx - 10, z: cz + BLOCK / 2 + 4.5, heading: Math.PI / 2 });
        parkingSpots.push({ x: cx + 10, z: cz + BLOCK / 2 + 4.5, heading: Math.PI / 2 });
      }
    }
  }

  // A helipad crowns the bank tower — from the air it is the one roof in
  // the bay that reads as a destination, not just a lid.
  {
    const bx = LANDMARKS.bank.cx, bz = LANDMARKS.bank.cz, topY = 52 + 0.72;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(7.4, 26),
      new THREE.MeshLambertMaterial({ color: 0x2c313a }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(bx, topY, bz);
    scene.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.1, 6.9, 26),
      new THREE.MeshBasicMaterial({ color: 0xf5f0e6 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(bx, topY + 0.02, bz);
    scene.add(ring);
    const hMark = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.MeshBasicMaterial({ map: signTexture('H', '#2c313a', '#ffd94a') }));
    hMark.rotation.x = -Math.PI / 2;
    hMark.position.set(bx, topY + 0.03, bz);
    scene.add(hMark);
  }

  // Neon signs for the night city: bright basic-material boards that stay
  // lit when the Lambert towers go dark. Shops of Solmar Bay, all original.
  const NEON = [
    { x: -32, y: 12, z: 132.4, w: 15, text: 'CLUB VELVETINA', bg: '#1c0b2e', fg: '#ff5fd2' },
    { x: 32.4, y: 10, z: -32, w: 14, text: 'NOODLE NEST', bg: '#101c2e', fg: '#53e9ff', rotY: Math.PI / 2 },
    { x: -96, y: 9, z: -68.4, w: 14, text: 'MARKET HALL', bg: '#2e1a08', fg: '#ffb347' },
    { x: 96, y: 11, z: 68.4, w: 15, text: 'CINEMA LUMIERE', bg: '#0d2436', fg: '#7fe8c9' },
    { x: -160, y: 8, z: 164.4, w: 13, text: 'TACO BRISA', bg: '#2e0d16', fg: '#ff7a59' },
    { x: 160, y: 10, z: -164.4, w: 14, text: 'GYM TONIQ', bg: '#131a2e', fg: '#b78bff', rotY: Math.PI },
  ];
  for (const n of NEON) addSign(n.x, n.y, n.z, n.w, n.text, n.bg, n.fg, n.rotY || 0);

  // Rooftop billboards over Midtown.
  addSign(0, 47, -32 - 15.4, 20, 'DRINK SOLA COLA', '#7a1030', '#ffe9a8');
  addSign(64, 41, 32 + 15.4, 18, 'VISIT THE STRAND', '#0d4a5a', '#aef2ff');

  // Palms: a beach row, a Strand boulevard row, plus scattered corners.
  const trunkMat = lambert(0x8a6a42);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2fae4e, side: THREE.DoubleSide });
  function addPalm(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 4.6, 6), trunkMat);
    trunk.position.y = 2.3;
    trunk.rotation.z = rand(rng, -0.14, 0.14);
    g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.7), frondMat);
      const a = (i / 5) * Math.PI * 2;
      f.position.set(Math.sin(a) * 0.9, 4.85, Math.cos(a) * 0.9);
      f.rotation.set(0.9, a, 0, 'YXZ');
      g.add(f);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  }
  for (let x = -208; x <= 208; x += 15) addPalm(x + rand(rng, -3, 3), 224 + rand(rng, -2, 3));
  for (let x = -200; x <= 200; x += 26) addPalm(x + rand(rng, -2, 2), 205 + rand(rng, -1.5, 1.5));
  for (let z = -180; z <= 180; z += 30) addPalm(205 + rand(rng, -1.5, 1.5), z + rand(rng, -3, 3));
  // A second beach row between the grass and the boardwalk, a matching
  // row down the east sand, and a cluster shading the marina pier — from
  // the air the shore should read as one continuous palm fringe.
  for (let x = -204; x <= 204; x += 17) addPalm(x + rand(rng, -2.5, 2.5), 228.5 + rand(rng, -1.5, 1.5));
  for (let z = -196; z <= 196; z += 24) addPalm(224 + rand(rng, -2, 2), z + rand(rng, -2.5, 2.5));
  for (const [px, pz] of [[112, 246], [120, 250], [142, 246], [148, 252], [106, 254]]) addPalm(px, pz);
  for (let i = 0; i < 42; i++) {
    const cx = pick(rng, BLOCK_CENTERS), cz = pick(rng, BLOCK_CENTERS);
    addPalm(cx + (rng() > 0.5 ? 23 : -23), cz + (rng() > 0.5 ? 23 : -23));
  }

  // Streetlights: instanced poles and lamp heads along the roads.
  {
    const positions = [];
    for (const line of ROAD_LINES) {
      for (let t = -208; t <= 208; t += 64) {
        positions.push([line + ROAD / 2 + 1.2, t + 20]);
        positions.push([t + 20, line - ROAD / 2 - 1.2]);
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 7, 5);
    const poles = new THREE.InstancedMesh(poleGeo, lambert(0x3a3f46), positions.length);
    const lampGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffca7a });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach(([x, z], i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, 3.5, z);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 7.05;
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
    });
    scene.add(poles); scene.add(lamps);
  }

  // Benches and planters along the sidewalks and the promenade (instanced).
  {
    const spots = [];
    // Each spot also records the heading a seated person faces — out to
    // the sea on the promenade, across the road on the sidewalks — so the
    // pedestrian system can park sitters who read as watching the world.
    for (let x = -196; x <= 196; x += 28) {
      spots.push([x, 214.5, 0]);
      benchSpots.push({ x, z: 214.5, heading: 0 });
      spots.push([x + 14, 181, Math.PI / 2]);
      benchSpots.push({ x: x + 14, z: 181, heading: 0 });
    }
    for (let z = -196; z <= 196; z += 56) {
      spots.push([214.5, z, Math.PI / 2]);
      benchSpots.push({ x: 214.5, z, heading: -Math.PI / 2 });
    }
    for (const cx of BLOCK_CENTERS) for (const cz of BLOCK_CENTERS) {
      if (rng() > 0.45) {
        spots.push([cx - 25.5, cz + 14, Math.PI / 2]);
        benchSpots.push({ x: cx - 25.5, z: cz + 14, heading: -Math.PI / 2 });
      }
      if (rng() > 0.45) {
        spots.push([cx + 25.5, cz - 14, Math.PI / 2]);
        benchSpots.push({ x: cx + 25.5, z: cz - 14, heading: Math.PI / 2 });
      }
    }
    const benchGeo = new THREE.BoxGeometry(2.4, 0.5, 0.7);
    const benches = new THREE.InstancedMesh(benchGeo, lambert(0x7a5c38), spots.length);
    const dummy = new THREE.Object3D();
    spots.forEach(([x, z, ry], i) => {
      dummy.position.set(x, 0.45, z);
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      benches.setMatrixAt(i, dummy.matrix);
    });
    scene.add(benches);
  }

  // Street furniture: hydrants on the corners, coloured news boxes by the
  // crossings, planters lining the boulevard and the promenade.
  {
    const dummy = new THREE.Object3D();
    const hydSpots = [];
    const newsSpots = [];
    for (const cx of BLOCK_CENTERS) for (const cz of BLOCK_CENTERS) {
      if (rng() > 0.45) hydSpots.push([cx + (rng() > 0.5 ? 25.2 : -25.2), cz + (rng() > 0.5 ? 25.2 : -25.2)]);
      if (rng() > 0.55) newsSpots.push([cx - 25.2, cz + 25.2, rand(rng, 0, Math.PI)]);
    }
    for (let x = -180; x <= 180; x += 60) newsSpots.push([x, 210.5, 0]);
    const hydGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8);
    const hydrants = new THREE.InstancedMesh(hydGeo, lambert(0xd64541), hydSpots.length);
    hydSpots.forEach(([x, z], i) => {
      dummy.position.set(x, 0.31, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      hydrants.setMatrixAt(i, dummy.matrix);
    });
    scene.add(hydrants);
    const newsGeo = new THREE.BoxGeometry(0.72, 0.98, 0.55);
    const newsBoxes = new THREE.InstancedMesh(newsGeo, lambert(0xffffff), newsSpots.length);
    const newsColors = [0x2e86de, 0xd64541, 0xf6b93b, 0x57606f];
    newsSpots.forEach(([x, z, ry], i) => {
      dummy.position.set(x, 0.49, z);
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      newsBoxes.setMatrixAt(i, dummy.matrix);
      newsBoxes.setColorAt(i, new THREE.Color(newsColors[i % newsColors.length]));
    });
    scene.add(newsBoxes);
    const plantSpots = [];
    for (let x = -196; x <= 196; x += 24) { plantSpots.push([x, 182.8]); plantSpots.push([x + 12, 209.5]); }
    for (let z = -160; z <= 160; z += 64) plantSpots.push([-56.5, z]);
    const potGeo = new THREE.BoxGeometry(1.7, 0.52, 0.65);
    const pots = new THREE.InstancedMesh(potGeo, lambert(0x8d9299), plantSpots.length);
    const topGeo = new THREE.BoxGeometry(1.55, 0.3, 0.5);
    const tops = new THREE.InstancedMesh(topGeo, lambert(0x3f9e4d), plantSpots.length);
    plantSpots.forEach(([x, z], i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, 0.26, z);
      dummy.updateMatrix();
      pots.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.62;
      dummy.updateMatrix();
      tops.setMatrixAt(i, dummy.matrix);
    });
    scene.add(pots); scene.add(tops);
  }

  // The boardwalk: a timber deck along the sand, with stalls and umbrellas.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(ISLAND_SPAN, 0.35, 9), lambert(0xa8815c));
  deck.position.set(0, 0.1, 236);
  scene.add(deck);
  const stallColors = [0xff6b35, 0x00b8a9, 0xf48498, 0xffc53d, 0x277da1];
  for (let i = 0; i < 7; i++) {
    const x = -192 + i * 62 + rand(rng, -8, 8);
    stallSpots.push({ x, z: 240 });
    const stall = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.6, 3.4), lambert(0xf0e6d4));
    box.position.y = 1.3;
    stall.add(box);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.25, 4.4), lambert(stallColors[i % stallColors.length]));
    awning.position.y = 2.85;
    awning.rotation.x = 0.16;
    stall.add(awning);
    stall.position.set(x, 0.25, 240);
    scene.add(stall);
    colliders.push({ x0: x - 2.7, z0: 238.3, x1: x + 2.7, z1: 241.7 });
  }
  const umbColors = [0xff5964, 0xffd94a, 0x4ecdc4, 0xf48498, 0x7fb069];
  for (let i = 0; i < 16; i++) {
    const x = rand(rng, -214, 214), z = rand(rng, 246, 262);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), lambert(0xd8d8d8));
    pole.position.set(x, 1.3, z);
    scene.add(pole);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(2.3, 0.8, 9), lambert(umbColors[i % umbColors.length]));
    shade.position.set(x, 2.7, z);
    scene.add(shade);
  }

  // Beach foam lines and the ocean. The shore grades through three
  // bands — wet packed sand at the waterline, a pale turquoise shallow,
  // then the deep bay — so the coast reads as terrain, not a colour edge.
  const wetSand = new THREE.Mesh(new THREE.PlaneGeometry(560, 10), lambert(0xbd9a63));
  wetSand.rotation.x = -Math.PI / 2;
  wetSand.position.set(0, 0.004, 248.5);
  scene.add(wetSand);
  // Both water bands sit a hair ABOVE the island base plane (-0.08):
  // below it they were swallowed whole and the bay never showed.
  const shallow = new THREE.Mesh(new THREE.PlaneGeometry(1600, 96), lambert(0x2f9dbd));
  shallow.rotation.x = -Math.PI / 2;
  shallow.position.set(0, -0.02, 252 + 48);
  scene.add(shallow);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1600, 560), lambert(PALETTE.water));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.045, 252 + 280);
  scene.add(ocean);
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(
      new THREE.PlaneGeometry(ISLAND_SPAN, 1.1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    w.rotation.x = -Math.PI / 2;
    w.position.set(0, 0.02 + i * 0.005, 250 + i * 3.4);
    scene.add(w);
    waves.push({ mesh: w, phase: i * 1.7 });
  }

  // Marina: a pier reaching into the bay, with simple boats alongside.
  const pierMat = lambert(0x7a6248);
  const pier = new THREE.Mesh(new THREE.BoxGeometry(8, 0.7, 74), pierMat);
  pier.position.set(128, 0.35, 252 + 37);
  scene.add(pier);
  const hullColors = [0xf5f6fa, 0xd64541, 0x2e86de, 0xf6b93b, 0x1dd1a1];
  for (let i = 0; i < 5; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 8.5), lambert(hullColors[i]));
    hull.position.y = 0.4;
    boat.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.1, 3), lambert(0xf0f0f0));
    cabin.position.set(0, 1.4, -0.6);
    boat.add(cabin);
    boat.position.set(i % 2 === 0 ? 118.5 : 137.5, 0, 266 + i * 12);
    boat.rotation.y = rand(rng, -0.12, 0.12);
    scene.add(boat);
    boats.push({ group: boat, phase: rand(rng, 0, 6) });
  }

  const landmarks = {
    garage: { x: -134, z: 32 },
    bank: { x: 96, z: -68 },
    safehouse: { x: 134, z: 96 },
    hotel: { x: -32, z: 132 },
    marina: { x: 128, z: 244 },
    packageSpot: { x: -128, z: -160 },
    pickupSpot: { x: 160, z: -160 },
    farCorner: { x: 182, z: -182 },
  };

  // Stunt ramps: four wedges bolted to the asphalt at known spots. Hit
  // one fast enough, aimed along its heading, and the car leaves the
  // ground — the launch and the landing are judged in main.js, and the
  // pause map marks each ramp with an orange triangle.
  const stuntRamps = [
    { x: 0, z: -96, heading: 0 },
    { x: -96, z: 64, heading: Math.PI / 2 },
    { x: 96, z: 150, heading: Math.PI },
    { x: 150, z: 192, heading: -Math.PI / 2 },
  ];
  for (const ramp of stuntRamps) {
    const g = new THREE.Group();
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 5.4), lambert(0x3a3f47));
    wedge.rotation.x = -0.36;
    wedge.position.y = 0.42;
    g.add(wedge);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 4.6),
      new THREE.MeshLambertMaterial({ color: 0xffc53d }));
    stripe.rotation.x = -0.36;
    stripe.position.y = 0.92;
    g.add(stripe);
    g.position.set(ramp.x, 0, ramp.z);
    g.rotation.y = ramp.heading;
    scene.add(g);
  }

  const world = {
    colliders,
    parkingSpots,
    benchSpots,
    stallSpots,
    stuntRamps,
    landmarks,
    timeOfDay: 'day',
    setTimeOfDay,
    update(dt, t) {
      for (const w of waves) {
        w.mesh.position.z = 250 + Math.sin(t * 0.7 + w.phase) * 1.6 + (w.phase * 2);
        w.mesh.material.opacity = 0.22 + 0.16 * Math.sin(t * 0.9 + w.phase);
      }
      for (const b of boats) {
        b.group.position.y = Math.sin(t * 0.8 + b.phase) * 0.16;
        b.group.rotation.z = Math.sin(t * 0.6 + b.phase) * 0.03;
      }
    },
  };
  setTimeOfDay('day');
  return world;
}
