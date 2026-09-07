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
  SUN_POS: new THREE.Vector3(320, 88, 200),   // low, in the sunset band, so shafts reach the frame
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
      h = U.lerp(h, this.WATER - 3.7 + (d - 0.5) * 1.6, s);
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

  // How deep the water is over a point, 0 on dry land. Everything that swims
  // or wades reads this.
  waterDepthAt(x, z) {
    if (this.lakeAt(x, z) > 1.25) return 0;
    const d = this.WATER - this.heightAt(x, z);
    return d > 0 ? d : 0;
  },

  // 0 = walking, 1 = fully swimming. Blended so the shoreline transition is
  // smooth instead of a step at the waterline.
  swimFactor(x, z) {
    return U.clamp((this.waterDepthAt(x, z) - 0.55) / 0.95, 0, 1);
  },

  // The height a swimmer's feet sit at. Includes the live wave height (damped
  // toward the shore exactly as the shader damps it) so bodies rise and fall
  // with the surface they are floating on.
  floatY(ground, t, x, z) {
    if (t <= 0) return ground;
    let surface = this.WATER - 1.35;
    if (x !== undefined) {
      const u = U.clamp(this.waterDepthAt(x, z) / 1.4, 0, 1);
      surface += this.waveAt(x, z) * (u * u * (3 - 2 * u));   // shader uses smoothstep
    }
    return U.lerp(ground, Math.max(ground, surface), t);
  },
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
    grd.addColorStop(0.00, '#0f1830');
    grd.addColorStop(0.22, '#22304f');
    grd.addColorStop(0.44, '#4c6285');
    grd.addColorStop(0.60, '#8b9cb2');
    grd.addColorStop(0.72, '#c9a988');
    grd.addColorStop(0.84, '#d9a172');
    grd.addColorStop(1.00, '#8d7358');
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
    const sunPos = this.SUN_POS;
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(30, 40),
      new THREE.MeshBasicMaterial({
        color: GFX.col(0xffeccc).multiplyScalar(2.6),
        fog: false, depthWrite: false, transparent: true
      })
    );
    sun.position.copy(sunPos);
    sun.lookAt(0, 40, 0);
    sun.renderOrder = -99;
    scene.add(sun);

    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(96, 40),
      new THREE.MeshBasicMaterial({
        color: GFX.col(0xd8a878), fog: false, depthWrite: false,
        transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending
      })
    );
    halo.position.copy(sunPos);
    halo.lookAt(0, 40, 0);
    halo.renderOrder = -98;
    scene.add(halo);

    const cloudMat = GFX.mat(0xb9bfc9, { emissive: 0x2a2f3d, fog: false, roughness: 1 });
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
      const a = Math.random() * U.TAU, r = U.rand(210, 400);
      puff.position.set(Math.cos(a) * r, U.rand(85, 150), Math.sin(a) * r);
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

    const cDeep  = GFX.col(0x3d4136);   // silty lake bed
    const cSand  = GFX.col(0xa89772);   // shoreline
    const cGrass = GFX.col(0x5f7439);   // main sward
    const cLush  = GFX.col(0x7d9048);   // sunlit tops
    const cMoss  = GFX.col(0x415436);   // damp hollows
    const cDry   = GFX.col(0x8a8455);   // dry patches
    const cRock  = GFX.col(0x6b6660);
    const cPeak  = GFX.col(0x8e8880);
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

    // smooth-shaded and textured: the vertex colours carry the biome and the
    // baked AO, the noise map and its normals carry the surface itself
    this.terrain = new THREE.Mesh(geo, GFX.standard(0xffffff, {
      vertexColors: true, flatShading: false, roughness: 0.97, metalness: 0,
      surface: 'ground', surfaceOpts: { size: 256, scale: 7, octaves: 5, contrast: 1.25,
                                        color: 0xffffff, dark: 0xb8b8b8, tintAmount: 0.5, bump: 3.2 },
      repeat: 42, bumpScale: 1.15
    }));
    this.terrain.receiveShadow = GFX.q.shadows;
    this.group.add(this.terrain);
  },

  // ---- water ----------------------------------------------------------
  // One wave definition, used twice: the shader displaces the surface with it
  // and JavaScript evaluates the same sum so swimmers ride the real waves
  // instead of a flat plane pretending to be water.
  WAVES: [
    { kx: 0.300, kz: 0.120, sp: 1.05, am: 0.26 },   // ~19m swell
    { kx: -0.160, kz: 0.340, sp: -0.90, am: 0.18 },  // ~17m crossing it
    { kx: 0.520, kz: 0.450, sp: 1.55, am: 0.085 },   // ~9m chop
    { kx: 0.950, kz: -0.780, sp: -2.30, am: 0.04 }   // ~5m ripple
  ],

  // world Y of the water surface at a point (only meaningful over the lake)
  surfaceY(x, z) {
    const u = U.clamp(this.waterDepthAt(x, z) / 1.4, 0, 1);
    return this.WATER + this.waveAt(x, z) * (u * u * (3 - 2 * u));
  },

  waveAt(x, z, t) {
    if (t === undefined) t = this._elapsed;
    let h = 0;
    for (let i = 0; i < this.WAVES.length; i++) {
      const w = this.WAVES[i];
      h += w.am * Math.sin(x * w.kx + z * w.kz + t * w.sp);
    }
    return h;
  },

  _waveGLSL() {
    // emit the identical sum into the shader so the two can never drift
    let disp = '', dx = '', dz = '';
    for (const w of this.WAVES) {
      const ph = `(p.x * ${w.kx.toFixed(4)} + p.y * ${w.kz.toFixed(4)} + t * ${w.sp.toFixed(4)})`;
      disp += `  h += ${w.am.toFixed(4)} * sin${ph};\n`;
      dx += `  d.x += ${(w.am * w.kx).toFixed(6)} * cos${ph};\n`;
      dz += `  d.y += ${(w.am * w.kz).toFixed(6)} * cos${ph};\n`;
    }
    return `
      float waveH(vec2 p, float t) {
        float h = 0.0;
${disp}        return h;
      }
      vec2 waveD(vec2 p, float t) {
        vec2 d = vec2(0.0);
${dx}${dz}        return d;
      }`;
  },

  _buildWater() {
    const L = this.LAKE, span = L.r * 2.6, seg = 128;
    const geo = new THREE.PlaneGeometry(span, span, seg, seg);
    geo.rotateX(-Math.PI / 2);

    // bake how deep the lake is under each vertex so the shader can fade the
    // surface out at the shoreline and draw foam on the shallows
    const pos = geo.attributes.position;
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      depth[i] = this.WATER - this.heightAt(pos.getX(i) + L.x, pos.getZ(i) + L.z);
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

    const ripple = GFX.surface('ripple', {
      size: 256, scale: 9, octaves: 4, contrast: 1.1,
      color: 0xffffff, dark: 0x999999, tintAmount: 0.5, bump: 2.2
    }).normalMap;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: Object.assign({
        uTime: { value: 0 },
        uRipple: { value: ripple },
        uShallow: { value: GFX.col(0x2a6b73) },
        uDeep: { value: GFX.col(0x08222e) },
        uFoam: { value: GFX.col(0xdfe8e6) },
        uSkyLow: { value: GFX.col(0xcdd8e4) },
        uSkyHigh: { value: GFX.col(0x6b88b8) },
        uSunDir: { value: new THREE.Vector3().copy(this.SUN_POS).normalize() }
      }, THREE.UniformsLib.fog),
      vertexShader: `
        attribute float aDepth;
        uniform float uTime;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying float vCrest;
        #include <fog_pars_vertex>
${this._waveGLSL()}
        void main() {
          vDepth = aDepth;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          // waves are evaluated in world space, which is what the CPU side does
          float h = waveH(wp.xz, uTime);
          // damp the swell to nothing at the shoreline so it cannot climb the beach
          float shoreDamp = smoothstep(0.0, 1.4, aDepth);
          h *= shoreDamp;
          wp.y += h;
          vCrest = h;
          vec2 d = waveD(wp.xz, uTime) * shoreDamp;
          vNrm = normalize(vec3(-d.x, 1.0, -d.y));
          vWorld = wp.xyz;
          // three's fog_vertex chunk expands to fogDepth = -mvPosition.z,
          // so the view-space position has to be named exactly that
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 uShallow, uDeep, uFoam, uSkyLow, uSkyHigh, uSunDir;
        uniform float uTime;
        uniform sampler2D uRipple;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNrm;
        varying float vCrest;
        #include <fog_pars_fragment>

        void main() {
          if (vDepth <= 0.02) discard;

          // two scrolling normal layers give fine ripple detail on top of the
          // big analytic swell
          vec2 uv1 = vWorld.xz * 0.085 + vec2(uTime * 0.016, uTime * 0.011);
          vec2 uv2 = vWorld.xz * 0.210 - vec2(uTime * 0.026, uTime * 0.033);
          vec2 uv3 = vWorld.xz * 0.480 + vec2(uTime * 0.041, -uTime * 0.037);
          vec3 r1 = texture2D(uRipple, uv1).xyz * 2.0 - 1.0;
          vec3 r2 = texture2D(uRipple, uv2).xyz * 2.0 - 1.0;
          vec3 r3 = texture2D(uRipple, uv3).xyz * 2.0 - 1.0;
          vec2 detail = r1.xy * 0.55 + r2.xy * 0.35 + r3.xy * 0.22;
          float choppy = smoothstep(0.20, 1.1, vDepth);
          vec3 N = normalize(vec3(vNrm.x + detail.x * 1.25 * choppy,
                                  vNrm.y,
                                  vNrm.z + detail.y * 1.25 * choppy));

          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
          fres = mix(0.03, 1.0, fres);

          // body colour by depth, then the sky mirrored in by Fresnel
          vec3 body = mix(uShallow, uDeep, clamp(vDepth / 3.0, 0.0, 1.0));
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSkyLow, uSkyHigh, smoothstep(0.0, 0.55, R.y));
          vec3 col = mix(body, sky, fres * 0.92);

          // sun glint, deliberately over 1.0 so the bloom pass catches it
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 90.0);
          col += vec3(3.8, 3.2, 2.4) * spec * (0.3 + 0.7 * choppy);

          // whitecaps on the crests, foam along the shore
          // whitecaps ride the crests, and a tight lapping line marks the shore
          // only genuine crests foam; the swell peaks near 0.5 so anything
          // lower than this turns the whole lake into rapids
          float caps = smoothstep(0.36, 0.56, vCrest) * choppy;
          float shore = 1.0 - smoothstep(0.02, 0.34, vDepth);
          float lap = 0.5 + 0.5 * sin(vWorld.x * 2.3 + vWorld.z * 1.9 - uTime * 2.6
                                      + detail.x * 3.0);
          col = mix(col, uFoam, clamp(caps * 0.34 + shore * (0.32 + 0.36 * lap), 0.0, 0.8));

          // shallows stay see-through, deep water turns opaque
          float alpha = smoothstep(0.0, 0.30, vDepth) * mix(0.62, 0.97, clamp(vDepth / 2.6, 0.0, 1.0));
          alpha = mix(alpha, 1.0, fres * 0.5);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
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
    const mat = GFX.mat(0x5b6273, { emissive: 0x161a26, roughness: 1 });
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
    const mat = GFX.mat(0x585f6e, { roughness: 1 });
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

    // Per-instance tint. instanceColor multiplies the material colour, so
    // these are variation factors around 1.0 — it stops a thousand copies of
    // the same mesh reading as a repeated stamp.
    if (opts.tint) {
      const t = opts.tint, c = new THREE.Color();
      for (let i = 0; i < placements.length; i++) {
        const v = U.rand(1 - t, 1 + t);
        c.setRGB(v * U.rand(0.94, 1.06), v, v * U.rand(0.94, 1.06));
        mesh.setColorAt(i, c);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

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
    const crystals = [], reeds = [], logs = [], bushes = [], ferns = [], pebbles = [];

    const total = Math.round(2600 * GFX.q.propDensity);
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
        // trunk blocks; the canopy above it does not, so shots still fly
        // through foliage rather than stopping dead in a cloud of leaves
        this.addCollider(x, z, 0.6 * s, 6.2 * s);
        // the foliage blocks the camera only
        this.addSoftCollider(x, z, 1.65 * s, y + 1.5 * s, y + 6.3 * s);
        // trunk: 2.6s tall, buried 0.1s, so centre sits at 1.2s
        trunks.push({ x, y: y + 1.2 * s, z, s: s * 0.5, sy: s * 2.6, ry });
        // each canopy tier overlaps the one below rather than hovering above it
        canopyA.push({ x, y: y + 2.9 * s, z, s: s * 2.5, sy: s * 2.8, ry });
        canopyB.push({ x, y: y + 4.2 * s, z, s: s * 1.85, sy: s * 2.4, ry });
        if (Math.random() < 0.6) canopyC.push({ x, y: y + 5.25 * s, z, s: s * 1.2, sy: s * 1.9, ry });
      } else if (roll < 0.30) {
        // lift has to scale with the boulder, otherwise small ones hover
        const s = U.rand(0.55, 2.3), lift = U.rand(0.3, 0.55) * s;
        this.addCollider(x, z, 0.82 * s, lift + 0.9 * s);
        rocks.push({ x, y: y + lift, z, s, ry, rx: U.rand(0, 1), rz: U.rand(0, 1) });
      } else if (!steep && roll < 0.38) {
        const s = U.rand(0.5, 1.25);
        stems.push({ x, y: y + 0.6 * s, z, s: s * 0.42, sy: s * 1.25, ry });
        caps.push({ x, y: y + 1.1 * s, z, s: s * 1.3, sy: s * 0.85, ry });   // seated on the stem
      } else if (roll < 0.44) {
        const s = U.rand(0.3, 0.8), sy = U.rand(1.5, 3.6);
        const lift = sy * 0.5 - U.rand(0.2, 0.5);      // base buried, not hovering
        this.addCollider(x, z, s * 0.9, lift + sy * 0.5);
        crystals.push({ x, y: y + lift, z, s, sy, ry, rx: U.rand(-0.18, 0.18) });
      } else if (roll < 0.505) {
        // leafy bush: a couple of blobs, solid enough to walk around
        const s = U.rand(0.55, 1.35);
        this.addCollider(x, z, s * 0.72, s * 1.1);
        bushes.push({ x, y: y + s * 0.55, z, s: s * 0.95, sy: s * 0.75, ry });
        bushes.push({ x: x + U.rand(-0.4, 0.4) * s, y: y + s * 0.95, z: z + U.rand(-0.4, 0.4) * s,
                      s: s * 0.65, sy: s * 0.55, ry: Math.random() * U.TAU });
      } else if (roll < 0.545) {
        const s = U.rand(0.4, 0.95);
        for (let k = 0; k < 4; k++) {
          ferns.push({ x: x + U.rand(-0.3, 0.3), y: y + s * 0.5, z: z + U.rand(-0.3, 0.3),
                       s: s * 0.22, sy: s * U.rand(1.0, 1.5), ry: Math.random() * U.TAU,
                       rx: U.rand(0.15, 0.45) });
        }
      } else if (roll < 0.585) {
        pebbles.push({ x, y: y + 0.1, z, s: U.rand(0.12, 0.34), ry, rx: U.rand(0, 1), rz: U.rand(0, 1) });
      } else if (roll < 0.615) {
        const s = U.rand(0.3, 0.5), sy = U.rand(2.2, 4.5);
        // a felled log is a capsule, so approximate it with three circles
        // strung along its axis rather than one fat circle
        const ax = -Math.cos(ry), az = Math.sin(ry);
        for (let k = -1; k <= 1; k++) {
          this.addCollider(x + ax * (sy * 0.33) * k, z + az * (sy * 0.33) * k, s * 1.15, s * 2.2);
        }
        logs.push({ x, y: y + s * 0.88, z, s, sy, ry, rz: Math.PI / 2 });   // resting on its side
      } else if (roll < 0.73) {
        flowers.push({ x, y: y + 0.45, z, s: U.rand(0.12, 0.24), sy: U.rand(0.7, 1.3), ry });
      } else {
        grass.push({ x, y: y + 0.35, z, s: U.rand(0.28, 0.7), sy: U.rand(0.9, 1.9), ry });
      }
    }

    const bark = { surface: 'bark', surfaceOpts: { size: 256, scale: 5, octaves: 4, contrast: 1.5,
                     streak: 0.85, color: 0xffffff, dark: 0x6a6a6a, tintAmount: 0.75, bump: 3.6 },
                   repeat: 3, bumpScale: 1.4 };
    const stone = { surface: 'stone', surfaceOpts: { size: 256, scale: 6, octaves: 5, contrast: 1.35,
                      color: 0xffffff, dark: 0x757575, tintAmount: 0.7, bump: 3.0 },
                    repeat: 1.6, bumpScale: 1.25 };

    const trunkMat = GFX.standard(0x4e3b2a, Object.assign({ roughness: 0.98, flatShading: false }, bark));
    const leafA = GFX.wind(GFX.standard(0x3f5230, { roughness: 0.95 }), 0.055);
    const leafB = GFX.wind(GFX.standard(0x35462b, { roughness: 0.95 }), 0.055);
    const leafC = GFX.wind(GFX.standard(0x4b5c34, { roughness: 0.95 }), 0.055);
    const rockMat = GFX.standard(0x6e6a63, Object.assign({ roughness: 0.95, flatShading: false }, stone));
    const stemMat = GFX.standard(0xd6cbb4, { roughness: 0.9 });
    const capMat = GFX.standard(0x9c4b3c, { roughness: 0.8 });
    const crystalMat = GFX.standard(0x7fa8b8, { emissive: 0x1d3d4a, roughness: 0.25, metalness: 0.15 });
    const logMat = GFX.standard(0x4a3826, Object.assign({ roughness: 0.98, flatShading: false }, bark));
    const grassMat = GFX.wind(GFX.standard(0x62703c, { roughness: 1 }), 0.16, 2.1);
    const reedMat = GFX.wind(GFX.standard(0x77794a, { roughness: 1 }), 0.2, 1.7);
    const flowerMats = [
      GFX.wind(GFX.standard(0xc9b24f, { roughness: 0.9 }), 0.2, 2.3),
      GFX.wind(GFX.standard(0xb06a7e, { roughness: 0.9 }), 0.2, 2.3),
      GFX.wind(GFX.standard(0x8a7fb0, { roughness: 0.9 }), 0.2, 2.3)
    ];

    const bushMat = GFX.wind(GFX.standard(0x3a4a2c, { roughness: 0.97 }), 0.05, 1.6);
    const fernMat = GFX.wind(GFX.standard(0x4a5c33, { roughness: 0.97 }), 0.13, 2.0);

    this._addInstanced(new THREE.CylinderGeometry(1, 1.3, 1, 8), trunkMat, trunks, { tint: 0.16 });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 8), leafA, canopyA, { tint: 0.15 });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 8), leafB, canopyB, { tint: 0.15 });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 7), leafC, canopyC, { tint: 0.15 });
    this._addInstanced(new THREE.DodecahedronGeometry(1, 1), rockMat, rocks, { tint: 0.18 });
    this._addInstanced(new THREE.CylinderGeometry(1, 1, 1, 7), stemMat, stems, { tint: 0.1 });
    this._addInstanced(new THREE.SphereGeometry(1, 11, 6, 0, U.TAU, 0, Math.PI / 2), capMat, caps, { tint: 0.14 });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 5), crystalMat, crystals, { tint: 0.2 });
    this._addInstanced(new THREE.CylinderGeometry(1, 1, 1, 7), logMat, logs, { tint: 0.14 });
    this._addInstanced(new THREE.IcosahedronGeometry(1, 0), bushMat, bushes, { tint: 0.18 });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 4), fernMat, ferns, { cast: false, tint: 0.2 });
    this._addInstanced(new THREE.DodecahedronGeometry(1, 0), rockMat, pebbles, { cast: false, tint: 0.22 });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 4), grassMat, grass, { cast: false, tint: 0.22 });
    this._addInstanced(new THREE.ConeGeometry(1, 1, 4), reedMat, reeds, { cast: false, tint: 0.2 });

    // flowers get split across three colours
    const buckets = [[], [], []];
    flowers.forEach((f, i) => buckets[i % 3].push(f));
    const petal = new THREE.IcosahedronGeometry(1, 0);
    buckets.forEach((b, i) => this._addInstanced(petal, flowerMats[i], b, { cast: false, tint: 0.15 }));

    // mushrooms, grass, flowers and reeds are deliberately walk-through:
    // tripping on ankle-height scenery feels awful in a horde game
    this.indexColliders();
    this._bakePropAO();
  },

  // Darken the ground around every solid prop. Real SSAO would need a depth
  // prepass over the whole horde every frame; baking it into the terrain's
  // vertex colours costs nothing at runtime and does most of the work of
  // seating the scenery into the ground instead of letting it float.
  _bakePropAO() {
    const geo = this.terrain.geometry;
    const p = geo.attributes.position.array;
    const col = geo.attributes.color;
    const c = col.array;
    const CELL = this.COLL_CELL;

    for (let i = 0, v = 0; i < p.length; i += 3, v += 3) {
      const x = p[i], z = p[i + 2];
      let ao = 1;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const cell = this._cgrid.get(gx + ',' + gz);
          if (!cell) continue;
          for (let k = 0; k < cell.length; k++) {
            const o = cell[k];
            const reach = o.r + 2.3;
            const dx = x - o.x, dz = z - o.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > reach * reach) continue;
            const t = 1 - Math.sqrt(d2) / reach;
            ao -= t * t * 0.5;
          }
        }
      }
      if (ao < 0.4) ao = 0.4;
      c[v] *= ao; c[v + 1] *= ao; c[v + 2] *= ao;
    }
    col.needsUpdate = true;
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

  // ---- static prop collision -------------------------------------------
  // Scenery is drawn with InstancedMesh, so there are no per-prop objects to
  // raycast against. Instead each solid prop registers an upright cylinder
  // here at build time, indexed into a uniform grid for cheap lookups.
  COLL_CELL: 8,
  colliders: [],
  _cgrid: new Map(),
  _stamp: 0,
  push: { x: 0, z: 0 },

  addCollider(x, z, r, h) {
    this.colliders.push({ x, z, r, top: this.heightAt(x, z) + h, _seen: 0 });
  },

  // Volumes the camera must not sit inside but that nothing else cares about —
  // tree canopies mostly. Shots and bodies pass straight through them.
  softColliders: [],
  addSoftCollider(x, z, r, bottom, top) {
    this.softColliders.push({ x, z, r, bottom, top });
  },

  _camBlocked(x, y, z) {
    for (let i = 0; i < this.softColliders.length; i++) {
      const c = this.softColliders[i];
      if (y < c.bottom || y > c.top) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return this.blocked(x, y, z, 0.45);
  },

  // How far along eye -> want the camera can sit before something gets in the
  // way. Pulling the camera in is the right fix for third person: shoving it
  // sideways just swaps one obstruction for another.
  cameraReach(eye, want) {
    const dx = want.x - eye.x, dy = want.y - eye.y, dz = want.z - eye.z;
    const STEPS = 12;
    let last = 0.46;      // never jam the camera right up against the player
    for (let i = 3; i <= STEPS; i++) {
      const t = i / STEPS;
      if (this._camBlocked(eye.x + dx * t, eye.y + dy * t, eye.z + dz * t)) return last;
      last = t;
    }
    return 1;
  },

  indexColliders() {
    this._cgrid.clear();
    const c = this.COLL_CELL;
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i];
      const x0 = Math.floor((col.x - col.r) / c), x1 = Math.floor((col.x + col.r) / c);
      const z0 = Math.floor((col.z - col.r) / c), z1 = Math.floor((col.z + col.r) / c);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = cx + ',' + cz;
          let cell = this._cgrid.get(k);
          if (!cell) this._cgrid.set(k, cell = []);
          cell.push(col);
        }
      }
    }
  },

  // Push a circle out of every prop it overlaps. `y` is the world height of
  // the mover: anything above a prop's top passes over it, so you can jump a
  // boulder and bats can fly over rocks but not through trunks.
  // Leaves the accumulated push in World.push so callers can kill the
  // velocity component heading into the obstacle.
  resolveCircle(pos, radius, y) {
    const stamp = ++this._stamp;
    const c = this.COLL_CELL;
    const x0 = Math.floor((pos.x - radius) / c), x1 = Math.floor((pos.x + radius) / c);
    const z0 = Math.floor((pos.z - radius) / c), z1 = Math.floor((pos.z + radius) / c);
    let hit = false;
    this.push.x = 0; this.push.z = 0;

    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this._cgrid.get(cx + ',' + cz);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const col = cell[i];
          if (col._seen === stamp) continue;        // a prop can sit in several cells
          col._seen = stamp;
          if (y !== undefined && y > col.top) continue;
          const dx = pos.x - col.x, dz = pos.z - col.z;
          const min = col.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          let d = Math.sqrt(d2), nx, nz;
          if (d < 1e-4) { nx = 1; nz = 0; d = 0; } else { nx = dx / d; nz = dz / d; }
          const out = min - d;
          pos.x += nx * out; pos.z += nz * out;
          this.push.x += nx * out; this.push.z += nz * out;
          hit = true;
        }
      }
    }
    return hit;
  },

  // does a point (a projectile, a spawn candidate) sit inside a solid prop?
  blocked(x, y, z, radius) {
    radius = radius || 0;
    const c = this.COLL_CELL;
    const x0 = Math.floor((x - radius) / c), x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c), z1 = Math.floor((z + radius) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this._cgrid.get(cx + ',' + cz);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const col = cell[i];
          if (y !== undefined && y > col.top) continue;
          const dx = x - col.x, dz = z - col.z;
          const min = col.r + radius;
          if (dx * dx + dz * dz < min * min) return true;
        }
      }
    }
    return false;
  },

  // slide `vel` along an obstacle instead of stopping dead against it
  slide(vel) {
    const px = this.push.x, pz = this.push.z;
    const len = Math.hypot(px, pz);
    if (len < 1e-5) return;
    const nx = px / len, nz = pz / len;
    const into = vel.x * nx + vel.z * nz;
    if (into < 0) { vel.x -= nx * into; vel.z -= nz * into; }
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
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * U.TAU;
      const r = U.rand(minR, maxR);
      out.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
      const inside = out.x * out.x + out.z * out.z < (this.RADIUS - 6) * (this.RADIUS - 6);
      // don't drop anything inside a tree; the last try is taken regardless
      if (inside && !this.blocked(out.x, this.heightAt(out.x, out.z) + 0.6, out.z, 0.7)) break;
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
