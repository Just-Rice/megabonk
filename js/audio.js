/* ============================================================
   MEGABONK — tiny WebAudio synth (no asset files)
   ============================================================ */
'use strict';

const SFX = {
  ctx: null,
  master: null,
  muted: false,
  _lastAt: {},          // throttle: sound name -> last play time

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  // throttle so 40 simultaneous hits don't blow out the mix
  _gate(name, ms) {
    const now = performance.now();
    if (this._lastAt[name] && now - this._lastAt[name] < ms) return false;
    this._lastAt[name] = now;
    return true;
  },

  tone(freq, dur, type = 'square', vol = 0.3, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.25, filterHz = 1200) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },

  bonk()    { if (this._gate('bonk', 55))  this.tone(U.rand(150, 200), 0.09, 'square', 0.22, 60); },
  hit()     { if (this._gate('hit', 40))   this.noise(0.06, 0.14, 2600); },
  shoot()   { if (this._gate('shoot', 60)) this.tone(U.rand(620, 700), 0.07, 'sawtooth', 0.10, 320); },
  zap()     { if (this._gate('zap', 70))   this.tone(1400, 0.13, 'sawtooth', 0.14, 180); },
  boom()    { if (this._gate('boom', 90))  { this.noise(0.32, 0.34, 700); this.tone(90, 0.3, 'sine', 0.26, 35); } },
  die()     { if (this._gate('die', 45))   this.tone(U.rand(300, 380), 0.11, 'square', 0.10, 90); },
  gem()     { if (this._gate('gem', 45))   this.tone(U.rand(880, 1100), 0.05, 'triangle', 0.10); },
  coin()    { if (this._gate('coin', 45))  { this.tone(1180, 0.05, 'square', 0.09); setTimeout(() => this.tone(1560, 0.06, 'square', 0.08), 45); } },
  heal()    { this.tone(520, 0.1, 'sine', 0.2, 900); },
  ouch()    { if (this._gate('ouch', 220)) { this.tone(220, 0.16, 'sawtooth', 0.26, 80); this.noise(0.12, 0.18, 900); } },
  dash()    { this.noise(0.16, 0.16, 3200); this.tone(300, 0.14, 'sine', 0.1, 700); },
  levelup() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'square', 0.2), i * 80)); },
  chest()   { [784, 988, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 'triangle', 0.18), i * 90)); },
  boss()    { this.tone(70, 1.0, 'sawtooth', 0.3, 40); this.noise(0.8, 0.2, 400); },
  over()    { [440, 370, 294, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.34, 'square', 0.22), i * 190)); },
  win()     { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.22), i * 130)); }
};
