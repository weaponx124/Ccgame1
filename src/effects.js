// Purely cosmetic, ephemeral feedback effects — impact sparks, floating damage numbers, and
// blood pools where enemies fall. Pure state/timing here; Renderer3D (src/render3d.js) turns
// HitSpark and BloodPool into 3D views, and game.js draws DamageNumber as 2D text on the fx
// overlay canvas (crisp text is simpler in 2D than as 3D geometry/sprites).

class HitSpark {
  constructor(x, y, height, angle, isCrit) {
    this.x = x; // ground position (logical space)
    this.y = y;
    this.height = height; // world-Y height above ground the hit landed at
    this.angle = angle;
    this.isCrit = isCrit;
    this.age = 0;
    this.maxAge = 0.24;
    this.alive = true;
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }
}

class DamageNumber {
  constructor(x, y, height, amount, isCrit) {
    this.x = x + (Math.random() - 0.5) * 8; // ground position (logical space)
    this.y = y;
    this.height = height; // world-Y height above ground the hit landed at
    this.text = Math.round(amount).toString();
    this.isCrit = isCrit;
    this.age = 0;
    this.maxAge = 0.6;
    this.alive = true;
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }
}

/**
 * A dark, irregular blood splatter left on the ground where an enemy falls. Spreads out fast
 * over its first second, then just sits there slowly fading over close to a minute — the
 * battlefield should visibly accumulate carnage over the course of a wave.
 */
class BloodPool {
  constructor(x, y, scale = 1) {
    this.x = x;
    this.y = y;
    this.scale = scale;
    this.age = 0;
    this.maxAge = 45;
    this.alive = true;
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }
}
