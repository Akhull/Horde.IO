# Horde.IO — Max-Unit Engine Plan (tools/iso-spike/main.ts)

Goal (user, 2026-06-27): the engine must carry **as many units as possible at high FPS** —
then the game is balanced around big armies. Performance is the foundation, not a unit cap.
Validated by an ultracode judge-panel workflow (proposals: instanced-depthbuffer /
ParticleContainer / SoA-sim / WebGPU-compute; judges: throughput / feasibility / gameplay-fit).

## Chosen stack
- **Render: PixiJS v8 `ParticleContainer`** with a FIXED pool of draw-slots (one `Particle`
  per slot, array never reordered). Sorting is realized by *which unit's data is written into
  slot k*, not by reparenting. One texture atlas page → one draw call. Ceiling ~1M quads.
- **Depth sort: O(n) counting sort** on quantized foot screen-Y (continuous generalization of
  the old 1100-bucket scheme). Stable scatter (iterate ids in order) → no same-row flicker.
- **Sim: Structure-of-Arrays** over typed arrays (no per-unit objects, no GC), uniform spatial
  grid (flat linked list), flow-field macro-nav, 30 Hz fixed timestep + render interpolation.
- **Future (deferred, same SoA contract):** A = GPU depth-buffer instancing (reclaim sort-ms,
  exact order); D = WebGPU compute sim (100k–1M). WebGL2 B+C stays the permanent fallback.

## Why B over A first
A (instanced quad + `gl_Position.z` depth buffer) is the higher ceiling but a *binary* risk in
Pixi v8's 2D pipeline (silent wrong-order on depth misconfig, no exception). B is Pixi's
first-class public API, debuggable, render ceiling already > the 100k goal — the bottleneck
moves to the SIM long before B's renderer is the wall. Ship B+C, graduate to A/D behind the
same SoA field layout (buffer-pointer swap, not a rewrite).

## SoA fields (index i = entity id, one alloc at CAP)
kinematics x,y,vx,vy · render screenX,footY(=sort key),frame,flash,alpha,animT · combat hp,cd ·
identity team,fac,type,flags(ALIVE|KING|RANGED|DECOR|ATTACKING) · ai target(Int32, NEVER a ptr) ·
interp prevX,prevY · freelist freeStack (O(1) death/spawn, no `.filter()` compaction).

## Layer stack (siblings on `world`, back-to-front)
terrainMesh(Mesh) · soulsPC · **unitsPC** (the horde + trees/rocks as inert DECOR rows so they
iso-sort against units) · arrowsPC(rotation:true) · fxPC(puffs/orbs) · bannersPC · hpbarsPC
(32 pooled quads, no `Graphics.clear()`) · zoneG(Graphics, redraw only on radius change).
**Drop the per-frame pixelate bake RT** — atlas + NEAREST already gives crisp constant pixels.

## Arrows — make them BALLISTIC (port the original feel; current flat-instant arrows = bad)
legacy/public/js/entities/Projectile.js: z-height arc (gravity 0.15), flight time = dist/9+5
(min 20), tan trail every 50ms (cap 10), rotate to velocity, stick in ground, brown dust on
land, orange burst on hit, ±10px aim scatter.

## Milestones (each independently testable + benchmarked via built-in HUD)
- **Step 0** Benchmark HUD (rolling FPS, frame-ms, sim/sort/render split, live unit count) +
  `?units=N` knob + `+/-` spawn keys.
- **Step 1** SoA sim core (keep old Sprite render temporarily) → 10k. Seed RNG (mulberry32).
- **Step 2** ParticleContainer + counting-sort + pooled HP bars/banners/arrows/fx; delete the
  1100 buckets + pixelate bake → 20k. (proves B)
- **Step 3** Single atlas + idle/walk/attack animation + 30 Hz fixed-step interp + frustum cull
  (only on-screen units get pool slots) → 50k.
- **Step 4** Flow-field macro-nav (zone field + per-king staggered) + hot-loop tuning → 100k.
- **Step 5/6 (future)** A GPU depth buffer behind B; D WebGPU compute. Same SoA contract.

## Hard rules
SoA field layout = the migration contract (byte-compatible with eventual WebGPU storage buffer).
Never `.sort()` particleChildren (O(n) counting sort only). Atlas = one page, NEAREST, no mips,
uniform trimmed cell size (so `vertex:false` is valid). Keep `?style=bake` + `?style=cel`.
Determinism (seeded rng, fixed iteration order, fixed step) banked now — free, MP-ready.

## Then: real gameplay on top (the actual Horde.IO, see docs/SPIKE-GAME-PLAN.md + src/)
Player-controlled king (WASD + dash/shield), souls grow the horde (green=vassal, blue/purple=
level-up, gold=champion), king XP/levels, 10 AI kings, faction legendaries, towers/barracks,
difficulty, menus (faction+difficulty select, HUD, death/victory). Full content map already
exists in src/ (Phaser) + legacy/ — port the systems onto this engine.
