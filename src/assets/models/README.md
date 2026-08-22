# Real (Blender-exported) models

Drop exported `.glb` files here, then register them in `GLTF_WEAPON_ASSETS` near the top of
`src/render3d.js`. Anything not registered keeps using its procedural model — this is meant to be
filled in one asset at a time, never all-or-nothing.

## Export settings (Blender)

- **File → Export → glTF 2.0 (.glb/.gltf)**, format **glTF Binary (.glb)**.
- Leave **Draco compression off** (the vendored loader doesn't include the Draco decoder — turning
  it on will make the file fail to load).
- Include: only the mesh(es) and material(s) you actually want. No need to include cameras/lights.
- Export a static (non-rigged) mesh for the first pass — no armature, no animation. See "what to
  model first" below for why.

## Before exporting: origin and orientation

- **Set the object's origin to its feet** (the ground-contact point), not the mesh's center —
  `Object > Set Origin > Origin to 3D Cursor` with the cursor placed at the base. This game's rigs
  are all built from the ground up (y=0 at the feet), so the model needs to match.
- Don't worry about Blender's Z-up vs. this game's Y-up — the glTF exporter converts that
  automatically.
- Model facing Blender's own default front view is fine — a per-asset `rotationY` in the registry
  entry corrects for whatever direction that turns out to be once you see it in-game.

## Registering it

```js
// src/render3d.js
const GLTF_WEAPON_ASSETS = {
  revolver: { url: 'src/assets/models/revolver.glb', scale: 20, rotationY: Math.PI / 2 },
};
```

- `scale`: converts Blender's units (default meters) into this game's arbitrary world units.
  Start around 20 and tune by eye — refresh the page, equip the weapon, adjust, repeat. No
  re-export needed for scale/rotation tweaks, only for actual geometry changes.
- `rotationY`: whichever multiple of 90° makes the model point the right way once it's in the
  player's hand — this is trial and error, not something to get right in Blender itself.

## What to model first

Start with **weapons**, not characters. Weapons are rigid — they don't need rigging, weight
painting, or animation to look right, since they're just attached to a pivot and swapped in
whole. A character needs an armature and at least idle/walk/attack animations to work with this
game's existing walk-cycle system, which is a substantially bigger step. Prove the pipeline with
something simple first.

Suggested order, roughly by how much visual payoff you get per unit of modeling effort:
1. **Revolver** — small, simple, and it's the only weapon that's always on screen (it's the
   default/cheapest weapon most runs start with).
2. **Gatling** or **Thurible Launcher** — the two most visually distinctive silhouettes in the
   current lineup, so a real model reads as a big upgrade fast.
3. Whichever weapon you personally use most, since that's the one you'll actually see in play.

Once one weapon model is in and looking right, the same registry pattern extends to the rest —
each new `.glb` is a few minutes of config, not new code.
