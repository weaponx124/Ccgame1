// Minimal 2D vector helpers used across the game.

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function normalize(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
