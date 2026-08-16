// Wave spawning logic: defines what enemies appear on each wave and paces their spawn timing.

class WaveManager {
  constructor(bounds) {
    this.bounds = bounds;
    this.waveNumber = 0;
    this.spawnQueue = [];
    this._spawnTimer = 0;
    this.active = false;
  }

  /** Builds the composition of enemies for the given wave number. */
  _buildWave(waveNumber) {
    const waveScale = 1 + (waveNumber - 1) * 0.18; // enemies get tougher over time
    const queue = [];

    const gruntCount = 4 + waveNumber * 2;
    for (let i = 0; i < gruntCount; i++) queue.push('grunt');

    if (waveNumber >= 2) {
      const runnerCount = 2 + Math.floor(waveNumber * 1.2);
      for (let i = 0; i < runnerCount; i++) queue.push('runner');
    }

    if (waveNumber >= 3) {
      const tankCount = Math.floor(waveNumber / 2);
      for (let i = 0; i < tankCount; i++) queue.push('tank');
    }

    // Shuffle so enemy types are interleaved rather than clumped.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
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

    // Pace spawns a bit faster on later waves, but never instantaneous.
    this._spawnTimer = clamp(0.9 - this.waveNumber * 0.03, 0.22, 0.9);

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
