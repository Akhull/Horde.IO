# Horde.IO — Content Roadmap

> **This file is the Game-Director's single source of truth and memory across loop iterations.**
> The [game-director](../agents/game-director.md) agent **reads it first** (to pick the next item) and
> **updates it last** (tick done, append changelog, groom backlog) every iteration.
> Focus: **new content**. North star: a richer, fun, shippable Horde.IO. Never break the build or the fun.

## Visual style (LOCKED — all future content inherits this)
**Family: Kenney `medieval-rts`** (top-down medieval, CC0) for every game sprite — units, buildings, terrain
tiles, forest, water. **`particle-pack`** (CC0) supplies the near-white tint bases for souls/power-ups/particles
only. Arrow + slash are PROCEDURAL (no asset in the pack; generated white in `BootScene`). There is **no
sprite-sheet animation system** anymore — units are static chips; "juice" comes from engine tweens (bob, level-up
pop, death tip-over, slash swipe). Faction colors are **baked into the unit chips** (human=blue, elf=green,
orc=grey) → never tint units. Asset paths live in `BootScene.preload` (Retina/128px source). New units/buildings
MUST pull from `medieval-rts` and keep this language; new pickups reuse the `orb`/`powerup` tint bases.

## Current state (as of seed, commit 4d34913)
3 unit types (king / vassal L1–L3 / archer) · 2 abilities (dash, shield) · **6 power-ups (speed, shield, damage, armor, lifesteal, regen)** ·
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
- [ ] **Power-up variety pass** — vision reveal. *(lifesteal + regen + steady/knockback-resist shipped, see changelog.)*

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
- 2026-06-26 — art: FULL sprite migration to Kenney medieval-rts (+ particle-pack for pickups/particles). Threw out
  EVERY old game sprite and the entire LPC sprite-sheet/animation system — no half-migration. REPLACED: 12 unit
  textures (3 factions × king/l1/l2/l3, faction color baked in, no tint), barn/house/tower, grass/water/forest
  tiles, soul orb + power-up + particle bases. Power-ups went from bare Phaser circles → tinted `powerup` glow;
  water went from a flat blue rect → tiled `water` sprite. Arrow + slash kept PROCEDURAL (no pack equivalent),
  generated white in `BootScene.create`. DELETED `src/systems/animations.ts`; stripped `spriteConfig.ts` to just
  `ORB_TINT` (REAL_SHEETS/DEMO/USE_DEMO/FACTION_TINT/Sheet types all gone); `Unit.ts` converted to static sprites
  (dropped playAnim/updateAnimationState/sheet fields; death = tip-over+fade tween, juice via existing bob +
  level-up pop + slash). Fixed a stray old-asset reference in `screens.ts` (faction-card king preview). Style is
  now LOCKED in the roadmap header so all future content inherits it. — verified: typecheck + 21 vitest + vite
  build all green; lint clean on the changed src files; dead-reference grep (resolveUnitSheet/animKey/REAL_SHEETS/
  DEMO_SHEET/USE_DEMO_SPRITES/FACTION_TINT/preloadSheets/setupAnimations/old asset folders) = ZERO hits; full
  render-path audit confirms every requested texture key (static + dynamic spriteKey `${faction}_l{1,2,3}` +
  buildingType) resolves to a loaded asset; chip/world montages confirmed 3-faction/4-role distinction + building/
  terrain coherence. (No live browser MCP this session — verified via build + static render audit + montages.) — d2e99d9.
- 2026-06-26 — fix: steady review findings — steady war für den SPIELER-König wirkungslos: der Spieler nimmt per Design KEINEN Rückstoß (takeDamage schließt ihn aus, Zeile 483), also griff der einzige Effekt des Power-Ups (Knockback-Resist) bei ihm nie — ein aufgesammelter steady-Orb (1/7 Spawn-Chance) war ein verschwendeter Slot ohne Nutzen, im Gegensatz zu allen 6 übrigen Power-Ups. Fix (Reviewer-Option B, echter Spieler-Nutzen statt Entfernen): steady gibt ZUSÄTZLICH einen Bewegungs-Bonus (POWERUP.steadyMoveFactor=1.1, +10%) über den neuen read-time Getter moveSpeedFactor, eingezogen am EINZIGEN Bewegungs-Schritt (this.speed × moveSpeedFactor in update()). Greift für Spieler UND KI; mutiert keinen Basiswert (read-time gelesen wie damageBoostMult im Schadenspfad, statt this.speed zu ändern wie der Speed-Orb) → kein State-Leak, stapelt sauber MULTIPLIKATIV mit dem Speed-Orb (1.5 × 1.1). Knockback-Resist bleibt unverändert für alle Einheiten, die Rückstoß nehmen. "standfest" = momentumstark unterwegs — ein kohärentes Power-Up (Anti-CC + Momentum), echter Vorteil für jeden Träger. Code-Kommentare (Feld-Doc, applySteady, neuer Getter) auf den Dual-Effekt aktualisiert. Spawn bleibt 7-way (steady nicht entfernt). — verified typecheck + 21 vitest tests + vite build all green; lint clean on the 2 changed src files (pre-existing tools/ + src/ui/ + src/main.ts are the user's untouched in-flight work) — 9a7f759.
- 2026-06-26 — feat: steady power-up ("steady", ANTI-CC/defensiv: reduziert eingehenden Rückstoß-Impuls auf POWERUP.knockbackResistFactor=0.2 -> nur 20% des Knockbacks bleiben, 6 s; mirrors regen-Lifecycle — steadyTimer + idempotentes applySteady + tickSteady in updateKing für Spieler UND KI-König). Hook: takeDamage, im FEEDBACK.knockback/kingKnockbackFactor-Pfad. Interaktion: MULTIPLIKATIV zum kingKnockbackFactor (ersetzt ihn NICHT) — ein König mit Steady steht nahezu fest (0.25 × 0.2 = 0.05). Öffentlicher knockbackResistFactor-Getter (1 inaktiv, 0.2 aktiv) liefert den Faktor; tickSteady setzt keinen Faktor zurück (Timer steuert alles, wie beim Regen). Scope bewusst auf takeDamage begrenzt — Berserker-AoE-Knockback (applyBerserkerAoE) bleibt unangetastet (nur Könige sammeln Power-Ups, takeDamage ist deren Haupt-Knockback-Pfad). Erdbraun-/Stein-Orb 0x8b5a2b (klar von allen 6 übrigen Orbs getrennt); even 7-way spawn split (~1/7 je); erdbrauner Staub-Funkenausbruch bei Aufnahme. — verified typecheck + 21 vitest tests + vite build all green; lint clean on the 6 changed src files (pre-existing tools/ + src/ui/ + src/main.ts are the user's untouched in-flight work) — 31ad13b.
- 2026-06-26 — fix: regen review findings — POWERUP.regenPerSecond 12 → 10 hp/s. Adversarial review flagged that 12 hp/s + lifesteal (0.35× dmg) + armor together reach sustain/incoming-damage PARITY in symmetrical king-vs-king combat, enabling unintended endless-stalemate fights. 10 hp/s keeps ~20% pool healing over 6 s (60 HP, still meaningful) while breaking parity: total sustain ~26.8 dps vs ~28.8 dps incoming (post-armor) → net −2 dps, so engaged fights still resolve. Pure config/comment change; comment math updated (12→10, ~72→~60 HP, 24%→20%, parity rationale documented). — verified typecheck + 21 vitest tests + vite build all green; lint clean on the changed config file (pre-existing tools/ + src/ui/ + src/main.ts are the user's in-flight work, untouched) — b5963b3. ("regen", PASSIVE heal-over-time: holder regenerates POWERUP.regenPerSecond=12 hp/s, time-based via deltaSeconds=deltaTime/1000, CLAMPED to faction-scaled maxHp / 6 s -> ~72 HP ≈ 24% of a king's 300-HP pool). Mirrors the existing boost lifecycle: idempotent applyRegen (timer-only, no stacking) + tickRegen in updateKing (ticks for player AND AI king, heals per frame + counts the timer down). Unlike lifesteal it heals ALWAYS (even while fleeing), not only on hit. Emerald orb 0x2ecc71 (deliberately muted vs the bright soul-green 0x00ff00 and distinct from the gold speed orb); even 6-way spawn split (~1/6 each); green-ish particle burst on collection. Deltaime convention matched to the existing tick* methods (ms timers). — verified typecheck + 21 vitest tests + vite build all green; lint clean on the 6 changed src files (pre-existing tools/ + src/ui/ are the user's untouched in-flight work) — 9d7f335.
- 2026-06-26 — fix: lifesteal review findings — (1) Berserker AoE splash now credits lifesteal per confirmed splash hit (applyLifestealHeal(splash) in applyBerserkerAoE), symmetric to the main melee hit; (2) arrow lifesteal moved from fire-time to confirmed IMPACT — Projectile now carries an optional ProjectileAttacker and calls creditLifestealOnHit(damage) inside the existing !target.dead guard, so the archer no longer heals for arrows that never land (target dies/dodges). updateArcher passes `this` to spawnProjectile; the premature fire-time heal is removed. — verified typecheck + 21 vitest tests + vite build all green; lint clean on the 3 changed src files (pre-existing tools/ lint errors are the user's in-flight untracked work, untouched) — 14a2d05.
- 2026-06-26 — feat: lifesteal power-up ("lifesteal", offensive sustain: holder heals POWERUP.lifestealFactor=0.35 of damage DEALT, melee + arrows, clamped to maxHp / 6 s; mirrors damage-boost lifecycle — lifestealTimer + applyLifesteal + tickLifesteal in updateKing, applyLifestealHeal hooked in executeAttack melee path AND updateArcher arrow-fire path; crimson 0xb00020 orb, even 5-way spawn split). Note: only kings collect power-ups + kings are melee, so the arrow hook is dormant-but-correct for any future archer holder. — verified typecheck + 21 vitest tests + vite build all green; lint clean on changed files (pre-existing tools/ lint errors are the user's in-flight untracked work, untouched) — 955fafd.
- 2026-06-26 — feat: armor power-up ("armor", −40% incoming damage / 6 s, mirrors damage-boost lifecycle; applies in takeDamage + zone damage, stacks multiplicatively with shield zone-halving 0.5×0.6; steel blue-grey orb, even 4-way spawn split) — verified typecheck + 21 vitest tests + vite build all green — 4f10237.
- 2026-06-26 — feat: damage-boost power-up ("damage", x1.5 attack / 6 s, mirrors speed-boost lifecycle; red-orange orb, even 3-way spawn split) — verified typecheck + 21 vitest tests + vite build all green — 78a0495.
- 2026-06-26 — feat: FACTION_STATS faction identity (±10% hp/speed/damage) wired per unit — typecheck green — be32273 (user-committed alongside the LEGENDARY champion system).
- 2026-06-26 — chore: gates repaired so the loop can self-verify — vitest ^4→^3 (vite 5 compat, 21 tests green) + vite build.assetsDir=static (build green) — be32273.
