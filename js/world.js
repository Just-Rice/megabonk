/* ============================================================
   MEGABONK — terrain, water, sky, scenery
   ============================================================ */
'use strict';

const World = {
  RADIUS: 105,
  SIZE: 300,
  SEG: 170,
  WATER: -3.4,

  LAKE: { x: -48, z: 40, r: 31 },
  HILL: { x: 52, z: -46, r: 34, h: 13 },

  group: null,
  terrain: null,
  water: null,
  sky: null,
  clouds: null,
  motes: null,
  _elapsed: 0,

  // ---- height field ---------------------------------------------------
  // Single source of truth: the rendered mesh, everything that stands on the
  // ground, and every ground decal all sample this one function.
  heightAt(x, z) {
    const b = U.fbm(x * 0.0155, z * 0.0155, 4);
    const d = U.fbm(x * 0.068, z * 0.068, 2);
    let h = (b - 0.5) * 21 + (d - 0.5) * 2.8;

    const hd = Math.hypot(x - this.HILL.x, z - this.HILL.z) / this.HILL.r;
    if (hd < 1) { const t = 1 - hd; h += t * t * (3 - 2 * t) * this.HILL.h; }

    const ld = Math.hypot(x - this.LAKE.x, z - this.LAKE.z) / this.LAKE.r;
    if (ld < 1) {
      const t = 1 - ld, s = t * t * (3 - 2 * t);
      h = U.lerp(h, this.WATER - 1.55 + (d - 0.5) * 1.1, s);
    }

    const cd = Math.hypot(x, z);
    const flat = U.clamp((cd - 10) / 24, 0, 1);
    return h * (0.28 + 0.72 * flat);
  },

  // NOTE: returns a shared scratch vector unless `out` is supplied — copy it
  // if you need to keep it. This runs once per enemy per frame, so allocating
  // here would hand the GC a few hundred vectors every frame.
  _nrm: new THREE.Vector3(),
  normalAt(x, z, e, out) {
    e = e || 0.7;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return (out || this._nrm).set(-hx, 2 * e, -hz).normalize();
  },

  slopeAt(x, z) { return 1 - this.normalAt(x, z, 0.7, this._slopeN).y; },
  _slopeN: new THREE.Vector3(),
  underwater(x, z) { return this.heightAt(x, z) < this.WATER && this.lakeAt(x, z) < 1.1; },

  // 0 at the middle of the lake, 1 at its rim, >1 outside it. Shoreline
  // shading and reeds key off this instead of raw height, otherwise every
  // low-lying dip on the map turns into a beach.
  lakeAt(x, z) {
    return Math.hypot(x - this.LAKE.x, z - this.LAKE.z) / this.LAKE.r;
  },

  build(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildSky(scene);
    this._buildTerrain();
    if (GFX.q.water) this._buildWater();
    this._buildMountains();
    this._buildBorder();
    this._scatterProps();
    this._buildMotes();

    return this.group;
  },

  // ---- sky ------------------------------------------------------------
  _buildSky(scene) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 512;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0.00, '#150c33');
    grd.addColorStop(0.20, '#39216e');
    grd.addColorStop(0.42, '#8244a4');
    grd.addColorStop(0.60, '#e0637f');
    grd.addColorStop(0.75, '#ff9a5c');
    grd.addColorStop(0.88, '#ffcf8a');
    grd.addColorStop(1.00, '#ffe9c4');
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 512);

    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(560, 32, 20),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    scene.add(sky);
    this.sky = sky;

    // sun disc, deliberately far above 1.0 so the bloom pass blows it out
    const sunPos = new THREE.Vector3(320, 168, 200);
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(24, 32),
      new THREE.MeshBasicMaterial({
        color: GFX.col(0xfff2cc).multiplyScalar(4.2),
        fog: false, depthWrite: false, transparent: true
      })
    );
    sun.position.copy(sunPos);
    sun.lookAt(0, 40, 0);
    sun.renderOrder = -99;
    scene.add(sun);

    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(78, 32),
      new THREE.MeshBasicMaterial({
        color: GFX.col(0xff9a5c), fog: false, depthWrite: false,
        transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending
      })
    );
    halo.position.copy(sunPos);
    halo.lookAt(0, 40, 0);
    halo.renderOrder = -98;
    scene.add(halo);

    const cloudMat = GFX.lambert(0xffe0cc, { emissive: 0x502f52, fog: false });
    this.clouds = new THREE.Group();
    const n = Math.round(22 * GFX.q.propDensity) + 8;
    for (let i = 0; i < n; i++) {
      const puff = new THREE.Group();
      for (let j = 0, m = U.randInt(3, 6); j < m; j++) {
        const s = U.rand(7, 17);
        const b = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.5, s * 0.8), cloudMat);
        b.position.set(U.rand(-12, 12), U.rand(-2, 2), U.rand(-7, 7));
        puff.add(b);
      }
      const a = Math.random() * U.TAU, r = U.rand(120, 320);
      puff.position.set(Math.cos(a) * r, U.rand(60, 115), Math.sin(a) * r);
      puff.userData.spin = U.rand(0.0015, 0.006) * (Math.random() < 0.5 ? -1 : 1);
      this.clouds.add(puff);
    }
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
  },

  // ---- terrain --------------------------------------------------------
  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(this.SIZE, this.SIZE, this.SEG, this.SEG);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const cDeep  = GFX.col(0x1f5f56);   // lake bed
    const cSand  = GFX.col(0xc9b077);   // shoreline
    const cGrass = GFX.col(0x4aa84f);   // main sward
    const cLush  = GFX.col(0x7ede63);   // sunlit tops
    const cMoss  = GFX.col(0x2f7c56);   // damp hollows
    const cDry   = GFX.col(0xb7c257);   // dry patches
    const cRock  = GFX.col(0x7a7391);
    const cPeak  = GFX.col(0xd2ccdd);
    const tmp = new THREE.Color(), rock = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      const slope = this.slopeAt(x, z);
      const lake = this.lakeAt(x, z);
      const depth = this.WATER - y;

      if (lake < 1.12 && depth > 0.3) {
        // under the lake surface
        tmp.copy(cDeep).lerp(cSand, U.clamp(1 - depth / 2.0, 0, 1));
      } else if (lake < 1.25 && y < this.WATER + 1.6) {
        // the beach ring, and only around the actual lake
        const t = U.clamp((y - this.WATER + 0.3) / 1.9, 0, 1);
        tmp.copy(cSand).lerp(cGrass, t * t);
      } else {
        // broad, slow colour drift so the grass never reads as one flat sheet
        const patch = U.fbm(x * 0.012, z * 0.012, 2) * 0.6 + U.fbm(x * 0.055, z * 0.055, 2) * 0.4;
        const damp = U.fbm(x * 0.03 + 40, z * 0.03 - 25, 2) * 0.6 + U.fbm(x * 0.09 - 12, z * 0.09 + 7, 2) * 0.4;
        tmp.copy(cGrass);
        tmp.lerp(cDry, U.clamp((patch - 0.5) * 3.2, 0, 1) * 0.8);
        tmp.lerp(cMoss, U.clamp((0.48 - damp) * 3.0, 0, 1) * 0.7);
        tmp.lerp(cLush, U.clamp((y + 1) / 16, 0, 1) * 0.5);
        if (y > 9) tmp.lerp(cPeak, U.clamp((y - 9) / 8, 0, 1) * 0.5);
      }

      // steep ground shows rock through the grass
      const rockAmt = U.clamp((slope - 0.18) / 0.4, 0, 1);
      if (rockAmt > 0) {
        rock.copy(cRock).lerp(cPeak, U.clamp((y - 2) / 14, 0, 1) * 0.55);
        tmp.lerp(rock, rockAmt * 0.9);
      }

      // hand-painted mottling so the flat shading reads as texture
      const j = 0.86 + U.hash2(Math.round(x * 2.2), Math.round(z * 2.2)) * 0.28;
      colors[i * 3] = tmp.r * j;
      colors[i * 3 + 1] = tmp.g * j;
      colors[i * 3 + 2] = tmp.b * j;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.terrain = new THREE.Mesh(geo, GFX.lambert(0xffffff, { vertexColors: true }));
    this.terrain.receiveShadow = GFX.q.shadows;
    this.group.add(this.terrain);
  },

  // ---- water ----------------------------------------------------------
  _buildWater() {
    const L = this.LAKE, span = L.r * 2.5, seg = 72;
    const geo = new THREE.PlaneGeometry(span, span, seg, seg);
    geo.rotateX(-Math.PI / 2);

    // bake how deep the lake is under each vertex so the shader can fade the
    // surface out at the shoreline and draw foam on the shallows
    const pos = geo.attributes.position;
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + L.x, z = pos.getZ(i) + L.z;
      depth[i] = this.WATER - this.heightAt(x, z);
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: Object.assign({
        uTime: { value: 0 },
        uShallow: { value: GFX.col(0x5fd6c8) },
        uDeep: { value: GFX.col(0x123c55) },
        uFoam: { value: GFX.col(0xdffaff) },
        uSunDir: { value: new THREE.Vector3(0.72, 0.42, 0.45).normalize() }
      }, THREE.UniformsLib.fog),
      vertexShader: `
        attribute float aDepth;
        uniform float uTime;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNrm;
        #include <fog_pars_vertex>
        void main() {
          vDepth = aDepth;
          vec3 p = position;
          float w1 = sin(p.x * 0.28 + uTime * 1.25) * 0.16;
          float w2 = sin(p.z * 0.21 - uTime * 0.95) * 0.14;
          float w3 = sin((p.x + p.z) * 0.13 + uTime * 0.6) * 0.10;
          p.y += w1 + w2 + w3;
          // analytic normal from the same three waves
          float dx = cos(p.x * 0.28 + uTime * 1.25) * 0.28 * 0.16
                   + cos((p.x + p.z) * 0.13 + uTime * 0.6) * 0.13 * 0.10;
          float dz = cos(p.z * 0.21 - uTime * 0.95) * 0.21 * 0.14
                   + cos((p.x + p.z) * 0.13 + uTime * 0.6) * 0.13 * 0.10;
          vNrm = normalize(vec3(-dx, 1.0, -dz));
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 uShallow, uDeep, uFoam, uSunDir;
        uniform float uTime;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNrm;
        #include <fog_pars_fragment>
        void main() {
          if (vDepth <= 0.02) discard;
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vNrm);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

          vec3 col = mix(uShallow, uDeep, clamp(vDepth / 3.2, 0.0, 1.0));
          col = mix(col, vec3(0.75, 0.55, 0.85), fres * 0.55);

          // sun glint — pushed past 1.0 on purpose so bloom catches it
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 90.0);
          col += vec3(2.6, 2.2, 1.7) * spec;

          float shore = 1.0 - smoothstep(0.06, 0.55, vDepth);
          float ripple = 0.5 + 0.5 * sin(vWorld.x * 1.7 + vWorld.z * 1.3 - uTime * 2.4);
          col = mix(col, uFoam, shore * (0.35 + 0.5 * ripple));

          float alpha = smoothstep(0.02, 0.42, vDepth) * 0.9;
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`
    });

    this.water = new THREE.Mesh(geo, mat);
    this.water.position.set(L.x, this.WATER, L.z);
    this.water.renderOrder = 2;
    this.group.add(this.water);
  },

  // ---- distant silhouette ---------------------------------------------
  _buildMountains() {
    const mat = GFX.lambert(0x4a3a68, { emissive: 0x1d1330 });
    const count = 46;
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * U.TAU + U.rand(-0.05, 0.05);
      const r = U.rand(210, 330);
      const w = U.rand(26, 62), h = U.rand(48, 130);
      p.set(Math.cos(a) * r, h * 0.35, Math.sin(a) * r);
      e.set(0, Math.random() * U.TAU, 0);
      q.setFromEuler(e);
      s.set(w, h, w);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  },

  _buildBorder() {
    const mat = GFX.lambert(0x453a5e);
    const count = 170;
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(7, 20, 5), mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * U.TAU + U.rand(-0.02, 0.02);
      const r = this.RADIUS + U.rand(3, 14);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      p.set(x, this.heightAt(x, z) + U.rand(2, 8), z);
      e.set(U.rand(-0.14, 0.14), Math.random() * U.TAU, U.rand(-0.14, 0.14));
      q.setFromEuler(e);
      const sc = U.rand(0.8, 2.3);
      s.set(sc, sc * U.rand(1.0, 2.1), sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = GFX.q.shadows;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  },

  _addInstanced(geo, mat, placements, opts) {
    if (!placements.length) return null;
    opts = opts || {};
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
    // r128 builds an InstancedMesh bounding sphere from the base geometry at
    // the group origin, so instances get culled unless we opt out
    mesh.frustumCulled = false;
    mesh.castShadow = GFX.q.shadows && opts.cast !== false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    return mesh;
  },

  // ---- scenery --------------------------------------------------------
  _scatterProps() {
    const trunks = [], canopyA = [], canopyB = [], canopyC = [];
    const rocks = [], stems = [], caps = [], grass = [], flowers = [];
    const crystals = [], reeds = [], logs = [];

    const total = Math.round(1500 * GFX.q.propDensity);
    for (let i = 0; i < total; i++) {
      const a = Math.random() * U.TAU;
      const r = Math.sqrt(Math.random()) * (this.RADIUS - 3);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x * x + z * z < 70) continue;             // keep the spawn pad clear

      const y = this.heightAt(x, z);
      const ry = Math.random() * U.TAU;
      const slope = this.slopeAt(x, z);
      const lake = this.lakeAt(x, z);
      const depth = this.WATER - y;
      const shore = lake < 1.3;

      // reeds cluster along the actual waterline; nothing grows in open water
      if (shore) {
        if (depth > 0.9) continue;
        if (depth > -1.1 && Math.random() < 0.55) {
          reeds.push({ x, y: y + 0.8, z, s: U.rand(0.09, 0.17), sy: U.rand(1.3, 2.5), ry });
          continue;
        }
      }

      const roll = Math.random();
      const steep = slope > 0.3;

      if (!steep && roll < 0.17) {
        // layered conifer
        const s = U.rand(0.75, 1.7);
        trunks.push({ x, y: y + 2.1 * s, z, s: s * 0.5, sy: s * 2.6, ry });
        canopyA.push({ x, y: y + 4.5 * s, z, s: s * 2.5, sy: s * 2.6, ry });
        canopyB.push({ x, y: y + 6.1 * s, z, s: s * 1.85, sy: s * 2.3, ry });
        if (Math.random() < 0.6) canopyC.push({ x, y: y + 7.5 * s, z, s: s * 1.2, sy: s * 1.9, ry });
      } else if (roll < 0.30) {
        rocks.push({ x, y: y + U.rand(0.05, 0.7), z, s: U.rand(0.55, 2.3), ry, rx: U.rand(0, 1), rz: U.rand(0, 1) });
      } else if (!steep && roll < 0.38) {
        const s = U.rand(0.5, 1.25);
        stems.push({ x, y: y + 0.6 * s, z, s: s * 0.42, sy: s * 1.25, ry });
        caps.push({ x, y: y + 1.4 * s, z, s: s * 1.3, sy: s * 0.85, ry });
      } else if (roll < 0.44) {
        crystals.push({ x, y: y + U.rand(0.5, 1.5), z, s: U.rand(0.3, 0.8), sy: U.rand(1.5, 3.6), ry, rx: U.rand(-0.18, 0.18) });
      } else if (roll < 0.47) {
        logs.push({ x, y: y + 0.35, z, s: U.rand(0.3, 0.5), sy: U.rand(2.2, 4.5), ry, rz: Math.PI / 2 });
      } else if (roll < 0.60) {
        flowers.push({ x, y: y + 0.45, z, s: U.rand(0.12, 0.24), sy: U.rand(0.7, 1.3), ry });
      } else {
        grass.push({ x, y: y + 0.35, z, s: U.rand(0.28, 0.7), sy: U.rand(0.9, 1.9), ry });
      }
    }

    const trunkMat = GFX.lambert(0x6b4526);
    const leafA = GFX.wind(GFX.lambert(0x2c7a45), 0.055);
    const leafB = GFX.wind(GFX.lambert(0x1f6b58), 0.055);
    const leafC = GFX.wind(GFX.lambert(0x49a86b), 0.055);
    const rockMat = GFX.lambert(0x7d7791);
    const stemMat = GFX.lambert(0xf2e4cc);
    const capMat = GFX.lambert(0xe0417a, { emissive: 0x3a0a1c });
    const crystalMat = GFX.lambert(0x63e0ff, { emissive: 0x2a86b0 });
    const logMat = GFX.lambert(0x5c3a20);
    const grassMat = GFX.wind(GFX.lambert(0x5fbe57), 0.16, 2.1);
    const reedMat = GFX.wind(GFX.lambert(0x8fae4a), 0.2, 1.7);
    const flowerMats = [
      GFX.wind(GFX.lambert(0xffd23d, { emissive: 0x4a3200 }), 0.2, 2.3),
      GFX.wind(GFX.lambert(0xff6bb0, { emissive: 0x4a0a2a }), 0.2, 2.3),
      GFX.wind(GFX.lambert(0xa77bff, { emissive: 0x2a0a4a }), 0.2, 2.3)
    ];

    this._addInstanced(new THREE.CylinderGeometry(1, 1.3, 1, 6), trunkMat, trunks);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 7), leafA, canopyA);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 7), leafB, canopyB);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 6), leafC, canopyC);
    this._addInstanced(new THREE.DodecahedronGeometry(1, 0), rockMat, rocks);
    this._addInstanced(new THREE.CylinderGeometry(1, 1, 1, 6), stemMat, stems);
    this._addInstanced(new THREE.SphereGeometry(1, 9, 5, 0, U.TAU, 0, Math.PI / 2), capMat, caps);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 5), crystalMat, crystals);
    this._addInstanced(new THREE.CylinderGeometry(1, 1, 1, 6), logMat, logs);
    this._addInstanced(new THREE.ConeGeometry(1, 1, 4), grassMat, grass, { cast: false });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 4), reedMat, reeds, { cast: false });

    // flowers get split across three colours
    const buckets = [[], [], []];
    flowers.forEach((f, i) => buckets[i % 3].push(f));
    const petal = new THREE.IcosahedronGeometry(1, 0);
    buckets.forEach((b, i) => this._addInstanced(petal, flowerMats[i], b, { cast: false }));
  },

  // ---- drifting motes -------------------------------------------------
  // Additive points that the bloom pass turns into fireflies.
  _buildMotes() {
    const count = Math.round(420 * GFX.q.propDensity);
    if (count < 20) return;
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    const warm = GFX.col(0xffd88a), cool = GFX.col(0x8ae5ff);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * U.TAU;
      const r = Math.sqrt(Math.random()) * (this.RADIUS - 6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos[i * 3] = x;
      pos[i * 3 + 1] = this.heightAt(x, z) + U.rand(0.8, 9);
      pos[i * 3 + 2] = z;
      phase[i] = Math.random() * 100;
      c.copy(Math.random() < 0.6 ? warm : cool);
      tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.RADIUS + 20);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSize: { value: 46 } },
      vertexShader: `
        attribute float aPhase;
        attribute vec3 aTint;
        uniform float uTime;
        uniform float uSize;
        varying vec3 vTint;
        varying float vFade;
        void main() {
          vTint = aTint;
          vec3 p = position;
          p.y += sin(uTime * 0.8 + aPhase) * 1.1;
          p.x += sin(uTime * 0.45 + aPhase * 1.7) * 0.9;
          p.z += cos(uTime * 0.4 + aPhase * 1.3) * 0.9;
          vFade = 0.45 + 0.55 * sin(uTime * 1.6 + aPhase * 3.1);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vTint;
        varying float vFade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          float a = smoothstep(0.25, 0.0, r);
          gl_FragColor = vec4(vTint * (1.6 * vFade), a * vFade);
        }`
    });

    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  },

  confine(v, pad) {
    pad = pad || 0;
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
    this._elapsed += dt;
    if (this.clouds) {
      for (const c of this.clouds.children) c.rotation.y += c.userData.spin * dt * 60;
    }
    if (this.water) this.water.material.uniforms.uTime.value = this._elapsed;
    if (this.motes) this.motes.material.uniforms.uTime.value = this._elapsed;
    GFX.updateWind(this._elapsed);
  }
};
