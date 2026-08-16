// Purely cosmetic, ephemeral feedback effects — impact sparks and floating damage numbers on
// a landed hit. None of these affect gameplay; they exist so a hit actually reads as a hit.

class HitSpark {
  constructor(x, y, angle, isCrit) {
    this.x = x;
    this.y = y;
    this.isCrit = isCrit;
    this.age = 0;
    this.maxAge = 0.22;
    this.alive = true;
    const spreadCount = isCrit ? 7 : 5;
    this.shards = Array.from({ length: spreadCount }, (_, i) => {
      const a = angle + Math.PI + (Math.random() - 0.5) * 2.2; // fan back from the impact
      const speed = (isCrit ? 140 : 95) * (0.6 + Math.random() * 0.7);
      return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
    });
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.maxAge) this.alive = false;
  }

  draw(ctx) {
    const t = clamp(this.age / this.maxAge, 0, 1);
    const color = this.isCrit ? '255, 150, 60' : '255, 226, 150';
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = `rgba(${color}, 0.95)`;
    ctx.lineWidth = this.isCrit ? 2 : 1.4;
    ctx.lineCap = 'round';
    for (const s of this.shards) {
      const ex = this.x + s.vx * t;
      const ey = this.y + s.vy * t;
      ctx.beginPath();
      ctx.moveTo(this.x + s.vx * t * 0.35, this.y + s.vy * t * 0.35);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    if (this.isCrit) {
      ctx.globalAlpha = (1 - t) * 0.6;
      ctx.fillStyle = `rgba(${color}, 0.5)`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 10 * (1 - t) + 2, 0, Math.PI * 2);
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
    ctx.fillStyle = this.isCrit ? '#ffb04a' : '#f0e0b8';
    ctx.strokeStyle = 'rgba(10,6,8,0.8)';
    ctx.lineWidth = 3;
    const label = this.isCrit ? `${this.text}!` : this.text;
    ctx.strokeText(label, this.x, this.y - rise);
    ctx.fillText(label, this.x, this.y - rise);
    ctx.restore();
  }
}
