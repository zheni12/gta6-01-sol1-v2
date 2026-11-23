// ── audio.js — procedural WebAudio sound: radio, engine, sirens, blips.
// Exports: AudioSys. Driven by main.js each frame (update/setEngine/
// setSiren); every other system fires one-shots through G.audio.blip().
// All sound is synthesized with WebAudio — no audio files.
// Three radio stations (step-sequenced oscillator patterns), an engine hum
// tied to speed, police sirens by proximity, and one-shot blips for events.

const STATIONS = [
  { name: 'SOLMAR FM · synthwave', wave: 'sawtooth', base: 110.0, scale: [0, 3, 5, 7, 10, 12, 15, 12], tempo: 0.21, bassEvery: 4 },
  { name: 'BAY JAZZ 98.2', wave: 'triangle', base: 196.0, scale: [0, 4, 7, 11, 12, 11, 7, 4], tempo: 0.33, bassEvery: 6 },
  { name: 'HEAT ROCK 66.6', wave: 'square', base: 82.4, scale: [0, 0, 7, 0, 10, 12, 0, 7], tempo: 0.155, bassEvery: 2 },
];

const MASTER_GAIN = 0.5; // overall output level, set once at unlock

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.station = 0;
    this.radioOn = false;
    this.step = 0;
    this.stepT = 0;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.noiseBuf = null;
  }

  // Must be called from a user gesture at least once.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (err) {
      this.ctx = null; // headless / blocked: the game stays silent, never broken
    }
  }

  note(freq, dur, wave, gain, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = wave; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  blip(kind) {
    if (!this.ctx) return;
    if (kind === 'cash') { this.note(880, 0.09, 'sine', 0.22); this.note(1318, 0.14, 'sine', 0.22, 0.08); }
    else if (kind === 'pickup') { this.note(660, 0.08, 'triangle', 0.25); this.note(990, 0.1, 'triangle', 0.25, 0.07); }
    else if (kind === 'steal') { this.note(220, 0.12, 'square', 0.16); this.note(220, 0.12, 'square', 0.16, 0.16); }
    else if (kind === 'win') { [523, 659, 784, 1046].forEach((f, i) => this.note(f, 0.16, 'triangle', 0.22, i * 0.1)); }
    else if (kind === 'bust') { [392, 330, 262, 196].forEach((f, i) => this.note(f, 0.2, 'sawtooth', 0.14, i * 0.13)); }
    else if (kind === 'checkpoint') { this.note(1174, 0.1, 'sine', 0.2); }
    else if (kind === 'shot') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.13);
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 700;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(); src.stop(this.ctx.currentTime + 0.15);
    }
    else if (kind === 'hit') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.3, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(); src.stop(this.ctx.currentTime + 0.25);
    }
  }

  setEngine(on, speedNorm) {
    if (!this.ctx) return;
    if (on && !this.engineNodes) {
      const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = this.ctx.createOscillator(); o2.type = 'sine';
      const g = this.ctx.createGain(); g.gain.value = 0.0;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.engineNodes = { o1, o2, g };
    }
    if (this.engineNodes) {
      const t = this.ctx.currentTime;
      const freq = 55 + Math.abs(speedNorm) * 175;
      this.engineNodes.o1.frequency.setTargetAtTime(freq, t, 0.06);
      this.engineNodes.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.06);
      this.engineNodes.g.gain.setTargetAtTime(on ? 0.055 + Math.abs(speedNorm) * 0.05 : 0, t, 0.1);
      if (!on) {
        const nodes = this.engineNodes; this.engineNodes = null;
        setTimeout(() => { try { nodes.o1.stop(); nodes.o2.stop(); } catch (e) { /* already stopped */ } }, 400);
      }
    }
  }

  setSiren(proximity) { // 0 = silent … 1 = right on top of you
    if (!this.ctx) return;
    if (proximity > 0.02 && !this.sirenNodes) {
      const o = this.ctx.createOscillator(); o.type = 'square';
      const g = this.ctx.createGain(); g.gain.value = 0;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 6;
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start();
      this.sirenNodes = { o, g };
    }
    if (this.sirenNodes) {
      const t = this.ctx.currentTime;
      this.sirenNodes.o.frequency.setTargetAtTime(720 + 260 * Math.sin(t * 5.2), t, 0.03);
      this.sirenNodes.g.gain.setTargetAtTime(proximity * 0.035, t, 0.1);
      if (proximity <= 0.02) {
        const nodes = this.sirenNodes; this.sirenNodes = null;
        setTimeout(() => { try { nodes.o.stop(); } catch (e) { /* already stopped */ } }, 300);
      }
    }
  }

  cycleRadio() {
    this.station = (this.station + 1) % STATIONS.length;
    this.radioOn = true;
    this.step = 0; this.stepT = 0;
    return STATIONS[this.station].name;
  }

  stationName() { return STATIONS[this.station].name; }

  update(dt, driving) {
    if (!this.ctx) return;
    if (this.radioOn && driving) {
      const st = STATIONS[this.station];
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = st.tempo;
        const semis = st.scale[this.step % st.scale.length];
        const freq = st.base * Math.pow(2, semis / 12);
        this.note(freq, st.tempo * 1.7, st.wave, 0.075);
        if (this.step % st.bassEvery === 0) this.note(st.base / 2, st.tempo * 2.4, 'sine', 0.11);
        this.step++;
      }
    }
  }
}
