// Wave spawning logic: defines what enemies appear on each wave and paces their spawn timing.

const BOSS_WAVE_INTERVAL = 5; // every 5th wave (5, 10, 15, ...) gets a boss

// Which boss shows up on which boss-wave tier, rotating so wave 5/20/35... is always a revenant,
// 10/25/40... a wraith, 15/30/45... an alpha — three distinct fight patterns instead of the same
// boss repeating forever.
const BOSS_ROTATION = ['revenant', 'wraith', 'alpha'];

class WaveManager {
  constructor(bounds) {
    this.bounds = bounds;
    this.waveNumber = 0;
    this.spawnQueue = [];
    this._spawnTimer = 0;
    this.active = false;
  }

  isBossWave(waveNumber) {
    return waveNumber > 0 && waveNumber % BOSS_WAVE_INTERVAL === 0;
  }

  /** Which boss type appears on a given boss wave — see BOSS_ROTATION above. */
  bossForWave(waveNumber) {
    const tier = waveNumber / BOSS_WAVE_INTERVAL;
    return BOSS_ROTATION[(tier - 1) % BOSS_ROTATION.length];
  }

  /**
   * Builds the composition of enemies for the given wave number. Wave 1 is deliberately soft
   * (a handful of zombies only, no HP scaling) so a fresh run with zero upgrades isn't
   * overwhelming; difficulty then ramps gradually wave over wave as the player banks gold and
   * buys stat upgrades / new weapons between hunts, rather than front-loading the spike.
   */
  _buildWave(waveNumber) {
    const waveScale = 1 + Math.max(0, waveNumber - 1) * 0.12; // gentler HP ramp, still flat on wave 1
    const queue = [];

    const zombieCount = 3 + Math.floor(waveNumber * 1.4);
    for (let i = 0; i < zombieCount; i++) queue.push('zombie');

    if (waveNumber >= 3) {
      const vampireCount = 1 + Math.floor((waveNumber - 2) * 1.0);
      for (let i = 0; i < vampireCount; i++) queue.push('vampire');
    }

    if (waveNumber >= 5) {
      const werewolfCount = Math.floor((waveNumber - 3) / 2);
      for (let i = 0; i < werewolfCount; i++) queue.push('werewolf');
    }

    // Shuffle so enemy types are interleaved rather than clumped.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    if (this.isBossWave(waveNumber)) {
      // Appended last, after every regular enemy in the wave — the whole point is giving the
      // player the entire wave's worth of chaff-clearing time before the boss shows up at all,
      // instead of still having a field full of regular enemies to deal with when it arrives.
      queue.push(this.bossForWave(waveNumber));
    }

    return { queue, waveScale };
  }

  /** Total gold a full clear of this wave actually pays out: every kill reward in its
   *  composition plus the wave-clear bonus. The composition (counts per enemy type) is a pure
   *  function of wave number — only the spawn *order* is randomized — so this total is exact,
   *  not an estimate, and is what checkpoint-start stipends are built from (see game.js's
   *  checkpointStipend) so skipping ahead hands over the gold a real clear would have earned. */
  waveGoldValue(waveNumber) {
    const { queue } = this._buildWave(waveNumber);
    let total = 10 + waveNumber * 2; // wave-clear bonus
    for (const typeKey of queue) total += ENEMY_TYPES[typeKey].reward;
    return total;
  }

  startNextWave() {
    this.waveNumber += 1;
    const { queue, waveScale } = this._buildWave(this.waveNumber);
    this.spawnQueue = queue;
    this.waveScale = waveScale;
    this._spawnTimer = 0;
    this.active = true;
  }

  get totalRemaining() {
    return this.spawnQueue.length;
  }

  // Spawns trickle in slowly on early waves and pace up gradually — never instantaneous. A plain
  // getter (not just inlined in update() below) so secondsUntilBoss() can use the exact same
  // number to predict when a still-queued spawn will actually happen.
  get spawnInterval() {
    return clamp(1.15 - this.waveNumber * 0.035, 0.25, 1.15);
  }

  /** Returns a spawned Enemy instance when it's time, or null. */
  update(dt, enemiesAliveCount) {
    if (!this.active) return null;
    if (this.spawnQueue.length === 0) return null;

    this._spawnTimer -= dt;
    if (this._spawnTimer > 0) return null;

    this._spawnTimer = this.spawnInterval;

    const typeKey = this.spawnQueue.shift();
    const { x, y } = this._randomEdgePoint();
    return new Enemy(x, y, typeKey, this.waveScale);
  }

  /** Seconds until the boss spawns, or null if this isn't a boss wave or it's already out.
   *  Spawns are paced purely by a timer (not gated on how many enemies are still alive), so this
   *  is an exact prediction, not a guess: the boss is however many spawns deep in the queue,
   *  each spaced spawnInterval apart, plus whatever's left on the timer for the very next one. */
  secondsUntilBoss() {
    if (!this.active) return null;
    const idx = this.spawnQueue.findIndex((t) => BOSS_ROTATION.includes(t));
    if (idx === -1) return null;
    return this._spawnTimer + idx * this.spawnInterval;
  }

  /** Which boss type is queued up next, or null if none is coming this wave. Lets the HUD name
   *  the incoming boss in the warning countdown instead of assuming it's always the revenant. */
  upcomingBossType() {
    if (!this.active) return null;
    return this.spawnQueue.find((t) => BOSS_ROTATION.includes(t)) || null;
  }

  _randomEdgePoint() {
    const side = Math.floor(Math.random() * 4);
    const { width, height } = this.bounds;
    const margin = 30;
    switch (side) {
      case 0: return { x: Math.random() * width, y: -margin };
      case 1: return { x: width + margin, y: Math.random() * height };
      case 2: return { x: Math.random() * width, y: height + margin };
      default: return { x: -margin, y: Math.random() * height };
    }
  }

  isWaveCleared(enemiesAliveCount) {
    return this.active && this.spawnQueue.length === 0 && enemiesAliveCount === 0;
  }

  finishWave() {
    this.active = false;
  }
}
