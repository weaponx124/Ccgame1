// Procedurally synthesized sound effects via the Web Audio API — no audio files, no fetches,
// consistent with this project's "no external runtime dependency" approach (the same reasoning
// that got Three.js vendored locally instead of loaded from a CDN). Every sound here is built
// from oscillators/noise bursts, run through a small effects chain (distortion for grit, a
// procedural convolution reverb for space, per-trigger pitch/timing jitter so repeats don't sound
// robotic) rather than a single bare tone — the difference between "an oscillator beeped" and
// something that actually reads as a produced sound effect. Still no audio files: nothing to
// download and nothing that can 404 or need licensing.
//
// Browsers refuse to start audio before a user gesture, so `unlock()` must be called from inside
// a click/tap handler (game.js does this on Start/Continue/Resume) before any sound will play —
// every method below is a safe no-op until then.

class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.55;
    this._noiseBuffer = null;
    this._lastPlayed = {}; // sound name -> performance.now() of its last trigger, for rate-limiting
    this._distortionCache = {};
    this._reverbSend = null;
    this._ambienceStarted = false;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; // unsupported browser — every call below silently no-ops
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this._ensureReverb();
      this.startAmbience();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(muted ? 0 : this.volume, now);
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Briefly pulls the master bus down and lets it recover — the classic "impact" trick so a big
   *  hit (an explosion, a wave horn) reads as hitting *through* everything else instead of just
   *  adding another layer on top of it. No-ops while muted so it can't un-mute the game. */
  _duck(amount, holdMs, releaseMs) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.volume, now);
    this.master.gain.linearRampToValueAtTime(this.volume * (1 - amount), now + 0.02);
    this.master.gain.setValueAtTime(this.volume * (1 - amount), now + holdMs / 1000);
    this.master.gain.linearRampToValueAtTime(this.volume, now + holdMs / 1000 + releaseMs / 1000);
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

  /** A procedural convolution reverb (a decaying noise "impulse response" — there's no room to
   *  record, so this fakes one) that every sound can send a little of itself into for a sense of
   *  space, instead of everything sounding like it's playing in a dead vacuum. Built once. */
  _ensureReverb() {
    if (this._reverbSend) return;
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * 1.6);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.3);
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = impulse;
    this._reverbSend = this.ctx.createGain();
    this._reverbSend.gain.value = 0.55;
    this._reverbSend.connect(conv);
    conv.connect(this.master);
  }

  /** A soft-clip distortion curve, cached per drive amount — this is what turns a clean sine/saw
   *  into something with actual grit (gunshots, snarls) instead of a pure, thin tone. */
  _makeDistortion(amount) {
    const key = Math.round(amount * 10);
    if (this._distortionCache[key]) return this._distortionCache[key];
    const curve = new Float32Array(256);
    const k = Math.max(0.001, amount);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = curve;
    shaper.oversample = '2x';
    this._distortionCache[key] = shaper;
    return shaper;
  }

  /** Sends `amount` (0..1) of `node`'s output into the shared reverb bus. */
  _sendReverb(node, amount) {
    if (!amount || !this._reverbSend) return;
    const send = this.ctx.createGain();
    send.gain.value = amount;
    node.connect(send);
    send.connect(this._reverbSend);
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

  _tone({ freq, freqEnd, duration = 0.15, type = 'sine', gain = 0.3, attack = 0.005, detune = 0, delay = 0, reverb = 0.12, distort = 0, jitter = 0 }) {
    if (!this.ctx) return;
    const pitchMult = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * pitchMult, t0);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd * pitchMult), t0 + duration);
    if (detune) osc.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g);
    let out = g;
    if (distort) {
      const shaper = this._makeDistortion(distort);
      out.connect(shaper);
      out = shaper;
    }
    out.connect(this.master);
    this._sendReverb(out, reverb);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  _burst({ duration = 0.15, gain = 0.35, filterType = 'lowpass', filterFreq = 1200, filterFreqEnd, q = 0.7, delay = 0, reverb = 0.12, distort = 0, jitter = 0 }) {
    if (!this.ctx) return;
    const pitchMult = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
    const t0 = this.ctx.currentTime + delay;
    const buffer = this._noise();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = pitchMult;
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
    let out = g;
    if (distort) {
      const shaper = this._makeDistortion(distort);
      out.connect(shaper);
      out = shaper;
    }
    out.connect(this.master);
    this._sendReverb(out, reverb);
    src.start(t0, offset, duration);
  }

  /** A continuous, very quiet horror-ambience bed — a two-oscillator low drone slowly beating
   *  against itself, plus filtered wind — started once and left running under everything. This is
   *  the single biggest "sounds designed, not beeped" upgrade available without sample libraries:
   *  a game that's never silent between explicit SFX reads as far more produced than one that is. */
  startAmbience() {
    if (!this.ctx || this._ambienceStarted) return;
    this._ambienceStarted = true;

    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.05;
    droneGain.connect(this.master);
    const droneFilter = this.ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 220;
    droneFilter.connect(droneGain);
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 55;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 55.6; // detuned against osc1 for a slow, unsettling beat
    osc1.connect(droneFilter);
    osc2.connect(droneFilter);
    osc1.start();
    osc2.start();

    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.03;
    windGain.connect(this.master);
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 320;
    windFilter.Q.value = 0.6;
    windFilter.connect(windGain);
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = this._noise();
    windSrc.loop = true;
    windSrc.connect(windFilter);
    windSrc.start();

    // A slow LFO breathing the wind's cutoff so it doesn't sit as a static hiss.
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    lfo.start();
  }

  // ---------- Weapons ----------
  shootCrossbow() {
    this._tone({ freq: 520, freqEnd: 180, duration: 0.12, type: 'triangle', gain: 0.22, distort: 4, jitter: 0.06, reverb: 0.16 });
    this._burst({ duration: 0.05, gain: 0.12, filterType: 'highpass', filterFreq: 2000, reverb: 0.1 });
  }

  shootBlunderbuss() {
    this._burst({ duration: 0.18, gain: 0.42, filterType: 'lowpass', filterFreq: 2200, filterFreqEnd: 300, distort: 8, reverb: 0.22 });
    this._tone({ freq: 90, freqEnd: 45, duration: 0.16, type: 'sawtooth', gain: 0.3, distort: 6, reverb: 0.2 });
  }

  shootChakram() {
    this._tone({ freq: 1400, freqEnd: 900, duration: 0.22, type: 'sine', gain: 0.16, detune: 12, reverb: 0.2 });
    this._tone({ freq: 1410, freqEnd: 905, duration: 0.22, type: 'sine', gain: 0.12, detune: -12, reverb: 0.2 });
  }

  shootWeapon(weaponType) {
    if (weaponType === 'blunderbuss') this.shootBlunderbuss();
    else if (weaponType === 'chakram') this.shootChakram();
    else this.shootCrossbow();
  }

  // ---------- Movement ----------
  footstep() {
    if (!this._allow('footstep', 220)) return;
    this._burst({ duration: 0.05, gain: 0.05, filterType: 'lowpass', filterFreq: 260, jitter: 0.2, reverb: 0.06 });
  }

  // ---------- Combat feedback ----------
  hitEnemy(isCrit) {
    if (!this._allow('hit', 40)) return;
    this._burst({ duration: 0.06, gain: isCrit ? 0.35 : 0.22, filterType: 'bandpass', filterFreq: isCrit ? 2600 : 1600, q: 1.2, jitter: 0.15, distort: isCrit ? 3 : 0, reverb: 0.14 });
    if (isCrit) this._tone({ freq: 900, freqEnd: 500, duration: 0.08, type: 'square', gain: 0.15, distort: 5, reverb: 0.18 });
  }

  enemyDeath() {
    if (!this._allow('death', 60)) return;
    this._tone({ freq: 220, freqEnd: 60, duration: 0.3, type: 'sawtooth', gain: 0.18, jitter: 0.1, distort: 3, reverb: 0.22 });
    this._burst({ duration: 0.12, gain: 0.15, filterType: 'lowpass', filterFreq: 500, reverb: 0.18 });
  }

  playerHurt() {
    if (!this._allow('playerHurt', 200)) return;
    this._tone({ freq: 180, freqEnd: 90, duration: 0.22, type: 'sawtooth', gain: 0.28, jitter: 0.12, distort: 4, reverb: 0.16 });
  }

  baseHit() {
    if (!this._allow('baseHit', 200)) return;
    this._tone({ freq: 110, freqEnd: 55, duration: 0.28, type: 'sine', gain: 0.3, distort: 2, reverb: 0.25 });
    this._burst({ duration: 0.15, gain: 0.2, filterType: 'lowpass', filterFreq: 400, reverb: 0.2 });
  }

  mineExplosion() {
    this._duck(0.55, 40, 500);
    this._burst({ duration: 0.42, gain: 0.5, filterType: 'lowpass', filterFreq: 3000, filterFreqEnd: 150, distort: 10, reverb: 0.4 });
    this._tone({ freq: 70, freqEnd: 28, duration: 0.4, type: 'sine', gain: 0.42, distort: 6, reverb: 0.35 });
    this._tone({ freq: 72, freqEnd: 27, duration: 0.4, type: 'sawtooth', gain: 0.18, detune: 8, distort: 6, reverb: 0.35 });
  }

  // ---------- Monster voices ----------
  zombieGroan() {
    if (!this._allow('zombieVoice', 2500)) return;
    this._tone({ freq: 140, freqEnd: 100, duration: 0.5, type: 'sawtooth', gain: 0.12, detune: -20, jitter: 0.1, distort: 3, reverb: 0.3 });
    this._tone({ freq: 138, freqEnd: 98, duration: 0.5, type: 'sawtooth', gain: 0.09, detune: 14, jitter: 0.1, reverb: 0.3 });
  }

  vampireHiss() {
    if (!this._allow('vampireVoice', 2500)) return;
    this._burst({ duration: 0.32, gain: 0.14, filterType: 'highpass', filterFreq: 3500, jitter: 0.1, reverb: 0.28 });
  }

  werewolfGrowl() {
    if (!this._allow('werewolfVoice', 2500)) return;
    this._tone({ freq: 85, freqEnd: 65, duration: 0.4, type: 'sawtooth', gain: 0.16, distort: 5, jitter: 0.08, reverb: 0.3 });
    this._burst({ duration: 0.2, gain: 0.1, filterType: 'bandpass', filterFreq: 800, q: 2, reverb: 0.28 });
  }

  revenantGroan() {
    if (!this._allow('revenantVoice', 2500)) return;
    this._tone({ freq: 60, freqEnd: 42, duration: 0.7, type: 'sawtooth', gain: 0.2, distort: 6, jitter: 0.06, reverb: 0.4 });
    this._tone({ freq: 59, freqEnd: 41, duration: 0.7, type: 'sawtooth', gain: 0.15, detune: 11, distort: 6, reverb: 0.4 });
  }

  wraithMoan() {
    if (!this._allow('wraithVoice', 2500)) return;
    this._tone({ freq: 900, freqEnd: 500, duration: 0.5, type: 'sine', gain: 0.08, jitter: 0.12, reverb: 0.42 });
    this._burst({ duration: 0.28, gain: 0.12, filterType: 'highpass', filterFreq: 4500, jitter: 0.1, reverb: 0.32 });
  }

  alphaRoar() {
    if (!this._allow('alphaVoice', 2500)) return;
    this._tone({ freq: 70, freqEnd: 48, duration: 0.55, type: 'sawtooth', gain: 0.2, distort: 6, jitter: 0.08, reverb: 0.35 });
    this._tone({ freq: 69, freqEnd: 47, duration: 0.55, type: 'sawtooth', gain: 0.15, detune: 12, distort: 6, reverb: 0.35 });
    this._burst({ duration: 0.22, gain: 0.12, filterType: 'bandpass', filterFreq: 700, q: 2, reverb: 0.3 });
  }

  monsterVoice(typeKey) {
    if (typeKey === 'vampire') this.vampireHiss();
    else if (typeKey === 'werewolf') this.werewolfGrowl();
    else if (typeKey === 'revenant') this.revenantGroan();
    else if (typeKey === 'wraith') this.wraithMoan();
    else if (typeKey === 'alpha') this.alphaRoar();
    else this.zombieGroan();
  }

  // ---------- Boss ----------
  bossSpawn() {
    this._duck(0.35, 50, 700);
    this._tone({ freq: 50, freqEnd: 34, duration: 1.4, type: 'sawtooth', gain: 0.3, distort: 5, reverb: 0.5 });
    this._tone({ freq: 51, freqEnd: 35, duration: 1.4, type: 'sawtooth', gain: 0.22, detune: 13, distort: 5, reverb: 0.5 });
    this._tone({ freq: 100, freqEnd: 68, duration: 1.4, type: 'sine', gain: 0.14, delay: 0.1, reverb: 0.5 });
    this._burst({ duration: 0.5, gain: 0.2, filterType: 'lowpass', filterFreq: 900, delay: 0.05, reverb: 0.45 });
  }

  bossSlam() {
    this._duck(0.45, 40, 450);
    this._burst({ duration: 0.35, gain: 0.45, filterType: 'lowpass', filterFreq: 2200, filterFreqEnd: 120, distort: 9, reverb: 0.35 });
    this._tone({ freq: 55, freqEnd: 22, duration: 0.4, type: 'sine', gain: 0.4, distort: 5, reverb: 0.35 });
    this._tone({ freq: 56, freqEnd: 23, duration: 0.4, type: 'sawtooth', gain: 0.16, detune: 9, distort: 5, reverb: 0.35 });
  }

  // A bright rising-then-collapsing shimmer instead of a low-end thud — reads as a teleport
  // snap, distinct from the revenant's slam and the alpha's howl.
  wraithBlink() {
    this._duck(0.3, 30, 300);
    this._tone({ freq: 1800, freqEnd: 300, duration: 0.22, type: 'sine', gain: 0.28, reverb: 0.4 });
    this._tone({ freq: 2200, freqEnd: 260, duration: 0.22, type: 'triangle', gain: 0.16, delay: 0.02, reverb: 0.4 });
    this._burst({ duration: 0.18, gain: 0.3, filterType: 'highpass', filterFreq: 2000, distort: 3, reverb: 0.35 });
  }

  // A rising howl sweep to cue the summon, distinct from both other boss abilities.
  alphaHowl() {
    this._duck(0.3, 60, 500);
    this._tone({ freq: 300, freqEnd: 700, duration: 0.9, type: 'sawtooth', gain: 0.22, distort: 3, reverb: 0.5 });
    this._tone({ freq: 302, freqEnd: 705, duration: 0.9, type: 'sawtooth', gain: 0.14, detune: 10, reverb: 0.5 });
    this._burst({ duration: 0.3, gain: 0.14, filterType: 'bandpass', filterFreq: 1200, q: 1.5, delay: 0.1, reverb: 0.45 });
  }

  // ---------- Economy / UI ----------
  // UI sounds are deliberately dry (no reverb) — the interface isn't "in the room" with the
  // graveyard, so it should read as clean and immediate against the wetter, spatial world sounds.
  goldPickup() {
    if (!this._allow('gold', 90)) return;
    this._tone({ freq: 1200, duration: 0.06, type: 'sine', gain: 0.09, reverb: 0 });
  }

  purchase() {
    this._tone({ freq: 660, duration: 0.08, type: 'sine', gain: 0.18, reverb: 0 });
    this._tone({ freq: 990, duration: 0.1, type: 'sine', gain: 0.16, delay: 0.07, reverb: 0 });
    this._tone({ freq: 992, duration: 0.1, type: 'triangle', gain: 0.08, delay: 0.07, detune: 6, reverb: 0 });
  }

  buttonClick() {
    this._tone({ freq: 500, duration: 0.04, type: 'square', gain: 0.07, reverb: 0 });
  }

  menuOpen() {
    this._tone({ freq: 300, freqEnd: 500, duration: 0.1, type: 'sine', gain: 0.12, reverb: 0 });
  }

  menuClose() {
    this._tone({ freq: 500, freqEnd: 280, duration: 0.1, type: 'sine', gain: 0.12, reverb: 0 });
  }

  waveStart() {
    this._duck(0.3, 30, 400);
    this._tone({ freq: 110, freqEnd: 70, duration: 0.9, type: 'sawtooth', gain: 0.22, distort: 3, reverb: 0.35 });
    this._tone({ freq: 165, freqEnd: 100, duration: 0.9, type: 'sine', gain: 0.14, delay: 0.05, reverb: 0.35 });
    this._tone({ freq: 111, freqEnd: 71, duration: 0.9, type: 'sawtooth', gain: 0.14, detune: 9, reverb: 0.35 });
  }

  waveClear() {
    this._tone({ freq: 660, duration: 0.12, type: 'triangle', gain: 0.2, reverb: 0.2 });
    this._tone({ freq: 880, duration: 0.16, type: 'triangle', gain: 0.2, delay: 0.1, reverb: 0.2 });
    this._tone({ freq: 1100, duration: 0.22, type: 'triangle', gain: 0.2, delay: 0.2, reverb: 0.25 });
    this._tone({ freq: 1101, duration: 0.22, type: 'sine', gain: 0.1, delay: 0.2, detune: 7, reverb: 0.25 });
  }

  gameOver() {
    this._duck(0.4, 60, 800);
    this._tone({ freq: 220, freqEnd: 60, duration: 1.1, type: 'sawtooth', gain: 0.25, distort: 4, reverb: 0.4 });
    this._tone({ freq: 165, freqEnd: 45, duration: 1.1, type: 'sawtooth', gain: 0.2, delay: 0.08, distort: 4, reverb: 0.4 });
    this._tone({ freq: 111, freqEnd: 30, duration: 1.2, type: 'sine', gain: 0.15, delay: 0.16, reverb: 0.45 });
  }
}
