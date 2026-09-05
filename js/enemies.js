/* ============================================================
   MEGABONK — enemies, spawn director, loot
   ============================================================ */
'use strict';

const ENEMY_TYPES = {
  grunt:  { name: 'Bonkling',  hp: 12,  speed: 3.0, dmg: 6,  radius: 0.62, xp: 1, scale: 1.0, color: 0x9a5cff, weight: 100, minute: 0 },
  runner: { name: 'Zoomling',  hp: 8,   speed: 5.4, dmg: 5,  radius: 0.5,  xp: 1, scale: 0.85, color: 0xff3d7f, weight: 55,  minute: 1 },
  bat:    { name: 'Flapper',   hp: 10,  speed: 4.5, dmg: 6,  radius: 0.5,  xp: 2, scale: 0.8,  color: 0x3dd6ff, weight: 45,  minute: 2, fly: true },
  tank:   { name: 'Chunker',   hp: 60,  speed: 2.0, dmg: 16, radius: 1.05, xp: 4, scale: 1.6,  color: 0x7c778f, weight: 30,  minute: 3 },
  bomber: { name: 'Poppy',     hp: 22,  speed: 3.4, dmg: 10, radius: 0.75, xp: 3, scale: 1.1,  color: 0xff8a3d, weight: 26,  minute: 4, explodes: true },
  shooter:{ name: 'Spitter',   hp: 26,  speed: 2.4, dmg: 9,  radius: 0.7,  xp: 3, scale: 1.0,  color: 0x63e08a, weight: 24,  minute: 5, ranged: true },
  brute:  { name: 'Megachunk', hp: 140, speed: 2.6, dmg: 22, radius: 1.35, xp: 8, scale: 2.1,  color: 0xd93b3b, weight: 16,  minute: 7 }
};

const BOSSES = [
  { name: 'BONKZILLA',   color: 0x9a5cff, hp: 900,  speed: 2.7, dmg: 24, scale: 4.2 },
  { name: 'THE CHONKER', color: 0xff8a3d, hp: 2400, speed: 2.4, dmg: 30, scale: 5.0 },
  { name: 'MEGABONK',    color: 0xff3d7f, hp: 5200, speed: 3.0, dmg: 38, scale: 6.0 }
];

const Enemies = {
  scene: null,
  list: [],
  pools: {},
  spawnTimer: 0,
  bossTimer: 180,
  bossIndex: 0,
  boss: null,
  eliteChance: 0,

  // uniform grid for neighbour queries
  CELL: 4,
  grid: new Map(),
  maxRadius: 1,

  init(scene) {
    this.scene = scene;
    this.list.length = 0;
    this.pools = {};
    this.spawnTimer = 0;
    this.bossTimer = 180;
    this.bossIndex = 0;
    this.boss = null;
    this.grid.clear();
  },

  clear() {
    for (const e of this.list) this._recycle(e);
    this.list.length = 0;
    this.boss = null;
    this.grid.clear();
  },

  // ---------- meshes ----------
  _buildMesh(typeId, def) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const box = (w, h, d, c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
      m.position.set(x, y, z); m.castShadow = true; return m;
    };
    const bodyColor = def.color;
    const dark = new THREE.Color(bodyColor).multiplyScalar(0.6).getHex();

    const body = box(1, 1, 0.9, bodyColor, 0, 0.75, 0);
    const eyeL = box(0.2, 0.24, 0.1, 0xffffff, -0.24, 0.92, 0.48);
    const eyeR = box(0.2, 0.24, 0.1, 0xffffff, 0.24, 0.92, 0.48);
    const pupL = box(0.1, 0.12, 0.06, 0x140f1f, -0.24, 0.9, 0.54);
    const pupR = box(0.1, 0.12, 0.06, 0x140f1f, 0.24, 0.9, 0.54);
    g.add(body, eyeL, eyeR, pupL, pupR);

    const legL = box(0.24, 0.42, 0.24, dark, -0.28, 0.22, 0);
    const legR = box(0.24, 0.42, 0.24, dark, 0.28, 0.22, 0);
    g.add(legL, legR);

    const extras = [];
    if (typeId === 'runner') {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 4), mat(0xffffff));
      horn.position.set(0, 1.45, 0); horn.castShadow = true;
      g.add(horn); extras.push(horn);
    } else if (typeId === 'tank' || typeId === 'brute') {
      const plate = box(1.35, 0.5, 1.15, dark, 0, 1.05, 0);
      const spikeL = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 4), mat(0xd8d2e8));
      spikeL.position.set(-0.45, 1.45, 0);
      const spikeR = spikeL.clone(); spikeR.position.x = 0.45;
      g.add(plate, spikeL, spikeR); extras.push(plate, spikeL, spikeR);
    } else if (typeId === 'bomber') {
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 5), mat(0x3a2a1a));
      fuse.position.set(0, 1.4, 0);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
      spark.position.set(0, 1.62, 0);
      g.add(fuse, spark); extras.push(fuse, spark);
    } else if (typeId === 'shooter') {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.8, 6), mat(0x2f7d4f));
      hat.position.set(0, 1.6, 0); hat.castShadow = true;
      g.add(hat); extras.push(hat);
    } else if (typeId === 'bat') {
      const wingGeo = new THREE.BoxGeometry(0.75, 0.08, 0.42);
      const wl = new THREE.Mesh(wingGeo, mat(dark)); wl.position.set(-0.75, 0.85, 0);
      const wr = new THREE.Mesh(wingGeo, mat(dark)); wr.position.set(0.75, 0.85, 0);
      g.add(wl, wr); extras.push(wl, wr);
      g.userData.wings = [wl, wr];
    } else if (typeId === 'boss') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.3, 6), mat(0xffd23d));
      crown.position.set(0, 1.42, 0);
      const spikes = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 4), mat(0xffd23d));
        const a = (i / 5) * U.TAU;
        s.position.set(Math.cos(a) * 0.55, 1.72, Math.sin(a) * 0.55);
        spikes.add(s);
      }
      g.add(crown, spikes); extras.push(crown, spikes);
    }

    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    g.add(blob);

    g.userData.body = body;
    g.userData.legs = [legL, legR];
    g.userData.extras = extras;
    g.userData.blob = blob;
    g.userData.baseColor = bodyColor;
    return g;
  },

  _take(typeId, def) {
    const pool = this.pools[typeId] || (this.pools[typeId] = []);
    let mesh = pool.pop();
    if (!mesh) mesh = this._buildMesh(typeId, def);
    mesh.visible = true;
    this.scene.add(mesh);
    return mesh;
  },

  _recycle(e) {
    this.scene.remove(e.mesh);
    e.mesh.visible = false;
    (this.pools[e.poolId] || (this.pools[e.poolId] = [])).push(e.mesh);
  },

  // ---------- spawning ----------
  spawnAt(typeId, pos, opts = {}) {
    const base = typeId === 'boss' ? opts.bossDef : ENEMY_TYPES[typeId];
    if (!base) return null;

    const poolId = typeId === 'boss' ? 'boss' : typeId;
    const mesh = this._take(poolId, base);

    const t = Game.time;
    const hpScale = 1 + t / 60 * 0.42 + Math.pow(t / 210, 2.1);
    const dmgScale = 1 + t / 60 * 0.16;

    const elite = !!opts.elite;
    const scale = base.scale * (elite ? 1.4 : 1);

    const e = {
      typeId, poolId, def: base, mesh,
      pos: mesh.position,
      vx: 0, vz: 0,
      hp: base.hp * hpScale * (elite ? 4 : 1) * (opts.hpMul || 1),
      maxHp: 0,
      speed: base.speed * (elite ? 0.85 : 1) * U.rand(0.92, 1.08),
      dmg: base.dmg * dmgScale * (elite ? 1.5 : 1),
      radius: typeId === 'boss' ? base.scale * 0.55 : (base.radius || 0.7) * (elite ? 1.4 : 1),
      xp: base.xp * (elite ? 8 : 1),
      scale,
      elite,
      isBoss: typeId === 'boss',
      fly: !!base.fly,
      ranged: !!base.ranged,
      explodes: !!base.explodes,
      flash: 0,
      attackCd: 0,
      shootCd: U.rand(1.2, 2.6),
      hopT: Math.random() * 10,
      slow: 0,
      knock: 0,
      dead: false,
      spawnT: 0.35
    };
    e.maxHp = e.hp;

    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.scale.setScalar(0.01);
    // bosses share one mesh pool but not one colour, so re-tint on every spawn
    mesh.userData.baseColor = base.color;
    mesh.userData.body.material.color.setHex(elite ? 0xffd23d : base.color);
    const legDark = new THREE.Color(base.color).multiplyScalar(0.6).getHex();
    for (const leg of mesh.userData.legs) leg.material.color.setHex(legDark);

    this.list.push(e);
    return e;
  },

  spawnWave(dt) {
    const t = Game.time;
    const minute = t / 60;

    // ---- boss ----
    this.bossTimer -= dt;
    if (this.bossTimer <= 0 && !this.boss && this.bossIndex < BOSSES.length) {
      const def = BOSSES[this.bossIndex];
      const p = World.ringPoint(Player.pos, 24, 30);
      const e = this.spawnAt('boss', p, { bossDef: Object.assign({}, def, { radius: 1.6, xp: 120 }) });
      if (e) {
        e.dmg = def.dmg;
        e.speed = def.speed;
        e.hp = e.maxHp = def.hp * (1 + t / 240);
        e.xp = 150;
        e.bossName = def.name;
        this.boss = e;
        this.bossIndex++;
        this.bossTimer = 999;
        SFX.boss();
        FX.kick(1.2);
        UI.toast(def.name + ' APPROACHES', '#ff3d7f');
        UI.showBoss(def.name);
      }
    }

    // ---- trash ----
    const rate = 0.6 + minute * 0.5 + Math.pow(minute, 1.8) * 0.09;   // spawns per second
    const cap = Math.min(200, 35 + minute * 22);
    this.spawnTimer += dt * rate;

    this.eliteChance = U.clamp((minute - 2.5) * 0.012, 0, 0.09);

    if (this.spawnTimer > 8) this.spawnTimer = 8;   // never bank a giant burst
    while (this.spawnTimer >= 1) {
      this.spawnTimer -= 1;
      if (this.list.length >= cap) { this.spawnTimer = 0; break; }

      const avail = [];
      for (const id in ENEMY_TYPES) {
        const d = ENEMY_TYPES[id];
        if (minute >= d.minute) avail.push({ id, weight: d.weight * (1 + minute * 0.05) });
      }
      const choice = U.weighted(avail);
      const p = World.ringPoint(Player.pos, 26, 40);
      this.spawnAt(choice.id, p, { elite: U.chance(this.eliteChance) });
    }

    // ---- occasional pack of runners ----
    if (t > 60 && U.chance(dt * 0.06)) {
      const center = World.ringPoint(Player.pos, 26, 34);
      const n = U.randInt(5, 10);
      for (let i = 0; i < n; i++) {
        const p = new THREE.Vector3(center.x + U.rand(-4, 4), 0, center.z + U.rand(-4, 4));
        World.confine(p, 6);
        p.y = World.heightAt(p.x, p.z);
        this.spawnAt(minute > 4 ? 'bat' : 'runner', p);
      }
    }
  },

  // ---------- spatial grid ----------
  _key(x, z) { return Math.floor(x / this.CELL) + ',' + Math.floor(z / this.CELL); },

  rebuildGrid() {
    this.grid.clear();
    this.maxRadius = 1;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.radius > this.maxRadius) this.maxRadius = e.radius;
      const k = this._key(e.pos.x, e.pos.z);
      let cell = this.grid.get(k);
      if (!cell) { cell = []; this.grid.set(k, cell); }
      cell.push(e);
    }
  },

  // call cb(enemy) for every enemy within `r` of (x,z)
  query(x, z, r, cb) {
    const c = this.CELL;
    // pad the cell span by the biggest body radius in play, otherwise a large
    // enemy whose centre sits in a neighbouring cell is missed entirely
    const pad = r + this.maxRadius;
    const x0 = Math.floor((x - pad) / c), x1 = Math.floor((x + pad) / c);
    const z0 = Math.floor((z - pad) / c), z1 = Math.floor((z + pad) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.grid.get(cx + ',' + cz);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          if (e.dead) continue;
          const dx = e.pos.x - x, dz = e.pos.z - z;
          const reach = r + e.radius;
          if (dx * dx + dz * dz <= reach * reach) cb(e);
        }
      }
    }
  },

  nearest(x, z, maxR, skip) {
    let best = null, bestD = maxR * maxR;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.dead || e === skip) continue;
      const d = U.dist2(e.pos.x, e.pos.z, x, z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  },

  randomNear(x, z, maxR) {
    const found = [];
    this.query(x, z, maxR, e => found.push(e));
    return found.length ? U.pick(found) : null;
  },

  // ---------- damage ----------
  hurt(e, amount, opts = {}) {
    if (e.dead) return 0;
    let dmg = amount;
    let crit = false;
    if (opts.canCrit !== false && U.chance(Player.stats.critChance)) {
      dmg *= Player.stats.critMul;
      crit = true;
    }
    e.hp -= dmg;
    e.flash = 0.12;
    Player.damageDealt += dmg;

    if (!opts.silent) FX.damage(e.pos, dmg, { crit });
    if (opts.knock) {
      const dx = e.pos.x - opts.knock.x, dz = e.pos.z - opts.knock.z;
      const d = Math.hypot(dx, dz) || 1;
      const k = opts.knockPower || 6;
      e.vx += (dx / d) * k * (e.isBoss ? 0.12 : 1);
      e.vz += (dz / d) * k * (e.isBoss ? 0.12 : 1);
      e.knock = 0.16;
    }
    if (opts.slow) e.slow = Math.max(e.slow, opts.slow);

    if (Player.stats.lifesteal > 0) Player.heal2(dmg * Player.stats.lifesteal);

    if (e.hp <= 0) this.kill(e);
    return dmg;
  },

  kill(e) {
    if (e.dead) return;
    e.dead = true;
    Player.kills++;
    SFX.die();

    const c = e.mesh.userData.baseColor;
    FX.burst(e.pos, c, e.isBoss ? 60 : (e.elite ? 22 : 9), {
      speed: e.isBoss ? 20 : 10, size: 0.3 * e.scale, life: e.isBoss ? 1.4 : 0.6
    });

    if (e.explodes) {
      FX.ring(e.pos, 0xff8a3d, 1, 7 * Player.stats.areaMul, 0.45);
      SFX.boom();
      const r = 5.0;
      this.query(e.pos.x, e.pos.z, r, o => {
        if (o !== e) this.hurt(o, 18 * (1 + Game.time / 120), { canCrit: false });
      });
      if (U.dist2(Player.pos.x, Player.pos.z, e.pos.x, e.pos.z) < r * r) Player.damage(e.dmg * 0.8, e.pos);
    }

    // ---- loot ----
    Loot.dropXp(e.pos, e.xp);
    const luck = Player.stats.luck;
    if (U.chance(0.14 + luck * 0.02)) Loot.dropGold(e.pos, e.isBoss ? 60 : (e.elite ? 12 : 1 + Math.floor(Game.time / 90)));
    if (U.chance(0.012 + luck * 0.004)) Loot.dropHeart(e.pos);
    if (e.elite || e.isBoss || U.chance(0.004 + luck * 0.002)) Loot.dropChest(e.pos);

    if (e.isBoss) {
      this.boss = null;
      this.bossTimer = 210;
      FX.kick(1.4);
      SFX.win();
      UI.toast('BOSS BONKED!', '#ffd23d');
      UI.hideBoss();
      for (let i = 0; i < 5; i++) {
        Loot.dropGold(new THREE.Vector3(e.pos.x + U.rand(-3, 3), e.pos.y, e.pos.z + U.rand(-3, 3)), 25);
      }
    }
  },

  // ---------- per-frame ----------
  update(dt) {
    const px = Player.pos.x, pz = Player.pos.z, py = Player.pos.y;
    this.rebuildGrid();

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.dead) {
        this._recycle(e);
        U.swapRemove(this.list, i);
        continue;
      }

      // spawn pop-in
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        const t = U.clamp(1 - e.spawnT / 0.35, 0, 1);
        e.mesh.scale.setScalar(e.scale * (0.4 + 0.6 * t) * (1 + Math.sin(t * Math.PI) * 0.25));
      } else if (e.mesh.scale.x !== e.scale) {
        e.mesh.scale.setScalar(e.scale);
      }

      if (e.slow > 0) e.slow = Math.max(0, e.slow - dt * 0.8);
      if (e.knock > 0) e.knock -= dt;

      // ---- steering ----
      const dx = px - e.pos.x, dz = pz - e.pos.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      let sx = dx / dist, sz = dz / dist;

      // ranged units hold at a distance
      if (e.ranged && dist < 11) { sx = -sx * 0.8; sz = -sz * 0.8; }

      // separation from neighbours (keeps the horde from stacking into one point)
      let ax = 0, az = 0, n = 0;
      const cx = Math.floor(e.pos.x / this.CELL), cz = Math.floor(e.pos.z / this.CELL);
      for (let gx = cx - 1; gx <= cx + 1 && n < 8; gx++) {
        for (let gz = cz - 1; gz <= cz + 1 && n < 8; gz++) {
          const cell = this.grid.get(gx + ',' + gz);
          if (!cell) continue;
          for (let j = 0; j < cell.length && n < 8; j++) {
            const o = cell[j];
            if (o === e || o.dead) continue;
            const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z;
            const d2 = ox * ox + oz * oz;
            const want = (e.radius + o.radius) * 0.95;
            if (d2 < want * want && d2 > 0.0001) {
              const d = Math.sqrt(d2);
              ax += (ox / d) * (1 - d / want);
              az += (oz / d) * (1 - d / want);
              n++;
            }
          }
        }
      }

      const spd = e.speed * (1 - e.slow * 0.55);
      const push = e.isBoss ? 0.4 : 2.6;
      let vx = sx * spd + ax * push * spd * 0.5;
      let vz = sz * spd + az * push * spd * 0.5;

      // knockback velocity decays into the steering
      e.vx = U.damp(e.vx, 0, 0.0005, dt);
      e.vz = U.damp(e.vz, 0, 0.0005, dt);
      vx += e.vx; vz += e.vz;

      e.pos.x += vx * dt;
      e.pos.z += vz * dt;
      World.confine(e.pos, 1);

      // ---- vertical ----
      const ground = World.heightAt(e.pos.x, e.pos.z);
      e.hopT += dt;
      if (e.fly) {
        e.pos.y = ground + 2.2 + Math.sin(e.hopT * 4) * 0.45;
        const w = e.mesh.userData.wings;
        if (w) { w[0].rotation.z = Math.sin(e.hopT * 22) * 0.8; w[1].rotation.z = -Math.sin(e.hopT * 22) * 0.8; }
      } else {
        const hop = Math.abs(Math.sin(e.hopT * (3 + e.speed * 0.4))) * (e.isBoss ? 0.22 : 0.18);
        e.pos.y = ground + hop;
        const legs = e.mesh.userData.legs;
        if (legs) {
          const sw = Math.sin(e.hopT * (6 + e.speed)) * 0.7;
          legs[0].rotation.x = sw; legs[1].rotation.x = -sw;
        }
      }
      e.mesh.rotation.y = Math.atan2(sx, sz);
      const blob = e.mesh.userData.blob;
      if (blob) blob.position.y = (ground - e.pos.y) + 0.04;

      // ---- flash ----
      if (e.flash > 0) {
        e.flash -= dt;
        const col = e.flash > 0 ? 0xffffff : (e.elite ? 0xffd23d : e.mesh.userData.baseColor);
        e.mesh.userData.body.material.color.setHex(col);
      }

      // ---- attacks ----
      e.attackCd -= dt;
      const touch = e.radius + Player.radius + 0.15;
      const vertOK = Math.abs(e.pos.y - py) < 3.2;
      if (!e.ranged && dist < touch && vertOK && e.attackCd <= 0) {
        if (Player.damage(e.dmg, e.pos)) {
          e.attackCd = 0.75;
          if (Player.stats.thorns > 0) this.hurt(e, Player.stats.thorns, { canCrit: false, silent: true });
          if (e.explodes) this.kill(e);
        }
      }
      if (e.ranged) {
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 26) {
          e.shootCd = U.rand(2.0, 3.4);
          Weapons.enemyShot(e, Player.pos);
        }
      }
    }
  }
};

/* ============================================================
   LOOT — xp gems, gold, hearts, chests
   ============================================================ */
const Loot = {
  scene: null,
  list: [],
  pool: [],
  magnetAll: false,

  GEO: null,
  MATS: null,

  init(scene) {
    this.scene = scene;
    this.clear();
    if (!this.GEO) {
      this.GEO = {
        gem: new THREE.OctahedronGeometry(0.34, 0),
        coin: new THREE.CylinderGeometry(0.3, 0.3, 0.08, 10),
        heart: new THREE.BoxGeometry(0.5, 0.5, 0.5),
        chest: new THREE.BoxGeometry(0.8, 0.6, 0.6)
      };
      this.MATS = {
        gem1: new THREE.MeshLambertMaterial({ color: 0x3dd6ff, emissive: 0x0d4a63 }),
        gem2: new THREE.MeshLambertMaterial({ color: 0xb6ff3d, emissive: 0x2d5f0d }),
        gem3: new THREE.MeshLambertMaterial({ color: 0xff3d7f, emissive: 0x6b0d2f }),
        coin: new THREE.MeshLambertMaterial({ color: 0xffd23d, emissive: 0x5c4200 }),
        heart: new THREE.MeshLambertMaterial({ color: 0xff5570, emissive: 0x6b0d1f }),
        chest: new THREE.MeshLambertMaterial({ color: 0xffd23d, emissive: 0x4a3200 })
      };
    }
  },

  clear() {
    for (const it of this.list) { this.scene.remove(it.mesh); this.pool.push(it.mesh); }
    this.list.length = 0;
    this.magnetAll = false;
  },

  _spawn(geo, mat, pos, kind, value, scale = 1) {
    let mesh = this.pool.pop();
    if (mesh) {
      mesh.geometry = geo; mesh.material = mat;
    } else {
      mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
    }
    mesh.scale.setScalar(scale);
    mesh.position.set(pos.x + U.rand(-0.3, 0.3), pos.y + 0.6, pos.z + U.rand(-0.3, 0.3));
    this.scene.add(mesh);
    this.list.push({
      mesh, kind, value,
      vy: U.rand(3, 6),
      t: Math.random() * 10,
      settled: false,
      life: 0
    });
    // hard cap so a very long run cannot pile up thousands of pickups.
    // the oldest drop is auto-collected rather than deleted, so the horde
    // never quietly eats your XP
    if (this.list.length > 400) {
      const old = this.list.shift();
      this.collect(old);
      this.scene.remove(old.mesh);
      this.pool.push(old.mesh);
    }
  },

  dropXp(pos, value) {
    const mat = value >= 8 ? this.MATS.gem3 : (value >= 3 ? this.MATS.gem2 : this.MATS.gem1);
    this._spawn(this.GEO.gem, mat, pos, 'xp', value, 1 + Math.min(value, 10) * 0.06);
  },
  dropGold(pos, value) { this._spawn(this.GEO.coin, this.MATS.coin, pos, 'gold', value); },
  dropHeart(pos)       { this._spawn(this.GEO.heart, this.MATS.heart, pos, 'heart', 25); },
  dropChest(pos)       { this._spawn(this.GEO.chest, this.MATS.chest, pos, 'chest', 1, 1.2); },

  magnetize() {
    this.magnetAll = true;
    for (const it of this.list) it.settled = true;
  },

  update(dt) {
    const px = Player.pos.x, pz = Player.pos.z;
    const pickR = Player.stats.pickupRadius;
    const pickR2 = pickR * pickR;
    const grabR2 = 1.3 * 1.3;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      const m = it.mesh;
      it.t += dt;
      it.life += dt;

      // little pop out of the corpse
      const ground = World.heightAt(m.position.x, m.position.z) + 0.55;
      if (!it.settled) {
        it.vy -= 26 * dt;
        m.position.y += it.vy * dt;
        if (m.position.y <= ground) { m.position.y = ground; it.settled = true; }
      } else {
        m.position.y = ground + Math.sin(it.t * 3) * 0.12;
      }
      m.rotation.y += dt * 2.2;

      const d2 = U.dist2(m.position.x, m.position.z, px, pz);

      // magnet drift
      if (it.settled && (d2 < pickR2 || this.magnetAll)) {
        const d = Math.sqrt(d2) || 1;
        const pull = this.magnetAll ? 26 : U.lerp(22, 6, U.clamp(d / pickR, 0, 1));
        m.position.x += ((px - m.position.x) / d) * pull * dt;
        m.position.z += ((pz - m.position.z) / d) * pull * dt;
      }

      if (d2 < grabR2) {
        this.collect(it);
        this.scene.remove(m);
        this.pool.push(m);
        U.swapRemove(this.list, i);
      }
    }
    if (this.magnetAll && this.list.length === 0) this.magnetAll = false;
  },

  collect(it) {
    switch (it.kind) {
      case 'xp': {
        const levels = Player.addXp(it.value);
        SFX.gem();
        if (levels > 0) Game.queueLevelUps(levels);
        break;
      }
      case 'gold':
        Player.gold += Math.round(it.value * Player.stats.goldMul);
        SFX.coin();
        break;
      case 'heart':
        Player.heal(it.value);
        SFX.heal();
        break;
      case 'chest':
        SFX.chest();
        FX.ring(Player.pos, 0xffd23d, 1, 8, 0.5);
        Game.queueLevelUps(1);
        UI.toast('CHEST!', '#ffd23d');
        break;
    }
  }
};
