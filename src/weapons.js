// Weapon catalog: purchasable/equippable weapons for the demon hunter. Each weapon modifies
// the player's base (upgradeable) damage/fireRate/bulletSpeed with its own multipliers and
// firing pattern, so shop upgrades stay meaningful no matter which weapon is equipped.

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
