/* ============================================================
   MEGABONK — the bonker
   ============================================================ */
'use strict';

const CHARACTERS = [
  {
    id: 'bonker', name: 'BONKER', icon: '🔨',
    desc: 'Big hammer. Big damage. No thoughts.',
    colors: { body: 0x4a90d9, pants: 0x2b4f7a, skin: 0xffc98a, hat: 0xff3d7f },
    startWeapon: 'hammer',
    mods: { maxHp: 110, damageMul: 1.10, moveSpeed: 7.2 }
  },
  {
    id: 'zoomer', name: 'ZOOMER', icon: '👟',
    desc: 'Fast legs, glass jaw. Two dashes.',
    colors: { body: 0xb6ff3d, pants: 0x2f7d4f, skin: 0xffd9a8, hat: 0xffffff },
    startWeapon: 'shuriken',
    mods: { maxHp: 80, moveSpeed: 9.0, dashCharges: 2, dashCd: 1.6 }
  },
  {
    id: 'wizard', name: 'WIZ', icon: '🧙',
    desc: 'Bigger spells, faster casting, tiny hat points.',
    colors: { body: 0x9a5cff, pants: 0x4a2b8a, skin: 0xf3d3a8, hat: 0x3dd6ff },
    startWeapon: 'missile',
    mods: { maxHp: 85, areaMul: 1.25, attackSpeedMul: 1.12, moveSpeed: 6.8 }
  },
  {
    id: 'chonk', name: 'CHONK', icon: '🪨',
    desc: 'Slow tank with armor and an angry aura.',
    colors: { body: 0xffd23d, pants: 0x8a6a1f, skin: 0xd8a06a, hat: 0x7c778f },
    startWeapon: 'aura',
    mods: { maxHp: 160, armor: 3, moveSpeed: 5.9, hpRegen: 0.6 }
  }
];

const Player = {
  mesh: null,
  parts: {},
  char: CHARACTERS[0],

  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  facing: 0,
  moveDir: new THREE.Vector3(),
  aim: new THREE.Vector3(0, 0, -1),   // last non-zero move direction (weapons fire this way)

  hp: 100,
  level: 1,
  xp: 0,
  xpNext: 5,
  gold: 0,
  kills: 0,
  damageDealt: 0,

  onGround: true,
  jumpVel: 0,
  swimT: 0,
  _wasSwimming: false,
  _splashT: 0,
  dashTime: 0,
  dashCdLeft: 0,
  dashStock: 1,
  invuln: 0,
  hurtFlash: 0,
  bobT: 0,
  alive: true,

  stats: null,

  baseStats() {
    return {
      maxHp: 100,
      hpRegen: 0,
      moveSpeed: 7.0,
      damageMul: 1,
      attackSpeedMul: 1,
      areaMul: 1,
      projSpeedMul: 1,
      pickupRadius: 4.2,
      critChance: 0.05,
      critMul: 2.0,
      armor: 0,
      xpMul: 1,
      luck: 0,
      goldMul: 1,
      cooldownMul: 1,
      dashCd: 2.2,
      dashCharges: 1,
      revives: 0,
      thorns: 0,
      lifesteal: 0
    };
  },

  init(scene, character) {
    this.char = character || CHARACTERS[0];
    this.stats = Object.assign(this.baseStats(), this.char.mods || {});

    this.hp = this.stats.maxHp;
    this.level = 1; this.xp = 0; this.xpNext = 6;
    this.gold = 0; this.kills = 0; this.damageDealt = 0;
    this.alive = true;
    this.vel.set(0, 0, 0);
    this.jumpVel = 0; this.onGround = true;
    this.dashTime = 0; this.dashCdLeft = 0;
    this.dashStock = this.stats.dashCharges;
    this.invuln = 0; this.hurtFlash = 0;
    this.facing = 0;
    this.aim.set(0, 0, -1);

    this.pos.set(0, World.heightAt(0, 0), 0);

    if (this.mesh) { scene.remove(this.mesh); this.disposeMesh(); }
    this.mesh = this._buildMesh(this.char.colors);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);

    // The ground blob lives in world space, not under the character: it has to
    // stay level with the terrain while the character spins, and its verts get
    // re-projected onto the height field so it never sinks into a slope.
    if (this.blob) scene.remove(this.blob);
    this.blob = GFX.blob(0.92, 0.3);
    scene.add(this.blob);
  },

  disposeMesh() {
    if (!this.mesh) return;
    this.mesh.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.mesh = null;
    this.parts = {};
  },

  _buildMesh(c) {
    const g = new THREE.Group();
    const mk = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), GFX.mat(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };

    const body = new THREE.Group();          // everything above the hips
    const torso = mk(1.1, 1.0, 0.7, c.body, 0, 1.5, 0);
    const head = mk(0.9, 0.85, 0.85, c.skin, 0, 2.4, 0);
    const hat = mk(1.05, 0.35, 1.05, c.hat, 0, 2.95, 0);
    const brim = mk(1.3, 0.12, 1.3, c.hat, 0, 2.78, 0);
    const eyeL = mk(0.16, 0.2, 0.1, 0x111111, -0.22, 2.45, 0.44);
    const eyeR = mk(0.16, 0.2, 0.1, 0x111111, 0.22, 2.45, 0.44);
    const armL = mk(0.3, 0.85, 0.3, c.skin, -0.72, 1.55, 0);
    const armR = mk(0.3, 0.85, 0.3, c.skin, 0.72, 1.55, 0);
    // little details that read at gameplay distance
    const glintL = mk(0.07, 0.09, 0.05, 0xffffff, -0.25, 2.49, 0.47);
    const glintR = mk(0.07, 0.09, 0.05, 0xffffff, 0.19, 2.49, 0.47);
    const belt = mk(1.16, 0.18, 0.76, 0x2a2333, 0, 1.06, 0);
    const buckle = mk(0.22, 0.22, 0.06, 0xffd23d, 0, 1.06, 0.4);
    const cape = mk(0.95, 1.15, 0.12, c.hat, 0, 1.5, -0.42);
    body.add(torso, head, hat, brim, eyeL, eyeR, armL, armR, glintL, glintR, belt, buckle, cape);

    g.rotation.order = 'YXZ';      // yaw first, so the swim lean follows facing
    const legL = mk(0.36, 0.9, 0.36, c.pants, -0.27, 0.5, 0);
    const legR = mk(0.36, 0.9, 0.36, c.pants, 0.27, 0.5, 0);

    g.add(body, legL, legR);
    this.parts = { body, torso, head, hat, armL, armR, legL, legR };

    this.parts.cape = cape;
    return g;
  },

  get radius() { return 0.62; },

  // ---- combat ----
  damage(amount, fromPos) {
    if (!this.alive || this.invuln > 0 || this.dashTime > 0) return false;
    const reduced = Math.max(1, amount - this.stats.armor);
    this.hp -= reduced;
    this.invuln = 0.68;
    this.hurtFlash = 0.35;
    FX.kick(0.5);
    PostFX.flash(0.26, 0xff2d4a);
    FX.damage(this.pos, reduced, { color: '#ff5570' });
    SFX.ouch();

    if (fromPos) {
      const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 6;
      this.vel.z += (dz / d) * 6;
    }

    if (this.hp <= 0) {
      if (this.stats.revives > 0) {
        this.stats.revives--;
        this.hp = this.stats.maxHp * 0.6;
        this.invuln = 2.5;
        FX.ring(this.pos, 0xb6ff3d, 1, 14, 0.9);
        SFX.levelup();
        UI.toast('SECOND WIND!', '#b6ff3d');
      } else {
        this.hp = 0;
        this.alive = false;
      }
    }
    return true;
  },

  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
    const gained = Math.round(this.hp - before);
    if (gained > 0) FX.damage(this.pos, gained, { color: '#7dff8a', text: '+' + gained });
  },

  addXp(n) {
    this.xp += n * this.stats.xpMul;
    let levels = 0;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      levels++;
      this.xpNext = Math.round(4 + Math.pow(this.level, 1.45) * 2.4);
      if (levels > 12) break;   // safety valve against a runaway loop
    }
    return levels;
  },

  tryDash(dir) {
    if (this.dashStock <= 0 || this.dashTime > 0) return false;
    this.dashStock--;
    this.dashTime = 0.20;
    if (dir.lengthSq() > 0.01) {
      this.aim.copy(dir).normalize();
      this.facing = Math.atan2(dir.x, dir.z);
    }
    FX.ring(this.pos, 0x3dd6ff, 0.6, 5, 0.35);
    FX.burst(this.pos, 0x3dd6ff, 8, { speed: 6, size: 0.22, life: 0.4 });
    SFX.dash();
    return true;
  },

  update(dt, input, camYaw) {
    if (!this.alive) return;
    const st = this.stats;

    // ---- input -> world-space direction (camera relative) ----
    const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    this.moveDir.set(0, 0, 0);
    if (input.up) this.moveDir.add(fwd);
    if (input.down) this.moveDir.sub(fwd);
    if (input.right) this.moveDir.add(right);
    if (input.left) this.moveDir.sub(right);
    const moving = this.moveDir.lengthSq() > 0.0001;
    if (moving) {
      this.moveDir.normalize();
      this.aim.copy(this.moveDir);
    }

    // ---- dash ----
    if (this.dashTime > 0) this.dashTime -= dt;
    if (this.dashStock < st.dashCharges) {
      this.dashCdLeft -= dt;
      if (this.dashCdLeft <= 0) {
        this.dashStock = Math.min(st.dashCharges, this.dashStock + 1);
        this.dashCdLeft = st.dashCd;
      }
    } else {
      this.dashCdLeft = st.dashCd;
    }
    if (input.dash) {
      if (this.tryDash(this.moveDir.lengthSq() > 0.01 ? this.moveDir : this.aim)) {
        if (this.dashStock < st.dashCharges && this.dashCdLeft <= 0) this.dashCdLeft = st.dashCd;
      }
      input.dash = false;
    }

    // ---- water ----
    // Deep water is swimmable: you float at the surface and move at about
    // half speed, so the lake is a real tactical hazard rather than scenery.
    const swim = World.swimFactor(this.pos.x, this.pos.z);
    this.swimT = U.damp(this.swimT, swim, 0.0001, dt);
    if (swim > 0.5 && !this._wasSwimming) {
      this._wasSwimming = true;
      // splash at the waterline, not down at the swimmer's feet
      const surf = new THREE.Vector3(this.pos.x, World.surfaceY(this.pos.x, this.pos.z), this.pos.z);
      FX.burst(surf, 0x9fe8ff, 14, { speed: 7, size: 0.22, life: 0.5, additive: true, glow: 1.6 });
      FX.ring(surf, 0x9fe8ff, 0.6, 4, 0.5);
      SFX.noise(0.22, 0.2, 1400);
    } else if (swim < 0.2) {
      this._wasSwimming = false;
    }

    // ---- horizontal movement ----
    const waterDrag = U.lerp(1, 0.48, this.swimT);
    const speed = st.moveSpeed * (this.dashTime > 0 ? 4.2 : 1) * waterDrag;
    const accel = this.onGround ? 42 : 18;
    const target = this.dashTime > 0
      ? this.aim.clone().multiplyScalar(speed)
      : this.moveDir.clone().multiplyScalar(moving ? speed : 0);

    this.vel.x = U.damp(this.vel.x, target.x, 0.0001, dt * (accel / 42));
    this.vel.z = U.damp(this.vel.z, target.z, 0.0001, dt * (accel / 42));

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (World.confine(this.pos, 2)) { this.vel.x *= 0.2; this.vel.z *= 0.2; }

    // trees, boulders, crystals and logs are solid; slide along them rather
    // than stopping dead, and note that jumping clears the shorter ones
    if (World.resolveCircle(this.pos, this.radius, this.pos.y + 0.25)) {
      World.slide(this.vel);
      if (this.dashTime > 0) this.dashTime = 0;      // a dash ends on impact
    }

    // ---- jump / gravity (terrain following) ----
    const terrain = World.heightAt(this.pos.x, this.pos.z);
    const ground = World.floatY(terrain, this.swimT, this.pos.x, this.pos.z, 1.3);
    if (input.jump && this.onGround) {
      this.jumpVel = this.swimT > 0.4 ? 5.5 : 11.5;   // you cannot leap out of deep water
      this.onGround = false;
      SFX.tone(this.swimT > 0.4 ? 300 : 420, 0.09, 'square', 0.12, 700);
    }
    input.jump = false;

    if (!this.onGround) {
      this.jumpVel -= 32 * dt;
      this.pos.y += this.jumpVel * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.onGround = true;
        this.jumpVel = 0;
        FX.burst(this.pos, 0xc8b78a, 4, { speed: 3.5, size: 0.16, life: 0.3 });
      }
    } else {
      // the height field is continuous, so snapping is stable and keeps the
      // feet planted on slopes; swimmers bob on the surface instead
      // the wave itself supplies the rise and fall; this is just a little life
      this.pos.y = ground + (this.swimT > 0.05 ? Math.sin(this.bobT * 1.7) * 0.05 * this.swimT : 0);
    }

    // wake trail while moving through water
    if (this.swimT > 0.25) {
      this._splashT -= dt;
      const moveSpeed = Math.hypot(this.vel.x, this.vel.z);
      if (this._splashT <= 0 && moveSpeed > 1.5) {
        this._splashT = 0.09;
        FX._tmp.set(this.pos.x, World.surfaceY(this.pos.x, this.pos.z) + 0.05, this.pos.z);
        FX.trail(FX._tmp, 0xbdf0ff, 0.3, 0.4);
      }
    }

    // ---- facing + animation ----
    if (moving || this.dashTime > 0) {
      const want = Math.atan2(this.aim.x, this.aim.z);
      this.facing = U.approachAngle(this.facing, want, 1 - Math.pow(0.0005, dt));
    }
    const speedNow = Math.hypot(this.vel.x, this.vel.z);
    this.bobT += dt * (2.5 + speedNow * 1.5);

    const p = this.parts;
    const swing = Math.sin(this.bobT * 3.2) * U.clamp(speedNow / 7, 0, 1) * 0.9;
    const s = this.swimT;
    if (s > 0.02) {
      // flutter kick and an overarm pull, blended in as you wade deeper
      const k = this.bobT * 5.0;
      p.legL.rotation.x = U.lerp(swing, -0.5 + Math.sin(k) * 0.5, s);
      p.legR.rotation.x = U.lerp(-swing, -0.5 + Math.sin(k + Math.PI) * 0.5, s);
      p.armL.rotation.x = U.lerp(-swing * 0.7, -1.15 + Math.sin(k * 0.75) * 0.85, s);
      p.armR.rotation.x = U.lerp(swing * 0.7, -1.15 + Math.sin(k * 0.75 + Math.PI) * 0.85, s);
      this.mesh.rotation.x = 0.32 * s;
      this.mesh.rotation.z = Math.sin(this.bobT * 1.6) * 0.09 * s;
    } else {
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
      p.armL.rotation.x = -swing * 0.7;
      p.armR.rotation.x = swing * 0.7;
      if (this.mesh.rotation.x !== 0) { this.mesh.rotation.x = 0; this.mesh.rotation.z = 0; }
    }
    p.body.position.y = Math.abs(Math.sin(this.bobT * 3.2)) * 0.09 * U.clamp(speedNow / 5, 0, 1);
    p.body.rotation.z = Math.sin(this.bobT * 3.2) * 0.03;

    // hurt flash / invulnerability blink
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    const blink = this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0;
    this.mesh.visible = !blink;
    const tint = this.hurtFlash > 0 ? 0xff4444 : this.char.colors.body;
    if (this._tint !== tint) { this._tint = tint; GFX.setCol(p.torso.material.color, tint); }

    // cape trails behind the run
    if (p.cape) {
      p.cape.rotation.x = -U.clamp(speedNow / 9, 0, 1) * 0.55 - Math.sin(this.bobT * 3.2) * 0.06;
    }

    // regen
    if (st.hpRegen > 0 && this.hp > 0) this.heal2(st.hpRegen * dt);

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;

    // ground blob: sits on the terrain surface and shrinks as you jump
    if (this.blob) {
      const air = U.clamp(1 - (this.pos.y - ground) / 7, 0.3, 1);
      const r = 0.92 * air;
      this.blob.visible = GFX.q.blobs && this.swimT < 0.6;
      this.blob.position.set(this.pos.x, terrain, this.pos.z);
      this.blob.material.opacity = 0.3 * air * (1 - this.swimT);
      GFX.conform(this.blob, this.pos.x, this.pos.z, r, 0.07);
    }
  },

  // silent regen (no floating text spam)
  heal2(amount) {
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
  }
};
