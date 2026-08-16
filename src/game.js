// Game orchestration: input handling, main loop, state machine, and DOM/HUD wiring.

(function () {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const bounds = { width: canvas.width, height: canvas.height };
  const input = new InputManager(canvas, bounds);

  // Render at native device pixel density so gradients/shading stay crisp on phones,
  // while all game math keeps using the logical 960x540 `bounds` above.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = bounds.width * dpr;
  canvas.height = bounds.height * dpr;
  ctx.scale(dpr, dpr);

  // ---------- Responsive fit ----------
  // The canvas keeps a fixed logical resolution; only its CSS size changes so it
  // letterboxes cleanly into any phone (or desktop) viewport without touching game math.
  const stage = document.getElementById('stage');
  function fitStage() {
    const scale = Math.min(window.innerWidth / bounds.width, window.innerHeight / bounds.height);
    stage.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  fitStage();

  // ---------- DOM refs ----------
  const el = {
    waveNum: document.getElementById('wave-num'),
    enemiesLeft: document.getElementById('enemies-left'),
    goldAmount: document.getElementById('gold-amount'),
    baseHealthFill: document.getElementById('base-health-fill'),
    baseHealthText: document.getElementById('base-health-text'),
    playerHealthFill: document.getElementById('player-health-fill'),
    playerHealthText: document.getElementById('player-health-text'),
    shopOverlay: document.getElementById('shop-overlay'),
    shopItems: document.getElementById('shop-items'),
    weaponItems: document.getElementById('weapon-items'),
    defenseItems: document.getElementById('defense-items'),
    shopTitle: document.getElementById('shop-title'),
    nextWaveBtn: document.getElementById('next-wave-btn'),
    gameoverOverlay: document.getElementById('gameover-overlay'),
    finalWave: document.getElementById('final-wave'),
    restartBtn: document.getElementById('restart-btn'),
    startOverlay: document.getElementById('start-overlay'),
    startBtn: document.getElementById('start-btn'),
    continueBtn: document.getElementById('continue-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    pauseOverlay: document.getElementById('pause-overlay'),
    resumeBtn: document.getElementById('resume-btn'),
    saveQuitBtn: document.getElementById('save-quit-btn'),
    weaponSwitchBtn: document.getElementById('weapon-switch-btn'),
  };

  // ---------- Game state ----------
  let state; // 'playing' | 'shop' | 'gameover' | 'menu'
  let paused = false;
  let player, base, waveManager, shop;
  let bullets, enemies;
  let fences, mines, explosions;
  let defensePurchaseCounts;
  let gold;

  function setPauseButtonVisible(visible) {
    el.pauseBtn.classList.toggle('hidden', !visible);
    el.weaponSwitchBtn.classList.toggle('hidden', !visible);
  }

  function resetGame() {
    player = new Player(bounds.width / 2, bounds.height / 2 + 120);
    base = new Base(bounds.width / 2, bounds.height / 2);
    waveManager = new WaveManager(bounds);
    shop = new Shop();
    bullets = [];
    enemies = [];
    fences = [];
    mines = [];
    explosions = [];
    defensePurchaseCounts = { fence: 0, mine: 0 };
    gold = 20; // enough for one small early purchase (a fence, a mine, or a cheap upgrade)
    state = 'shop';
    waveManager.waveNumber = 0; // startNextWave will bump to 1
    openShop(true);
  }

  // ---------- Shop UI ----------
  function openShop(isFirst = false) {
    state = 'shop';
    el.shopTitle.textContent = isFirst ? 'Prepare for the Hunt' : `Wave ${waveManager.waveNumber} Survived`;
    renderShopItems();
    renderWeaponItems();
    renderDefenseItems();
    el.shopOverlay.classList.remove('hidden');
    setPauseButtonVisible(true);
  }

  function renderDefenseItems() {
    el.defenseItems.innerHTML = '';

    const fenceCount = defensePurchaseCounts.fence;
    const fenceMaxed = fenceCount >= FENCE_MAX;
    const fenceCost = costFor(FENCE_BASE_COST, FENCE_COST_GROWTH, fenceCount);
    appendDefenseRow({
      name: 'Wooden Fence',
      desc: `Slows enemies that pass near it. ${fenceCount}/${FENCE_MAX} placed around the ward.`,
      maxed: fenceMaxed,
      cost: fenceCost,
      onBuy: () => {
        const pos = nextFencePosition(base, fenceCount);
        fences.push(new Fence(pos.x, pos.y, fenceCount));
        defensePurchaseCounts.fence += 1;
      },
    });

    const mineCount = defensePurchaseCounts.mine;
    const mineMaxed = mineCount >= MINE_MAX;
    const mineCost = costFor(MINE_BASE_COST, MINE_COST_GROWTH, mineCount);
    appendDefenseRow({
      name: 'Buried Mine',
      desc: `Explodes when a monster steps near. ${mineCount}/${MINE_MAX} buried in the field.`,
      maxed: mineMaxed,
      cost: mineCost,
      onBuy: () => {
        const pos = randomMinePosition(base, bounds, mines);
        mines.push(new Mine(pos.x, pos.y, mineCount));
        defensePurchaseCounts.mine += 1;
      },
    });
  }

  function appendDefenseRow({ name, desc, maxed, cost, onBuy }) {
    const row = document.createElement('div');
    row.className = 'shop-item';
    row.innerHTML = `
      <div class="shop-item-info">
        <div class="shop-item-name">${name}${maxed ? ' (MAX)' : ''}</div>
        <div class="shop-item-desc">${desc}</div>
      </div>
      <button class="shop-item-buy" ${maxed ? 'disabled' : ''}>${maxed ? 'MAX' : cost + 'g'}</button>
    `;
    const btn = row.querySelector('button');
    btn.disabled = btn.disabled || gold < cost;
    btn.addEventListener('click', () => {
      if (gold < cost || maxed) return;
      gold -= cost;
      onBuy();
      updateHud();
      renderDefenseItems();
      renderShopItems();
      renderWeaponItems();
    });
    el.defenseItems.appendChild(row);
  }

  function renderWeaponItems() {
    el.weaponItems.innerHTML = '';
    for (const id of WEAPON_ORDER) {
      const weapon = WEAPON_TYPES[id];
      const owned = player.unlockedWeapons.includes(id);
      const equipped = player.equippedWeapon === id;
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `
        <div class="shop-item-info">
          <div class="shop-item-name">${weapon.name}${equipped ? ' (Equipped)' : ''}</div>
          <div class="shop-item-desc">${weapon.desc}</div>
        </div>
        <button class="shop-item-buy">${owned ? (equipped ? 'Equipped' : 'Equip') : weapon.unlockCost + 'g'}</button>
      `;
      const btn = row.querySelector('button');
      if (equipped) {
        btn.disabled = true;
      } else if (!owned) {
        btn.disabled = gold < weapon.unlockCost;
      }
      btn.addEventListener('click', () => {
        if (equipped) return;
        if (!owned) {
          if (gold < weapon.unlockCost) return;
          gold -= weapon.unlockCost;
          player.unlockedWeapons.push(id);
        }
        player.equippedWeapon = id;
        updateHud();
        renderWeaponItems();
        renderShopItems();
        renderDefenseItems();
      });
      el.weaponItems.appendChild(row);
    }
  }

  function renderShopItems() {
    el.shopItems.innerHTML = '';
    for (const item of SHOP_CATALOG) {
      const cost = shop.costFor(item);
      const maxedOut = item.maxPurchases && shop.purchaseCounts[item.id] >= item.maxPurchases;
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `
        <div class="shop-item-info">
          <div class="shop-item-name">${item.name}${maxedOut ? ' (MAX)' : ''}</div>
          <div class="shop-item-desc">${item.desc}</div>
        </div>
        <button class="shop-item-buy" ${maxedOut ? 'disabled' : ''}>${maxedOut ? 'MAX' : cost + 'g'}</button>
      `;
      const btn = row.querySelector('button');
      btn.disabled = btn.disabled || !shop.canBuy(item, gold);
      btn.addEventListener('click', () => {
        if (!shop.canBuy(item, gold)) return;
        gold -= shop.costFor(item);
        shop.buy(item, player, base);
        updateHud();
        renderShopItems();
        renderWeaponItems();
        renderDefenseItems();
      });
      el.shopItems.appendChild(row);
    }
  }

  el.nextWaveBtn.addEventListener('click', () => {
    el.shopOverlay.classList.add('hidden');
    state = 'playing';
    waveManager.startNextWave();
    updateHud();
  });

  el.restartBtn.addEventListener('click', () => {
    el.gameoverOverlay.classList.add('hidden');
    clearSave();
    resetGame();
    updateHud();
  });

  el.startBtn.addEventListener('click', () => {
    if (loadGame() && !confirm('Start a new game? Your saved progress will be lost.')) return;
    clearSave();
    el.startOverlay.classList.add('hidden');
    resetGame();
    updateHud();
  });

  el.continueBtn.addEventListener('click', () => {
    const snapshot = loadGame();
    if (!snapshot) return;
    el.startOverlay.classList.add('hidden');
    applySnapshot(snapshot);
  });

  function refreshStartScreenSaveUI() {
    const hasSave = !!loadGame();
    el.continueBtn.classList.toggle('hidden', !hasSave);
    el.startBtn.textContent = hasSave ? 'New Game' : 'Start Game';
  }

  el.weaponSwitchBtn.addEventListener('click', () => {
    player.swapWeapon();
    updateHud();
  });

  // ---------- Pause / save / quit ----------
  el.pauseBtn.addEventListener('click', () => {
    paused = true;
    el.pauseOverlay.classList.remove('hidden');
  });

  el.resumeBtn.addEventListener('click', () => {
    paused = false;
    el.pauseOverlay.classList.add('hidden');
  });

  el.saveQuitBtn.addEventListener('click', () => {
    saveGame(buildSnapshot());
    el.pauseOverlay.classList.add('hidden');
    el.shopOverlay.classList.add('hidden');
    paused = false;
    state = 'menu';
    setPauseButtonVisible(false);
    refreshStartScreenSaveUI();
    el.startOverlay.classList.remove('hidden');
  });

  function buildSnapshot() {
    return {
      v: 1,
      savedPhase: state === 'shop' ? 'shop' : 'playing',
      gold,
      wave: waveManager.waveNumber,
      waveActive: waveManager.active,
      spawnQueue: [...waveManager.spawnQueue],
      waveScale: waveManager.waveScale || 1,
      spawnTimer: waveManager._spawnTimer,
      player: {
        x: player.x,
        y: player.y,
        health: player.health,
        maxHealth: player.maxHealth,
        speed: player.speed,
        damage: player.damage,
        fireRate: player.fireRate,
        bulletSpeed: player.bulletSpeed,
        critChance: player.critChance,
        unlockedWeapons: [...player.unlockedWeapons],
        equippedWeapon: player.equippedWeapon,
      },
      base: { health: base.health, maxHealth: base.maxHealth },
      enemies: enemies.map((e) => ({ typeKey: e.typeKey, x: e.x, y: e.y, health: e.health, maxHealth: e.maxHealth })),
      shopPurchaseCounts: { ...shop.purchaseCounts },
      fences: fences.map((f) => ({ x: f.x, y: f.y, health: f.health, maxHealth: f.maxHealth })),
      mines: mines.map((m) => ({ x: m.x, y: m.y, damage: m.damage, blastRadius: m.blastRadius })),
      defensePurchaseCounts: { ...defensePurchaseCounts },
    };
  }

  function applySnapshot(snapshot) {
    player = new Player(snapshot.player.x, snapshot.player.y);
    Object.assign(player, {
      health: snapshot.player.health,
      maxHealth: snapshot.player.maxHealth,
      speed: snapshot.player.speed,
      damage: snapshot.player.damage,
      fireRate: snapshot.player.fireRate,
      bulletSpeed: snapshot.player.bulletSpeed,
      critChance: snapshot.player.critChance,
      unlockedWeapons: snapshot.player.unlockedWeapons ? [...snapshot.player.unlockedWeapons] : ['crossbow'],
      equippedWeapon: snapshot.player.equippedWeapon || 'crossbow',
    });

    base = new Base(bounds.width / 2, bounds.height / 2);
    base.maxHealth = snapshot.base.maxHealth;
    base.health = snapshot.base.health;

    waveManager = new WaveManager(bounds);
    waveManager.waveNumber = snapshot.wave;
    waveManager.active = snapshot.waveActive;
    waveManager.spawnQueue = [...snapshot.spawnQueue];
    waveManager.waveScale = snapshot.waveScale;
    waveManager._spawnTimer = snapshot.spawnTimer;

    shop = new Shop();
    for (const id in snapshot.shopPurchaseCounts) {
      if (id in shop.purchaseCounts) shop.purchaseCounts[id] = snapshot.shopPurchaseCounts[id];
    }

    bullets = [];
    enemies = snapshot.enemies.map((e) => {
      const enemy = new Enemy(e.x, e.y, e.typeKey, 1);
      enemy.health = e.health;
      enemy.maxHealth = e.maxHealth;
      return enemy;
    });

    explosions = [];
    fences = (snapshot.fences || []).map((f) => {
      const fence = new Fence(f.x, f.y, 0);
      fence.maxHealth = f.maxHealth;
      fence.health = f.health;
      return fence;
    });
    mines = (snapshot.mines || []).map((m) => {
      const mine = new Mine(m.x, m.y, 0);
      mine.damage = m.damage;
      mine.blastRadius = m.blastRadius;
      return mine;
    });
    defensePurchaseCounts = snapshot.defensePurchaseCounts
      ? { ...snapshot.defensePurchaseCounts }
      : { fence: 0, mine: 0 };

    gold = snapshot.gold;
    paused = false;
    el.gameoverOverlay.classList.add('hidden');

    if (snapshot.savedPhase === 'shop') {
      openShop(snapshot.wave === 0);
    } else {
      state = 'playing';
      el.shopOverlay.classList.add('hidden');
      setPauseButtonVisible(true);
    }
    updateHud();
  }

  // ---------- HUD ----------
  function updateHud() {
    el.waveNum.textContent = waveManager.waveNumber;
    el.enemiesLeft.textContent = waveManager.totalRemaining + enemies.length;
    el.goldAmount.textContent = gold;

    const basePct = clamp(base.health / base.maxHealth, 0, 1) * 100;
    el.baseHealthFill.style.width = basePct + '%';
    el.baseHealthText.textContent = `${Math.ceil(base.health)}/${base.maxHealth}`;

    const playerPct = clamp(player.health / player.maxHealth, 0, 1) * 100;
    el.playerHealthFill.style.width = playerPct + '%';
    el.playerHealthText.textContent = `${Math.ceil(player.health)}/${player.maxHealth}`;

    const weapon = WEAPON_TYPES[player.equippedWeapon];
    el.weaponSwitchBtn.textContent = player.unlockedWeapons.length > 1
      ? `${weapon.shortName} ⇄`
      : weapon.shortName;
  }

  // ---------- Update ----------
  function update(dt) {
    if (state !== 'playing') return;

    const control = input.getControlState(player.x, player.y, player.aimAngle);
    player.update(dt, control, bounds);
    if (control.firing) {
      bullets.push(...player.tryFire());
    }

    for (const b of bullets) b.update(dt, bounds);
    bullets = bullets.filter((b) => b.alive);

    const spawned = waveManager.update(dt, enemies.length);
    if (spawned) enemies.push(spawned);

    for (const enemy of enemies) {
      // Enemies target whichever is closer: the player or the base.
      const distToPlayer = dist(enemy.x, enemy.y, player.x, player.y);
      const distToBase = dist(enemy.x, enemy.y, base.x, base.y);
      const target = distToPlayer < distToBase ? player : base;

      // Fences slow any enemy passing near them, and take ongoing damage from whoever is
      // in contact — enough sustained pressure breaks a segment, but a couple of stragglers
      // brushing past won't.
      let speedMult = 1;
      for (const fence of fences) {
        if (!fence.alive) continue;
        const fenceDist = dist(enemy.x, enemy.y, fence.x, fence.y);
        if (fenceDist <= fence.slowRadius) speedMult = Math.min(speedMult, fence.slowMult);
        if (fenceDist <= fence.radius + enemy.radius) fence.takeDamage(enemy.damage * dt);
      }

      enemy.update(dt, target, speedMult);

      if (dist(enemy.x, enemy.y, base.x, base.y) <= base.radius + enemy.radius) {
        base.takeDamage(enemy.damage);
        enemy.alive = false;
      } else if (dist(enemy.x, enemy.y, player.x, player.y) <= player.radius + enemy.radius) {
        player.takeDamage(enemy.damage);
        enemy.alive = false;
      }
    }
    fences = fences.filter((f) => f.alive);

    // Mines: the first enemy to step within range detonates it, dealing blast damage to
    // every enemy caught in the radius (including itself) before the mine is consumed.
    for (const mine of mines) {
      if (!mine.alive) continue;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (dist(mine.x, mine.y, enemy.x, enemy.y) <= mine.triggerRadius + enemy.radius) {
          mine.alive = false;
          explosions.push(new Explosion(mine.x, mine.y, mine.blastRadius));
          for (const victim of enemies) {
            if (!victim.alive) continue;
            if (dist(mine.x, mine.y, victim.x, victim.y) <= mine.blastRadius) {
              victim.takeDamage(mine.damage);
              if (!victim.alive) gold += victim.reward;
            }
          }
          break;
        }
      }
    }
    mines = mines.filter((m) => m.alive);

    for (const ex of explosions) ex.update(dt);
    explosions = explosions.filter((e) => e.alive);

    // Bullet vs enemy collisions. Piercing bullets (pierceRemaining > 0) keep flying and can
    // hit more enemies, but never the same enemy twice — hitEnemies tracks who's already
    // been hit so an overlapping pierce shot can't multi-tick damage on one target.
    for (const bullet of bullets) {
      if (!bullet.alive) continue;
      for (const enemy of enemies) {
        if (!enemy.alive || bullet.hitEnemies.has(enemy)) continue;
        const hitCenter = enemy.getHitCenter();
        if (dist(bullet.x, bullet.y, hitCenter.x, hitCenter.y) <= bullet.radius + enemy.hitRadius) {
          enemy.takeDamage(bullet.damage);
          bullet.hitEnemies.add(enemy);
          if (!enemy.alive) gold += enemy.reward;
          if (bullet.pierceRemaining > 0) {
            bullet.pierceRemaining -= 1;
          } else {
            bullet.alive = false;
            break;
          }
        }
      }
    }
    bullets = bullets.filter((b) => b.alive);
    enemies = enemies.filter((e) => e.alive);

    if (base.isDestroyed) {
      state = 'gameover';
      el.finalWave.textContent = waveManager.waveNumber;
      el.gameoverOverlay.classList.remove('hidden');
      setPauseButtonVisible(false);
      clearSave();
      return;
    }

    if (player.isDead) {
      // Player respawns at cost of some gold penalty rather than ending the run;
      // the base is the real fail condition.
      player.health = player.maxHealth;
      player.x = bounds.width / 2;
      player.y = bounds.height / 2 + 120;
      gold = Math.max(0, gold - 10);
    }

    if (waveManager.isWaveCleared(enemies.length)) {
      gold += 10 + waveManager.waveNumber * 2; // wave-clear bonus, on top of per-kill gold
      waveManager.finishWave();
      openShop(false);
    }

    updateHud();
  }

  // ---------- Render: gothic graveyard atmosphere ----------
  // Fixed decorative tombstones, kept out of the central play area.
  const TOMBSTONES = [
    { x: 55, y: 70, scale: 1.0, rot: -0.12 },
    { x: 905, y: 85, scale: 0.85, rot: 0.16 },
    { x: 40, y: 465, scale: 1.1, rot: 0.06 },
    { x: 915, y: 470, scale: 0.9, rot: -0.09 },
    { x: 480, y: 34, scale: 0.7, rot: 0.02 },
    { x: 180, y: 500, scale: 0.75, rot: -0.05 },
  ];

  function drawTombstone(x, y, scale, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(2, 24, 17, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createLinearGradient(-14, -22, 14, 20);
    grad.addColorStop(0, '#3a3440');
    grad.addColorStop(1, '#141018');
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(140,120,100,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-14, 20);
    ctx.lineTo(-14, -8);
    ctx.arc(0, -8, 14, Math.PI, 0);
    ctx.lineTo(14, 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 8);
    ctx.moveTo(-6, -2);
    ctx.lineTo(6, -2);
    ctx.stroke();

    ctx.restore();
  }

  const DEAD_TREES = [
    { x: 140, y: 220, scale: 1.0, rot: -0.06 },
    { x: 820, y: 195, scale: 0.85, rot: 0.08 },
    { x: 720, y: 480, scale: 0.95, rot: -0.04 },
  ];

  function drawDeadTree(x, y, scale, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1c1512';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(-2, -34);
    ctx.stroke();

    ctx.strokeStyle = '#241a16';
    ctx.lineWidth = 3;
    const branches = [
      [-2, -34, -20, -50],
      [-2, -34, 12, -46],
      [-20, -50, -30, -62],
      [-20, -50, -10, -64],
      [12, -46, 24, -58],
    ];
    for (const [x1, y1, x2, y2] of branches) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCrypt(x, y) {
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(4, 34, 46, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createLinearGradient(-40, -46, 40, 30);
    grad.addColorStop(0, '#39323f');
    grad.addColorStop(1, '#120d16');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#5c4a34';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-40, -20, 80, 50);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-46, -20);
    ctx.lineTo(0, -46);
    ctx.lineTo(46, -20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.moveTo(-12, 30);
    ctx.lineTo(-12, 2);
    ctx.arc(0, 2, 12, Math.PI, 0);
    ctx.lineTo(12, 30);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#4a4050';
    ctx.fillRect(-22, -10, 6, 40);
    ctx.fillRect(16, -10, 6, 40);

    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.lineTo(0, -58);
    ctx.moveTo(-5, -52);
    ctx.lineTo(5, -52);
    ctx.stroke();

    ctx.restore();
  }

  const BRAZIERS = [
    { x: 250, y: 150 },
    { x: 700, y: 400 },
  ];

  function drawBrazierGlow(x, y, time) {
    const flicker = 0.7 + 0.3 * Math.sin(time * 9 + x) + 0.15 * Math.sin(time * 23 + y);
    const glowR = 75 * (0.85 + flicker * 0.15);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    glow.addColorStop(0, `rgba(255, 140, 50, ${0.16 * flicker})`);
    glow.addColorStop(1, 'rgba(255, 140, 50, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
    return flicker;
  }

  function drawBrazier(x, y, flicker) {
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(2, 14, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#3a3440';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, 14);
    ctx.lineTo(-3, -4);
    ctx.moveTo(6, 14);
    ctx.lineTo(3, -4);
    ctx.stroke();

    ctx.fillStyle = '#2a2430';
    ctx.beginPath();
    ctx.ellipse(0, -6, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const flameH = 14 * flicker;
    const flameGrad = ctx.createLinearGradient(0, -6, 0, -6 - flameH);
    flameGrad.addColorStop(0, '#ff8c3c');
    flameGrad.addColorStop(0.6, '#ffb85c');
    flameGrad.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(-4, -6);
    ctx.quadraticCurveTo(-2, -6 - flameH * 0.6, 0, -6 - flameH);
    ctx.quadraticCurveTo(2, -6 - flameH * 0.6, 4, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const GROUND_CRACKS = [
    { x: 300, y: 150, len: 40, rot: 0.4 },
    { x: 620, y: 110, len: 30, rot: -0.3 },
    { x: 220, y: 400, len: 35, rot: 1.1 },
    { x: 640, y: 330, len: 45, rot: -0.8 },
    { x: 450, y: 460, len: 30, rot: 0.2 },
    { x: 130, y: 330, len: 26, rot: 0.9 },
  ];

  function drawCrack(x, y, len, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(-len / 6, 3);
    ctx.lineTo(len / 6, -2);
    ctx.lineTo(len / 2, 2);
    ctx.stroke();
    ctx.restore();
  }

  const MOSS_PATCHES = [
    { x: 360, y: 220, r: 32 },
    { x: 600, y: 320, r: 24 },
    { x: 250, y: 380, r: 28 },
    { x: 780, y: 300, r: 20 },
  ];

  function drawMoss(x, y, r) {
    ctx.fillStyle = 'rgba(70, 90, 50, 0.07)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawArenaBackground(time) {
    const grad = ctx.createLinearGradient(0, 0, 0, bounds.height);
    grad.addColorStop(0, '#1a1420');
    grad.addColorStop(1, '#0c0810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    ctx.strokeStyle = 'rgba(140,120,150,0.05)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x <= bounds.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, bounds.height);
      ctx.stroke();
    }
    for (let y = 0; y <= bounds.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(bounds.width, y);
      ctx.stroke();
    }

    for (const m of MOSS_PATCHES) drawMoss(m.x, m.y, m.r);
    for (const c of GROUND_CRACKS) drawCrack(c.x, c.y, c.len, c.rot);

    const flickers = BRAZIERS.map((b) => drawBrazierGlow(b.x, b.y, time));

    for (const t of TOMBSTONES) drawTombstone(t.x, t.y, t.scale, t.rot);
    for (const t of DEAD_TREES) drawDeadTree(t.x, t.y, t.scale, t.rot);
    drawCrypt(850, 300);

    BRAZIERS.forEach((b, i) => drawBrazier(b.x, b.y, flickers[i]));
  }

  // Slow-drifting fog wisps for atmosphere.
  const FOG = Array.from({ length: 12 }, (_, i) => ({
    x: (i * 137) % bounds.width,
    y: (i * 251) % bounds.height,
    r: 60 + (i % 4) * 20,
    vx: (i % 2 === 0 ? 1 : -1) * (6 + (i % 3) * 3),
    vy: (i % 3 === 0 ? 1 : -1) * (3 + (i % 2) * 2),
    alpha: 0.03 + (i % 3) * 0.015,
  }));

  function drawFog(dt) {
    for (const f of FOG) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -f.r) f.x = bounds.width + f.r;
      if (f.x > bounds.width + f.r) f.x = -f.r;
      if (f.y < -f.r) f.y = bounds.height + f.r;
      if (f.y > bounds.height + f.r) f.y = -f.r;

      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      grad.addColorStop(0, `rgba(180,170,190,${f.alpha})`);
      grad.addColorStop(1, 'rgba(180,170,190,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawVignette() {
    const grad = ctx.createRadialGradient(
      bounds.width / 2, bounds.height / 2, bounds.height * 0.2,
      bounds.width / 2, bounds.height / 2, bounds.height * 0.75
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
  }

  function drawStick(stick, color) {
    if (!stick.active) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, JOYSTICK_MAX_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(stick.curX, stick.curY, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render(dt) {
    drawArenaBackground(elapsed);
    for (const mine of mines) mine.draw(ctx, elapsed);
    for (const fence of fences) fence.draw(ctx);
    base.draw(ctx, elapsed);
    for (const enemy of enemies) enemy.draw(ctx);
    for (const bullet of bullets) bullet.draw(ctx, elapsed);
    if (state !== 'gameover') player.draw(ctx, elapsed);
    for (const ex of explosions) ex.draw(ctx);

    if (state === 'playing') {
      drawStick(input.moveStick, 'rgba(79, 220, 111, 0.9)');
      drawStick(input.aimStick, 'rgba(255, 95, 95, 0.9)');
    }

    drawFog(dt);
    drawVignette();
  }

  // ---------- Main loop ----------
  let lastTime = performance.now();
  let elapsed = 0; // drives ambient effects (rune pulse, fog drift) even while paused
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp to avoid huge steps on tab-out
    lastTime = now;
    elapsed += dt;
    if (!paused) update(dt);
    render(dt);
    requestAnimationFrame(loop);
  }

  // Initialize a game instance so state exists even before "Start" is clicked.
  resetGame();
  state = 'menu';
  el.shopOverlay.classList.add('hidden'); // hidden until player dismisses start screen
  setPauseButtonVisible(false);
  refreshStartScreenSaveUI();
  updateHud();
  requestAnimationFrame(loop);

  // Debug/test hook: read-only snapshot of live state, useful for automated smoke tests.
  window.__game = {
    hasSave: () => !!loadGame(),
    peekSave: () => loadGame(),
    debugSetBaseHealth: (h) => { base.health = h; },
    debugSetGold: (g) => { gold = g; updateHud(); },
    debugSpawn: (typeKey, x, y) => { enemies.push(new Enemy(x, y, typeKey, 1)); },
    debugSetPaused: (v) => { paused = v; },
    getState: () => ({
      state,
      paused,
      gold,
      wave: waveManager.waveNumber,
      enemies: enemies.map((e) => ({ x: e.x, y: e.y, health: e.health, radius: e.radius, hitCenter: e.getHitCenter(), hitRadius: e.hitRadius })),
      bullets: bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, radius: b.radius, pierceRemaining: b.pierceRemaining })),
      player: {
        x: player.x,
        y: player.y,
        health: player.health,
        aimAngle: player.aimAngle,
        equippedWeapon: player.equippedWeapon,
        unlockedWeapons: [...player.unlockedWeapons],
        muzzle: player.getMuzzlePosition(),
      },
      base: { x: base.x, y: base.y, health: base.health },
      fences: fences.map((f) => ({ x: f.x, y: f.y, health: f.health, maxHealth: f.maxHealth })),
      mines: mines.map((m) => ({ x: m.x, y: m.y, damage: m.damage, blastRadius: m.blastRadius })),
      defensePurchaseCounts: { ...defensePurchaseCounts },
      moveStick: { active: input.moveStick.active, ...input.moveStick.read() },
      aimStick: { active: input.aimStick.active, ...input.aimStick.read() },
    }),
  };
})();
