// ── save.js — three localStorage save slots with title-screen summaries.
// Exports: SLOT_COUNT, SaveSlots (read/write/summaries/latest). main.js
// writes through G.saveGame(); hud.js lists the slots on the title and
// pause screens. Slot payloads are opaque to this module.
// Save slots: three named saves in localStorage. Each slot carries the
// full progress payload plus a summary — the story act it sits in, the
// mission, the bay completion and the cash — which is what the title
// screen lists under the menu and the pause screen offers to overwrite.
// The legacy single save key still mirrors slot 1 so CONTINUE on the
// title screen always resumes the most recent game.

import { SAVE_KEY } from './config.js';

export const SLOT_COUNT = 3;

export class SaveSlots {
  key(i) { return `${SAVE_KEY}-slot${i + 1}`; }

  read(i) {
    try {
      const raw = window.localStorage.getItem(this.key(i));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  write(i, payload, summary) {
    try {
      window.localStorage.setItem(this.key(i), JSON.stringify({
        payload, summary, when: Date.now(),
      }));
    } catch (e) { /* storage off: the visit is the save */ }
  }

  // One summary (or null) per slot, in slot order — title-screen fodder.
  summaries() {
    const out = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = this.read(i);
      out.push(s && s.summary ? { ...s.summary, when: s.when } : null);
    }
    return out;
  }

  // The slot index of the most recently written save, or -1 when empty.
  latest() {
    let best = -1, bestWhen = -1;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = this.read(i);
      if (s && s.when > bestWhen) { bestWhen = s.when; best = i; }
    }
    return best;
  }
}
