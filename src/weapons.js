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
    startUnlockCost: 15, // Marks cost to make this a selectable starting weapon (meta-progression)
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
    startUnlockCost: 25, // Marks cost to make this a selectable starting weapon (meta-progression)
    damageMult: 1.8,
    fireRateMult: 0.45,
    bulletSpeedMult: 0.75,
    pellets: 1,
    spreadAngle: 0,
    pierce: 2,
  },
  revolver: {
    name: 'Silvered Revolver',
    shortName: 'Revolver',
    desc: "Quick, reliable six-shooter — a hunter's sidearm.",
    unlockCost: 40,
    startUnlockCost: 10,
    damageMult: 1,
    // A modest bump over the crossbow's own rate (not the 1.6x this shipped with, which at
    // 6.4 shots/sec was already more than half the Gatling's actual sustained rate of 12.8/sec —
    // it read as a second machine gun instead of a snappy, punchy pistol). 1.2x keeps each shot
    // audibly distinct while still feeling like a real upgrade.
    fireRateMult: 1.2,
    bulletSpeedMult: 1.1,
    pellets: 1,
    spreadAngle: 0,
    pierce: 0,
  },
  coachgun: {
    name: 'Twin-Barrel Coach Gun',
    shortName: 'Coach Gun',
    desc: 'Both barrels at once. Devastating up close, slow to reload.',
    unlockCost: 100,
    startUnlockCost: 30,
    damageMult: 0.9,
    fireRateMult: 0.35,
    bulletSpeedMult: 0.8,
    pellets: 5,
    spreadAngle: 0.65,
    pierce: 0,
  },
  gatling: {
    name: 'Hand-Cranked Gatling',
    shortName: 'Gatling',
    desc: 'Relentless sustained fire — hoses down a crowd.',
    unlockCost: 160,
    startUnlockCost: 40,
    damageMult: 0.35,
    fireRateMult: 3.2,
    bulletSpeedMult: 1,
    pellets: 1,
    spreadAngle: 0.12, // slight inaccuracy from the hand-crank shake
    pierce: 0,
  },
  thurible: {
    name: 'Blessed Thurible Launcher',
    shortName: 'Thurible',
    desc: 'Lobs blessed fire that bursts into a blast on impact.',
    unlockCost: 220,
    startUnlockCost: 55,
    damageMult: 2.2,
    fireRateMult: 0.3,
    bulletSpeedMult: 0.6,
    pellets: 1,
    spreadAngle: 0,
    pierce: 0,
    explosive: true, // see THURIBLE_BLAST_RADIUS below and its handling in game.js's bullet-collision loop
  },
};

// How far a Thurible shell's blast reaches on impact — every alive enemy in this radius takes the
// shell's full damage at once (same flat, no-falloff pattern as a Mine's blastRadius), instead of
// only whichever enemy it directly touched.
const THURIBLE_BLAST_RADIUS = 55;

const WEAPON_ORDER = ['crossbow', 'revolver', 'blunderbuss', 'chakram', 'coachgun', 'gatling', 'thurible'];
