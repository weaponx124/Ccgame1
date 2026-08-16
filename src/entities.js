// Core game entities: Base (the ward), Player (demon hunter), Bullet, Enemy (monsters).
//
// Rendering model: a fixed 3/4-elevated view, like Vampire Survivors/Brotato rather than a
// strict bird's-eye view. Characters don't spin to face their movement/aim direction — they
// stand upright with feet anchored at the entity's true (x, y) position and the body rising
// above it, and only mirror left/right (via ctx.scale(-1, 1)) based on which way they're
// facing. That's what keeps the illusion of "camera angle" coherent: a rotating photo of
// someone viewed from a 3/4 angle stops looking right almost immediately, but a mirrored one
// still reads fine. Legs/arms are simple two-segment limbs (drawLimb) that swing on a walk-
// cycle phase driven by distance actually travelled, so motion freezes when something is
// stationary instead of animating in place.

/** Perpendicular offset from the segment midpoint — used to bend a 2-segment limb at the "knee". */
function limbBend(x1, y1, x2, y2, bend) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mx + (-dy / len) * bend, y: my + (dx / len) * bend };
}

function drawLimb(ctx, hipX, hipY, footX, footY, bend, thickness, color) {
  const knee = limbBend(hipX, hipY, footX, footY, bend);
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(footX, footY);
  ctx.stroke();
}

/** Converts a true world-space angle into the local angle to draw at, given a possible mirror flip. */
function localAngleFor(worldAngle, facingRight) {
  return facingRight ? worldAngle : Math.PI - worldAngle;
}

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
    const x = this.x;
    const y = this.y;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.7, r * 1.3, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();

    // Stepped stone base for a sense of height: a wider, darker slab beneath the altar top.
    const stepGrad = ctx.createLinearGradient(x - r * 1.2, y - r * 0.2, x + r * 1.2, y + r * 1.1);
    stepGrad.addColorStop(0, '#332b38');
    stepGrad.addColorStop(1, '#0e0a12');
    ctx.fillStyle = stepGrad;
    ctx.strokeStyle = '#5c4a34';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x - r * 1.18, y - r * 0.15, r * 2.36, r * 1.05);
    ctx.fill();
    ctx.stroke();

    // Altar top.
    const stoneGrad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    stoneGrad.addColorStop(0, '#4d4152');
    stoneGrad.addColorStop(0.5, '#2a2230');
    stoneGrad.addColorStop(1, '#140e18');
    ctx.fillStyle = stoneGrad;
    ctx.strokeStyle = '#8a6a4a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - r + 5, y - r + 5, r * 2 - 10, r * 2 - 10);

    // Corner pillar accents.
    ctx.fillStyle = '#6b5a3a';
    const pillarR = r * 0.12;
    for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.arc(x + px * r * 0.85, y + py * r * 0.85, pillarR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rune carvings (simple etched lines on each edge).
    ctx.strokeStyle = 'rgba(180, 140, 220, 0.35)';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(x + i * r * 0.65, y - r * 0.9);
      ctx.lineTo(x + i * r * 0.65, y - r * 0.65);
      ctx.moveTo(x - r * 0.9, y + i * r * 0.65);
      ctx.lineTo(x - r * 0.65, y + i * r * 0.65);
      ctx.stroke();
    }

    // Pulsing rune-glow core.
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    const glowR = r * (0.44 + pulse * 0.06);
    const runeGlow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    runeGlow.addColorStop(0, `rgba(150, 70, 220, ${0.55 + pulse * 0.25})`);
    runeGlow.addColorStop(1, 'rgba(150, 70, 220, 0)');
    ctx.fillStyle = runeGlow;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#c9a44c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();

    // Embers orbiting the core.
    for (let i = 0; i < 4; i++) {
      const a = time * 1.3 + (i / 4) * Math.PI * 2;
      const orbitR = r * 0.62;
      const ex = x + Math.cos(a) * orbitR;
      const ey = y + Math.sin(a) * orbitR * 0.6;
      ctx.fillStyle = 'rgba(190, 130, 240, 0.8)';
      ctx.shadowColor = 'rgba(190, 130, 240, 0.9)';
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(ex, ey, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    ctx.restore();
  }
}

// Shared between Player.draw() and Player.getMuzzlePosition() so the visible weapon and the
// bullet spawn point can never drift apart.
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

  /** World-space position of the weapon's muzzle, matching where draw() renders it. */
  getMuzzlePosition() {
    const r = this.radius;
    const facingRight = Math.cos(this.aimAngle) >= 0;
    const shoulderY = -r * PLAYER_LEG_LEN_MULT - r * PLAYER_TORSO_LEN_MULT;
    const pivotX = r * PLAYER_WEAPON_PIVOT_X_MULT;
    const pivotY = shoulderY + r * PLAYER_WEAPON_PIVOT_Y_MULT;
    const localAngle = localAngleFor(this.aimAngle, facingRight);
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

  draw(ctx, time = 0) {
    const r = this.radius;
    const facingRight = Math.cos(this.aimAngle) >= 0;

    const legLen = r * PLAYER_LEG_LEN_MULT;
    const torsoLen = r * PLAYER_TORSO_LEN_MULT;
    const hipY = -legLen;
    const shoulderY = -legLen - torsoLen;
    const headR = r * 0.58;
    const headY = shoulderY - headR * 0.7;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    if (!facingRight) ctx.scale(-1, 1);

    const maxSwing = this._isMoving ? r * 0.42 : 0;
    const swingFront = Math.sin(this._walkPhase) * maxSwing;
    const swingBack = Math.sin(this._walkPhase + Math.PI) * maxSwing;

    // Back leg (drawn first, farther from camera).
    drawLimb(ctx, -r * 0.2, hipY, -r * 0.2 + swingBack, 0, Math.abs(swingBack) * 0.55, r * 0.3, '#1c1512');

    // Hood/cloak trailing behind the torso.
    ctx.fillStyle = 'rgba(10,6,8,0.7)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, (hipY + shoulderY) / 2, r * 0.62, torsoLen * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();

    // Off-arm, swinging opposite the front leg.
    const armSwing = (this._isMoving ? 1 : 0.35) * Math.sin(this._walkPhase + Math.PI) * r * 0.32;
    drawLimb(ctx, -r * 0.42, shoulderY + r * 0.18, -r * 0.42 + armSwing * 0.5, shoulderY + r * 0.18 + Math.abs(armSwing) + r * 0.4, Math.abs(armSwing) * 0.4, r * 0.2, '#241a16');

    // Front leg.
    drawLimb(ctx, r * 0.2, hipY, r * 0.2 + swingFront, 0, Math.abs(swingFront) * 0.55, r * 0.3, '#2e2018');

    // Torso, volumetric gradient shading toward local front/top.
    const bodyGrad = ctx.createRadialGradient(-r * 0.1, shoulderY + torsoLen * 0.25, r * 0.15, 0, (hipY + shoulderY) / 2, torsoLen);
    bodyGrad.addColorStop(0, '#5a4238');
    bodyGrad.addColorStop(0.6, '#2e2018');
    bodyGrad.addColorStop(1, '#150e0c');
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#c9a44c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.58, hipY + r * 0.1);
    ctx.quadraticCurveTo(-r * 0.75, (hipY + shoulderY) / 2, -r * 0.5, shoulderY + r * 0.05);
    ctx.lineTo(r * 0.5, shoulderY + r * 0.05);
    ctx.quadraticCurveTo(r * 0.75, (hipY + shoulderY) / 2, r * 0.58, hipY + r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Head + hood.
    const headGrad = ctx.createRadialGradient(-r * 0.15, headY - r * 0.15, r * 0.1, 0, headY, headR * 1.2);
    headGrad.addColorStop(0, '#4a352c');
    headGrad.addColorStop(1, '#1a1210');
    ctx.fillStyle = headGrad;
    ctx.strokeStyle = '#c9a44c';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Glowing eyes.
    ctx.fillStyle = '#f0d98c';
    ctx.shadowColor = '#f0d98c';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(r * 0.2, headY - r * 0.04, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Weapon arm, rotating to the true aim angle regardless of body facing.
    ctx.save();
    ctx.translate(r * PLAYER_WEAPON_PIVOT_X_MULT, shoulderY + r * PLAYER_WEAPON_PIVOT_Y_MULT);
    ctx.rotate(localAngleFor(this.aimAngle, facingRight));
    const drawWeapon = WEAPON_DRAWERS[this.equippedWeapon] || drawCrossbowWeapon;
    drawWeapon(ctx, r, time);
    ctx.restore();

    ctx.restore();
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

  draw(ctx, time = 0) {
    if (this.isPiercing) {
      // Chakram: a small spinning silver ring instead of a bolt streak.
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + 3, this.radius * 0.7, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(this.x, this.y);
      ctx.rotate(time * 14);
      ctx.strokeStyle = '#cfd6dc';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#9fd0ff';
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
      return;
    }

    const glowColor = this.isCrit ? '#ff8c3c' : '#e0c068';
    const len = this.isCrit ? 13 : 9;
    const angle = Math.atan2(this.vy, this.vx);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 3, len * 0.4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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

// Each drawer receives (ctx, r, walkPhase, isMoving, hitFlash) and draws in local space with
// feet at (0, 0) and the body rising in -y, matching the shared 3/4-view convention.

function drawZombieBody(ctx, r, walkPhase, isMoving) {
  const legLen = r * 1.05;
  const torsoLen = r * 1.15;
  const hipY = -legLen;
  const shoulderY = -legLen - torsoLen;
  const headR = r * 0.5;
  const headY = shoulderY - headR * 0.6;

  // Shambling, uneven gait: one leg drags (small swing), the other lurches forward.
  const maxSwing = isMoving ? r * 0.5 : 0;
  const dragSwing = Math.sin(walkPhase) * maxSwing * 0.4;
  const lurchSwing = Math.sin(walkPhase + Math.PI) * maxSwing;

  drawLimb(ctx, -r * 0.2, hipY, -r * 0.2 + dragSwing, r * 0.05, Math.abs(dragSwing) * 0.4, r * 0.28, '#233018');
  drawLimb(ctx, r * 0.2, hipY, r * 0.2 + lurchSwing, 0, Math.abs(lurchSwing) * 0.6, r * 0.28, '#2e3f1e');

  // One arm raised, reaching forward; the other hangs.
  const reach = 0.6 + 0.15 * Math.sin(walkPhase * 0.7);
  drawLimb(ctx, r * 0.35, shoulderY + r * 0.2, r * 1.1, shoulderY + r * 0.15 - r * reach, -r * 0.15, r * 0.2, '#3a4a26');
  const hangSwing = Math.sin(walkPhase) * (isMoving ? r * 0.15 : 0);
  drawLimb(ctx, -r * 0.35, shoulderY + r * 0.2, -r * 0.35 + hangSwing, shoulderY + r * 0.9, 0, r * 0.2, '#233018');

  // Torso, hunched slightly forward.
  const grad = ctx.createRadialGradient(-r * 0.1, shoulderY + torsoLen * 0.3, r * 0.1, 0, (hipY + shoulderY) / 2, torsoLen);
  grad.addColorStop(0, '#7a8f52');
  grad.addColorStop(0.6, '#4d5c34');
  grad.addColorStop(1, '#26301a');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#9db06a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(r * 0.05, (hipY + shoulderY) / 2, r * 0.55, torsoLen * 0.6, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Rot patch.
  ctx.fillStyle = 'rgba(30,20,10,0.5)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.15, (hipY + shoulderY) / 2 + r * 0.2, r * 0.22, r * 0.15, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Head.
  ctx.fillStyle = '#5c6d3e';
  ctx.strokeStyle = '#8a9b5f';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(r * 0.08, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#c81f2f';
  ctx.beginPath();
  ctx.arc(r * 0.32, headY - r * 0.05, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawVampireBody(ctx, r, walkPhase, isMoving) {
  const legLen = r * 1.1;
  const torsoLen = r * 1.1;
  const hipY = -legLen;
  const shoulderY = -legLen - torsoLen;
  const headR = r * 0.48;
  const headY = shoulderY - headR * 0.6;

  // Elegant, minimal-swing gait — a vampire glides more than it stomps.
  const maxSwing = isMoving ? r * 0.3 : 0;
  const swingA = Math.sin(walkPhase * 1.3) * maxSwing;
  const swingB = Math.sin(walkPhase * 1.3 + Math.PI) * maxSwing;
  drawLimb(ctx, -r * 0.16, hipY, -r * 0.16 + swingB, 0, Math.abs(swingB) * 0.4, r * 0.22, '#150a10');
  drawLimb(ctx, r * 0.16, hipY, r * 0.16 + swingA, 0, Math.abs(swingA) * 0.4, r * 0.22, '#1c0d16');

  // Cape, flowing/swaying behind.
  const sway = Math.sin(walkPhase * 1.3) * r * 0.25;
  ctx.fillStyle = 'rgba(90,10,25,0.88)';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, shoulderY + torsoLen * 0.3);
  ctx.quadraticCurveTo(-r * 1.5 + sway, (hipY + shoulderY) / 2, -r * 0.95 + sway * 0.6, hipY + r * 0.1);
  ctx.quadraticCurveTo(-r * 0.6, (hipY + shoulderY) / 2, -r * 0.35, shoulderY + torsoLen * 0.3);
  ctx.closePath();
  ctx.fill();

  const grad = ctx.createRadialGradient(-r * 0.1, shoulderY + torsoLen * 0.3, r * 0.05, 0, (hipY + shoulderY) / 2, torsoLen);
  grad.addColorStop(0, '#3a1c2c');
  grad.addColorStop(1, '#0f0710');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#c81f3f';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, (hipY + shoulderY) / 2, r * 0.42, torsoLen * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Arm, held elegantly at the side.
  const armSwing = Math.sin(walkPhase * 1.3 + Math.PI) * (isMoving ? r * 0.15 : 0);
  drawLimb(ctx, r * 0.3, shoulderY + r * 0.25, r * 0.3 + armSwing, shoulderY + r * 0.9, 0, r * 0.15, '#1c0d16');

  // Pale head with widow's peak hint.
  ctx.fillStyle = 'rgba(230,220,210,0.92)';
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c0d16';
  ctx.beginPath();
  ctx.moveTo(-headR * 0.3, headY - headR * 0.9);
  ctx.lineTo(headR * 0.3, headY - headR * 0.9);
  ctx.lineTo(0, headY - headR * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e01030';
  ctx.shadowColor = '#e01030';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.arc(r * 0.16, headY - r * 0.02, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawWerewolfBody(ctx, r, walkPhase, isMoving) {
  const legLen = r * 1.0;
  const torsoLen = r * 1.3;
  const hipY = -legLen;
  const shoulderY = -legLen - torsoLen * 0.85; // hunched forward, shoulders lower than a full stand
  const headR = r * 0.56;
  const headY = shoulderY - headR * 0.5;

  // Powerful, bounding gait.
  const maxSwing = isMoving ? r * 0.6 : 0;
  const swingA = Math.sin(walkPhase * 1.6) * maxSwing;
  const swingB = Math.sin(walkPhase * 1.6 + Math.PI) * maxSwing;
  drawLimb(ctx, -r * 0.28, hipY, -r * 0.28 + swingB, 0, Math.abs(swingB) * 0.7, r * 0.36, '#241a10');
  drawLimb(ctx, r * 0.28, hipY, r * 0.28 + swingA, 0, Math.abs(swingA) * 0.7, r * 0.36, '#2e2114');

  // Clawed arms, swinging aggressively opposite the legs.
  const armA = Math.sin(walkPhase * 1.6 + Math.PI) * (isMoving ? r * 0.4 : r * 0.1);
  const armB = Math.sin(walkPhase * 1.6) * (isMoving ? r * 0.4 : r * 0.1);
  drawLimb(ctx, -r * 0.5, shoulderY + r * 0.3, -r * 0.5 + armA * 0.5, shoulderY + r * 0.3 + Math.abs(armA) + r * 0.5, Math.abs(armA) * 0.3, r * 0.24, '#241a10');
  drawLimb(ctx, r * 0.5, shoulderY + r * 0.3, r * 0.5 + armB * 0.5, shoulderY + r * 0.3 + Math.abs(armB) + r * 0.5, Math.abs(armB) * 0.3, r * 0.24, '#2e2114');

  // Torso, hunched and elongated forward.
  const grad = ctx.createRadialGradient(-r * 0.2, shoulderY + torsoLen * 0.3, r * 0.15, r * 0.1, (hipY + shoulderY) / 2, torsoLen * 1.1);
  grad.addColorStop(0, '#8a6a4a');
  grad.addColorStop(0.55, '#5a4230');
  grad.addColorStop(1, '#281c14');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#a88a5a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(r * 0.15, (hipY + shoulderY) / 2, r * 0.68, torsoLen * 0.58, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Ears.
  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, headY - headR * 0.6);
  ctx.lineTo(r * 0.1, headY - headR * 1.5);
  ctx.lineTo(r * 0.3, headY - headR * 0.5);
  ctx.closePath();
  ctx.fill();

  // Head + snout, thrust forward.
  ctx.fillStyle = '#5a4230';
  ctx.strokeStyle = '#a88a5a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#4a3626';
  ctx.beginPath();
  ctx.ellipse(headR * 0.85, headY + headR * 0.15, headR * 0.5, headR * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f0c020';
  ctx.shadowColor = '#f0c020';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(headR * 0.35, headY - headR * 0.25, 2, 0, Math.PI * 2);
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
    this._walkPhase = 0;
  }

  update(dt, target) {
    const dir = normalize(target.x - this.x, target.y - this.y);
    this.angle = Math.atan2(dir.y, dir.x);
    this.x += dir.x * this.speed * dt;
    this.y += dir.y * this.speed * dt;
    this._walkPhase += this.speed * dt * 0.05;
    if (this._hitFlash > 0) this._hitFlash -= dt;
  }

  takeDamage(amount) {
    this.health -= amount;
    this._hitFlash = 0.08;
    if (this.health <= 0) this.alive = false;
  }

  draw(ctx) {
    const r = this.radius;
    const facingRight = Math.cos(this.angle) >= 0;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, r * 0.9, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(this.x, this.y);
    if (!facingRight) ctx.scale(-1, 1);

    const drawBody = ENEMY_BODY_DRAWERS[this.typeKey] || drawZombieBody;
    drawBody(ctx, r, this._walkPhase, true);

    if (this._hitFlash > 0) {
      const flashH = r * 2.6;
      ctx.globalAlpha = clamp(this._hitFlash / 0.08, 0, 1) * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, -flashH * 0.4, r * 0.9, flashH * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (this.health < this.maxHealth) {
      const w = r * 2;
      const barY = this.y - r * 2.9;
      const pct = clamp(this.health / this.maxHealth, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.x - w / 2, barY, w, 4);
      ctx.fillStyle = '#8f1f2b';
      ctx.fillRect(this.x - w / 2, barY, w * pct, 4);
    }
  }
}
