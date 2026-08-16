// Placeable defenses: fences (a slowing perimeter around the ward) and mines (one-shot AoE
// traps). Both are manually placed by the player — buying one arms a placement cursor, and
// the next tap/click on the battlefield drops it there (or Cancel refunds it). Each defense
// type has a small tier ladder (Wooden -> Iron -> Runic, etc.); upgrading a tier is a one-time
// purchase that only affects defenses placed *after* the upgrade, so early placements
// naturally become the weak link once you've researched something better — that's the
// intended "obsolescence": nothing retroactively destroys them, but you'll want to replace
// them once you can afford the next tier.

const FENCE_MAX = 8; // total ever placed, across all tiers
const MINE_MAX = 6;

// Fences render as a 2-unit-wide panel rather than a single post, and neighboring fences within
// FENCE_CONNECT_DIST draw a connecting rail so a row of them reads as one continuous wall.
// FENCE_MIN_SPACING is deliberately looser than the connect distance so placements can sit close
// enough to link up without fully overlapping.
const FENCE_WIDTH = 46;
const FENCE_MIN_SPACING = 34;
const FENCE_CONNECT_DIST = 60;

// `cost` is what one placement costs at that tier; `unlockCost` is the one-time price to
// research the tier at all (paid once, via the "Upgrade to..." row; tier 0 needs no unlock).
const FENCE_TIERS = [
  { name: 'Wooden Fence', unlockCost: 0, cost: 15, maxHealth: 26, slowMult: 0.5, slowRadius: 42 },
  { name: 'Iron Palisade', unlockCost: 70, cost: 30, maxHealth: 65, slowMult: 0.35, slowRadius: 48 },
  { name: 'Runic Barrier', unlockCost: 150, cost: 55, maxHealth: 130, slowMult: 0.2, slowRadius: 56 },
];

const MINE_TIERS = [
  { name: 'Buried Mine', unlockCost: 0, cost: 20, damage: 30, blastRadius: 36 },
  { name: 'Arcane Charge', unlockCost: 80, cost: 40, damage: 65, blastRadius: 44 },
  { name: 'Hellfire Trap', unlockCost: 160, cost: 75, damage: 120, blastRadius: 54 },
];

class Fence {
  constructor(x, y, tierIndex, rotation = 0) {
    const tier = FENCE_TIERS[tierIndex];
    this.x = x;
    this.y = y;
    this.tierIndex = tierIndex;
    this.rotation = rotation; // radians — which way the panel faces, so walls can front any approach
    this.width = FENCE_WIDTH;
    this.radius = FENCE_WIDTH / 2;
    this.slowRadius = tier.slowRadius;
    this.slowMult = tier.slowMult;
    this.maxHealth = tier.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
  }

  takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0) this.alive = false;
  }

  draw(ctx) {
    const damaged = this.health < this.maxHealth * 0.5;
    const rich = this.tierIndex >= 1;
    const hw = this.width / 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 5, hw * 1.05, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const postColor = rich ? (damaged ? '#5a5a62' : '#8a8a94') : (damaged ? '#4a3a2a' : '#6b4a2a');
    ctx.strokeStyle = postColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-hw + 3, 6);
    ctx.lineTo(-hw + 6, -13);
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -14);
    ctx.moveTo(hw - 3, 6);
    ctx.lineTo(hw - 6, -13);
    ctx.stroke();

    const railColor = rich ? (damaged ? '#6a6a74' : '#b8b8c4') : (damaged ? '#5a4632' : '#8a6a42');
    ctx.strokeStyle = railColor;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-hw + 2, -3);
    ctx.lineTo(hw - 2, -5);
    ctx.moveTo(-hw + 1, 2);
    ctx.lineTo(hw - 1, 0);
    ctx.stroke();

    if (this.tierIndex >= 2) {
      // Runic Barrier: a faint glowing sigil at the panel's center.
      ctx.strokeStyle = 'rgba(180, 120, 240, 0.6)';
      ctx.lineWidth = 1;
      ctx.shadowColor = 'rgba(180, 120, 240, 0.7)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(0, -3, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}

/** Draws a connecting rail between any two nearby fences so a row of them reads as one wall. */
function drawFenceConnections(ctx, fenceList) {
  const alive = fenceList.filter((f) => f.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (d > FENCE_CONNECT_DIST || d < 1) continue;
      const ux = (b.x - a.x) / d;
      const uy = (b.y - a.y) / d;
      const ax = a.x + ux * (a.radius - 4);
      const ay = a.y + uy * (a.radius - 4);
      const bx = b.x - ux * (b.radius - 4);
      const by = b.y - uy * (b.radius - 4);
      ctx.save();
      ctx.strokeStyle = 'rgba(150, 120, 90, 0.7)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 3);
      ctx.lineTo(bx, by - 5);
      ctx.moveTo(ax, ay + 2);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    }
  }
}

class Mine {
  constructor(x, y, tierIndex) {
    const tier = MINE_TIERS[tierIndex];
    this.x = x;
    this.y = y;
    this.tierIndex = tierIndex;
    this.radius = 7;
    this.triggerRadius = 12;
    this.damage = tier.damage;
    this.blastRadius = tier.blastRadius;
    this.alive = true;
  }

  draw(ctx, time = 0) {
    const glowColor = ['rgba(150, 70, 220,', 'rgba(90, 160, 240,', 'rgba(255, 90, 40,'][this.tierIndex];
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
    ctx.strokeStyle = `${glowColor} ${0.4 + pulse * 0.35})`;
    ctx.shadowColor = `${glowColor} 0.8)`;
    ctx.shadowBlur = 3 + this.tierIndex * 1.5;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -0.5, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

/** Visual-only mine detonation: expanding shockwave ring, core flash, and scattering embers. */
class Explosion {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.age = 0;
    this.maxAge = 0.5;
    this.alive = true;
    this.embers = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const speed = radius * (1.6 + Math.random() * 1.2);
      return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
    });
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }

  draw(ctx) {
    const t = clamp(this.age / this.maxAge, 0, 1);
    ctx.save();

    // Core flash, bright and quick.
    const flashT = clamp(t / 0.35, 0, 1);
    if (flashT < 1) {
      ctx.globalAlpha = 1 - flashT;
      const coreGrad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 0.7);
      coreGrad.addColorStop(0, 'rgba(255, 245, 220, 0.95)');
      coreGrad.addColorStop(0.5, 'rgba(255, 170, 80, 0.7)');
      coreGrad.addColorStop(1, 'rgba(255, 100, 40, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius * (0.3 + flashT * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }

    // Expanding shockwave ring.
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = 'rgba(255, 180, 90, 0.9)';
    ctx.lineWidth = 3 * (1 - t) + 0.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * (0.2 + t * 1.1), 0, Math.PI * 2);
    ctx.stroke();

    // Scattering embers.
    ctx.fillStyle = 'rgba(255, 160, 70, 0.9)';
    for (const e of this.embers) {
      const ex = this.x + e.vx * t;
      const ey = this.y + e.vy * t;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.beginPath();
      ctx.arc(ex, ey, 1.8 * (1 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
