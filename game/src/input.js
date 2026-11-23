// ── input.js — keyboard state with per-press edge detection.
// Exports: Input (isDown / pressed / axis / endFrame). Owned by main.js
// and passed into player.js and vehicles.js update calls; nothing else
// listens to the keyboard directly.
// Keyboard state with edge detection: isDown for holds, pressed for taps.

export class Input {
  constructor() {
    this.down = new Set();
    this.hit = new Set();
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.hit.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(...codes) { return codes.some((c) => this.down.has(c)); }

  // True once per physical press; consumes the first matching code.
  pressed(...codes) {
    for (const c of codes) {
      if (this.hit.has(c)) { this.hit.delete(c); return true; }
    }
    return false;
  }

  axis(neg, pos) { return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0); }

  endFrame() { this.hit.clear(); }
}
