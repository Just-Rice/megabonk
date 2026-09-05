/* ============================================================
   MEGABONK — terrain, props, sky
   ============================================================ */
'use strict';

const World = {
  RADIUS: 105,          // playable radius; beyond this you get pushed back
  SIZE: 260,            // terrain plane size
  SEG: 130,             // terrain resolution

  group: null,
  terrain: null,
  props: [],
  _shard: null,

  // --- height field (must match the vertex displacement below) ---
  heightAt(x, z) {
    const h = U.fbm(x * 0.018, z * 0.018, 3) * 9.0
            + U.fbm(x * 0.06, z * 0.06, 2) * 1.6;
    // gently flatten the very middle so the spawn area is friendly
    const d = Math.sqrt(x * x + z * z);
    const flat = U.clamp((d - 8) / 22, 0, 1);
    return (h - 5.2) * (0.25 + 0.75 * flat);
  },

  build(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildSky(scene);
    this._buildTerrain();
    this._buildBorder();
    this._scatterProps();

    return this.group;
  },

  _buildSky(scene) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0.00, '#3a1d6e');
    grd.addColorStop(0.35, '#6a3fb5');
    grd.addColorStop(0.62, '#ff7a9c');
    grd.addColorStop(0.82, '#ffc46b');
    grd.addColorStop(1.00, '#ffe9b0');
    g.fillStyle = grd; g.fillRect(0, 0, 8, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.LinearFilter;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    sky.renderOrder = -1;
    scene.add(sky);
    this.sky = sky;

    // chunky low-poly clouds
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xfff2e0, fog: false });
    this.clouds = new THREE.Group();
    for (let i = 0; i < 22; i++) {
      const puff = new THREE.Group();
      const n = U.randInt(3, 5);
      for (let j = 0; j < n; j++) {
        const s = U.rand(6, 14);
        const b = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.55, s * 0.8), cloudMat);
        b.position.set(U.rand(-10, 10), U.rand(-2, 2), U.rand(-6, 6));
        puff.add(b);
      }
      const a = Math.random() * U.TAU, r = U.rand(90, 250);
      puff.position.set(Math.cos(a) * r, U.rand(55, 95), Math.sin(a) * r);
      puff.userData.spin = U.rand(0.002, 0.008) * (Math.random() < 0.5 ? -1 : 1);
      this.clouds.add(puff);
    }
    scene.add(this.clouds);
  },

  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(this.SIZE, this.SIZE, this.SEG, this.SEG);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x2f7d4f);   // grass
    const cMid = new THREE.Color(0x4fb36b);   // bright grass
    const cHigh = new THREE.Color(0x9b8f6a);  // rocky top
    const cDeep = new THREE.Color(0x1d5c53);  // shaded dip
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      const t = U.clamp((y + 4) / 9, 0, 1);
      if (t < 0.35) tmp.copy(cDeep).lerp(cLow, t / 0.35);
      else if (t < 0.72) tmp.copy(cLow).lerp(cMid, (t - 0.35) / 0.37);
      else tmp.copy(cMid).lerp(cHigh, (t - 0.72) / 0.28);
      // subtle per-vertex mottling so flat shading reads as hand-painted
      const j = 0.94 + U.hash2(Math.round(x * 3), Math.round(z * 3)) * 0.12;
      colors[i * 3] = tmp.r * j; colors[i * 3 + 1] = tmp.g * j; colors[i * 3 + 2] = tmp.b * j;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);
  },

  _buildBorder() {
    // ring of jagged cliffs marking the arena edge
    const mat = new THREE.MeshLambertMaterial({ color: 0x3b3350, flatShading: true });
    const count = 150;
    const geo = new THREE.ConeGeometry(7, 20, 5);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * U.TAU + U.rand(-0.02, 0.02);
      const r = this.RADIUS + U.rand(3, 12);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      p.set(x, this.heightAt(x, z) + U.rand(2, 7), z);
      e.set(U.rand(-0.15, 0.15), Math.random() * U.TAU, U.rand(-0.15, 0.15));
      q.setFromEuler(e);
      const sc = U.rand(0.8, 2.2);
      s.set(sc, sc * U.rand(1.0, 2.0), sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  },

  _addInstanced(geo, mat, placements, cast = true) {
    if (!placements.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), s = new THREE.Vector3();
    placements.forEach((t, i) => {
      p.set(t.x, t.y, t.z);
      e.set(t.rx || 0, t.ry || 0, t.rz || 0);
      q.setFromEuler(e);
      s.set(t.s, t.sy || t.s, t.s);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  },

  _scatterProps() {
    const trunks = [], leaves1 = [], leaves2 = [], rocks = [], shrooms = [], caps = [], grass = [], crystals = [];

    for (let i = 0; i < 900; i++) {
      const a = Math.random() * U.TAU;
      const r = Math.sqrt(Math.random()) * (this.RADIUS - 3);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x * x + z * z < 64) continue;              // keep spawn clear
      const y = this.heightAt(x, z);
      const ry = Math.random() * U.TAU;
      const roll = Math.random();

      if (roll < 0.20) {
        const s = U.rand(0.7, 1.5);
        trunks.push({ x, y: y + 2 * s, z, s: s * 0.55, sy: s * 2.4, ry });
        const list = Math.random() < 0.5 ? leaves1 : leaves2;
        list.push({ x, y: y + 5.4 * s, z, s: s * 2.5, sy: s * 3.6, ry });
      } else if (roll < 0.32) {
        rocks.push({ x, y: y + U.rand(0.1, 0.7), z, s: U.rand(0.6, 2.1), ry, rx: U.rand(0, 1), rz: U.rand(0, 1) });
      } else if (roll < 0.40) {
        const s = U.rand(0.5, 1.2);
        shrooms.push({ x, y: y + 0.6 * s, z, s: s * 0.45, sy: s * 1.2, ry });
        caps.push({ x, y: y + 1.35 * s, z, s: s * 1.25, sy: s * 0.8, ry });
      } else if (roll < 0.46) {
        crystals.push({ x, y: y + U.rand(0.6, 1.4), z, s: U.rand(0.35, 0.8), sy: U.rand(1.4, 3.2), ry, rx: U.rand(-0.2, 0.2) });
      } else {
        grass.push({ x, y: y + 0.35, z, s: U.rand(0.3, 0.7), sy: U.rand(0.8, 1.6), ry });
      }
    }

    const lam = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c, flatShading: true }, o || {}));

    this._addInstanced(new THREE.CylinderGeometry(1, 1.25, 1, 6), lam(0x6b4a2f), trunks);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 7), lam(0x2f8f4e), leaves1);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 7), lam(0x1f6f5e), leaves2);
    this._addInstanced(new THREE.DodecahedronGeometry(1, 0), lam(0x7c778f), rocks);
    this._addInstanced(new THREE.CylinderGeometry(1, 1, 1, 6), lam(0xf3e6d0), shrooms);
    this._addInstanced(new THREE.SphereGeometry(1, 8, 5, 0, U.TAU, 0, Math.PI / 2), lam(0xe0417a), caps);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 5), lam(0x63e0ff, { emissive: 0x1d5f7a }), crystals);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 4), lam(0x63c95f), grass, false);
  },

  // clamp a position inside the arena; returns true if it was clamped
  confine(v, pad = 0) {
    const lim = this.RADIUS - pad;
    const d2 = v.x * v.x + v.z * v.z;
    if (d2 > lim * lim) {
      const d = Math.sqrt(d2) || 1;
      v.x = (v.x / d) * lim;
      v.z = (v.z / d) * lim;
      return true;
    }
    return false;
  },

  // random point on a circle around `center`, kept inside the arena
  ringPoint(center, minR, maxR, out) {
    out = out || new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * U.TAU;
      const r = U.rand(minR, maxR);
      out.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
      if (out.x * out.x + out.z * out.z < (this.RADIUS - 6) * (this.RADIUS - 6)) break;
    }
    this.confine(out, 6);
    out.y = this.heightAt(out.x, out.z);
    return out;
  },

  update(dt) {
    if (this.clouds) {
      for (const c of this.clouds.children) c.rotation.y += c.userData.spin * dt * 60;
    }
  }
};
