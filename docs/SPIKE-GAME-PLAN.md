# Horde.IO Iso-Spike — Game Status & Plan

`tools/iso-spike/main.ts` (PixiJS v8) is the active game prototype. It is now a **playable
Horde.IO**: an .io battle-royale where you steer a king, grow a horde from souls, and outlast
15 AI kings in a shrinking storm. Built on the max-unit engine (see docs/ENGINE-MAXUNITS-PLAN.md).
All work on branch `mp/main`. Keep BOTH `?style=cel` and `?style=bake`. `npm run typecheck` green.

## How to play
`http://localhost:5173/iso-spike.html?style=cel` → start menu (faction + difficulty) → SPIELEN.
- **WASD / arrows** move your king; the camera follows; your horde follows you.
- **Space** = dash (burst, 5s cd). **Q** = shield (-50% dmg 5s, 10s cd).
- Fight near your horde → enemies drop **souls** → walk over them: green = +vassal & king XP,
  rare **gold** = summon a **Champion**. King levels to L6 (+HP/dmg/size).
- **Power-ups** (cyan speed / red dmg / green heal / blue shield) scattered on the map.
- Stay in the **storm** circle (minimap bottom-right). Last king standing wins.
- Benchmark: `?units=N` sets army size; `+`/`-` spawn/despawn 1000; HUD shows sim/sort ms.

## Done (this rebuild, 2026-06-27)
ENGINE: SoA typed-array sim, ParticleContainer 1-draw-call render, O(n) counting-sort depth,
30Hz fixed-step + render interpolation, frustum cull (sort <1ms at 37k), O(1) passability bitmap,
adaptive findEnemy. Render is free; sim caps playable battles at ~15k units @ 60fps on a real GPU.
GAME: player-controlled king + horde-follows-king (FFA, owner-based teams) · souls growth loop ·
king leveling · faction identity (±10%) · dash + shield · power-ups · champions (gold souls) ·
storm BR (R380, x0.72/20s) · ballistic arrows · march/strike juice · minimap · start +
death/victory menus with a live preview battle · spectator camera.

## Next candidates
- More content: per-faction champion mechanics (heal-aura / long-range / AoE), walk+attack
  animation frames, towers/barracks objectives, day-night tint.
- Balance: pace king leveling under mass-death soul flood; tune army sizes vs the engine ceiling.
- Deeper sim scaling: move the sim to a Web Worker (SharedArrayBuffer double-buffer) or WebGPU
  compute for 50k–100k units (the engine's SoA layout is the migration contract).
- Determinism for multiplayer: seed the RNG (mulberry32) + fixed iteration order so the sim is
  bit-deterministic, then revisit docs/MULTIPLAYER-MASTERPLAN.md (Steam/Electron path).

## Tuning knobs
unit stats `T[]` · faction `FAC_HP/SPD/DMG` · king `XP_TO_NEXT` + per-level buffs in `onPlayerSoul`
· `DIFF[]` player-HP mults · storm `zoneR`/shrink interval+factor/`STORM_DMG` · soul drop chance
(killE 0.5) + gold chance (dropSoul 0.045) · `reqUnits` default · `ARROW_CAP`/`PUFF_CAP`/`SOUL_CAP`.
