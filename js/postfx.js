/* ============================================================
   MEGABONK — post processing
   HDR scene buffer -> bright pass -> separable blur -> composite
   (bloom + ACES tone map + vignette + grade + sRGB encode)

   Hand rolled rather than pulled from three's examples so the whole
   game stays three CDN files and still opens straight from disk.
   ============================================================ */
'use strict';

const PostFX = {
  ok: false,
  renderer: null,
  width: 1, height: 1,

  rtScene: null,
  rtBrightA: null, rtBrightB: null,
  rtWideA: null, rtWideB: null,

  quadScene: null, quadCam: null, quad: null,
  matBright: null, matBlur: null, matComposite: null,

  BLOOM_STRENGTH: 0.5,
  EXPOSURE: 1.12,

  _flash: 0,

  init(renderer) {
    this.renderer = renderer;
    const gl2 = renderer.capabilities.isWebGL2;
    // half float keeps highlights above 1.0 so the bright pass has something
    // to actually bloom; 8 bit buffers clamp all the glow away
    this.hdrType = gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.msaa = gl2 && GFX.q.msaa && !!THREE.WebGLMultisampleRenderTarget;

    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();

    // fullscreen triangle (cheaper and seam free vs. two triangles)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

    const VERT = `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

    this.matBright = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.0 }, uKnee: { value: 0.6 } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uThreshold; uniform float uKnee;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float w = smoothstep(uThreshold, uThreshold + uKnee, l);
          gl_FragColor = vec4(c * w, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });

    this.matBlur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
          sum += (texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb +
                  texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
          sum += (texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb +
                  texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
          gl_FragColor = vec4(sum, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });

    this.matComposite = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, tWide: { value: null },
        uBloom: { value: this.BLOOM_STRENGTH }, uExposure: { value: this.EXPOSURE },
        uVignette: { value: 0.52 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 0.2, 0.3) }
      },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tWide;
        uniform float uBloom; uniform float uExposure; uniform float uVignette;
        uniform float uFlash; uniform vec3 uFlashColor;
        varying vec2 vUv;

        // Narkowicz ACES approximation
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        vec3 toSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
                     step(vec3(0.0031308), c));
        }

        void main() {
          vec3 col = texture2D(tScene, vUv).rgb;
          vec3 bloom = texture2D(tBloom, vUv).rgb + texture2D(tWide, vUv).rgb * 0.75;
          col += bloom * uBloom;
          col *= uExposure;

          col = mix(col, col + uFlashColor * uFlash, min(uFlash, 1.0));
          col = aces(col);

          // gentle grade: lift the shadows a touch and push saturation
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(lum), col, 1.12);
          col = pow(col, vec3(0.98));

          float d = length((vUv - 0.5) * vec2(1.06, 1.0));
          col *= mix(1.0, smoothstep(0.86, 0.28, d), uVignette);

          gl_FragColor = vec4(toSRGB(col), 1.0);
        }`,
      depthTest: false, depthWrite: false
    });

    this.quad = new THREE.Mesh(g, this.matComposite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.ok = true;
  },

  _makeRT(w, h, multisample) {
    const opts = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: this.hdrType,
      depthBuffer: true, stencilBuffer: false
    };
    let rt;
    if (multisample && this.msaa) {
      rt = new THREE.WebGLMultisampleRenderTarget(w, h, opts);
      rt.samples = 4;
    } else {
      rt = new THREE.WebGLRenderTarget(w, h, opts);
    }
    return rt;
  },

  setSize(w, h) {
    if (!this.ok) return;
    this.width = Math.max(2, w); this.height = Math.max(2, h);
    const hw = Math.max(2, Math.floor(w / 2)), hh = Math.max(2, Math.floor(h / 2));
    const qw = Math.max(2, Math.floor(w / 4)), qh = Math.max(2, Math.floor(h / 4));

    [this.rtScene, this.rtBrightA, this.rtBrightB, this.rtWideA, this.rtWideB]
      .forEach(rt => rt && rt.dispose());

    this.rtScene = this._makeRT(this.width, this.height, true);
    this.rtBrightA = this._makeRT(hw, hh, false);
    this.rtBrightB = this._makeRT(hw, hh, false);
    this.rtWideA = this._makeRT(qw, qh, false);
    this.rtWideB = this._makeRT(qw, qh, false);
    [this.rtBrightA, this.rtBrightB, this.rtWideA, this.rtWideB].forEach(rt => { rt.depthBuffer = false; });
  },

  flash(amount, hex) {
    this._flash = Math.min(1.4, this._flash + amount);
    if (hex !== undefined) this.matComposite.uniforms.uFlashColor.value.setHex(hex).convertSRGBToLinear();
  },

  update(dt) {
    if (this._flash > 0) this._flash = Math.max(0, this._flash - dt * 3.2);
  },

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.quadCam);
  },

  _blurInto(srcTex, a, b, w, h, spread) {
    this.matBlur.uniforms.tDiffuse.value = srcTex;
    this.matBlur.uniforms.uDir.value.set(spread / w, 0);
    this._blit(this.matBlur, a);
    this.matBlur.uniforms.tDiffuse.value = a.texture;
    this.matBlur.uniforms.uDir.value.set(0, spread / h);
    this._blit(this.matBlur, b);
  },

  render(scene, camera) {
    const r = this.renderer;
    if (!this.ok || !GFX.q.bloom) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    const hw = this.rtBrightA.width, hh = this.rtBrightA.height;
    const qw = this.rtWideA.width, qh = this.rtWideA.height;

    this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
    this._blit(this.matBright, this.rtBrightB);
    this._blurInto(this.rtBrightB.texture, this.rtBrightA, this.rtBrightB, hw, hh, 1.0);
    // second, wider pass at quarter res gives the glow a soft falloff
    this._blurInto(this.rtBrightB.texture, this.rtWideA, this.rtWideB, qw, qh, 2.0);

    const u = this.matComposite.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.rtBrightB.texture;
    u.tWide.value = this.rtWideB.texture;
    u.uFlash.value = this._flash;

    this.quad.material = this.matComposite;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
};
