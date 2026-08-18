// Real 3D rendering layer (Three.js / WebGL) for the game world. This is a hard swap from the
// old Canvas-2D hand-drawn-vector look to actual lit geometry: real meshes, real materials,
// real shadows cast by a moonlit directional light and flickering brazier point lights.
//
// Design: entities.js/defenses.js/effects.js stay pure logic — no rendering knowledge at all.
// Renderer3D owns a parallel set of THREE.Object3D "views", one per live entity, keyed in Maps
// so the same mesh is reused (and animated) frame to frame instead of being torn down and
// rebuilt. Each sync*() call reconciles one entity array against its Map: create a view for
// anything new, update transforms/materials for everything live, and remove views for anything
// that's gone. game.js calls the sync methods once per frame with the current entity arrays,
// then calls render().
//
// Coordinate mapping: the rest of the game still thinks entirely in the old 2D logical space
// (x in [0, bounds.width], y in [0, bounds.height], both increasing right/down). That space
// becomes the 3D ground plane: worldX = x - bounds.width/2, worldZ = y - bounds.height/2,
// worldY = height above the ground. Centering on the origin keeps camera/light math simple.

// Height (world-Y) the player's weapon barrel sits at — matched by buildPlayerModel()'s weapon
// pivot and reused for bullets' render height, so a shot visibly leaves from the barrel tip
// instead of popping to some unrelated fixed height the instant it spawns.
const PLAYER_MUZZLE_HEIGHT = 64;

class Renderer3D {
  constructor(canvas, bounds, dpr) {
    this.bounds = bounds;
    this.cx = bounds.width / 2;
    this.cy = bounds.height / 2;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(bounds.width, bounds.height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.9;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x100c1c, 0.00035);
    scene.background = new THREE.Color(0x0f0c1a);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(50, bounds.width / bounds.height, 10, 3000);
    camera.position.set(0, 640, 480);
    camera.lookAt(0, 0, -30);
    this.camera = camera;

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Every non-essential decorative mesh (rim-light shells, embers, fog wisps) registers itself
    // here so a single quality downgrade can hide all of them at once, without each one needing
    // its own bespoke toggle wiring. Set once, permanently, if a device turns out to be struggling
    // — see setLowQuality(). This sandbox can only test software-rendered WebGL (no real GPU), so
    // this is the safety net for whatever real-device performance turns out to actually be.
    this.lowQuality = false;
    this._toggleableMeshes = [];

    this._buildLighting();
    this._buildGround();
    this._buildEnvironment();
    this._buildFogWisps();

    this.playerView = null;
    this.enemyViews = new Map();
    this.bulletViews = new Map();
    this.fenceViews = new Map();
    this.mineViews = new Map();
    this.explosionViews = new Map();
    this.bloodDecals = new Map();
    this.hitSparkViews = new Map();
  }

  /** A one-time, one-way downgrade: drops shadow casting (the dominant draw-call cost, per prior
   *  profiling in this sandbox), the pixel ratio, and every decorative mesh registered in
   *  _toggleableMeshes (rim-light shells, embers, fog wisps) — call once if a device turns out to
   *  be genuinely struggling. Doesn't try to recover back to high quality; a device that needed
   *  this once will need it again, and flickering quality up/down mid-game would be worse than
   *  just staying simplified. */
  setLowQuality() {
    if (this.lowQuality) return;
    this.lowQuality = true;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.bounds.width, this.bounds.height, false);
    for (const mesh of this._toggleableMeshes) mesh.visible = false;
  }

  // ---------- Coordinate helpers ----------
  worldX(x) { return x - this.cx; }
  worldZ(y) { return y - this.cy; }

  /** Yaw (radians around world +Y) that makes a model's local +X axis — the forward direction
   *  every rig here is built along (legs/arms straddle it, the weapon points down it, a bullet's
   *  capsule is twisted to lie along it) — point along the given 2D logical-space angle (atan2
   *  convention: 0 = +x/east, increasing toward +y/south). Three.js's Y-rotation matrix maps
   *  local +X to world (cos θ, -sin θ) in (x, z); solving cos θ = cos(angle), -sin θ = sin(angle)
   *  gives θ = -angle. */
  yawFromAngle(angle) {
    return -angle;
  }

  /** Projects a logical (x, y) ground point + height to canvas-pixel screen space, for 2D
   *  overlay elements (damage numbers) that need to track a moving 3D-world position. */
  worldToScreen(x, y, height = 0) {
    const v = new THREE.Vector3(this.worldX(x), height, this.worldZ(y));
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.bounds.width,
      y: (-v.y * 0.5 + 0.5) * this.bounds.height,
    };
  }

  /** Raycasts a canvas-pixel point against the ground plane, returning logical (x, y) or null
   *  if the ray doesn't hit the ground (shouldn't happen with this camera, but be safe). */
  screenToGround(canvasX, canvasY) {
    const ndcX = (canvasX / this.bounds.width) * 2 - 1;
    const ndcY = -(canvasY / this.bounds.height) * 2 + 1;
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return { x: hit.x + this.cx, y: hit.z + this.cy };
  }

  // ---------- Lighting ----------
  // Three.js (r155+) point/spot lights use physically-based inverse-square falloff, which needs
  // much bigger intensity numbers than the old "legacy lights" defaults to read as visible at
  // game-relevant distances (a few dozen units). Directional/ambient/hemisphere light aren't
  // distance-attenuated, so those stay in a more familiar 0.5-3 range.
  _buildLighting() {
    const ambient = new THREE.AmbientLight(0x50506e, 1.7);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x54548a, 0x1a120d, 2.0);
    this.scene.add(hemi);

    const moon = new THREE.DirectionalLight(0xb8c4f0, 4.2);
    moon.position.set(-260, 620, -380);
    moon.target.position.set(0, 0, 0);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    const sc = moon.shadow.camera;
    sc.left = -560; sc.right = 560; sc.top = 400; sc.bottom = -400;
    sc.near = 100; sc.far = 1600;
    moon.shadow.bias = -0.0015;
    this.scene.add(moon);
    this.scene.add(moon.target);
    this.moonLight = moon;

    this.brazierLights = [];
  }

  // ---------- Ground ----------
  _bakeGroundTexture() {
    const size = 1024;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');

    const scaleX = size / this.bounds.width;
    const scaleY = size / this.bounds.height;

    g.fillStyle = '#1b1620';
    g.fillRect(0, 0, size, size);

    for (let i = 0; i < 90; i++) {
      const seed = i * 53.7;
      const x = (Math.sin(seed) * 0.5 + 0.5) * size;
      const y = (Math.sin(seed * 1.7 + 3) * 0.5 + 0.5) * size;
      const r = (18 + (i % 6) * 10) * ((scaleX + scaleY) / 2);
      const dark = i % 3 === 0;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      if (dark) {
        grad.addColorStop(0, 'rgba(0,0,0,0.28)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        grad.addColorStop(0, 'rgba(70,56,44,0.18)');
        grad.addColorStop(1, 'rgba(70,56,44,0)');
      }
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Moss patches.
    g.fillStyle = 'rgba(45, 60, 34, 0.16)';
    for (const [mx, my, mr] of [[0.37, 0.4, 32], [0.62, 0.58, 24], [0.26, 0.7, 28], [0.8, 0.55, 20]]) {
      g.beginPath();
      g.ellipse(mx * size, my * size, mr * scaleX * 2.2, mr * scaleY * 1.3, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Ground cracks.
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 3;
    const cracks = [[0.31, 0.28, 40, 0.4], [0.65, 0.2, 30, -0.3], [0.23, 0.74, 35, 1.1], [0.67, 0.61, 45, -0.8], [0.47, 0.85, 30, 0.2]];
    for (const [cx, cy, len, rot] of cracks) {
      const x = cx * size, y = cy * size, l = len * scaleX * 2.4;
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.beginPath();
      g.moveTo(-l / 2, 0);
      g.lineTo(-l / 6, l * 0.08);
      g.lineTo(l / 6, -l * 0.05);
      g.lineTo(l / 2, l * 0.05);
      g.stroke();
      g.restore();
    }

    // Old dried blood.
    for (const [bx, by, br] of [[0.35, 0.48, 16], [0.63, 0.37, 11], [0.58, 0.74, 18], [0.27, 0.63, 10]]) {
      g.fillStyle = 'rgba(50, 7, 9, 0.3)';
      const x = bx * size, y = by * size, r = br * scaleX * 2.2;
      for (const [dx, dy, s] of [[0, 0, 1], [r * 0.7, r * 0.2, 0.5], [-r * 0.5, r * 0.4, 0.4]]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, r * s, r * s * 0.6, 0, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Fine grain/noise.
    const grain = g.getImageData(0, 0, size, size);
    for (let i = 0; i < grain.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      grain.data[i] = clamp255(grain.data[i] + n);
      grain.data[i + 1] = clamp255(grain.data[i + 1] + n);
      grain.data[i + 2] = clamp255(grain.data[i + 2] + n);
    }
    g.putImageData(grain, 0, 0);

    function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildGround() {
    const tex = this._bakeGroundTexture();
    const geo = new THREE.PlaneGeometry(2000, 2000);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0.02 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // ---------- Static environment props ----------
  _buildEnvironment() {
    const TOMBSTONES = [
      { x: 55, y: 70, scale: 1.0, rot: -0.12 }, { x: 905, y: 85, scale: 0.85, rot: 0.16 },
      { x: 40, y: 465, scale: 1.1, rot: 0.06 }, { x: 915, y: 470, scale: 0.9, rot: -0.09 },
      { x: 480, y: 34, scale: 0.7, rot: 0.02 }, { x: 180, y: 500, scale: 0.75, rot: -0.05 },
    ];
    for (const t of TOMBSTONES) this.scene.add(this._makeTombstone(t.x, t.y, t.scale, t.rot));

    const DEAD_TREES = [
      { x: 140, y: 220, scale: 1.0, rot: -0.06 }, { x: 820, y: 195, scale: 0.85, rot: 0.08 },
      { x: 720, y: 480, scale: 0.95, rot: -0.04 },
    ];
    for (const t of DEAD_TREES) this.scene.add(this._makeDeadTree(t.x, t.y, t.scale, t.rot));

    this.scene.add(this._makeCrypt(850, 300));

    const BONE_PILES = [{ x: 420, y: 460 }, { x: 800, y: 130 }];
    for (const b of BONE_PILES) this.scene.add(this._makeBonePile(b.x, b.y));

    const BRAZIERS = [{ x: 250, y: 150 }, { x: 700, y: 400 }];
    for (const b of BRAZIERS) this._makeBrazier(b.x, b.y);
  }

  _makeTombstone(x, y, scale, rot) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x322c3a, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(15, 17, 44, 10, 1, false, 0, Math.PI), mat);
    body.rotation.z = Math.PI;
    body.rotation.y = Math.PI / 2;
    body.position.y = 30;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const base = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 12), mat);
    base.position.y = 5;
    base.castShadow = true;
    group.add(base);
    group.position.set(this.worldX(x), 0, this.worldZ(y));
    group.rotation.y = rot;
    group.scale.setScalar(scale);
    return group;
  }

  _makeDeadTree(x, y, scale, rot) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1e1712, roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 70, 6), mat);
    trunk.position.y = 35;
    trunk.castShadow = true;
    group.add(trunk);
    const branchDefs = [
      [0, 60, -18, 78], [0, 60, 16, 74], [-18, 78, -28, 92], [-18, 78, -6, 96], [16, 74, 30, 88],
    ];
    for (const [x1, y1, x2, y2] of branchDefs) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, len, 5), mat);
      branch.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
      branch.rotation.z = Math.atan2(dx, dy) * -1 + Math.PI / 2;
      group.add(branch);
    }
    group.position.set(this.worldX(x), 0, this.worldZ(y));
    group.rotation.y = rot;
    group.scale.setScalar(scale);
    return group;
  }

  _makeCrypt(x, y) {
    const group = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2c2634, roughness: 0.92 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(80, 50, 60), stoneMat);
    body.position.y = 25;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(58, 30, 4), stoneMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 65;
    roof.castShadow = true;
    group.add(roof);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x050308, roughness: 1 });
    const door = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 26, 12, 1, false, 0, Math.PI), doorMat);
    door.rotation.z = Math.PI;
    door.rotation.y = Math.PI / 2;
    door.position.set(0, 13, 30.5);
    group.add(door);
    const doorBase = new THREE.Mesh(new THREE.BoxGeometry(22, 13, 1), doorMat);
    doorBase.position.set(0, 6.5, 30.5);
    group.add(doorBase);
    group.position.set(this.worldX(x), 0, this.worldZ(y));
    return group;
  }

  _makeBonePile(x, y) {
    const group = new THREE.Group();
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xe4d8c0, roughness: 0.7 });
    for (const [bx, by, bz, rot] of [[-8, 1, 2, 0.3], [4, 1.5, -3, -0.6], [-2, 1, 6, 1.1]]) {
      const bone = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 12, 4, 6), boneMat);
      bone.position.set(bx, by, bz);
      bone.rotation.z = Math.PI / 2 + rot;
      bone.castShadow = true;
      bone.receiveShadow = true;
      group.add(bone);
    }
    const skull = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 8), boneMat);
    skull.position.set(-6, 4, -2);
    skull.castShadow = true;
    group.add(skull);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050308 });
    for (const ex of [-2, 2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 6), eyeMat);
      eye.position.set(-6 + ex, 4, 1.6);
      group.add(eye);
    }
    group.position.set(this.worldX(x), 0, this.worldZ(y));
    return group;
  }

  _makeBrazier(x, y) {
    const group = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2430, roughness: 0.6, metalness: 0.4 });
    for (const lx of [-5, 5]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 20, 6), metalMat);
      leg.position.set(lx, 10, 0);
      leg.rotation.z = lx * 0.05;
      leg.castShadow = true;
      group.add(leg);
    }
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(9, 6, 8, 10), metalMat);
    bowl.position.y = 21;
    bowl.castShadow = true;
    group.add(bowl);

    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(5, 16, 8), flameMat);
    flame.position.y = 30;
    group.add(flame);

    const light = new THREE.PointLight(0xff8c40, 60, 320, 1.5);
    light.position.set(0, 26, 0);
    group.add(light);

    const flameGlow = this._makeGlowSprite(0xffa040, 30, 0.85);
    flameGlow.position.set(0, 30, 0);
    group.add(flameGlow);

    // A handful of embers drifting up out of the bowl and guttering out — cheap per-sprite
    // animation (no particle buffer geometry needed at this count) that keeps a brazier reading
    // as a real fire instead of a static glowing cone.
    const embers = [];
    for (let i = 0; i < 7; i++) {
      const sprite = this._makeGlowSprite(0xff7028, 2.6 + Math.random() * 1.6, 0.8);
      sprite.visible = !this.lowQuality;
      this._toggleableMeshes.push(sprite);
      group.add(sprite);
      embers.push({
        sprite,
        angle: Math.random() * Math.PI * 2,
        radius: 3 + Math.random() * 6,
        swaySpeed: 0.5 + Math.random() * 0.7,
        riseSpeed: 8 + Math.random() * 7,
        phase: Math.random() * 10,
      });
    }

    group.position.set(this.worldX(x), 0, this.worldZ(y));
    this.scene.add(group);
    this.brazierLights.push({ light, flame, flameGlow, embers, baseX: x });
  }

  /** Soft radial-alpha blob used for the drifting ground-fog wisps below. */
  _bakeWispTexture() {
    if (Renderer3D._wispTexCache) return Renderer3D._wispTexCache;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(184,190,200,0.55)');
    grad.addColorStop(0.5, 'rgba(184,190,200,0.22)');
    grad.addColorStop(1, 'rgba(184,190,200,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    Renderer3D._wispTexCache = new THREE.CanvasTexture(c);
    return Renderer3D._wispTexCache;
  }

  /** A handful of low, slow-drifting ground-mist patches wandering around fixed points across the
   *  arena — cheap atmosphere (flat alpha-blended planes, no particle system) that makes the
   *  graveyard feel like it's breathing instead of a static backdrop. */
  _buildFogWisps() {
    const tex = this._bakeWispTexture();
    const wisps = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;
      const w = 220 + Math.random() * 160;
      mesh.scale.set(w, w * 0.6, 1);
      mesh.visible = !this.lowQuality;
      this._toggleableMeshes.push(mesh);
      this.scene.add(mesh);
      wisps.push({
        mesh,
        baseX: this.worldX(80 + Math.random() * (this.bounds.width - 160)),
        baseZ: this.worldZ(80 + Math.random() * (this.bounds.height - 160)),
        driftRadius: 40 + Math.random() * 60,
        driftSpeed: 0.04 + Math.random() * 0.04,
        baseOpacity: 0.09 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.fogWisps = wisps;
  }

  tickEnvironment(time) {
    if (!this.lowQuality) {
      for (const w of this.fogWisps) {
        w.mesh.position.set(
          w.baseX + Math.cos(time * w.driftSpeed + w.phase) * w.driftRadius,
          6,
          w.baseZ + Math.sin(time * w.driftSpeed * 0.7 + w.phase) * w.driftRadius * 0.6
        );
        w.mesh.material.opacity = w.baseOpacity + 0.04 * Math.sin(time * 0.25 + w.phase);
      }
    }
    for (const b of this.brazierLights) {
      const flicker = 0.75 + 0.25 * Math.sin(time * 9 + b.baseX) + 0.12 * Math.sin(time * 23 + b.baseX * 1.7);
      b.light.intensity = 55 * flicker;
      b.flame.scale.y = 0.8 + flicker * 0.35;
      b.flame.position.y = 26 + b.flame.scale.y * 8;
      b.flameGlow.scale.setScalar(26 * (0.85 + flicker * 0.3));
      b.flameGlow.material.opacity = 0.6 + flicker * 0.3;

      if (this.lowQuality) continue; // embers are hidden — no point animating them
      for (const e of b.embers) {
        const cycle = 10 / e.riseSpeed * 3; // seconds per ember before it loops back into the fire
        const t = ((time + e.phase) % cycle) / cycle;
        const y = 24 + t * 42;
        const wobble = Math.sin(time * e.swaySpeed * 4 + e.phase) * (2 + t * 3);
        e.sprite.position.set(Math.cos(e.angle) * e.radius + wobble, y, Math.sin(e.angle) * e.radius);
        e.sprite.material.opacity = (1 - t) * 0.75;
      }
    }
  }

  // ---------- Shared unit geometries (scaled per use, cheap to reuse) ----------
  static _geo() {
    if (Renderer3D._sharedGeo) return Renderer3D._sharedGeo;
    Renderer3D._sharedGeo = {
      sphere: new THREE.SphereGeometry(1, 14, 10),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
      box: new THREE.BoxGeometry(1, 1, 1),
      cone: new THREE.ConeGeometry(1, 1, 10),
      capsule: new THREE.CapsuleGeometry(1, 1, 4, 8),
    };
    return Renderer3D._sharedGeo;
  }

  /** Soft white radial-gradient texture, shared by every glow sprite (tinted per-use via the
   *  sprite material's own `color`) so there's exactly one small canvas bake for the whole scene
   *  instead of one per light source. */
  static _glowTex() {
    if (Renderer3D._glowTexCache) return Renderer3D._glowTexCache;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    Renderer3D._glowTexCache = new THREE.CanvasTexture(c);
    return Renderer3D._glowTexCache;
  }

  /** A camera-facing, unlit additive-blended glow billboard — the cheap way to make eyes, mine
   *  cores, and flames actually read as glowing instead of relying on the (much subtler) emissive
   *  material shading alone. `size` is the sprite's world-unit diameter. */
  _makeGlowSprite(color, size, opacity = 1) {
    const mat = new THREE.SpriteMaterial({
      map: Renderer3D._glowTex(),
      color,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(size);
    return sprite;
  }

  /** Bakes a small neutral-gray detail texture for creature skin/fur — cached per pattern (there
   *  are only 4: one per species-ish look), not per character or per color, since it's meant to be
   *  multiplied against whatever `material.color` already is rather than carry its own tint. Used
   *  as both the material's `map` and its `bumpMap` (the same luminance doubling as a height
   *  field) — real surface detail instead of a flat-shaded primitive, without needing a second
   *  bake or an actual normal map. */
  static _bakeSkinTexture(pattern) {
    if (!Renderer3D._skinTexCache) Renderer3D._skinTexCache = {};
    if (Renderer3D._skinTexCache[pattern]) return Renderer3D._skinTexCache[pattern];
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);

    if (pattern === 'mottle') {
      // Zombie: blotchy rot patches, some dark (decay), some pale (dead tissue).
      for (let i = 0; i < 46; i++) {
        const x = Math.random() * size, y = Math.random() * size, r = 6 + Math.random() * 22;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        const dark = Math.random() < 0.6;
        grad.addColorStop(0, dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    } else if (pattern === 'vein') {
      // Vampire: faint dark veins under pale skin.
      g.strokeStyle = 'rgba(20,10,40,0.22)';
      g.lineWidth = 1.4;
      for (let i = 0; i < 22; i++) {
        let x = Math.random() * size, y = Math.random() * size;
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 4; j++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
        g.stroke();
      }
    } else if (pattern === 'fur') {
      // Werewolf: dense directional strokes for a shaggy coat.
      for (let i = 0; i < 1100; i++) {
        const x = Math.random() * size, y = Math.random() * size;
        const len = 4 + Math.random() * 8;
        const ang = Math.PI / 2 + (Math.random() - 0.5) * 0.7;
        g.strokeStyle = Math.random() < 0.5 ? `rgba(0,0,0,${0.15 + Math.random() * 0.25})` : `rgba(255,255,255,${0.1 + Math.random() * 0.2})`;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
      }
    } else if (pattern === 'leather') {
      // Hunter: worn, stitched leather.
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = 'rgba(0,0,0,0.18)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, (i + 0.5) * (size / 5)); g.lineTo(size, (i + 0.5) * (size / 5)); g.stroke();
      }
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * size, y = Math.random() * size;
        g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
        g.fillRect(x, y, 2, 2);
      }
    } else if (pattern === 'armor') {
      // Revenant: pitted, riveted ancient plate.
      const cols = 5, rows = 5;
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const x = (cx + 0.5) * (size / cols), y = (cy + 0.5) * (size / rows);
          g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.1})`;
          g.fillRect(x - size / cols / 2 + 3, y - size / rows / 2 + 3, size / cols - 6, size / rows - 6);
          for (const [rx, ry] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            g.fillStyle = 'rgba(0,0,0,0.35)';
            g.beginPath(); g.arc(x + rx * (size / cols / 2 - 8), y + ry * (size / rows / 2 - 8), 2.4, 0, Math.PI * 2); g.fill();
          }
        }
      }
      for (let i = 0; i < 340; i++) {
        const x = Math.random() * size, y = Math.random() * size, r = 1 + Math.random() * 2.5;
        g.fillStyle = Math.random() < 0.6 ? `rgba(0,0,0,${0.2 + Math.random() * 0.2})` : `rgba(255,255,255,${0.08 + Math.random() * 0.1})`;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }

    const grain = g.getImageData(0, 0, size, size);
    for (let i = 0; i < grain.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      grain.data[i] = clamp255(grain.data[i] + n);
      grain.data[i + 1] = clamp255(grain.data[i + 1] + n);
      grain.data[i + 2] = clamp255(grain.data[i + 2] + n);
    }
    g.putImageData(grain, 0, 0);
    function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    Renderer3D._skinTexCache[pattern] = tex;
    return tex;
  }

  /** Clones a shared unit geometry and displaces each vertex along its own normal by a small
   *  random amount, then recomputes normals — turns a mathematically perfect sphere/capsule into
   *  something that reads as sculpted rather than an obviously untouched primitive. Cached per
   *  `key` (typically species+part) so every instance of a given species shares one jittered
   *  geometry instead of each character getting its own (and paying for it). */
  static _jitteredGeo(key, baseGeo, amount) {
    if (!Renderer3D._jitterCache) Renderer3D._jitterCache = {};
    if (Renderer3D._jitterCache[key]) return Renderer3D._jitterCache[key];
    const geo = baseGeo.clone();
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
      const d = (Math.random() - 0.5) * 2 * amount;
      pos.setXYZ(i, pos.getX(i) + nx * d, pos.getY(i) + ny * d, pos.getZ(i) + nz * d);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    Renderer3D._jitterCache[key] = geo;
    return geo;
  }

  /** A slightly-oversized, backside-only, additive-blended duplicate of a mesh — the classic cheap
   *  fake for a rim/backlight without a real shader pass. Tinted cool-blue to read as "lit by the
   *  moon from behind," consistent across every character. */
  _makeRimShell(geo, opacity = 0.3) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9fb4ff, transparent: true, opacity, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(1.07);
    mesh.visible = !this.lowQuality;
    this._toggleableMeshes.push(mesh);
    return mesh;
  }

  /** A capsule "bone" hanging down -length from its pivot (local origin), radius r, color. Unit
   *  capsule geometry is radius 1, cylindrical length 1 (total height 3), so scale accordingly.
   *  Limbs don't cast shadows — with up to 8 segments per character that's the single biggest
   *  shadow-map cost, and the torso/head shadow alone already reads fine as "someone is standing
   *  here". */
  _makeLimb(length, radius, color) {
    const geo = Renderer3D._geo().capsule;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(radius, Math.max(0.1, length - 2 * radius), radius);
    mesh.position.y = -length / 2;
    return mesh;
  }

  /** A two-segment limb (thigh+shin, or upper-arm+forearm): an upper segment hangs from `pivot`,
   *  then a joint group (knee/elbow) sits at its far end holding the lower segment. Splitting each
   *  limb into two independently-posable segments — instead of one capsule running straight from
   *  shoulder/hip to hand/foot — is what actually reads as a jointed limb instead of a stick.
   *  Returns the joint group so callers can bend it (syncPlayer/syncEnemies) and hang a foot/hand
   *  off its end. */
  _buildLimbSegments(pivot, upperLen, upperRadius, lowerLen, lowerRadius, color) {
    pivot.add(this._makeLimb(upperLen, upperRadius, color));
    const joint = new THREE.Group();
    joint.position.y = -upperLen;
    pivot.add(joint);
    joint.add(this._makeLimb(lowerLen, lowerRadius, color));
    return joint;
  }

  _addFoot(joint, lowerLen, radius, color) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const foot = new THREE.Mesh(Renderer3D._geo().box, mat);
    foot.scale.set(radius * 2.1, radius * 1.3, radius * 2.9);
    foot.position.set(0, -lowerLen - radius * 0.35, radius * 0.9);
    joint.add(foot);
    return foot;
  }

  _addHand(joint, lowerLen, radius, color) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const hand = new THREE.Mesh(Renderer3D._geo().sphere, mat);
    hand.scale.setScalar(radius * 1.4);
    hand.position.y = -lowerLen;
    joint.add(hand);
    return hand;
  }

  // ---------- Creatures: a shared rig (legs/arms/torso/head/eye) that per-type builders dress up ----------
  _buildCreatureBase(opts) {
    const { legLen, legRadius, torsoLen, torsoRadius, headRadius, skinColor, eyeColor, limbColor, torsoColor, hasJaw = true, texturePattern = 'leather' } = opts;
    const skinTex = Renderer3D._bakeSkinTexture(texturePattern);
    const group = new THREE.Group();

    const thighLen = legLen * 0.5;
    const shinLen = legLen - thighLen;
    const armLen = torsoLen * 0.85;
    const upperArmLen = armLen * 0.46;
    const forearmLen = armLen - upperArmLen;

    const hipL = new THREE.Group();
    hipL.position.set(-torsoRadius * 0.55, legLen, 0);
    const hipR = new THREE.Group();
    hipR.position.set(torsoRadius * 0.55, legLen, 0);
    const kneeL = this._buildLimbSegments(hipL, thighLen, legRadius, shinLen, legRadius * 0.82, limbColor);
    const kneeR = this._buildLimbSegments(hipR, thighLen, legRadius, shinLen, legRadius * 0.82, limbColor);
    this._addFoot(kneeL, shinLen, legRadius * 0.82, limbColor);
    this._addFoot(kneeR, shinLen, legRadius * 0.82, limbColor);
    group.add(hipL, hipR);

    const shoulderY = legLen + torsoLen;
    const shoulderL = new THREE.Group();
    shoulderL.position.set(-torsoRadius * 0.95, shoulderY, 0);
    const shoulderR = new THREE.Group();
    shoulderR.position.set(torsoRadius * 0.95, shoulderY, 0);
    const elbowL = this._buildLimbSegments(shoulderL, upperArmLen, legRadius * 0.75, forearmLen, legRadius * 0.6, limbColor);
    const elbowR = this._buildLimbSegments(shoulderR, upperArmLen, legRadius * 0.75, forearmLen, legRadius * 0.6, limbColor);
    this._addHand(elbowL, forearmLen, legRadius * 0.6, skinColor);
    this._addHand(elbowR, forearmLen, legRadius * 0.6, skinColor);
    group.add(shoulderL, shoulderR);

    // Shoulder caps hide the harsh seam where an arm pivot meets the torso.
    const capMat = new THREE.MeshStandardMaterial({ color: torsoColor, roughness: 0.8 });
    for (const s of [shoulderL, shoulderR]) {
      const cap = new THREE.Mesh(Renderer3D._geo().sphere, capMat);
      cap.scale.setScalar(legRadius * 0.85);
      s.add(cap);
    }

    const torsoMat = new THREE.MeshStandardMaterial({ color: torsoColor, roughness: 0.8, map: skinTex, bumpMap: skinTex, bumpScale: 2.2 });
    const torsoGeo = Renderer3D._jitteredGeo('torso-' + texturePattern, Renderer3D._geo().capsule, 0.05);
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.scale.set(torsoRadius, Math.max(0.1, torsoLen - torsoRadius * 1.6), torsoRadius);
    torso.position.y = legLen + torsoLen / 2;
    torso.castShadow = true;
    torso.receiveShadow = true;
    group.add(torso);
    torso.add(this._makeRimShell(torsoGeo));

    // A waist band breaks up the torso capsule's uniform taper instead of reading as one smooth tube.
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.7 });
    const belt = new THREE.Mesh(Renderer3D._geo().cylinder, beltMat);
    belt.scale.set(torsoRadius * 1.08, torsoRadius * 0.22, torsoRadius * 1.08);
    belt.position.y = legLen + torsoRadius * 0.55;
    group.add(belt);

    const headGroup = new THREE.Group();
    headGroup.position.y = legLen + torsoLen + headRadius * 0.7;
    const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.75, map: skinTex, bumpMap: skinTex, bumpScale: 1.8 });
    const headGeo = Renderer3D._jitteredGeo('head-' + texturePattern, Renderer3D._geo().sphere, 0.07);
    const head = new THREE.Mesh(headGeo, headMat);
    head.scale.setScalar(headRadius);
    head.castShadow = true;
    headGroup.add(head);
    head.add(this._makeRimShell(headGeo, 0.22));

    if (hasJaw) {
      // A jaw/chin so the face reads as an actual head shape instead of just eye dots floating on
      // a bare sphere.
      const jaw = new THREE.Mesh(Renderer3D._geo().sphere, headMat);
      jaw.scale.set(headRadius * 0.55, headRadius * 0.38, headRadius * 0.5);
      jaw.position.set(0, -headRadius * 0.42, headRadius * 0.55);
      headGroup.add(jaw);
    }

    const eyeMat = new THREE.MeshStandardMaterial({ color: eyeColor, emissive: eyeColor, emissiveIntensity: 2 });
    const eye = new THREE.Mesh(Renderer3D._geo().sphere, eyeMat);
    eye.scale.setScalar(headRadius * 0.14);
    eye.position.set(headRadius * 0.65, headRadius * 0.05, headRadius * 0.6);
    headGroup.add(eye);

    // A small additive glow riding on the eye — the emissive material alone reads as barely more
    // than a bright dot; this is what actually makes it look like it's glowing in the dark.
    const eyeGlow = this._makeGlowSprite(eyeColor, headRadius * 0.85, 0.9);
    eyeGlow.position.copy(eye.position);
    headGroup.add(eyeGlow);

    group.add(headGroup);

    // Idle "breathing" bob (see syncPlayer/syncEnemies) offsets headGroup.position.y each frame
    // relative to this rest height, so a standing-still character never looks perfectly frozen.
    const headBaseY = headGroup.position.y;

    return {
      group, hipL, hipR, kneeL, kneeR, shoulderL, shoulderR, elbowL, elbowR,
      torso, torsoMat, head, headMat, headGroup, headBaseY, eye, eyeMat, eyeGlow,
      legLen, torsoLen, headRadius, torsoRadius, thighLen, shinLen, upperArmLen, forearmLen,
    };
  }

  buildPlayerModel() {
    const rig = this._buildCreatureBase({
      legLen: 30, legRadius: 5, torsoLen: 34, torsoRadius: 11, headRadius: 8,
      skinColor: 0x6b5040, eyeColor: 0xf0d98c, limbColor: 0x3a2a20, torsoColor: 0x5a4030,
    });

    const cloakMat = new THREE.MeshStandardMaterial({ color: 0x0d0a0d, roughness: 0.92, side: THREE.DoubleSide });
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(15, 42, 8, 1, true), cloakMat);
    cloak.position.set(0, rig.legLen + rig.torsoLen * 0.42, -5);
    cloak.rotation.x = Math.PI;
    cloak.castShadow = true;
    rig.group.add(cloak);

    // A pointed hood riding on the head (moves with the idle breathing bob) — what actually reads
    // as "hooded hunter" instead of just "guy with a cape".
    const hood = new THREE.Mesh(new THREE.ConeGeometry(rig.headRadius * 1.05, rig.headRadius * 2.4, 8, 1, true), cloakMat);
    hood.position.set(0, rig.headRadius * 0.5, -rig.headRadius * 0.35);
    hood.rotation.x = Math.PI * 0.94;
    hood.castShadow = true;
    rig.headGroup.add(hood);

    // A diagonal bandolier strap across the chest — hunter's gear, not bare clothing.
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.85 });
    const strap = new THREE.Mesh(Renderer3D._geo().box, strapMat);
    strap.scale.set(2.2, rig.torsoLen * 1.05, 2.4);
    strap.position.set(rig.torsoRadius * 0.3, rig.legLen + rig.torsoLen / 2, rig.torsoRadius * 0.4);
    strap.rotation.z = 0.55;
    strap.castShadow = true;
    rig.group.add(strap);

    // The barrel reaches exactly PLAYER_MUZZLE_DISTANCE (entities.js) from the group origin, so
    // Player.getMuzzlePosition() — where bullets actually spawn — always matches the visible tip.
    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(rig.torsoRadius * 0.9, PLAYER_MUZZLE_HEIGHT, 0);
    const muzzleReach = PLAYER_MUZZLE_DISTANCE - weaponPivot.position.x;
    const weaponMat = new THREE.MeshStandardMaterial({ color: 0x8a8a94, roughness: 0.4, metalness: 0.6 });
    const weaponBar = new THREE.Mesh(Renderer3D._geo().cylinder, weaponMat);
    weaponBar.scale.set(1.3, muzzleReach, 1.3);
    weaponBar.rotation.z = Math.PI / 2;
    weaponBar.position.x = muzzleReach / 2;
    weaponBar.castShadow = true;
    weaponPivot.add(weaponBar);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xf0d98c, emissive: 0xf0d98c, emissiveIntensity: 1.6 });
    const tip = new THREE.Mesh(Renderer3D._geo().sphere, tipMat);
    tip.scale.setScalar(1.8);
    tip.position.x = muzzleReach;
    weaponPivot.add(tip);
    const tipGlow = this._makeGlowSprite(0xf0d98c, 10, 0.85);
    tipGlow.position.copy(tip.position);
    weaponPivot.add(tipGlow);
    rig.group.add(weaponPivot);

    return { ...rig, cloak, weaponPivot };
  }

  buildZombieModel() {
    const rig = this._buildCreatureBase({
      legLen: 22, legRadius: 4, torsoLen: 24, torsoRadius: 8, headRadius: 6,
      skinColor: 0x5f6f3c, eyeColor: 0xe0202f, limbColor: 0x3f5527, torsoColor: 0x4a5828,
      hasJaw: false, // builds its own darker, gaping-jaw shape below instead of the shared one
      texturePattern: 'mottle',
    });
    const tatterMat = new THREE.MeshStandardMaterial({ color: 0x242c14, roughness: 1, side: THREE.DoubleSide });
    for (const a of [0, 1.2, 2.4, 3.6, 4.8]) {
      const tatter = new THREE.Mesh(new THREE.PlaneGeometry(4, 9), tatterMat);
      tatter.position.set(Math.cos(a) * 7, rig.legLen + 6, Math.sin(a) * 7);
      tatter.rotation.y = a;
      rig.group.add(tatter);
    }
    const jawMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 });
    const jaw = new THREE.Mesh(Renderer3D._geo().sphere, jawMat);
    jaw.scale.set(rig.headRadius * 0.45, rig.headRadius * 0.3, rig.headRadius * 0.4);
    jaw.position.set(0, rig.legLen + rig.torsoLen - rig.headRadius * 0.2, rig.headRadius * 0.5);
    rig.group.add(jaw);

    // Exposed ribs on the chest — a rotting corpse, not just a green person.
    const ribMat = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.8 });
    for (const rx of [-2.6, -0.6, 1.6]) {
      const rib = new THREE.Mesh(Renderer3D._geo().box, ribMat);
      rib.scale.set(1, 5.5, 1.1);
      rib.position.set(rx, rig.legLen + rig.torsoLen * 0.58, rig.torsoRadius * 0.88);
      rig.group.add(rib);
    }

    // A dark rot patch decal on the torso.
    const rotMat = new THREE.MeshStandardMaterial({ color: 0x232f16, roughness: 1 });
    const rotPatch = new THREE.Mesh(Renderer3D._geo().sphere, rotMat);
    rotPatch.scale.set(3, 2, 0.5);
    rotPatch.position.set(3.4, rig.legLen + rig.torsoLen * 0.78, rig.torsoRadius * 0.92);
    rig.group.add(rotPatch);

    // Patchy scalp — a few ragged tufts instead of a bald sphere.
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x14170c, roughness: 1 });
    for (const [hx, hz] of [[-2.6, -2.4], [2.1, -1.6], [0.3, -3.3]]) {
      const tuft = new THREE.Mesh(Renderer3D._geo().cone, hairMat);
      tuft.scale.set(0.7, 2.5, 0.7);
      tuft.position.set(hx, rig.headRadius * 0.75, hz);
      rig.headGroup.add(tuft);
    }

    return rig;
  }

  buildVampireModel() {
    const rig = this._buildCreatureBase({
      legLen: 25, legRadius: 3.4, torsoLen: 23, torsoRadius: 6.5, headRadius: 5.6,
      skinColor: 0xd4c8be, eyeColor: 0xff1030, limbColor: 0x2a1522, torsoColor: 0x3f1826,
      texturePattern: 'vein',
    });
    const capeMat = new THREE.MeshStandardMaterial({ color: 0x2f050d, roughness: 0.85, side: THREE.DoubleSide });
    const cape = new THREE.Mesh(new THREE.ConeGeometry(13, 40, 6, 1, true), capeMat);
    cape.position.set(0, rig.legLen + rig.torsoLen * 0.32, -5);
    cape.rotation.x = Math.PI;
    cape.castShadow = true;
    rig.group.add(cape);
    const fangMat = new THREE.MeshStandardMaterial({ color: 0xf8f2ea });
    for (const fx of [-1, 1]) {
      const fang = new THREE.Mesh(Renderer3D._geo().cone, fangMat);
      fang.scale.set(0.7, 1.6, 0.7);
      fang.position.set(fx * rig.headRadius * 0.25, rig.legLen + rig.torsoLen - rig.headRadius * 0.1, rig.headRadius * 0.65);
      fang.rotation.x = Math.PI;
      rig.group.add(fang);
    }

    // Slicked-back hair and a widow's peak — the "aristocrat", not just a pale person with fangs.
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x0d0508, roughness: 0.4, metalness: 0.2 });
    const hairCap = new THREE.Mesh(Renderer3D._geo().sphere, hairMat);
    hairCap.scale.set(rig.headRadius * 1.03, rig.headRadius * 0.6, rig.headRadius * 1.03);
    hairCap.position.set(0, rig.headRadius * 0.32, -rig.headRadius * 0.1);
    rig.headGroup.add(hairCap);
    const peak = new THREE.Mesh(Renderer3D._geo().cone, hairMat);
    peak.scale.set(0.85, 1.4, 0.85);
    peak.position.set(0, rig.headRadius * 0.58, rig.headRadius * 0.68);
    peak.rotation.x = Math.PI;
    rig.headGroup.add(peak);

    // A popped, angular collar flanking the neck — classic vampire silhouette.
    const collarMat = new THREE.MeshStandardMaterial({ color: 0x1c0a12, roughness: 0.55 });
    for (const cx of [-1, 1]) {
      const collar = new THREE.Mesh(Renderer3D._geo().box, collarMat);
      collar.scale.set(2, 11, 1.4);
      collar.position.set(cx * rig.torsoRadius * 0.72, rig.legLen + rig.torsoLen + 3, -1.5);
      collar.rotation.z = cx * -0.5;
      collar.castShadow = true;
      rig.group.add(collar);
    }

    return { ...rig, cape };
  }

  buildWerewolfModel() {
    const rig = this._buildCreatureBase({
      legLen: 25, legRadius: 6, torsoLen: 32, torsoRadius: 12.5, headRadius: 8,
      skinColor: 0x6b4f38, eyeColor: 0xf0c020, limbColor: 0x453220, torsoColor: 0x5c4530,
      texturePattern: 'fur',
    });
    const earMat = new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 1 });
    for (const ex of [-1, 1]) {
      const ear = new THREE.Mesh(Renderer3D._geo().cone, earMat);
      ear.scale.set(2.6, 6, 2.6);
      ear.position.set(ex * 3.6, rig.legLen + rig.torsoLen + rig.headRadius * 1.5, -1);
      rig.group.add(ear);
    }

    // A snout, not just a fang floating on a round head — the single biggest thing that reads as
    // "wolf" instead of "person".
    const snout = new THREE.Mesh(Renderer3D._geo().box, rig.headMat);
    snout.scale.set(rig.headRadius * 0.5, rig.headRadius * 0.42, rig.headRadius * 0.95);
    snout.position.set(0, -rig.headRadius * 0.12, rig.headRadius * 0.85);
    rig.headGroup.add(snout);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.9 });
    const nose = new THREE.Mesh(Renderer3D._geo().sphere, noseMat);
    nose.scale.setScalar(rig.headRadius * 0.16);
    nose.position.set(0, -rig.headRadius * 0.1, rig.headRadius * 1.28);
    rig.headGroup.add(nose);
    const fangMat = new THREE.MeshStandardMaterial({ color: 0xf4eee0 });
    for (const fx of [-1, 1]) {
      const fang = new THREE.Mesh(Renderer3D._geo().cone, fangMat);
      fang.scale.set(0.75, 1.8, 0.75);
      fang.position.set(fx * rig.headRadius * 0.28, -rig.headRadius * 0.3, rig.headRadius * 1.05);
      fang.rotation.x = Math.PI;
      rig.headGroup.add(fang);
    }

    // A ragged fur ridge along the spine.
    const furMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });
    for (const fy of [0.28, 0.52, 0.76]) {
      const spike = new THREE.Mesh(Renderer3D._geo().cone, furMat);
      spike.scale.set(1.7, 5, 1.7);
      spike.position.set(0, rig.legLen + rig.torsoLen * fy, -rig.torsoRadius * 0.85);
      spike.rotation.x = -0.35;
      rig.group.add(spike);
    }

    // A tail.
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x453220, roughness: 0.9 });
    const tail = new THREE.Mesh(Renderer3D._geo().capsule, tailMat);
    tail.scale.set(2.6, 15, 2.6);
    tail.position.set(0, rig.legLen + rig.torsoRadius * 0.35, -rig.torsoRadius * 1.05);
    tail.rotation.x = Math.PI * 0.4;
    rig.group.add(tail);

    // Claws on every limb, not just the legs — hands are the ones that actually threaten the player.
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0 });
    for (const knee of [rig.kneeL, rig.kneeR]) {
      const claw = new THREE.Mesh(Renderer3D._geo().cone, clawMat);
      claw.scale.set(1.2, 3, 1.2);
      claw.position.set(0, -rig.shinLen + 1, 3);
      claw.rotation.x = Math.PI * 0.6;
      knee.add(claw);
    }
    for (const elbow of [rig.elbowL, rig.elbowR]) {
      for (const cx of [-1.4, 0, 1.4]) {
        const claw = new THREE.Mesh(Renderer3D._geo().cone, clawMat);
        claw.scale.set(0.8, 2.2, 0.8);
        claw.position.set(cx, -rig.forearmLen - 1, 1.5);
        claw.rotation.x = Math.PI * 0.55;
        elbow.add(claw);
      }
    }

    return rig;
  }

  /** The boss: a hulking, ward-corrupted revenant knight. Appears alone on boss waves
   *  (WaveManager.isBossWave) — deliberately built at a much larger scale than the regular three
   *  types, in ancient pitted plate armor with the same violet glow as the ward's own altar, so
   *  it visually reads as "the ward's corrupted guardian" rather than just a bigger zombie. */
  buildRevenantModel() {
    const rig = this._buildCreatureBase({
      legLen: 34, legRadius: 8, torsoLen: 46, torsoRadius: 18, headRadius: 10,
      skinColor: 0x8a8478, eyeColor: 0xb060ff, limbColor: 0x342e28, torsoColor: 0x3a352e,
      texturePattern: 'armor',
    });

    const armorMat = new THREE.MeshStandardMaterial({ color: 0x2c2822, roughness: 0.55, metalness: 0.6, map: Renderer3D._bakeSkinTexture('armor'), bumpMap: Renderer3D._bakeSkinTexture('armor'), bumpScale: 2.5 });
    const runeGlow = 0xb060ff;

    // A heavy breastplate over the torso.
    const chest = new THREE.Mesh(Renderer3D._geo().box, armorMat);
    chest.scale.set(rig.torsoRadius * 1.7, rig.torsoLen * 0.62, rig.torsoRadius * 1.15);
    chest.position.set(0, rig.legLen + rig.torsoLen * 0.62, rig.torsoRadius * 0.15);
    chest.castShadow = true;
    rig.group.add(chest);

    // A cracked rune glowing through the breastplate — the "corrupted by the ward" tell.
    const rune = new THREE.Mesh(Renderer3D._geo().box, new THREE.MeshStandardMaterial({ color: runeGlow, emissive: runeGlow, emissiveIntensity: 2.2 }));
    rune.scale.set(rig.torsoRadius * 0.35, rig.torsoRadius * 0.5, 1);
    rune.position.set(0, rig.legLen + rig.torsoLen * 0.68, rig.torsoRadius * 0.75);
    rig.group.add(rune);
    const runeGlowSprite = this._makeGlowSprite(runeGlow, rig.torsoRadius * 1.3, 0.9);
    runeGlowSprite.position.copy(rune.position);
    rig.group.add(runeGlowSprite);

    // Oversized pauldrons on both shoulders.
    for (const s of [rig.shoulderL, rig.shoulderR]) {
      const pauldron = new THREE.Mesh(Renderer3D._geo().sphere, armorMat);
      pauldron.scale.setScalar(rig.legRadius * 1.6);
      pauldron.castShadow = true;
      s.add(pauldron);
      const spike = new THREE.Mesh(Renderer3D._geo().cone, armorMat);
      spike.scale.set(1.6, 6, 1.6);
      spike.position.y = rig.legRadius * 1.2;
      s.add(spike);
    }

    // Greaves on the shins.
    for (const knee of [rig.kneeL, rig.kneeR]) {
      const greave = new THREE.Mesh(Renderer3D._geo().cylinder, armorMat);
      greave.scale.set(rig.legRadius * 0.95, rig.shinLen * 0.55, rig.legRadius * 0.95);
      greave.position.y = -rig.shinLen * 0.35;
      knee.add(greave);
    }

    // A tattered ceremonial banner hanging from the waist — echoes the hunter's cloak/vampire's
    // cape silhouette language, but shredded and colorless. A single wide plane rather than
    // several strips — this boss already carries more meshes than any regular enemy (armor,
    // weapon, helm), so it's worth being economical about further additions with a similar look.
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.95, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(16, 26), bannerMat);
    banner.position.set(0, rig.legLen - 4, -rig.torsoRadius * 0.5);
    banner.rotation.x = 0.15;
    rig.group.add(banner);

    // A gaunt, half-skeletal helm instead of the shared jaw — hollow save for the glowing eyes.
    const helmMat = new THREE.MeshStandardMaterial({ color: 0x24211c, roughness: 0.6, metalness: 0.5 });
    const helm = new THREE.Mesh(Renderer3D._geo().sphere, helmMat);
    helm.scale.set(rig.headRadius * 1.08, rig.headRadius * 0.65, rig.headRadius * 1.08);
    helm.position.y = rig.headRadius * 0.35;
    helm.castShadow = true;
    rig.headGroup.add(helm);
    const horn1 = new THREE.Mesh(Renderer3D._geo().cone, helmMat);
    horn1.scale.set(1.3, 7, 1.3);
    horn1.position.set(-rig.headRadius * 0.5, rig.headRadius * 0.7, -rig.headRadius * 0.1);
    horn1.rotation.z = 0.3;
    rig.headGroup.add(horn1);
    const horn2 = horn1.clone();
    horn2.position.x *= -1;
    horn2.rotation.z *= -1;
    rig.headGroup.add(horn2);

    // A massive two-handed cleaver held in front — the boss's whole silhouette should read as
    // "this hits hard", not just "this has a lot of HP".
    const weaponMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.5, metalness: 0.7 });
    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(rig.torsoRadius * 0.9, rig.legLen + rig.torsoLen * 0.55, rig.torsoRadius * 0.6);
    const haft = new THREE.Mesh(Renderer3D._geo().cylinder, weaponMat);
    haft.scale.set(1.8, 30, 1.8);
    haft.position.y = 15;
    haft.castShadow = true;
    weaponPivot.add(haft);
    const blade = new THREE.Mesh(Renderer3D._geo().box, weaponMat);
    blade.scale.set(10, 34, 3);
    blade.position.y = 46;
    blade.rotation.z = 0.08;
    blade.castShadow = true;
    weaponPivot.add(blade);
    const bladeGlow = this._makeGlowSprite(runeGlow, 10, 0.6);
    bladeGlow.position.set(0, 46, 0);
    weaponPivot.add(bladeGlow);
    rig.group.add(weaponPivot);

    return { ...rig, weaponPivot };
  }

  /** Boss #2: a bound, ethereal vampire-lord who fights by teleporting into melee range rather
   *  than closing distance normally — the "corrupted spirit" reading (icy palette, tattered
   *  ghost-cloak, dangling manacle) is what sells the ambush pattern before the player even sees
   *  it blink. */
  buildWraithModel() {
    const rig = this._buildCreatureBase({
      legLen: 32, legRadius: 3.6, torsoLen: 30, torsoRadius: 8, headRadius: 7,
      skinColor: 0xc8d8dc, eyeColor: 0x40e0ff, limbColor: 0x1a2226, torsoColor: 0x1f2c30,
      texturePattern: 'vein',
    });

    // A long, tattered ethereal cloak — bigger and more ragged than the regular vampire's cape,
    // and semi-transparent to read as ghostly rather than solid cloth.
    const cloakMat = new THREE.MeshStandardMaterial({ color: 0x0c1416, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(16, 50, 7, 1, true), cloakMat);
    cloak.position.set(0, rig.legLen + rig.torsoLen * 0.28, -6);
    cloak.rotation.x = Math.PI;
    cloak.castShadow = true;
    rig.group.add(cloak);

    // A tattered hood — echoes the hunter's, corrupted.
    const hoodMat = new THREE.MeshStandardMaterial({ color: 0x111a1c, roughness: 0.85 });
    const hood = new THREE.Mesh(new THREE.ConeGeometry(rig.headRadius * 1.15, rig.headRadius * 2.6, 7, 1, true), hoodMat);
    hood.position.set(0, rig.headRadius * 0.55, -rig.headRadius * 0.3);
    hood.rotation.x = Math.PI * 0.94;
    rig.headGroup.add(hood);

    // A broken manacle and chain dangling from one wrist — a bound spirit, not just a fast
    // vampire, and the detail most likely to actually read at gameplay zoom given its motion.
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x5a6062, roughness: 0.4, metalness: 0.7 });
    for (let i = 0; i < 4; i++) {
      const link = new THREE.Mesh(Renderer3D._geo().cylinder, chainMat);
      link.scale.set(0.7, 2.2, 0.7);
      link.position.set(0, -rig.forearmLen - 3 - i * 2, 0);
      link.rotation.z = i % 2 === 0 ? 0.5 : -0.5;
      rig.elbowR.add(link);
    }

    // Long skeletal claws instead of ordinary hands.
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xe8f0f0 });
    for (const elbow of [rig.elbowL, rig.elbowR]) {
      for (const cx of [-1, 0, 1]) {
        const claw = new THREE.Mesh(Renderer3D._geo().cone, clawMat);
        claw.scale.set(0.6, 3.4, 0.6);
        claw.position.set(cx * 1.1, -rig.forearmLen - 1, 1.6);
        claw.rotation.x = Math.PI * 0.55;
        elbow.add(claw);
      }
    }

    return { ...rig, cloak };
  }

  /** Boss #3: a pack-leader werewolf — bigger, scarred, and maned, distinguished from the regular
   *  werewolf far more than just scale. Unlike the other two bosses it keeps normal melee contact
   *  damage (see game.js), so its silhouette needs to read as an immediate physical threat, not
   *  just a caster standing off to the side. */
  buildAlphaModel() {
    const rig = this._buildCreatureBase({
      legLen: 34, legRadius: 8.5, torsoLen: 44, torsoRadius: 17, headRadius: 11,
      skinColor: 0x3c2c1c, eyeColor: 0xff5a18, limbColor: 0x241a10, torsoColor: 0x2e2014,
      texturePattern: 'fur',
    });

    const earMat = new THREE.MeshStandardMaterial({ color: 0x140e08, roughness: 1 });
    for (const ex of [-1, 1]) {
      const ear = new THREE.Mesh(Renderer3D._geo().cone, earMat);
      ear.scale.set(3.4, 8, 3.4);
      ear.position.set(ex * 4.8, rig.legLen + rig.torsoLen + rig.headRadius * 1.5, -1);
      rig.group.add(ear);
    }

    // A broader, heavier snout with a full set of fangs — the face needs to read as meaningfully
    // more brutal than a regular werewolf's, not just bigger.
    const snout = new THREE.Mesh(Renderer3D._geo().box, rig.headMat);
    snout.scale.set(rig.headRadius * 0.58, rig.headRadius * 0.48, rig.headRadius * 1.05);
    snout.position.set(0, -rig.headRadius * 0.14, rig.headRadius * 0.9);
    rig.headGroup.add(snout);
    const fangMat = new THREE.MeshStandardMaterial({ color: 0xf4eee0 });
    for (const fx of [-1.5, -0.5, 0.5, 1.5]) {
      const fang = new THREE.Mesh(Renderer3D._geo().cone, fangMat);
      fang.scale.set(0.7, 2.4, 0.7);
      fang.position.set(fx * rig.headRadius * 0.16, -rig.headRadius * 0.34, rig.headRadius * 1.15);
      fang.rotation.x = Math.PI;
      rig.headGroup.add(fang);
    }

    // A thick mane around the neck/shoulders — the single biggest "this is the pack leader" tell.
    const maneMat = new THREE.MeshStandardMaterial({ color: 0x1c140c, roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const spike = new THREE.Mesh(Renderer3D._geo().cone, maneMat);
      spike.scale.set(2.1, 7, 2.1);
      spike.position.set(Math.cos(a) * rig.torsoRadius * 0.9, rig.legLen + rig.torsoLen * 0.92, Math.sin(a) * rig.torsoRadius * 0.9);
      spike.rotation.x = Math.cos(a) * 0.6;
      spike.rotation.z = Math.sin(a) * -0.6;
      rig.group.add(spike);
    }

    // Battle-scar gashes across the torso.
    const scarMat = new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 1 });
    for (const [sx, sy] of [[-3, 0.55], [2, 0.68]]) {
      const scar = new THREE.Mesh(Renderer3D._geo().box, scarMat);
      scar.scale.set(0.8, 9, 0.6);
      scar.position.set(sx, rig.legLen + rig.torsoLen * sy, rig.torsoRadius * 0.95);
      scar.rotation.z = 0.4;
      rig.group.add(scar);
    }

    // A trophy necklace of bone/tooth fragments — pack-leader flavor.
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.7 });
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      const bone = new THREE.Mesh(Renderer3D._geo().cone, boneMat);
      bone.scale.set(0.6, 2.2, 0.6);
      bone.position.set(Math.sin(a) * rig.torsoRadius * 0.7, rig.legLen + rig.torsoLen + 1 - Math.cos(a) * 3, rig.torsoRadius * 0.85);
      bone.rotation.x = Math.PI * 0.5;
      rig.group.add(bone);
    }

    // Heavier claws on every limb than the regular werewolf's.
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0 });
    for (const knee of [rig.kneeL, rig.kneeR]) {
      const claw = new THREE.Mesh(Renderer3D._geo().cone, clawMat);
      claw.scale.set(1.6, 4, 1.6);
      claw.position.set(0, -rig.shinLen + 1, 3.4);
      claw.rotation.x = Math.PI * 0.6;
      knee.add(claw);
    }
    for (const elbow of [rig.elbowL, rig.elbowR]) {
      for (const cx of [-1.6, 0, 1.6]) {
        const claw = new THREE.Mesh(Renderer3D._geo().cone, clawMat);
        claw.scale.set(1, 3, 1);
        claw.position.set(cx, -rig.forearmLen - 1, 1.8);
        claw.rotation.x = Math.PI * 0.55;
        elbow.add(claw);
      }
    }

    return rig;
  }

  _buildByType(typeKey) {
    if (typeKey === 'vampire') return this.buildVampireModel();
    if (typeKey === 'werewolf') return this.buildWerewolfModel();
    if (typeKey === 'revenant') return this.buildRevenantModel();
    if (typeKey === 'wraith') return this.buildWraithModel();
    if (typeKey === 'alpha') return this.buildAlphaModel();
    return this.buildZombieModel();
  }

  _disposeView(v) {
    v.group.traverse((obj) => {
      if (obj.material && obj.material.dispose) obj.material.dispose();
    });
  }

  // ---------- Non-creature props ----------
  buildBaseModel(radius) {
    const group = new THREE.Group();
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x1e1826, roughness: 0.92 });
    const slab = new THREE.Mesh(Renderer3D._geo().box, stepMat);
    slab.scale.set(radius * 2.5, radius * 0.3, radius * 2.5);
    slab.position.y = radius * 0.15;
    slab.receiveShadow = true;
    slab.castShadow = true;
    group.add(slab);

    const topMat = new THREE.MeshStandardMaterial({ color: 0x352c3c, roughness: 0.85 });
    const top = new THREE.Mesh(Renderer3D._geo().box, topMat);
    top.scale.set(radius * 2, radius * 0.5, radius * 2);
    top.position.y = radius * 0.3 + radius * 0.25;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);

    const bloodMat = new THREE.MeshStandardMaterial({ color: 0x4a0508, roughness: 0.7 });
    for (const dx of [-0.62, -0.18, 0.34, 0.7]) {
      const drip = new THREE.Mesh(Renderer3D._geo().capsule, bloodMat);
      const len = radius * (0.5 + 0.3 * Math.abs(Math.sin(dx * 9)));
      drip.scale.set(1.1, len, 1.1);
      drip.position.set(dx * radius, radius * 0.3 - len / 2, radius);
      group.add(drip);
    }

    const glowMat = new THREE.MeshStandardMaterial({ color: 0x9628c3, emissive: 0x9628c3, emissiveIntensity: 1.8, roughness: 0.3 });
    const glow = new THREE.Mesh(Renderer3D._geo().sphere, glowMat);
    glow.scale.setScalar(radius * 0.4);
    glow.position.y = radius * 0.3 + radius * 0.5 + radius * 0.15;
    group.add(glow);

    const glowLight = new THREE.PointLight(0x9628c3, 45, 260, 1.5);
    glowLight.position.copy(glow.position);
    group.add(glowLight);

    const coreGlow = this._makeGlowSprite(0x9628c3, radius * 0.9, 0.85);
    coreGlow.position.copy(glow.position);
    group.add(coreGlow);

    return { group, glow, glowMat, glowLight, coreGlow };
  }

  buildFenceModel(tierIndex) {
    const colors = [0x6b4a2a, 0x8a8a94, 0xb8b8c4];
    const color = colors[tierIndex];
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const width = 46;
    for (const px of [-width / 2 + 4, 0, width / 2 - 4]) {
      const post = new THREE.Mesh(Renderer3D._geo().cylinder, mat);
      post.scale.set(2.2, 22, 2.2);
      post.position.set(px, 11, 0);
      post.castShadow = true;
      group.add(post);
    }
    for (const ry of [8, 15]) {
      const rail = new THREE.Mesh(Renderer3D._geo().box, mat);
      rail.scale.set(width - 4, 2.4, 2);
      rail.position.set(0, ry, 0);
      rail.castShadow = true;
      group.add(rail);
    }
    if (tierIndex >= 2) {
      const sigilMat = new THREE.MeshStandardMaterial({ color: 0xb478f0, emissive: 0xb478f0, emissiveIntensity: 1.2 });
      const sigil = new THREE.Mesh(Renderer3D._geo().sphere, sigilMat);
      sigil.scale.setScalar(3);
      sigil.position.set(0, 14, 0);
      group.add(sigil);
    }
    return { group, mat };
  }

  buildMineModel(tierIndex) {
    const colors = [0x9646dc, 0x5aa0f0, 0xff5a28];
    const color = colors[tierIndex];
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
    const body = new THREE.Mesh(Renderer3D._geo().cylinder, bodyMat);
    body.scale.set(13, 4, 13);
    body.position.y = 2;
    body.receiveShadow = true;
    group.add(body);
    const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 });
    const glow = new THREE.Mesh(Renderer3D._geo().cylinder, glowMat);
    glow.scale.set(5.5, 0.8, 5.5);
    glow.position.y = 4.3;
    group.add(glow);
    const coreGlow = this._makeGlowSprite(color, 14, 0.85);
    coreGlow.position.y = 5;
    group.add(coreGlow);
    // A faint ring on the ground marking the trigger radius, so its (now bigger) activation
    // range actually reads instead of being an invisible number.
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(16, 18.5, 28), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    group.add(ring);
    const light = new THREE.PointLight(color, 20, 110, 1.5);
    light.position.y = 6;
    group.add(light);
    return { group, glow, glowMat, coreGlow, light, ringMat };
  }

  buildExplosionModel(maxRadius) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(Renderer3D._geo().sphere, mat);
    const light = new THREE.PointLight(0xff8030, 90, maxRadius * 4, 1.5);
    const group = new THREE.Group();
    group.add(mesh, light);
    return { group, mesh, mat, light };
  }

  buildBloodDecalModel() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3a0408, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 12), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.15;
    return { mesh, mat };
  }

  /** Each weapon's shot reads as what it actually is: a fletched bolt, a stubby lead slug, or a
   *  spinning silver ring — not one generic glowing capsule for everything. */
  buildBulletModel(weaponType, isCrit) {
    const group = new THREE.Group();
    let lightColor;

    if (weaponType === 'chakram') {
      lightColor = 0x9fd0ff;
      const mat = new THREE.MeshStandardMaterial({ color: 0xcfd6dc, emissive: lightColor, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.3 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 1, 6, 12), mat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    } else if (weaponType === 'blunderbuss') {
      lightColor = isCrit ? 0xffb060 : 0xd8d0c0;
      const mat = new THREE.MeshStandardMaterial({ color: lightColor, emissive: lightColor, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.55 });
      const slugR = isCrit ? 2.6 : 2.1;
      const slug = new THREE.Mesh(Renderer3D._geo().capsule, mat);
      slug.scale.set(slugR, slugR * 1.5, slugR);
      slug.rotation.z = Math.PI / 2;
      group.add(slug);
    } else {
      // Crossbow bolt: fletched shaft with a glowing arrowhead, angled to actually look like an arrow.
      lightColor = isCrit ? 0xff8c3c : 0xe0c068;
      const shaftLen = isCrit ? 20 : 16;
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.85 });
      const shaft = new THREE.Mesh(Renderer3D._geo().cylinder, shaftMat);
      shaft.scale.set(0.6, shaftLen, 0.6);
      shaft.rotation.z = Math.PI / 2;
      group.add(shaft);

      const headMat = new THREE.MeshStandardMaterial({ color: lightColor, emissive: lightColor, emissiveIntensity: 1.4 });
      const head = new THREE.Mesh(Renderer3D._geo().cone, headMat);
      head.scale.set(1.6, 4, 1.6);
      head.rotation.z = -Math.PI / 2;
      head.position.x = shaftLen / 2 + 1.5;
      group.add(head);

      const finMat = new THREE.MeshStandardMaterial({ color: 0x2e2318, side: THREE.DoubleSide });
      for (const fz of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.2), finMat);
        fin.position.set(-shaftLen / 2 + 1.5, 0, fz * 0.7);
        fin.rotation.y = Math.PI / 2;
        group.add(fin);
      }
    }

    const light = new THREE.PointLight(lightColor, 14, 70, 1.5);
    group.add(light);
    return { group };
  }

  buildHitSparkModel(isCrit) {
    const group = new THREE.Group();
    const color = isCrit ? 0xe61e28 : 0x8c0f16;
    const count = isCrit ? 8 : 6;
    const shards = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const m = new THREE.Mesh(Renderer3D._geo().sphere, mat);
      m.scale.setScalar(1.4);
      group.add(m);
      const a = Math.random() * Math.PI * 2;
      const speed = (isCrit ? 70 : 50) * (0.6 + Math.random() * 0.7);
      shards.push({ mesh: m, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, vy: 20 + Math.random() * 30 });
    }
    return { group, shards };
  }

  // ---------- Per-frame sync: reconcile live entity arrays against cached view Maps ----------
  /** Applies the walk-cycle limb swing, blended across the body's local fore-aft (Z) and sideways
   *  (X) axes by `relativeAngle` — the direction of actual travel relative to whichever way the
   *  body is *facing*. relativeAngle=0 is a straight walk (pure Z), ±90° is a pure sideways
   *  strafe (pure X), 180° is backpedaling. Every enemy always has relativeAngle=0 (Enemy.angle
   *  *is* its movement direction — there's nothing else it could be facing). The hunter is the one
   *  case where facing (aimAngle, twin-stick convention: the gun points where shots go) and actual
   *  movement (an independent stick/key input — strafing while aiming elsewhere is completely
   *  normal play, not an edge case) routinely differ, and without this blend the legs would always
   *  swing fore-aft relative to the gun regardless of which way the hunter is actually sliding
   *  across the ground. */
  _applyStrideSwing(v, swing, relativeAngle, kneeBase = 0.12, elbowBase = 0.15) {
    const fwd = Math.cos(relativeAngle);
    const side = Math.sin(relativeAngle);
    v.hipL.rotation.z = swing * 0.7 * fwd;
    v.hipR.rotation.z = -swing * 0.7 * fwd;
    v.hipL.rotation.x = swing * 0.7 * side;
    v.hipR.rotation.x = -swing * 0.7 * side;
    v.shoulderL.rotation.z = -swing * 0.5 * fwd;
    v.shoulderR.rotation.z = swing * 0.5 * fwd;
    v.shoulderL.rotation.x = -swing * 0.5 * side;
    v.shoulderR.rotation.x = swing * 0.5 * side;
    // Knees/elbows bend as their limb swings forward through the stride (never backward — real
    // joints only fold one way), on top of a small standing bend so legs never look locked
    // straight. This is what makes the walk read as a jointed stride instead of two stiff
    // pendulums, on whichever axis the stride itself is currently blended onto.
    const kneeSwingL = Math.max(0, swing);
    const kneeSwingR = Math.max(0, -swing);
    v.kneeL.rotation.z = kneeBase + kneeSwingL * 1.0 * fwd;
    v.kneeR.rotation.z = kneeBase + kneeSwingR * 1.0 * fwd;
    v.kneeL.rotation.x = kneeSwingL * 1.0 * side;
    v.kneeR.rotation.x = kneeSwingR * 1.0 * side;
    const elbowSwingL = Math.max(0, -swing);
    const elbowSwingR = Math.max(0, swing);
    v.elbowL.rotation.z = elbowBase + elbowSwingL * 0.55 * fwd;
    v.elbowR.rotation.z = elbowBase + elbowSwingR * 0.55 * fwd;
    v.elbowL.rotation.x = elbowSwingL * 0.55 * side;
    v.elbowR.rotation.x = elbowSwingR * 0.55 * side;
  }

  syncPlayer(player, time = 0) {
    if (!this.playerView) {
      this.playerView = this.buildPlayerModel();
      this.scene.add(this.playerView.group);
    }
    const v = this.playerView;
    v.group.position.set(this.worldX(player.x), 0, this.worldZ(player.y));
    v.group.rotation.y = this.yawFromAngle(player.aimAngle);
    const swing = player._isMoving ? Math.sin(player._walkPhase) : 0;
    const relativeAngle = player._isMoving ? player._moveAngle - player.aimAngle : 0;
    this._applyStrideSwing(v, swing, relativeAngle);
    // A faint idle breathing bob when standing still, so the hunter never reads as a frozen prop
    // between fights — walking already has its own motion via the leg/arm swing above.
    v.headGroup.position.y = v.headBaseY + (player._isMoving ? 0 : Math.sin(time * 1.7) * 0.6);
  }

  setPlayerVisible(visible) {
    if (this.playerView) this.playerView.group.visible = visible;
  }

  syncEnemies(enemies, time = 0) {
    const seen = new Set();
    for (const e of enemies) {
      seen.add(e);
      let v = this.enemyViews.get(e);
      if (!v) {
        v = this._buildByType(e.typeKey);
        this.scene.add(v.group);
        this.enemyViews.set(e, v);
      }
      v.group.position.set(this.worldX(e.x), 0, this.worldZ(e.y));
      v.group.rotation.y = this.yawFromAngle(e.angle);

      // Per-species baseline pose, layered under the shared swing/lunge animation below — this is
      // what makes a zombie shamble with arms out, a vampire stand tall and controlled, and a
      // werewolf carry a crouched, ready-to-pounce bend even before either one moves.
      const kneeBase = e.typeKey === 'vampire' ? 0.04 : e.typeKey === 'werewolf' ? 0.24
        : e.typeKey === 'wraith' ? 0.02 : e.typeKey === 'alpha' ? 0.26 : e.isBoss ? 0.16 : 0.12;
      const zombieReach = e.typeKey === 'zombie' ? 0.4 : 0;

      if (e._isMoving) {
        // An enemy's angle IS its movement direction (see Enemy.update()'s atan2) — unlike the
        // hunter, there's no independent aim to diverge from, so the stride is always purely
        // fore-aft (relativeAngle 0). See _applyStrideSwing for the general case.
        const swing = Math.sin(e._walkPhase);
        this._applyStrideSwing(v, swing, 0, kneeBase);
        v.shoulderL.rotation.x += zombieReach;
        v.shoulderR.rotation.x -= zombieReach;
        v.headGroup.position.y = v.headBaseY;
      } else {
        // Standing at contact range: legs planted, arms swing in a short strike-and-recover
        // roughly timed to when the next hit actually lands (ENEMY_ATTACK_INTERVAL, entities.js)
        // instead of idling motionless between hits. A faint breathing bob on top keeps it from
        // reading as frozen in the gaps between strikes.
        v.hipL.rotation.z = 0;
        v.hipR.rotation.z = 0;
        v.hipL.rotation.x = 0;
        v.hipR.rotation.x = 0;
        v.kneeL.rotation.z = kneeBase;
        v.kneeR.rotation.z = kneeBase;
        v.kneeL.rotation.x = 0;
        v.kneeR.rotation.x = 0;
        // A boss winds up and strikes on its own, much slower slam timer instead of the regular
        // per-enemy attack interval — the swing this drives is bigger too (see below), so a slam
        // reads as a real haymaker instead of the same jab every other enemy throws.
        const attackInterval = e.isBoss ? BOSS_ABILITY_INTERVAL[e.bossType] : ENEMY_ATTACK_INTERVAL;
        const cooldown = e.isBoss ? e._abilityCooldown : e._attackCooldown;
        const windup = e.isBoss ? 0.6 : 0.3;
        const sinceAttack = attackInterval - cooldown;
        const lunge = sinceAttack >= 0 && sinceAttack < windup ? Math.sin((sinceAttack / windup) * Math.PI) : 0;
        const lungeAmt = e.isBoss ? 1.1 : 0.7;
        v.shoulderL.rotation.z = -lunge * lungeAmt;
        v.shoulderR.rotation.z = lunge * lungeAmt;
        v.shoulderL.rotation.x = zombieReach;
        v.shoulderR.rotation.x = -zombieReach;
        v.elbowL.rotation.z = 0.15 + lunge * 0.4;
        v.elbowR.rotation.z = 0.15 + lunge * 0.4;
        v.elbowL.rotation.x = 0;
        v.elbowR.rotation.x = 0;
        v.headGroup.position.y = v.headBaseY + Math.sin(time * 1.9 + e.x * 0.05) * 0.5;
      }
      const flash = e._hitFlash > 0 ? clamp(e._hitFlash / 0.08, 0, 1) : 0;
      v.headMat.emissiveIntensity = flash * 2.2;
      v.headMat.emissive.setScalar(flash);
      v.torsoMat.emissiveIntensity = flash * 2.2;
      v.torsoMat.emissive.setScalar(flash);
    }
    for (const [e, v] of this.enemyViews) {
      if (!seen.has(e)) {
        this.scene.remove(v.group);
        this._disposeView(v);
        this.enemyViews.delete(e);
      }
    }
  }

  syncBullets(bullets) {
    const seen = new Set();
    for (const b of bullets) {
      seen.add(b);
      let v = this.bulletViews.get(b);
      if (!v) {
        v = this.buildBulletModel(b.weaponType, b.isCrit);
        this.scene.add(v.group);
        this.bulletViews.set(b, v);
      }
      v.group.position.set(this.worldX(b.x), PLAYER_MUZZLE_HEIGHT, this.worldZ(b.y));
      v.group.rotation.y = this.yawFromAngle(Math.atan2(b.vy, b.vx));
    }
    for (const [b, v] of this.bulletViews) {
      if (!seen.has(b)) {
        this.scene.remove(v.group);
        this._disposeView(v);
        this.bulletViews.delete(b);
      }
    }
  }

  syncFences(fences) {
    const seen = new Set();
    for (const f of fences) {
      seen.add(f);
      let v = this.fenceViews.get(f);
      if (!v || v.tierIndexTag !== f.tierIndex) {
        if (v) { this.scene.remove(v.group); this._disposeView(v); }
        v = this.buildFenceModel(f.tierIndex);
        v.tierIndexTag = f.tierIndex;
        this.scene.add(v.group);
        this.fenceViews.set(f, v);
      }
      v.group.position.set(this.worldX(f.x), 0, this.worldZ(f.y));
      v.group.rotation.y = f.rotation;
    }
    for (const [f, v] of this.fenceViews) {
      if (!seen.has(f)) {
        this.scene.remove(v.group);
        this._disposeView(v);
        this.fenceViews.delete(f);
      }
    }
  }

  syncMines(mines, time) {
    const seen = new Set();
    for (const m of mines) {
      seen.add(m);
      let v = this.mineViews.get(m);
      if (!v || v.tierIndexTag !== m.tierIndex) {
        if (v) { this.scene.remove(v.group); this._disposeView(v); }
        v = this.buildMineModel(m.tierIndex);
        v.tierIndexTag = m.tierIndex;
        this.scene.add(v.group);
        this.mineViews.set(m, v);
      }
      v.group.position.set(this.worldX(m.x), 0, this.worldZ(m.y));
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + m.x);
      v.glowMat.emissiveIntensity = 1 + pulse * 1.2;
      v.light.intensity = 10 + pulse * 12;
      v.ringMat.opacity = 0.16 + pulse * 0.18;
      v.coreGlow.scale.setScalar(11 + pulse * 6);
      v.coreGlow.material.opacity = 0.6 + pulse * 0.3;
    }
    for (const [m, v] of this.mineViews) {
      if (!seen.has(m)) {
        this.scene.remove(v.group);
        this._disposeView(v);
        this.mineViews.delete(m);
      }
    }
  }

  syncExplosions(explosions) {
    const seen = new Set();
    for (const ex of explosions) {
      seen.add(ex);
      let v = this.explosionViews.get(ex);
      if (!v) {
        v = this.buildExplosionModel(ex.radius);
        this.scene.add(v.group);
        this.explosionViews.set(ex, v);
      }
      const t = clamp(ex.age / ex.maxAge, 0, 1);
      v.group.position.set(this.worldX(ex.x), 12, this.worldZ(ex.y));
      v.mesh.scale.setScalar(Math.max(0.01, ex.radius * (0.2 + t * 1.1)));
      v.mat.opacity = (1 - t) * 0.8;
      v.light.intensity = (1 - t) * 90;
    }
    for (const [ex, v] of this.explosionViews) {
      if (!seen.has(ex)) {
        this.scene.remove(v.group);
        this._disposeView(v);
        this.explosionViews.delete(ex);
      }
    }
  }

  syncBloodPools(bloodPools) {
    const seen = new Set();
    for (const bp of bloodPools) {
      seen.add(bp);
      let v = this.bloodDecals.get(bp);
      if (!v) {
        v = this.buildBloodDecalModel();
        this.scene.add(v.mesh);
        this.bloodDecals.set(bp, v);
      }
      const fade = clamp(1 - bp.age / bp.maxAge, 0, 1);
      const spread = Math.min(1, bp.age / 1.2);
      v.mesh.position.set(this.worldX(bp.x), 0.15, this.worldZ(bp.y));
      // bp.scale carries the size of whatever died here (game.js passes victim.radius / 12) —
      // without it every pool reads the same size regardless of a vampire vs. a boss falling.
      v.mesh.scale.setScalar(10 * (0.4 + spread * 0.6) * bp.scale);
      v.mat.opacity = 0.55 * fade;
    }
    for (const [bp, v] of this.bloodDecals) {
      if (!seen.has(bp)) {
        this.scene.remove(v.mesh);
        v.mat.dispose();
        this.bloodDecals.delete(bp);
      }
    }
  }

  syncHitSparks(hitEffects) {
    const seen = new Set();
    for (const fx of hitEffects) {
      if (!(fx instanceof HitSpark)) continue;
      seen.add(fx);
      let v = this.hitSparkViews.get(fx);
      if (!v) {
        v = this.buildHitSparkModel(fx.isCrit);
        v.group.position.set(this.worldX(fx.x), fx.height, this.worldZ(fx.y));
        this.scene.add(v.group);
        this.hitSparkViews.set(fx, v);
      }
      const t = clamp(fx.age / fx.maxAge, 0, 1);
      for (const s of v.shards) {
        s.mesh.position.set(s.vx * t * 0.06, s.vy * t * 0.06 - 200 * t * t * 0.06, s.vz * t * 0.06);
        s.mesh.material.opacity = 1 - t;
      }
    }
    for (const [fx, v] of this.hitSparkViews) {
      if (!seen.has(fx)) {
        this.scene.remove(v.group);
        this._disposeView(v);
        this.hitSparkViews.delete(fx);
      }
    }
  }

  syncBase(base, time) {
    if (!this.baseView) {
      this.baseView = this.buildBaseModel(base.radius);
      this.scene.add(this.baseView.group);
      this.baseView.group.position.set(this.worldX(base.x), 0, this.worldZ(base.y));
    }
    const pulse = 0.5 + 0.5 * Math.sin(time * 2);
    this.baseView.glowMat.emissiveIntensity = 1.4 + pulse * 0.8;
    this.baseView.glowLight.intensity = 40 + pulse * 22;
    this.baseView.coreGlow.material.opacity = 0.6 + pulse * 0.3;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
