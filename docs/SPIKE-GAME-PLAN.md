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

## Progress log
- (fill in per commit)
