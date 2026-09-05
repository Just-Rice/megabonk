/* ============================================================
   MEGABONK — weapons, projectiles, orbitals
   ============================================================ */
'use strict';

const WEAPONS = {
  hammer: {
    id: 'hammer', name: 'BONK HAMMER', icon: '🔨', max: 8,
    desc: 'Swing a huge hammer in a wide arc. The classic.',
    up: ['+40% damage', '+1 swing arc', '+damage', 'wider arc', '+damage', 'knockback up', '+damage', 'MEGA BONK'],
    cd: l => Math.max(0.30, 0.80 - l * 0.05),
    dmg: l => 18 + l * 9,
    area: l => 4.2 + l * 0.45,
    fire(w) { Weapons._swing(w); }
  },
  missile: {
    id: 'missile', name: 'MAGIC MISSILE', icon: '✨', max: 8,
    desc: 'Homing bolts seek out the nearest bonkable.',
    up: ['+1 bolt', '+damage', '+1 bolt', 'faster bolts', '+damage', '+1 bolt', '+damage', '+2 bolts'],
    cd: l => Math.max(0.26, 0.78 - l * 0.06),
    dmg: l => 12 + l * 6,
    count: l => 1 + Math.floor(l / 2),
    fire(w) { Weapons._missiles(w); }
  },
  shuriken: {
    id: 'shuriken', name: 'SPIN STARS', icon: '🌟', max: 8,
    desc: 'Piercing stars fly out where you are facing.',
    up: ['+1 star', '+pierce', '+damage', '+1 star', '+damage', '+pierce', '+1 star', '+damage'],
    cd: l => Math.max(0.28, 0.70 - l * 0.05),
    dmg: l => 11 + l * 5.5,
    count: l => 2 + Math.floor(l / 2),
    pierce: l => 1 + Math.floor(l / 3),
    fire(w) { Weapons._shuriken(w); }
  },
  orbit: {
    id: 'orbit', name: 'BONK ORBS', icon: '🔵', max: 8,
    desc: 'Orbs circle you and bonk anything they touch.',
    up: ['+1 orb', '+damage', 'faster spin', '+1 orb', '+damage', 'wider orbit', '+1 orb', '+damage'],
    cd: () => 999,
    dmg: l => 14 + l * 7,
    count: l => 1 + Math.floor((l + 1) / 2),
    radius: l => 3.0 + l * 0.22,
    fire() { }
  },
  lightning: {
    id: 'lightning', name: 'BONK BOLT', icon: '⚡', max: 8,
    desc: 'Smites random nearby enemies from the sky.',
    up: ['+1 strike', '+damage', '+1 strike', 'bigger blast', '+damage', '+1 strike', '+damage', '+2 strikes'],
    cd: l => Math.max(0.45, 1.6 - l * 0.13),
    dmg: l => 28 + l * 13,
    count: l => 1 + Math.floor(l / 2),
    area: l => 2.4 + l * 0.2,
    fire(w) { Weapons._lightning(w); }
  },
  aura: {
    id: 'aura', name: 'ANGER AURA', icon: '🌀', max: 8,
    desc: 'Everything near you slowly takes damage. And slows.',
    up: ['+radius', '+damage', '+radius', 'stronger slow', '+damage', '+radius', '+damage', 'MAXIMUM ANGER'],
    cd: l => Math.max(0.20, 0.55 - l * 0.04),
    dmg: l => 7 + l * 4,
    radius: l => 4.0 + l * 0.55,
    fire(w) { Weapons._aura(w); }
  },
  bomb: {
    id: 'bomb', name: 'BONK BOMB', icon: '💣', max: 8,
    desc: 'Lobs bombs that explode in a big loud circle.',
    up: ['+1 bomb', '+damage', 'bigger blast', '+1 bomb', '+damage', 'bigger blast', '+1 bomb', '+damage'],
    cd: l => Math.max(0.65, 1.9 - l * 0.15),
    dmg: l => 34 + l * 17,
    count: l => 1 + Math.floor(l / 3),
    area: l => 4.2 + l * 0.45,
    fire(w) { Weapons._bomb(w); }
  },
  boomerang: {
    id: 'boomerang', name: 'BONKERANG', icon: '🪃', max: 8,
    desc: 'Flies out, bonks through everything, comes home.',
    up: ['+1 rang', '+damage', 'longer range', '+damage', '+1 rang', 'faster', '+damage', '+1 rang'],
    cd: l => Math.max(0.5, 1.35 - l * 0.1),
    dmg: l => 16 + l * 8,
    count: l => 1 + Math.floor(l / 3),
    range: l => 11 + l * 1.1,
    fire(w) { Weapons._boomerang(w); }
  }
};

const Weapons = {
  scene: null,
  owned: [],
  projectiles: [],
  enemyShots: [],
  orbs: [],
  swings: [],
  pools: {},
  auraMesh: null,
  _auraTick: 0,

  init(scene) {
    this.scene = scene;
    this.clearAll();
  },

  clearAll() {
    for (const p of this.projectiles) this._release(p);
    this.projectiles.length = 0;
    for (const p of this.enemyShots) { this.scene.remove(p.mesh); }
    this.enemyShots.length = 0;
    for (const o of this.orbs) this.scene.remove(o.mesh);
    this.orbs.length = 0;
    for (const s of this.swings) this.scene.remove(s.mesh);
    this.swings.length = 0;
    if (this.auraMesh) { this.scene.remove(this.auraMesh); this.auraMesh = null; }
    this.owned.length = 0;
  },

  // weapons point at the nearest enemy, falling back to the way you are walking
  aimAngle(range) {
    const t = Enemies.nearest(Player.pos.x, Player.pos.z, range || 20);
    if (t) return Math.atan2(t.pos.x - Player.pos.x, t.pos.z - Player.pos.z);
    return Math.atan2(Player.aim.x, Player.aim.z);
  },

  has(id) { return this.owned.some(w => w.id === id); },
  get(id) { return this.owned.find(w => w.id === id); },
  levelOf(id) { const w = this.get(id); return w ? w.level : 0; },

  add(id) {
    const def = WEAPONS[id];
    if (!def) return null;
    let w = this.get(id);
    if (w) {
      if (w.level < def.max) w.level++;
    } else {
      w = { id, def, level: 1, cd: 0.35 };
      this.owned.push(w);
    }
    if (id === 'orbit') this._rebuildOrbs();
    if (id === 'aura') this._rebuildAura();
    return w;
  },

  // ---------- pooling ----------
  _meshFor(key, make) {
    const pool = this.pools[key] || (this.pools[key] = []);
    const m = pool.pop() || make();
    m.visible = true;
    this.scene.add(m);
    return m;
  },

  _release(p) {
    this.scene.remove(p.mesh);
    (this.pools[p.poolKey] || (this.pools[p.poolKey] = [])).push(p.mesh);
  },

  _shoot(opts) {
    const p = {
      poolKey: opts.poolKey,
      mesh: opts.mesh,
      vel: opts.vel,
      dmg: opts.dmg,
      life: opts.life || 3,
      radius: opts.radius || 0.5,
      pierce: opts.pierce === undefined ? 1 : opts.pierce,
      hit: new Set(),
      homing: opts.homing || 0,
      target: opts.target || null,
      gravity: opts.gravity || 0,
      spin: opts.spin || 0,
      speedCap: opts.speedCap || 0,
      onExpire: opts.onExpire || null,
      onHit: opts.onHit || null,
      boomerang: opts.boomerang || null,
      knock: opts.knock || 0,
      slow: opts.slow || 0,
      age: 0
    };
    this.projectiles.push(p);
    return p;
  },

  // ---------- individual weapons ----------
  _swing(w) {
    const lvl = w.level;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const reach = w.def.area(lvl) * Player.stats.areaMul;
    const arc = Math.PI * (0.55 + lvl * 0.035);
    const aimAngle = this.aimAngle(reach + 2);

    let hits = 0;
    Enemies.query(Player.pos.x, Player.pos.z, reach, e => {
      const a = Math.atan2(e.pos.x - Player.pos.x, e.pos.z - Player.pos.z);
      if (Math.abs(U.angleDelta(aimAngle, a)) <= arc) {
        Enemies.hurt(e, dmg, { knock: Player.pos, knockPower: 7 + lvl });
        hits++;
      }
    });
    if (hits) { SFX.bonk(); FX.kick(0.12); }

    // sweep visual
    const mesh = this._meshFor('swing', () => {
      const g = new THREE.Group();
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 1.7, 6),
        new THREE.MeshLambertMaterial({ color: 0x8a5a2f, flatShading: true })
      );
      handle.position.y = 0.85;
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.7, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xc8ccd8, flatShading: true })
      );
      head.position.y = 1.85;
      g.add(handle, head);
      g.castShadow = true;
      return g;
    });
    mesh.scale.setScalar(0.6 + reach * 0.16);
    this.swings.push({ mesh, t: 0, dur: 0.22, aim: aimAngle, reach, poolKey: 'swing' });
  },

  _missiles(w) {
    const lvl = w.level;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const n = w.def.count(lvl);
    const speed = (17 + lvl * 1.2) * Player.stats.projSpeedMul;
    let fired = 0;
    for (let i = 0; i < n; i++) {
      const t = Enemies.randomNear(Player.pos.x, Player.pos.z, 24);
      if (!t) break;
      const mesh = this._meshFor('missile', () => new THREE.Mesh(
        new THREE.OctahedronGeometry(0.3, 0),
        new THREE.MeshBasicMaterial({ color: 0x63e0ff })
      ));
      mesh.position.set(Player.pos.x, Player.pos.y + 1.5, Player.pos.z);
      const a = Math.random() * U.TAU;
      this._shoot({
        poolKey: 'missile', mesh, dmg, radius: 0.55, pierce: 1, homing: 9 + lvl,
        target: t, life: 3.2, spin: 8, speedCap: speed,
        vel: new THREE.Vector3(Math.cos(a) * 6, U.rand(1, 4), Math.sin(a) * 6)
      });
      fired++;
    }
    if (fired) SFX.shoot();
  },

  _shuriken(w) {
    const lvl = w.level;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const n = w.def.count(lvl);
    const pierce = w.def.pierce(lvl);
    const speed = 22 * Player.stats.projSpeedMul;
    const base = this.aimAngle(26);
    const spread = 0.13;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * spread;
      const mesh = this._meshFor('shuriken', () => {
        const g = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.09, 0.16),
          new THREE.MeshLambertMaterial({ color: 0xe8e8f0, flatShading: true })
        );
        const cross = new THREE.Mesh(g.geometry, g.material);
        cross.rotation.y = Math.PI / 2;
        g.add(cross);
        return g;
      });
      mesh.position.set(Player.pos.x, Player.pos.y + 1.2, Player.pos.z);
      this._shoot({
        poolKey: 'shuriken', mesh, dmg, radius: 0.6, pierce, life: 1.6, spin: 26,
        knock: 3,
        vel: new THREE.Vector3(Math.sin(a) * speed, 0, Math.cos(a) * speed)
      });
    }
    SFX.shoot();
  },

  _lightning(w) {
    const lvl = w.level;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const n = w.def.count(lvl);
    const area = w.def.area(lvl) * Player.stats.areaMul;
    let struck = 0;
    for (let i = 0; i < n; i++) {
      const t = Enemies.randomNear(Player.pos.x, Player.pos.z, 22);
      if (!t) break;
      struck++;
      const at = t.pos.clone();
      FX.ring(at, 0xffe066, 0.4, area * 2, 0.35);
      FX.burst(at, 0xffe066, 8, { speed: 9, size: 0.24, life: 0.4 });

      // visible bolt column
      const mesh = this._meshFor('bolt', () => new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.5, 22, 5),
        new THREE.MeshBasicMaterial({ color: 0xfff4b0, transparent: true, opacity: 0.9 })
      ));
      mesh.position.set(at.x, at.y + 11, at.z);
      mesh.material.opacity = 0.9;
      this.swings.push({ mesh, t: 0, dur: 0.18, bolt: true, poolKey: 'bolt' });

      Enemies.query(at.x, at.z, area, e => Enemies.hurt(e, dmg, { knock: at, knockPower: 4 }));
    }
    if (struck) { SFX.zap(); FX.kick(0.18); }
  },

  _aura(w) {
    const lvl = w.level;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const r = w.def.radius(lvl) * Player.stats.areaMul;
    let any = false;
    Enemies.query(Player.pos.x, Player.pos.z, r, e => {
      Enemies.hurt(e, dmg, { silent: !U.chance(0.35), slow: 0.35 + lvl * 0.04, canCrit: false });
      any = true;
    });
    if (any && U.chance(0.25)) SFX.hit();
  },

  _bomb(w) {
    const lvl = w.level;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const n = w.def.count(lvl);
    const area = w.def.area(lvl) * Player.stats.areaMul;
    for (let i = 0; i < n; i++) {
      const t = Enemies.randomNear(Player.pos.x, Player.pos.z, 18);
      const dest = t ? t.pos : World.ringPoint(Player.pos, 5, 12);
      const mesh = this._meshFor('bomb', () => new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x222028, flatShading: true })
      ));
      mesh.position.set(Player.pos.x, Player.pos.y + 1.4, Player.pos.z);

      const dx = dest.x - Player.pos.x, dz = dest.z - Player.pos.z;
      const flight = 0.75;
      this._shoot({
        poolKey: 'bomb', mesh, dmg: 0, radius: 0.4, pierce: 0, life: flight,
        gravity: -30, spin: 5,
        vel: new THREE.Vector3(dx / flight, 12, dz / flight),
        onExpire: (pp) => {
          FX.ring(pp.mesh.position, 0xff8a3d, 0.6, area * 2, 0.42);
          FX.burst(pp.mesh.position, 0xff8a3d, 16, { speed: 13, size: 0.32, life: 0.7 });
          SFX.boom(); FX.kick(0.3);
          Enemies.query(pp.mesh.position.x, pp.mesh.position.z, area, e =>
            Enemies.hurt(e, dmg, { knock: pp.mesh.position, knockPower: 12 }));
        }
      });
    }
    SFX.shoot();
  },

  _boomerang(w) {
    const lvl = w.level;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const n = w.def.count(lvl);
    const range = w.def.range(lvl) * Player.stats.areaMul;
    const base = this.aimAngle(range + 4);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.5;
      const mesh = this._meshFor('rang', () => {
        const g = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: 0xffd23d, flatShading: true });
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.24), mat);
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.24), mat);
        b1.position.set(0.3, 0, 0.3); b1.rotation.y = 0.7;
        b2.position.set(0.3, 0, -0.3); b2.rotation.y = -0.7;
        g.add(b1, b2);
        return g;
      });
      mesh.position.set(Player.pos.x, Player.pos.y + 1.3, Player.pos.z);
      const speed = (15 + lvl) * Player.stats.projSpeedMul;
      this._shoot({
        poolKey: 'rang', mesh, dmg, radius: 0.8, pierce: 9999, life: 4, spin: 18,
        boomerang: { out: true, range, speed, angle: a },
        vel: new THREE.Vector3(Math.sin(a) * speed, 0, Math.cos(a) * speed)
      });
    }
    SFX.shoot();
  },

  // ---------- orbitals ----------
  _rebuildOrbs() {
    const w = this.get('orbit');
    for (const o of this.orbs) {
      this.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      o.mesh.material.dispose();
    }
    this.orbs.length = 0;
    if (!w) return;
    const n = w.def.count(w.level);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.45, 0),
        new THREE.MeshLambertMaterial({ color: 0x3dd6ff, emissive: 0x105a7a, flatShading: true })
      );
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.orbs.push({ mesh, phase: (i / n) * U.TAU, cd: 0 });
    }
  },

  _rebuildAura() {
    const w = this.get('aura');
    if (!w) return;
    if (!this.auraMesh) {
      const geo = new THREE.RingGeometry(0.86, 1, 40);
      geo.rotateX(-Math.PI / 2);
      this.auraMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xff3d7f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false
      }));
      this.scene.add(this.auraMesh);
    }
  },

  // ---------- enemy fire ----------
  enemyShot(from, toPos) {
    const mesh = this._meshFor('eshot', () => new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 7, 6),
      new THREE.MeshBasicMaterial({ color: 0x8dff6b })
    ));
    mesh.position.set(from.pos.x, from.pos.y + 1.2, from.pos.z);
    const dx = toPos.x - from.pos.x, dy = (toPos.y + 1.2) - (from.pos.y + 1.2), dz = toPos.z - from.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const speed = 13;
    this.enemyShots.push({
      mesh, poolKey: 'eshot',
      vel: new THREE.Vector3(dx / d * speed, dy / d * speed, dz / d * speed),
      dmg: from.dmg * 0.7,
      life: 3
    });
    SFX.shoot();
  },

  // ---------- per-frame ----------
  update(dt) {
    // fire timers
    for (const w of this.owned) {
      const def = w.def;
      if (def.cd(w.level) > 900) continue;         // passive-style weapon (orbit)
      w.cd -= dt;
      if (w.cd <= 0) {
        const interval = def.cd(w.level) * Player.stats.cooldownMul / Player.stats.attackSpeedMul;
        w.cd = Math.max(0.05, interval);
        def.fire(w);
      }
    }

    this._updateProjectiles(dt);
    this._updateEnemyShots(dt);
    this._updateOrbs(dt);
    this._updateSwings(dt);
    this._updateAuraVisual(dt);
  },

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.life -= dt;

      if (p.boomerang) {
        const b = p.boomerang;
        const travelled = p.age * b.speed;
        if (b.out && travelled > b.range) {
          b.out = false;
          p.hit.clear();            // one fresh set of hits on the way home
        }
        if (!b.out) {
          const dx = Player.pos.x - p.mesh.position.x;
          const dy = (Player.pos.y + 1.3) - p.mesh.position.y;
          const dz = Player.pos.z - p.mesh.position.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          p.vel.set(dx / d * b.speed * 1.35, dy / d * b.speed * 0.4, dz / d * b.speed * 1.35);
          if (d < 1.5) { this._release(p); U.swapRemove(this.projectiles, i); continue; }
        }
      }

      if (p.homing) {
        let t = p.target;
        if (!t || t.dead) t = p.target = Enemies.nearest(p.mesh.position.x, p.mesh.position.z, 30);
        if (t) {
          const dx = t.pos.x - p.mesh.position.x;
          const dy = (t.pos.y + 0.8) - p.mesh.position.y;
          const dz = t.pos.z - p.mesh.position.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          p.vel.x += (dx / d) * p.homing * dt * 9;
          p.vel.y += (dy / d) * p.homing * dt * 9;
          p.vel.z += (dz / d) * p.homing * dt * 9;
          const cap = p.speedCap || 20;   // fallback for non-capped homers
          const sp = p.vel.length();
          if (sp > cap) p.vel.multiplyScalar(cap / sp);
        }
      }

      if (p.gravity) p.vel.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.spin) { p.mesh.rotation.y += p.spin * dt; p.mesh.rotation.x += p.spin * 0.4 * dt; }

      // ---- collisions ----
      if (p.pierce > 0 && p.dmg > 0) {
        let done = false;
        Enemies.query(p.mesh.position.x, p.mesh.position.z, p.radius + 0.4, e => {
          if (done || p.hit.has(e)) return;
          if (Math.abs(e.pos.y - p.mesh.position.y) > 3.5) return;
          p.hit.add(e);
          Enemies.hurt(e, p.dmg, { knock: p.knock ? p.mesh.position : null, knockPower: p.knock, slow: p.slow });
          SFX.hit();
          FX.burst(p.mesh.position, 0xffffff, 3, { speed: 5, size: 0.16, life: 0.3, grav: -10 });
          if (p.onHit) p.onHit(p, e);
          p.pierce--;
          if (p.pierce <= 0) done = true;
        });
        if (done) {
          if (p.onExpire) p.onExpire(p);
          this._release(p);
          U.swapRemove(this.projectiles, i);
          continue;
        }
      }

      const ground = World.heightAt(p.mesh.position.x, p.mesh.position.z);
      const hitGround = p.gravity && p.mesh.position.y <= ground + 0.3;

      if (p.life <= 0 || hitGround || Math.hypot(p.mesh.position.x, p.mesh.position.z) > World.RADIUS + 12) {
        if (p.onExpire) p.onExpire(p);
        this._release(p);
        U.swapRemove(this.projectiles, i);
      }
    }
  },

  _updateEnemyShots(dt) {
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const p = this.enemyShots[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);

      const dx = p.mesh.position.x - Player.pos.x;
      const dy = p.mesh.position.y - (Player.pos.y + 1.3);
      const dz = p.mesh.position.z - Player.pos.z;
      const hitPlayer = dx * dx + dy * dy + dz * dz < 1.4;

      const ground = World.heightAt(p.mesh.position.x, p.mesh.position.z);
      if (hitPlayer || p.life <= 0 || p.mesh.position.y < ground) {
        if (hitPlayer) {
          Player.damage(p.dmg, p.mesh.position);
          FX.burst(p.mesh.position, 0x8dff6b, 6, { speed: 6, size: 0.2, life: 0.35 });
        }
        this.scene.remove(p.mesh);
        (this.pools[p.poolKey] || (this.pools[p.poolKey] = [])).push(p.mesh);
        U.swapRemove(this.enemyShots, i);
      }
    }
  },

  _updateOrbs(dt) {
    const w = this.get('orbit');
    if (!w || !this.orbs.length) return;
    const lvl = w.level;
    const r = w.def.radius(lvl) * Player.stats.areaMul;
    const dmg = w.def.dmg(lvl) * Player.stats.damageMul;
    const spin = (1.5 + lvl * 0.16) * Player.stats.attackSpeedMul;

    for (const o of this.orbs) {
      o.phase += spin * dt;
      o.cd -= dt;
      const x = Player.pos.x + Math.cos(o.phase) * r;
      const z = Player.pos.z + Math.sin(o.phase) * r;
      o.mesh.position.set(x, Player.pos.y + 1.3 + Math.sin(o.phase * 2) * 0.3, z);
      o.mesh.rotation.y += dt * 4;
      if (o.cd <= 0) {
        let hit = false;
        Enemies.query(x, z, 0.85, e => {
          if (hit) return;
          Enemies.hurt(e, dmg, { knock: o.mesh.position, knockPower: 6 });
          hit = true;
        });
        if (hit) { o.cd = 0.28; SFX.hit(); }
      }
    }
  },

  _updateSwings(dt) {
    for (let i = this.swings.length - 1; i >= 0; i--) {
      const s = this.swings[i];
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        this.scene.remove(s.mesh);
        (this.pools[s.poolKey] || (this.pools[s.poolKey] = [])).push(s.mesh);
        U.swapRemove(this.swings, i);
        continue;
      }
      if (s.bolt) {
        s.mesh.material.opacity = 0.9 * (1 - k);
        s.mesh.scale.set(1 - k * 0.5, 1, 1 - k * 0.5);
      } else {
        const sweep = U.lerp(-1.1, 1.1, k);
        const a = s.aim + sweep;
        const d = s.reach * 0.55;
        s.mesh.position.set(
          Player.pos.x + Math.sin(a) * d,
          Player.pos.y + 0.4,
          Player.pos.z + Math.cos(a) * d
        );
        s.mesh.rotation.set(U.lerp(-0.9, 0.5, k), a, U.lerp(0.7, -0.7, k));
      }
    }
  },

  _updateAuraVisual(dt) {
    const w = this.get('aura');
    if (!w || !this.auraMesh) return;
    const r = w.def.radius(w.level) * Player.stats.areaMul;
    this.auraMesh.position.set(Player.pos.x, World.heightAt(Player.pos.x, Player.pos.z) + 0.12, Player.pos.z);
    this.auraMesh.scale.set(r, 1, r);
    this.auraMesh.rotation.y += dt * 0.8;
    this.auraMesh.material.opacity = 0.22 + Math.sin(performance.now() * 0.004) * 0.08;
  }
};
