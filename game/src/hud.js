// ── hud.js — every 2D overlay: HUD panels, screens, and both maps.
// Exports: HUD (set* panel writers, showScreen, drawMinimap,
// drawPauseMap, fillPause, fillTitle). main.js feeds it live state each
// frame; it reads the DOM built by index.html and the career data in
// stats.js / save.js. It owns no game state of its own.
// HUD: cash, wanted stars and the heat label, health and armour bars,
// the mission panel with its stage tracker and NEXT line, the SBPD
// response panel (unit callsigns, roles, distances), the crew panel with
// ability cooldowns, weapon slots with ammo, the district and rank
// panels, dialogue, toasts, prompts, the BUSTED meter, the race clock,
// overlay screens, and the canvas minimap: a real street map of Solmar
// Bay — district-coloured blocks, pale roads, the beach and the water,
// landmark marks, a route line to the objective, and blips for police,
// traffic, pedestrians and the crew riding with the player.

import { BLOCK, BLOCK_CENTERS, DISTRICTS, ROAD, ROAD_LINES, districtAt, rankFor, standingLabel } from './config.js';
import { MISSION_NAMES } from './missions.js';
import { COLLECTIBLE_SPOTS } from './collectibles.js';

// Minimap colours, one per district, so the map reads as places, not grid.
const MAP_DISTRICT_COLORS = {
  strand: '#dcbd7f', market: '#c08b5e', bankrow: '#7e93ad',
  palm: '#82b06d', midtown: '#97a3b4',
};
const MAP_CREW_COLORS = ['#ff9f43', '#54c8ff', '#b78bff'];
// The map window: x -245…245, z -225…265 (square, so nothing stretches,
// and the sand and water south of the city fit inside the frame).
const MAP_MIN_X = -245, MAP_MIN_Z = -225, MAP_SPAN = 490;
// Index of the Harbor Sprint in the mission list — the one job whose
// stages carry race gates, drawn as a course on the pause map.
const RACE_MISSION_INDEX = 4;

// Shift a #rrggbb colour lighter (f > 1) or darker (f < 1).
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.cashEl = $('cash');
    this.starsEl = $('stars');
    this.heatEl = $('heatLabel');
    this.healthFill = $('healthFill');
    this.armourFill = $('armourFill');
    this.speedEl = $('speedVal');
    this.objTitleEl = $('objTitle');
    this.objStageEl = $('objStage');
    this.objTextEl = $('objText');
    this.objNextEl = $('objNext');
    this.objWrap = $('objective');
    this.policePanel = $('policePanel');
    this.policeTitle = $('policeTitle');
    this.policeRows = $('policeRows');
    this.crewRows = $('crewRows');
    this.weaponPanel = $('weaponPanel');
    this.districtName = $('districtName');
    this.standingLabelEl = $('standingLabel');
    this.standingMeter = $('standingMeter');
    this.rankName = $('rankName');
    this.rpFill = $('rpFill');
    this.rpText = $('rpText');
    this.vehicleName = $('vehicleName');
    this.vehDmgRow = $('vehDmgRow');
    this.dialogue = $('dialogue');
    this.dlgChip = $('dlgChip');
    this.dlgName = $('dlgName');
    this.dlgLine = $('dlgLine');
    this.toastEl = $('toast');
    this.promptEl = $('prompt');
    this.bustedWrap = $('bustedWrap');
    this.bustedFill = $('bustedFill');
    this.timerWrap = $('raceTimer');
    this.timerEl = $('timerVal');
    this.radioEl = $('radioName');
    this.map = $('minimap').getContext('2d');
    this.mapSize = $('minimap').width;
    this.mapBase = null; // the static street map, painted on first draw
    this.toastT = 0;
    this.dlgT = 0;
    this.lastCash = null;
    this.lastStars = null;
    this.lastObj = '';
    this.lastPolice = '';
    this.lastCrew = '';
    this.lastWeapons = '';
    this.screens = ['startScreen', 'pauseScreen', 'bustedScreen', 'doneScreen'];
  }

  setCash(n) {
    if (n === this.lastCash) return;
    this.lastCash = n;
    this.cashEl.textContent = `$${n.toLocaleString('en-US')}`;
  }

  setStars(floatStars, label) {
    const n = Math.ceil(floatStars - 1e-6);
    if (n !== this.lastStars) {
      this.lastStars = n;
      let s = '';
      for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆';
      this.starsEl.textContent = s;
      this.starsEl.style.opacity = floatStars > 0 ? '1' : '0.35';
    }
    const txt = label || '';
    if (txt !== this.lastHeat) { this.lastHeat = txt; this.heatEl.textContent = txt; }
  }

  setHealth(health, armour) {
    this.healthFill.style.width = `${Math.max(0, Math.min(100, health))}%`;
    this.armourFill.style.width = `${Math.max(0, Math.min(100, armour))}%`;
  }

  setSpeed(kmh) { this.speedEl.textContent = String(Math.round(Math.abs(kmh))); }

  setRadio(name) { this.radioEl.textContent = name ? `♪ ${name}` : ''; }

  setObjective(obj) {
    const key = obj ? `${obj.title}|${obj.text}|${obj.stage}|${obj.next}` : '';
    if (key === this.lastObj) return;
    this.lastObj = key;
    if (!obj) { this.objWrap.style.display = 'none'; return; }
    this.objWrap.style.display = 'block';
    this.objTitleEl.textContent = obj.title;
    this.objStageEl.textContent = obj.stage ? `STAGE ${obj.stage}/${obj.total}` : '';
    this.objTextEl.textContent = obj.text;
    this.objNextEl.innerHTML = '';
    if (obj.next) {
      const b = document.createElement('b');
      b.textContent = 'NEXT ';
      this.objNextEl.appendChild(b);
      this.objNextEl.appendChild(document.createTextNode(obj.next));
    }
  }

  // The police response panel: one row per unit, nearest first.
  setPolicePanel(units, starsInt) {
    const key = units.map((u) => `${u.callsign}:${u.dist}`).join(',') + '|' + starsInt;
    if (key === this.lastPolice) return;
    this.lastPolice = key;
    if (!units.length || starsInt <= 0) { this.policePanel.style.display = 'none'; return; }
    this.policePanel.style.display = 'block';
    this.policeTitle.textContent = `SBPD RESPONSE · ${units.length} UNIT${units.length > 1 ? 'S' : ''}`;
    this.policeRows.innerHTML = '';
    for (const u of units) {
      const row = document.createElement('div');
      row.className = 'unitRow';
      const call = document.createElement('span'); call.className = 'call'; call.textContent = `▲ ${u.callsign}`;
      const role = document.createElement('span'); role.className = 'role'; role.textContent = u.role;
      const dist = document.createElement('span'); dist.className = 'dist'; dist.textContent = `${u.dist} m`;
      row.append(call, role, dist);
      this.policeRows.appendChild(row);
    }
  }

  // The crew panel: ability key, name, role — and what they can do.
  setCrew(status) {
    const key = status.map((s) => `${s.id}:${s.ready ? 'ready' : Math.ceil(s.remain)}`).join(',');
    if (key === this.lastCrew) return;
    this.lastCrew = key;
    this.crewRows.innerHTML = '';
    for (const s of status) {
      const row = document.createElement('div');
      row.className = 'crewRow' + (s.ready ? '' : ' cooling');
      const k = document.createElement('span'); k.className = 'crewKey'; k.textContent = s.keyLabel;
      const nm = document.createElement('span'); nm.className = 'crewName'; nm.style.color = s.color; nm.textContent = s.name.split(' ')[0];
      const rl = document.createElement('span'); rl.className = 'crewRole'; rl.textContent = s.role;
      const ab = document.createElement('span'); ab.className = 'crewAbility'; ab.style.color = s.color;
      ab.textContent = s.ready ? s.ability : `${s.ability} ${Math.ceil(s.remain)}s`;
      row.append(k, nm, rl, ab);
      this.crewRows.appendChild(row);
    }
  }

  // Weapon slots with live ammo counts.
  setWeapons(status) {
    const key = status.map((s) => `${s.ammo}:${s.active ? 1 : 0}`).join(',');
    if (key === this.lastWeapons) return;
    this.lastWeapons = key;
    this.weaponPanel.innerHTML = '';
    status.forEach((s, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (s.active ? ' active' : '');
      const nm = document.createElement('div'); nm.className = 'wname'; nm.textContent = s.name;
      const am = document.createElement('div'); am.className = 'wammo';
      am.textContent = s.ammo === Infinity ? '∞' : String(s.ammo);
      const ky = document.createElement('div'); ky.className = 'wkey'; ky.textContent = `KEY ${i + 1}`;
      slot.append(nm, am, ky);
      this.weaponPanel.appendChild(slot);
    });
  }

  setDistrict(district, standingPoints) {
    this.districtName.textContent = district.name;
    this.standingLabelEl.textContent = standingLabel(standingPoints);
    const filled = Math.min(5, Math.floor(standingPoints / 24));
    let meter = '';
    for (let i = 0; i < 5; i++) meter += i < filled ? '●' : '○';
    this.standingMeter.textContent = meter;
  }

  setRank(rp) {
    const r = rankFor(rp);
    this.rankName.textContent = r.name;
    if (r.next) {
      const pct = Math.round(((rp - r.floor) / (r.ceil - r.floor)) * 100);
      this.rpFill.style.width = `${pct}%`;
      this.rpText.textContent = `${rp.toLocaleString('en-US')} RP · NEXT ${r.next.name} ${r.ceil.toLocaleString('en-US')}`;
    } else {
      this.rpFill.style.width = '100%';
      this.rpText.textContent = `${rp.toLocaleString('en-US')} RP · TOP OF THE BAY`;
    }
  }

  setVehicle(car) {
    if (!car) {
      this.vehicleName.textContent = '';
      this.vehDmgRow.textContent = '';
      return;
    }
    this.vehicleName.textContent = car.modelName.toUpperCase();
    const pct = car.damagePercent();
    this.vehDmgRow.textContent = pct <= 0 ? 'SHOWROOM CLEAN' : pct >= 100 ? 'WRECKED' : `${pct}% DENTED`;
    this.vehDmgRow.style.color = pct >= 70 ? '#ff5566' : '#ffb36b';
  }

  showDialogue(who, line, color, secs = 4) {
    this.dlgChip.textContent = who.charAt(0);
    this.dlgChip.style.background = color || '#ffc93c';
    this.dlgName.textContent = who;
    this.dlgName.style.color = color || '#ffc93c';
    this.dlgLine.textContent = line;
    this.dialogue.style.display = 'flex';
    this.dlgT = secs;
  }

  toast(msg, secs = 3.4) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    this.toastT = secs;
  }

  prompt(text) {
    this.promptEl.textContent = text || '';
    this.promptEl.style.opacity = text ? '1' : '0';
  }

  setBusted(v) {
    this.bustedWrap.style.display = v > 0.02 ? 'block' : 'none';
    this.bustedFill.style.width = `${Math.round(v * 100)}%`;
  }

  setTimer(text, danger) {
    this.timerWrap.style.display = text ? 'block' : 'none';
    if (text) {
      this.timerEl.textContent = text;
      this.timerEl.style.color = danger ? '#ff5566' : '#ffd94a';
    }
  }

  showScreen(id) {
    for (const s of this.screens) $(s).style.display = s === id ? 'flex' : 'none';
  }

  update(dt) {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.style.opacity = '0';
    }
    if (this.dlgT > 0) {
      this.dlgT -= dt;
      if (this.dlgT <= 0) this.dialogue.style.display = 'none';
    }
  }

  // The static street map, painted once onto an offscreen canvas: water,
  // sand, district-coloured blocks, the pale road network, the promenade,
  // district names and landmark marks. The live layer (route, blips,
  // player) is drawn over it every frame. The pause screen paints the
  // same base at a larger size for its full-city map.
  buildMapBase(G, S = this.mapSize) {
    const scale = S / MAP_SPAN;
    const mx = (x) => (x - MAP_MIN_X) * scale;
    const mz = (z) => (z - MAP_MIN_Z) * scale;
    const base = document.createElement('canvas');
    base.width = S; base.height = S;
    const c = base.getContext('2d');
    // The bay: a soft blue gradient, deeper to the south.
    const sea = c.createLinearGradient(0, mz(226), 0, S);
    sea.addColorStop(0, '#7cc4de');
    sea.addColorStop(0.35, '#3f96c4');
    sea.addColorStop(1, '#1f6f9e');
    c.fillStyle = sea;
    c.fillRect(0, 0, S, S);
    // The island: sand all round, the city slab inside it.
    c.fillStyle = '#e7d096';
    c.fillRect(mx(-232), mz(-232), 464 * scale, (252 + 232) * scale);
    c.fillStyle = '#aeb8a4';
    c.fillRect(mx(-228), mz(-228), 456 * scale, 456 * scale);
    // The beach strip along the south shore.
    c.fillStyle = '#eed9a0';
    c.fillRect(mx(-232), mz(222), 464 * scale, (252 - 222) * scale);
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.fillRect(mx(-232), mz(250.5), 464 * scale, 1.6);
    // City blocks: a pale sidewalk rim around a district-coloured core,
    // each block shaded a touch differently so the city is not one flat fill.
    for (const bx of BLOCK_CENTERS) {
      for (const bz of BLOCK_CENTERS) {
        const d = districtAt(bx, bz);
        const f = 0.94 + (((bx * 7 + bz * 13) % 5 + 5) % 5) * 0.03;
        c.fillStyle = '#ccd1d6';
        c.fillRect(mx(bx - (BLOCK + 8) / 2), mz(bz - (BLOCK + 8) / 2), (BLOCK + 8) * scale, (BLOCK + 8) * scale);
        c.fillStyle = shade(MAP_DISTRICT_COLORS[d.id], f);
        c.fillRect(mx(bx - BLOCK / 2), mz(bz - BLOCK / 2), BLOCK * scale, BLOCK * scale);
      }
    }
    // Roads: a grey casing under a pale carriageway, along the real grid.
    for (const line of ROAD_LINES) {
      c.fillStyle = '#b7bbc0';
      c.fillRect(mx(line - ROAD / 2 - 1.5), mz(-228), (ROAD + 3) * scale, 456 * scale);
      c.fillRect(mx(-228), mz(line - ROAD / 2 - 1.5), 456 * scale, (ROAD + 3) * scale);
    }
    for (const line of ROAD_LINES) {
      c.fillStyle = '#edeade';
      c.fillRect(mx(line - ROAD / 2), mz(-228), ROAD * scale, 456 * scale);
      c.fillRect(mx(-228), mz(line - ROAD / 2), 456 * scale, ROAD * scale);
    }
    // The Strand promenade, a warm strip inside the beach road.
    c.fillStyle = '#d9c39a';
    c.fillRect(mx(-228), mz(203.5), 456 * scale, 7 * scale);
    // District names, small and quiet, like a printed map.
    c.font = `700 ${Math.round(S * 0.036)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(18,24,32,.5)';
    const label = (text, x, z) => c.fillText(text, mx(x), mz(z));
    label('OLD MARKET', -128, -90);
    label('BANK ROW', 128, -34);
    label('PALM HEIGHTS', -128, 106);
    label('MIDTOWN', 0, 10);
    label('THE STRAND', 0, 240);
    // Landmarks: white chips with a dark letter.
    const lm = G.world.landmarks;
    const chip = (x, z, letter) => {
      const w = S * 0.052;
      c.fillStyle = '#ffffff';
      c.fillRect(mx(x) - w / 2, mz(z) - w / 2, w, w);
      c.fillStyle = '#1c2733';
      c.font = `800 ${Math.round(S * 0.04)}px system-ui, sans-serif`;
      c.fillText(letter, mx(x), mz(z) + S * 0.014);
      c.font = `700 ${Math.round(S * 0.036)}px system-ui, sans-serif`;
      c.fillStyle = 'rgba(18,24,32,.5)';
    };
    chip(lm.bank.x, lm.bank.z, '$');
    chip(lm.garage.x, lm.garage.z, 'G');
    chip(lm.hotel.x, lm.hotel.z, 'H');
    chip(lm.safehouse.x, lm.safehouse.z, 'S');
    chip(lm.marina.x, lm.marina.z, 'M');
    return base;
  }

  drawMinimap(G) {
    if (!this.mapBase) this.mapBase = this.buildMapBase(G);
    const c = this.map;
    const S = this.mapSize, scale = S / MAP_SPAN;
    const mx = (x) => (x - MAP_MIN_X) * scale;
    const mz = (z) => (z - MAP_MIN_Z) * scale;
    c.drawImage(this.mapBase, 0, 0);
    const target = G.missions ? G.missions.markerTarget() : null;
    // The route: a gold line along the streets from the player to the
    // objective — east/west first, then north/south, like a satnav.
    if (target) {
      c.lineJoin = 'round';
      c.lineCap = 'round';
      for (const [style, width] of [['rgba(255,255,255,.9)', 5], ['#ffae00', 3]]) {
        c.strokeStyle = style;
        c.lineWidth = width;
        c.beginPath();
        c.moveTo(mx(G.focusX), mz(G.focusZ));
        c.lineTo(mx(target.x), mz(G.focusZ));
        c.lineTo(mx(target.x), mz(target.z));
        c.stroke();
      }
    }
    // Parked cars as steel dots, traffic as darker moving dots.
    c.fillStyle = '#71808f';
    for (const car of G.parkedCars) c.fillRect(mx(car.x) - 1.1, mz(car.z) - 1.1, 2.2, 2.2);
    c.fillStyle = '#45525f';
    for (const car of G.traffic) c.fillRect(mx(car.x) - 1.4, mz(car.z) - 1.4, 2.8, 2.8);
    // Pedestrians as tiny tan specks — the city is full of them.
    c.fillStyle = 'rgba(160,105,45,.85)';
    if (G.peds) for (const ped of G.peds.peds) c.fillRect(mx(ped.x) - 0.7, mz(ped.z) - 0.7, 1.4, 1.4);
    // The wreck target burns red-orange.
    if (G.missions && G.missions.wreckTarget) {
      const wt = G.missions.wreckTarget;
      c.fillStyle = '#ff7a3c';
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(mx(wt.x), mz(wt.z), 3.4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    // The objective, pulsing gold.
    if (target) {
      c.strokeStyle = '#e8960c';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(mx(target.x), mz(target.z), 5.5 + Math.sin(performance.now() / 240) * 1.6, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#ffae00';
      c.beginPath();
      c.arc(mx(target.x), mz(target.z), 2.4, 0, Math.PI * 2);
      c.fill();
    }
    // Police as red blips with a white ring, the helicopter as a red cross.
    for (const car of G.police.cars) {
      c.fillStyle = '#ff3348';
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(mx(car.x), mz(car.z), 3, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (G.police.heli.group.visible) {
      const hx = mx(G.police.heli.group.position.x), hz = mz(G.police.heli.group.position.z);
      c.strokeStyle = '#ff3348';
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(hx - 4.4, hz); c.lineTo(hx + 4.4, hz);
      c.moveTo(hx, hz - 4.4); c.lineTo(hx, hz + 4.4);
      c.stroke();
    }
    // The crew rides with the player: three coloured dots in a loose
    // triangle around the arrow, one per member.
    const px = mx(G.focusX), pz = mz(G.focusZ);
    const orbit = performance.now() / 900;
    MAP_CREW_COLORS.forEach((col, i) => {
      const a = orbit + (i * Math.PI * 2) / 3;
      c.fillStyle = col;
      c.beginPath();
      c.arc(px + Math.cos(a) * 7.5, pz + Math.sin(a) * 7.5, 1.9, 0, Math.PI * 2);
      c.fill();
    });
    // The player: a white arrow with a dark outline, on their heading.
    c.save();
    c.translate(px, pz);
    c.rotate(Math.PI - G.focusHeading);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#141a22';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, -6.4); c.lineTo(4.6, 5.2); c.lineTo(0, 2.5); c.lineTo(-4.6, 5.2);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // A north marker, like a printed map.
    c.fillStyle = 'rgba(18,24,32,.65)';
    c.font = `800 ${Math.round(S * 0.05)}px system-ui, sans-serif`;
    c.textAlign = 'right';
    c.fillText('N', S - 5, S * 0.065);
  }

  // The aiming reticle, shown while a firearm is out on foot.
  setReticle(show) {
    const el = $('reticle');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  // Title screen: the save-slot summaries under the menu, one line per
  // slot — act, mission, completion, cash — or EMPTY for a fresh slot.
  fillTitle(G) {
    const wrap = $('slotSummaries');
    if (!wrap || !G.saves) return;
    wrap.innerHTML = '';
    G.saves.summaries().forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'slotLine';
      row.textContent = s
        ? `SLOT ${i + 1} — ${s.act} · ${s.completion}% · $${Number(s.cash).toLocaleString('en-US')}`
        : `SLOT ${i + 1} — EMPTY`;
      wrap.appendChild(row);
    });
    const any = G.saves.latest() >= 0;
    const cont = $('continueBtn');
    if (cont) cont.style.display = any ? 'block' : 'none';
  }

  // The pause screen's big map: the same street-map base at full size,
  // plus standing values under each district name, gold dots for the
  // collectibles still hidden, orange triangles for the stunt ramps,
  // the live objective ring and the player's arrow.
  drawPauseMap(G) {
    const canvas = $('pauseMap');
    if (!canvas) return;
    if (!this.pauseBase) this.pauseBase = this.buildMapBase(G, 440);
    const c = canvas.getContext('2d');
    const S = 440, scale = S / MAP_SPAN;
    const mx = (x) => (x - MAP_MIN_X) * scale;
    const mz = (z) => (z - MAP_MIN_Z) * scale;
    c.drawImage(this.pauseBase, 0, 0);
    // Standing under each district name, as the bay judges Ren.
    c.font = '800 12px system-ui, sans-serif';
    c.textAlign = 'center';
    const standingAt = (id, x, z) => {
      const pts = G.standing[id] || 0;
      c.fillStyle = 'rgba(255,255,255,.85)';
      const w = c.measureText(`${standingLabel(pts)} · ${pts}`).width + 10;
      c.fillRect(mx(x) - w / 2, mz(z) - 9, w, 15);
      c.fillStyle = '#1c2733';
      c.fillText(`${standingLabel(pts)} · ${pts}`, mx(x), mz(z) + 3);
    };
    standingAt('market', -128, -76);
    standingAt('bankrow', 128, -20);
    standingAt('palm', -128, 120);
    standingAt('midtown', 0, 24);
    standingAt('strand', 0, 226);
    // Collectibles still out there: gold dots. Found ones go quiet.
    COLLECTIBLE_SPOTS.forEach((spot, i) => {
      const found = G.collectibles && G.collectibles.found.has(i);
      c.fillStyle = found ? 'rgba(120,110,80,.5)' : '#ffae00';
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(mx(spot.x), mz(spot.z), found ? 2.4 : 4, 0, Math.PI * 2);
      c.fill();
      if (!found) c.stroke();
    });
    // Stunt ramps: orange triangles on the roads that launch you.
    c.fillStyle = '#ff7a3c';
    for (const ramp of G.world.stuntRamps) {
      c.beginPath();
      c.moveTo(mx(ramp.x), mz(ramp.z) - 5);
      c.lineTo(mx(ramp.x) + 4.6, mz(ramp.z) + 4);
      c.lineTo(mx(ramp.x) - 4.6, mz(ramp.z) + 4);
      c.closePath();
      c.fill();
    }
    // The Harbor Sprint course: a dashed teal loop through all eight
    // gates, each gate numbered in running order — the race reads as a
    // route on the paper map, not just a checklist entry.
    const raceStage = G.missions && G.missions.defs[RACE_MISSION_INDEX] && G.missions.defs[RACE_MISSION_INDEX][0];
    if (raceStage && raceStage.gates) {
      const gates = raceStage.gates;
      c.save();
      c.strokeStyle = 'rgba(23,162,184,.85)';
      c.lineWidth = 2.2;
      c.setLineDash([6, 4]);
      c.beginPath();
      gates.forEach((g, i) => {
        if (i === 0) c.moveTo(mx(g.x), mz(g.z));
        else c.lineTo(mx(g.x), mz(g.z));
      });
      c.closePath();
      c.stroke();
      c.setLineDash([]);
      c.font = '800 9px system-ui, sans-serif';
      c.textAlign = 'center';
      gates.forEach((g, i) => {
        c.fillStyle = '#17a2b8';
        c.beginPath();
        c.arc(mx(g.x), mz(g.z), 6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffffff';
        c.fillText(String(i + 1), mx(g.x), mz(g.z) + 3);
      });
      c.restore();
    }
    // Story-job markers: a numbered slate square where each job ends,
    // fanned out a few units per job so the marina finishes don't stack.
    if (G.missions) {
      c.font = '800 9.5px system-ui, sans-serif';
      c.textAlign = 'center';
      G.missions.defs.forEach((stages, i) => {
        let spot = null;
        for (let s = stages.length - 1; s >= 0; s--) {
          if (stages[s].x !== undefined) { spot = stages[s]; break; }
        }
        if (!spot && stages[0] && stages[0].gates) spot = stages[0].gates[0];
        if (!spot) spot = G.world.landmarks.marina; // the wreck run ends at the marina
        const ox = Math.cos(i * 2.4) * 8, oz = Math.sin(i * 2.4) * 8;
        const px = mx(spot.x + ox), pz = mz(spot.z + oz);
        c.fillStyle = '#2b3a67';
        c.strokeStyle = '#ffffff';
        c.lineWidth = 1.2;
        c.fillRect(px - 6.5, pz - 6.5, 13, 13);
        c.strokeRect(px - 6.5, pz - 6.5, 13, 13);
        c.fillStyle = '#ffe9a8';
        c.fillText(String(i + 1), px, pz + 3.5);
      });
      // The courier circuit: package corner and the north-east drop.
      const lm = G.world.landmarks;
      const jobChip = (x, z, letter) => {
        c.fillStyle = '#7a4a12';
        c.beginPath();
        c.arc(mx(x), mz(z), 6.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffd94a';
        c.fillText(letter, mx(x), mz(z) + 3.5);
      };
      jobChip(lm.packageSpot.x, lm.packageSpot.z, 'P');
      jobChip(lm.pickupSpot.x, lm.pickupSpot.z, 'D');
    }
    // The live objective, ringed in gold, and the route to it.
    const target = G.missions ? G.missions.markerTarget() : null;
    if (target) {
      c.strokeStyle = '#ffae00';
      c.lineWidth = 2.4;
      c.beginPath();
      c.arc(mx(target.x), mz(target.z), 8, 0, Math.PI * 2);
      c.stroke();
      c.lineJoin = 'round';
      c.lineCap = 'round';
      for (const [style, width] of [['rgba(255,255,255,.9)', 5], ['#ffae00', 3]]) {
        c.strokeStyle = style;
        c.lineWidth = width;
        c.beginPath();
        c.moveTo(mx(G.focusX), mz(G.focusZ));
        c.lineTo(mx(target.x), mz(G.focusZ));
        c.lineTo(mx(target.x), mz(target.z));
        c.stroke();
      }
    }
    // The player arrow.
    c.save();
    c.translate(mx(G.focusX), mz(G.focusZ));
    c.rotate(Math.PI - G.focusHeading);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#141a22';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(0, -8); c.lineTo(5.6, 6.4); c.lineTo(0, 3); c.lineTo(-5.6, 6.4);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  // Fill the pause screen: big map + district standings on the left;
  // completion ring, checklist, career stats and medal ratings on the
  // right; three save slots along the bottom. Everything is read from
  // the live career counters — nothing on this screen is typed in.
  fillPause(G) {
    if (!G.stats) return;
    this.drawPauseMap(G);
    const stats = G.stats;

    // District standings list under the map.
    const dWrap = $('districtRows');
    dWrap.innerHTML = '';
    for (const d of DISTRICTS) {
      const pts = G.standing[d.id] || 0;
      const row = document.createElement('div');
      row.className = 'distRow';
      const nm = document.createElement('span'); nm.textContent = d.name;
      const lb = document.createElement('span'); lb.className = 'distLabel';
      lb.textContent = `${standingLabel(pts)} · ${pts}`;
      row.append(nm, lb);
      dWrap.appendChild(row);
    }

    // Completion ring: a gold arc over a dim track, percent in the hole.
    const pct = stats.completion(G);
    const ring = $('completionRing').getContext('2d');
    ring.clearRect(0, 0, 110, 110);
    ring.lineWidth = 10;
    ring.strokeStyle = 'rgba(255,255,255,.16)';
    ring.beginPath();
    ring.arc(55, 55, 46, 0, Math.PI * 2);
    ring.stroke();
    ring.strokeStyle = '#ffc93c';
    ring.beginPath();
    ring.arc(55, 55, 46, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2);
    ring.stroke();
    ring.fillStyle = '#f5f0e8';
    ring.font = '800 21px system-ui, sans-serif';
    ring.textAlign = 'center';
    ring.fillText(`${pct}%`, 55, 62);
    $('completionPct').textContent = `${pct}% OF SOLMAR BAY`;

    // The checklist.
    const cWrap = $('checklistRows');
    cWrap.innerHTML = '';
    for (const row of stats.checklist(G)) {
      const el = document.createElement('div');
      el.className = 'chkRow';
      const lb = document.createElement('span'); lb.textContent = row.label;
      const bar = document.createElement('span'); bar.className = 'chkBar';
      const fill = document.createElement('span'); fill.className = 'chkFill';
      fill.style.width = `${Math.round((row.have / row.total) * 100)}%`;
      bar.appendChild(fill);
      const val = document.createElement('span'); val.className = 'chkVal';
      val.textContent = `${row.have}/${row.total}`;
      el.append(lb, bar, val);
      cWrap.appendChild(el);
    }

    // Career stats as compact chips.
    const kWrap = $('careerRows');
    kWrap.innerHTML = '';
    for (const [label, value] of stats.careerRows()) {
      const chip = document.createElement('div');
      chip.className = 'careerChip';
      const lb = document.createElement('div'); lb.className = 'careerLabel'; lb.textContent = label;
      const vl = document.createElement('div'); vl.className = 'careerValue'; vl.textContent = value;
      chip.append(lb, vl);
      kWrap.appendChild(chip);
    }

    // Medal ratings, one chip per story mission.
    const MEDAL_SHORT = ['FIRST WHEELS', 'CROSS-TOWN', 'HOT DELIVERY', 'WRECK', 'HARBOR', 'CLOCK', 'MARINA'];
    const mWrap = $('medalRow');
    mWrap.innerHTML = '';
    MISSION_NAMES.forEach((name, i) => {
      const chip = document.createElement('span');
      const grade = stats.medals[i];
      chip.className = `medal ${grade ? `g${grade}` : 'none'}`;
      chip.textContent = `${i + 1} ${MEDAL_SHORT[i]} ${grade || '—'}`;
      mWrap.appendChild(chip);
    });

    // Save slots: click one to write the current game into it.
    const sWrap = $('saveSlots');
    sWrap.innerHTML = '';
    G.saves.summaries().forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'slotBtn' + (i === G.saveSlot ? ' active' : '');
      btn.textContent = s
        ? `SLOT ${i + 1} — ${s.act} · ${s.completion}% · $${Number(s.cash).toLocaleString('en-US')}`
        : `SLOT ${i + 1} — EMPTY · CLICK TO SAVE`;
      btn.addEventListener('click', () => G.saveToSlot(i));
      sWrap.appendChild(btn);
    });
  }
}
