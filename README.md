# Base Defense

A top-down wave shooter proof of concept. Defend the base at the center of the
arena from waves of enemies, earn gold from kills, and spend it on upgrades
between waves.

## Running it

No build step or server required — just open `index.html` in a browser.

Optionally serve it locally:

```
python3 -m http.server 8080
```

then visit `http://localhost:8080`.

## Controls

- `WASD` / arrow keys — move
- Mouse — aim
- Click and hold — fire

## How it's structured

- `index.html` / `style.css` — page layout, HUD, and overlay screens (start,
  shop, game over)
- `src/vector.js` — small math helpers
- `src/entities.js` — `Player`, `Base`, `Bullet`, `Enemy` classes
- `src/waves.js` — `WaveManager`, which builds and paces enemy spawns per wave
- `src/shop.js` — the upgrade catalog and purchase logic
- `src/game.js` — input handling, the main update/render loop, and state
  machine (start → playing → shop → playing → ... → game over)

## Current proof-of-concept scope

- One arena, one base, one player character
- Three enemy types (grunt, runner, tank) that scale in strength each wave
- Six purchasable upgrades (damage, fire rate, move speed, max HP, crit
  chance, base repair)
- Base destroyed = game over; player death just costs some gold and respawns

## Ideas for expanding

- Multiple lanes/directions of attack, or a larger map with sightlines
- Placeable turrets/defenses instead of (or alongside) the shop
- Weapon variety (shotgun, rocket, laser) as purchasable/swappable loadouts
- Boss waves, enemy special abilities (ranged attackers, shielded units)
- Persistent meta-progression between runs
- Sound and visual effects/juice
