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
  shop, game over), and the responsive/letterboxed mobile viewport
- `src/vector.js` — small math helpers
- `src/input.js` — `InputManager`, unifying keyboard/mouse and dual virtual
  joystick touch input into one per-frame control state
- `src/entities.js` — `Player`, `Base`, `Bullet`, `Enemy` classes
- `src/weapons.js` — the weapon catalog (stats + firing pattern + visuals)
  for the loadout system
- `src/defenses.js` — `Fence`, `Mine`, `Explosion` classes and the tiered
  stat catalog (`FENCE_TIERS`, `MINE_TIERS`) for the manually-placed
  base-defense shop section
- `src/effects.js` — `HitSpark` and `DamageNumber`, the cosmetic feedback
  spawned when a bullet lands
- `src/waves.js` — `WaveManager`, which builds and paces enemy spawns per wave
- `src/shop.js` — the stat-upgrade catalog and purchase logic
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

- One arena, one warded altar to defend, one demon hunter
- Three monster types (zombie, vampire, werewolf) that scale in strength
  each wave
- Six purchasable upgrades (bolt damage, fire rate, move speed, max HP,
  crit chance, ward repair)
- Ward destroyed = game over; hunter death just costs some gold and respawns
- Gothic horror visual pass: a heavier, cooler-lit palette (cold moonlight
  against warm brazier fire), a mottled/uneven ground with old dried blood
  stains and bone piles, a stronger tinted vignette, and a film-grain
  overlay baked once into a repeating pattern for cheap per-frame grit.
  Monsters and the hunter got a grittier redesign: jagged torn silhouettes
  instead of smooth shapes, exposed ribs and a hanging jaw on zombies,
  fangs and blood at the mouth on vampires and werewolves, claws and
  matted fur on the werewolf, a tattered cloak and a narrow predatory
  eye-glow on the hunter. Enemy kills now leave a permanent (slow-fading)
  blood pool on the ground, and hit sparks/damage numbers read as blood
  spatter rather than gold sparks. The ward altar weeps old blood down its
  face and has a small skull etched into its glowing core. All still pure
  Canvas 2D — no 3D or external art assets
- Fixed 3/4-elevated "camera" (Vampire Survivors/Brotato-style): characters
  don't rotate to face their direction, they mirror left/right and have
  procedurally animated two-segment limbs that swing on a walk cycle driven
  by actual distance travelled, so motion freezes when something is
  stationary instead of animating in place
- A denser environment: dead trees, a crypt, flickering lit braziers,
  cracked ground and moss patches alongside the tombstones
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

## Ideas for expanding

- Multiple lanes/directions of attack, or a larger map with sightlines
- Placeable turrets/wards instead of (or alongside) the shop
- Weapon variety (holy water flasks, silver shotgun shells, hunter's
  chakram) as purchasable/swappable loadouts
- Boss waves, monster special abilities (ranged hexes, shielded revenants)
- Persistent meta-progression between runs
- Sound and further visual effects/juice (screen shake, blood/dust particles)
