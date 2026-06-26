# Horde.IO — Architektur- & Multiplayer-Readiness-Report

*Lebende Architektur-Referenz. Stand: 2026-06-26. Basis: 8 Subsystem-Maps (paralleler Code-Read der gesamten `src/` + `legacy/server/`) + verifizierte Quell-Stichproben (`GameScene.update` Zeile 538–601, `dt = Math.min(delta, 100)` Zeile 549, `Unit.ts` 1191 Zeilen, `GameScene.ts` 802 Zeilen).*

---

## 1. Architektur-Überblick

Horde.IO ist ein top-down Battle-Royale-Horde-Survival-.io-Spiel (TypeScript + Phaser 3 + Vite). Die Codebasis ist in fünf Schichten gegliedert, mit einer bewusst „Phaser-leichten" Mitte:

| Schicht | Pfade | Phaser-Kopplung | Rolle |
|---|---|---|---|
| **Config/Data** | `config/gameConfig.ts`, `config/spriteConfig.ts`, `types.ts` | keine | `as const` Konstanten (gameplay-autoritativ + rein visuell), Kern-Uniontypen, Geometrie (`Box`, `SafeZoneCircle`) |
| **Entities** | `entities/*` (`Entity`, `Unit`, `Building`, `Projectile`, `Soul`, `PowerUp`, `Obstacle`, `Forest`) | schwer | Typisierte Spielobjekte mit eigener Logik *und* eigenen Phaser-GameObjects |
| **Systems** | `systems/*` (`SpatialGrid`, `collision`, `SafeZone`, `AI`, `worldgen`, `gameplay`, `combat`, `towerTargeting`, `kingProgression`, `difficulty`, `cameraFeel`, `decor`, `SoundManager`) | gemischt | Simulationslogik, größtenteils Phaser-frei in der Mathematik |
| **Scenes/Render** | `scenes/BootScene.ts`, `scenes/GameScene.ts` | schwer | Asset-Load + Texturegen (Boot); autoritative Welt + Haupt-Loop (Game) |
| **UI** | `ui/*` (`bus`, `controller`, `hud`, `screens`, `dom`, `index`, `perfOverlay`) | gemischt | Framework-freies DOM-Overlay (Menüs, HUD, Minimap), lokaler Input |

**Abhängigkeitsrichtung:** `config/types` ← `systems` ← `entities` ← `scenes` → `ui` (über einen schmalen Bus). Die Entities rufen Phaser-freie Logik in `systems/AI.ts` und `systems/kingProgression.ts` auf (Logik/View-Trennung im Kleinen bereits vorhanden). Die UI ist über zwei schmale Grenzen vollständig entkoppelt: einen **typisierten Event-Bus** (Engine → UI: `bus.ts`) und einen **Controller** (UI → Engine: `controller.ts`), plus einen geteilten `gameRef`-Pointer und Phasers `registry` als Input-Kanal.

**Migrationsstand:**
- **Phaser-Scenes → DOM-UI**: praktisch abgeschlossen. Alle Menüs/HUD/Pause sind HTML (`src/ui/`), nicht Phaser. `main.ts` reicht die Engine an `setGame`/`initUI` weiter.
- **miniplex ECS**: nur als Abhängigkeit (`miniplex ^2`) und **ausschließlich im Benchmark** (`tools/bench/ecs.ts`) genutzt. Der Produktiv-Hot-Path ist weiterhin OOP (`Unit`-Klasse, ~70 Felder). Der Benchmark-Verdict (`RESULTS.md`): ECS gewinnt nur ~1.06–1.21x, weil die geteilte `SpatialGrid`-Broadphase dominiert — **kein Treiber für eine ECS-Migration**.
- **Legacy-Multiplayer** (`legacy/`): eigenständiger, alter Stack (hand-rolled Canvas-2D, Socket.IO-Relay). **Nicht Phaser**, nicht Teil des aktuellen Spiels, dient nur als Vorlage/Antimuster.

---

## 2. Game-Loop & Datenfluss

Es gibt **eine** treibende Schleife: `GameScene.update(_time, delta)` (Zeile 538). Verifizierte Reihenfolge:

```
538  update(_time, delta):
539    if gameOver: return                          // Early-Return #1
543    if hitStopTimer > 0:                          // Early-Return #2 (Sim eingefroren)
544       hitStopTimer -= delta; followCamera(delta); return   // ← nutzt RAW delta, nicht dt!
549    dt = Math.min(delta, 100)                      // CLAMP, kein Fixed-Step

     — AUTORITATIVE SIMULATION —
551    readInput()                                    // Tastatur + Mobile-Joystick (registry)
552    updateTime(dt); 553 gameTime += dt             // timeOfDay += dt/60000 (kosmetisch)
554    updateFormations(dt)
556    for u of units: u.update(dt, this)             // AI, Movement, Combat, Abilities
557    updateTowers(this, dt); 558 updateBarracks(this, dt)
560    projectiles[].update(dt) + expiry-cull (splice)
568    resolveUnitUnitCollisions / 569 Building / 570 Obstacle
572    safeZone.update(dt); 573 applySafeZoneDamage(this, dt)
574    handlePowerUps; 575 applySoulMagnetism(dt); 576 handleSouls; 577 handleBuildings
578    removeDeadUnits(this)                          // ← KILL-SEAM (hp<=0 → splice/soul-drop)
579    applySeparationForce(this)                     // separat NACH removeDeadUnits
581    checkGameOver(); 582 if gameOver: return       // Early-Return #3

     — CLIENT-ONLY PRESENTATION (ab hier nichts mehr autoritativ) —
584    updateParticles(dt); 585 updateBattleShake(dt)
586    updateWarVolume()                              // liest game.loop.delta (2. Zeitquelle!)
587    updateDamageVignette(dt)
591    for u of units: u.sync()                       // Logik → Phaser-Sprites
595    projectiles.sync(); 596 buildings.sync()
598    followCamera(dt); 599 drawSafeZone(); 600 drawParticles()
```

**dt-Handling:** `dt = Math.min(delta, 100)` — **variabel, kein Fixed-Timestep, kein Akkumulator, ein Euler-Substep pro Frame**. Integration ist auf 16 ms normiert (`step = speed * dt / 16`, Partikel `dt/16`, Regen `dt/1000`). Der 100ms-Clamp gegen Tunneling ändert bei Lag-Spikes still das Simulationsergebnis (Units bewegen sich weniger, Zone schrumpft weniger) — schon **ohne** RNG eine Desync-Quelle.

**Sim/Render-Grenze:** Sie liegt **innerhalb** von `update()` bei Zeile ~583. Simulation und Rendering sind **in derselben Methode verschmolzen** (kein getrennter `tick()`/`render()`). Das ist der zentrale Refactor-Punkt für einen Headless-Server: die Zeilen 551–582 sind der Server-Tick, 584–600 sind reine Client-Präsentation. Phaser-Tweens (Level-Up-Pops, Death-Falls, Auren) laufen zudem auf der **Phaser-Clock**, völlig entkoppelt vom Sim-`dt`.

---

## 3. State- & Autoritäts-Modell

**Wo Zustand lebt:** `GameScene` hält *allen* mutablen Weltzustand als Instanzfelder: `units[]`, `buildings[]`, `souls[]`, `obstacles[]`, `powerUps[]`, `projectiles[]`, plus Subsystem-Objekte `grid: SpatialGrid`, `safeZone: SafeZone`, `audio: SoundManager`. Pro-Entity-Zustand liegt auf den Entity-Instanzen.

**Gameplay-autoritativer Zustand (muss serverseitig leben):**
- **`Unit`** (mit Abstand am meisten): `hp/maxHp`, `speed`, Position (`x/y` = **TOP-LEFT-Ecke**), `team`, `leader`, `faction`, `kingLevel/kingXp`, `aiPersonality`, alle Ability-Timer (`dashTimer`, `shieldCooldownTimer`, `shieldTimer`, `isShieldActive`), sieben PowerUp-Timer/Faktor-Paare, Attack-State (`isAttacking`, `attackTimer`, `attackDamageDealt`, `currentTarget`), `knockbackVx/Vy`. `Unit.nextTeamId` (static) vergibt eindeutige King-Team-IDs.
- **`Building`**: `hp/maxHp`, `fireTimer` (Tower), `spawnTimer` (Barracks).
- **`Projectile`**: `target`, `damage`, `attacker`, `vx/vy/vz`, `z`, `onGround` — Schadens-/Lifesteal-Anwendung bei Impact.
- **`SafeZone`** (einziger sauber gekapselter State): `current/target SafeZoneCircle` + interner Timer.
- **`SpatialGrid`**: `Set<GridEntity>[][]` plus **Rückreferenzen auf den Entities** (`_gridCells`, `_visit`) — die Broadphase ist **stateful auf den indexierten Objekten** (relevant für Rollback-Cloning).
- Sim-Skalare in `GameScene`: `gameTime`, `aliveKingCount`, `gameOver`, `recentCombatEvents`.

**Rein clientseitige Präsentation (darf die Sim NIE beeinflussen):** alle Sprites/Tweens/Bars/Auren, Footstep-/Death-Audio, `flashTimer`/`bobbingPhase`/`facingDirection`, Damage-Numbers, Slash/Shockwave/Sparkle-FX; `FEEDBACK`, `CAMERA`, `BATTLE_ESCALATION`, `DECOR`, `SAFE_ZONE_VIS`, `DEPTH`, `ORB_TINT`/`AURA_TINT`; `cameraFeel.ts`, `decor.ts`, `SoundManager.ts`; das gesamte `src/ui/`; `timeOfDay` (Tag/Nacht-Tint).

**Gemischter Sonderfall:** `BATTLE_ESCALATION` und `cameraFeel` *lesen* autoritativen Zustand (Anzahl lebender Kings) treiben aber nur Visuals — müssen im MP-Split clientseitig bleiben, aber serverbestätigte Zustände lesen.

---

## 4. Determinismus-Audit (für Multiplayer)

**Gesamturteil: Die Simulation ist heute NICHT cross-machine-reproduzierbar.** Zwei orthogonale Grundprobleme plus mehrere Iterationsabhängigkeiten. Es gibt **keinen seedbaren RNG in `src/`** (per grep bestätigt) — die einzige seeded PRNG ist `mulberry32` in `tools/bench/shared.ts`.

### 4a. Math.random() — Aufrufstellen (alle unseeded, global)
- **`worldgen.ts`** (~19 Stellen): `generateObstacles` (Größe/Position/Typ ~Z.35–39), `generateBuildingClusters` (Center/Count/Winkel/Radius/Typ Z.49–77), `generatePowerUps` (Position/Typ Z.90–94), `spawnVassal`/`spawnChampion` (Offset + Archer-Roll Z.12–21). → **Welt ist ohne Seed nicht reproduzierbar.**
- **`SafeZone.ts`** Z.22–23 (`pickShrinkTarget`-Center), Z.61–62 (Moving-Target). → **Zonenpfad komplett zufällig, würde sofort desyncen.**
- **`Unit.ts`**: AI-Personality-Pick (Konstruktor ~Z.165), Idle-Wander-Ziel (~Z.1102), `soulGreed`-Gate (`Math.random() < tier.soulGreed`, ~Z.1079), Footstep-Timer (Z.210/1116).
- **`Projectile.ts`** Konstruktor: Pfeil-Streuung (`ang = Math.random()*2π`).
- **`Building.ts`** Konstruktor: initiale `fireTimer`/`spawnTimer`-Offsets (Tower/Barracks-Desync).
- **`gameplay.ts`** Z.14 (Vassal 50% kein Drop), Z.22 / `handleBuildings` Z.286 (purple→gold 12% `GOLD_UPGRADE_CHANCE`).
- **`combat.ts`** Z.46–47 (Barracks-Soul-Winkel/Radius).
- **`collision.ts`** Z.25–26 (Jitter bei exakt koinzidenten Units, `dist===0`).
- **`GameScene.ts`**: `spawnWorld` Player-Index + AI-Faktion; Shake-Offset (`Math.random()*2-1`); `spawnVisualEffect`/`spawnDamageNumber` (rein FX).
- **`decor.ts`**: ~6× pro Instanz (kosmetisch, kollidiert nicht — **harmlos**, darf aber nie in synced Logik einfließen).

→ **Für MP:** Sim-RNG muss durch eine injizierte, geseedete PRNG (`mulberry32` als Vorlage) ersetzt und durch die Scene gefädelt werden; FX-RNG (Partikel, Shake) darf lokal bleiben. Diese Trennung existiert heute **nicht**.

### 4b. Wall-Clock / variable dt
Kein Fixed-Step (siehe §2). Alle „Timer" sind float-ms-Akkumulatoren: `SafeZone.timer`, `building.fireTimer/spawnTimer`, `Unit.attackTimer/flashTimer/healPulseTimer`, Knockback-Decay, Zone-DPS `0.05*dt`, Soul-Magnetism `dt/16`, Movement `speed*dt/16`, Regen `perSecond*dt/1000`, `timeOfDay += dt/60000`. **Zweite, ungeklammerte Zeitquelle:** `updateWarVolume` liest direkt `this.game.loop.delta` statt das geklammerte `dt`. Kein `Date.now`/`performance.now` im Sim-Pfad, aber Phasers `delta` ist wall-clock-abgeleitet.

### 4c. Iterationsreihenfolge (versteckte Determinismus-Abhängigkeiten)
- **`handleSouls`** wählt den Einsammler bei Überlapp anhand der **`scene.units`-Insertion-Order** (iteriert in Originalreihenfolge, `break` beim ersten Treffer). Eine andere Array-Reihenfolge ⇒ ein anderer King levelt. *Explizit als beabsichtigt kommentiert.*
- `removeDeadUnits` und `updateParticles` nutzen **Swap-Remove** → reordert Arrays → ändert Nachbarreihenfolge für ordnungssensible Systeme.
- `towerTargeting.pickTowerTarget` nutzt striktes `d < bestDist` → bei exakten Distanz-Ties gewinnt der erste in Iterationsreihenfolge (Range ist **exklusiv**).
- `tickPaladinAura`/`applyBerserkerAoE`/`updateArcher` iterieren Grid-/Array-Resultate für „nächstes Ziel"/AoE.

### 4d. Floating-Point
Integration `/16`-normiert (nicht dt-unabhängig); `kingDisplaySize` wird bewusst aus BASE neu berechnet, um Float-Drift zu vermeiden (`kingProgression.ts`) — ein gutes Muster, aber Einzelfall.

**Distanz zum deterministischen Fixed-Step-Sim:** mittel-groß. Die Mathematik ist portierbar; es fehlen drei Bausteine: (1) injizierbare geseedete PRNG, (2) Fixed-Timestep-Akkumulator, (3) Extraktion eines Headless-`World` aus dem Phaser-gekoppelten `Unit`/`GameScene`. Die reinen Inseln (`SpatialGrid`, `SafeZone`-State-Machine, `kingProgression`, `difficulty`, `towerTargeting`, `cameraFeel`) sind bereits Phaser-frei, getestet und server-ready.

---

## 5. Multiplayer-Andockpunkte

**Läuft headless wie-es-ist (Phaser-frei, deterministische Mathematik):** `SpatialGrid.ts`, `SafeZone.ts` (State-Machine), `towerTargeting.ts`, `kingProgression.ts`, `difficulty.ts`, `cameraFeel.ts` (clientseitig, aber pure). Diese 6 sind unit-getestet (58 Tests, alle grün) — ein Server-Tick könnte sie direkt aufrufen.

**Phaser-gekoppelt, muss entkoppelt werden:**
- **Alle Entity-Konstruktoren** verlangen eine lebende `Phaser.Scene` und bauen sofort GameObjects. Die Phaser-freie Basis ist bereits da: `Entity` (pure Geometrie) + `systems/AI.ts` + `systems/kingProgression.ts` sind der natürliche Keim eines Logik/View-Splits.
- **`gameplay.ts`/`combat.ts`** sind in der Mathematik Phaser-frei, rufen aber Scene-Senken: `scene.spawnVisualEffect`, `spawnFloatingText`, `onKingKilled`, `spawnProjectile`, `audio.playSpatial`, `notifyCombatEvent`. → serverseitig als No-Ops stubben oder als Events herausziehen.
- **`GameScene.update`** verschmilzt Sim + Render (siehe §2).

**Replikations-Seams (Damage/Kill):**
- `Unit.takeDamage(amount, srcX, srcY, scene)` (Z.596): `dmg = amount * (playerKing? playerDamageTaken : 1) * armorMult` — **die einzige Stelle, an der HP sinken sollte.**
- `Unit.executeAttack` (Z.631): Melee-Window (`attackTimer < 250`), `target.takeDamage`, Lifesteal, Berserker-AoE. **Achtung — uneinheitlicher Kill-Seam:** Duck-Typing `if (target.takeDamage) … else target.hp -= dmg` (Z.637–638) — Buildings ohne `takeDamage` bekommen rohe HP-Subtraktion ohne Armor/Hooks.
- `gameplay.removeDeadUnits` (THE Kill-Seam): `hp<=0` → splice, Soul-Drop, Grid-Remove, `scene.onKingKilled(faction, kingsLeft, x, y, nearPlayer<600px)` → **natürliche autoritative Kill-Feed-Quelle.** Limit: kann den Killer **nicht** identifizieren (nutzt Nähe-zum-Spieler-Heuristik) — Problem für echtes Kill-Credit im MP.
- `gameplay.applySafeZoneDamage` (Zone-DPS), `combat.updateTowers`→`spawnProjectile`, `combat.updateBarracks` — serverseitige Spawn-Autoritäten.

**Interest-Management:** `SpatialGrid` (150px-Zellen) ist das fertige AoI-Werkzeug. `getEntitiesInBoundingBoxInto(x,y,w,h,out)` beantwortet allokationsfrei „was ist nahe Punkt P" und kann direkt Per-Client-Snapshot-Culling treiben (nur Entities in Zellen nahe dem King jedes Spielers replizieren). `isOnScreen(margin)` gated bereits teure FX und kann Interest-Sets informieren. **Limit:** `computeKingAvoidance`/`findKingCollectible` scannen `scene.projectiles`/`scene.powerUps` als **lineare globale Listen** (nicht grid-managed) — O(n)-Skalierungsproblem auf dem Server.

**SafeZone als server-clock-getriebenes Shared-System:** winziger Zustand (`centerX/centerY/radius` + State-Enum), muss **autoritativ + broadcast** sein; Clients interpolieren, simulieren **nie** (RNG-getrieben → sofortiger Desync).

**Legacy-Server als Vorbild + Grenzen (`legacy/server/server.js`, 98 Zeilen):**
- Wiederverwendbar: Socket.IO-Transport, Single-Room-Connection-Lifecycle, Lobby/Ready/Character-Select-Handshake, nginx `/socket.io/`-Reverse-Proxy-Muster (`my-nginx-config.conf`).
- Grenzen (zu **ersetzen**, nicht erweitern): Reiner **Relay ohne Autorität** — kein server-seitiges Unit/Combat/HP (`hp` hardcoded 100, nie dekrementiert); nur King-`x/y` werden synced; Single Global Room; **kein Shared Seed** (Code-Kommentar gibt fehlenden Seed selbst zu); keine Input-Validierung/Anti-Cheat; 10Hz Full-State-Broadcast ohne Delta/Interest-Management; **Event-Name-Bug** (Server emittiert `newPlayer`/`stateUpdate`, Client lauscht auf `currentPlayers`/`playerMoved` → Positions-Relay teils kaputt). Alle Geschwister-Module (`GameState.js`, `Networking.js`, `PlayerManager.js`, `serverConfig.js`, `utils/*`) sind **0-Byte-Stubs** — die modulare Zielarchitektur wurde gescaffolded, aber nie gebaut.

---

## 6. Empfohlener inkrementeller MP-Pfad

Konsistent mit `.claude/agents/netcode.md` (server-autoritativ, kompakte Deltas + Interest-Management via `SpatialGrid`, deterministischer Fixed-Step-Headless-Sim, server-clock-getriebene SafeZone, WebSocket-Transport).

**Phase 0 — Fundament (Voraussetzung für alles):**
1. **Geseedete PRNG-Abstraktion** (`mulberry32` aus `tools/bench/shared.ts` nach `src/` ziehen), als injiziertes RNG durch die Scene fädeln; jede `Math.random()`-Sim-Stelle aus §4a ersetzen, FX-RNG lokal lassen.
2. **Fixed-Timestep-Akkumulator** statt `dt = Math.min(delta, 100)`: feste Tickrate (z.B. 30/60 Hz), Akkumulator-Loop. `updateWarVolume` von `game.loop.delta` lösen.
3. **Headless-`World` extrahieren:** Sim-Zeilen 551–582 aus `GameScene.update` in eine Phaser-freie Tick-Funktion; Entity-Konstruktoren render-frei machen (Logik/View-Split, `Entity`-Basis als Anker).

**Phase 1 — Connection/Lobby (erste konkrete, risikoarme Slice):** WebSocket-Transport + Lobby/Ready/Character-Select-Handshake vom Legacy-Server portieren (bewährtes Protokoll), aber **gegen die neue modulare Struktur**, nicht das Relay. *Noch keine Sim-Sync* — nur Verbindungslebenszyklus. **Geringstes Risiko, klarer Wert, blockiert nichts.**

**Phase 2 — Authoritative Position-Sync:** Server tickt die Headless-`World` mit geseedeter Welt (worldgen einmal serverseitig, Layout replizieren), Clients senden Input über `readInput`-Injektionspunkt (heute `moveVector`/`keyDash`/`keyShield`), Server broadcastet Positions-Snapshots via `SpatialGrid`-Interest-Culling. Client wird Thin-Renderer/Interpolator; `gameRef` zeigt auf eine **replizierte** Client-View, nicht die lokale Sim. SafeZone wird server-broadcastet.

**Phase 3 — Full Combat/Economy-Sync:** Damage/Kill-Seams (`takeDamage`, `executeAttack`, `removeDeadUnits`, `applySafeZoneDamage`) werden autoritativ; Souls/PowerUps/King-Progression/Tower/Barracks serverseitig; echtes Kill-Credit (ersetzt die `<600px`-Heuristik); `kingKilled`/`gameOver`-Bus-Events kommen vom Server statt lokal aus `GameScene`.

**Erste konkrete Slice:** Phase 1 (Lobby/Connection). **Größte Risiken/Unbekannte:** (a) die RNG-Seam + Fixed-Step-Refactors berühren den **untestbaren** 1191-Zeilen-`Unit.ts` und 802-Zeilen-`GameScene.ts` ohne Sicherheitsnetz; (b) die Logik/View-Extraktion ist der teuerste Schritt; (c) Interest-Management-Korrektheit unter Bewegung (King wechselt Grid-Zellen).

---

## 7. Risiken & offene Entscheidungen

**Top-Gotchas:**
- **Koordinaten-Konvention:** `Box.x/y` = TOP-LEFT-Ecke (AABB), `SafeZoneCircle` = CENTER. Konvertierungen müssen `width/2, height/2` addieren — Off-by-half-size-Falle. Logik nutzt teils roh `x/y`, teils `centerX/centerY`.
- **`HITBOX_SCALE=0.45`:** `size` in `UNIT_STATS` ist DISPLAY-Größe, nicht Hitbox; Hitbox = `size*0.45`. King-`size=116` kompensiert transparentes Chip-Padding — nicht „fixen".
- **`speed`-Werte** sind bereits mit globalem 1.88-Faktor (Vassal zusätzlich 0.95) vormultipliziert, px/frame@60fps. `FACTION_STATS` multipliziert obendrauf — naive Neu-Ableitung verdoppelt den Skalierungsfaktor.
- **`as const`-Konfigs werden nie mutiert** — `difficulty.ts` macht Kopien (`buildScaledPersonalities`, per Test abgesichert). In-Place-Mutation würde State über Matches leaken.
- **Insertion-Order-Determinismus** (`handleSouls`) + Swap-Remove in `removeDeadUnits`/`updateParticles` → ein anderer serverseitiger Datentyp/andere Reihenfolge ändert still, wer levelt.
- **`SpatialGrid` mutiert die indexierten Entities** (`_gridCells`, `_visit`) — Rollback/State-Cloning muss diese mitkopieren; zwei Grids über dieselben Entities streiten um `_visit`.
- **Hit-Stop** (Z.543) friert die Sim ein, lässt aber Kamera/Tweens/Partikel weiterlaufen und nutzt **rohes `delta`** — MP muss entscheiden, wie dieses Juice-Feature auf Server-Ticks abbildet (vermutlich: rein clientseitig, Server tickt durch).

**NEEDS-DECISION:**
1. **Transport:** netcode.md sagt „WebSocket". Legacy nutzt Socket.IO (engine.io, Long-Poll-Fallback). Entscheidung: raw `ws` (kompakte binäre Deltas, volle Kontrolle) vs. Socket.IO (Fallback/Komfort, mehr Overhead). Empfehlung: raw `ws` für binäre Deltas, aber Socket.IO-Handshake-Protokoll als Vorlage.
2. **ECS-Migration-Interplay:** Benchmark zeigt nur ~1.1–1.2x ECS-Gewinn (broadphase-dominiert). **Empfehlung: ECS-Migration NICHT mit dem Headless-Port koppeln** — der Logik/View-Split ist orthogonal und wertvoller. Der Benchmark misst nur den Hot-Path, nicht Sync/AI/Combat.
3. **DOM-UI ↔ Netcode:** Der Bus ist bereits der saubere Seam — `kingKilled`/`gameOver` müssen im MP vom Server stammen statt lokal aus `GameScene` emittiert. `controller.pauseGame`/`resumeGame` sind Single-Player-only (man pausiert keinen autoritativen Server) → lokal-kosmetisch machen/deaktivieren. `setJoystick`/`setActionButton` müssen serialisiert & gesendet werden statt direkt in `registry`. Minimap wird Fog-of-War/Interest-Frage (Client darf nur server-gesendete Daten zeigen).
4. **Single-Player-Annahmen verallgemeinern:** `playerKing`, `followCamera`, `onPlayerKingHit`, `checkGameOver` („Verloren" bei Spieler-King-Tod), hardcoded `totalKings=11` müssen auf N vernetzte Kings generalisiert werden.
5. **Test-Sicherheitsnetz:** CI läuft nur typecheck+lint+test (build/bench **nicht** in CI); Lint ist non-blocking (WARN). `Unit.ts`/`GameScene.ts` haben **null** Coverage. Vor dem Headless-Refactor sollte ein Charakterisierungs-Test gegen den extrahierten `World`-Tick existieren.

---

*Relevante Dateien: `src/scenes/GameScene.ts` (Loop Z.538–601), `src/entities/Unit.ts` (Damage-Seam Z.596, Attack Z.631), `src/systems/gameplay.ts` (Kill-Seam `removeDeadUnits`), `src/systems/SpatialGrid.ts` (Interest-Management), `src/systems/SafeZone.ts`, `src/systems/worldgen.ts` (RNG-Welt), `src/ui/bus.ts` + `src/ui/controller.ts` (Netcode-Seam), `tools/bench/shared.ts` (mulberry32-Vorlage), `legacy/server/server.js` (Relay-Vorbild).*

---

> **Hinweis:** Zeilennummern sind ein Snapshot vom 2026-06-26 und driften mit dem Code (der Game-Director-Loop committet häufig). Bei Abweichung gilt der Code; die *Struktur*-Aussagen bleiben stabil. Verwandt: [ENGINE-LEARNINGS.md](./ENGINE-LEARNINGS.md).
