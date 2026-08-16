// Placeable defenses: fences (a slowing perimeter around the ward) and mines (one-shot AoE
// traps scattered in the approach field). Both are auto-positioned on purchase — fences fill
// the next open slot in a ring around the base, mines scatter randomly at a safe distance —
// rather than needing a manual tap-to-place mode, since the twin-stick controls already
// occupy both thumbs during combat. Purchased in the shop's "Defenses" section; each
// purchase is a little stronger than the last (see fenceHealthFor/mineDamageFor), so
// investing early still pays off as coverage grows.

const FENCE_MAX = 8; // full ring around the ward
const MINE_MAX = 6;

const FENCE_BASE_COST = 12;
const FENCE_COST_GROWTH = 1.32;
const MINE_BASE_COST = 18;
const MINE_COST_GROWTH = 1.3;

function fenceHealthFor(purchaseIndex) {
  return 22 + purchaseIndex * 7;
}

function mineDamageFor(purchaseIndex) {
  return 28 + purchaseIndex * 12;
}

function mineBlastRadiusFor(purchaseIndex) {
  return 34 + purchaseIndex * 3;
}

function costFor(baseCost, growth, purchaseIndex) {
  return Math.round(baseCost * Math.pow(growth, purchaseIndex));
}

class Fence {
  constructor(x, y, purchaseIndex) {
    this.x = x;
    this.y = y;
    this.radius = 9;
    this.slowRadius = 30;
    this.slowMult = 0.4; // enemies within slowRadius move at 40% speed
    this.maxHealth = fenceHealthFor(purchaseIndex);
    this.health = this.maxHealth;
    this.alive = true;
  }

  takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0) this.alive = false;
  }

  draw(ctx) {
    const damaged = this.health < this.maxHealth * 0.5;
    ctx.save();
    ctx.translate(this.x, this.y);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 5, 11, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = damaged ? '#4a3a2a' : '#6b4a2a';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, 6);
    ctx.lineTo(-4, -13);
    ctx.moveTo(8, 6);
    ctx.lineTo(4, -13);
    ctx.stroke();

    ctx.strokeStyle = damaged ? '#5a4632' : '#8a6a42';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-7, -3);
    ctx.lineTo(7, -5);
    ctx.moveTo(-6.5, 2);
    ctx.lineTo(6.5, 0);
    ctx.stroke();
    ctx.restore();
  }
}

class Mine {
  constructor(x, y, purchaseIndex) {
    this.x = x;
    this.y = y;
    this.radius = 7;
    this.triggerRadius = 12;
    this.damage = mineDamageFor(purchaseIndex);
    this.blastRadius = mineBlastRadiusFor(purchaseIndex);
    this.alive = true;
  }

  draw(ctx, time = 0) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 3, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2a2018';
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const pulse = 0.5 + 0.5 * Math.sin(time * 3 + this.x);
    ctx.strokeStyle = `rgba(150, 70, 220, ${0.4 + pulse * 0.35})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -0.5, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Ephemeral visual flash for a mine detonation — purely cosmetic, no gameplay effect. */
class Explosion {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.age = 0;
    this.maxAge = 0.35;
    this.alive = true;
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }

  draw(ctx) {
    const t = clamp(this.age / this.maxAge, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * (0.3 + t * 0.9));
    grad.addColorStop(0, 'rgba(255, 210, 140, 0.9)');
    grad.addColorStop(0.5, 'rgba(255, 140, 60, 0.55)');
    grad.addColorStop(1, 'rgba(255, 100, 40, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * (0.3 + t * 0.9), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Next fence position: evenly spaced around the ward, filling the ring one slot at a time. */
function nextFencePosition(base, purchaseIndex) {
  const angle = (purchaseIndex / FENCE_MAX) * Math.PI * 2 - Math.PI / 2;
  const ringRadius = base.radius + 34;
  return {
    x: base.x + Math.cos(angle) * ringRadius,
    y: base.y + Math.sin(angle) * ringRadius,
  };
}

/** Random mine position in the mid-field approach, away from the base and other mines. */
function randomMinePosition(base, bounds, existingMines) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 150;
    const x = clamp(base.x + Math.cos(angle) * r, 40, bounds.width - 40);
    const y = clamp(base.y + Math.sin(angle) * r, 40, bounds.height - 40);
    if (existingMines.every((m) => dist(m.x, m.y, x, y) > 44)) {
      return { x, y };
    }
  }
  const angle = Math.random() * Math.PI * 2;
  return {
    x: clamp(base.x + Math.cos(angle) * 150, 40, bounds.width - 40),
    y: clamp(base.y + Math.sin(angle) * 150, 40, bounds.height - 40),
  };
}
