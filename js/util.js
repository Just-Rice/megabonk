/* ============================================================
   MEGABONK — shared math / helpers
   ============================================================ */
'use strict';

const U = {
  TAU: Math.PI * 2,

  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  // frame-rate independent smoothing: rate = fraction remaining after 1s
  damp(a, b, rate, dt) { return U.lerp(a, b, 1 - Math.pow(rate, dt)); },
  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick(arr) { return arr[(Math.random() * arr.length) | 0]; },
  chance(p) { return Math.random() < p; },

  // shortest signed angle from a to b
  angleDelta(a, b) {
    let d = (b - a) % U.TAU;
    if (d > Math.PI) d -= U.TAU;
    if (d < -Math.PI) d += U.TAU;
    return d;
  },
  approachAngle(a, b, t) { return a + U.angleDelta(a, b) * t; },

  dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; },

  fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  },

  fmtNum(n) {
    n = Math.round(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  },

  // deterministic hash noise (value noise, smooth)
  hash2(x, y) {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  },

  noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = U.hash2(xi, yi), b = U.hash2(xi + 1, yi);
    const c = U.hash2(xi, yi + 1), d = U.hash2(xi + 1, yi + 1);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  },

  fbm(x, y, oct = 3) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += U.noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5; freq *= 2.03;
    }
    return sum / norm;
  },

  // roulette pick: items are {weight:n}
  weighted(list) {
    let total = 0;
    for (const it of list) total += (it.weight || 1);
    let r = Math.random() * total;
    for (const it of list) {
      r -= (it.weight || 1);
      if (r <= 0) return it;
    }
    return list[list.length - 1];
  },

  // remove element by swapping with last (O(1), order not preserved)
  swapRemove(arr, i) {
    const last = arr.length - 1;
    if (i !== last) arr[i] = arr[last];
    arr.pop();
  },

  store(key, val) {
    try {
      if (val === undefined) {
        const raw = localStorage.getItem('megabonk.' + key);
        return raw == null ? null : JSON.parse(raw);
      }
      localStorage.setItem('megabonk.' + key, JSON.stringify(val));
    } catch (e) { /* private mode / disabled storage */ }
    return null;
  }
};
