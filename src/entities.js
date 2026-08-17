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

// How far from the player's ground position (in the aim direction) bullets spawn. Shared with
// Renderer3D.buildPlayerModel() (src/render3d.js), which builds the weapon model to reach
// exactly this far, so the visible barrel tip and the actual bullet spawn point can never drift
// apart. The player now truly rotates to face aimAngle (see Renderer3D.yawFromAngle) rather than
// mirroring like the old 2D renderer did, so this is just a straight radial offset.
const PLAYER_MUZZLE_DISTANCE = 34;

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
    return {
      x: this.x + Math.cos(this.aimAngle) * PLAYER_MUZZLE_DISTANCE,
      y: this.y + Math.sin(this.aimAngle) * PLAYER_MUZZLE_DISTANCE,
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
        weapon.pierce,
        this.equippedWeapon
      ));
    }
    return bullets;
  }
}

class Bullet {
  constructor(x, y, angle, speed, damage, isCrit = false, pierce = 0, weaponType = 'crossbow') {
    this.x = x;
    this.y = y;
    this.angle = angle; // kept for rendering (arrow/bolt shaft orientation), not just vx/vy
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.radius = isCrit ? 5 : 4;
    this.damage = damage;
    this.isCrit = isCrit;
    this.pierceRemaining = pierce;
    this.isPiercing = pierce > 0;
    this.weaponType = weaponType; // which weapon fired it, so its visual can match (arrow/bullet/chakram)
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

// How often (seconds) an enemy in contact range lands another melee hit. Shared with
// Renderer3D (src/render3d.js), which uses it to time the "wind up and strike" idle animation
// so the visible swing roughly lines up with when damage actually lands.
const ENEMY_ATTACK_INTERVAL = 0.8;

// preferBaseChance: how likely a freshly spawned enemy of this type is to head for the ward
// instead of hunting the player — see the target-selection comment on Enemy for how this plays
// out. Zombies mostly siege the ward, vampires mostly hunt the player, werewolves are a
// coin flip either way.
const ENEMY_TYPES = {
  zombie: {
    radius: 12,
    speed: 70,
    health: 30,
    damage: 10,
    reward: 5,
    preferBaseChance: 0.7,
  },
  vampire: {
    radius: 9,
    speed: 130,
    health: 16,
    damage: 6,
    reward: 6,
    preferBaseChance: 0.25,
  },
  werewolf: {
    radius: 18,
    speed: 42,
    health: 110,
    damage: 22,
    reward: 15,
    preferBaseChance: 0.5,
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
    this._isMoving = false;
    this._attackCooldown = 0; // seconds until it can land another melee hit on contact
    // Fixed at spawn so a wave reliably splits its pressure between the ward and the hunter
    // instead of every enemy always beelining for whichever happens to be a step closer right
    // now. update() below still lets an enemy get opportunistically distracted by whichever
    // target is currently *much* closer than its preferred one.
    this.targetPreference = Math.random() < def.preferBaseChance ? 'base' : 'player';
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
    return this.radius * 1.8;
  }

  /**
   * speedMult lets fences (or future effects) slow an enemy for this frame without touching its
   * base speed. Stops advancing once it reaches contact range of its target instead of walking
   * through and standing inside it — target.radius (both Base and Player have one) is the edge
   * it should stop at.
   */
  update(dt, target, speedMult = 1) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distToTarget = Math.hypot(dx, dy);
    const stopDist = (target.radius || 0) + this.radius;
    if (distToTarget > 0.001) this.angle = Math.atan2(dy, dx);
    this._isMoving = distToTarget > stopDist;
    if (this._isMoving) {
      const effectiveSpeed = this.speed * speedMult;
      const invDist = 1 / distToTarget;
      this.x += dx * invDist * effectiveSpeed * dt;
      this.y += dy * invDist * effectiveSpeed * dt;
      this._walkPhase += effectiveSpeed * dt * 0.05;
    }
    if (this._hitFlash > 0) this._hitFlash -= dt;
    if (this._attackCooldown > 0) this._attackCooldown -= dt;
  }

  takeDamage(amount) {
    this.health -= amount;
    this._hitFlash = 0.08;
    if (this.health <= 0) this.alive = false;
  }
}
