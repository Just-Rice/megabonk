/* ============================================================
   MEGABONK — damage numbers, particles, shockwaves, screenshake
   ============================================================ */
'use strict';

const FX = {
  scene: null,
  camera: null,

  numbers: [],  numIdx: 0,
  parts: [],    partIdx: 0,
  rings: [],    ringIdx: 0,
  _texCache: new Map(),

  shake: 0,
  shakeDecay: 4.5,

  MAX_NUMBERS: 46,
  MAX_PARTS: 420,
  MAX_RINGS: 22,

  init(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    for (let i = 0; i < this.MAX_NUMBERS; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, depthTest: false, depthWrite: false, fog: false
      }));
      spr.visible = false;
      spr.renderOrder = 900;
      spr.userData = { life: 0, vy: 0, vx: 0, vz: 0, max: 1 };
      scene.add(spr);
      this.numbers.push(spr);
    }

    const pgeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < this.MAX_PARTS; i++) {
      const m = new THREE.Mesh(pgeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }));
      m.frustumCulled = false;
      m.visible = false;
      m.userData = { life: 0, max: 1, v: new THREE.Vector3(), spin: new THREE.Vector3(), grav: -34, size: 1 };
      scene.add(m);
      this.parts.push(m);
    }

    for (let i = 0; i < this.MAX_RINGS; i++) {
      // its own geometry per ring: the vertices are re-projected onto the
      // height field every frame so the ring never sinks into a slope
      const m = new THREE.Mesh(GFX.makeDisc(1, 48, 0.74), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1, side: THREE.DoubleSide,
        depthWrite: false, fog: false, blending: THREE.AdditiveBlending
      }));
      m.visible = false;
      m.frustumCulled = false;
      m.userData = { life: 0, max: 1, from: 1, to: 5, cx: 0, cz: 0 };
      scene.add(m);
      this.rings.push(m);
    }
  },

  reset() {
    for (const n of this.numbers) { n.visible = false; n.userData.life = 0; }
    for (const p of this.parts)   { p.visible = false; p.userData.life = 0; }
    for (const r of this.rings)   { r.visible = false; r.userData.life = 0; }
    this.shake = 0;
  },

  _numberTexture(text, color) {
    const key = text + '|' + color;
    let tex = this._texCache.get(key);
    if (tex) return tex;

    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 44px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#000';
    g.strokeText(text, 64, 34);
    g.fillStyle = color;
    g.fillText(text, 64, 34);

    tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    if (this._texCache.size > 320) {
      // drop the oldest entry so long runs don't grow textures forever
      const first = this._texCache.keys().next().value;
      const old = this._texCache.get(first);
      if (old) old.dispose();
      this._texCache.delete(first);
    }
    this._texCache.set(key, tex);
    return tex;
  },

  damage(pos, amount, opts = {}) {
    const crit = !!opts.crit;
    const text = opts.text || U.fmtNum(amount);
    const color = opts.color || (crit ? '#ffd23d' : '#ffffff');
    const spr = this.numbers[this.numIdx = (this.numIdx + 1) % this.MAX_NUMBERS];

    spr.material.map = this._numberTexture(text, color);
    spr.material.map.encoding = THREE.sRGBEncoding;
    spr.material.opacity = 1;
    spr.material.needsUpdate = true;
    spr.position.set(pos.x + U.rand(-0.4, 0.4), pos.y + 1.4, pos.z + U.rand(-0.4, 0.4));
    const s = crit ? 2.4 : 1.6;
    spr.scale.set(s, s * 0.5, 1);
    spr.userData.life = spr.userData.max = crit ? 1.05 : 0.75;
    spr.userData.vy = crit ? 5.2 : 4.2;
    spr.userData.vx = U.rand(-1.4, 1.4);
    spr.userData.vz = U.rand(-1.4, 1.4);
    spr.userData.baseScale = s;
    spr.visible = true;
  },

  burst(pos, color, count = 8, opts = {}) {
    const speed = opts.speed || 9;
    const size = opts.size || 0.34;
    const life = opts.life || 0.6;
    const grav = opts.grav === undefined ? -34 : opts.grav;
    count = Math.max(2, Math.round(count * GFX.q.particleScale));
    for (let i = 0; i < count; i++) {
      const p = this.parts[this.partIdx = (this.partIdx + 1) % this.MAX_PARTS];
      GFX.setCol(p.material.color, color);
      p.material.color.multiplyScalar(opts.glow || 1);
      // blending only takes effect on a material flagged transparent
      this._setBlend(p.material, !!opts.additive);
      p.position.copy(pos);
      const a = Math.random() * U.TAU, up = U.rand(0.25, 1.1);
      p.userData.v.set(Math.cos(a) * U.rand(0.4, 1) * speed, up * speed, Math.sin(a) * U.rand(0.4, 1) * speed);
      p.userData.spin.set(U.rand(-9, 9), U.rand(-9, 9), U.rand(-9, 9));
      p.userData.life = p.userData.max = life * U.rand(0.7, 1.25);
      p.userData.grav = grav;
      const s = size * U.rand(0.6, 1.5);
      p.userData.size = s;
      p.scale.set(s, s, s);
      p.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.visible = true;
    }
  },

  // single stationary additive puff — used to draw projectile trails
  trail(pos, color, size = 0.22, life = 0.26) {
    if (GFX.q.particleScale < 0.6 && Math.random() > GFX.q.particleScale) return;
    const p = this.parts[this.partIdx = (this.partIdx + 1) % this.MAX_PARTS];
    GFX.setCol(p.material.color, color);
    p.material.color.multiplyScalar(2.2);
    this._setBlend(p.material, true);
    p.position.copy(pos);
    p.userData.v.set(U.rand(-0.6, 0.6), U.rand(-0.3, 0.9), U.rand(-0.6, 0.6));
    p.userData.spin.set(0, 0, 0);
    p.userData.grav = 0;
    p.userData.life = p.userData.max = life;
    p.userData.size = size;
    p.scale.set(size, size, size);
    p.visible = true;
  },

  ring(pos, color, from, to, life = 0.4) {
    const r = this.rings[this.ringIdx = (this.ringIdx + 1) % this.MAX_RINGS];
    GFX.setCol(r.material.color, color);
    r.material.color.multiplyScalar(1.25);         // let the bloom catch it
    r.material.opacity = 0.95;
    r.position.set(pos.x, World.heightAt(pos.x, pos.z), pos.z);
    r.scale.set(1, 1, 1);
    const d = r.userData;
    d.life = d.max = life;
    d.from = from; d.to = to;
    d.cx = pos.x; d.cz = pos.z;
    GFX.conform(r, d.cx, d.cz, from, 0.14);
    r.visible = true;
  },

  _setBlend(mat, additive) {
    if (additive) {
      mat.blending = THREE.AdditiveBlending;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.opacity = 1;
    } else {
      mat.blending = THREE.NormalBlending;
      mat.transparent = false;
      mat.depthWrite = true;
      mat.opacity = 1;
    }
  },

  kick(amount) { this.shake = Math.min(1.6, this.shake + amount); },

  update(dt) {
    for (const s of this.numbers) {
      if (!s.visible) continue;
      const d = s.userData;
      d.life -= dt;
      if (d.life <= 0) { s.visible = false; continue; }
      d.vy -= 11 * dt;
      s.position.x += d.vx * dt;
      s.position.y += d.vy * dt;
      s.position.z += d.vz * dt;
      const t = d.life / d.max;
      s.material.opacity = U.clamp(t * 1.8, 0, 1);
      const pop = 1 + (1 - t) * 0.25;
      s.scale.set(d.baseScale * pop, d.baseScale * 0.5 * pop, 1);
    }

    for (const p of this.parts) {
      if (!p.visible) continue;
      const d = p.userData;
      d.life -= dt;
      if (d.life <= 0) { p.visible = false; continue; }
      d.v.y += d.grav * dt;
      p.position.addScaledVector(d.v, dt);
      const ground = World.heightAt(p.position.x, p.position.z);
      if (p.position.y < ground + 0.1) {
        p.position.y = ground + 0.1;
        d.v.y = Math.abs(d.v.y) * 0.34;
        d.v.x *= 0.6; d.v.z *= 0.6;
      }
      p.rotation.x += d.spin.x * dt;
      p.rotation.y += d.spin.y * dt;
      p.rotation.z += d.spin.z * dt;
      const t = d.life / d.max;
      const s = d.size * U.clamp(t * 1.5, 0.05, 1);
      p.scale.set(s, s, s);
      if (p.material.transparent) p.material.opacity = U.clamp(t * 1.4, 0, 1);
    }

    for (const r of this.rings) {
      if (!r.visible) continue;
      const d = r.userData;
      d.life -= dt;
      if (d.life <= 0) { r.visible = false; continue; }
      const t = 1 - d.life / d.max;
      const s = U.lerp(d.from, d.to, t * (2 - t));   // ease-out
      GFX.conform(r, d.cx, d.cz, s, 0.14);
      r.material.opacity = 0.95 * (1 - t);
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - this.shakeDecay * dt);
    }
  },

  applyShake(camera) {
    if (this.shake <= 0) return;
    const m = this.shake * this.shake * 0.6;
    camera.position.x += U.rand(-m, m);
    camera.position.y += U.rand(-m, m);
    camera.position.z += U.rand(-m, m);
  }
};
