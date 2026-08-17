// Game orchestration: input handling, main loop, state machine, and DOM/HUD wiring.

(function () {
  const canvas = document.getElementById('game-canvas');
  const fxCanvas = document.getElementById('fx-canvas');
  const fx = fxCanvas.getContext('2d');
  const bounds = { width: canvas.width, height: canvas.height };
  const input = new InputManager(canvas, bounds);

  // Render at native device pixel density so text/lines on the 2D overlay stay crisp on
  // phones, while all game math keeps using the logical 960x540 `bounds` above. The WebGL
  // canvas manages its own backing-buffer sizing (Renderer3D below); this HiDPI setup is only
  // for the 2D overlay canvas's own context.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  fxCanvas.width = bounds.width * dpr;
  fxCanvas.height = bounds.height * dpr;
  fx.scale(dpr, dpr);

  const renderer3d = new Renderer3D(canvas, bounds, dpr);

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
    updateViewFieldBadge();
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
        name: `Research: ${nextTier.name}`,
        desc: `${describe(nextTier)} Unlocks it for new placements — upgrade ones you've already placed via View Field.`,
        maxed: false,
        cost: nextTier.unlockCost,
        onBuy: () => { defenseState[tierKey] += 1; },
      });
    }
  }

  /** True once at least one placed fence/mine is behind a tier the player has already researched. */
  function hasUpgradableDefense() {
    return fences.some((f) => f.alive && f.tierIndex < defenseState.fenceTier) ||
      mines.some((m) => m.alive && m.tierIndex < defenseState.mineTier);
  }

  function updateViewFieldBadge() {
    document.getElementById('view-field-badge').classList.toggle('hidden', !hasUpgradableDefense());
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
      if (dist(x, y, m.x, m.y) < 30) return false;
    }
    return true;
  }

  function handlePlacementTap(clientX, clientY) {
    if (!placementMode) return;
    const p = input.toCanvasSpace(clientX, clientY);
    const ground = renderer3d.screenToGround(p.x, p.y);
    if (ground) placeAt(ground.x, ground.y);
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
    updateViewFieldBadge();
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
      const ground = renderer3d.screenToGround(p.x, p.y);
      if (ground) handleFieldTap(ground.x, ground.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!placementMode) return;
    const p = input.toCanvasSpace(e.clientX, e.clientY);
    const ground = renderer3d.screenToGround(p.x, p.y);
    if (ground) placementCursor = ground;
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

    // Desktop mouse-aim needs the player's on-screen (projected) position, not its logical
    // world position — those only coincided in the old straight-down 2D camera. Touch aim is
    // unaffected: the aim joystick works purely off its own drag vector, no projection involved.
    const playerScreen = renderer3d.worldToScreen(player.x, player.y, 20);
    const control = input.getControlState(playerScreen.x, playerScreen.y, player.aimAngle);
    player.update(dt, control, bounds);
    if (control.firing) {
      bullets.push(...player.tryFire());
    }

    for (const b of bullets) b.update(dt, bounds);
    bullets = bullets.filter((b) => b.alive);

    const spawned = waveManager.update(dt, enemies.length);
    if (spawned) enemies.push(spawned);

    for (const enemy of enemies) {
      // Each enemy heads for a target it was assigned at spawn (see Enemy.targetPreference) —
      // some hunt the player, some siege the ward — so both are under real, simultaneous
      // pressure instead of the whole wave always dogpiling onto whichever is a step closer.
      // It'll still get opportunistically distracted if the *other* target is right on top of it.
      const distToPlayer = dist(enemy.x, enemy.y, player.x, player.y);
      const distToBase = dist(enemy.x, enemy.y, base.x, base.y);
      let target = enemy.targetPreference === 'base' ? base : player;
      const preferredDist = target === base ? distToBase : distToPlayer;
      const otherDist = target === base ? distToPlayer : distToBase;
      if (otherDist < preferredDist * 0.5) target = target === base ? player : base;

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

      // Contact is sustained, not a one-shot suicide hit: an enemy that reaches the ward or the
      // hunter keeps landing damage on a cooldown until something (the player) actually kills it.
      if (dist(enemy.x, enemy.y, base.x, base.y) <= base.radius + enemy.radius) {
        if (enemy._attackCooldown <= 0) {
          base.takeDamage(enemy.damage);
          enemy._attackCooldown = ENEMY_ATTACK_INTERVAL;
          damageFlash = Math.min(1, damageFlash + 0.35);
        }
      } else if (dist(enemy.x, enemy.y, player.x, player.y) <= player.radius + enemy.radius) {
        if (enemy._attackCooldown <= 0) {
          player.takeDamage(enemy.damage);
          enemy._attackCooldown = ENEMY_ATTACK_INTERVAL;
          damageFlash = Math.min(1, damageFlash + 0.5);
        }
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
          const hitHeight = enemy.radius * 1.45;
          hitEffects.push(new HitSpark(enemy.x, enemy.y, hitHeight, hitAngle, bullet.isCrit));
          hitEffects.push(new DamageNumber(enemy.x, enemy.y, hitHeight, bullet.damage, bullet.isCrit));
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
  // ---------- Render: sync live game state into the 3D scene, then draw 2D screen-space overlays ----------
  // Renderer3D (src/render3d.js) owns the actual 3D scene, lighting, models, and static
  // environment; this file just feeds it live entity state each frame via its sync*() methods.
  // A few things stay flat 2D on the fx-canvas overlay instead of becoming 3D geometry —
  // joysticks, damage numbers, and placement/selection ground-plane UI — since they're either
  // pure screen UI or read more crisply as text/shapes projected from a world position than as
  // extra meshes to manage.

  function drawStick(stick, color) {
    if (!stick.active) return;
    fx.save();
    fx.strokeStyle = color;
    fx.fillStyle = color;
    fx.lineWidth = 2;
    fx.globalAlpha = 0.9;
    fx.beginPath();
    fx.arc(stick.originX, stick.originY, JOYSTICK_MAX_RADIUS, 0, Math.PI * 2);
    fx.stroke();
    fx.globalAlpha = 0.55;
    fx.beginPath();
    fx.arc(stick.curX, stick.curY, 22, 0, Math.PI * 2);
    fx.fill();
    fx.restore();
  }

  /** Approximate on-screen pixel radius for a circle of `worldRadius` centered at ground (x, y),
   *  found by projecting the center and an offset point and measuring the projected distance.
   *  Not exact under perspective, but close enough for UI ghosts at this camera's steep angle. */
  function screenRadiusAt(x, y, worldRadius) {
    const center = renderer3d.worldToScreen(x, y);
    const edge = renderer3d.worldToScreen(x + worldRadius, y);
    return Math.hypot(edge.x - center.x, edge.y - center.y);
  }

  function drawPlacementPreview() {
    if (!placementMode || !placementCursor) return;
    const { x, y } = placementCursor;
    const valid = isValidPlacement(x, y, placementMode.moving);
    const tiers = placementMode.kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
    const worldRadius = placementMode.kind === 'fence'
      ? tiers[placementMode.tierIndex].slowRadius
      : tiers[placementMode.tierIndex].blastRadius;
    const p = renderer3d.worldToScreen(x, y);
    const r = screenRadiusAt(x, y, worldRadius);
    const glow = valid ? 'rgba(120, 220, 140,' : 'rgba(220, 70, 70,';
    fx.save();
    fx.strokeStyle = `${glow} 0.85)`;
    fx.fillStyle = `${glow} 0.15)`;
    fx.lineWidth = 2;
    fx.setLineDash([5, 4]);
    fx.beginPath();
    fx.arc(p.x, p.y, r, 0, Math.PI * 2);
    fx.fill();
    fx.stroke();
    fx.setLineDash([]);

    if (placementMode.kind === 'fence') {
      // A short line through the ghost showing which way the panel will face once placed,
      // matching the same rotation-to-world mapping Renderer3D.syncFences uses.
      const hw = FENCE_WIDTH / 2;
      const rot = placementMode.rotation;
      const a = renderer3d.worldToScreen(x + Math.cos(rot) * hw, y - Math.sin(rot) * hw);
      const b = renderer3d.worldToScreen(x - Math.cos(rot) * hw, y + Math.sin(rot) * hw);
      fx.strokeStyle = `${glow} 0.95)`;
      fx.lineWidth = 4;
      fx.lineCap = 'round';
      fx.beginPath();
      fx.moveTo(a.x, a.y);
      fx.lineTo(b.x, b.y);
      fx.stroke();
    }

    fx.beginPath();
    fx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    fx.fillStyle = `${glow} 0.9)`;
    fx.fill();
    fx.restore();
  }

  function drawInvalidPlacementFlash() {
    if (invalidPlacementFlash <= 0 || !placementCursor) return;
    const t = invalidPlacementFlash / 0.3;
    const p = renderer3d.worldToScreen(placementCursor.x, placementCursor.y);
    fx.save();
    fx.globalAlpha = t;
    fx.strokeStyle = 'rgba(255, 60, 60, 0.9)';
    fx.lineWidth = 2.5;
    fx.beginPath();
    fx.arc(p.x, p.y, 18 * (1.4 - t), 0, Math.PI * 2);
    fx.stroke();
    fx.restore();
  }

  function drawDamageFlash() {
    if (damageFlash <= 0) return;
    fx.save();
    fx.globalAlpha = damageFlash * 0.45;
    const grad = fx.createRadialGradient(
      bounds.width / 2, bounds.height / 2, bounds.height * 0.15,
      bounds.width / 2, bounds.height / 2, bounds.height * 0.75
    );
    grad.addColorStop(0, 'rgba(180, 10, 20, 0)');
    grad.addColorStop(1, 'rgba(180, 10, 20, 0.9)');
    fx.fillStyle = grad;
    fx.fillRect(0, 0, bounds.width, bounds.height);
    fx.restore();
  }

  function drawDefenseSelectionRing() {
    if (!selectedDefense || !selectedDefense.ref.alive) return;
    const { ref } = selectedDefense;
    const p = renderer3d.worldToScreen(ref.x, ref.y);
    const r = screenRadiusAt(ref.x, ref.y, ref.radius + 8);
    fx.save();
    fx.strokeStyle = 'rgba(224, 192, 104, 0.9)';
    fx.lineWidth = 2;
    fx.setLineDash([4, 3]);
    fx.beginPath();
    fx.arc(p.x, p.y, r, 0, Math.PI * 2);
    fx.stroke();
    fx.setLineDash([]);
    fx.restore();
  }

  function drawDamageNumbers() {
    for (const e of hitEffects) {
      if (!(e instanceof DamageNumber)) continue;
      const t = clamp(e.age / e.maxAge, 0, 1);
      const rise = 24 * t;
      const p = renderer3d.worldToScreen(e.x, e.y, e.height + rise);
      fx.save();
      fx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      fx.font = e.isCrit ? 'bold 15px Georgia, serif' : '12px Georgia, serif';
      fx.textAlign = 'center';
      fx.fillStyle = e.isCrit ? '#ff3c3c' : '#d8ccc0';
      fx.strokeStyle = 'rgba(5,3,4,0.9)';
      fx.lineWidth = 3;
      const label = e.isCrit ? `${e.text}!` : e.text;
      fx.strokeText(label, p.x, p.y);
      fx.fillText(label, p.x, p.y);
      fx.restore();
    }
  }

  function render(dt) {
    renderer3d.setPlayerVisible(state !== 'gameover');
    renderer3d.syncPlayer(player);
    renderer3d.syncEnemies(enemies);
    renderer3d.syncBullets(bullets);
    renderer3d.syncFences(fences);
    renderer3d.syncMines(mines, elapsed);
    renderer3d.syncExplosions(explosions);
    renderer3d.syncBloodPools(bloodPools);
    renderer3d.syncHitSparks(hitEffects);
    renderer3d.syncBase(base, elapsed);
    renderer3d.tickEnvironment(elapsed);
    renderer3d.render();

    fx.clearRect(0, 0, bounds.width, bounds.height);
    drawDamageNumbers();
    drawDefenseSelectionRing();
    drawPlacementPreview();
    drawInvalidPlacementFlash();

    if (state === 'playing') {
      drawStick(input.moveStick, 'rgba(79, 220, 111, 0.9)');
      drawStick(input.aimStick, 'rgba(255, 95, 95, 0.9)');
    }

    drawDamageFlash();
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
      enemies: enemies.map((e) => ({ x: e.x, y: e.y, health: e.health, radius: e.radius, hitCenter: e.getHitCenter(), hitRadius: e.hitRadius, attackCooldown: e._attackCooldown, isMoving: e._isMoving, targetPreference: e.targetPreference })),
      bullets: bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, radius: b.radius, pierceRemaining: b.pierceRemaining, weaponType: b.weaponType })),
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
