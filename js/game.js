/* ============================================================
   MEGABONK — bootstrap, camera, input, main loop
   ============================================================ */
'use strict';

const Game = {
  RUN_LENGTH: 20 * 60,       // survive this long to win

  renderer: null,
  scene: null,
  camera: null,
  sun: null,

  state: 'menu',             // menu | playing | levelup | paused | over
  time: 0,
  wave: 1,
  selectedChar: 0,
  pendingLevels: 0,
  rerolls: 2,
  currentPicks: null,
  won: false,

  camYaw: 0,
  camPitch: 0.62,
  camDist: 15,
  camPos: new THREE.Vector3(),
  camLook: new THREE.Vector3(),
  _sunNdc: new THREE.Vector3(),
  _eye: new THREE.Vector3(),
  _camReach: 1,

  input: { up: 0, down: 0, left: 0, right: 0, dash: false, jump: false },
  keys: {},
  pointerLocked: false,

  _last: 0,
  _acc: 0,
  _fpsT: 0, _fpsN: 0, fps: 60,

  // ---------------------------------------------------------
  boot() {
    const canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });

    GFX.setTier(U.store('quality') || this.autoTier());
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GFX.q.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = GFX.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = true;

    // The post chain owns tone mapping and the sRGB encode. Without it we
    // fall back to the renderer's own ACES + sRGB so colours still land right.
    PostFX.init(this.renderer);
    PostFX.setSize(window.innerWidth, window.innerHeight);
    if (!GFX.q.bloom) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(GFX.col(0x9aa3b0), 0.0058);
    // pre-filtered sky lighting: every PBR material picks up real ambient
    GFX.buildEnvironment(this.renderer, this.scene);

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 700);
    this.camera.position.set(0, 16, 18);

    // ---- lights ----
    // the environment map now carries most of the ambient, so the hemisphere
    // light is only a gentle fill
    const hemi = new THREE.HemisphereLight(GFX.col(0xbcc9dd), GFX.col(0x4a5040), 0.52);
    this.scene.add(hemi);

    // warm key from the direction of the painted sun
    const sun = new THREE.DirectionalLight(GFX.col(0xffd9a8), 2.6);
    sun.position.set(48, 62, 30);
    sun.castShadow = GFX.q.shadows;
    sun.shadow.mapSize.set(GFX.q.shadowSize, GFX.q.shadowSize);
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 200;
    // a tighter box over the same map spends every texel near the player,
    // which is where the shadows are actually looked at
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.045;
    sun.shadow.radius = 2.5;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // cool bounce from the opposite side keeps shadowed faces from going flat
    const rim = new THREE.DirectionalLight(GFX.col(0x7f95c4), 0.3);
    rim.position.set(-50, 26, -34);
    this.scene.add(rim);

    // ---- systems ----
    World.build(this.scene);
    FX.init(this.scene, this.camera);
    Loot.init(this.scene);
    Enemies.init(this.scene);
    Weapons.init(this.scene);
    UI.init();

    // compile the world's shader programs up front; otherwise the first
    // frame stalls for tens of milliseconds building them
    this.renderer.compile(this.scene, this.camera);

    this._bindEvents();

    UI.show('menu');
    this.state = 'menu';

    // idle camera for the menu
    Player.pos.set(0, World.heightAt(0, 0), 0);
    this._last = performance.now();
    requestAnimationFrame(t => this.loop(t));
  },

  // ---------------------------------------------------------
  _bindEvents() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      const px = this.renderer.getPixelRatio();
      PostFX.setSize(Math.floor(w * px), Math.floor(h * px));
    });

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (this.keys[k]) { if (k === ' ') e.preventDefault(); return; }
      this.keys[k] = true;
      SFX.resume();

      if (k === 'shift') this.input.dash = true;
      if (k === ' ') { this.input.jump = true; e.preventDefault(); }
      if (k === 'p' || k === 'escape') {
        if (this.state === 'playing' || this.state === 'paused') this.togglePause();
      }
      if (k === 'm') { SFX.muted = !SFX.muted; UI.toast(SFX.muted ? 'MUTED' : 'UNMUTED', '#3dd6ff'); }
      if (k === 'enter' && this.state === 'menu') this.start();
      if (k === 'r' && this.state === 'levelup') this.reroll();
      if (this.state === 'levelup' && ['1', '2', '3', '4'].includes(k)) {
        const cards = UI.el.cards.children;
        const i = parseInt(k, 10) - 1;
        if (cards[i]) cards[i].click();
      }
    });

    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });

    // tabbing away halts requestAnimationFrame anyway; pausing properly means
    // you come back to a menu instead of to a horde already on top of you
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.togglePause();
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      SFX.resume();
      if (this.state === 'playing' && !this.pointerLocked) this.lockPointer();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', e => {
      if (this.pointerLocked && this.state === 'playing') {
        this.camYaw -= e.movementX * 0.0026;
        this.camPitch = U.clamp(this.camPitch + e.movementY * 0.0020, 0.12, 1.25);
      }
    });
    canvas.addEventListener('wheel', e => {
      if (this.state !== 'playing') return;
      this.camDist = U.clamp(this.camDist + Math.sign(e.deltaY) * 1.2, 8, 26);
      e.preventDefault();
    }, { passive: false });
  },

  _readInput() {
    const k = this.keys;
    this.input.up = k['w'] || k['arrowup'] ? 1 : 0;
    this.input.down = k['s'] || k['arrowdown'] ? 1 : 0;
    this.input.left = k['a'] || k['arrowleft'] ? 1 : 0;
    this.input.right = k['d'] || k['arrowright'] ? 1 : 0;
    // keyboard camera turn, for anyone who doesn't want pointer lock
    if (k['q']) this.camYaw += 2.2 * 0.016;
    if (k['e']) this.camYaw -= 2.2 * 0.016;
  },

  lockPointer() {
    if (this.state !== 'playing') return;
    const canvas = this.renderer.domElement;
    if (!canvas.requestPointerLock) return;
    try {
      // Chrome rejects a re-lock issued too soon after an unlock; that is fine,
      // the player just clicks once more.
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  },

  // ---------------------------------------------------------
  start() {
    SFX.resume();
    this.time = 0;
    this.wave = 1;
    this.pendingLevels = 0;
    this.rerolls = 2;
    this.won = false;
    this.currentPicks = null;

    Upgrades.reset();
    Weapons.clearAll();
    Enemies.clear();
    Enemies.init(this.scene);
    Loot.init(this.scene);
    FX.reset();

    Player.init(this.scene, CHARACTERS[this.selectedChar]);
    Weapons.add(Player.char.startWeapon);

    this.camYaw = 0;
    this.camPitch = 0.62;
    this.camDist = 15;
    this._snapCamera();

    UI.hideBoss();
    UI.hideOverlays();
    UI._lastLoadoutKey = '';
    UI.updateHud();

    this.state = 'playing';
    this.lockPointer();
    UI.toast('BONK!', '#b6ff3d');
  },

  quitToMenu() {
    this.state = 'menu';
    Enemies.clear();
    Loot.clear();
    Weapons.clearAll();
    FX.reset();
    if (document.exitPointerLock) document.exitPointerLock();
    UI.hideBoss();
    UI.show('menu');
    UI.showBest();
  },

  toMenuFromGameOver() { this.quitToMenu(); },

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      if (document.exitPointerLock) document.exitPointerLock();
      UI.showPause();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      UI.hidePause();
      this.lockPointer();
    }
  },

  queueLevelUps(n) {
    this.pendingLevels += n;
  },

  _openLevelUp() {
    this.state = 'levelup';
    if (document.exitPointerLock) document.exitPointerLock();
    this.currentPicks = Upgrades.roll(3);
    UI.showLevelUp(this.currentPicks, c => this._choose(c), this.rerolls);
    SFX.levelup();
  },

  reroll() {
    if (this.state !== 'levelup' || this.rerolls <= 0) return;
    this.rerolls--;
    this.currentPicks = Upgrades.roll(3);
    UI.showLevelUp(this.currentPicks, c => this._choose(c), this.rerolls);
    SFX.tone(880, 0.08, 'triangle', 0.16);
  },

  _choose(choice) {
    Upgrades.apply(choice);
    UI.hideLevelUp();
    this.pendingLevels = Math.max(0, this.pendingLevels - 1);
    if (this.pendingLevels > 0) {
      // stack multiple level-ups back to back
      setTimeout(() => { if (this.state === 'levelup' || this.state === 'playing') this._openLevelUp(); }, 60);
    } else {
      this.state = 'playing';
      this.lockPointer();
    }
    UI.updateHud();
  },

  _gameOver(win) {
    this.state = 'over';
    this.won = !!win;
    if (document.exitPointerLock) document.exitPointerLock();

    const best = U.store('best') || { time: 0, level: 0, kills: 0 };
    if (this.time > (best.time || 0)) {
      U.store('best', { time: Math.floor(this.time), level: Player.level, kills: Player.kills });
    }

    if (win) { SFX.win(); FX.kick(1.2); } else { SFX.over(); }
    UI.showGameOver(win);
  },

  // ---------------------------------------------------------
  _snapCamera() {
    this._camReach = 1;
    const p = Player.pos;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    this.camPos.set(
      p.x + Math.sin(this.camYaw) * this.camDist * cp,
      p.y + this.camDist * sp + 1.5,
      p.z + Math.cos(this.camYaw) * this.camDist * cp
    );
    this.camLook.set(p.x, p.y + 1.7, p.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  },

  _updateCamera(dt) {
    const p = Player.pos;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const want = new THREE.Vector3(
      p.x + Math.sin(this.camYaw) * this.camDist * cp,
      p.y + this.camDist * sp + 1.5,
      p.z + Math.cos(this.camYaw) * this.camDist * cp
    );
    // keep the camera above the terrain
    const minY = World.heightAt(want.x, want.z) + 2.2;
    if (want.y < minY) want.y = minY;

    // and pull it in rather than let it end up inside a trunk or a canopy
    this._eye.set(p.x, p.y + 1.7, p.z);
    const reach = World.cameraReach(this._eye, want);
    // snap in fast when something intrudes, ease back out slowly
    this._camReach = reach < this._camReach
      ? reach
      : U.damp(this._camReach, reach, 0.08, dt);
    want.lerpVectors(this._eye, want, this._camReach);
    if (want.y < minY) want.y = minY;
    // Pulling in handles foliage, but if the shortened position still lands
    // inside a trunk we would be looking at the inside of a cylinder. Shove it
    // clear of solid geometry as a last resort.
    World.resolveCircle(want, 0.55, want.y);
    const floorY = World.heightAt(want.x, want.z) + 2.2;
    if (want.y < floorY) want.y = floorY;

    this.camPos.x = U.damp(this.camPos.x, want.x, 0.0006, dt);
    this.camPos.y = U.damp(this.camPos.y, want.y, 0.0006, dt);
    this.camPos.z = U.damp(this.camPos.z, want.z, 0.0006, dt);

    this.camLook.x = U.damp(this.camLook.x, p.x, 0.0002, dt);
    this.camLook.y = U.damp(this.camLook.y, p.y + 1.7, 0.0002, dt);
    this.camLook.z = U.damp(this.camLook.z, p.z, 0.0002, dt);

    this.camera.position.copy(this.camPos);
    FX.applyShake(this.camera);
    this.camera.lookAt(this.camLook);

    // sun + shadow box follow the player
    this.sun.position.set(p.x + 32, p.y + 46, p.z + 20);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();

    // project the painted sun into screen space to aim the light shafts
    this._sunNdc.copy(World.SUN_POS).project(this.camera);
    const u = this._sunNdc.x * 0.5 + 0.5, v = this._sunNdc.y * 0.5 + 0.5;
    let vis = 0;
    if (this._sunNdc.z < 1) {
      // fade out as it leaves the frame instead of popping
      const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
      vis = U.clamp(1.5 - edge * 1.9, 0, 1);
    }
    PostFX.setSun(u, v, U.damp(PostFX.sunVis, vis, 0.02, dt));
  },

  _menuCamera(dt) {
    this.camYaw += dt * 0.12;
    const r = 26;
    this.camera.position.set(Math.sin(this.camYaw) * r, 14, Math.cos(this.camYaw) * r);
    this.camera.lookAt(0, 2, 0);
  },

  // ---------------------------------------------------------
  loop(now) {
    requestAnimationFrame(t => this.loop(t));

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05);           // clamp so tab-outs don't teleport the horde

    this._fpsN++; this._fpsT += dt;
    if (this._fpsT >= 0.5) { this.fps = this._fpsN / this._fpsT; this._fpsN = 0; this._fpsT = 0; }

    World.update(dt);

    if (this.state === 'playing') {
      this._readInput();
      this.time += dt;
      this.wave = Math.floor(this.time / 30) + 1;

      Player.update(dt, this.input, this.camYaw);
      Enemies.spawnWave(dt);
      Enemies.update(dt);
      Weapons.update(dt);
      Loot.update(dt);
      FX.update(dt);
      this._updateCamera(dt);
      UI.updateHud();

      if (this.pendingLevels > 0) this._openLevelUp();
      else if (!Player.alive) this._gameOver(false);
      else if (this.time >= this.RUN_LENGTH) this._gameOver(true);

    } else if (this.state === 'menu') {
      this._menuCamera(dt);
      FX.update(dt);

    } else {
      // paused / levelup / over: freeze the sim, keep the view alive
      FX.update(dt * 0.2);
      this._updateCamera(dt);
    }

    PostFX.update(dt);
    PostFX.render(this.scene, this.camera);
    this._autoQuality(dt);
  },

  // ---------------------------------------------------------
  // Pick a starting tier from what the GPU reports, then keep an eye on the
  // frame rate and step down if the machine cannot hold up.
  autoTier() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'low';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = (dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '').toLowerCase();
      const weak = /(intel|swiftshader|llvmpipe|software|mali|adreno 5|powervr)/.test(name);
      if (!gl.getContextAttributes || weak) return 'medium';
      return 'high';
    } catch (e) { return 'medium'; }
  },

  _autoQuality(dt) {
    if (this.state !== 'playing' || this._qualityLocked) return;
    this._slowT = (this._slowT || 0) + (this.fps < 42 ? dt : -dt * 0.5);
    this._slowT = Math.max(0, this._slowT);
    if (this._slowT > 6) {
      this._slowT = 0;
      if (GFX.tier === 'high') this.setQuality('medium', true);
      else if (GFX.tier === 'medium') this.setQuality('low', true);
      else this._qualityLocked = true;
    }
  },

  setQuality(tier, auto) {
    if (GFX.tier === tier) return;
    GFX.setTier(tier);
    U.store('quality', tier);
    // setPixelRatio alone does not resize the drawing buffer; setSize has to
    // run again or the tier change has no effect on fill cost
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GFX.q.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = GFX.q.shadows;
    if (this.sun) {
      this.sun.castShadow = GFX.q.shadows;
      this.sun.shadow.mapSize.set(GFX.q.shadowSize, GFX.q.shadowSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    if (GFX.q.bloom) {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.outputEncoding = THREE.LinearEncoding;
    } else {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    const px = this.renderer.getPixelRatio();
    PostFX.setSize(Math.floor(window.innerWidth * px), Math.floor(window.innerHeight * px));
    UI.syncQuality();
    if (auto) UI.toast('GRAPHICS: ' + tier.toUpperCase(), '#3dd6ff');
  }
};

window.addEventListener('load', () => {
  try {
    Game.boot();
  } catch (err) {
    console.error(err);
    const l = document.getElementById('loading');
    if (l) {
      l.classList.remove('hidden');
      l.textContent = 'SOMETHING BROKE: ' + err.message;
    }
  }
});
