# Base Defense

A top-down wave shooter proof of concept, built mobile-first with the App
Store as the eventual target. Defend the base at the center of the arena
from waves of enemies, earn gold from kills, and spend it on upgrades
between waves.

## Running it

No build step or server required — just open `index.html` in a browser.
On a phone, open it in landscape (a "rotate your device" prompt shows in
portrait, since twin-stick controls need the width).

Optionally serve it locally:

```
python3 -m http.server 8080
```

then visit `http://localhost:8080` (or your machine's LAN IP from a phone
on the same network).

## Controls

Twin-stick touch scheme, standard for mobile shooters:

- **Left thumb** — touch and drag anywhere on the left half of the screen to
  move; a floating joystick appears wherever you touch down
- **Right thumb** — touch and drag anywhere on the right half to aim; firing
  is continuous while the stick is held past a small deadzone

Desktop fallback (used automatically until the page detects a touch):

- `WASD` / arrow keys — move
- Mouse — aim
- Click and hold — fire

## How it's structured

- `index.html` / `style.css` — page layout, HUD, overlay screens (start,
  shop, game over), and the responsive/letterboxed mobile viewport
- `src/vector.js` — small math helpers
- `src/input.js` — `InputManager`, unifying keyboard/mouse and dual virtual
  joystick touch input into one per-frame control state
- `src/entities.js` — `Player`, `Base`, `Bullet`, `Enemy` classes
- `src/waves.js` — `WaveManager`, which builds and paces enemy spawns per wave
- `src/shop.js` — the upgrade catalog and purchase logic
- `src/game.js` — the main update/render loop, viewport scaling, and state
  machine (start → playing → shop → playing → ... → game over)

## Path to the App Store

The game itself is plain HTML/CSS/JS with no dependencies, which keeps
iteration fast, but shipping to the App Store needs a native shell around
it. The standard path from here:

1. Wrap the site with [Capacitor](https://capacitorjs.com/) (`npx cap add ios`)
   to get a native iOS project that loads this game in a native WebView.
2. Lock the app's orientation to landscape in the native project config
   (Xcode's `Info.plist`), instead of relying on the in-browser rotate
   prompt.
3. Add native plugins as needed (haptics on hit/purchase, in-app purchase
   for gold/upgrades if monetizing, App Tracking Transparency if adding
   analytics).
4. Build and submit through Xcode — this step needs a Mac, since Apple only
   accepts builds signed and archived via Xcode.

None of that is done yet; this repo is still the pure web build.

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
