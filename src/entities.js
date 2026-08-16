// Core game entities: Base, Player, Bullet, Enemy.

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

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#2472c8';
    ctx.strokeStyle = '#9fd0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
    ctx.fill();
    ctx.stroke();

    // Inner core glow
    ctx.fillStyle = 'rgba(159, 208, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

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

    this._fireCooldown = 0;
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

  update(dt, input, bounds) {
    let dx = 0;
    let dy = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) dy -= 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) dy += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) dx -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) dx += 1;

    const dir = normalize(dx, dy);
    this.x = clamp(this.x + dir.x * this.speed * dt, this.radius, bounds.width - this.radius);
    this.y = clamp(this.y + dir.y * this.speed * dt, this.radius, bounds.height - this.radius);

    this.aimAngle = Math.atan2(input.mouseY - this.y, input.mouseX - this.x);

    if (this._fireCooldown > 0) this._fireCooldown -= dt;
  }

  tryFire() {
    if (this._fireCooldown > 0) return null;
    this._fireCooldown = 1 / this.fireRate;

    const isCrit = Math.random() < this.critChance;
    const dmg = isCrit ? this.damage * 2 : this.damage;

    return new Bullet(
      this.x + Math.cos(this.aimAngle) * (this.radius + 6),
      this.y + Math.sin(this.aimAngle) * (this.radius + 6),
      this.aimAngle,
      this.bulletSpeed,
      dmg,
      isCrit
    );
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = '#38bf59';
    ctx.strokeStyle = '#c8ffd6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Aim indicator
    ctx.strokeStyle = '#c8ffd6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(this.aimAngle) * (this.radius + 12), this.y + Math.sin(this.aimAngle) * (this.radius + 12));
    ctx.stroke();
    ctx.restore();
  }
}

class Bullet {
  constructor(x, y, angle, speed, damage, isCrit = false) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.radius = isCrit ? 5 : 4;
    this.damage = damage;
    this.isCrit = isCrit;
    this.alive = true;
  }

  update(dt, bounds) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < -20 || this.x > bounds.width + 20 || this.y < -20 || this.y > bounds.height + 20) {
      this.alive = false;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = this.isCrit ? '#ff5f5f' : '#f7d354';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

const ENEMY_TYPES = {
  grunt: {
    color: '#d64b4b',
    outline: '#ffb3b3',
    radius: 12,
    speed: 70,
    health: 30,
    damage: 10,
    reward: 5,
  },
  runner: {
    color: '#d68f4b',
    outline: '#ffd9b3',
    radius: 9,
    speed: 130,
    health: 16,
    damage: 6,
    reward: 6,
  },
  tank: {
    color: '#7a3fbf',
    outline: '#d6b3ff',
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
    this.color = def.color;
    this.outline = def.outline;
    this.speed = def.speed;
    this.maxHealth = Math.round(def.health * waveScale);
    this.health = this.maxHealth;
    this.damage = def.damage;
    this.reward = def.reward;
    this.alive = true;
    this._hitFlash = 0;
  }

  update(dt, target) {
    const dir = normalize(target.x - this.x, target.y - this.y);
    this.x += dir.x * this.speed * dt;
    this.y += dir.y * this.speed * dt;
    if (this._hitFlash > 0) this._hitFlash -= dt;
  }

  takeDamage(amount) {
    this.health -= amount;
    this._hitFlash = 0.08;
    if (this.health <= 0) this.alive = false;
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = this._hitFlash > 0 ? '#ffffff' : this.color;
    ctx.strokeStyle = this.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Health bar above enemy
    if (this.health < this.maxHealth) {
      const w = this.radius * 2;
      const pct = clamp(this.health / this.maxHealth, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 10, w, 4);
      ctx.fillStyle = '#4fdc6f';
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 10, w * pct, 4);
    }
    ctx.restore();
  }
}
