Build **MEGABONK**, a 3D survivor-roguelike that runs in a web browser.

## Hard constraints

- Vanilla JavaScript. No build step, no bundler, no npm, no framework.
- three.js **r128**, loaded from `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`.
  Use r128 specifically: it is the last release shipping a UMD (non-module) build, which is what
  lets `index.html` open straight from `file://` with no server. Do not upgrade the version.
- No asset files at all. Every texture, sound and model is generated at runtime — value noise into
  canvases for textures, WebAudio oscillators for sound, box/cone/cylinder primitives for models.
- Must hold 60fps with ~250 enemies on screen on a laptop GPU.
- Desktop only; no touch controls.

## The game

A Vampire-Survivors-style run in 3D, third person, comedic tone. Survive 20 minutes.

- **Movement**: WASD relative to camera, mouse look via pointer lock, SHIFT dash (with i-frames),
  SPACE jump, P/ESC pause, 1–3 to pick a level-up card, R to reroll, M to mute.
- **Weapons fire themselves and auto-aim at the nearest enemy.** The player only steers, dodges and
  chooses upgrades. This auto-aim is essential — without it melee weapons feel broken while kiting.
- **4 characters** with distinct stats and a starting weapon: a balanced hammer bruiser, a fast
  glass-cannon with two dashes, a mage with bigger/faster spells, and a slow armored tank with a
  damage aura.
- **8 weapons**, 8 levels each, 6 equip slots: wide melee arc, homing bolts, piercing spread,
  orbiting orbs, random sky strikes, a damaging slow-field aura, lobbed explosives, and an
  out-and-back piercing boomerang.
- **19 passives**: damage, attack speed, cooldown, area, projectile speed, max HP, regen, armor,
  crit chance, crit damage, move speed, pickup radius, XP gain, gold gain, luck, thorns, lifesteal,
  extra dash, revive.
- **Level-ups** deal 3 cards from a weighted pool and pause the game. Chests deal an extra card.
- **7 enemy types** unlocking over time: chaser, sprinter, flyer, armored tank, exploder, ranged
  spitter, heavy brute. Plus gold "elite" variants and **3 timed bosses**.
- **Drops**: XP gems, gold, hearts, chests. A magnet radius pulls them in.

## Architecture

Single-responsibility files loaded as classic scripts in dependency order:

`util` (math, value noise, weighted rolls, localStorage) → `gfx` (colour pipeline, material
factory, procedural textures, quality tiers, ground decals) → `postfx` (the post chain) → `audio` →
`world` (terrain, water, sky, scenery, collision) → `fx` (damage numbers, particles, shockwaves) →
`player` → `enemies` (+ loot) → `weapons` → `upgrades` → `ui` → `game` (renderer, camera, loop).

**One rule matters more than any other: terrain height comes from a single analytic function
`World.heightAt(x, z)`.** The rendered mesh, every entity that stands on the ground, every ground
decal, prop placement, collision, and the water's baked depth all sample that one function. When
you change the terrain, everything follows automatically. Do not duplicate the height logic.

## Rendering

Run a **linear-light PBR pipeline** with a hand-written post chain (do not pull in three's example
files — the game must stay one CDN script plus your own code):

- All materials are `MeshStandardMaterial` lit by an environment map you generate: paint an
  equirectangular sky gradient into a canvas, run it through `PMREMGenerator`, assign to
  `scene.environment`.
- **Every authored sRGB hex must be converted to linear on the way in** (`new THREE.Color(hex)
  .convertSRGBToLinear()`). Funnel all material creation and runtime colour changes through one
  helper so this can't be forgotten.
- Render the scene into a **half-float, 4× multisampled** render target so highlights exceed 1.0.
- Post chain: bright pass → separable Gaussian blur at half and quarter resolution → composite that
  adds bloom, applies ACES tone mapping, a light saturation/contrast grade, a vignette, and the
  sRGB encode. Tone mapping and the sRGB encode happen **once**, at the end.
- Anything meant to glow (gems, crystals, magic bolts, lightning, the sun, water glint) is authored
  above 1.0 so the bright pass has something real to work with.
- **Sun shafts**: smear the bright pass radially outward from the sun's projected screen position.
  Keep the sun low, near the horizon, or it never enters frame at gameplay camera angles.
- **Procedural surfaces**: generate ground/bark/stone albedo from value noise into canvases, derive
  normal maps with a Sobel pass.
- **Contact AO**: real SSAO needs a depth prepass over the whole horde every frame. Instead bake
  darkening around every solid prop into the terrain's vertex colours at load. Free at runtime and
  it seats scenery into the ground.
- **Wind**: sway grass, reeds, flowers and canopies via a vertex-shader term injected with
  `onBeforeCompile`, gusting on a second slower wave.
- Scenery is `InstancedMesh` with per-instance colour variation (drift hue as well as brightness,
  or a thousand copies read as a repeated stamp).
- **Quality tiers** (low/medium/ultra) chosen from `WEBGL_debug_renderer_info`, auto-stepping down
  on sustained low frame rate, plus a manual selector in the menu and pause screen.

## World

- Terrain from a value-noise height field, shaded by altitude, slope and two scales of colour
  drift, with rock breaking through where it gets steep.
- A **lake** with a deliberate basin profile: flat floor out to ~¾ of the radius, then a steep
  shelf climbing to a rim just above the waterline, then eased into the surrounding land. Do **not**
  make the basin by smoothstep-blending terrain toward a low point — that produces a shallow cone
  whose middle is the only part under water, leaving a huge dry crater ringing a puddle.
- **Swimmable water.** Past ~0.5m depth the player and every non-flyer float at the surface at
  about half speed, unable to jump properly out of deep water. Flyers ignore it. The lake becomes a
  tactical slow lane.
- **Define the wave function once and use it twice**: the vertex shader displaces the surface with
  it, and JavaScript evaluates the identical sum so swimmers ride the real waves. Emit the GLSL
  from the same JS table so the two can never drift apart.
- Water shader: travelling waves with analytic normals, several layers of scrolling procedural
  ripple normals, Fresnel-weighted sky reflection, a sun glint pushed past 1.0, whitecaps on real
  crests only, a lapping foam line at the shore, and per-vertex baked depth so shallows stay
  see-through while deep water goes opaque.

## Collision

Scenery is drawn with `InstancedMesh`, so there is nothing to raycast. Register an upright cylinder
collider **in the same loop that places each visual**, so collision always matches what is drawn at
any prop density. Index them into a uniform grid.

- Colliders carry a height, so they behave the way they look: you can jump a knee-high boulder but
  not a pine, and flyers clear rocks while still weaving between trunks.
- Blocked movers **slide** along an obstacle rather than sticking; the horde steps around trees
  along whichever tangent points at the player.
- Bosses ignore scenery and flatten it. Shots stop at the first trunk (a boomerang turns for home).
- Ankle-height scenery — grass, ferns, flowers, mushrooms — stays walk-through. Tripping on it
  feels awful in a horde game.
- **Camera**: pull it in toward the player along the view ray when something blocks the view, and
  register canopy volumes as camera-only occluders. Push it clear of solid geometry as a last
  resort so it can never sit inside a trunk. Keep a generous minimum distance — in dense woods
  something is nearly always clipping, and a hard pull-in is worse than briefly seeing leaves.

## Performance

Pool everything that spawns repeatedly: enemies, projectiles, damage numbers, particles, pickups.
Route enemy proximity queries through a uniform spatial grid rather than scanning the horde. Avoid
per-frame allocation in hot paths (return scratch vectors from helpers called once per enemy).

## Balance

Enemy health, damage, speed and spawn rate all climb with the clock. Include a **cubic health term
late**, or once weapons are maxed around 10 minutes the player trivially outscales the horde and
takes no damage for the rest of the run. Tune so a competent player is genuinely threatened in the
back half without the first boss being a wall.

## Gotchas that will cost you hours

These are all real, and most produce silent failures:

1. **`InstancedMesh` in r128 derives its bounding sphere from the base geometry at the group
   origin.** Instanced scenery vanishes as soon as the origin leaves the view. Set
   `frustumCulled = false`.
2. **Three's `<fog_vertex>` chunk expands to `fogDepth = -mvPosition.z`.** In a custom
   `ShaderMaterial` your view-space position must be named exactly `mvPosition` or the shader
   silently fails to compile and the mesh never draws — with the error only in the console.
3. **`AdditiveBlending` only takes effect on a material also flagged `transparent`.**
4. **`renderer.setPixelRatio` does not resize the drawing buffer.** Call `setSize` again or the
   quality tier has no effect on fill cost.
5. **Setting `material.needsUpdate` forces a shader recompile** costing tens of milliseconds. It
   will ruin any benchmark that toggles it. Call `renderer.compile` once up front and measure only
   steady state.
6. **Colour management**: r128 has none. Setting `outputEncoding = sRGBEncoding` while feeding it
   sRGB-authored colours double-gammas everything into washed-out pastel. Either convert colours to
   linear on input (correct), or leave the encoding alone.
7. **Plain value noise does not wrap**, so a texture built from it shows a hard seam at every tile
   edge — a visible grid across the ground. Write a lattice-wrapping variant and use integer octave
   periods.
8. **Geometry is centred on its origin.** When placing a prop, raise it by half its *scaled* height,
   not by a hand-picked constant, or every tree hovers above the ground.
9. **Submersion depth must scale with the body.** A single depth tuned for the player puts small
   enemies entirely under the surface, so the horde looks like it is walking along the lake bed.
10. **A flat circle laid on rolling terrain buries its uphill half.** Ground decals (auras,
    shockwaves, character blobs) must be subdivided discs re-projected onto the height field each
    frame, or at minimum aligned to the local ground normal.
11. **Keep every derived system reading the same gate.** If the water mesh bakes depth differently
    from the swim logic, water appears over unrelated low ground and gets sliced off at the plane's
    straight edge.
12. **Version-stamp local scripts** (`?v=…`) and bump on change. Otherwise a returning player loads
    a new `game.js` against a cached older file and the game breaks on startup.
13. **Fine normal maps alias into white streaks at grazing angles.** Fade detail normals out with
    camera distance or your lake will look like rapids.

## How to verify

Do not eyeball it. Drive the simulation headlessly by stepping the update functions directly with a
fixed timestep — a browser tab throttles `requestAnimationFrame` when backgrounded, so a real-time
loop is useless for testing. Then **measure**:

- Run full 20-minute sessions for each character and assert zero JS errors.
- Check geometry and texture counts are flat across two consecutive runs to prove pooling holds.
- Assert the player stops at exactly obstacle radius + body radius, and that no enemy ends a frame
  inside a prop over hundreds of frames.
- Read instance matrices back and assert each prop's lowest point sits at or just below the ground.
- Measure swimmers against the *local wave surface*, not the flat water level, and assert a steady
  fraction of each body stays above it.
- Benchmark milliseconds per frame at the enemy cap on every quality tier.
- Watch the browser console for shader link errors — they do not throw.

Build it in this order: renderer and terrain first, then the player and camera, then enemies and
weapons, then the upgrade/level-up loop, then UI, then the graphics pass, then collision and water,
and balance last against a scripted bot that kites and collects XP.
