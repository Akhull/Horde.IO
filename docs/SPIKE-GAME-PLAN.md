# Horde.IO Iso-Spike — Autonomous Build Plan (overnight)

Goal: grow `tools/iso-spike/main.ts` from a tech demo into a juicy horde-battle prototype
with **custom self-built assets**, **distinct factions**, **varied unit types**, and visual
punch. The spike is the active game prototype (see memory `spike-is-game-prototype`).

Rules every iteration: keep BOTH `?style=bake` and `?style=cel`; `npm run typecheck` green;
one coherent commit per milestone (conventional commits, ASCII messages via `git commit -m`/`-F`);
verify visuals via Playwright but IGNORE its FPS (software WebGL ~1fps; real GPU 60-120).
Prefer PROVEN techniques (memory `use-proven-techniques`); use ultracode workflows for design.

## M1 — Custom procedural pixel-art units + faction identity  ← START HERE
- Procedural unit-sprite generator (runtime canvas pixel-art): parts (legs/torso/head/weapon/
  shield) composed from a faction PALETTE + a unit-TYPE silhouette. Nearest-filtered textures.
- 3 factions, distinct palettes: Humans (steel-blue + peach skin), Elves (emerald + pale skin),
  Orcs (crimson/iron + green skin).
- Unit types with stats: Warrior (melee), Archer (ranged), Spearman (reach), Brute (heavy/slow),
  King (leader). Each: hp/atk/range/speed/cooldown/scale.
- Hordes spawn a MIX of types (e.g. 55% warrior, 18% archer, 15% spear, 11% brute, 1 king).

## M2 — Combat depth
- Ranged attacks: archers fire PROJECTILES (arrow) that travel + deal damage on impact; kite a bit.
- Per-type attack range; hit sparks; death effect (poof / faction-colored splat).
- King health pips or subtle HP feedback.

## M3 — Faction flavor & battlefield
- Faction banner near each king; faint faction-tinted ground at spawn.
- Corpses/scorch decals that linger and fade; battlefield reads the fight history.

## M4 — Army feel (formations)
- Boids-lite separation so units fan into a FRONT instead of piling on one point.
- Kings lead; vassals loosely cohere then engage.

## M5 — Round flow
- Victory banner -> short pause -> auto-restart with a fresh world/seed. Storm tuning.

## M6 — Visual polish
- Movement dust, hit sparks, storm-edge shimmer; subtle day tint; tree/rock variety.

## M7 — Foundation toward multiplayer (later)
- Make the spike combat deterministic (seeded mulberry32 Rng, fixed-timestep accumulator),
  split sim from render. Then revisit `docs/MULTIPLAYER-MASTERPLAN.md`.

## Progress log (overnight 2026-06-27)
- DONE M1 — custom procedural pixel-art units (palette-swap + layered parts), 3 factions x 5 types,
  faction palettes + per-type silhouettes (b818205). 5 types w/ stats + ranged combat (1d4a48c).
- DONE M2 (partial) — ranged archers fire arrow projectiles (1d4a48c); faction-colored death puffs (8a2639e).
  TODO: hit sparks, king HP pips.
- DONE M3 (partial) — faction banners over kings (9f1e9ec). TODO: territory tint, lingering corpses.
- DONE M4 — boids-style separation so hordes form a blob/front not a point-pile (dfd815a).
- DONE M5 — round flow: auto-restart a fresh battle 5s after victory (24e7d14).
- TODO M6 — movement dust, hit sparks, storm-edge shimmer, tree/rock variety, day tint.
- TODO M7 — deterministic sim (seeded Rng, fixed-timestep), split sim/render, then MULTIPLAYER-MASTERPLAN.
- Earlier same session: emergent rivers (f0ce37e), zoom-stable pixelate (a9a4998), river tuning (af9656e),
  horde combat (e3c3f63), storm zone (05f5cb1).

Next pickup: M6 polish (hit sparks + movement dust are cheap juice), or M7 determinism if shifting toward MP.
Tuning knobs if needed: unit scales in T[] (currently 1.45-2.7 for 24x28 sprites), RIVER_THRESH 0.12,
storm phase 14s / shrink 0.66, separation 0.7.
