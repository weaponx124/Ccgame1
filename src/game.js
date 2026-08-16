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
    prepCountdownFill: document.getElementById('prep-countdown-fill'),
    prepCountdownText: document.getElementById('prep-countdown-text'),
    placementBar: document.getElementById('placement-bar'),
    placementPrompt: document.getElementById('placement-prompt'),
    placementRotateBtn: document.getElementById('placement-rotate-btn'),
    placementCancelBtn: document.getElementById('placement-cancel-btn'),
    waveClearBanner: document.getElementById('wave-clear-banner'),
    waveClearSeconds: document.getElementById('wave-clear-seconds'),
    fieldPrepPill: document.getElementById('field-prep-pill'),
    fieldPrepPillText: document.getElementById('field-prep-pill-text'),
    viewFieldBtn: document.getElementById('view-field-btn'),
    reopenShopBtn: document.getElementById('reopen-shop-btn'),
    defenseSelectBar: document.getElementById('defense-select-bar'),
    defenseSelectTitle: document.getElementById('defense-select-title'),
    defenseSelectMoveBtn: document.getElementById('defense-select-move-btn'),
    defenseSelectRotateBtn: document.getElementById('defense-select-rotate-btn'),
    defenseSelectUpgradeBtn: document.getElementById('defense-select-upgrade-btn'),
    defenseSelectCloseBtn: document.getElementById('defense-select-close-btn'),
  };

  // ---------- Game state ----------
  let state; // 'playing' | 'shop' | 'gameover' | 'menu'
  let paused = false;
  let player, base, waveManager, shop;
  let bullets, enemies;
  let fences, mines, explosions, hitEffects, bloodPools;
  let defenseState; // { fenceTier, mineTier, fencesPlaced, minesPlaced }
  let placementMode; // null | { kind: 'fence'|'mine', tierIndex, moving: Fence|Mine|null }
  let placementCursor; // { x, y } | null — last known pointer position while placing
  let invalidPlacementFlash; // seconds remaining on the "can't place here" marker
  let prepCountdown; // seconds remaining in the current shop/prep phase
  let damageFlash; // 0..1, screen-tint intensity that decays after the player/base is hit
  let shopHidden; // true while the shop panel is manually closed during prep to inspect the field
  let selectedDefense; // null | { kind: 'fence'|'mine', ref } — a placed item picked for move/upgrade
  let waveClearTimer; // seconds remaining showing the "Wave Cleared" banner before the shop opens
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
    hitEffects = [];
    bloodPools = [];
    defenseState = { fenceTier: 0, mineTier: 0, fencesPlaced: 0, minesPlaced: 0 };
    placementMode = null;
    placementCursor = null;
    invalidPlacementFlash = 0;
    damageFlash = 0;
    shopHidden = false;
    selectedDefense = null;
    waveClearTimer = 0;
    el.waveClearBanner.classList.add('hidden');
    el.defenseSelectBar.classList.add('hidden');
    el.reopenShopBtn.classList.add('hidden');
    el.fieldPrepPill.classList.add('hidden');
    gold = 20; // enough for one small early purchase (a fence, a mine, or a cheap upgrade)
    state = 'shop';
    waveManager.waveNumber = 0; // startNextWave will bump to 1
    openShop(true);
  }

  // ---------- Shop UI ----------
  const PREP_TIME_FIRST = 35;
  const PREP_TIME = 25;
  const WAVE_CLEAR_DELAY = 5; // seconds the "Wave Cleared" banner holds before the shop opens

  function openShop(isFirst = false) {
    state = 'shop';
    prepCountdown = isFirst ? PREP_TIME_FIRST : PREP_TIME;
    shopHidden = false;
    hideDefenseSelection();
    el.reopenShopBtn.classList.add('hidden');
    el.fieldPrepPill.classList.add('hidden');
    el.shopTitle.textContent = isFirst ? 'Prepare for the Hunt' : `Wave ${waveManager.waveNumber} Survived`;
    renderShopItems();
    renderWeaponItems();
    renderDefenseItems();
    updatePrepCountdownUI();
    el.shopOverlay.classList.remove('hidden');
    setPauseButtonVisible(true);
  }

  function updatePrepCountdownUI() {
    const max = waveManager.waveNumber === 0 ? PREP_TIME_FIRST : PREP_TIME;
    const pct = clamp(prepCountdown / max, 0, 1) * 100;
    el.prepCountdownFill.style.width = pct + '%';
    const secs = Math.ceil(prepCountdown) + 's';
    el.prepCountdownText.textContent = secs;
    el.fieldPrepPillText.textContent = secs;
  }

  el.viewFieldBtn.addEventListener('click', () => {
    shopHidden = true;
    el.shopOverlay.classList.add('hidden');
    el.reopenShopBtn.classList.remove('hidden');
    el.fieldPrepPill.classList.remove('hidden');
    updatePrepCountdownUI();
  });

  el.reopenShopBtn.addEventListener('click', () => {
    shopHidden = false;
    hideDefenseSelection();
    el.shopOverlay.classList.remove('hidden');
    el.reopenShopBtn.classList.add('hidden');
    el.fieldPrepPill.classList.add('hidden');
  });

  function renderDefenseItems() {
    el.defenseItems.innerHTML = '';
    renderDefenseTierSection('fence', FENCE_TIERS, 'fenceTier', 'fencesPlaced', FENCE_MAX,
      (t) => `Slows enemies nearby; ${t.maxHealth} HP.`);
    renderDefenseTierSection('mine', MINE_TIERS, 'mineTier', 'minesPlaced', MINE_MAX,
      (t) => `${t.damage} dmg in a ${t.blastRadius}px blast.`);
  }

  function renderDefenseTierSection(kind, tiers, tierKey, placedKey, maxTotal, describe) {
    const tierIndex = defenseState[tierKey];
    const tier = tiers[tierIndex];
    const placed = defenseState[placedKey];
    const placedMaxed = placed >= maxTotal;

    appendDefenseRow({
      name: `${tier.name} — Lv ${tierIndex + 1}/${tiers.length}`,
      desc: `${describe(tier)} ${placed}/${maxTotal} placed.`,
      maxed: placedMaxed,
      cost: tier.cost,
      onBuy: () => beginPlacement(kind, tierIndex),
    });

    if (tierIndex < tiers.length - 1) {
      const nextTier = tiers[tierIndex + 1];
      appendDefenseRow({
        name: `Upgrade to ${nextTier.name}`,
        desc: `${describe(nextTier)} Only affects defenses placed after upgrading.`,
        maxed: false,
        cost: nextTier.unlockCost,
        onBuy: () => { defenseState[tierKey] += 1; },
      });
    }
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

  // ---------- Manual defense placement ----------
  const ROTATE_STEP = Math.PI / 4; // 45° per tap — enough steps to front any approach direction

  function beginPlacement(kind, tierIndex, moving = null) {
    placementMode = { kind, tierIndex, moving, rotation: moving ? moving.rotation : 0 };
    placementCursor = null;
    el.shopOverlay.classList.add('hidden');
    el.reopenShopBtn.classList.add('hidden');
    el.fieldPrepPill.classList.add('hidden');
    hideDefenseSelection();
    el.placementBar.classList.remove('hidden');
    el.placementRotateBtn.classList.toggle('hidden', kind !== 'fence');
    const tiers = kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
    el.placementPrompt.textContent = moving
      ? `Tap the battlefield to move your ${tiers[tierIndex].name}.`
      : `Tap the battlefield to place your ${tiers[tierIndex].name}. It's already paid for.`;
    input.setSuspended(true);
  }

  el.placementRotateBtn.addEventListener('click', () => {
    if (!placementMode || placementMode.kind !== 'fence') return;
    placementMode.rotation = (placementMode.rotation + ROTATE_STEP) % (Math.PI * 2);
  });

  function endPlacement() {
    placementMode = null;
    placementCursor = null;
    el.placementBar.classList.add('hidden');
    input.setSuspended(false);
    if (shopHidden) {
      el.reopenShopBtn.classList.remove('hidden');
      el.fieldPrepPill.classList.remove('hidden');
      updatePrepCountdownUI();
    } else {
      el.shopOverlay.classList.remove('hidden');
    }
  }

  el.placementCancelBtn.addEventListener('click', () => {
    if (!placementMode) return;
    if (!placementMode.moving) {
      const tiers = placementMode.kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
      gold += tiers[placementMode.tierIndex].cost; // refund — it was paid up front
    }
    endPlacement();
    updateHud();
    renderDefenseItems();
  });

  function isValidPlacement(x, y, ignore = null) {
    if (x < 26 || x > bounds.width - 26 || y < 26 || y > bounds.height - 26) return false;
    if (dist(x, y, base.x, base.y) < base.radius + 22) return false;
    for (const f of fences) {
      if (f === ignore) continue;
      if (dist(x, y, f.x, f.y) < FENCE_MIN_SPACING) return false;
    }
    for (const m of mines) {
      if (m === ignore) continue;
      if (dist(x, y, m.x, m.y) < 24) return false;
    }
    return true;
  }

  function handlePlacementTap(clientX, clientY) {
    if (!placementMode) return;
    const p = input.toCanvasSpace(clientX, clientY);
    placeAt(p.x, p.y);
  }

  /** Places (or flashes invalid at) canvas-space coordinates — shared by the real tap handler and debug hooks. */
  function placeAt(x, y) {
    if (!placementMode) return;
    const p = { x, y };
    placementCursor = p;
    const ignore = placementMode.moving;
    if (!isValidPlacement(p.x, p.y, ignore)) {
      invalidPlacementFlash = 0.3;
      return;
    }
    const { kind, tierIndex, moving, rotation } = placementMode;
    if (moving) {
      moving.x = p.x;
      moving.y = p.y;
      if (kind === 'fence') moving.rotation = rotation;
    } else if (kind === 'fence') {
      fences.push(new Fence(p.x, p.y, tierIndex, rotation));
      defenseState.fencesPlaced += 1;
    } else {
      mines.push(new Mine(p.x, p.y, tierIndex));
      defenseState.minesPlaced += 1;
    }
    endPlacement();
    updateHud();
    renderDefenseItems();
  }

  // ---------- Selecting a placed defense (to move or upgrade it) ----------
  // Only reachable during the shop/prep phase with the shop panel closed — closing the panel
  // is how the player switches from "spend gold" to "walk the field and rework what's already down".
  function selectDefense(kind, ref) {
    selectedDefense = { kind, ref };
    const tiers = kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
    const tier = tiers[ref.tierIndex];
    el.defenseSelectTitle.textContent = `${tier.name} selected`;
    el.defenseSelectRotateBtn.classList.toggle('hidden', kind !== 'fence');
    const unlockedTierIndex = defenseState[kind === 'fence' ? 'fenceTier' : 'mineTier'];
    const canUpgrade = unlockedTierIndex > ref.tierIndex;
    el.defenseSelectUpgradeBtn.classList.toggle('hidden', !canUpgrade);
    if (canUpgrade) {
      const nextTier = tiers[unlockedTierIndex];
      el.defenseSelectUpgradeBtn.textContent = `Upgrade to ${nextTier.name} (${nextTier.cost}g)`;
      el.defenseSelectUpgradeBtn.disabled = gold < nextTier.cost;
    }
    el.defenseSelectBar.classList.remove('hidden');
  }

  function hideDefenseSelection() {
    selectedDefense = null;
    el.defenseSelectBar.classList.add('hidden');
  }

  function handleFieldTap(x, y) {
    for (const f of fences) {
      if (f.alive && dist(x, y, f.x, f.y) <= f.radius + 8) { selectDefense('fence', f); return; }
    }
    for (const m of mines) {
      if (m.alive && dist(x, y, m.x, m.y) <= m.radius + 8) { selectDefense('mine', m); return; }
    }
    hideDefenseSelection();
  }

  el.defenseSelectMoveBtn.addEventListener('click', () => {
    if (!selectedDefense) return;
    const { kind, ref } = selectedDefense;
    beginPlacement(kind, ref.tierIndex, ref);
  });

  el.defenseSelectRotateBtn.addEventListener('click', () => {
    if (!selectedDefense || selectedDefense.kind !== 'fence') return;
    const { ref } = selectedDefense;
    ref.rotation = (ref.rotation + ROTATE_STEP) % (Math.PI * 2);
  });

  el.defenseSelectUpgradeBtn.addEventListener('click', () => {
    if (!selectedDefense) return;
    const { kind, ref } = selectedDefense;
    const tiers = kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
    const unlockedTierIndex = defenseState[kind === 'fence' ? 'fenceTier' : 'mineTier'];
    if (unlockedTierIndex <= ref.tierIndex) return;
    const nextTier = tiers[unlockedTierIndex];
    if (gold < nextTier.cost) return;
    gold -= nextTier.cost;
    ref.tierIndex = unlockedTierIndex;
    if (kind === 'fence') {
      ref.maxHealth = nextTier.maxHealth;
      ref.health = nextTier.maxHealth;
      ref.slowRadius = nextTier.slowRadius;
      ref.slowMult = nextTier.slowMult;
    } else {
      ref.damage = nextTier.damage;
      ref.blastRadius = nextTier.blastRadius;
    }
    updateHud();
    selectDefense(kind, ref); // refresh the bar (now shows the new tier, or hides Upgrade if maxed)
  });

  el.defenseSelectCloseBtn.addEventListener('click', hideDefenseSelection);

  canvas.addEventListener('pointerdown', (e) => {
    if (placementMode) {
      handlePlacementTap(e.clientX, e.clientY);
      return;
    }
    if (state === 'shop' && shopHidden) {
      const p = input.toCanvasSpace(e.clientX, e.clientY);
      handleFieldTap(p.x, p.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!placementMode) return;
    placementCursor = input.toCanvasSpace(e.clientX, e.clientY);
  });

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

  /** A row of small dots showing how many of a capped upgrade you've bought vs. how many remain. */
  function pipsHtml(filled, total) {
    let dots = '';
    for (let i = 0; i < total; i++) {
      dots += `<span class="pip${i < filled ? ' filled' : ''}"></span>`;
    }
    return `<div class="upgrade-pips">${dots}</div>`;
  }

  function renderShopItems() {
    el.shopItems.innerHTML = '';
    for (const item of SHOP_CATALOG) {
      const cost = shop.costFor(item);
      const maxedOut = item.maxPurchases && shop.purchaseCounts[item.id] >= item.maxPurchases;
      const pips = item.maxPurchases ? pipsHtml(shop.purchaseCounts[item.id], item.maxPurchases) : '';
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `
        <div class="shop-item-info">
          <div class="shop-item-name">${item.name}${maxedOut ? ' (MAX)' : ''}</div>
          <div class="shop-item-desc">${item.desc}</div>
          ${pips}
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

  function startNextWave() {
    el.shopOverlay.classList.add('hidden');
    state = 'playing';
    waveManager.startNextWave();
    updateHud();
  }

  el.nextWaveBtn.addEventListener('click', startNextWave);

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
      fences: fences.map((f) => ({ x: f.x, y: f.y, health: f.health, maxHealth: f.maxHealth, tierIndex: f.tierIndex, rotation: f.rotation })),
      mines: mines.map((m) => ({ x: m.x, y: m.y, damage: m.damage, blastRadius: m.blastRadius, tierIndex: m.tierIndex })),
      defenseState: { ...defenseState },
      waveClearTimer,
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
    hitEffects = [];
    bloodPools = [];
    fences = (snapshot.fences || []).map((f) => {
      const fence = new Fence(f.x, f.y, f.tierIndex || 0, f.rotation || 0);
      fence.maxHealth = f.maxHealth;
      fence.health = f.health;
      return fence;
    });
    mines = (snapshot.mines || []).map((m) => {
      const mine = new Mine(m.x, m.y, m.tierIndex || 0);
      mine.damage = m.damage;
      mine.blastRadius = m.blastRadius;
      return mine;
    });
    defenseState = snapshot.defenseState
      ? { ...snapshot.defenseState }
      : { fenceTier: 0, mineTier: 0, fencesPlaced: fences.length, minesPlaced: mines.length };
    placementMode = null;
    placementCursor = null;
    invalidPlacementFlash = 0;
    damageFlash = 0;
    shopHidden = false;
    selectedDefense = null;
    el.defenseSelectBar.classList.add('hidden');
    waveClearTimer = snapshot.waveClearTimer || 0;

    gold = snapshot.gold;
    paused = false;
    el.gameoverOverlay.classList.add('hidden');

    if (snapshot.savedPhase === 'shop') {
      openShop(snapshot.wave === 0);
    } else {
      state = 'playing';
      el.shopOverlay.classList.add('hidden');
      el.reopenShopBtn.classList.add('hidden');
      el.fieldPrepPill.classList.add('hidden');
      setPauseButtonVisible(true);
      if (waveClearTimer > 0) {
        el.waveClearBanner.classList.remove('hidden');
        updateWaveClearBannerUI();
      }
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
    if (invalidPlacementFlash > 0) invalidPlacementFlash = Math.max(0, invalidPlacementFlash - dt);
    if (damageFlash > 0) damageFlash = Math.max(0, damageFlash - dt * 2.5);
    for (const fx of hitEffects) fx.update(dt);
    hitEffects = hitEffects.filter((f) => f.alive);
    for (const bp of bloodPools) bp.update(dt);
    bloodPools = bloodPools.filter((b) => b.alive);

    if (state === 'shop') {
      // The clock only runs while no placement UI is open, so placing defenses is never rushed.
      if (!placementMode) {
        prepCountdown -= dt;
        updatePrepCountdownUI();
        if (prepCountdown <= 0) startNextWave();
      }
      return;
    }

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
        damageFlash = Math.min(1, damageFlash + 0.35);
      } else if (dist(enemy.x, enemy.y, player.x, player.y) <= player.radius + enemy.radius) {
        player.takeDamage(enemy.damage);
        enemy.alive = false;
        damageFlash = Math.min(1, damageFlash + 0.5);
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
              if (!victim.alive) {
                gold += victim.reward;
                bloodPools.push(new BloodPool(victim.x, victim.y, victim.radius / 12));
              }
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
          const hitAngle = Math.atan2(bullet.vy, bullet.vx);
          hitEffects.push(new HitSpark(hitCenter.x, hitCenter.y, hitAngle, bullet.isCrit));
          hitEffects.push(new DamageNumber(hitCenter.x, hitCenter.y, bullet.damage, bullet.isCrit));
          if (!enemy.alive) {
            gold += enemy.reward;
            bloodPools.push(new BloodPool(enemy.x, enemy.y, enemy.radius / 12));
          }
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

    if (waveClearTimer > 0) {
      // The wave is already cleared and the bonus already paid out — this is just a beat to
      // let the last kill land before the shop interrupts.
      waveClearTimer -= dt;
      updateWaveClearBannerUI();
      if (waveClearTimer <= 0) {
        el.waveClearBanner.classList.add('hidden');
        waveManager.finishWave();
        openShop(false);
      }
    } else if (waveManager.isWaveCleared(enemies.length)) {
      gold += 10 + waveManager.waveNumber * 2; // wave-clear bonus, on top of per-kill gold
      waveClearTimer = WAVE_CLEAR_DELAY;
      el.waveClearBanner.classList.remove('hidden');
      updateWaveClearBannerUI();
    }

    updateHud();
  }

  function updateWaveClearBannerUI() {
    el.waveClearSeconds.textContent = Math.max(0, Math.ceil(waveClearTimer));
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
    ctx.fillStyle = 'rgba(40, 55, 30, 0.1)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mottled ground blotches — uneven, damp-looking dirt instead of a clean blueprint grid.
  // Fixed pseudo-random layout computed once at load, not regenerated per frame.
  const GROUND_BLOTCHES = Array.from({ length: 26 }, (_, i) => {
    const seed = i * 37.13;
    return {
      x: (Math.sin(seed) * 0.5 + 0.5) * bounds.width,
      y: (Math.sin(seed * 1.7 + 3) * 0.5 + 0.5) * bounds.height,
      r: 26 + (i % 5) * 12,
      dark: i % 3 === 0,
    };
  });

  function drawGroundBlotch(x, y, r, dark) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (dark) {
      grad.addColorStop(0, 'rgba(0,0,0,0.14)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      grad.addColorStop(0, 'rgba(60,48,40,0.14)');
      grad.addColorStop(1, 'rgba(60,48,40,0)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Old, long-dried blood — permanent stains from hunts past, distinct from the fresh pools
  // that accumulate during combat.
  const OLD_BLOOD_STAINS = [
    { x: 340, y: 260, r: 14, rot: 0.4 },
    { x: 610, y: 200, r: 10, rot: -0.6 },
    { x: 560, y: 400, r: 16, rot: 1.1 },
    { x: 260, y: 340, r: 9, rot: 0.2 },
  ];

  function drawOldBloodStain(x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(45, 6, 8, 0.28)';
    for (const [dx, dy, s] of [[0, 0, 1], [r * 0.7, r * 0.2, 0.55], [-r * 0.5, r * 0.4, 0.4], [r * 0.15, -r * 0.5, 0.35]]) {
      ctx.beginPath();
      ctx.ellipse(dx, dy, r * s, r * s * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const BONE_PILES = [
    { x: 420, y: 460 },
    { x: 800, y: 130 },
  ];

  function drawBonePile(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#d8cbb4';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2] of [[-10, 2, -2, -4], [4, 3, 12, -3], [-4, 4, 6, 2]]) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.fillStyle = '#e4d8c0';
    ctx.beginPath();
    ctx.arc(-6, -2, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0806';
    ctx.beginPath();
    ctx.arc(-7.6, -3, 1, 0, Math.PI * 2);
    ctx.arc(-4.4, -3, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawArenaBackground(time) {
    const grad = ctx.createLinearGradient(0, 0, 0, bounds.height);
    grad.addColorStop(0, '#1c1624');
    grad.addColorStop(0.55, '#120e18');
    grad.addColorStop(1, '#0a070e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    // Cold moonlight washing down from off-screen, opposing the warm brazier fire below.
    const moon = ctx.createRadialGradient(bounds.width * 0.5, -bounds.height * 0.3, 0, bounds.width * 0.5, -bounds.height * 0.3, bounds.height * 1.2);
    moon.addColorStop(0, 'rgba(140, 160, 200, 0.09)');
    moon.addColorStop(1, 'rgba(140, 160, 200, 0)');
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    for (const b of GROUND_BLOTCHES) drawGroundBlotch(b.x, b.y, b.r, b.dark);
    for (const m of MOSS_PATCHES) drawMoss(m.x, m.y, m.r);
    for (const c of GROUND_CRACKS) drawCrack(c.x, c.y, c.len, c.rot);
    for (const s of OLD_BLOOD_STAINS) drawOldBloodStain(s.x, s.y, s.r, s.rot);
    for (const b of BONE_PILES) drawBonePile(b.x, b.y);

    const flickers = BRAZIERS.map((b) => drawBrazierGlow(b.x, b.y, time));

    for (const t of TOMBSTONES) drawTombstone(t.x, t.y, t.scale, t.rot);
    for (const t of DEAD_TREES) drawDeadTree(t.x, t.y, t.scale, t.rot);
    drawCrypt(850, 300);

    BRAZIERS.forEach((b, i) => drawBrazier(b.x, b.y, flickers[i]));
  }

  // Slow-drifting fog wisps for atmosphere — cool and heavy, weighted toward the ground rather
  // than evenly scattered, like mist pooling in a graveyard rather than clean studio haze.
  const FOG = Array.from({ length: 14 }, (_, i) => ({
    x: (i * 137) % bounds.width,
    y: bounds.height * (0.45 + ((i * 71) % 100) / 180),
    r: 70 + (i % 4) * 24,
    vx: (i % 2 === 0 ? 1 : -1) * (5 + (i % 3) * 2.5),
    vy: (i % 3 === 0 ? 1 : -1) * (2 + (i % 2) * 1.5),
    alpha: 0.05 + (i % 3) * 0.02,
  }));

  function drawFog(dt) {
    // A static, ground-hugging haze beneath the drifting wisps — the lower the screen, the
    // murkier it gets, so feet and low terrain features go soft while faces stay readable.
    const groundMist = ctx.createLinearGradient(0, bounds.height * 0.5, 0, bounds.height);
    groundMist.addColorStop(0, 'rgba(130,140,150,0)');
    groundMist.addColorStop(1, 'rgba(130,140,150,0.12)');
    ctx.fillStyle = groundMist;
    ctx.fillRect(0, bounds.height * 0.5, bounds.width, bounds.height * 0.5);

    for (const f of FOG) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -f.r) f.x = bounds.width + f.r;
      if (f.x > bounds.width + f.r) f.x = -f.r;
      if (f.y < bounds.height * 0.4) f.y = bounds.height * 0.4;
      if (f.y > bounds.height + f.r) f.y = bounds.height * 0.4;

      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      grad.addColorStop(0, `rgba(120,130,138,${f.alpha})`);
      grad.addColorStop(1, 'rgba(120,130,138,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawVignette() {
    const grad = ctx.createRadialGradient(
      bounds.width / 2, bounds.height / 2, bounds.height * 0.24,
      bounds.width / 2, bounds.height / 2, bounds.height * 0.86
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.75, 'rgba(4,3,6,0.32)');
    grad.addColorStop(1, 'rgba(2,4,3,0.68)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
  }

  // Precomputed film-grain tile, drawn once and reused as a repeating pattern each frame —
  // cheap grit that keeps the scene from looking clean/digital.
  const grainCanvas = document.createElement('canvas');
  grainCanvas.width = 128;
  grainCanvas.height = 128;
  (function bakeGrain() {
    const gctx = grainCanvas.getContext('2d');
    const imgData = gctx.createImageData(128, 128);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = Math.random() * 255;
      imgData.data[i] = v;
      imgData.data[i + 1] = v;
      imgData.data[i + 2] = v;
      imgData.data[i + 3] = 255;
    }
    gctx.putImageData(imgData, 0, 0);
  })();
  const grainPattern = ctx.createPattern(grainCanvas, 'repeat');

  function drawGrain() {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
    ctx.restore();
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

  function drawPlacementPreview() {
    if (!placementMode || !placementCursor) return;
    const { x, y } = placementCursor;
    const valid = isValidPlacement(x, y, placementMode.moving);
    const tiers = placementMode.kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
    const previewRadius = placementMode.kind === 'fence'
      ? tiers[placementMode.tierIndex].slowRadius
      : tiers[placementMode.tierIndex].blastRadius;
    const glow = valid ? 'rgba(120, 220, 140,' : 'rgba(220, 70, 70,';
    ctx.save();
    ctx.strokeStyle = `${glow} 0.85)`;
    ctx.fillStyle = `${glow} 0.15)`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(x, y, previewRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    if (placementMode.kind === 'fence') {
      // Shows which way the panel will face, so a wall can be lined up before it's committed.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(placementMode.rotation);
      ctx.strokeStyle = `${glow} 0.95)`;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      const hw = FENCE_WIDTH / 2;
      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.lineTo(hw, 0);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = `${glow} 0.9)`;
    ctx.fill();
    ctx.restore();
  }

  function drawInvalidPlacementFlash() {
    if (invalidPlacementFlash <= 0 || !placementCursor) return;
    const t = invalidPlacementFlash / 0.3;
    ctx.save();
    ctx.globalAlpha = t;
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(placementCursor.x, placementCursor.y, 18 * (1.4 - t), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawDamageFlash() {
    if (damageFlash <= 0) return;
    ctx.save();
    ctx.globalAlpha = damageFlash * 0.45;
    const grad = ctx.createRadialGradient(
      bounds.width / 2, bounds.height / 2, bounds.height * 0.15,
      bounds.width / 2, bounds.height / 2, bounds.height * 0.75
    );
    grad.addColorStop(0, 'rgba(180, 10, 20, 0)');
    grad.addColorStop(1, 'rgba(180, 10, 20, 0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
    ctx.restore();
  }

  function drawDefenseSelectionRing() {
    if (!selectedDefense || !selectedDefense.ref.alive) return;
    const { ref } = selectedDefense;
    ctx.save();
    ctx.strokeStyle = 'rgba(224, 192, 104, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(ref.x, ref.y, ref.radius + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function render(dt) {
    drawArenaBackground(elapsed);
    for (const bp of bloodPools) bp.draw(ctx);
    drawFenceConnections(ctx, fences);
    for (const mine of mines) mine.draw(ctx, elapsed);
    for (const fence of fences) fence.draw(ctx);
    base.draw(ctx, elapsed);
    for (const enemy of enemies) enemy.draw(ctx);
    for (const bullet of bullets) bullet.draw(ctx, elapsed);
    if (state !== 'gameover') player.draw(ctx, elapsed);
    for (const ex of explosions) ex.draw(ctx);
    for (const fx of hitEffects) fx.draw(ctx);
    drawDefenseSelectionRing();
    drawPlacementPreview();
    drawInvalidPlacementFlash();

    if (state === 'playing') {
      drawStick(input.moveStick, 'rgba(79, 220, 111, 0.9)');
      drawStick(input.aimStick, 'rgba(255, 95, 95, 0.9)');
    }

    drawFog(dt);
    drawDamageFlash();
    drawVignette();
    drawGrain();
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
    debugSetGold: (g) => {
      gold = g;
      updateHud();
      if (state === 'shop') { renderShopItems(); renderWeaponItems(); renderDefenseItems(); }
    },
    debugSpawn: (typeKey, x, y) => { enemies.push(new Enemy(x, y, typeKey, 1)); },
    debugForceWaveClear: () => { enemies = []; waveManager.spawnQueue = []; },
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
      fences: fences.map((f) => ({ x: f.x, y: f.y, health: f.health, maxHealth: f.maxHealth, tierIndex: f.tierIndex, rotation: f.rotation })),
      mines: mines.map((m) => ({ x: m.x, y: m.y, damage: m.damage, blastRadius: m.blastRadius, tierIndex: m.tierIndex })),
      defenseState: { ...defenseState },
      placementMode: placementMode ? { kind: placementMode.kind, tierIndex: placementMode.tierIndex, moving: !!placementMode.moving, rotation: placementMode.rotation } : null,
      prepCountdown,
      shopHidden,
      waveClearTimer,
      selectedDefense: selectedDefense ? { kind: selectedDefense.kind, x: selectedDefense.ref.x, y: selectedDefense.ref.y, tierIndex: selectedDefense.ref.tierIndex, rotation: selectedDefense.ref.rotation } : null,
      moveStick: { active: input.moveStick.active, ...input.moveStick.read() },
      aimStick: { active: input.aimStick.active, ...input.aimStick.read() },
    }),
    debugBeginPlacement: (kind, tierIndex) => beginPlacement(kind, tierIndex),
    debugPlaceAt: (x, y) => placeAt(x, y),
    debugSetPrepCountdown: (s) => { prepCountdown = s; },
    debugSetWaveClearTimer: (s) => { waveClearTimer = s; },
    debugViewField: () => el.viewFieldBtn.click(),
    debugReopenShop: () => el.reopenShopBtn.click(),
    debugSelectFieldTap: (x, y) => handleFieldTap(x, y),
    debugMoveSelected: () => el.defenseSelectMoveBtn.click(),
    debugUpgradeSelected: () => el.defenseSelectUpgradeBtn.click(),
    debugRotateSelected: () => el.defenseSelectRotateBtn.click(),
    debugRotatePlacement: () => el.placementRotateBtn.click(),
  };
})();
