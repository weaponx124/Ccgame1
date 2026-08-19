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
  const audio = new AudioManager();

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
    muteBtn: document.getElementById('mute-btn'),
    fpsCounter: document.getElementById('fps-counter'),
    bossHealthBar: document.getElementById('boss-health-bar'),
    bossHealthName: document.getElementById('boss-health-name'),
    bossHealthFill: document.getElementById('boss-health-fill'),
    bossWarning: document.getElementById('boss-warning'),
    bossWarningName: document.getElementById('boss-warning-name'),
    bossWarningSecs: document.getElementById('boss-warning-secs'),
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
    defenseSelectRepairBtn: document.getElementById('defense-select-repair-btn'),
    defenseSelectUpgradeBtn: document.getElementById('defense-select-upgrade-btn'),
    defenseSelectCloseBtn: document.getElementById('defense-select-close-btn'),
    marksAmount: document.getElementById('marks-amount'),
    loadoutItems: document.getElementById('loadout-items'),
    checkpointSection: document.getElementById('checkpoint-section'),
    checkpointItems: document.getElementById('checkpoint-items'),
    marksEarned: document.getElementById('marks-earned'),
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
  // Drag-to-lay-a-run-of-fences state (separate from placementMode: this is a press-drag-release
  // gesture, not a single tap-to-commit). start is null while armed but not yet touched; once set,
  // a drag is in progress and end tracks the live pointer position until release commits it.
  let fenceDraw; // null | { tierIndex, start: {x,y}|null, end: {x,y}|null }
  let invalidPlacementFlash; // seconds remaining on the "can't place here" marker
  let prepCountdown; // seconds remaining in the current shop/prep phase
  let damageFlash; // 0..1, screen-tint intensity that decays after the player/base is hit
  let shopHidden; // true while the shop panel is manually closed during prep to inspect the field
  let selectedDefense; // null | { kind: 'fence'|'mine', ref } — a placed item picked for move/upgrade
  let waveClearTimer; // seconds remaining showing the "Wave Cleared" banner before the shop opens
  let gold;

  // ---------- Meta-progression (persists across runs, independent of the mid-run save) ----------
  let meta = loadMeta();
  let selectedStartWeapon = 'crossbow'; // chosen on the start screen; must be in meta.unlockedLoadouts
  let selectedStartMode = 'fresh'; // 'fresh' | 'checkpoint' — which start-screen option is active

  /** The highest wave checkpoint unlocked so far (by clearing a boss wave), or null if none yet. */
  function highestCheckpoint() {
    return meta.unlockedCheckpoints.length ? Math.max(...meta.unlockedCheckpoints) : null;
  }

  /** Starting-gold stipend for a checkpoint start: the exact gold a full clear of waves
   *  1..clearedThroughWave actually pays out (every kill reward plus every wave-clear bonus —
   *  see WaveManager.waveGoldValue), so a checkpoint run starts genuinely geared like a run that
   *  played through to that point, without touching enemy scaling, which is already a pure
   *  function of wave number. */
  function checkpointStipend(clearedThroughWave) {
    let total = 0;
    for (let i = 1; i <= clearedThroughWave; i++) total += waveManager.waveGoldValue(i);
    return total;
  }

  function renderMetaPanel() {
    el.marksAmount.textContent = meta.marks;

    el.loadoutItems.innerHTML = '';
    for (const id of WEAPON_ORDER) {
      const weapon = WEAPON_TYPES[id];
      const owned = meta.unlockedLoadouts.includes(id);
      const selected = selectedStartWeapon === id;
      const row = document.createElement('div');
      row.className = 'shop-item' + (selected ? ' selected' : '');
      row.innerHTML = `
        <div class="shop-item-info">
          <div class="shop-item-name">${weapon.name}${selected ? ' (Selected)' : ''}</div>
          <div class="shop-item-desc">${weapon.desc}</div>
        </div>
        <button class="shop-item-buy">${owned ? (selected ? 'Selected' : 'Select') : weapon.startUnlockCost + ' marks'}</button>
      `;
      const btn = row.querySelector('button');
      if (selected) {
        btn.disabled = true;
      } else if (!owned) {
        btn.disabled = meta.marks < weapon.startUnlockCost;
      }
      btn.addEventListener('click', () => {
        if (selected) return;
        if (!owned) {
          if (meta.marks < weapon.startUnlockCost) return;
          meta.marks -= weapon.startUnlockCost;
          meta.unlockedLoadouts.push(id);
          saveMeta(meta);
        }
        audio.buttonClick();
        selectedStartWeapon = id;
        renderMetaPanel();
      });
      el.loadoutItems.appendChild(row);
    }

    const checkpoint = highestCheckpoint();
    el.checkpointSection.classList.toggle('hidden', !checkpoint);
    el.checkpointItems.innerHTML = '';
    if (checkpoint) {
      const options = [
        { mode: 'fresh', name: 'Fresh Start', desc: 'Begin at wave 1, no stipend.' },
        {
          mode: 'checkpoint',
          name: `Skip to Wave ${checkpoint}`,
          desc: `Unlocked by clearing wave ${checkpoint - 1}. Starts geared with a ${checkpointStipend(checkpoint - 1)}g stipend.`,
        },
      ];
      for (const opt of options) {
        const selected = selectedStartMode === opt.mode;
        const row = document.createElement('div');
        row.className = 'shop-item' + (selected ? ' selected' : '');
        row.innerHTML = `
          <div class="shop-item-info">
            <div class="shop-item-name">${opt.name}${selected ? ' (Selected)' : ''}</div>
            <div class="shop-item-desc">${opt.desc}</div>
          </div>
          <button class="shop-item-buy" ${selected ? 'disabled' : ''}>${selected ? 'Selected' : 'Choose'}</button>
        `;
        row.querySelector('button').addEventListener('click', () => {
          if (selected) return;
          audio.buttonClick();
          selectedStartMode = opt.mode;
          renderMetaPanel();
        });
        el.checkpointItems.appendChild(row);
      }
    } else {
      selectedStartMode = 'fresh';
    }
  }

  function setPauseButtonVisible(visible) {
    el.pauseBtn.classList.toggle('hidden', !visible);
    el.weaponSwitchBtn.classList.toggle('hidden', !visible);
  }

  el.muteBtn.addEventListener('click', () => {
    audio.unlock(); // in case this is literally the player's first interaction with the page
    const muted = audio.toggleMuted();
    el.muteBtn.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    el.muteBtn.classList.toggle('muted', muted);
  });

  function resetGame() {
    const useCheckpoint = selectedStartMode === 'checkpoint' && highestCheckpoint();
    const startWave = useCheckpoint ? highestCheckpoint() - 1 : 0;
    const startWeapon = meta.unlockedLoadouts.includes(selectedStartWeapon) ? selectedStartWeapon : 'crossbow';

    player = new Player(bounds.width / 2, bounds.height / 2 + 120);
    player.unlockedWeapons = [startWeapon];
    player.equippedWeapon = startWeapon;
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
    fenceDraw = null;
    invalidPlacementFlash = 0;
    damageFlash = 0;
    shopHidden = false;
    selectedDefense = null;
    waveClearTimer = 0;
    el.waveClearBanner.classList.add('hidden');
    el.defenseSelectBar.classList.add('hidden');
    el.reopenShopBtn.classList.add('hidden');
    el.fieldPrepPill.classList.add('hidden');
    gold = 20 + (useCheckpoint ? checkpointStipend(startWave) : 0); // base stake, plus checkpoint stipend if skipping ahead
    state = 'shop';
    waveManager.waveNumber = startWave; // startNextWave will bump this to startWave + 1
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
    audio.menuClose();
    shopHidden = true;
    el.shopOverlay.classList.add('hidden');
    el.reopenShopBtn.classList.remove('hidden');
    el.fieldPrepPill.classList.remove('hidden');
    updatePrepCountdownUI();
  });

  el.reopenShopBtn.addEventListener('click', () => {
    audio.menuOpen();
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

    if (kind === 'fence') {
      // Fences don't have a single fixed price to pay up front — you drag out a run of them and
      // pay per segment as you go (see beginFenceDraw), so this row arms that mode instead of
      // charging immediately. `cost` still gates the button (need at least one segment's worth).
      appendDefenseRow({
        name: `${tier.name} — Lv ${tierIndex + 1}/${tiers.length}`,
        desc: `${describe(tier)} Drag along the battlefield to lay a run of them — start near an existing fence to connect the two. ${placed}/${maxTotal} placed.`,
        maxed: placedMaxed,
        cost: tier.cost,
        costLabel: `${tier.cost}g each`,
        deferred: true,
        onBuy: () => beginFenceDraw(tierIndex),
      });
    } else {
      appendDefenseRow({
        name: `${tier.name} — Lv ${tierIndex + 1}/${tiers.length}`,
        desc: `${describe(tier)} ${placed}/${maxTotal} placed.`,
        maxed: placedMaxed,
        cost: tier.cost,
        onBuy: () => beginPlacement(kind, tierIndex),
      });
    }

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

  function appendDefenseRow({ name, desc, maxed, cost, costLabel, onBuy, deferred = false }) {
    const row = document.createElement('div');
    row.className = 'shop-item';
    row.innerHTML = `
      <div class="shop-item-info">
        <div class="shop-item-name">${name}${maxed ? ' (MAX)' : ''}</div>
        <div class="shop-item-desc">${desc}</div>
      </div>
      <button class="shop-item-buy" ${maxed ? 'disabled' : ''}>${maxed ? 'MAX' : (costLabel || cost + 'g')}</button>
    `;
    const btn = row.querySelector('button');
    btn.disabled = btn.disabled || gold < cost;
    btn.addEventListener('click', () => {
      if (gold < cost || maxed) return;
      // Deferred rows (fence draw mode) don't charge here — payment happens per segment as the
      // drag is committed, since the final price isn't known until then.
      if (!deferred) {
        audio.purchase();
        gold -= cost;
      }
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

  let placementArmedAt = 0;

  function beginPlacement(kind, tierIndex, moving = null) {
    placementMode = { kind, tierIndex, moving, rotation: moving ? moving.rotation : 0 };
    placementCursor = null;
    placementArmedAt = performance.now();
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
    audio.buttonClick();
    placementMode.rotation = (placementMode.rotation + ROTATE_STEP) % (Math.PI * 2);
  });

  function endPlacement() {
    placementMode = null;
    placementCursor = null;
    fenceDraw = null;
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
    if (!placementMode && !fenceDraw) return;
    audio.buttonClick();
    if (placementMode && !placementMode.moving) {
      const tiers = placementMode.kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
      gold += tiers[placementMode.tierIndex].cost; // refund — it was paid up front
    }
    // fenceDraw needs no refund: gold is only ever spent on commit (see commitFenceDraw), never
    // up front, so cancelling mid-drag (or before the first touch) simply spends nothing.
    endPlacement();
    updateHud();
    renderDefenseItems();
  });

  // ---------- Drag-to-lay-a-run-of-fences ----------
  function beginFenceDraw(tierIndex) {
    fenceDraw = { tierIndex, start: null, end: null };
    placementArmedAt = performance.now(); // reuses the same stray-tap guard as beginPlacement
    el.shopOverlay.classList.add('hidden');
    el.reopenShopBtn.classList.add('hidden');
    el.fieldPrepPill.classList.add('hidden');
    hideDefenseSelection();
    el.placementBar.classList.remove('hidden');
    el.placementRotateBtn.classList.add('hidden'); // orientation follows the drag direction, not manual rotation
    const tier = FENCE_TIERS[tierIndex];
    el.placementPrompt.textContent = `Press and drag along the battlefield to lay a run of ${tier.name} — ${tier.cost}g each.`;
    input.setSuspended(true);
  }

  /** Pure preview/commit computation shared by the live drag ghost and the actual commit: walks
   *  evenly-spaced candidate points (FENCE_WIDTH apart, so panels sit edge-to-edge with no gaps)
   *  from start to end, skipping any that land somewhere invalid (an existing fence/mine, the
   *  ward, or off-field — the run gets a gap there rather than aborting entirely) and stopping
   *  once gold or the FENCE_MAX budget runs out, so a preview never promises more than the
   *  player can actually afford to commit. */
  function computeFenceLine(tierIndex, start, end) {
    const tier = FENCE_TIERS[tierIndex];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lineLen = Math.hypot(dx, dy);
    const spacing = FENCE_WIDTH;
    const count = Math.max(1, Math.round(lineLen / spacing) + 1);
    const rotation = -Math.atan2(dy, dx); // yawFromAngle convention — panel width runs along the drag
    const maxAffordable = Math.floor(gold / tier.cost);
    const maxByBudget = FENCE_MAX - defenseState.fencesPlaced;
    const segments = [];
    let placedCount = 0;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const x = start.x + dx * t;
      const y = start.y + dy * t;
      const valid = isValidPlacement(x, y, null);
      const capped = placedCount >= maxAffordable || placedCount >= maxByBudget;
      const affordable = valid && !capped;
      segments.push({ x, y, valid, affordable });
      if (affordable) placedCount += 1;
      else if (valid) break; // hit the gold/budget cap — no point drawing further ghosts past it
    }
    return { segments, rotation, placedCount, totalCost: placedCount * tier.cost };
  }

  /** If a touch starting a new fence drag lands near an existing alive fence (within
   *  FENCE_CONNECT_DIST), snap it to sit exactly FENCE_WIDTH away — flush against that fence, in
   *  whichever direction the touch came from — so extending a previous run connects cleanly
   *  instead of needing a pixel-perfect drag start on a touchscreen. Falls back to continuing
   *  along the existing fence's own line if the touch landed almost exactly on top of it. */
  function snapToNearbyFence(point) {
    let nearest = null;
    let nearestDist = FENCE_CONNECT_DIST;
    for (const fence of fences) {
      if (!fence.alive) continue;
      const d = dist(point.x, point.y, fence.x, fence.y);
      if (d < nearestDist) { nearest = fence; nearestDist = d; }
    }
    if (!nearest) return point;
    const angle = nearestDist < 1 ? -nearest.rotation : Math.atan2(point.y - nearest.y, point.x - nearest.x);
    return { x: nearest.x + Math.cos(angle) * FENCE_WIDTH, y: nearest.y + Math.sin(angle) * FENCE_WIDTH };
  }

  function commitFenceDraw() {
    if (!fenceDraw || !fenceDraw.start) { fenceDraw = null; endPlacement(); return; }
    const { tierIndex, start, end } = fenceDraw;
    const { segments, rotation } = computeFenceLine(tierIndex, start, end);
    let placed = 0;
    for (const seg of segments) {
      if (!seg.affordable) continue;
      fences.push(new Fence(seg.x, seg.y, tierIndex, rotation));
      defenseState.fencesPlaced += 1;
      gold -= FENCE_TIERS[tierIndex].cost;
      placed += 1;
    }
    if (placed > 0) audio.purchase(); // one confirm chime for the whole run, not per-segment spam
    endPlacement();
    updateHud();
    renderDefenseItems();
  }

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
    // On touch devices, the same physical tap that hits the shop's "Buy" button (while the shop
    // overlay is still covering the canvas) can generate a stray follow-up pointer event that
    // lands on the canvas an instant later, right after beginPlacement() hides the overlay and
    // arms this cursor — reads as the fence "placing itself" at whatever that stray tap's
    // coordinates happen to be, before the player ever gets to choose a spot. A real placement
    // tap is never this fast, so ignore anything within a beat of arming.
    if (performance.now() - placementArmedAt < 350) return;
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
    audio.buttonClick();
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
  /** Repairing costs a fraction of the tier's placement price proportional to what's actually
   *  missing — patching a nearly-full fence is cheap, rebuilding one from near-zero HP costs
   *  close to the full placement price. Only fences have ongoing health worth repairing; mines
   *  are one-shot triggers with no health field at all. */
  function repairCost(fence) {
    const tier = FENCE_TIERS[fence.tierIndex];
    const missingFrac = 1 - fence.health / fence.maxHealth;
    return Math.max(1, Math.ceil(tier.cost * missingFrac));
  }

  function selectDefense(kind, ref) {
    selectedDefense = { kind, ref };
    const tiers = kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
    const tier = tiers[ref.tierIndex];
    el.defenseSelectTitle.textContent = `${tier.name} selected`;
    el.defenseSelectRotateBtn.classList.toggle('hidden', kind !== 'fence');

    const canRepair = kind === 'fence' && ref.health < ref.maxHealth;
    el.defenseSelectRepairBtn.classList.toggle('hidden', !canRepair);
    if (canRepair) {
      const cost = repairCost(ref);
      el.defenseSelectRepairBtn.textContent = `Repair (${cost}g)`;
      el.defenseSelectRepairBtn.disabled = gold < cost;
    }

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

  // A tap has to land within this many *logical* px of a placed item's edge to select it. Generous
  // on purpose: a real fingertip is nowhere near pixel-precise, and now that items are viewed under
  // a 3D perspective camera instead of a flat top-down 2D view, judging exactly where their ground
  // anchor sits is much harder than it used to be — the old +8 padding measured out to roughly a
  // 20px-diameter touch target on a real phone, well under any usable minimum.
  const FIELD_TAP_PAD = 34;

  function handleFieldTap(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const f of fences) {
      if (!f.alive) continue;
      const d = dist(x, y, f.x, f.y);
      if (d <= f.radius + FIELD_TAP_PAD && d < bestDist) { best = { kind: 'fence', ref: f }; bestDist = d; }
    }
    for (const m of mines) {
      if (!m.alive) continue;
      const d = dist(x, y, m.x, m.y);
      if (d <= m.radius + FIELD_TAP_PAD && d < bestDist) { best = { kind: 'mine', ref: m }; bestDist = d; }
    }
    if (best) selectDefense(best.kind, best.ref);
    else hideDefenseSelection();
  }

  el.defenseSelectMoveBtn.addEventListener('click', () => {
    if (!selectedDefense) return;
    audio.buttonClick();
    const { kind, ref } = selectedDefense;
    beginPlacement(kind, ref.tierIndex, ref);
  });

  el.defenseSelectRotateBtn.addEventListener('click', () => {
    if (!selectedDefense || selectedDefense.kind !== 'fence') return;
    audio.buttonClick();
    const { ref } = selectedDefense;
    ref.rotation = (ref.rotation + ROTATE_STEP) % (Math.PI * 2);
  });

  el.defenseSelectRepairBtn.addEventListener('click', () => {
    if (!selectedDefense || selectedDefense.kind !== 'fence') return;
    const { ref } = selectedDefense;
    if (ref.health >= ref.maxHealth) return;
    const cost = repairCost(ref);
    if (gold < cost) return;
    audio.purchase();
    gold -= cost;
    ref.health = ref.maxHealth;
    updateHud();
    selectDefense('fence', ref); // refresh the bar — Repair hides now that it's full
  });

  el.defenseSelectUpgradeBtn.addEventListener('click', () => {
    if (!selectedDefense) return;
    const { kind, ref } = selectedDefense;
    const tiers = kind === 'fence' ? FENCE_TIERS : MINE_TIERS;
    const unlockedTierIndex = defenseState[kind === 'fence' ? 'fenceTier' : 'mineTier'];
    if (unlockedTierIndex <= ref.tierIndex) return;
    const nextTier = tiers[unlockedTierIndex];
    if (gold < nextTier.cost) return;
    audio.purchase();
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

  el.defenseSelectCloseBtn.addEventListener('click', () => { audio.buttonClick(); hideDefenseSelection(); });

  canvas.addEventListener('pointerdown', (e) => {
    if (fenceDraw) {
      // Same stray-tap guard as handlePlacementTap: the touch that hit the shop's "Buy" row can
      // generate a follow-up pointerdown on the canvas an instant later, right after the overlay
      // is hidden — ignore anything within a beat of arming.
      if (performance.now() - placementArmedAt < 350) return;
      const p = input.toCanvasSpace(e.clientX, e.clientY);
      const ground = renderer3d.screenToGround(p.x, p.y);
      if (ground) {
        const snapped = snapToNearbyFence(ground);
        fenceDraw.start = snapped;
        fenceDraw.end = snapped;
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
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
    if (fenceDraw && fenceDraw.start) {
      const p = input.toCanvasSpace(e.clientX, e.clientY);
      const ground = renderer3d.screenToGround(p.x, p.y);
      if (ground) fenceDraw.end = ground;
      return;
    }
    if (!placementMode) return;
    const p = input.toCanvasSpace(e.clientX, e.clientY);
    const ground = renderer3d.screenToGround(p.x, p.y);
    if (ground) placementCursor = ground;
  });
  canvas.addEventListener('pointerup', () => {
    if (fenceDraw && fenceDraw.start) commitFenceDraw();
  });
  canvas.addEventListener('pointercancel', () => {
    if (fenceDraw && fenceDraw.start) { fenceDraw = null; endPlacement(); }
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
          audio.purchase();
          gold -= weapon.unlockCost;
          player.unlockedWeapons.push(id);
        } else {
          audio.buttonClick();
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
        audio.purchase();
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
    audio.waveStart();
    el.shopOverlay.classList.add('hidden');
    state = 'playing';
    waveManager.startNextWave();
    updateHud();
  }

  el.nextWaveBtn.addEventListener('click', startNextWave);

  el.restartBtn.addEventListener('click', () => {
    audio.unlock();
    audio.buttonClick();
    el.gameoverOverlay.classList.add('hidden');
    clearSave();
    resetGame();
    updateHud();
  });

  el.startBtn.addEventListener('click', () => {
    audio.unlock(); // first real user gesture on the page — safe place to start the AudioContext
    if (loadGame() && !confirm('Start a new game? Your saved progress will be lost.')) return;
    audio.menuClose();
    clearSave();
    el.startOverlay.classList.add('hidden');
    resetGame();
    updateHud();
  });

  el.continueBtn.addEventListener('click', () => {
    audio.unlock();
    const snapshot = loadGame();
    if (!snapshot) return;
    audio.menuClose();
    el.startOverlay.classList.add('hidden');
    applySnapshot(snapshot);
  });

  function refreshStartScreenSaveUI() {
    const hasSave = !!loadGame();
    el.continueBtn.classList.toggle('hidden', !hasSave);
    el.startBtn.textContent = hasSave ? 'New Game' : 'Start Game';
    renderMetaPanel();
  }

  el.weaponSwitchBtn.addEventListener('click', () => {
    audio.buttonClick();
    player.swapWeapon();
    updateHud();
  });

  // ---------- Pause / save / quit ----------
  el.pauseBtn.addEventListener('click', () => {
    audio.menuOpen();
    paused = true;
    el.pauseOverlay.classList.remove('hidden');
  });

  el.resumeBtn.addEventListener('click', () => {
    audio.unlock(); // in case the tab was backgrounded long enough to suspend the AudioContext
    audio.menuClose();
    paused = false;
    el.pauseOverlay.classList.add('hidden');
  });

  el.saveQuitBtn.addEventListener('click', () => {
    audio.buttonClick();
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
    fenceDraw = null;
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

    const boss = enemies.find((e) => e.isBoss && e.alive);
    el.bossHealthBar.classList.toggle('hidden', !boss);
    if (boss) {
      el.bossHealthName.textContent = BOSS_DISPLAY_NAMES[boss.bossType];
      el.bossHealthFill.style.width = clamp(boss.health / boss.maxHealth, 0, 1) * 100 + '%';
    }

    // Advance warning so a boss wave doesn't feel like it ambushes the player mid-fight — shown
    // only up until the boss actually spawns, at which point the health bar above takes over.
    const secsUntilBoss = boss ? null : waveManager.secondsUntilBoss();
    el.bossWarning.classList.toggle('hidden', secsUntilBoss === null);
    if (secsUntilBoss !== null) {
      el.bossWarningName.textContent = BOSS_DISPLAY_NAMES[waveManager.upcomingBossType()];
      el.bossWarningSecs.textContent = Math.ceil(secsUntilBoss);
    }

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
    if (player._isMoving) audio.footstep();
    if (control.firing) {
      const fired = player.tryFire();
      if (fired.length) audio.shootWeapon(player.equippedWeapon);
      bullets.push(...fired);
    }

    for (const b of bullets) b.update(dt, bounds);
    bullets = bullets.filter((b) => b.alive);

    const spawned = waveManager.update(dt, enemies.length);
    if (spawned) {
      enemies.push(spawned);
      if (spawned.isBoss) audio.bossSpawn();
      else audio.monsterVoice(spawned.typeKey);
    }

    for (const enemy of enemies) {
      // A rare, rate-limited ambient growl/hiss/groan while a monster is alive and on the field —
      // AudioManager's per-type cooldown keeps a whole wave of them from turning into noise.
      if (Math.random() < 0.0025) audio.monsterVoice(enemy.typeKey);
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

      // Fences slow any enemy passing near them, and physically block whichever one it's
      // actually touching — a blocked enemy stops right there (its movement target below
      // becomes the fence, not its real destination) instead of drifting straight through, and
      // attacks it on the same sustained cooldown as attacking the ward/player (below) until it
      // breaks through and can continue toward whatever it was actually after.
      let speedMult = 1;
      let blockingFence = null;
      let blockingDist = Infinity;
      for (const fence of fences) {
        if (!fence.alive) continue;
        const fenceDist = dist(enemy.x, enemy.y, fence.x, fence.y);
        if (fenceDist <= fence.slowRadius) speedMult = Math.min(speedMult, fence.slowMult);
        if (fenceDist <= fence.radius + enemy.radius && fenceDist < blockingDist) {
          blockingFence = fence;
          blockingDist = fenceDist;
        }
      }

      enemy.update(dt, blockingFence || target, speedMult);

      if (enemy.isBoss) {
        // Each boss has one special ability on its own cooldown instead of (or, for the alpha,
        // in addition to) regular single-target contact damage — see entities.js's
        // BOSS_ABILITY_INTERVAL comment for why these three read as distinct fight patterns.
        if (enemy._abilityCooldown <= 0) {
          if (enemy.bossType === 'revenant') {
            // AOE slam: can land on the player, the ward, and any fences simultaneously if
            // they're all in range, instead of just whichever one it happens to be touching.
            const hitsPlayer = dist(enemy.x, enemy.y, player.x, player.y) <= REVENANT_SLAM_RADIUS + player.radius;
            const hitsBase = dist(enemy.x, enemy.y, base.x, base.y) <= REVENANT_SLAM_RADIUS + base.radius;
            if (hitsPlayer || hitsBase) {
              if (hitsPlayer) { player.takeDamage(enemy.damage); damageFlash = Math.min(1, damageFlash + 0.5); }
              if (hitsBase) { base.takeDamage(enemy.damage); damageFlash = Math.min(1, damageFlash + 0.35); }
              for (const fence of fences) {
                if (fence.alive && dist(enemy.x, enemy.y, fence.x, fence.y) <= REVENANT_SLAM_RADIUS + fence.radius) {
                  fence.takeDamage(enemy.damage * 2);
                }
              }
              explosions.push(new Explosion(enemy.x, enemy.y, REVENANT_SLAM_RADIUS));
              audio.bossSlam();
              enemy._abilityCooldown = REVENANT_SLAM_INTERVAL;
            } else {
              enemy._abilityCooldown = 0.3; // nothing in range yet — recheck soon rather than waiting a full interval
            }
          } else if (enemy.bossType === 'wraith') {
            // Blink strike: teleports into melee range of its current target and lands one heavy
            // hit — an ambush that threatens from anywhere on the field, not just up close.
            if (dist(enemy.x, enemy.y, target.x, target.y) <= WRAITH_BLINK_RANGE) {
              const angleToTarget = Math.atan2(target.y - enemy.y, target.x - enemy.x);
              const landDist = (target.radius || 0) + enemy.radius + 4;
              enemy.x = target.x - Math.cos(angleToTarget) * landDist;
              enemy.y = target.y - Math.sin(angleToTarget) * landDist;
              enemy.angle = angleToTarget;
              const hitsPlayer = dist(enemy.x, enemy.y, player.x, player.y) <= WRAITH_BLINK_STRIKE_RADIUS + player.radius;
              const hitsBase = dist(enemy.x, enemy.y, base.x, base.y) <= WRAITH_BLINK_STRIKE_RADIUS + base.radius;
              if (hitsPlayer) { player.takeDamage(enemy.damage); damageFlash = Math.min(1, damageFlash + 0.5); }
              if (hitsBase) { base.takeDamage(enemy.damage); damageFlash = Math.min(1, damageFlash + 0.35); }
              explosions.push(new Explosion(enemy.x, enemy.y, WRAITH_BLINK_STRIKE_RADIUS));
              audio.wraithBlink();
              enemy._abilityCooldown = WRAITH_BLINK_INTERVAL;
            } else {
              enemy._abilityCooldown = 0.3;
            }
          } else if (enemy.bossType === 'alpha') {
            // Summons a pack of regular werewolves, capped so a long fight can't snowball into a
            // swarm. Its own threat is the normal melee contact damage below (it doesn't
            // `continue` past this block), so the fight is "grind through reinforcements while
            // focusing the alpha" rather than a purely ranged pattern like the other two bosses.
            const packSize = enemies.filter((e) => !e.isBoss && e.alive).length;
            if (packSize < ALPHA_SUMMON_MAX_ACTIVE) {
              for (let i = 0; i < ALPHA_SUMMON_COUNT; i++) {
                const a = Math.random() * Math.PI * 2;
                const sx = clamp(enemy.x + Math.cos(a) * 40, enemy.radius, bounds.width - enemy.radius);
                const sy = clamp(enemy.y + Math.sin(a) * 40, enemy.radius, bounds.height - enemy.radius);
                enemies.push(new Enemy(sx, sy, 'werewolf', waveManager.waveScale || 1));
              }
              audio.alphaHowl();
            }
            enemy._abilityCooldown = ALPHA_SUMMON_INTERVAL;
          }
        }
        if (enemy.bossType !== 'alpha') continue;
      }

      // Contact is sustained, not a one-shot suicide hit: an enemy that reaches a fence, the
      // ward, or the hunter keeps landing damage on a cooldown until something (the player, or
      // just breaking through) actually stops it. A blocked enemy always fights the fence in
      // front of it rather than whatever's behind it — it physically can't reach past yet.
      if (blockingFence) {
        if (enemy._attackCooldown <= 0) {
          blockingFence.takeDamage(enemy.damage);
          audio.fenceHit();
          enemy._attackCooldown = ENEMY_ATTACK_INTERVAL;
        }
      } else if (dist(enemy.x, enemy.y, base.x, base.y) <= base.radius + enemy.radius) {
        if (enemy._attackCooldown <= 0) {
          base.takeDamage(enemy.damage);
          audio.baseHit();
          enemy._attackCooldown = ENEMY_ATTACK_INTERVAL;
          damageFlash = Math.min(1, damageFlash + 0.35);
        }
      } else if (dist(enemy.x, enemy.y, player.x, player.y) <= player.radius + enemy.radius) {
        if (enemy._attackCooldown <= 0) {
          player.takeDamage(enemy.damage);
          audio.playerHurt();
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
          audio.mineExplosion();
          for (const victim of enemies) {
            if (!victim.alive) continue;
            if (dist(mine.x, mine.y, victim.x, victim.y) <= mine.blastRadius) {
              victim.takeDamage(mine.damage);
              if (!victim.alive) {
                audio.enemyDeath();
                gold += victim.reward;
                audio.goldPickup();
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
          if (bullet.weaponType === 'thurible') {
            // Explosive impact: detonates on first contact, damaging every enemy in the blast
            // radius at once (same pattern as a Mine) instead of just the one it touched.
            explosions.push(new Explosion(bullet.x, bullet.y, THURIBLE_BLAST_RADIUS));
            audio.mineExplosion();
            for (const victim of enemies) {
              if (!victim.alive) continue;
              const vHitCenter = victim.getHitCenter();
              if (dist(bullet.x, bullet.y, vHitCenter.x, vHitCenter.y) <= THURIBLE_BLAST_RADIUS + victim.hitRadius) {
                victim.takeDamage(bullet.damage);
                if (!victim.alive) {
                  audio.enemyDeath();
                  gold += victim.reward;
                  audio.goldPickup();
                  bloodPools.push(new BloodPool(victim.x, victim.y, victim.radius / 12));
                } else {
                  audio.hitEnemy(bullet.isCrit);
                }
              }
            }
            bullet.alive = false;
            break;
          }
          enemy.takeDamage(bullet.damage);
          bullet.hitEnemies.add(enemy);
          const hitAngle = Math.atan2(bullet.vy, bullet.vx);
          const hitHeight = enemy.radius * 1.45;
          hitEffects.push(new HitSpark(enemy.x, enemy.y, hitHeight, hitAngle, bullet.isCrit));
          hitEffects.push(new DamageNumber(enemy.x, enemy.y, hitHeight, bullet.damage, bullet.isCrit));
          if (enemy.alive) {
            audio.hitEnemy(bullet.isCrit);
          } else {
            audio.enemyDeath();
            gold += enemy.reward;
            audio.goldPickup();
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
      audio.gameOver();
      state = 'gameover';
      el.finalWave.textContent = waveManager.waveNumber;
      const marksEarned = Math.max(0, waveManager.waveNumber - 1); // waves actually cleared, not the one in progress
      if (marksEarned > 0) {
        meta.marks += marksEarned;
        saveMeta(meta);
        el.marksEarned.textContent = `+${marksEarned} Marks earned`;
        el.marksEarned.classList.remove('hidden');
      } else {
        el.marksEarned.classList.add('hidden');
      }
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
      audio.waveClear();
      gold += 10 + waveManager.waveNumber * 2; // wave-clear bonus, on top of per-kill gold
      if (waveManager.isBossWave(waveManager.waveNumber)) {
        const nextCheckpoint = waveManager.waveNumber + 1;
        if (!meta.unlockedCheckpoints.includes(nextCheckpoint)) {
          meta.unlockedCheckpoints.push(nextCheckpoint);
          saveMeta(meta);
        }
      }
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

  /** Live ghost preview for an in-progress fence drag: a short perpendicular line per candidate
   *  segment (green if it'll actually be placed on release, red if it's blocked or past what's
   *  affordable), plus the running count/cost in the placement-bar prompt so the player always
   *  knows what release will commit before they let go. */
  function drawFenceLinePreview() {
    if (!fenceDraw || !fenceDraw.start) return;
    const { tierIndex, start, end } = fenceDraw;
    const { segments, rotation, placedCount, totalCost } = computeFenceLine(tierIndex, start, end);
    const tier = FENCE_TIERS[tierIndex];
    el.placementPrompt.textContent = placedCount > 0
      ? `${placedCount} ${tier.name}${placedCount === 1 ? '' : 's'} — ${totalCost}g. Release to place.`
      : 'No room (or gold) for a fence here — drag elsewhere, or release to cancel.';

    const hw = FENCE_WIDTH / 2;
    fx.save();
    for (const seg of segments) {
      const glow = seg.affordable ? 'rgba(120, 220, 140,' : 'rgba(220, 70, 70,';
      const a = renderer3d.worldToScreen(seg.x + Math.cos(rotation) * hw, seg.y - Math.sin(rotation) * hw);
      const b = renderer3d.worldToScreen(seg.x - Math.cos(rotation) * hw, seg.y + Math.sin(rotation) * hw);
      fx.strokeStyle = `${glow} 0.9)`;
      fx.lineWidth = 4;
      fx.lineCap = 'round';
      fx.beginPath();
      fx.moveTo(a.x, a.y);
      fx.lineTo(b.x, b.y);
      fx.stroke();
    }
    // A single translucent slow-aura ring at the live end point (not one per segment — a whole
    // run of them would just be visual noise) so the aura's reach is still visible while dragging.
    const endPos = renderer3d.worldToScreen(end.x, end.y);
    const r = screenRadiusAt(end.x, end.y, tier.slowRadius);
    fx.strokeStyle = 'rgba(120, 220, 140, 0.5)';
    fx.setLineDash([5, 4]);
    fx.lineWidth = 1.5;
    fx.beginPath();
    fx.arc(endPos.x, endPos.y, r, 0, Math.PI * 2);
    fx.stroke();
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

  // ---------- Post-process: cold color grade + vignette + film grain (2D overlay) ----------
  // Drawn first on the fx-canvas, underneath every other overlay element (joysticks, damage
  // numbers, placement UI), so it grades the 3D world without dulling the HUD/controls on top of
  // it. Plain alpha compositing only (no canvas blend-mode tricks) since the fx-canvas and the
  // WebGL game-canvas are two separate stacked elements — a 2D "multiply"/"overlay" composite
  // mode only blends against pixels already drawn into *this* canvas, not the WebGL one behind
  // it, so a translucent color wash is the correct (and correctly cheap) way to tint it.
  const grainTile = (() => {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  })();
  const grainPattern = fx.createPattern(grainTile, 'repeat');

  function drawPostProcess() {
    fx.save();
    fx.fillStyle = 'rgba(14, 26, 36, 0.11)';
    fx.fillRect(0, 0, bounds.width, bounds.height);
    fx.restore();

    fx.save();
    const cx = bounds.width / 2;
    const cy = bounds.height / 2;
    const outerR = Math.hypot(cx, cy);
    const grad = fx.createRadialGradient(cx, cy, outerR * 0.42, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    fx.fillStyle = grad;
    fx.fillRect(0, 0, bounds.width, bounds.height);
    fx.restore();

    fx.save();
    fx.globalAlpha = 0.05;
    fx.translate(-Math.random() * 128, -Math.random() * 128);
    fx.fillStyle = grainPattern;
    fx.fillRect(0, 0, bounds.width + 128, bounds.height + 128);
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
    renderer3d.syncPlayer(player, elapsed);
    renderer3d.syncEnemies(enemies, elapsed);
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
    drawPostProcess();
    drawDamageNumbers();
    drawDefenseSelectionRing();
    drawPlacementPreview();
    drawFenceLinePreview();
    drawInvalidPlacementFlash();

    if (state === 'playing') {
      drawStick(input.moveStick, 'rgba(79, 220, 111, 0.9)');
      drawStick(input.aimStick, 'rgba(255, 95, 95, 0.9)');
    }

    drawDamageFlash();
  }

  // ---------- Performance monitor ----------
  // This dev sandbox can only run software-rendered WebGL (no real GPU), so real-device frame
  // rate has never actually been verified — this is the safety net for whatever it turns out to
  // be. Tracks a rolling average and, once the scene has had time to settle (asset baking, JIT
  // warm-up), downgrades once automatically if a device is genuinely struggling rather than
  // staying janky for the rest of the run. The small on-screen readout is meant to be glanced at
  // once on a real device, not a permanent HUD fixture.
  const FPS_WARMUP_MS = 6000;
  const FPS_LOW_THRESHOLD = 33;
  let fpsSamples = [];
  let qualityChecked = false;
  // Real wall-clock time, not the game's own `elapsed` accumulator: elapsed advances by a
  // dt that's clamped to 50ms/frame (to avoid huge jumps after tab-out), which on a genuinely
  // slow device systematically under-counts real time as more and more frames hit that clamp —
  // "6 seconds" needs to mean 6 real seconds regardless of how bad the frame times actually are.
  const perfMonitorStart = performance.now();

  function trackPerf(dt) {
    if (dt <= 0) return;
    fpsSamples.push(1 / dt);
    if (fpsSamples.length > 90) fpsSamples.shift();
    if (fpsSamples.length < 30) return;
    const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    el.fpsCounter.textContent = Math.round(avgFps) + ' fps';
    if (!qualityChecked && performance.now() - perfMonitorStart > FPS_WARMUP_MS) {
      qualityChecked = true;
      if (avgFps < FPS_LOW_THRESHOLD) renderer3d.setLowQuality();
    }
  }

  // ---------- Main loop ----------
  let lastTime = performance.now();
  let elapsed = 0; // drives ambient effects (rune pulse, fog drift) even while paused
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp to avoid huge steps on tab-out
    lastTime = now;
    elapsed += dt;
    trackPerf(dt);
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
    debugFireBulletAt: (x, y, damage) => { bullets.push(new Bullet(x, y, 0, 0, damage, false, 0, 'crossbow')); },
    debugForceFire: (aimAngle) => {
      if (typeof aimAngle === 'number') player.aimAngle = aimAngle;
      player._fireCooldown = 0;
      const fired = player.tryFire();
      bullets.push(...fired);
      return fired.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, damage: b.damage, weaponType: b.weaponType }));
    },
    debugExplosionCount: () => explosions.length,
    debugSetAbilityCooldown: (enemyIdx, s) => { enemies[enemyIdx]._abilityCooldown = s; },
    debugSetEnemyTargetPreference: (idx, pref) => { enemies[idx].targetPreference = pref; },
    debugSetWaveNumber: (n) => { waveManager.waveNumber = n; },
    debugBossForWave: (n) => waveManager.bossForWave(n),
    debugUpcomingBossType: () => waveManager.upcomingBossType(),
    debugForceWaveClear: () => { enemies = []; waveManager.spawnQueue = []; },
    debugSetPaused: (v) => { paused = v; },
    getState: () => ({
      state,
      paused,
      gold,
      wave: waveManager.waveNumber,
      enemies: enemies.map((e) => ({ x: e.x, y: e.y, health: e.health, radius: e.radius, hitCenter: e.getHitCenter(), hitRadius: e.hitRadius, attackCooldown: e._attackCooldown, isMoving: e._isMoving, targetPreference: e.targetPreference, isBoss: e.isBoss, bossType: e.bossType, abilityCooldown: e._abilityCooldown })),
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
    debugBeginFenceDraw: (tierIndex) => beginFenceDraw(tierIndex),
    debugFenceDragStart: (x, y) => { if (fenceDraw) { fenceDraw.start = { x, y }; fenceDraw.end = { x, y }; } },
    debugFenceDragTo: (x, y) => { if (fenceDraw && fenceDraw.start) fenceDraw.end = { x, y }; },
    debugFenceDragCommit: () => commitFenceDraw(),
    debugComputeFenceLine: (tierIndex, start, end) => computeFenceLine(tierIndex, start, end),
    debugFenceDrawState: () => (fenceDraw ? { ...fenceDraw } : null),
    debugSnapToNearbyFence: (x, y) => snapToNearbyFence({ x, y }),
    debugBloodPoolScales: () => bloodPools.map((bp) => {
      const v = renderer3d.bloodDecals.get(bp);
      return { sourceScale: bp.scale, meshScale: v ? v.mesh.scale.x : null };
    }),
    debugBulletViews: () => bullets.map((b) => {
      const v = renderer3d.bulletViews.get(b);
      return {
        weaponType: b.weaponType,
        viewFound: !!v,
        childCount: v ? v.group.children.length : null,
        childGeoTypes: v ? v.group.children.map((c) => c.geometry ? c.geometry.type : c.type) : null,
      };
    }),
    debugPlayerWeaponView: () => {
      const v = renderer3d.playerView;
      if (!v || !v.weaponVisual) return null;
      return {
        equippedWeaponTag: v.equippedWeaponTag,
        childCount: v.weaponVisual.children.length,
        childGeoTypes: v.weaponVisual.children.map((c) => c.geometry ? c.geometry.type : c.type),
      };
    },
    debugSetPrepCountdown: (s) => { prepCountdown = s; },
    debugSetWaveClearTimer: (s) => { waveClearTimer = s; },
    debugViewField: () => el.viewFieldBtn.click(),
    debugReopenShop: () => el.reopenShopBtn.click(),
    debugSelectFieldTap: (x, y) => handleFieldTap(x, y),
    debugMoveSelected: () => el.defenseSelectMoveBtn.click(),
    debugUpgradeSelected: () => el.defenseSelectUpgradeBtn.click(),
    debugRotateSelected: () => el.defenseSelectRotateBtn.click(),
    debugRepairSelected: () => el.defenseSelectRepairBtn.click(),
    debugDamageFence: (idx, amount) => { fences[idx].health = Math.max(0, fences[idx].health - amount); },
    debugRotatePlacement: () => el.placementRotateBtn.click(),
    debugWorldToScreen: (x, y, height = 0) => renderer3d.worldToScreen(x, y, height),
    debugAudioState: () => ({ ctxState: audio.ctx ? audio.ctx.state : 'not created', muted: audio.muted }),
    debugForceLowQuality: () => renderer3d.setLowQuality(),
    debugPerfState: () => ({
      lowQuality: renderer3d.lowQuality,
      fpsSamples: fpsSamples.length,
      avgFps: fpsSamples.length ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) : null,
      shadowMapEnabled: renderer3d.renderer.shadowMap.enabled,
      toggleableVisible: renderer3d._toggleableMeshes.filter((m) => m.visible).length,
      toggleableTotal: renderer3d._toggleableMeshes.length,
      rendererInfo: {
        calls: renderer3d.renderer.info.render.calls,
        triangles: renderer3d.renderer.info.render.triangles,
        pixelRatio: renderer3d.renderer.getPixelRatio(),
      },
    }),
    debugPlayerLimbState: () => {
      const v = renderer3d.playerView;
      if (!v) return null;
      return {
        aimAngle: player.aimAngle,
        moveAngle: player._moveAngle,
        isMoving: player._isMoving,
        hipL: { x: v.hipL.rotation.x, z: v.hipL.rotation.z },
        hipR: { x: v.hipR.rotation.x, z: v.hipR.rotation.z },
      };
    },
    debugMetaState: () => ({ ...meta, unlockedLoadouts: [...meta.unlockedLoadouts], unlockedCheckpoints: [...meta.unlockedCheckpoints], selectedStartWeapon, selectedStartMode }),
    debugSetMeta: (patch) => { Object.assign(meta, patch); saveMeta(meta); renderMetaPanel(); },
    debugSelectStartWeapon: (id) => { selectedStartWeapon = id; renderMetaPanel(); },
    debugSelectStartMode: (mode) => { selectedStartMode = mode; renderMetaPanel(); },
    debugClickLoadout: (id) => {
      const idx = WEAPON_ORDER.indexOf(id);
      el.loadoutItems.children[idx].querySelector('button').click();
    },
    debugClickCheckpointOption: (mode) => {
      const idx = mode === 'fresh' ? 0 : 1;
      el.checkpointItems.children[idx].querySelector('button').click();
    },
  };
})();
