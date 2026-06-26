# Horde.IO — Content Roadmap

> **This file is the Game-Director's single source of truth and memory across loop iterations.**
> The [game-director](../agents/game-director.md) agent **reads it first** (to pick the next item) and
> **updates it last** (tick done, append changelog, groom backlog) every iteration.
> Focus: **new content**. North star: a richer, fun, shippable Horde.IO. Never break the build or the fun.

## Current state (as of seed, commit 4d34913)
3 unit types (king / vassal L1–L3 / archer) · 2 abilities (dash, shield) · **2 power-ups (speed, shield)** ·
3 buildings (barn, house, tower) · 3 souls (green/blue/purple) · **3 factions cosmetic-only** ·
2 obstacles (forest, water) · 1 mode (battle royale) · 4 difficulties · 3 AI personalities.

---

## Backlog (prioritized — top = next up)

### P1 — high value, fits one iteration
- [x] **Faction gameplay identity** — `FACTION_STATS` (±10% hp/speed/damage: Elf fast/fragile, Orc tanky/hard,
      Human reference) applied per unit in the Unit constructor. Shipped in `be32273` alongside the user's
      `LEGENDARY` champion system (Paladin/Erzschütze/Berserker) — the two layers complement each other.
- [x] **Damage-boost power-up** (`"damage"`) — temporary x1.5 attack multiplier (6 s), mirrors the speed-boost
      lifecycle (timer + multiplier, tick-to-decay in `updateKing`, applied in `meleeDamage` + archer arrow path,
      ON TOP of `factionDamageMod`). Red-orange orb; spawn split is now even 3-way speed/shield/damage. Shipped 78a0495.
- [ ] **HUD: vassal count + kill feed** — surface info the sim already computes (vassal count, kill events) in
      `HUDScene`. Low effort, high readability win. *(phaser-dev.)*
- [x] **Armor power-up** (`"armor"`) — defensive counterpart to the damage boost. Temporary −40% incoming-damage
      (`armorMultiplier 0.6`, 6 s), mirrors the boost lifecycle (`armorTimer` + `armorMult`, idempotent
      `applyArmorBoost`, tick-to-decay in `updateKing`). Applied in `takeDamage` (combat) and `applySafeZoneDamage`
      (zone, via public `armorDamageFactor` getter). Stacks MULTIPLICATIVELY with the shield's zone-halving
      (0.5 × 0.6 = 0.3) — two distinct defensive layers, no double-dip. Steel blue-grey orb; spawn split now even
      4-way speed/shield/damage/armor. Shipped 4f10237.

### P2 — valuable, may need a small split
- [ ] **New building type** — e.g. Barracks (periodically spawns a neutral unit) or Cathedral (small heal aura).
      Adds map-objective variety beyond "wall of HP that drops a soul".
- [ ] **New obstacle: slow terrain** (swamp) — passable but halves speed; first non-binary terrain.
- [ ] **King progression** — king levels from souls (size/damage/speed buff, capped), distinct from the vassal horde.
- [ ] **Power-up variety pass** — vision reveal, knockback resist. *(lifesteal shipped, see changelog.)*

### P3 — epics (split before taking; some need a NEEDS DECISION)
- [ ] **New game mode** beyond battle royale (Horde Defense vs. waves / King-of-the-Hill). → see NEEDS DECISION.
- [ ] **AI adaptation** — kings that adjust to how the player fights (currently stateless per frame).
- [ ] **Audio/theme pass** — faction-themed ambience, end-game music phase.

---

## NEEDS DECISION (user resolves — director must not guess)
- **Second game mode**: which one first — Horde Defense (PvE waves), King-of-the-Hill (hold center), or something
  else? Changes scene architecture, so it waits for a direction call.

---

## Changelog (append-only, newest first)
<!-- Director appends: `- YYYY-MM-DD — feat: <slice> — verified <how> — <commit>` -->
- 2026-06-26 — feat: lifesteal power-up ("lifesteal", offensive sustain: holder heals POWERUP.lifestealFactor=0.35 of damage DEALT, melee + arrows, clamped to maxHp / 6 s; mirrors damage-boost lifecycle — lifestealTimer + applyLifesteal + tickLifesteal in updateKing, applyLifestealHeal hooked in executeAttack melee path AND updateArcher arrow-fire path; crimson 0xb00020 orb, even 5-way spawn split). Note: only kings collect power-ups + kings are melee, so the arrow hook is dormant-but-correct for any future archer holder. — verified typecheck + 21 vitest tests + vite build all green; lint clean on changed files (pre-existing tools/ lint errors are the user's in-flight untracked work, untouched) — 955fafd.
- 2026-06-26 — feat: armor power-up ("armor", −40% incoming damage / 6 s, mirrors damage-boost lifecycle; applies in takeDamage + zone damage, stacks multiplicatively with shield zone-halving 0.5×0.6; steel blue-grey orb, even 4-way spawn split) — verified typecheck + 21 vitest tests + vite build all green — 4f10237.
- 2026-06-26 — feat: damage-boost power-up ("damage", x1.5 attack / 6 s, mirrors speed-boost lifecycle; red-orange orb, even 3-way spawn split) — verified typecheck + 21 vitest tests + vite build all green — 78a0495.
- 2026-06-26 — feat: FACTION_STATS faction identity (±10% hp/speed/damage) wired per unit — typecheck green — be32273 (user-committed alongside the LEGENDARY champion system).
- 2026-06-26 — chore: gates repaired so the loop can self-verify — vitest ^4→^3 (vite 5 compat, 21 tests green) + vite build.assetsDir=static (build green) — be32273.
