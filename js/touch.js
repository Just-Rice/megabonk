/* ============================================================
   MEGABONK — touch controls

   Detection is by pointer capability, not user-agent sniffing: a
   coarse pointer with touch points means thumbs, whether that is a
   phone, a tablet or a Surface. Laptops with a touchscreen but a real
   mouse keep the desktop scheme.
   ============================================================ */
'use strict';

const TouchCtl = {
  enabled: false,
  el: {},

  // left thumb drives movement, right thumb swings the camera
  moveId: null, lookId: null,
  origin: { x: 0, y: 0 },
  axis: { x: 0, y: 0 },
  lookLast: { x: 0, y: 0 },
  RADIUS: 62,

  detect() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const points = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    return coarse && points;
  },

  init() {
    this.enabled = this.detect();
    document.body.classList.toggle('touch', this.enabled);
    if (!this.enabled) return;

    const id = s => document.getElementById(s);
    this.el = {
      layer: id('touchlayer'),
      stick: id('stick'),
      knob: id('stickknob'),
      dash: id('btn-dash'),
      jump: id('btn-jump'),
      pause: id('btn-pause'),
      rotate: id('rotate')
    };

    const layer = this.el.layer;
    layer.addEventListener('touchstart', e => this._start(e), { passive: false });
    layer.addEventListener('touchmove', e => this._move(e), { passive: false });
    layer.addEventListener('touchend', e => this._end(e), { passive: false });
    layer.addEventListener('touchcancel', e => this._end(e), { passive: false });

    const tap = (el, fn) => {
      if (!el) return;
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();      // must not also start a camera drag
        SFX.resume();
        fn();
        el.classList.add('held');
      }, { passive: false });
      el.addEventListener('touchend', e => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove('held');
      }, { passive: false });
    };
    tap(this.el.dash, () => { Game.input.dash = true; });
    tap(this.el.jump, () => { Game.input.jump = true; });
    tap(this.el.pause, () => {
      if (Game.state === 'playing' || Game.state === 'paused') Game.togglePause();
    });

    // the menu's control hint is keyboard-centric; swap it for thumbs
    const hint = document.querySelector('#menu .controls');
    if (hint) {
      hint.innerHTML = '<b>LEFT THUMB</b> move &middot; <b>RIGHT THUMB</b> look &middot; ' +
        '<b>DASH</b> / <b>JUMP</b> buttons<br>' +
        '<span class="dim">Weapons fire on their own. Walk over gems. Don\'t die.</span>';
    }

    this.checkOrientation();
    window.addEventListener('resize', () => this.checkOrientation());
    window.addEventListener('orientationchange', () => setTimeout(() => this.checkOrientation(), 250));
  },

  // the HUD needs the long axis; nag gently rather than trying to letterbox
  checkOrientation() {
    if (!this.enabled || !this.el.rotate) return;
    const portrait = window.innerHeight > window.innerWidth;
    this.el.rotate.classList.toggle('hidden', !portrait);
  },

  _isPlaying() { return Game.state === 'playing'; },

  _start(e) {
    if (!this._isPlaying()) return;
    e.preventDefault();
    SFX.resume();
    for (const t of e.changedTouches) {
      const leftHalf = t.clientX < window.innerWidth * 0.45;
      if (leftHalf && this.moveId === null) {
        this.moveId = t.identifier;
        this.origin.x = t.clientX; this.origin.y = t.clientY;
        this.axis.x = 0; this.axis.y = 0;
        this._placeStick(t.clientX, t.clientY, 0, 0);
        this.el.stick.classList.remove('hidden');
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast.x = t.clientX; this.lookLast.y = t.clientY;
      }
    }
  },

  _move(e) {
    if (!this._isPlaying()) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveId) {
        let dx = t.clientX - this.origin.x;
        let dy = t.clientY - this.origin.y;
        const len = Math.hypot(dx, dy);
        if (len > this.RADIUS) { dx *= this.RADIUS / len; dy *= this.RADIUS / len; }
        // screen down is world "backwards", so y is inverted for the axis
        this.axis.x = dx / this.RADIUS;
        this.axis.y = -dy / this.RADIUS;
        this._placeStick(this.origin.x, this.origin.y, dx, dy);
      } else if (t.identifier === this.lookId) {
        const dx = t.clientX - this.lookLast.x;
        const dy = t.clientY - this.lookLast.y;
        this.lookLast.x = t.clientX; this.lookLast.y = t.clientY;
        Game.camYaw -= dx * 0.006;
        Game.camPitch = U.clamp(Game.camPitch + dy * 0.004, 0.12, 1.25);
      }
    }
  },

  _end(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveId) {
        this.moveId = null;
        this.axis.x = 0; this.axis.y = 0;
        this.el.stick.classList.add('hidden');
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
  },

  _placeStick(cx, cy, dx, dy) {
    const s = this.el.stick;
    s.style.left = cx + 'px';
    s.style.top = cy + 'px';
    this.el.knob.style.transform = 'translate(' + (dx - 26) + 'px,' + (dy - 26) + 'px)';
  },

  // called every frame from the game loop
  apply(input) {
    if (!this.enabled) return;
    if (this.moveId !== null && (this.axis.x || this.axis.y)) {
      input.axis = this.axis;
    } else {
      input.axis = null;
    }
  },

  release() {
    this.moveId = this.lookId = null;
    this.axis.x = this.axis.y = 0;
    if (this.el.stick) this.el.stick.classList.add('hidden');
  }
};
