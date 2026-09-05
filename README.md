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

Graphics quality (LOW / MED / ULTRA) is on the menu and the pause screen.

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
js/gfx.js          colour pipeline, material factory, quality tiers, ground decals
js/postfx.js       HDR buffer, bloom, ACES tone map, vignette, grade
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

## Graphics

The renderer runs a proper linear-light pipeline with a hand-written post chain — no three.js
example files, so the whole game is still one CDN script plus this repo, and still opens from disk.

- **HDR scene buffer.** The scene renders into a half-float, 4× multisampled render target, so
  highlights can exceed 1.0 instead of clamping to white.
- **Bloom.** Bright-pass, then separable Gaussian blurs at half and quarter resolution, composited
  back over the scene. Emissive gems, crystals, magic bolts, lightning, the sun and the water glint
  are all authored above 1.0 specifically to catch it.
- **ACES tone mapping**, an sRGB encode, a light saturation/contrast grade and a vignette all happen
  in one composite pass. Every colour in the game is converted sRGB → linear on the way in, so the
  lighting maths is done in the space it assumes.
- **Water.** The lake is a custom shader — three summed wave trains with analytic normals, a Fresnel
  tint, a sun glint pushed past 1.0, and per-vertex baked depth that fades the surface out at the
  shoreline and draws foam on the shallows.
- **Terrain.** A value-noise height field shaded by altitude, slope and two scales of colour drift,
  with rock breaking through wherever the ground gets steep.
- **Wind.** Grass, reeds, flowers and tree canopies sway via an injected vertex-shader term, gusting
  on a second, slower wave.
- **Extras.** A painted sunset sky with a blooming sun disc, distant mountain silhouettes, drifting
  additive motes, glowing projectile trails, and soft ground blobs under every character.

Quality is chosen automatically from what the GPU reports and steps itself down if the frame rate
sags; **LOW / MED / ULTRA** are also selectable on the menu and pause screens. On low, bloom, MSAA
and shadows switch off and the render scale drops.

### Ground decals follow the terrain

Anything drawn flat on the ground — the aura ring, dash and explosion shockwaves, the blob under
each character — is a subdivided disc whose vertices are re-projected onto `World.heightAt` every
frame, rather than a flat circle. On a flat circle, a slope buries the uphill half and floats the
downhill side; measured on this map's steepest ground, a flat disc deviates from the surface by
0.68 m while the projected one tracks it to within its own 0.07 m lift. The many small enemy blobs
use a cheaper version that aligns the disc with the local ground normal.

## Notes

- Desktop only — there are no touch controls.
- Terrain height comes from a value-noise field sampled analytically, so anything that needs to sit
  on the ground shares one `World.heightAt(x, z)` function with the rendered mesh.
- Tested against three.js r128, whose UMD build works from `file://` without a module server.
