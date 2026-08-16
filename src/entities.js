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
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.7, r * 1.3, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();

    // Stepped stone base for a sense of height: a wider, darker slab beneath the altar top.
    const stepGrad = ctx.createLinearGradient(x - r * 1.2, y - r * 0.2, x + r * 1.2, y + r * 1.1);
    stepGrad.addColorStop(0, '#241e29');
    stepGrad.addColorStop(1, '#07050a');
    ctx.fillStyle = stepGrad;
    ctx.strokeStyle = '#3e3020';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x - r * 1.18, y - r * 0.15, r * 2.36, r * 1.05);
    ctx.fill();
    ctx.stroke();

    // Altar top.
    const stoneGrad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    stoneGrad.addColorStop(0, '#352c3c');
    stoneGrad.addColorStop(0.5, '#1a1420');
    stoneGrad.addColorStop(1, '#08050a');
    ctx.fillStyle = stoneGrad;
    ctx.strokeStyle = '#5c4630';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - r + 5, y - r + 5, r * 2 - 10, r * 2 - 10);

    // Fissures cracking across the altar top.
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.72, y - r * 0.5);
    ctx.lineTo(x - r * 0.32, y - r * 0.14);
    ctx.lineTo(x - r * 0.5, y + r * 0.22);
    ctx.moveTo(x + r * 0.2, y - r * 0.82);
    ctx.lineTo(x + r * 0.42, y - r * 0.28);
    ctx.lineTo(x + r * 0.14, y + r * 0.1);
    ctx.stroke();

    // Corner pillar accents.
    ctx.fillStyle = '#3e3020';
    const pillarR = r * 0.12;
    for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.arc(x + px * r * 0.85, y + py * r * 0.85, pillarR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rune carvings (simple etched lines on each edge).
    ctx.strokeStyle = 'rgba(150, 90, 200, 0.28)';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(x + i * r * 0.65, y - r * 0.9);
      ctx.lineTo(x + i * r * 0.65, y - r * 0.65);
      ctx.moveTo(x - r * 0.9, y + i * r * 0.65);
      ctx.lineTo(x - r * 0.65, y + i * r * 0.65);
      ctx.stroke();
    }

    // Old blood weeping down the front face, dried dark.
    ctx.fillStyle = 'rgba(80, 8, 14, 0.5)';
    for (const dx of [-0.62, -0.18, 0.34, 0.7]) {
      const dripLen = r * (0.55 + 0.3 * Math.abs(Math.sin(dx * 9)));
      ctx.beginPath();
      ctx.moveTo(x + dx * r - 1.3, y + r);
      ctx.lineTo(x + dx * r + 1.3, y + r);
      ctx.lineTo(x + dx * r + 0.7, y + r + dripLen);
      ctx.quadraticCurveTo(x + dx * r + 1.4, y + r + dripLen + 3.5, x + dx * r, y + r + dripLen + 4.5);
      ctx.quadraticCurveTo(x + dx * r - 1.4, y + r + dripLen + 3.5, x + dx * r - 0.7, y + r + dripLen);
      ctx.closePath();
      ctx.fill();
    }

    // Pulsing rune-glow core.
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    const glowR = r * (0.44 + pulse * 0.06);
    const runeGlow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    runeGlow.addColorStop(0, `rgba(150, 40, 195, ${0.6 + pulse * 0.25})`);
    runeGlow.addColorStop(1, 'rgba(150, 40, 195, 0)');
    ctx.fillStyle = runeGlow;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#7a5c30';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();

    // A small skull etched at the core, half-lit by the rune glow.
    ctx.save();
    ctx.globalAlpha = 0.6 + pulse * 0.2;
    ctx.fillStyle = '#0a060c';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.17, r * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(200, 160, 220, 0.45)';
    ctx.beginPath();
    ctx.arc(x - r * 0.07, y - r * 0.02, r * 0.04, 0, Math.PI * 2);
    ctx.arc(x + r * 0.07, y - r * 0.02, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(8,4,8,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.05, y + r * 0.05);
    ctx.lineTo(x, y + r * 0.13);
    ctx.lineTo(x + r * 0.05, y + r * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Embers orbiting the core.
    for (let i = 0; i < 4; i++) {
      const a = time * 1.3 + (i / 4) * Math.PI * 2;
      const orbitR = r * 0.62;
      const ex = x + Math.cos(a) * orbitR;
      const ey = y + Math.sin(a) * orbitR * 0.6;
      ctx.fillStyle = 'rgba(190, 110, 230, 0.8)';
      ctx.shadowColor = 'rgba(190, 110, 230, 0.9)';
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

    // Tattered cloak trailing behind the torso — a jagged, torn hem instead of a clean shape.
    const cloakCx = -r * 0.15;
    const cloakCy = (hipY + shoulderY) / 2;
    const cloakRx = r * 0.62;
    const cloakRy = torsoLen * 0.58;
    ctx.fillStyle = 'rgba(7,4,6,0.85)';
    ctx.beginPath();
    ctx.moveTo(cloakCx, cloakCy - cloakRy);
    ctx.quadraticCurveTo(cloakCx - cloakRx * 1.1, cloakCy - cloakRy * 0.2, cloakCx - cloakRx, cloakCy + cloakRy * 0.35);
    ctx.lineTo(cloakCx - cloakRx * 0.7, cloakCy + cloakRy * 0.7);
    ctx.lineTo(cloakCx - cloakRx * 0.45, cloakCy + cloakRy * 0.5);
    ctx.lineTo(cloakCx - cloakRx * 0.2, cloakCy + cloakRy * 0.85);
    ctx.lineTo(cloakCx + cloakRx * 0.05, cloakCy + cloakRy * 0.55);
    ctx.lineTo(cloakCx + cloakRx * 0.3, cloakCy + cloakRy * 0.8);
    ctx.lineTo(cloakCx + cloakRx * 0.55, cloakCy + cloakRy * 0.4);
    ctx.quadraticCurveTo(cloakCx + cloakRx * 0.9, cloakCy, cloakCx + cloakRx * 0.5, cloakCy - cloakRy * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,12,20,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Off-arm, swinging opposite the front leg.
    const armSwing = (this._isMoving ? 1 : 0.35) * Math.sin(this._walkPhase + Math.PI) * r * 0.32;
    drawLimb(ctx, -r * 0.42, shoulderY + r * 0.18, -r * 0.42 + armSwing * 0.5, shoulderY + r * 0.18 + Math.abs(armSwing) + r * 0.4, Math.abs(armSwing) * 0.4, r * 0.2, '#241a16');

    // Front leg.
    drawLimb(ctx, r * 0.2, hipY, r * 0.2 + swingFront, 0, Math.abs(swingFront) * 0.55, r * 0.3, '#2e2018');

    // Torso, volumetric gradient shading toward local front/top.
    const bodyGrad = ctx.createRadialGradient(-r * 0.1, shoulderY + torsoLen * 0.25, r * 0.15, 0, (hipY + shoulderY) / 2, torsoLen);
    bodyGrad.addColorStop(0, '#4a352c');
    bodyGrad.addColorStop(0.6, '#241810');
    bodyGrad.addColorStop(1, '#0e0908');
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

    // Head + hood, sunk in shadow — almost nothing of the face reads except what the hood frames.
    const headGrad = ctx.createRadialGradient(-r * 0.15, headY - r * 0.15, r * 0.08, 0, headY, headR * 1.2);
    headGrad.addColorStop(0, '#3a2a22');
    headGrad.addColorStop(1, '#0e0a08');
    ctx.fillStyle = headGrad;
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // A narrow, predatory eye-glow instead of a soft dot — the only feature visible under the hood.
    ctx.save();
    ctx.strokeStyle = '#f0d98c';
    ctx.shadowColor = '#f0d98c';
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.08, headY - r * 0.04);
    ctx.lineTo(r * 0.32, headY - r * 0.02);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

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

  // Torso, hunched forward — a jagged, torn silhouette instead of a smooth shape.
  const tCx = r * 0.05;
  const tCy = (hipY + shoulderY) / 2;
  const tRx = r * 0.55;
  const tRy = torsoLen * 0.6;
  const grad = ctx.createRadialGradient(-r * 0.1, shoulderY + torsoLen * 0.3, r * 0.1, 0, tCy, torsoLen);
  grad.addColorStop(0, '#57603c');
  grad.addColorStop(0.55, '#333c1e');
  grad.addColorStop(1, '#12160a');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#5c6a3e';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(tCx - tRx, tCy - tRy * 0.5);
  ctx.lineTo(tCx - tRx * 0.6, tCy - tRy);
  ctx.lineTo(tCx + tRx * 0.5, tCy - tRy * 0.95);
  ctx.lineTo(tCx + tRx, tCy - tRy * 0.3);
  ctx.lineTo(tCx + tRx * 0.75, tCy + tRy * 0.3);
  ctx.lineTo(tCx + tRx * 0.9, tCy + tRy * 0.7);
  ctx.lineTo(tCx + tRx * 0.4, tCy + tRy * 0.85);
  ctx.lineTo(tCx, tCy + tRy * 0.55);
  ctx.lineTo(tCx - tRx * 0.5, tCy + tRy * 0.9);
  ctx.lineTo(tCx - tRx * 0.85, tCy + tRy * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Ribs glimpsed through torn, rotted flesh.
  ctx.strokeStyle = 'rgba(205, 195, 165, 0.3)';
  ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(tCx - tRx * 0.3, tCy + i * r * 0.16);
    ctx.quadraticCurveTo(tCx, tCy + i * r * 0.16 + r * 0.08, tCx + tRx * 0.3, tCy + i * r * 0.16);
    ctx.stroke();
  }

  // Rot / wound patch, weeping dark ichor down the belly.
  ctx.fillStyle = 'rgba(18,11,7,0.6)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.15, tCy + r * 0.2, r * 0.22, r * 0.15, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(70, 8, 10, 0.5)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, tCy + r * 0.42, r * 0.06, r * 0.22, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Head, gaunt and sickly.
  ctx.fillStyle = '#454f2e';
  ctx.strokeStyle = '#5c6a3e';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(r * 0.08, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Slack, hanging jaw with a thread of drool.
  ctx.fillStyle = '#0a0806';
  ctx.beginPath();
  ctx.ellipse(r * 0.1, headY + headR * 0.55, headR * 0.32, headR * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,8,10,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(r * 0.08, headY + headR * 0.3);
  ctx.lineTo(r * 0.06, headY + headR * 0.95);
  ctx.stroke();

  // Baleful glowing eye.
  ctx.fillStyle = '#e0202f';
  ctx.shadowColor = '#e0202f';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(r * 0.32, headY - r * 0.05, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
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

  // Cape, flowing/swaying behind — a tattered, jagged hem.
  const sway = Math.sin(walkPhase * 1.3) * r * 0.25;
  ctx.fillStyle = 'rgba(48,5,14,0.9)';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, shoulderY + torsoLen * 0.3);
  ctx.quadraticCurveTo(-r * 1.5 + sway, (hipY + shoulderY) / 2, -r * 1.05 + sway * 0.6, hipY - r * 0.15);
  ctx.lineTo(-r * 0.85 + sway * 0.5, hipY + r * 0.25);
  ctx.lineTo(-r * 0.65 + sway * 0.4, hipY - r * 0.05);
  ctx.lineTo(-r * 0.45, hipY + r * 0.15);
  ctx.quadraticCurveTo(-r * 0.55, (hipY + shoulderY) / 2, -r * 0.35, shoulderY + torsoLen * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(190,20,45,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

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

  // Pale, corpse-drained head with a widow's peak hint.
  ctx.fillStyle = 'rgba(212,200,190,0.92)';
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#160a10';
  ctx.beginPath();
  ctx.moveTo(-headR * 0.3, headY - headR * 0.9);
  ctx.lineTo(headR * 0.3, headY - headR * 0.9);
  ctx.lineTo(0, headY - headR * 0.4);
  ctx.closePath();
  ctx.fill();

  // Fangs and a fresh smear of blood at the mouth.
  ctx.fillStyle = '#f8f2ea';
  ctx.beginPath();
  ctx.moveTo(headR * 0.1, headY + headR * 0.35);
  ctx.lineTo(headR * 0.16, headY + headR * 0.56);
  ctx.lineTo(headR * 0.22, headY + headR * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(160,10,20,0.75)';
  ctx.beginPath();
  ctx.ellipse(headR * 0.18, headY + headR * 0.5, headR * 0.14, headR * 0.08, 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff1030';
  ctx.shadowColor = '#ff1030';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.arc(r * 0.16, headY - r * 0.02, 1.4, 0, Math.PI * 2);
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

  // Claws on the leading paws.
  ctx.fillStyle = '#e8e0d0';
  for (const [cx, cy] of [[-r * 0.28 + swingB, 0], [r * 0.28 + swingA, 0]]) {
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx, cy + 6);
    ctx.lineTo(cx + 3, cy);
    ctx.closePath();
    ctx.fill();
  }

  // Torso, hunched and elongated forward.
  const grad = ctx.createRadialGradient(-r * 0.2, shoulderY + torsoLen * 0.3, r * 0.15, r * 0.1, (hipY + shoulderY) / 2, torsoLen * 1.1);
  grad.addColorStop(0, '#6a5038');
  grad.addColorStop(0.55, '#3e2e1e');
  grad.addColorStop(1, '#18110a');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#7a6040';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(r * 0.15, (hipY + shoulderY) / 2, r * 0.68, torsoLen * 0.58, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Matted, filthy fur streaks.
  ctx.strokeStyle = 'rgba(15,10,6,0.4)';
  ctx.lineWidth = 1;
  for (const [sx, sy] of [[-0.25, -0.35], [0.05, -0.1], [-0.4, 0.15], [0.3, 0.3], [0.5, -0.05]]) {
    const bx = r * 0.15 + sx * r;
    const by = (hipY + shoulderY) / 2 + sy * torsoLen * 0.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + r * 0.14, by + r * 0.2);
    ctx.stroke();
  }

  // Ears.
  ctx.fillStyle = '#2a1e12';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, headY - headR * 0.6);
  ctx.lineTo(r * 0.1, headY - headR * 1.5);
  ctx.lineTo(r * 0.3, headY - headR * 0.5);
  ctx.closePath();
  ctx.fill();

  // Head + snout, thrust forward.
  ctx.fillStyle = '#4a3626';
  ctx.strokeStyle = '#7a6040';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath();
  ctx.ellipse(headR * 0.85, headY + headR * 0.15, headR * 0.5, headR * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fangs and a blood-flecked muzzle.
  ctx.fillStyle = '#f4eee0';
  ctx.beginPath();
  ctx.moveTo(headR * 1.15, headY + headR * 0.22);
  ctx.lineTo(headR * 1.28, headY + headR * 0.48);
  ctx.lineTo(headR * 1.02, headY + headR * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(150, 8, 14, 0.7)';
  ctx.beginPath();
  ctx.ellipse(headR * 1.0, headY + headR * 0.32, headR * 0.2, headR * 0.11, 0.4, 0, Math.PI * 2);
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

  /**
   * Bullets need to hit the visible body, not just the feet: this.x/this.y is the ground
   * anchor the 3/4-view rig stands on, but the drawn silhouette (legs+torso+head) rises
   * roughly 2.8-3x the radius above that point. Centering the hit test there, with a
   * correspondingly larger radius, is what makes headshots (and everything above the ankles)
   * actually register instead of only the lowest sliver of drawn leg.
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
