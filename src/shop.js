// Shop: between-wave upgrades purchased with gold earned from kills.
// Each item has a cost that scales up every time it's purchased.

const SHOP_CATALOG = [
  {
    id: 'damage',
    name: 'Blessed Silver',
    desc: '+4 bolt damage',
    baseCost: 25,
    costGrowth: 1.35,
    maxPurchases: 8,
    apply: (player) => { player.damage += 4; },
  },
  {
    id: 'fireRate',
    name: "Hunter's Haste",
    desc: '+0.6 shots/sec',
    baseCost: 30,
    costGrowth: 1.4,
    maxPurchases: 6,
    apply: (player) => { player.fireRate += 0.6; },
  },
  {
    id: 'moveSpeed',
    name: "Grave Runner's Boots",
    desc: '+18 move speed',
    baseCost: 18,
    costGrowth: 1.3,
    maxPurchases: 6,
    apply: (player) => { player.speed += 18; },
  },
  {
    id: 'maxHealth',
    name: 'Vitality Rite',
    desc: '+20 max HP & full heal',
    baseCost: 22,
    costGrowth: 1.32,
    maxPurchases: 6,
    apply: (player) => { player.maxHealth += 20; player.health = player.maxHealth; },
  },
  {
    id: 'crit',
    name: "Hunter's Eye",
    desc: '+8% crit chance (2x dmg)',
    baseCost: 35,
    costGrowth: 1.45,
    maxPurchases: 6,
    apply: (player) => { player.critChance = clamp(player.critChance + 0.08, 0, 0.9); },
  },
  {
    id: 'baseRepair',
    name: 'Rite of Mending',
    desc: 'Fully repair the ward',
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
