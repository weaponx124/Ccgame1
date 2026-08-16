// Game orchestration: input handling, main loop, state machine, and DOM/HUD wiring.

(function () {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const bounds = { width: canvas.width, height: canvas.height };
  const input = new InputManager(canvas, bounds);

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
  };

  // ---------- Game state ----------
  let state; // 'playing' | 'shop' | 'gameover' | 'menu'
  let paused = false;
  let player, base, waveManager, shop;
  let bullets, enemies;
  let gold;

  function setPauseButtonVisible(visible) {
    el.pauseBtn.classList.toggle('hidden', !visible);
  }

  function resetGame() {
    player = new Player(bounds.width / 2, bounds.height / 2 + 120);
    base = new Base(bounds.width / 2, bounds.height / 2);
    waveManager = new WaveManager(bounds);
    shop = new Shop();
    bullets = [];
    enemies = [];
    gold = 0;
    state = 'shop';
    waveManager.waveNumber = 0; // startNextWave will bump to 1
    openShop(true);
  }

  // ---------- Shop UI ----------
  function openShop(isFirst = false) {
    state = 'shop';
    el.shopTitle.textContent = isFirst ? 'Prepare for Battle' : `Wave ${waveManager.waveNumber} Cleared!`;
    renderShopItems();
    el.shopOverlay.classList.remove('hidden');
    setPauseButtonVisible(true);
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
      },
      base: { health: base.health, maxHealth: base.maxHealth },
      enemies: enemies.map((e) => ({ typeKey: e.typeKey, x: e.x, y: e.y, health: e.health, maxHealth: e.maxHealth })),
      shopPurchaseCounts: { ...shop.purchaseCounts },
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
  }

  // ---------- Update ----------
  function update(dt) {
    if (state !== 'playing') return;

    const control = input.getControlState(player.x, player.y, player.aimAngle);
    player.update(dt, control, bounds);
    if (control.firing) {
      const bullet = player.tryFire();
      if (bullet) bullets.push(bullet);
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
      enemy.update(dt, target);

      if (dist(enemy.x, enemy.y, base.x, base.y) <= base.radius + enemy.radius) {
        base.takeDamage(enemy.damage);
        enemy.alive = false;
      } else if (dist(enemy.x, enemy.y, player.x, player.y) <= player.radius + enemy.radius) {
        player.takeDamage(enemy.damage);
        enemy.alive = false;
      }
    }

    // Bullet vs enemy collisions
    for (const bullet of bullets) {
      if (!bullet.alive) continue;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (dist(bullet.x, bullet.y, enemy.x, enemy.y) <= bullet.radius + enemy.radius) {
          enemy.takeDamage(bullet.damage);
          bullet.alive = false;
          if (!enemy.alive) gold += enemy.reward;
          break;
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
      waveManager.finishWave();
      openShop(false);
    }

    updateHud();
  }

  // ---------- Render ----------
  function drawArenaBackground() {
    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
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

  function render() {
    drawArenaBackground();
    base.draw(ctx);
    for (const enemy of enemies) enemy.draw(ctx);
    for (const bullet of bullets) bullet.draw(ctx);
    if (state !== 'gameover') player.draw(ctx);

    if (state === 'playing') {
      drawStick(input.moveStick, 'rgba(79, 220, 111, 0.9)');
      drawStick(input.aimStick, 'rgba(255, 95, 95, 0.9)');
    }
  }

  // ---------- Main loop ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp to avoid huge steps on tab-out
    lastTime = now;
    if (!paused) update(dt);
    render();
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
    getState: () => ({
      state,
      paused,
      gold,
      wave: waveManager.waveNumber,
      enemies: enemies.map((e) => ({ x: e.x, y: e.y, health: e.health })),
      bullets: bullets.length,
      player: { x: player.x, y: player.y, health: player.health },
      base: { x: base.x, y: base.y, health: base.health },
      moveStick: { active: input.moveStick.active, ...input.moveStick.read() },
      aimStick: { active: input.aimStick.active, ...input.aimStick.read() },
    }),
  };
})();
