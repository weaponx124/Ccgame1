// Placeable defenses: fences (a slowing perimeter around the ward) and mines (one-shot AoE
// traps). Both are manually placed by the player — buying one arms a placement cursor, and
// the next tap/click on the battlefield drops it there (or Cancel refunds it). Each defense
// type has a small tier ladder (Wooden -> Iron -> Runic, etc.); upgrading a tier is a one-time
// purchase that only affects defenses placed *after* the upgrade, so early placements
// naturally become the weak link once you've researched something better — that's the
// intended "obsolescence": nothing retroactively destroys them, but you'll want to replace
// them once you can afford the next tier.
//
// Pure logic/state only — Renderer3D (src/render3d.js) owns the 3D view for each of these.

const FENCE_MAX = 8; // total ever placed, across all tiers
const MINE_MAX = 6;

// Fences are a 2-unit-wide panel rather than a single post. FENCE_MIN_SPACING is deliberately
// looser than FENCE_WIDTH so placements can sit edge-to-edge without being flagged as
// overlapping. FENCE_CONNECT_DIST is how close a new drag's starting touch has to land to an
// existing fence for game.js's snapToNearbyFence to snap it flush against that fence instead of
// wherever was actually tapped — extending an existing run without a gap or an overlap doesn't
// need pixel-perfect placement on a touchscreen.
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
}

class Mine {
  constructor(x, y, tierIndex) {
    const tier = MINE_TIERS[tierIndex];
    this.x = x;
    this.y = y;
    this.tierIndex = tierIndex;
    this.radius = 10;
    this.triggerRadius = 18;
    this.damage = tier.damage;
    this.blastRadius = tier.blastRadius;
    this.alive = true;
  }
}

/** Visual-only mine detonation timing/state; Renderer3D animates the actual shockwave/embers. */
class Explosion {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.age = 0;
    this.maxAge = 0.5;
    this.alive = true;
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }
}
