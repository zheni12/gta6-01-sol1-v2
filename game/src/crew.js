// ── crew.js — Ren's three companions and their cooldown abilities.
// Exports: CREW_MEMBERS (roster data), Crew (cooldown state + use()).
// main.js maps Q/R/C here; effects land on police.js (ghost plates),
// the player's car (quick fix) and main.js state (eyes out); hud.js
// renders the panel from Crew.status().
// The crew: three original Solmar Bay regulars who ride along on every
// job. Each has one ability on a cooldown, fired from the keyboard, and
// each talks — their lines drive the dialogue box during missions.

export const CREW_MEMBERS = [
  {
    id: 'mira', name: 'MIRA SOLANO', role: 'Driver', color: '#ff9f43',
    ability: 'GHOST PLATES', keyLabel: 'Q', key: 'KeyQ', cooldown: 45,
    readyLine: 'Plates swapped. We are nobody for a while.',
  },
  {
    id: 'theo', name: 'THEO LINDQVIST', role: 'Mechanic', color: '#54c8ff',
    ability: 'QUICK FIX', keyLabel: 'R', key: 'KeyR', cooldown: 60,
    readyLine: 'Patched, filled and angry again. Drive.',
  },
  {
    id: 'kiki', name: 'KIKI AMARA', role: 'Lookout', color: '#b78bff',
    ability: 'EYES OUT', keyLabel: 'C', key: 'KeyC', cooldown: 40,
    readyLine: 'I have every cruiser on the board. Heat is bleeding off.',
  },
];

export class Crew {
  constructor(G) {
    this.G = G;
    this.readyAt = CREW_MEMBERS.map(() => 0);
    this.time = 0;
  }

  update(dt) { this.time += dt; }

  status() {
    return CREW_MEMBERS.map((m, i) => ({
      ...m,
      remain: Math.max(0, this.readyAt[i] - this.time),
      ready: this.time >= this.readyAt[i],
    }));
  }

  // Fire member i's ability. Returns true when it went off.
  use(i) {
    const G = this.G;
    const m = CREW_MEMBERS[i];
    if (!m || this.time < this.readyAt[i]) return false;
    if (m.id === 'theo' && !G.inCar) {
      G.hud.toast('Theo needs you in the car to work his magic.');
      return false;
    }
    this.readyAt[i] = this.time + m.cooldown;
    if (G.stats) G.stats.crewAbilitiesUsed++;
    if (m.id === 'mira') {
      const p = G.police;
      p.setStars(Math.max(0, p.stars - 1));
      p.ghostT = 6; // no fresh units roll out while the plates are ghost
      p.busted = 0;
    } else if (m.id === 'theo') {
      if (G.playerCar) G.playerCar.damage = 0;
    } else if (m.id === 'kiki') {
      G.eyesOutT = 10;
      G.police.busted = 0;
    }
    G.hud.showDialogue(m.name, m.readyLine, m.color, 3.6);
    G.audio.blip('pickup');
    return true;
  }
}
