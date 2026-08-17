// Wave spawning logic: defines what enemies appear on each wave and paces their spawn timing.

const BOSS_WAVE_INTERVAL = 5; // every 5th wave (5, 10, 15, ...) gets a revenant

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
      // Inserted partway through (not first, not last) so the regular chaff arrives and gets
      // fought through first — the boss shows up mid-wave instead of announcing itself instantly.
      queue.splice(Math.floor(queue.length / 2), 0, 'revenant');
    }

    return { queue, waveScale };
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

  /** Returns a spawned Enemy instance when it's time, or null. */
  update(dt, enemiesAliveCount) {
    if (!this.active) return null;
    if (this.spawnQueue.length === 0) return null;

    this._spawnTimer -= dt;
    if (this._spawnTimer > 0) return null;

    // Spawns trickle in slowly on early waves and pace up gradually — never instantaneous.
    this._spawnTimer = clamp(1.15 - this.waveNumber * 0.035, 0.25, 1.15);

    const typeKey = this.spawnQueue.shift();
    const { x, y } = this._randomEdgePoint();
    return new Enemy(x, y, typeKey, this.waveScale);
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
