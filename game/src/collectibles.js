// ── collectibles.js — the twenty golden Solmar stars hidden in the bay.
// Exports: COLLECTIBLE_SPOTS (positions), Collectibles (meshes + pickup
// checks). main.js updates it per frame; hud.js marks unfound spots on
// the pause map; stats.js counts them toward bay completion.
// Collectibles: twenty golden Solmar stars hidden across the bay — on
// the pier, behind the bank, along the beach, at the far corners of the
// grid. Walk or drive through one to collect it; the count feeds the
// pause screen's checklist and the bay completion percentage, and the
// pause map marks the ones still waiting as gold dots.

import { dist2D } from './config.js';

export const COLLECTIBLE_SPOTS = [
  { x: -128, z: -160 }, { x: 160, z: -160 }, { x: 96, z: -58 }, { x: -134, z: 40 },
  { x: 134, z: 104 }, { x: -32, z: 142 }, { x: 128, z: 262 }, { x: 0, z: 234 },
  { x: -190, z: 234 }, { x: 190, z: 234 }, { x: -58, z: -58 }, { x: 58, z: 58 },
  { x: -160, z: 168 }, { x: 168, z: 160 }, { x: 0, z: 6 }, { x: -186, z: -186 },
  { x: 182, z: -182 }, { x: 32, z: -122 }, { x: -96, z: 38 }, { x: 128, z: 238 },
];

export class Collectibles {
  constructor(scene, G) {
    this.G = G;
    this.found = new Set();
    this.items = [];
    const gold = new THREE.MeshLambertMaterial({ color: 0xffc93c, emissive: 0x6b4a00 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.5 });
    for (const spot of COLLECTIBLE_SPOTS) {
      const g = new THREE.Group();
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.62), gold);
      star.position.y = 1.25;
      g.add(star);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.07, 6, 22), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.3;
      g.add(ring);
      g.position.set(spot.x, 0, spot.z);
      scene.add(g);
      this.items.push({ group: g, star, x: spot.x, z: spot.z });
    }
  }

  setFound(list) {
    this.found = new Set(Array.isArray(list) ? list : []);
    this.items.forEach((it, i) => { it.group.visible = !this.found.has(i); });
    if (this.G.stats) this.G.stats.collectiblesFound = this.found.size;
  }

  foundList() { return [...this.found]; }

  update(dt, t) {
    const G = this.G;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (this.found.has(i)) continue;
      it.star.rotation.y = t * 1.8 + i;
      it.star.position.y = 1.25 + Math.sin(t * 2.2 + i * 1.7) * 0.16;
      if (dist2D(G.focusX, G.focusZ, it.x, it.z) < 2.7) {
        this.found.add(i);
        it.group.visible = false;
        if (G.stats) G.stats.collectiblesFound = this.found.size;
        G.addRP(5);
        G.toast(`Solmar star ${this.found.size}/${COLLECTIBLE_SPOTS.length} — the bay glitters a little more.`);
        G.audio.blip('checkpoint');
        G.saveGame();
      }
    }
  }
}
