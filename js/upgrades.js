/* ============================================================
   MEGABONK — level-up choices
   ============================================================ */
'use strict';

const PASSIVES = {
  might:    { name: 'MIGHT',        icon: '💪', max: 8, desc: 'Everything hits +12% harder.',        apply: s => s.damageMul += 0.12 },
  haste:    { name: 'HASTE',        icon: '⏱️', max: 8, desc: 'Weapons fire 10% faster.',            apply: s => s.attackSpeedMul += 0.10 },
  swift:    { name: 'SWIFT BOOTS',  icon: '👢', max: 6, desc: 'Move 8% faster.',                     apply: s => s.moveSpeed *= 1.08 },
  vitality: { name: 'VITALITY',     icon: '❤️', max: 8, desc: '+20 max HP, and heal 20.',            apply: s => { s.maxHp += 20; Player.heal(20); } },
  regen:    { name: 'REGEN',        icon: '🌿', max: 6, desc: 'Recover +0.5 HP per second.',         apply: s => s.hpRegen += 0.5 },
  area:     { name: 'BIG BONK',     icon: '🔆', max: 6, desc: 'Weapon area +12%.',                   apply: s => s.areaMul += 0.12 },
  velocity: { name: 'VELOCITY',     icon: '🚀', max: 5, desc: 'Projectiles fly 15% faster.',         apply: s => s.projSpeedMul += 0.15 },
  magnet:   { name: 'MAGNET',       icon: '🧲', max: 6, desc: 'Pickup range +35%.',                  apply: s => s.pickupRadius *= 1.35 },
  crit:     { name: 'SHARP EYE',    icon: '🎯', max: 6, desc: 'Crit chance +6%.',                    apply: s => s.critChance += 0.06 },
  critdmg:  { name: 'BRUTALITY',    icon: '💥', max: 6, desc: 'Crit damage +40%.',                   apply: s => s.critMul += 0.4 },
  armor:    { name: 'ARMOR',        icon: '🛡️', max: 6, desc: 'Take 2 less damage per hit.',         apply: s => s.armor += 2 },
  wisdom:   { name: 'WISDOM',       icon: '📘', max: 5, desc: 'Gain 15% more XP.',                   apply: s => s.xpMul += 0.15 },
  luck:     { name: 'LUCK',         icon: '🍀', max: 5, desc: 'Better drops and rarer finds.',       apply: s => s.luck += 1 },
  greed:    { name: 'GREED',        icon: '💰', max: 5, desc: 'Gold gain +25%.',                     apply: s => s.goldMul += 0.25 },
  cooldown: { name: 'COOL HEAD',    icon: '❄️', max: 5, desc: 'Weapon cooldowns -8%.',               apply: s => s.cooldownMul *= 0.92 },
  thorns:   { name: 'SPIKY',        icon: '🌵', max: 5, desc: 'Attackers take 8 damage back.',       apply: s => s.thorns += 8 },
  vamp:     { name: 'VAMPIRE',      icon: '🧛', max: 4, desc: 'Heal for 1.5% of damage dealt.',      apply: s => s.lifesteal += 0.015 },
  dash:     { name: 'EXTRA DASH',   icon: '💨', max: 2, desc: '+1 dash charge, faster recharge.',    apply: s => { s.dashCharges += 1; s.dashCd *= 0.85; } },
  revive:   { name: 'SECOND WIND',  icon: '🪽', max: 2, desc: 'Survive one lethal hit at 60% HP.',   apply: s => s.revives += 1 }
};

const Upgrades = {
  levels: {},           // passive id -> level
  MAX_WEAPONS: 6,

  reset() { this.levels = {}; },

  passiveLevel(id) { return this.levels[id] || 0; },

  weaponSlotsFull() { return Weapons.owned.length >= this.MAX_WEAPONS; },

  _weaponCandidates() {
    const out = [];
    for (const id in WEAPONS) {
      const def = WEAPONS[id];
      const lvl = Weapons.levelOf(id);
      if (lvl === 0) {
        if (this.weaponSlotsFull()) continue;
        out.push({
          kind: 'weapon', id, def, level: 0,
          name: def.name, icon: def.icon, desc: def.desc,
          tag: 'NEW WEAPON', rarity: 'new',
          weight: 30
        });
      } else if (lvl < def.max) {
        out.push({
          kind: 'weapon', id, def, level: lvl,
          name: def.name, icon: def.icon,
          desc: def.up[lvl - 1] || '+power',
          tag: 'WEAPON', rarity: lvl >= 5 ? 'epic' : (lvl >= 3 ? 'rare' : ''),
          weight: 26
        });
      }
    }
    return out;
  },

  _passiveCandidates() {
    const out = [];
    for (const id in PASSIVES) {
      const def = PASSIVES[id];
      const lvl = this.passiveLevel(id);
      if (lvl >= def.max) continue;
      out.push({
        kind: 'passive', id, def, level: lvl,
        name: def.name, icon: def.icon, desc: def.desc,
        tag: 'PASSIVE', rarity: lvl >= 4 ? 'rare' : '',
        weight: (id === 'revive' || id === 'dash' || id === 'vamp') ? 7 : 20
      });
    }
    return out;
  },

  roll(n = 3) {
    const pool = this._weaponCandidates().concat(this._passiveCandidates());
    // luck nudges rarer / higher-level options up
    const luck = Player.stats.luck;
    for (const c of pool) {
      if (c.rarity === 'epic') c.weight *= 1 + luck * 0.25;
      else if (c.rarity === 'rare') c.weight *= 1 + luck * 0.15;
    }

    const picks = [];
    const used = new Set();
    let guard = 0;
    while (picks.length < n && pool.length && guard++ < 200) {
      const avail = pool.filter(c => !used.has(c.kind + c.id));
      if (!avail.length) break;
      const c = U.weighted(avail);
      used.add(c.kind + c.id);
      picks.push(c);
    }

    if (!picks.length) {
      picks.push({
        kind: 'bonus', id: 'gold', name: 'POCKET CHANGE', icon: '💰',
        desc: 'Nothing left to learn. Have 100 gold and 40 HP.', tag: 'BONUS', rarity: '', level: 0
      });
    }
    return picks;
  },

  apply(choice) {
    if (choice.kind === 'weapon') {
      Weapons.add(choice.id);
      const lvl = Weapons.levelOf(choice.id);
      UI.toast(choice.name + ' LV' + lvl, '#b6ff3d');
    } else if (choice.kind === 'passive') {
      this.levels[choice.id] = this.passiveLevel(choice.id) + 1;
      choice.def.apply(Player.stats);
      Player.hp = Math.min(Player.hp, Player.stats.maxHp);
      // stat changes can alter dash capacity
      Player.dashStock = Math.min(Player.stats.dashCharges, Player.dashStock + (choice.id === 'dash' ? 1 : 0));
      UI.toast(choice.name + ' LV' + this.levels[choice.id], '#3dd6ff');
    } else {
      Player.gold += 100;
      Player.heal(40);
    }
    SFX.levelup();
  },

  // summary rows for the pause screen
  statRows() {
    const s = Player.stats;
    return [
      ['Max HP', Math.round(s.maxHp)],
      ['Damage', Math.round(s.damageMul * 100) + '%'],
      ['Attack Speed', Math.round(s.attackSpeedMul * 100) + '%'],
      ['Cooldown', Math.round(s.cooldownMul * 100) + '%'],
      ['Area', Math.round(s.areaMul * 100) + '%'],
      ['Move Speed', s.moveSpeed.toFixed(1)],
      ['Crit Chance', Math.round(s.critChance * 100) + '%'],
      ['Crit Damage', Math.round(s.critMul * 100) + '%'],
      ['Armor', Math.round(s.armor)],
      ['HP Regen', s.hpRegen.toFixed(1) + '/s'],
      ['Pickup Range', s.pickupRadius.toFixed(1)],
      ['XP Gain', Math.round(s.xpMul * 100) + '%'],
      ['Gold Gain', Math.round(s.goldMul * 100) + '%'],
      ['Luck', s.luck],
      ['Dashes', s.dashCharges],
      ['Revives', s.revives]
    ];
  }
};
