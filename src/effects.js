// Purely cosmetic, ephemeral feedback effects — impact sparks, floating damage numbers, and
// blood pools where enemies fall. None of these affect gameplay; they exist so combat reads as
// violent and lasting instead of numbers quietly disappearing.

class HitSpark {
  constructor(x, y, angle, isCrit) {
    this.x = x;
    this.y = y;
    this.isCrit = isCrit;
    this.age = 0;
    this.maxAge = 0.24;
    this.alive = true;
    const spreadCount = isCrit ? 8 : 6;
    this.shards = Array.from({ length: spreadCount }, (_, i) => {
      const a = angle + Math.PI + (Math.random() - 0.5) * 2.4; // fan back from the impact
      const speed = (isCrit ? 150 : 105) * (0.6 + Math.random() * 0.7);
      return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
    });
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }

  draw(ctx) {
    const t = clamp(this.age / this.maxAge, 0, 1);
    const color = this.isCrit ? '230, 30, 40' : '140, 15, 22';
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = `rgba(${color}, 0.95)`;
    ctx.fillStyle = `rgba(${color}, 0.95)`;
    ctx.lineWidth = this.isCrit ? 2.2 : 1.6;
    ctx.lineCap = 'round';
    for (const s of this.shards) {
      const ex = this.x + s.vx * t;
      const ey = this.y + s.vy * t;
      ctx.beginPath();
      ctx.moveTo(this.x + s.vx * t * 0.3, this.y + s.vy * t * 0.3);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey, this.isCrit ? 1.4 : 1, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.isCrit) {
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.fillStyle = 'rgba(255, 240, 200, 0.6)';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 6 * (1 - t) + 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

class DamageNumber {
  constructor(x, y, amount, isCrit) {
    this.x = x + (Math.random() - 0.5) * 8;
    this.y = y;
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

  draw(ctx) {
    const t = clamp(this.age / this.maxAge, 0, 1);
    const rise = 22 * t;
    ctx.save();
    ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    ctx.font = this.isCrit ? 'bold 15px Georgia, serif' : '12px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.isCrit ? '#ff3c3c' : '#d8ccc0';
    ctx.strokeStyle = 'rgba(5,3,4,0.9)';
    ctx.lineWidth = 3;
    const label = this.isCrit ? `${this.text}!` : this.text;
    ctx.strokeText(label, this.x, this.y - rise);
    ctx.fillText(label, this.x, this.y - rise);
    ctx.restore();
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
    this.age = 0;
    this.maxAge = 45;
    this.alive = true;
    const n = 5 + Math.floor(Math.random() * 3);
    this.blots = Array.from({ length: n }, () => ({
      dx: (Math.random() - 0.5) * 16 * scale,
      dy: (Math.random() - 0.5) * 8 * scale,
      rx: (3 + Math.random() * 6) * scale,
      ry: (2 + Math.random() * 3.5) * scale,
      rot: Math.random() * Math.PI,
    }));
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }

  draw(ctx) {
    const fade = clamp(1 - this.age / this.maxAge, 0, 1);
    const spread = Math.min(1, this.age / 1.2);
    ctx.save();
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = '#3a0408';
    for (const b of this.blots) {
      ctx.beginPath();
      ctx.ellipse(
        this.x + b.dx * spread,
        this.y + b.dy * spread,
        b.rx * (0.4 + spread * 0.6),
        b.ry * (0.4 + spread * 0.6),
        b.rot, 0, Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }
}
