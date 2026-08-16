// Weapon catalog: purchasable/equippable weapons for the demon hunter. Each weapon modifies
// the player's base (upgradeable) damage/fireRate/bulletSpeed with its own multipliers and
// firing pattern, so shop upgrades stay meaningful no matter which weapon is equipped.
//
// All weapon visuals share one pivot and one forward reach (WEAPON_MUZZLE_LENGTH * radius) so
// Player.getMuzzlePosition() — used to spawn bullets accurately — never has to know which
// weapon is drawing; it's one shared number instead of per-weapon geometry that could drift
// out of sync with what's actually drawn.

const WEAPON_MUZZLE_LENGTH = 0.95; // multiplied by player radius

const WEAPON_TYPES = {
  crossbow: {
    name: "Hunter's Crossbow",
    shortName: 'Crossbow',
    desc: 'Balanced single bolt.',
    unlockCost: 0,
    damageMult: 1,
    fireRateMult: 1,
    bulletSpeedMult: 1,
    pellets: 1,
    spreadAngle: 0,
    pierce: 0,
  },
  blunderbuss: {
    name: 'Silvered Blunderbuss',
    shortName: 'Blunderbuss',
    desc: '3-shard spread; short range, wide punch.',
    unlockCost: 60,
    damageMult: 0.5,
    fireRateMult: 0.7,
    bulletSpeedMult: 0.85,
    pellets: 3,
    spreadAngle: 0.4,
    pierce: 0,
  },
  chakram: {
    name: "Hunter's Chakram",
    shortName: 'Chakram',
    desc: 'Slow spinning throw that cuts through the horde.',
    unlockCost: 90,
    damageMult: 1.8,
    fireRateMult: 0.45,
    bulletSpeedMult: 0.75,
    pellets: 1,
    spreadAngle: 0,
    pierce: 2,
  },
};

const WEAPON_ORDER = ['crossbow', 'blunderbuss', 'chakram'];

function drawCrossbowWeapon(ctx, r) {
  ctx.strokeStyle = '#5a4a3a';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, 0);
  ctx.lineTo(r * 0.75, 0);
  ctx.stroke();

  // Bow limb, curved and mounted crosswise near the front — this is what reads as "crossbow"
  // instead of "sword": the crossbar has to be at the muzzle end, not at the grip.
  const bowX = r * 0.68;
  ctx.strokeStyle = '#8a8a94';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bowX, -r * 0.5);
  ctx.quadraticCurveTo(bowX + r * 0.32, 0, bowX, r * 0.5);
  ctx.stroke();

  ctx.strokeStyle = '#d6d6de';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bowX, -r * 0.5);
  ctx.lineTo(bowX - r * 0.12, 0);
  ctx.lineTo(bowX, r * 0.5);
  ctx.stroke();

  ctx.fillStyle = '#f0d98c';
  ctx.shadowColor = '#f0d98c';
  ctx.shadowBlur = 3;
  ctx.beginPath();
  ctx.arc(r * WEAPON_MUZZLE_LENGTH, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawBlunderbussWeapon(ctx, r) {
  ctx.strokeStyle = '#5a4a3a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, 0);
  ctx.lineTo(r * 0.55, 0);
  ctx.stroke();

  // Flared trumpet muzzle.
  ctx.fillStyle = '#8a8a94';
  ctx.strokeStyle = '#5a4a3a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(r * 0.5, -r * 0.12);
  ctx.lineTo(r * WEAPON_MUZZLE_LENGTH, -r * 0.32);
  ctx.lineTo(r * WEAPON_MUZZLE_LENGTH, r * 0.32);
  ctx.lineTo(r * 0.5, r * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawChakramWeapon(ctx, r, time) {
  const spin = (time || 0) * 9;
  ctx.save();
  ctx.translate(r * WEAPON_MUZZLE_LENGTH * 0.6, 0);
  ctx.rotate(spin);
  ctx.strokeStyle = '#cfd6dc';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(180,220,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.42, 0);
  ctx.lineTo(r * 0.42, 0);
  ctx.moveTo(0, -r * 0.42);
  ctx.lineTo(0, r * 0.42);
  ctx.stroke();
  ctx.restore();
}

const WEAPON_DRAWERS = {
  crossbow: drawCrossbowWeapon,
  blunderbuss: drawBlunderbussWeapon,
  chakram: drawChakramWeapon,
};
