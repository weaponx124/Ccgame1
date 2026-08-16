// Shop: between-wave upgrades purchased with gold earned from kills.
// Each item has a cost that scales up every time it's purchased.

const SHOP_CATALOG = [
  {
    id: 'damage',
    name: 'Sharper Rounds',
    desc: '+4 bullet damage',
    baseCost: 25,
    costGrowth: 1.35,
    apply: (player) => { player.damage += 4; },
  },
  {
    id: 'fireRate',
    name: 'Rapid Fire',
    desc: '+0.6 shots/sec',
    baseCost: 30,
    costGrowth: 1.4,
    apply: (player) => { player.fireRate += 0.6; },
  },
  {
    id: 'moveSpeed',
    name: 'Light Boots',
    desc: '+18 move speed',
    baseCost: 18,
    costGrowth: 1.3,
    apply: (player) => { player.speed += 18; },
  },
  {
    id: 'maxHealth',
    name: 'Reinforced Vest',
    desc: '+20 max HP & full heal',
    baseCost: 22,
    costGrowth: 1.32,
    apply: (player) => { player.maxHealth += 20; player.health = player.maxHealth; },
  },
  {
    id: 'crit',
    name: 'Precision Scope',
    desc: '+8% crit chance (2x dmg)',
    baseCost: 35,
    costGrowth: 1.45,
    maxPurchases: 6,
    apply: (player) => { player.critChance = clamp(player.critChance + 0.08, 0, 0.9); },
  },
  {
    id: 'baseRepair',
    name: 'Base Repair Crew',
    desc: 'Fully repair the base',
    baseCost: 20,
    costGrowth: 1.15,
    apply: (player, base) => { base.health = base.maxHealth; },
  },
];

class Shop {
  constructor() {
    this.purchaseCounts = {};
    for (const item of SHOP_CATALOG) this.purchaseCounts[item.id] = 0;
  }

  costFor(item) {
    const n = this.purchaseCounts[item.id];
    return Math.round(item.baseCost * Math.pow(item.costGrowth, n));
  }

  canBuy(item, gold) {
    if (item.maxPurchases && this.purchaseCounts[item.id] >= item.maxPurchases) return false;
    return gold >= this.costFor(item);
  }

  buy(item, player, base) {
    this.purchaseCounts[item.id] += 1;
    item.apply(player, base);
  }
}
