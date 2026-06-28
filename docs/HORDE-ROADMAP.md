# Horde.IO — Feature Roadmap (iso-spike)

Active build: `tools/iso-spike/main.ts` (PixiJS v8, SoA sim, 1 draw-call ParticleContainer).
Branch: `mp/main` only. Performance is foundational.

This roadmap was derived from a multi-agent scout of the **legacy original**
(`legacy/public/js/`) + a map of the current iso-spike. It captures the director's
firehose: more detail/assets/variety/animation, more king mechanics, smarter AI,
jungle low-vision, hiding bushes, the **orb economy**, tiered settlements with
defense towers, new house designs.

---

## What the ORIGINAL did (the missing core loop)

Source: `legacy/public/js/utils/utils.js` + `entities/Building.js`, `Soul.js`, `Unit.js`.

- **80 building clusters**, 10–20 buildings each, 100 HP, 3 types:
  - **Barn** (50%) → drops **green soul** → spawns **+1 new vassal (L1)** for the destroyer's team.
  - **House** (30%) → drops **blue soul** → upgrades an **L1 vassal → L2**.
  - **Tower** (20%) → drops **purple soul** → upgrades an **L2 vassal → L3**.
- King death → drops **purple soul**. Vassal death → 50% chance, soul colour by level.
- Collection radius 40px. Blue only collectible by L1, purple only by L2 (gating).
- Vassal tiers: L1 40px → L2 44px → L3 48px (size scaling; HP stayed 100 in original — we improve this).
- **Towers did NOT shoot back** in the original — they were passive destructibles.
  The director wants them to fire → new feature.

The current iso-spike has only a **player-king XP** soul system (`dropSoul` L1114,
`onPlayerSoul` L1124, level cap 6) and **no buildings at all**. The recruit/upgrade
economy and settlements are entirely absent. This is the single biggest gap.

---

## Build sequence (vertical slices, each ships one playable improvement)

### Slice 1 — Settlements + Orb Economy (CORE LOOP) ★ priority 1
The heart of Horde.IO: smash buildings → orbs → grow/upgrade your horde.
- **New SoA building arrays** (`bx,by,bhp,bmaxhp,btype,bowner,balive`), parallel to units.
- **Settlement generation** at worldgen: clusters on passable land, avoid water/spawns.
  Two **tiers**: *village* (cheap billo houses, mostly barns) vs *town* (bigger, houses+towers).
- **New procedural building sprites** baked into the unit atlas decor region
  (`DECOR_SPEC` L1024 / `buildUnitAtlas` L675): barn, house, watchtower, per-look.
  Occupy terrain like trees (`blockTree`→generalized `blockCell`, 2×2/3×3 footprint).
- **Destruction → orb drop**: barn→green, house→blue, tower→purple (extend `dropSoul`).
- **Minion levels**: add `elevel` Uint8Array. Green orb collected by any minion near
  its king → recruit +1 L1. Blue → L1→L2. Purple → L2→L3. Level scales hp/dmg/scale.
- **Collection**: extend the existing magnetize/collect loop (L1692) to orbs, gated by level.
- **HUD**: show horde size + per-level breakdown.
Hooks: `dropSoul` L1114, `onPlayerSoul` L1124, `spawnE` L1142, `simTick` L1454,
`buildUnitAtlas`/`DECOR_SPEC` L675/L1024, `blockTree` L909, HUD L1776.

### Slice 2 — Defense Towers that shoot back ★ priority 2
Towns defend themselves → tactical target priority.
- Tower buildings get a fire cooldown; each sim-tick a town tower seeks the nearest
  enemy unit in range and fires a bolt (reuse `fireArrow` L1256 with a tower projectile).
- Tower owner = neutral until captured; fires on whoever is closest? → start neutral-hostile
  to all, becomes yours when you clear the town (capture flips `bowner`).
Hooks: `fireArrow` L1256, arrow update L1660, `simTick` building loop.

### Slice 3 — Bushes (stealth) + Jungle (low vision) ★ priority 3
Tactical retreat / ambush. Original had **no vision system** — built from scratch.
- **Bush decor**: a unit whose foot is inside a bush gets `ehidden=1`.
  In `findEnemy` L1171, skip targets where `ehidden && !searcherInSameBushZone`.
  In render, drop alpha of hidden enemy units not in your bush.
- **Jungle zones**: reduce `evisionRange` inside jungle terrain mask (targeting radius ×0.7).
- Add `evisionRange` Float32Array; gate `findEnemy` distance by it.
Hooks: `findEnemy` L1171, `renderUnits` L1339, `forestMask` L221 (add bush/jungle mask).

### Slice 4 — Smarter AI minions ★ priority 4
- **Threat targeting**: `findEnemy` prefers highest recent-damage source.
- **Retreat**: non-king with hp<30% and outnumbered flips to fall-back temporarily.
- **Champion flank**: type 5 approaches at an angle, not head-on.
- **AI kings use abilities**: enemy kings call `aoeDamage`/`buffHorde` when clustered/low.
- **Economy AI**: AI hordes also chase orbs / smash buildings to grow.
Hooks: `findEnemy` L1171, movement L1496, abilities L1386/1412, `simTick`.

### Slice 5 — More King mechanics ★ priority 5
- Ability **tiers unlocked by level** (refactor `ABIL` L1416 into tiered unlocks).
- **Mana pool** gating big abilities; regen over time.
- **Crown/relic pickups** (rare orb) granting permanent buffs.
- King **respawn-at-keep** option instead of instant game-over.
Hooks: `ABIL` L1416, ability triggers L1440, `playerLevel` L1010.

### Slice 6 — Visual + animation polish (ongoing, sprinkled) ★ priority 6
- More unit detail per faction (already iterating: livery overlay, pauldrons, belts).
- More animation frames (walk cycle 4→ richer, attack windup/strike/recover, death topple).
- Building **damage states** (intact/damaged/rubble), faction-flavoured architecture.
- Orb/impact particles, floating "+1"/"Level Up!" combat text (from original).
Hooks: `buildUnitAtlas` L675, POSES, `renderUnits` L1339, DECOR.

---

## Risks
- **Perf**: buildings + towers + orbs add entities. Keep them in SoA, reuse the spatial
  grid, bake all sprites into the one atlas → stay at 1 draw call. Cap orb count.
- **Atlas budget**: more sprites/frames grows the atlas texture; watch max texture size,
  spread across atlas rows.
- **Flow-field**: new building footprints must update `PASS`/flow like trees do, or units
  path into walls.
- **Determinism** (future MP): all economy/AI must run off the seeded sim, no `Math.random`
  in the sim path (FX-only randomness is fine).
