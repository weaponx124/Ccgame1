// Procedurally synthesized sound effects via the Web Audio API — no audio files, no fetches,
// consistent with this project's "no external runtime dependency" approach (the same reasoning
// that got Three.js vendored locally instead of loaded from a CDN). Every sound here is built
// from oscillators/noise bursts run through gain and filter envelopes at call time, so there's
// nothing to download and nothing that can 404 or need licensing.
//
// Browsers refuse to start audio before a user gesture, so `unlock()` must be called from inside
// a click/tap handler (game.js does this on Start/Continue/Resume) before any sound will play —
// every method below is a safe no-op until then.

class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._noiseBuffer = null;
    this._lastPlayed = {}; // sound name -> performance.now() of its last trigger, for rate-limiting
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; // unsupported browser — every call below silently no-ops
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** One shared second of white noise — every noise-based sound plays a random slice of this
   *  instead of allocating a fresh buffer per call. */
  _noise() {
    if (!this._noiseBuffer) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuffer = buf;
    }
    return this._noiseBuffer;
  }

  /** Rate-limits a named sound to at most once per `minGapMs` — keeps a wall of simultaneous
   *  hits/footsteps from turning into indistinct noise mush. */
  _allow(name, minGapMs) {
    const now = performance.now();
    const last = this._lastPlayed[name] || -Infinity;
    if (now - last < minGapMs) return false;
    this._lastPlayed[name] = now;
    return true;
  }

  _tone({ freq, freqEnd, duration = 0.15, type = 'sine', gain = 0.3, attack = 0.005, detune = 0, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    if (detune) osc.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  _burst({ duration = 0.15, gain = 0.35, filterType = 'lowpass', filterFreq = 1200, filterFreqEnd, q = 0.7, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const buffer = this._noise();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const offset = Math.random() * Math.max(0.01, buffer.duration - duration - 0.05);
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(filterFreq, t0);
    if (filterFreqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterFreqEnd), t0 + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0, offset, duration);
  }

  // ---------- Weapons ----------
  shootCrossbow() {
    this._tone({ freq: 520, freqEnd: 180, duration: 0.12, type: 'triangle', gain: 0.22 });
    this._burst({ duration: 0.05, gain: 0.12, filterType: 'highpass', filterFreq: 2000 });
  }

  shootBlunderbuss() {
    this._burst({ duration: 0.18, gain: 0.4, filterType: 'lowpass', filterFreq: 2200, filterFreqEnd: 300 });
    this._tone({ freq: 90, freqEnd: 45, duration: 0.16, type: 'sawtooth', gain: 0.28 });
  }

  shootChakram() {
    this._tone({ freq: 1400, freqEnd: 900, duration: 0.22, type: 'sine', gain: 0.16, detune: 12 });
    this._tone({ freq: 1410, freqEnd: 905, duration: 0.22, type: 'sine', gain: 0.12, detune: -12 });
  }

  shootWeapon(weaponType) {
    if (weaponType === 'blunderbuss') this.shootBlunderbuss();
    else if (weaponType === 'chakram') this.shootChakram();
    else this.shootCrossbow();
  }

  // ---------- Movement ----------
  footstep() {
    if (!this._allow('footstep', 220)) return;
    this._burst({ duration: 0.05, gain: 0.05, filterType: 'lowpass', filterFreq: 260 });
  }

  // ---------- Combat feedback ----------
  hitEnemy(isCrit) {
    if (!this._allow('hit', 40)) return;
    this._burst({ duration: 0.06, gain: isCrit ? 0.35 : 0.22, filterType: 'bandpass', filterFreq: isCrit ? 2600 : 1600, q: 1.2 });
    if (isCrit) this._tone({ freq: 900, freqEnd: 500, duration: 0.08, type: 'square', gain: 0.15 });
  }

  enemyDeath() {
    if (!this._allow('death', 60)) return;
    this._tone({ freq: 220, freqEnd: 60, duration: 0.3, type: 'sawtooth', gain: 0.18 });
    this._burst({ duration: 0.12, gain: 0.15, filterType: 'lowpass', filterFreq: 500 });
  }

  playerHurt() {
    if (!this._allow('playerHurt', 200)) return;
    this._tone({ freq: 180, freqEnd: 90, duration: 0.22, type: 'sawtooth', gain: 0.28 });
  }

  baseHit() {
    if (!this._allow('baseHit', 200)) return;
    this._tone({ freq: 110, freqEnd: 55, duration: 0.28, type: 'sine', gain: 0.3 });
    this._burst({ duration: 0.15, gain: 0.2, filterType: 'lowpass', filterFreq: 400 });
  }

  mineExplosion() {
    this._burst({ duration: 0.4, gain: 0.5, filterType: 'lowpass', filterFreq: 3000, filterFreqEnd: 150 });
    this._tone({ freq: 70, freqEnd: 30, duration: 0.35, type: 'sine', gain: 0.4 });
  }

  // ---------- Monster voices ----------
  zombieGroan() {
    if (!this._allow('zombieVoice', 2500)) return;
    this._tone({ freq: 140, freqEnd: 100, duration: 0.5, type: 'sawtooth', gain: 0.12, detune: -20 });
  }

  vampireHiss() {
    if (!this._allow('vampireVoice', 2500)) return;
    this._burst({ duration: 0.3, gain: 0.14, filterType: 'highpass', filterFreq: 3500 });
  }

  werewolfGrowl() {
    if (!this._allow('werewolfVoice', 2500)) return;
    this._tone({ freq: 85, freqEnd: 65, duration: 0.4, type: 'sawtooth', gain: 0.16 });
    this._burst({ duration: 0.2, gain: 0.1, filterType: 'bandpass', filterFreq: 800, q: 2 });
  }

  monsterVoice(typeKey) {
    if (typeKey === 'vampire') this.vampireHiss();
    else if (typeKey === 'werewolf') this.werewolfGrowl();
    else this.zombieGroan();
  }

  // ---------- Economy / UI ----------
  goldPickup() {
    if (!this._allow('gold', 90)) return;
    this._tone({ freq: 1200, duration: 0.06, type: 'sine', gain: 0.09 });
  }

  purchase() {
    this._tone({ freq: 660, duration: 0.08, type: 'sine', gain: 0.18 });
    this._tone({ freq: 990, duration: 0.1, type: 'sine', gain: 0.16, delay: 0.07 });
  }

  buttonClick() {
    this._tone({ freq: 500, duration: 0.04, type: 'square', gain: 0.07 });
  }

  menuOpen() {
    this._tone({ freq: 300, freqEnd: 500, duration: 0.1, type: 'sine', gain: 0.12 });
  }

  menuClose() {
    this._tone({ freq: 500, freqEnd: 280, duration: 0.1, type: 'sine', gain: 0.12 });
  }

  waveStart() {
    this._tone({ freq: 110, freqEnd: 70, duration: 0.9, type: 'sawtooth', gain: 0.22 });
    this._tone({ freq: 165, freqEnd: 100, duration: 0.9, type: 'sine', gain: 0.14, delay: 0.05 });
  }

  waveClear() {
    this._tone({ freq: 660, duration: 0.12, type: 'triangle', gain: 0.2 });
    this._tone({ freq: 880, duration: 0.16, type: 'triangle', gain: 0.2, delay: 0.1 });
    this._tone({ freq: 1100, duration: 0.22, type: 'triangle', gain: 0.2, delay: 0.2 });
  }

  gameOver() {
    this._tone({ freq: 220, freqEnd: 60, duration: 1.1, type: 'sawtooth', gain: 0.25 });
    this._tone({ freq: 165, freqEnd: 45, duration: 1.1, type: 'sawtooth', gain: 0.2, delay: 0.08 });
  }
}
