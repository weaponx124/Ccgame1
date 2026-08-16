// Core game entities: Base (the ward), Player (demon hunter), Bullet, Enemy (monsters).
// Rendering fakes volume/depth with radial-gradient shading, ground shadows, and glow —
// there's no real 3D here, just Canvas 2D tricks in service of a gothic look.

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

  draw(ctx, time = 0) {
    const r = this.radius;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + r * 0.55, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    const stoneGrad = ctx.createLinearGradient(this.x - r, this.y - r, this.x + r, this.y + r);
    stoneGrad.addColorStop(0, '#4d4152');
    stoneGrad.addColorStop(0.5, '#2a2230');
    stoneGrad.addColorStop(1, '#140e18');
    ctx.fillStyle = stoneGrad;
    ctx.strokeStyle = '#8a6a4a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(this.x - r, this.y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x - r + 5, this.y - r + 5, r * 2 - 10, r * 2 - 10);

    // Pulsing rune-glow core.
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    const glowR = r * (0.44 + pulse * 0.06);
    const runeGlow = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, glowR);
    runeGlow.addColorStop(0, `rgba(150, 70, 220, ${0.55 + pulse * 0.25})`);
    runeGlow.addColorStop(1, 'rgba(150, 70, 220, 0)');
    ctx.fillStyle = runeGlow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#c9a44c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();
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

  /** control: { moveX, moveY, moveMag, aimAngle, firing } from InputManager.getControlState(). */
  update(dt, control, bounds) {
    this.x = clamp(this.x + control.moveX * control.moveMag * this.speed * dt, this.radius, bounds.width - this.radius);
    this.y = clamp(this.y + control.moveY * control.moveMag * this.speed * dt, this.radius, bounds.height - this.radius);

    this.aimAngle = control.aimAngle;

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
    const r = this.radius;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + r * 0.55, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.aimAngle);

    // Hood/cloak trailing behind (drawn first so the body overlaps it).
    ctx.fillStyle = 'rgba(10,6,8,0.75)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, 0, r * 0.6, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cloaked body, volumetric shading toward local front/top.
    const bodyGrad = ctx.createRadialGradient(-r * 0.15, -r * 0.35, r * 0.1, 0, 0, r * 1.3);
    bodyGrad.addColorStop(0, '#5a4238');
    bodyGrad.addColorStop(0.6, '#2e2018');
    bodyGrad.addColorStop(1, '#150e0c');
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#c9a44c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Glowing eyes, near the front of the hood.
    ctx.fillStyle = '#f0d98c';
    ctx.shadowColor = '#f0d98c';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(r * 0.32, -r * 0.22, 1.6, 0, Math.PI * 2);
    ctx.arc(r * 0.32, r * 0.22, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Crossbow, extending forward in the aim direction.
    ctx.strokeStyle = '#8a8a94';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r * 1.05, -r * 0.5);
    ctx.lineTo(r * 1.05, r * 0.5);
    ctx.stroke();
    ctx.strokeStyle = '#d6d6de';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, 0);
    ctx.lineTo(r * 1.6, 0);
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
    const glowColor = this.isCrit ? '#ff8c3c' : '#e0c068';
    const len = this.isCrit ? 13 : 9;
    const angle = Math.atan2(this.vy, this.vx);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);

    const trailGrad = ctx.createLinearGradient(-len, 0, len * 0.3, 0);
    trailGrad.addColorStop(0, 'rgba(0,0,0,0)');
    trailGrad.addColorStop(1, glowColor);
    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = this.isCrit ? 3 : 2;
    ctx.lineCap = 'round';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = this.isCrit ? 7 : 4;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len * 0.3, 0);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff6de';
    ctx.beginPath();
    ctx.arc(len * 0.3, 0, this.radius * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

function drawZombieBody(ctx, r) {
  const grad = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r * 1.2);
  grad.addColorStop(0, '#7a8f52');
  grad.addColorStop(0.6, '#4d5c34');
  grad.addColorStop(1, '#26301a');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#9db06a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Rot patches.
  ctx.fillStyle = 'rgba(30,20,10,0.5)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, r * 0.3, r * 0.25, r * 0.18, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c81f2f';
  ctx.beginPath();
  ctx.arc(r * 0.35, -r * 0.25, 1.6, 0, Math.PI * 2);
  ctx.arc(r * 0.35, r * 0.25, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawVampireBody(ctx, r) {
  // Cape, fanned out behind.
  ctx.fillStyle = 'rgba(90,10,25,0.85)';
  ctx.beginPath();
  ctx.moveTo(-r * 0.2, 0);
  ctx.lineTo(-r * 1.4, -r * 0.9);
  ctx.lineTo(-r * 1.05, 0);
  ctx.lineTo(-r * 1.4, r * 0.9);
  ctx.closePath();
  ctx.fill();

  const grad = ctx.createRadialGradient(-r * 0.1, -r * 0.3, r * 0.05, 0, 0, r);
  grad.addColorStop(0, '#2c1420');
  grad.addColorStop(1, '#0f0710');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#c81f3f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.85, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Pale face.
  ctx.fillStyle = 'rgba(230,220,210,0.85)';
  ctx.beginPath();
  ctx.ellipse(r * 0.3, 0, r * 0.32, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e01030';
  ctx.shadowColor = '#e01030';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.arc(r * 0.42, -r * 0.12, 1.4, 0, Math.PI * 2);
  ctx.arc(r * 0.42, r * 0.12, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawWerewolfBody(ctx, r) {
  const grad = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.15, 0, 0, r * 1.3);
  grad.addColorStop(0, '#8a6a4a');
  grad.addColorStop(0.55, '#5a4230');
  grad.addColorStop(1, '#281c14');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#a88a5a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Ears.
  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.7);
  ctx.lineTo(-r * 0.05, -r * 1.15);
  ctx.lineTo(r * 0.15, -r * 0.65);
  ctx.closePath();
  ctx.fill();

  // Snout.
  ctx.fillStyle = '#4a3626';
  ctx.beginPath();
  ctx.ellipse(r * 0.75, 0, r * 0.35, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f0c020';
  ctx.shadowColor = '#f0c020';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(r * 0.25, -r * 0.3, 2, 0, Math.PI * 2);
  ctx.arc(r * 0.25, r * 0.3, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

const ENEMY_BODY_DRAWERS = {
  zombie: drawZombieBody,
  vampire: drawVampireBody,
  werewolf: drawWerewolfBody,
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
  }

  update(dt, target) {
    const dir = normalize(target.x - this.x, target.y - this.y);
    this.angle = Math.atan2(dir.y, dir.x);
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
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + this.radius * 0.45, this.radius * 0.9, this.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const drawBody = ENEMY_BODY_DRAWERS[this.typeKey] || drawZombieBody;
    drawBody(ctx, this.radius);

    if (this._hitFlash > 0) {
      ctx.globalAlpha = clamp(this._hitFlash / 0.08, 0, 1) * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius, this.radius * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (this.health < this.maxHealth) {
      const w = this.radius * 2;
      const pct = clamp(this.health / this.maxHealth, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 10, w, 4);
      ctx.fillStyle = '#8f1f2b';
      ctx.fillRect(this.x - w / 2, this.y - this.radius - 10, w * pct, 4);
    }
  }
}
