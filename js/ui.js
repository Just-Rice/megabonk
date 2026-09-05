/* ============================================================
   MEGABONK — DOM / HUD
   ============================================================ */
'use strict';

const UI = {
  el: {},
  _lastLoadoutKey: '',

  init() {
    const id = s => document.getElementById(s);
    this.el = {
      hud: id('hud'), menu: id('menu'), levelup: id('levelup'), pause: id('pause'),
      gameover: id('gameover'), loading: id('loading'),
      xpfill: id('xpfill'), lvl: id('lvl'), clock: id('clock'),
      kills: id('c-kills'), gold: id('c-gold'), wave: id('c-wave'),
      hpfill: id('hpfill'), hptext: id('hptext'), loadout: id('loadout'),
      dashfill: id('dashfill'),
      bosswrap: id('bosswrap'), bossname: id('bossname'), bossfill: id('bossfill'),
      toasts: id('toasts'), cards: id('cards'), luLvl: id('lu-lvl'),
      rerollBtn: id('rerollbtn'), rerolls: id('rerolls'),
      chars: id('chars'), playbtn: id('playbtn'),
      statlist: id('statlist'), goStats: id('go-stats'), goTitle: id('go-title'),
      bestline: id('bestline')
    };

    this._buildCharPicker();

    this.el.playbtn.onclick = () => Game.start();
    document.getElementById('resumebtn').onclick = () => Game.togglePause();
    document.getElementById('quitbtn').onclick = () => Game.quitToMenu();
    document.getElementById('againbtn').onclick = () => Game.toMenuFromGameOver();
    this.el.rerollBtn.onclick = () => Game.reroll();

    this.showBest();
  },

  showBest() {
    const best = U.store('best');
    if (best && best.time) {
      this.el.bestline.textContent =
        'BEST: ' + U.fmtTime(best.time) + ' · LV' + best.level + ' · ' + best.kills + ' KILLS';
    }
  },

  _buildCharPicker() {
    this.el.chars.innerHTML = '';
    CHARACTERS.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'char' + (i === 0 ? ' sel' : '');
      d.innerHTML = `<div class="ico">${c.icon}</div><div class="nm">${c.name}</div><div class="ds">${c.desc}</div>`;
      d.onclick = () => {
        Game.selectedChar = i;
        [...this.el.chars.children].forEach((n, j) => n.classList.toggle('sel', i === j));
        SFX.resume(); SFX.tone(700, 0.06, 'square', 0.12);
      };
      this.el.chars.appendChild(d);
    });
  },

  show(name) {
    ['menu', 'levelup', 'pause', 'gameover', 'loading'].forEach(k => {
      this.el[k].classList.toggle('hidden', k !== name);
    });
    this.el.hud.classList.toggle('hidden', name === 'menu' || name === 'loading');
  },

  hideOverlays() {
    ['menu', 'levelup', 'pause', 'gameover', 'loading'].forEach(k => this.el[k].classList.add('hidden'));
    this.el.hud.classList.remove('hidden');
  },

  toast(text, color = '#ffffff') {
    const d = document.createElement('div');
    d.className = 'toast';
    d.style.color = color;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 1700);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
  },

  updateHud() {
    const p = Player;
    const hpPct = U.clamp(p.hp / p.stats.maxHp, 0, 1) * 100;
    this.el.hpfill.style.width = hpPct + '%';
    this.el.hptext.textContent = Math.ceil(Math.max(0, p.hp)) + ' / ' + Math.round(p.stats.maxHp);

    this.el.xpfill.style.width = U.clamp(p.xp / p.xpNext, 0, 1) * 100 + '%';
    this.el.lvl.textContent = 'LV ' + p.level;
    this.el.clock.textContent = U.fmtTime(Game.time);
    this.el.kills.textContent = '☠ ' + p.kills;
    this.el.gold.textContent = '◉ ' + p.gold;
    this.el.wave.textContent = 'WAVE ' + Game.wave;

    const dashPct = p.dashStock > 0
      ? 100
      : U.clamp(1 - p.dashCdLeft / p.stats.dashCd, 0, 1) * 100;
    this.el.dashfill.style.width = dashPct + '%';
    this.el.dashfill.style.background = p.dashStock > 0 ? '#3dd6ff' : '#66607a';

    if (Enemies.boss) {
      this.el.bossfill.style.width = U.clamp(Enemies.boss.hp / Enemies.boss.maxHp, 0, 1) * 100 + '%';
    }

    this.renderLoadout();
  },

  renderLoadout() {
    const parts = [];
    for (const w of Weapons.owned) parts.push('w' + w.id + w.level);
    for (const k in Upgrades.levels) parts.push('p' + k + Upgrades.levels[k]);
    const key = parts.join('|');
    if (key === this._lastLoadoutKey) return;
    this._lastLoadoutKey = key;

    let html = '';
    for (const w of Weapons.owned) {
      const maxed = w.level >= w.def.max ? ' maxed' : '';
      html += `<div class="slot${maxed}" title="${w.def.name}">${w.def.icon}<span class="lv">${w.level}</span></div>`;
    }
    for (const k in Upgrades.levels) {
      const def = PASSIVES[k];
      const maxed = Upgrades.levels[k] >= def.max ? ' maxed' : '';
      html += `<div class="slot passive${maxed}" title="${def.name}">${def.icon}<span class="lv">${Upgrades.levels[k]}</span></div>`;
    }
    this.el.loadout.innerHTML = html;
  },

  showLevelUp(picks, onPick, rerollsLeft) {
    this.el.luLvl.textContent = Player.level;
    this.el.cards.innerHTML = '';
    picks.forEach(c => {
      const d = document.createElement('div');
      d.className = 'card ' + (c.rarity || '');
      const lvlText = c.kind === 'bonus' ? '' :
        (c.level === 0 ? 'NEW' : 'LV ' + c.level + ' → ' + (c.level + 1));
      d.innerHTML =
        `<div class="ico">${c.icon}</div>` +
        `<div class="tag">${c.tag}</div>` +
        `<div class="nm">${c.name}</div>` +
        `<div class="ds">${c.desc}</div>` +
        `<div class="lvpill">${lvlText}</div>`;
      d.onclick = () => onPick(c);
      this.el.cards.appendChild(d);
    });

    this.el.rerolls.textContent = rerollsLeft;
    this.el.rerollBtn.classList.toggle('off', rerollsLeft <= 0);

    this.el.levelup.classList.remove('hidden');
    this.el.hud.classList.remove('hidden');
  },

  hideLevelUp() { this.el.levelup.classList.add('hidden'); },

  showBoss(name) {
    this.el.bossname.textContent = name;
    this.el.bossfill.style.width = '100%';
    this.el.bosswrap.classList.remove('hidden');
  },
  hideBoss() { this.el.bosswrap.classList.add('hidden'); },

  showPause() {
    const rows = Upgrades.statRows();
    this.el.statlist.innerHTML = rows.map(r => `<div>${r[0]} <b>${r[1]}</b></div>`).join('');
    this.el.pause.classList.remove('hidden');
  },
  hidePause() { this.el.pause.classList.add('hidden'); },

  showGameOver(win) {
    this.el.goTitle.textContent = win ? 'YOU ARE THE MEGABONK' : 'YOU GOT BONKED';
    this.el.goTitle.classList.toggle('win', !!win);
    this.el.goStats.innerHTML =
      `SURVIVED <b>${U.fmtTime(Game.time)}</b><br>` +
      `LEVEL <b>${Player.level}</b><br>` +
      `KILLS <b>${Player.kills}</b><br>` +
      `GOLD <b>${Player.gold}</b><br>` +
      `DAMAGE <b>${U.fmtNum(Player.damageDealt)}</b>`;
    this.el.gameover.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }
};
