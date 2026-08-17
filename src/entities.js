// Core game entities: Base (the ward), Player (demon hunter), Bullet, Enemy (monsters).
//
// Pure logic/state only — no rendering code lives here. The 3D view for each of these is owned
// and animated by Renderer3D (src/render3d.js), which reads this state each frame and updates a
// parallel set of Three.js meshes. Keeping rendering fully separate means this file only has to
// get gameplay right: movement, health, hit detection, muzzle/spawn math.

class Base {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 34;
    this.maxHealth = 200;
    this.health = this.maxHealth;
  }

  takeDamage(amount) {
    this.health = clamp(this.health - amount, 0, this.maxHealth);
  }

  get isDestroyed() {
    return this.health <= 0;
  }
}

// Shared between Player.getMuzzlePosition() and the old 2D renderer; kept here since the muzzle
// position is gameplay state (where bullets actually spawn), not just a visual detail.
const PLAYER_LEG_LEN_MULT = 1.15;
const PLAYER_TORSO_LEN_MULT = 1.35;
const PLAYER_WEAPON_PIVOT_X_MULT = 0.3;
const PLAYER_WEAPON_PIVOT_Y_MULT = 0.22;

class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 14;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.speed = 220; // px/sec
    this.aimAngle = 0;

    // Upgradeable combat stats
    this.damage = 10;
    this.fireRate = 4; // shots per second
    this.bulletSpeed = 520;
    this.critChance = 0; // 0..1, from upgrades

    // Weapon loadout
    this.unlockedWeapons = ['crossbow'];
    this.equippedWeapon = 'crossbow';

    this._fireCooldown = 0;
    this._walkPhase = 0;
    this._isMoving = false;
  }

  /** World-space position of the weapon's muzzle — where bullets actually spawn. */
  getMuzzlePosition() {
    const r = this.radius;
    const facingRight = Math.cos(this.aimAngle) >= 0;
    const shoulderY = -r * PLAYER_LEG_LEN_MULT - r * PLAYER_TORSO_LEN_MULT;
    const pivotX = r * PLAYER_WEAPON_PIVOT_X_MULT;
    const pivotY = shoulderY + r * PLAYER_WEAPON_PIVOT_Y_MULT;
    const localAngle = facingRight ? this.aimAngle : Math.PI - this.aimAngle;
    const muzzleLen = r * WEAPON_MUZZLE_LENGTH;
    const tipLocalX = pivotX + Math.cos(localAngle) * muzzleLen;
    const tipLocalY = pivotY + Math.sin(localAngle) * muzzleLen;
    return {
      x: this.x + (facingRight ? tipLocalX : -tipLocalX),
      y: this.y + tipLocalY,
    };
  }

  swapWeapon() {
    if (this.unlockedWeapons.length < 2) return;
    const idx = this.unlockedWeapons.indexOf(this.equippedWeapon);
    this.equippedWeapon = this.unlockedWeapons[(idx + 1) % this.unlockedWeapons.length];
  }

  get isDead() {
    return this.health <= 0;
  }

  takeDamage(amount) {
    this.health = clamp(this.health - amount, 0, this.maxHealth);
  }

  heal(amount) {
    this.health = clamp(this.health + amount, 0, this.maxHealth);
  }

  /** control: { moveX, moveY, moveMag, aimAngle, firing } from InputManager.getControlState(). */
  update(dt, control, bounds) {
    const moveSpeed = control.moveMag * this.speed;
    this.x = clamp(this.x + control.moveX * control.moveMag * this.speed * dt, this.radius, bounds.width - this.radius);
    this.y = clamp(this.y + control.moveY * control.moveMag * this.speed * dt, this.radius, bounds.height - this.radius);

    this._isMoving = control.moveMag > 0.05;
    this._walkPhase += moveSpeed * dt * 0.045;

    this.aimAngle = control.aimAngle;

    if (this._fireCooldown > 0) this._fireCooldown -= dt;
  }

  tryFire() {
    const weapon = WEAPON_TYPES[this.equippedWeapon];
    if (this._fireCooldown > 0) return [];
    this._fireCooldown = 1 / (this.fireRate * weapon.fireRateMult);

    const muzzle = this.getMuzzlePosition();
    const pellets = weapon.pellets;
    const bullets = [];
    for (let i = 0; i < pellets; i++) {
      const t = pellets === 1 ? 0 : i / (pellets - 1) - 0.5;
      const angle = this.aimAngle + t * weapon.spreadAngle;
      const isCrit = Math.random() < this.critChance;
      const dmg = (isCrit ? this.damage * 2 : this.damage) * weapon.damageMult;
      bullets.push(new Bullet(
        muzzle.x,
        muzzle.y,
        angle,
        this.bulletSpeed * weapon.bulletSpeedMult,
        dmg,
        isCrit,
        weapon.pierce
      ));
    }
    return bullets;
  }
}

class Bullet {
  constructor(x, y, angle, speed, damage, isCrit = false, pierce = 0) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.radius = isCrit ? 5 : 4;
    this.damage = damage;
    this.isCrit = isCrit;
    this.pierceRemaining = pierce;
    this.isPiercing = pierce > 0;
    this.hitEnemies = new Set();
    this.alive = true;
  }

  update(dt, bounds) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < -20 || this.x > bounds.width + 20 || this.y < -20 || this.y > bounds.height + 20) {
      this.alive = false;
    }
  }
}

const ENEMY_TYPES = {
  zombie: {
    radius: 12,
    speed: 70,
    health: 30,
    damage: 10,
    reward: 5,
  },
  vampire: {
    radius: 9,
    speed: 130,
    health: 16,
    damage: 6,
    reward: 6,
  },
  werewolf: {
    radius: 18,
    speed: 42,
    health: 110,
    damage: 22,
    reward: 15,
  },
};

class Enemy {
  constructor(x, y, typeKey, waveScale = 1) {
    const def = ENEMY_TYPES[typeKey];
    this.typeKey = typeKey;
    this.x = x;
    this.y = y;
    this.radius = def.radius;
    this.speed = def.speed;
    this.maxHealth = Math.round(def.health * waveScale);
    this.health = this.maxHealth;
    this.damage = def.damage;
    this.reward = def.reward;
    this.alive = true;
    this.angle = 0;
    this._hitFlash = 0;
    this._walkPhase = 0;
  }

  /**
   * Bullets need to hit the visible body, not just the feet: this.x/this.y is the ground
   * anchor the rig stands on, but the model rises roughly 2.8-3x the radius above that point.
   * Centering the hit test there, with a correspondingly larger radius, is what makes headshots
   * (and everything above the ankles) actually register instead of only the lowest leg sliver.
   */
  getHitCenter() {
    return { x: this.x, y: this.y - this.radius * 1.45 };
  }

  get hitRadius() {
    return this.radius * 1.55;
  }

  /** speedMult lets fences (or future effects) slow an enemy for this frame without touching its base speed. */
  update(dt, target, speedMult = 1) {
    const dir = normalize(target.x - this.x, target.y - this.y);
    this.angle = Math.atan2(dir.y, dir.x);
    const effectiveSpeed = this.speed * speedMult;
    this.x += dir.x * effectiveSpeed * dt;
    this.y += dir.y * effectiveSpeed * dt;
    this._walkPhase += effectiveSpeed * dt * 0.05;
    if (this._hitFlash > 0) this._hitFlash -= dt;
  }

  takeDamage(amount) {
    this.health -= amount;
    this._hitFlash = 0.08;
    if (this.health <= 0) this.alive = false;
  }
}
