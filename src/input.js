// Unified input layer: combines desktop (keyboard + mouse) and mobile
// (dual virtual joystick touch) controls into one per-frame control state
// that the rest of the game reads: { moveX, moveY, moveMag, aimAngle, firing }.
//
// Touch scheme mirrors a standard twin-stick shooter: a joystick claimed by
// a touch that starts on the left half of the screen drives movement; one
// claimed on the right half drives aim direction and fires while held past
// a small deadzone. Joysticks are "floating" — they appear wherever the
// thumb first touches down, not at a fixed anchor.

const JOYSTICK_MAX_RADIUS = 55; // logical px the nub can stray from its origin
const JOYSTICK_DEADZONE = 0.18; // fraction of max radius before it counts as input

class Joystick {
  constructor(zoneTest) {
    this.zoneTest = zoneTest; // (x, y) => boolean — which touches this stick may claim
    this.active = false;
    this.touchId = null;
    this.originX = 0;
    this.originY = 0;
    this.curX = 0;
    this.curY = 0;
  }

  tryClaim(identifier, x, y) {
    if (this.active || !this.zoneTest(x, y)) return false;
    this.active = true;
    this.touchId = identifier;
    this.originX = x;
    this.originY = y;
    this.curX = x;
    this.curY = y;
    return true;
  }

  move(identifier, x, y) {
    if (!this.active || identifier !== this.touchId) return;
    const dx = x - this.originX;
    const dy = y - this.originY;
    const d = Math.hypot(dx, dy);
    if (d > JOYSTICK_MAX_RADIUS) {
      const s = JOYSTICK_MAX_RADIUS / d;
      this.curX = this.originX + dx * s;
      this.curY = this.originY + dy * s;
    } else {
      this.curX = x;
      this.curY = y;
    }
  }

  release(identifier) {
    if (this.active && identifier === this.touchId) {
      this.active = false;
      this.touchId = null;
    }
  }

  /** Normalized direction + magnitude (0..1), or null if not active/inside the deadzone. */
  read() {
    if (!this.active) return null;
    const dx = this.curX - this.originX;
    const dy = this.curY - this.originY;
    const mag = clamp(Math.hypot(dx, dy) / JOYSTICK_MAX_RADIUS, 0, 1);
    if (mag < JOYSTICK_DEADZONE) return { x: 0, y: 0, mag: 0, angle: null };
    const norm = normalize(dx, dy);
    return { x: norm.x, y: norm.y, mag, angle: Math.atan2(dy, dx) };
  }
}

class InputManager {
  constructor(canvas, bounds) {
    this.canvas = canvas;
    this.bounds = bounds;
    this.keys = new Set();
    this.mouseX = bounds.width / 2;
    this.mouseY = bounds.height / 2;
    this.mouseDown = false;
    this.hasTouched = false; // once true, prefer touch controls over mouse hints
    this.suspended = false; // true while a non-gameplay UI (e.g. defense placement) owns taps

    this.moveStick = new Joystick((x) => x < bounds.width / 2);
    this.aimStick = new Joystick((x) => x >= bounds.width / 2);

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('mousemove', (e) => {
      const p = this._toCanvasSpace(e.clientX, e.clientY);
      this.mouseX = p.x;
      this.mouseY = p.y;
    });
    canvas.addEventListener('mousedown', () => { this.mouseDown = true; });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });

    canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
  }

  toCanvasSpace(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.bounds.width / rect.width),
      y: (clientY - rect.top) * (this.bounds.height / rect.height),
    };
  }

  _toCanvasSpace(clientX, clientY) {
    return this.toCanvasSpace(clientX, clientY);
  }

  _onTouchStart(e) {
    if (this.suspended) return;
    e.preventDefault();
    this.hasTouched = true;
    for (const t of e.changedTouches) {
      const p = this._toCanvasSpace(t.clientX, t.clientY);
      if (!this.moveStick.tryClaim(t.identifier, p.x, p.y)) {
        this.aimStick.tryClaim(t.identifier, p.x, p.y);
      }
    }
  }

  _onTouchMove(e) {
    if (this.suspended) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = this._toCanvasSpace(t.clientX, t.clientY);
      this.moveStick.move(t.identifier, p.x, p.y);
      this.aimStick.move(t.identifier, p.x, p.y);
    }
  }

  _onTouchEnd(e) {
    if (this.suspended) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      this.moveStick.release(t.identifier);
      this.aimStick.release(t.identifier);
    }
  }

  /** Releases any claimed sticks and stops responding to touch — used while a placement UI owns taps. */
  setSuspended(v) {
    this.suspended = v;
    if (v) {
      this.moveStick.active = false;
      this.aimStick.active = false;
    }
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** Resolves this frame's combined control state for the player to consume. */
  getControlState(playerX, playerY, prevAimAngle) {
    let moveX = 0;
    let moveY = 0;
    let moveMag = 1;

    const moveInput = this.moveStick.read();
    if (moveInput) {
      moveX = moveInput.x;
      moveY = moveInput.y;
      moveMag = moveInput.mag;
    } else {
      let dx = 0;
      let dy = 0;
      if (this.isDown('KeyW') || this.isDown('ArrowUp')) dy -= 1;
      if (this.isDown('KeyS') || this.isDown('ArrowDown')) dy += 1;
      if (this.isDown('KeyA') || this.isDown('ArrowLeft')) dx -= 1;
      if (this.isDown('KeyD') || this.isDown('ArrowRight')) dx += 1;
      const dir = normalize(dx, dy);
      moveX = dir.x;
      moveY = dir.y;
      moveMag = (dx !== 0 || dy !== 0) ? 1 : 0;
    }

    let aimAngle = prevAimAngle;
    let firing = false;

    const aimInput = this.aimStick.read();
    if (this.aimStick.active) {
      if (aimInput && aimInput.angle !== null) {
        aimAngle = aimInput.angle;
        firing = true;
      }
      // Stick is held but inside the deadzone: keep last aim, don't fire.
    } else if (!this.hasTouched) {
      aimAngle = Math.atan2(this.mouseY - playerY, this.mouseX - playerX);
      firing = this.mouseDown;
    }

    return { moveX, moveY, moveMag, aimAngle, firing };
  }
}
