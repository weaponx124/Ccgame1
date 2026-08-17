# Nightward

A top-down gothic wave shooter proof of concept, built mobile-first with the
App Store as the eventual target. You're the last demon hunter defending a
warded altar from waves of zombies, vampires, and werewolves — earn gold
from kills and spend it on upgrades between hunts.

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
  shop, game over), and the responsive/letterboxed mobile viewport. Two
  stacked `<canvas>` elements: `#game-canvas` (WebGL, the 3D scene) and
  `#fx-canvas` (2D, a transparent screen-space overlay on top of it for
  joysticks, damage numbers, and placement UI ghosts)
- `src/vendor/three.min.js` — Three.js, vendored directly (not a CDN
  `<script>` tag) so the game has no third-party runtime dependency and
  works identically offline, in restricted network sandboxes, and in
  production
- `src/render3d.js` — `Renderer3D`, the entire 3D rendering layer: scene,
  camera, lighting (moonlit directional light + flickering brazier/altar
  point lights, all shadow-casting), the baked ground texture, static
  environment props, and a model factory + per-frame sync method for every
  entity type. This is the only file that knows Three.js exists
- `src/vector.js` — small math helpers
- `src/input.js` — `InputManager`, unifying keyboard/mouse and dual virtual
  joystick touch input into one per-frame control state
- `src/entities.js` — `Player`, `Base`, `Bullet`, `Enemy` — pure gameplay
  logic/state, no rendering code at all
- `src/weapons.js` — the weapon catalog (stats + firing pattern) for the
  loadout system
- `src/defenses.js` — `Fence`, `Mine`, `Explosion` classes and the tiered
  stat catalog (`FENCE_TIERS`, `MINE_TIERS`) for the manually-placed
  base-defense shop section — pure logic, no rendering code
- `src/effects.js` — `HitSpark`, `DamageNumber`, `BloodPool`, the cosmetic
  feedback spawned when a bullet lands or an enemy dies — pure state/timing,
  no rendering code
- `src/waves.js` — `WaveManager`, which builds and paces enemy spawns per wave
- `src/shop.js` — the stat-upgrade catalog and purchase logic
- `src/game.js` — the main update loop, viewport scaling, state machine
  (start → playing → shop → playing → ... → game over), and the render
  step that feeds live entity state into `Renderer3D` each frame and draws
  the 2D overlay on top of it

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

- One arena, one warded altar to defend, one demon hunter
- Three monster types (zombie, vampire, werewolf) that scale in strength
  each wave
- Six purchasable upgrades (bolt damage, fire rate, move speed, max HP,
  crit chance, ward repair)
- Ward destroyed = game over; hunter death just costs some gold and respawns
- Enemies in contact range keep fighting: they land a hit on a cooldown
  (not once and gone) until the player actually kills them
- Each weapon fires a projectile that matches it — a fletched bolt for
  the crossbow, a stubby lead slug for the blunderbuss, a spinning ring
  for the chakram — instead of one generic shot for everything
- Mines are bigger and have a larger, visibly-ringed trigger radius so
  their danger zone actually reads on the ground
- Real 3D rendering (Three.js/WebGL), not hand-drawn Canvas 2D vector art:
  actual lit geometry, materials, and cast shadows from a moonlit
  directional light plus flickering brazier and altar point lights. The
  hunter and all three monster types are built from primitive meshes
  (capsule limbs on animated pivot "joints" for the walk cycle, sphere
  heads, a torso, plus per-type extras — a tattered cloak and narrow
  eye-glow on the hunter, ragged tatters and a hanging jaw on zombies, a
  cape and fangs on vampires, ears/fangs/claws/matted fur on werewolves).
  The ground is a baked, textured plane (moss, cracks, old blood stains,
  grain) rather than a flat fill, and the environment — tombstones, a
  crypt, dead trees, bone piles, braziers — is real modeled geometry
  casting real shadows, not painted decoration. Enemy kills leave a
  permanent (slow-fading) blood decal on the ground, and hit sparks read
  as a burst of small blood-red particles. The camera is a fixed,
  perspective 3/4-elevated angle over the whole arena — characters
  actually rotate to face their movement/aim direction now, instead of
  the old 2D mirror-flip trick. Three.js is vendored in `src/vendor/`
  rather than loaded from a CDN, so there's no external runtime dependency
- A denser environment: dead trees, a crypt, flickering lit braziers,
  bone piles, and old blood stains alongside the tombstones
- A weapon loadout system: the crossbow (starting weapon), a blunderbuss
  (3-shard spread), and a chakram (slow, piercing throw) are purchasable
  one-time unlocks in the shop's Weapons section. Switch between owned
  weapons anytime with the HUD button next to Gold. Shop stat upgrades
  (damage, fire rate, etc.) apply on top of whichever weapon is equipped
- A base-defense economy: you start with a small amount of gold (enough
  for one early fence, mine, or cheap upgrade), earn more per kill, and
  also get a wave-clear bonus. The shop's Defenses section sells Fences
  (slow any enemy that passes near, and take contact damage until they
  break) and Mines (one-shot AoE that detonates on the first enemy to
  step near) — buying one arms a placement cursor, and the next tap on
  the battlefield drops it exactly where you choose (or Cancel refunds
  it). Each defense has a three-tier ladder (Wooden Fence → Iron
  Palisade → Runic Barrier; Buried Mine → Arcane Charge → Hellfire Trap).
  Researching the next tier is a one-time purchase that only affects
  *new* placements — existing ones keep their stats until you spend gold
  to upgrade that specific placement in place (see "View Field" below),
  so early cheap defenses aren't retroactively destroyed, but they do
  become the obvious weak point once you can afford better
- Fences are two units wide, and any two placed within range of each
  other automatically link with a connecting rail, so a row of them
  reads as one continuous wall instead of separate posts. Fences can
  also be rotated (a Rotate button while placing, moving, or from a
  placed fence's selection bar; 45° per tap) so a wall can be built to
  face any approach — a horizontal panel only fronts enemies coming from
  north/south, so rotate it 90° to build a wall facing east/west
- "View Field": closing the shop panel during prep (via the View Field
  button, or the floating Open Shop button to bring it back) reveals the
  battlefield underneath so you can plan around what's already down. With
  the panel closed, tapping a placed fence or mine selects it, opening a
  small action bar to Move it (drag it to a new spot for free), Rotate it
  (fences only), or, once you've researched a higher tier, Upgrade it in
  place for that tier's
  placement cost
- Capped shop upgrades (bolt damage, fire rate, move speed, max HP, crit
  chance) show a row of pips under their description — filled pips are
  levels you already own, empty ones are what's left before that upgrade
  maxes out
- A short prep countdown (35s on the first wave, 25s after) ticks down
  in the shop between waves, pushing you to make upgrade decisions
  quickly; the clock pauses automatically while a placement cursor is
  active, so lining up exactly where a fence or mine goes is never
  rushed. It keeps running in the background even with the shop panel
  closed (shown as a small pill at the top of the screen) and hitting
  zero starts the next wave automatically
- After the last enemy in a wave dies, a 5-second "Wave Cleared" banner
  holds before the shop opens, so the kill has a moment to land before
  the UI interrupts
- Hit feedback: landing a shot spawns a quick spark burst and a floating
  damage number (crits are bigger and orange); mine/charge detonations
  get an expanding shockwave ring, a core flash, and scattering embers
  instead of just vanishing; taking damage on the player or the ward
  flashes a brief red screen tint so a hit always reads as a hit

## A note on the 3D rendering

This dev sandbox can only run headless Chromium with software-rendered
WebGL (no real GPU), so while the 3D pipeline has been tested thoroughly
for correctness (gameplay logic, placement raycasting, save/load, combat,
no console errors), its actual frame rate on a real phone GPU hasn't been
verified from here — worth checking on an actual device once deployed.
Shadow casters were already trimmed (limbs/decorations don't cast shadows,
only torsos/heads/major props do) and antialiasing/shadow quality tuned
down as a reasonable default; if it's heavy on lower-end phones, the next
places to cut are shadow map resolution (`src/render3d.js`, `_buildLighting`)
and disabling shadows entirely below some device threshold.

## Ideas for expanding

- Multiple lanes/directions of attack, or a larger map with sightlines
- Placeable turrets/wards instead of (or alongside) the shop
- Weapon variety (holy water flasks, silver shotgun shells, hunter's
  chakram) as purchasable/swappable loadouts
- Boss waves, monster special abilities (ranged hexes, shielded revenants)
- Persistent meta-progression between runs
- Sound and further visual effects/juice (screen shake, blood/dust particles)
