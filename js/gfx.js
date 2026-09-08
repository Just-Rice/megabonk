/* ============================================================
   MEGABONK — graphics helpers: colour pipeline, materials,
   quality tiers, wind, and terrain-hugging ground decals
   ============================================================ */
'use strict';

const GFX = {
  // ---- quality tiers -------------------------------------------------
  tier: 'high',
  mobile: false,
  q: {
    bloom: true, msaa: true, shadows: true, shadowSize: 2048,
    propDensity: 1.0, particleScale: 1.0, water: true, pixelRatio: 1.75,
    blobs: true, hordeScale: 1.0
  },

  TIERS: {
    low:    { bloom: false, msaa: false, shadows: false, shadowSize: 512,  propDensity: 0.4, particleScale: 0.45, water: true, pixelRatio: 1.0,  blobs: true, hordeScale: 0.6 },
    medium: { bloom: true,  msaa: false, shadows: true,  shadowSize: 1024, propDensity: 0.7, particleScale: 0.75, water: true, pixelRatio: 1.35, blobs: true, hordeScale: 0.82 },
    high:   { bloom: true,  msaa: true,  shadows: true,  shadowSize: 2048, propDensity: 1.0, particleScale: 1.0,  water: true, pixelRatio: 1.75, blobs: true, hordeScale: 1.0 }
  },

  setTier(name) {
    if (!this.TIERS[name]) return;
    this.tier = name;
    Object.assign(this.q, this.TIERS[name]);
    if (this.mobile) {
      // phone GPUs are fill-rate bound and their DPR is often 3; rendering at
      // native resolution is the single most expensive mistake here
      this.q.pixelRatio = Math.min(this.q.pixelRatio, 1.0);
      this.q.propDensity *= 0.6;
      this.q.hordeScale *= 0.75;
      this.q.shadowSize = Math.min(this.q.shadowSize, 1024);
    }
  },

  // ---- colour --------------------------------------------------------
  // Everything is authored as sRGB hex but the renderer lights in linear
  // space, so every colour has to be converted on the way in. Tone mapping
  // and the sRGB encode happen once, at the end of the post chain.
  col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); },

  setCol(target, hex) { target.setHex(hex).convertSRGBToLinear(); return target; },

  // ---- materials -----------------------------------------------------
  // The default surface for everything in the world. Physically based, so it
  // responds to the environment map rather than looking like flat paint.
  mat(hex, opts) {
    const o = Object.assign({}, opts || {});
    if (o.emissive !== undefined) o.emissive = this.col(o.emissive);
    o.color = this.col(hex);
    if (o.roughness === undefined) o.roughness = 0.86;
    if (o.metalness === undefined) o.metalness = 0.02;
    if (o.flatShading === undefined) o.flatShading = true;
    return new THREE.MeshStandardMaterial(o);
  },

  basic(hex, opts) {
    const o = Object.assign({}, opts || {});
    o.color = this.col(hex);
    return new THREE.MeshBasicMaterial(o);
  },

  // glowing material for anything the bloom pass should pick up
  glow(hex, intensity) {
    const c = this.col(hex).multiplyScalar(intensity === undefined ? 1.9 : intensity);
    return new THREE.MeshBasicMaterial({ color: c, fog: true });
  },

  // ---- procedural textures ------------------------------------------
  // No external assets, so surface detail is generated once into canvases:
  // a value-noise albedo plus a Sobel-derived normal map. This is what
  // separates "flat coloured polygon" from "a material catching light".
  _texCache: {},

  _noiseCanvas(size, opts) {
    const o = opts || {};
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const d = img.data;
    const scale = Math.max(1, Math.round(o.scale || 8));
    const oct = o.octaves || 4;
    const contrast = o.contrast === undefined ? 1 : o.contrast;
    const streak = o.streak || 0;
    // integer lattice periods per octave keep every octave seamless
    const py0 = streak ? Math.max(1, Math.round(scale * 0.2)) : scale;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0, amp = 1, norm = 0, px = scale, py = py0;
        for (let k = 0; k < oct; k++) {
          v += U.noise2Tiled((x / size) * px, (y / size) * py, px, py) * amp;
          norm += amp; amp *= 0.5; px *= 2; py *= 2;
        }
        v /= norm;
        v = U.clamp(0.5 + (v - 0.5) * contrast, 0, 1);
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255);
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  },

  // grayscale height canvas -> tangent-space normal map
  _normalFrom(canvas, strength) {
    const size = canvas.width;
    const src = canvas.getContext('2d').getImageData(0, 0, size, size).data;
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const g = out.getContext('2d');
    const img = g.createImageData(size, size);
    const d = img.data;
    const at = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
    const k = strength === undefined ? 2.4 : strength;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * k;
        const dy = (at(x, y + 1) - at(x, y - 1)) * k;
        let nx = -dx, ny = -dy, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const i = (y * size + x) * 4;
        d[i] = Math.round((nx * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return out;
  },

  // returns { map, normalMap } ready to hang on a standard material
  surface(name, opts) {
    if (this._texCache[name]) return this._texCache[name];
    const o = opts || {};
    const size = o.size || 256;
    const height = this._noiseCanvas(size, o);
    const normalCanvas = this._normalFrom(height, o.bump);

    // tint the height field into an albedo
    const alb = document.createElement('canvas');
    alb.width = alb.height = size;
    const ag = alb.getContext('2d');
    ag.drawImage(height, 0, 0);
    const im = ag.getImageData(0, 0, size, size);
    const dd = im.data;
    const base = new THREE.Color(o.color || 0x888888);
    const dark = new THREE.Color(o.dark !== undefined ? o.dark : 0x000000);
    const amount = o.tintAmount === undefined ? 0.45 : o.tintAmount;
    const tmp = new THREE.Color();
    for (let i = 0; i < dd.length; i += 4) {
      const v = dd[i] / 255;
      tmp.copy(dark).lerp(base, 1 - amount + v * amount);
      dd[i] = Math.round(tmp.r * 255);
      dd[i + 1] = Math.round(tmp.g * 255);
      dd[i + 2] = Math.round(tmp.b * 255);
    }
    ag.putImageData(im, 0, 0);

    const map = new THREE.CanvasTexture(alb);
    const normalMap = new THREE.CanvasTexture(normalCanvas);
    for (const t of [map, normalMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
    }
    map.encoding = THREE.sRGBEncoding;
    const res = { map, normalMap };
    this._texCache[name] = res;
    return res;
  },

  // ---- PBR ------------------------------------------------------------
  env: null,

  // Build an equirectangular sky and pre-filter it into an environment map so
  // every standard material picks up real sky light and reflections.
  buildEnvironment(renderer, scene) {
    const w = 256, h = 128;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0.00, '#1a2340');
    grd.addColorStop(0.34, '#4a5f84');
    grd.addColorStop(0.52, '#93a3ba');
    grd.addColorStop(0.62, '#d9b48c');
    grd.addColorStop(0.72, '#c98d5e');
    grd.addColorStop(1.00, '#3a3128');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // a warm bloom where the sun sits so reflections have a hot spot
    const sg = g.createRadialGradient(w * 0.62, h * 0.6, 2, w * 0.62, h * 0.6, 44);
    sg.addColorStop(0, 'rgba(255,236,200,1)');
    sg.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = sg; g.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;

    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const rt = pmrem.fromEquirectangular(tex);
      this.env = rt.texture;
      scene.environment = this.env;
      pmrem.dispose();
      tex.dispose();
    } catch (e) {
      this.env = null;      // no IBL available; materials still light fine
    }
    return this.env;
  },

  standard(hex, opts) {
    const o = Object.assign({}, opts || {});
    o.color = this.col(hex);
    if (o.emissive !== undefined) o.emissive = this.col(o.emissive);
    if (o.roughness === undefined) o.roughness = 0.92;
    if (o.metalness === undefined) o.metalness = 0.0;
    if (o.surface) {
      const s = this.surface(o.surface, o.surfaceOpts);
      o.map = s.map;
      o.normalMap = s.normalMap;
      o.normalScale = new THREE.Vector2(o.bumpScale || 1, o.bumpScale || 1);
      delete o.surface; delete o.surfaceOpts; delete o.bumpScale;
    }
    if (o.repeat) {
      const r = o.repeat;
      if (o.map) { o.map = o.map.clone(); o.map.needsUpdate = true; o.map.repeat.set(r, r); o.map.wrapS = o.map.wrapT = THREE.RepeatWrapping; }
      if (o.normalMap) { o.normalMap = o.normalMap.clone(); o.normalMap.needsUpdate = true; o.normalMap.repeat.set(r, r); o.normalMap.wrapS = o.normalMap.wrapT = THREE.RepeatWrapping; }
      delete o.repeat;
    }
    return new THREE.MeshStandardMaterial(o);
  },

  // ---- wind ----------------------------------------------------------
  _windMats: [],

  wind(material, strength, speed) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uSway = { value: strength };
      shader.uniforms.uSpeed = { value: speed || 1.4 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uSway; uniform float uSpeed;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            #ifdef USE_INSTANCING
              vec3 wp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
            #else
              vec3 wp = transformed;
            #endif
            float h = max(transformed.y, 0.0);
            float phase = uTime * uSpeed + wp.x * 0.32 + wp.z * 0.27;
            float gust = 0.65 + 0.35 * sin(uTime * 0.37 + wp.x * 0.03);
            transformed.x += sin(phase) * uSway * h * gust;
            transformed.z += cos(phase * 0.83) * uSway * 0.6 * h * gust;
          }`);
      material.userData.shader = shader;
    };
    material.needsUpdate = true;
    this._windMats.push(material);
    return material;
  },

  updateWind(elapsed) {
    for (let i = 0; i < this._windMats.length; i++) {
      const s = this._windMats[i].userData.shader;
      if (s) s.uniforms.uTime.value = elapsed;
    }
  },

  // ---- ground decals -------------------------------------------------
  // A flat disc laid on rolling terrain buries its uphill half and floats on
  // the downhill side. These build a subdivided disc/ring whose vertices are
  // re-projected onto the height field every frame, so the decal follows the
  // ground exactly.
  makeDisc(rings, segs, innerRatio) {
    const inner = innerRatio || 0;
    const verts = [], idx = [], dirs = [], uvs = [];
    for (let r = 0; r <= rings; r++) {
      const t = inner + (1 - inner) * (r / rings);
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * U.TAU;
        const dx = Math.cos(a), dz = Math.sin(a);
        verts.push(dx * t, 0, dz * t);
        dirs.push(dx * t, dz * t);
        uvs.push((r / rings), (s / segs));
      }
    }
    const row = segs + 1;
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * row + s, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(idx);
    geo.userData.dirs = new Float32Array(dirs);
    geo.userData.rings = rings;
    geo.userData.segs = segs;
    geo.userData.inner = inner;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
    return geo;
  },

  // project a disc geometry onto the terrain around (cx, cz)
  conform(mesh, cx, cz, radius, lift) {
    const geo = mesh.geometry;
    const dirs = geo.userData.dirs;
    const pos = geo.attributes.position;
    const arr = pos.array;
    const baseY = mesh.position.y;
    const up = lift === undefined ? 0.09 : lift;
    for (let i = 0, d = 0; i < arr.length; i += 3, d += 2) {
      const x = dirs[d] * radius, z = dirs[d + 1] * radius;
      arr[i] = x;
      arr[i + 1] = World.heightAt(cx + x, cz + z) - baseY + up;
      arr[i + 2] = z;
    }
    pos.needsUpdate = true;
  },

  // Cheap version for the many small blobs: align a flat disc with the local
  // ground normal. `yaw` compensates for a rotating parent so the decal stays
  // level with the world rather than with the character.
  _UP: new THREE.Vector3(0, 1, 0),
  _n: new THREE.Vector3(),

  tiltToGround(mesh, x, z, yaw) {
    const n = World.normalAt(x, z, 0.9);
    if (yaw) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      this._n.set(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
    } else {
      this._n.copy(n);
    }
    mesh.quaternion.setFromUnitVectors(this._UP, this._n);
  },

  // horizontal alpha ramp used as a radial falloff on makeDisc's polar UVs
  _rampTex: null,
  ramp() {
    if (this._rampTex) return this._rampTex;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 1;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 64, 0);
    grd.addColorStop(0.0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.62, 'rgba(255,255,255,0.72)');
    grd.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 1);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    this._rampTex = t;
    return t;
  },

  // soft-edged ground blob: a disc lying in XZ (local up is +Y, no pre-rotation)
  blob(radius, opacity, hex) {
    const mesh = new THREE.Mesh(this.makeDisc(2, 22, 0), new THREE.MeshBasicMaterial({
      color: this.col(hex === undefined ? 0x000000 : hex),
      map: this.ramp(), transparent: true, opacity: opacity === undefined ? 0.24 : opacity,
      depthWrite: false, fog: true
    }));
    mesh.frustumCulled = false;
    mesh.userData.radius = radius;
    mesh.renderOrder = 1;
    return mesh;
  }
};
