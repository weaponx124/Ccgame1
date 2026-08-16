// Game orchestration: input handling, main loop, state machine, and DOM/HUD wiring.

(function () {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const bounds = { width: canvas.width, height: canvas.height };

  // ---------- Input ----------
  const input = {
    keys: new Set(),
    mouseX: bounds.width / 2,
    mouseY: bounds.height / 2,
    mouseDown: false,
    isDown(code) { return this.keys.has(code); },
  };
  window.addEventListener('keydown', (e) => input.keys.add(e.code));
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    input.mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
  });
  canvas.addEventListener('mousedown', () => { input.mouseDown = true; });
  window.addEventListener('mouseup', () => { input.mouseDown = false; });

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
  };

  // ---------- Game state ----------
  let state; // 'playing' | 'shop' | 'gameover'
  let player, base, waveManager, shop;
  let bullets, enemies;
  let gold;

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
    resetGame();
    updateHud();
  });

  el.startBtn.addEventListener('click', () => {
    el.startOverlay.classList.add('hidden');
    resetGame();
    updateHud();
  });

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

    player.update(dt, input, bounds);
    if (input.mouseDown) {
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

  function render() {
    drawArenaBackground();
    base.draw(ctx);
    for (const enemy of enemies) enemy.draw(ctx);
    for (const bullet of bullets) bullet.draw(ctx);
    if (state !== 'gameover') player.draw(ctx);
  }

  // ---------- Main loop ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp to avoid huge steps on tab-out
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // Initialize a game instance so state exists even before "Start" is clicked.
  resetGame();
  state = 'shop';
  el.shopOverlay.classList.add('hidden'); // hidden until player dismisses start screen
  updateHud();
  requestAnimationFrame(loop);

  // Debug/test hook: read-only snapshot of live state, useful for automated smoke tests.
  window.__game = {
    getState: () => ({
      state,
      gold,
      wave: waveManager.waveNumber,
      enemies: enemies.map((e) => ({ x: e.x, y: e.y, health: e.health })),
      bullets: bullets.length,
      player: { x: player.x, y: player.y, health: player.health },
      base: { x: base.x, y: base.y, health: base.health },
    }),
  };
})();
