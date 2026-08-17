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

    this._buildLighting();
    this._buildGround();
    this._buildEnvironment();

    this.playerView = null;
    this.enemyViews = new Map();
    this.bulletViews = new Map();
    this.fenceViews = new Map();
    this.mineViews = new Map();
    this.explosionViews = new Map();
    this.bloodDecals = new Map();
    this.hitSparkViews = new Map();
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

    group.position.set(this.worldX(x), 0, this.worldZ(y));
    this.scene.add(group);
    this.brazierLights.push({ light, flame, baseX: x });
  }

  tickEnvironment(time) {
    for (const b of this.brazierLights) {
      const flicker = 0.75 + 0.25 * Math.sin(time * 9 + b.baseX) + 0.12 * Math.sin(time * 23 + b.baseX * 1.7);
      b.light.intensity = 55 * flicker;
      b.flame.scale.y = 0.8 + flicker * 0.35;
      b.flame.position.y = 26 + b.flame.scale.y * 8;
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

  /** A capsule "bone" hanging down -length from its pivot (local origin), radius r, color. Unit
   *  capsule geometry is radius 1, cylindrical length 1 (total height 3), so scale accordingly.
   *  Limbs don't cast shadows — with 4 per character that's the single biggest shadow-map cost,
   *  and the torso/head shadow alone already reads fine as "someone is standing here". */
  _makeLimb(length, radius, color) {
    const geo = Renderer3D._geo().capsule;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(radius, Math.max(0.1, length - 2 * radius), radius);
    mesh.position.y = -length / 2;
    return mesh;
  }

  // ---------- Creatures: a shared rig (legs/arms/torso/head/eye) that per-type builders dress up ----------
  _buildCreatureBase(opts) {
    const { legLen, legRadius, torsoLen, torsoRadius, headRadius, skinColor, eyeColor, limbColor, torsoColor } = opts;
    const group = new THREE.Group();

    const hipL = new THREE.Group();
    hipL.position.set(-torsoRadius * 0.55, legLen, 0);
    const hipR = new THREE.Group();
    hipR.position.set(torsoRadius * 0.55, legLen, 0);
    hipL.add(this._makeLimb(legLen, legRadius, limbColor));
    hipR.add(this._makeLimb(legLen, legRadius, limbColor));
    group.add(hipL, hipR);

    const shoulderY = legLen + torsoLen;
    const shoulderL = new THREE.Group();
    shoulderL.position.set(-torsoRadius * 0.9, shoulderY, 0);
    const shoulderR = new THREE.Group();
    shoulderR.position.set(torsoRadius * 0.9, shoulderY, 0);
    shoulderL.add(this._makeLimb(torsoLen * 0.85, legRadius * 0.75, limbColor));
    shoulderR.add(this._makeLimb(torsoLen * 0.85, legRadius * 0.75, limbColor));
    group.add(shoulderL, shoulderR);

    const torsoMat = new THREE.MeshStandardMaterial({ color: torsoColor, roughness: 0.8 });
    const torso = new THREE.Mesh(Renderer3D._geo().capsule, torsoMat);
    torso.scale.set(torsoRadius, Math.max(0.1, torsoLen - torsoRadius * 1.6), torsoRadius);
    torso.position.y = legLen + torsoLen / 2;
    torso.castShadow = true;
    torso.receiveShadow = true;
    group.add(torso);

    const headGroup = new THREE.Group();
    headGroup.position.y = legLen + torsoLen + headRadius * 0.7;
    const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.75 });
    const head = new THREE.Mesh(Renderer3D._geo().sphere, headMat);
    head.scale.setScalar(headRadius);
    head.castShadow = true;
    headGroup.add(head);

    const eyeMat = new THREE.MeshStandardMaterial({ color: eyeColor, emissive: eyeColor, emissiveIntensity: 2 });
    const eye = new THREE.Mesh(Renderer3D._geo().sphere, eyeMat);
    eye.scale.setScalar(headRadius * 0.14);
    eye.position.set(headRadius * 0.65, headRadius * 0.05, headRadius * 0.6);
    headGroup.add(eye);

    group.add(headGroup);

    return { group, hipL, hipR, shoulderL, shoulderR, torso, torsoMat, head, headMat, headGroup, eye, eyeMat, legLen, torsoLen, headRadius, torsoRadius };
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
    rig.group.add(weaponPivot);

    return { ...rig, cloak, weaponPivot };
  }

  buildZombieModel() {
    const rig = this._buildCreatureBase({
      legLen: 22, legRadius: 4, torsoLen: 24, torsoRadius: 8, headRadius: 6,
      skinColor: 0x5f6f3c, eyeColor: 0xe0202f, limbColor: 0x3f5527, torsoColor: 0x4a5828,
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
    return rig;
  }

  buildVampireModel() {
    const rig = this._buildCreatureBase({
      legLen: 25, legRadius: 3.4, torsoLen: 23, torsoRadius: 6.5, headRadius: 5.6,
      skinColor: 0xd4c8be, eyeColor: 0xff1030, limbColor: 0x2a1522, torsoColor: 0x3f1826,
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
    return { ...rig, cape };
  }

  buildWerewolfModel() {
    const rig = this._buildCreatureBase({
      legLen: 25, legRadius: 6, torsoLen: 32, torsoRadius: 12.5, headRadius: 8,
      skinColor: 0x6b4f38, eyeColor: 0xf0c020, limbColor: 0x453220, torsoColor: 0x5c4530,
    });
    const earMat = new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 1 });
    for (const ex of [-1, 1]) {
      const ear = new THREE.Mesh(Renderer3D._geo().cone, earMat);
      ear.scale.set(2.6, 6, 2.6);
      ear.position.set(ex * 3.6, rig.legLen + rig.torsoLen + rig.headRadius * 1.5, -1);
      rig.group.add(ear);
    }
    const fangMat = new THREE.MeshStandardMaterial({ color: 0xf4eee0 });
    const fang = new THREE.Mesh(Renderer3D._geo().cone, fangMat);
    fang.scale.set(1, 2.4, 1);
    fang.position.set(0, rig.legLen + rig.torsoLen - rig.headRadius * 0.1, rig.headRadius * 0.9);
    fang.rotation.x = Math.PI;
    rig.group.add(fang);
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0 });
    for (const hip of [rig.hipL, rig.hipR]) {
      const claw = new THREE.Mesh(Renderer3D._geo().cone, clawMat);
      claw.scale.set(1.2, 3, 1.2);
      claw.position.y = -rig.legLen + 2;
      claw.rotation.x = Math.PI;
      hip.add(claw);
    }
    return rig;
  }

  _buildByType(typeKey) {
    if (typeKey === 'vampire') return this.buildVampireModel();
    if (typeKey === 'werewolf') return this.buildWerewolfModel();
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

    return { group, glow, glowMat, glowLight };
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
    return { group, glow, glowMat, light, ringMat };
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
  syncPlayer(player) {
    if (!this.playerView) {
      this.playerView = this.buildPlayerModel();
      this.scene.add(this.playerView.group);
    }
    const v = this.playerView;
    v.group.position.set(this.worldX(player.x), 0, this.worldZ(player.y));
    v.group.rotation.y = this.yawFromAngle(player.aimAngle);
    const swing = player._isMoving ? Math.sin(player._walkPhase) : 0;
    v.hipL.rotation.x = swing * 0.7;
    v.hipR.rotation.x = -swing * 0.7;
    v.shoulderL.rotation.x = -swing * 0.5;
    v.shoulderR.rotation.x = swing * 0.5;
  }

  setPlayerVisible(visible) {
    if (this.playerView) this.playerView.group.visible = visible;
  }

  syncEnemies(enemies) {
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
      if (e._isMoving) {
        const swing = Math.sin(e._walkPhase);
        v.hipL.rotation.x = swing * 0.7;
        v.hipR.rotation.x = -swing * 0.7;
        v.shoulderL.rotation.x = -swing * 0.5;
        v.shoulderR.rotation.x = swing * 0.5;
      } else {
        // Standing at contact range: legs planted, arms swing in a short strike-and-recover
        // roughly timed to when the next hit actually lands (ENEMY_ATTACK_INTERVAL, entities.js)
        // instead of idling motionless between hits.
        v.hipL.rotation.x = 0;
        v.hipR.rotation.x = 0;
        const sinceAttack = ENEMY_ATTACK_INTERVAL - e._attackCooldown;
        const lunge = sinceAttack >= 0 && sinceAttack < 0.3 ? Math.sin((sinceAttack / 0.3) * Math.PI) : 0;
        v.shoulderL.rotation.x = -lunge * 0.7;
        v.shoulderR.rotation.x = lunge * 0.7;
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
      v.mesh.scale.setScalar(10 * (0.4 + spread * 0.6));
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
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
