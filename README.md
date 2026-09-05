# 🔨 MEGABONK

A browser-based 3D survivor-roguelike in the spirit of **Megabonk** — pick a bonker, get swarmed,
auto-bonk everything, level up, and try to last 20 minutes.

No build step, no dependencies to install. Three.js is loaded from a CDN and the whole game is
plain ES5-flavoured JavaScript, so `index.html` runs straight from disk.

![gameplay](docs/gameplay.jpg)

## Play

```bash
open index.html            # macOS — works directly from file://
# or, if you prefer a server:
python3 -m http.server 8765 && open http://localhost:8765
```

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move |
| Mouse | Look (click the canvas to capture the pointer) |
| `Q` / `E` | Turn the camera without pointer lock |
| Mouse wheel | Zoom |
| `SHIFT` | Dash (i-frames while dashing) |
| `SPACE` | Jump |
| `P` / `ESC` | Pause + stat sheet |
| `1` – `3` | Pick a level-up card |
| `R` | Reroll the cards |
| `M` | Mute |

Weapons fire on their own and auto-aim at the nearest enemy. You only steer, dodge, and choose upgrades.

## The run

- **20 minutes** to survive. Enemy health, damage and spawn rate all climb with the clock.
- **7 enemy types** — chasers, sprinters, flyers, armoured chunkers, exploding poppies, ranged spitters
  and megachunks — plus gold **elites** from about 2:30 onward.
- **3 bosses** at 3:00 and every 3:30 after that: Bonkzilla, The Chonker, and Megabonk itself.
- **XP gems** level you up; every level deals you three upgrade cards. Chests deal an extra card.
- **6 weapon slots**, 8 levels each, 19 passives.

## Bonkers

| | Character | Starts with | Traits |
| --- | --- | --- | --- |
| 🔨 | **BONKER** | Bonk Hammer | 110 HP, +10% damage |
| 👟 | **ZOOMER** | Spin Stars | 80 HP, very fast, two dashes |
| 🧙 | **WIZ** | Magic Missile | 85 HP, +25% area, faster casting |
| 🪨 | **CHONK** | Anger Aura | 160 HP, armour, regen, slow |

## Weapons

`🔨 Bonk Hammer` wide melee arc · `✨ Magic Missile` homing bolts · `🌟 Spin Stars` piercing spread ·
`🔵 Bonk Orbs` orbiting damage · `⚡ Bonk Bolt` random sky strikes · `🌀 Anger Aura` damaging slow field ·
`💣 Bonk Bomb` lobbed explosives · `🪃 Bonkerang` out-and-back piercer

## Code layout

```
index.html         markup + script order
css/style.css      HUD, menus, level-up cards
js/util.js         math, value noise, weighted rolls, localStorage
js/audio.js        WebAudio synth — every sound is generated, no audio files
js/world.js        height-field terrain, instanced props, sky, arena bounds
js/fx.js           pooled damage numbers, particles, shockwaves, screen shake
js/player.js       characters, stats, movement, dash, XP
js/enemies.js      enemy types, spawn director, spatial grid, loot
js/weapons.js      weapon definitions, projectiles, orbitals
js/upgrades.js     the level-up card pool
js/ui.js           HUD + overlay rendering
js/game.js         renderer, camera, input, main loop
```

Everything that spawns repeatedly — enemies, projectiles, damage numbers, particles, pickups — is
pooled and reused. Enemy proximity queries go through a uniform spatial grid rather than scanning
the whole horde, so a 200-enemy screen costs well under a millisecond of game logic per frame.

## Notes

- Desktop only — there are no touch controls.
- Terrain height comes from a value-noise field sampled analytically, so anything that needs to sit
  on the ground shares one `World.heightAt(x, z)` function with the rendered mesh.
- Tested against three.js r128, whose UMD build works from `file://` without a module server.
