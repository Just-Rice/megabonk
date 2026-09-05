/* ============================================================
   MEGABONK — graphics helpers: colour pipeline, materials,
   quality tiers, wind, and terrain-hugging ground decals
   ============================================================ */
'use strict';

const GFX = {
  // ---- quality tiers -------------------------------------------------
  tier: 'high',
  q: {
    bloom: true, msaa: true, shadows: true, shadowSize: 2048,
    propDensity: 1.0, particleScale: 1.0, water: true, pixelRatio: 1.75, blobs: true
  },

  TIERS: {
    low:    { bloom: false, msaa: false, shadows: false, shadowSize: 512,  propDensity: 0.4, particleScale: 0.45, water: true, pixelRatio: 1.0,  blobs: true },
    medium: { bloom: true,  msaa: false, shadows: true,  shadowSize: 1024, propDensity: 0.7, particleScale: 0.75, water: true, pixelRatio: 1.35, blobs: true },
    high:   { bloom: true,  msaa: true,  shadows: true,  shadowSize: 2048, propDensity: 1.0, particleScale: 1.0,  water: true, pixelRatio: 1.75, blobs: true }
  },

  setTier(name) {
    if (!this.TIERS[name]) return;
    this.tier = name;
    Object.assign(this.q, this.TIERS[name]);
  },

  // ---- colour --------------------------------------------------------
  // Everything is authored as sRGB hex but the renderer lights in linear
  // space, so every colour has to be converted on the way in. Tone mapping
  // and the sRGB encode happen once, at the end of the post chain.
  col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); },

  setCol(target, hex) { target.setHex(hex).convertSRGBToLinear(); return target; },

  // ---- materials -----------------------------------------------------
  lambert(hex, opts) {
    const o = Object.assign({ flatShading: true }, opts || {});
    if (o.emissive !== undefined) o.emissive = this.col(o.emissive);
    o.color = this.col(hex);
    return new THREE.MeshLambertMaterial(o);
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
      map: this.ramp(), transparent: true, opacity: opacity === undefined ? 0.34 : opacity,
      depthWrite: false, fog: true
    }));
    mesh.frustumCulled = false;
    mesh.userData.radius = radius;
    mesh.renderOrder = 1;
    return mesh;
  }
};
