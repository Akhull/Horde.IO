# Horde.IO — Multiplayer Master Roadmap

*Living-Dokument · Lead-Architektur-Synthese aus 7 parallelen Workstream-Designs · Stand 2026-06-26*

---

## 1. Vision & Nordstern

**Was wir bauen:** Aus dem heutigen Single-Player-Horde-Spiel Horde.IO (TypeScript + Phaser 3 + Vite, ~5400 LOC in `src/`) wird ein **maxed-out Echtzeit-Multiplayer-Spiel auf Steam** mit epischen Horden-Schlachten — Battle-Royale zuerst, weitere Modi später.

**Erfolgskriterien (Nordstern):**
- **Epische Horden:** Design-Ziel ~Tausende, bis ~8000 Entities gleichzeitig im Bild, flüssig bei ~60 FPS auf dem gebundelten Chromium.
- **Kostenloses Steam-Multiplayer:** 2–N Spieler verbinden sich über die freie Steam-"Spacewar"-Test-AppID **480**, kämpfen server-autoritativ in **einer** geteilten Battle-Royale-Runde. Kein Hosting-Budget für den ersten Cut.
- **Maxed VFX/SFX & Pixel-Art-Identität:** geschichtete Effekte (Hit-Flash, Death-Bursts, Shockwaves, Auren, Slash-Trails, Safe-Zone-Sturm), Spatial-Audio mit Rate-Caps und dynamischer Battle-Ambience — alles **client-only**, megaLoad-gegated, sodass es bei 8000 Entities nicht die Framerate killt.
- **Tiefe statt Breite-zuerst:** datengetriebener Roster (Melee/Ranged/Siege/Support/Cavalry-Rollen) und Game-Mode-Abstraktion, beide als reine `as const`-Daten, die Server und Client identisch konsumieren.
- **Charming Kenney-medieval-rts-Stil bleibt GELOCKT** (Fraktionsfarbe in die Chips gebacken, Units NIE getintet).

---

## 2. Fundament-Entscheidungen (GELOCKT — nicht neu verhandeln)

| Entscheidung | Ein-Zeilen-Begründung |
|---|---|
| **Render-Engine: PixiJS v8** | Bewährtes Pixi-v8-Perf-Playbook (ParticleContainer-Zweistufenpfad, gebackene Composite-Texturen, fixed `filterArea`, SoA-Pools, megaLoad-Gate ≥1000) — siehe `docs/ENGINE-LEARNINGS.md`. Engine-leichter `src/systems/`-Layer portiert as-is, nur der Render/Entity-View-Layer wird neu gebaut. |
| **Native-Shell: Electron + steamworks.js** | Gebundeltes Chromium = identisches WebGL/Perf über alle Spieler hinweg; einzig sicherer Weg, das Pixi-Perf-Playbook bei 8000 Entities reproduzierbar zu halten. |
| **Transport: Steam Networking Sockets via AppID 480** | Kostenloser Spacewar-Relay übernimmt NAT-Traversal; server-autoritativ, deterministischer Fixed-Timestep, Interest-Management über die bestehende `SpatialGrid`. Konsistent mit `.claude/agents/netcode.md`. |
| **Deterministischer Fixed-Step Headless-Sim** | Eine geseedete PRNG + Fixed-Timestep + Phaser-freie `World.tick()` → identischer Tick auf Server & Client bei gleichem Seed+Inputs. Kritischer Pfad. |
| **Listen-Server-Topologie (Lobby-Owner = Host)** | Null Hosting-Kosten für den BR-First-Cut; Host bekommt 0ms-Loopback. Dedizierter Headless-Build als sauberer Drop-in-Seam für später. |
| **Separater Branch `mp/main` + Worktree `../HordeIO-mp`** | Läuft parallel zu akhulls aktivem Single-Player-Content-Loop auf `main`; gemeinsames Repo hält `src/systems/`/`src/sim/`-Historie mergebar (kein Repo-Fork → kein Systems-Drift). |

**Sequencing-Prinzip (GELOCKT):** Das **engine-agnostische Fundament** (seeded PRNG, Fixed-Step, Headless-World, Steam-Shell + Lobby) kommt **ZUERST** und darf **NICHT** durch die Pixi-Render-Migration blockiert werden. Die Pixi-Migration ist ein **paralleler, durch einen Spike de-risk'ter Strom**.

---

## 3. Die 7 Arbeitsströme

### S1 — Deterministic Sim Foundation *(kritischer Pfad)*
**Ziel:** Den Sim-Kern engine-agnostisch und cross-machine-reproduzierbar machen: eine injizierte geseedete PRNG durch jede Sim-`Math.random()`-Stelle, ein Fixed-Timestep-Accumulator statt `dt=Math.min(delta,100)` (`GameScene.ts` L549), und eine Phaser-freie `World.tick()` aus `GameScene.update` L551–582.
**Phasen:** P0 Characterization-Safety-Net (Golden-Master-Snapshot, Phaser-Scene-Stub) → P1 Seeded-PRNG-Primitive (`rng.ts`, `fork()`) → P2 RNG durch worldgen + SafeZone → P3 RNG durch Entities/Combat/Collision/Spawn → P4 Fixed-Step-Accumulator (30 Hz) → P5 Logic/View-Split auf der Entity-Basis (render-freie Konstruktoren) → P6 Headless `World` + `tick()`-Extraktion mit `SimEvents`-Emitter.

### S2 — Steam Integration & Native Shell
**Ziel:** Das Vite-gebaute Phaser-Spiel in eine Electron + steamworks.js-Shell wickeln; Steam gegen AppID 480 initialisieren; das Transport-Substrat liefern, das der Netcode-Strom konsumiert.
**Phasen:** P0 Electron-Shell bootet Spiel + Steam-Init + druckt SteamID → P1 Steam-Bridge + typisierter IPC-Kontrakt (`window.steam`, `src/net/steamApi.d.ts`) → P2 Lobbies/Matchmaking (Owner = Host, Seed als Lobby-Data) → P3 Networking-Transport-Surface (`src/net/transport.ts`, P2P-Byte-Pipe) → P4 Achievements/Overlay/Rich-Presence → P5 Packaging + 480→Real-AppID/Depot-Migration.

### S3 — Multiplayer Netcode (server-autoritativ über Headless-World)
**Ziel:** Server-autoritativer Fixed-Step-Netcode: ein Spieler-Prozess fährt die autoritative Sim (Listen-Server), alle Clients konsumieren Snapshots; lokaler King client-predicted + reconciled, alle anderen Entities interpoliert; echtes Kill-Credit ersetzt die `<600px`-Heuristik.
**Phasen:** P0 Transport+Protokoll-Skelett (`NetTransport`-Interface, `Loopback`+`SteamSocket`-Impls, Bit-Packing) → P1 Lobby/Connection-Lifecycle (Legacy-Handshake portiert, N-Player-Roster) → P2 autoritative Position-Sync (30 Hz Tick, 20 Hz Snapshots, Interest-Set via `grid.getEntitiesInBoundingBoxInto`, SafeZone server-broadcast) → P3 Local-King-Prediction + Reconciliation → P4 autoritative Combat/Kills/Economy/Kill-Credit (`takeDamage` bekommt `source`).

### S4 — Render Engine: PixiJS v8 Migration *(paralleler, de-risk'ter Strom)*
**Ziel:** Phaser-Render/View-Layer durch einen Pixi-v8-Renderer ersetzen, der den Headless-World **abonniert** (null Spiel-Logik im Render), vorab validiert durch einen Standalone-8000-Sprite-Spike.
**Phasen:** P0 De-Risking-SPIKE (Standalone Pixi, 8000 Sprites, Zweistufen-Pfad, GO/NO-GO-Verdikt in `docs/PIXI-SPIKE-RESULTS.md`) → P1 Thin-Framework-Layer (RenderApp, Camera2D, ScreenManager, Input, TweenRunner, Loader) → P2 Per-Entity-View-Layer (`WorldRenderer`, `UnitView`, View aus `Unit.ts` rausziehen) → P3 Two-Stage-megaLoad-Pfad in-game (≥1000) → P4 Cutover + Phaser-Removal + Electron-Validierung.

### S5 — Content, Factions & Game Modes
**Ziel:** Den 3-Rollen-pro-Fraktion-Content in einen datengetriebenen Roster verwandeln; Modi jenseits BR (Horde-Defense, KotH, Team, Conquest) — alles als `as const`-Daten, die Server und Client identisch lesen.
**Phasen:** A Datengetriebene `UNIT_DEFS`-Tabelle (Branch-Ladder in `Unit.ts` → `UNIT_DEFS[id]` mit `role`-Diskriminator) → B Erste Roster-Erweiterung (Spearman, Crossbow, ein Siege-Unit, je 1 Fraktions-Exklusiv) → C Game-Mode-Abstraktion (`GAME_MODES`, mode-getriebene Win/Spawn, `systems/gameMode.ts`) → D Mechanics-Tiefe (Abilities/Formations/Economy als Daten).

### S6 — Art Pipeline & VFX/SFX (Juice)
**Ziel:** Eine kohärente Pixel-Art-Identität + maxed VFX/SFX, die von Duellen bis 8000-Entity-Horden skaliert — komplett **client-only**, megaLoad-gegated, hinter dem Sim/Render-Seam bei `GameScene.update` ~L583.
**Phasen:** P0 Presentation-Seam + `fxBudget.ts`-Gate (megaLoad ≥1000) → P1 Audio-Rate-Caps + Spatial-Layer + Ambience/Music-Phasen → P2 Pixel-Art-Identität + Texture-Baking/Atlas-Pipeline (**der Long-Pole**) → P3 Pixi-VFX-System (Tint-Flash, Bursts, Shockwaves, Auren, Slash-Trails, Safe-Zone-Sturm-Shader mit fixed `filterArea`).

### S7 — Dev-Infra & Autonomy
**Ziel:** Das Entwicklungs-Substrat, das den MP-Pivot parallel zu akhulls Loop laufen lässt, ohne dass die zwei Linien sich über Dateien streiten oder gegenseitig den Build brechen.
**Phasen:** P0 Branch/Worktree-Strategie + Koordinationskontrakt → P1 CI-Härtung (`build` als Pflicht, Lint blockierend via `--max-warnings` Ratchet, `bench` informativ) → P2 Characterization-Tests, die den Headless-Refactor gaten → P3 Electron/Pixi/Steam-Build-Smoke-Checks → P4 Autonomes Operating-Model (Ralph-Loop, Gate-Hook, ein-Slice-pro-Commit).

### S8 — Worldgen & Terrain *(neuer Strom, aus der Maxed-Out-Richtung)*
**Ziel:** Die Random-Rechteck-Worldgen ersetzen durch eine deterministische Seed-Heightmap (fBm-Noise) → Wasser/Flüsse/Küsten/Täler/Hügel/Berge/Biome + Autotiling. Terrain ist **autoritative Cartesian-Sim-Daten** (Passierbarkeit, Move-Cost, High-Ground, Chokepoints), gerendert als gebackene Iso-RenderTexture-Chunks (Client-only).
**Phasen:** P0 `TerrainGrid` + fBm-Heightmap aus `src/sim/rng` (rein, getestet) → P1 Biome/Wasser/Flüsse/Autotiling-Klassifikation → P2 Sim-Integration (Move-Cost/Passierbarkeit in collision/pathing + SpatialGrid) → P3 Iso-Terrain-Render (gebackene Chunks). **Verortung: M5/M6, NACH Sim-Fundament + MVP.**

> **Erweiterte Richtung (Art, Welt, Perspektive, Combat):** Details, Entscheidungen und das tragende Sim-vs-Präsentation-Prinzip in **[MAXED-DIRECTION.md](./MAXED-DIRECTION.md)**. Erweitert S4 (Render→Iso), S5 (Content+volles Ability-System), S6 (Bake-Pipeline+VFX) und fügt S8 (oben) hinzu. Bricht **nichts** am laufenden S1-Fundament.

---

## 4. Abhängigkeits- & Sequencing-Karte (kritischer Pfad)

**Grundregel:** Drei Dinge dürfen **sofort und parallel** starten, weil sie nichts blockieren und von nichts blockiert werden:
- **S7-P1** (CI-Build-Gate) — reines Infra, schützt beide Loops.
- **S4-P0** (Pixi-Spike) — Standalone, kein Phaser/World, liefert das GO/NO-GO.
- **S2-P0** (Electron-Shell bootet + Steam-Init) — nur neue Dateien unter `electron/`, null `src/`-Änderung.

Der **kritische Pfad** läuft durch S1 (Sim-Foundation), weil S3 (Netcode P2–P4) und S4 (Render P2+) und S5 (Content-MP-Ship) alle die Headless-`World` brauchen.

```
M0  Fundament-Tooling & Spike (parallel, blockt nichts)
    ├─ S7-P0/P1  Branch mp/main + Worktree + CI-Build-Gate          [zuerst, sofort]
    ├─ S4-P0     Pixi-Spike → GO/NO-GO-Verdikt                       [parallel]
    └─ S2-P0     Electron-Shell + Steam-Init + SteamID-Druck         [parallel]

M1  Determinismus-Kern (S1-P0..P3) — der eigentliche kritische Pfad
    ├─ S1-P0     Characterization-Snapshot (GATE für alles danach)
    ├─ S1-P1     rng.ts (mulberry32 → src/) + fork()
    ├─ S1-P2     RNG durch worldgen + SafeZone  ◀── kleinster Wert-Slice
    └─ S1-P3     RNG durch Entities/Combat/Collision/Spawn
        (parallel dazu: S7-P2 Characterization-Gate in CI; S5-A UNIT_DEFS-Refactor)

M2  Fixed-Step + Steam-Substrat
    ├─ S1-P4     Fixed-Timestep-Accumulator (30 Hz)
    ├─ S2-P1     Steam-Bridge + typisierter IPC-Kontrakt (window.steam)
    └─ S2-P2     Lobbies/Matchmaking (Owner=Host, Seed als Lobby-Data)
        (parallel: S4-P1 Thin-Framework-Layer)

M3  Headless-World + Connection-Lifecycle
    ├─ S1-P5     Logic/View-Split (Entity-Basis)  ◀── GEMEINSAM mit S4-P2 schneiden (Unit.ts EINMAL)
    ├─ S1-P6     Headless World.tick() + SimEvents
    ├─ S2-P3     Networking-Transport-Surface (P2P-Byte-Pipe)
    ├─ S3-P0     NetTransport-Skelett (Loopback testbar)
    └─ S3-P1     Lobby/Connection-Lifecycle (N-Player-Roster)

M4  ▶▶ MVP: "Spacewar-Testserver" (siehe §5) ◀◀
    ├─ S3-P2     Autoritative Position-Sync (Tick+Snapshot+Interest)
    └─ S4-P2     Per-Entity-View konsumiert World-Snapshot

M5  Spielgefühl & Autoritäts-Vervollständigung
    ├─ S3-P3     Local-King-Prediction + Reconciliation
    ├─ S3-P4     Autoritative Combat/Kills/Economy/Kill-Credit
    ├─ S4-P3     Two-Stage-megaLoad-Pfad in-game (≥1000)
    └─ S6-P0/P1  fxBudget-Gate + Audio-Rate-Caps

M6  Maxed Content & Juice
    ├─ S5-B/C/D  Roster-Erweiterung + Game-Mode-Abstraktion + Mechanics
    ├─ S6-P2/P3  Art-Pipeline (Long-Pole) + Pixi-VFX-System
    └─ S4-P4     Phaser-Cutover + Electron-Perf-Validierung

M7  Steam-Release-Vorbereitung
    ├─ S2-P4/P5  Achievements/Overlay + Packaging + 480→Real-AppID/Depots
    └─ S7-P3/P4  Electron/Steam-Build-Smoke + Autonomie-Doku
```

**Was strikt parallel läuft:** S4 (Pixi) ist von Anfang bis M3 von S1 entkoppelt (Spike + Framework brauchen keinen World). S2 (Shell) ist bis M2 von allem entkoppelt. **Was strikt sequenziell ist:** S1-P0 (Snapshot) **muss vor** S1-P2+ stehen — RNG-Threading ohne Golden-Master ändert still Outcomes. S1-P6 (Headless-World) **gatet** S3-P2+ und S4-P2+.

---

## 5. MVP-Definition: "Spacewar-Testserver" (M4)

**Definition of Done:** Zwei Spieler starten Steam (AppID 480), einer hostet, beide landen in **einer geteilten autoritativen Runde** und sehen sich **gegenseitig bewegen und kämpfen**. Der Host fährt die deterministische `World.tick()`; der Client ist ein dünner Interpolator. Keine Prediction, kein echtes Kill-Credit, kein megaLoad-Pfad — nur die Ende-zu-Ende-Schleife.

**Exakt benötigte Slices:**

| Stream | Slice | Liefert |
|---|---|---|
| **S1-P1** | `src/systems/rng.ts` (mulberry32 + `fork()`) | reproduzierbare PRNG-Primitive |
| **S1-P2** | RNG durch `worldgen.ts` + `SafeZone.ts` | identisches Welt-Layout aus Seed |
| **S1-P4** | Fixed-Step-Accumulator (30 Hz) in `GameScene.update` | deterministischer Tick-Takt |
| **S1-P5/P6** | Logic/View-Split + Headless `World.tick()` + `inputs.ts` (`{moveVector,keyDash,keyShield}`-Map) + `SimEvents` | Phaser-freier autoritativer Sim-Kern |
| **S2-P0** | Electron-Shell + `init(480)` + Overlay | native Steam-Anbindung |
| **S2-P1** | Steam-Bridge + `src/net/steamApi.d.ts` | typisierter IPC-Kontrakt |
| **S2-P2** | Lobby (Owner=Host, Seed als Lobby-Data) | Matchmaking + Host-Wahl + geteilter Seed |
| **S2-P3** | `src/net/transport.ts` (P2P-Byte-Pipe, per-SteamID-Adressierung) | der Byte-Kanal |
| **S3-P0** | `NetTransport` + `SteamSocketTransport` + `ByteWriter/Reader` + `protocol.ts` | Message-Framing (Reliable/Unreliable) |
| **S3-P1** | `LobbyServer`/`LobbyClient` + `Roster` (N-Player) | Connection-Lifecycle |
| **S3-P2** | `TickLoop` + `SnapshotWriter` (Interest+Delta) + `SnapshotReader` + `EntityInterpolator` + `ReplicatedWorld` | autoritative Position-Sync |
| **S4-P2** | `WorldRenderer`/`UnitView`/`ViewRegistry` gegen Snapshot-Interface | der Client rendert remote Entities |

**Nicht im MVP:** Prediction/Reconciliation (S3-P3), Kill-Credit/Combat-Authority (S3-P4), megaLoad-Pfad (S4-P3), neue Units/Modi (S5), Art/VFX-Maxing (S6), Real-AppID (S2-P5). Im MVP rendert der Client **per-entity** (<1000-Pfad) — das reicht für den Beweis, dass zwei Spieler eine geteilte Schlacht sehen.

---

## 6. Meilenstein-Roadmap

| MS | Streams · Phasen | Deliverables | Effort |
|---|---|---|---|
| **M0** | S7-P0/P1, S4-P0, S2-P0 | `mp/main`-Branch + `../HordeIO-mp`-Worktree; CI mit Pflicht-`build` + Lint-Ratchet; Pixi-Spike-GO/NO-GO; Electron-Shell druckt echte SteamID | **M** |
| **M1** | S1-P0/P1/P2/P3, S7-P2, S5-A | Golden-Master-Snapshot; `rng.ts`; worldgen+SafeZone+Entities seed-deterministisch; `UNIT_DEFS`-Tabelle | **L** |
| **M2** | S1-P4, S2-P1/P2, S4-P1 | 30-Hz-Fixed-Step; `window.steam`-IPC-Kontrakt; Lobbies (Owner=Host, Seed); Pixi-Thin-Framework | **L** |
| **M3** | S1-P5/P6, S2-P3, S3-P0/P1 | Logic/View-Split; Headless `World.tick()` + `SimEvents`; P2P-Transport-Surface; `NetTransport`-Skelett; Connection-Lifecycle | **XL** |
| **M4 · MVP** | S3-P2, S4-P2 | **Spacewar-Testserver: 2 Spieler, eine geteilte autoritative Runde, sehen sich kämpfen** | **XL** |
| **M5** | S3-P3/P4, S4-P3, S6-P0/P1 | King-Prediction+Reconciliation; autoritatives Combat/Kill-Credit; megaLoad-Pfad ≥1000; fxBudget-Gate + Audio-Rate-Caps | **XL** |
| **M6** | S5-B/C/D, S6-P2/P3, S4-P4 | Roster-Erweiterung + Game-Mode-Abstraktion + Mechanics; Art-Pipeline + maxed Pixi-VFX; Phaser-Cutover | **XL** |
| **M7 · Release-Prep** | S2-P4/P5, S7-P3/P4 | Achievements/Overlay/Rich-Presence; electron-builder-Packaging; 480→Real-AppID/Depot-Migration; Build-Smoke-Gates + Autonomie-Doku | **L** |

*Reihenfolge ist nach Abhängigkeit geordnet, nicht nach Stream. M0–M2 sind hochgradig parallelisierbar; ab M3 verengt sich der Pfad auf die Headless-World.*

---

## 7. Allererste konkrete Slice

**Zwei Commits, beide sofort und ohne Cross-Stream-Abhängigkeit, auf getrennten kurzen Branches:**

**(1) Der kritische-Pfad-Slice — S1-P2 (mit P0+P1 als Voraussetzung im selben Branch):**
> Erstelle `src/systems/rng.ts` (mulberry32 aus `tools/bench/shared.ts` L12-21 promotet zu `Rng { next(); nextInt(n); range(lo,hi); fork() }`, `tools/bench/shared.ts` re-exportiert es byte-identisch) und fädle `scene.rng` durch **`src/systems/worldgen.ts`** (die ~19 Sim-`Math.random()`-Stellen) plus `SafeZone.ts`. Vorher den **Golden-Master-Snapshot** (`tests/world-characterization.test.ts` + `tests/helpers/phaserSceneStub.ts`) als Safety-Net schreiben.

**Genaue Dateien:** `src/systems/rng.ts` (neu), `src/systems/rng.test.ts` (neu), `src/systems/worldgen.ts`, `src/systems/SafeZone.ts`, `src/systems/SafeZone.test.ts`, `src/scenes/GameScene.ts` (`rng`-Feld), `tests/world-characterization.test.ts` (neu), `tests/helpers/phaserSceneStub.ts` (neu).

**Warum genau dieser:** Es ist der **kleinste shipbare Wert-Slice** auf dem kritischen Pfad — macht die **Weltgenerierung aus einem Seed reproduzierbar** (gleicher Seed ⇒ identisches Obstacle/Building/PowerUp-Layout), unblockt den Netcode-Schritt "worldgen einmal server-seitig, Layout replizieren", ist eigenständig testbar und ist durch den Phase-0-Snapshot beweisbar verhaltens-erhaltend.

**(2) Der parallele Infra-Enabler — S7-P1:**
> Füge `npm run build` als Pflicht-Step in `.github/workflows/ci.yml` hinzu und mache Lint blockierend (`--max-warnings`-Ratchet in `package.json`). 2-Datei-Änderung, schließt die gefährlichste aktuelle Lücke (ein `vite build`-Bruch kann heute grün mergen), stärkt sofort beide Loops.

---

## 8. Top-Risiken & NEEDS-DECISION (dedupliziert, priorisiert)

### Top-Risiken (über Streams gemerged)

1. **Untestbare Hot-Files (höchstes Risiko, mehrfach geflaggt):** `Unit.ts` (1191 LOC) und `GameScene.ts` (802 LOC) haben **NULL Coverage**. RNG-Threading, Logic/View-Split, `UNIT_DEFS`-Refactor und Combat-Authority fassen alle diesen ungetesteten Code an. **Mitigation:** Der Phase-0-Golden-Master-Snapshot ist das **mandatorische** Safety-Net — kein S1-P2+, kein S5-A, kein S4-P2 ohne ihn. Eine Entity pro Commit.

2. **`Unit.ts` als geteilte Konfliktfläche:** S1-P5 (Logic/View-Split), S4-P2 (View-Extraktion) und S5-A (`UNIT_DEFS`) editieren **alle** denselben `Unit.ts`-Konstruktor — und akhulls Content-Loop committet stündlich darauf. **Mitigation:** Den View-Aus-`Unit.ts`-Schnitt **EINMAL gemeinsam** zwischen S1-P5 und S4-P2 landen (nicht zweimal); kleine Commits, häufig rebasen; `src/sim/`+neue Dateien minimieren Overlap mit den Content-Hot-Files.

3. **Art-Produktion ist der Long-Pole (S6-P2, XL):** Handgezeichnete Pixel-Art für viele Units/Fraktionen ist langsam und skill-gated — kann den ganzen Strom stalllen. **Mitigation:** Kenney-Basis palette-swappen für Breite zuerst, Custom-Art nur für King/Champion-Hero-Silhouetten, AI-Art ausschließlich als Exploration (Konsistenz-/Lizenz-Risiko für Steam-Release).

4. **steamworks.js native-Binding ↔ Electron-Version-Pinning (#1-Failure-Mode des Stacks):** Prebuilt N-API-`.node`-Bindings sind an Node/Electron-ABI gebunden; ein Electron-Upgrade bricht das Binding. **Mitigation:** Electron + steamworks.js auf bekannt-kompatible Versionen pinnen, CI-Smoke-Test der `init()`-Rückgabe, Bindings bei Bump neu bauen.

5. **Bandwidth bei 8000 Entities:** Voll-Replikation unmöglich. **Mitigation:** Per-Client-Interest-Culling um den King (`grid.getEntitiesInBoundingBoxInto`), int16-Quantisierung, Changed-Fields-Deltas, Enter/Leave-Hysterese gegen Interest-Set-Churn, Nearest-First-Eviction unter Bandwidth-Druck.

6. **Host als Single-Point + Host-Cheat (Listen-Server):** Host-Disconnect killt die Runde; Host kann seinen eigenen Client betrügen; Host fährt **gleichzeitig** volle Sim + eigenen Renderer. **Mitigation:** Für casual BR akzeptabel + dokumentiert; die O(n)-Linear-Scans (`computeKingAvoidance`/`findKingCollectible`/`handleSouls`) müssen **vor** dem Entity-Target grid-backed werden, sonst hält der Host 30 Hz nicht.

7. **Steam-Callback-Pump-Disziplin:** Wenn `runCallbacks()` nicht jeden Tick gepumpt wird (oder das Interval bei verstecktem Fenster stallt), feuern Lobby/P2P/Overlay-Events **stillschweigend nie** — "nichts passiert, kein Error". **Mitigation:** Pump auf einem Main-Process-`setInterval` (unabhängig vom Renderer-rAF).

8. **Wobble-Bug & megaLoad-Gate-Vergessen (teuerste VFX-Lektionen):** Jeder Live-Filter/Shader auf der bewegten Welt ohne fixed `filterArea` (Map-Rect+Margin) macht statische Objekte zittern; ein neuer Effekt ohne `fxBudget`-Gate = FPS-Kollaps genau bei der spektakulärsten Schlacht. **Mitigation:** Jeder Effekt routet durch `fxBudget.ts`; Composite-(bewaffnete)-Textur im Batched-Pfad verifizieren (sonst rendert die ganze Horde barhändig).

### NEEDS-DECISION (priorisiert, nicht erfunden)

| # | Entscheidung | Empfehlung | Owner |
|---|---|---|---|
| **D1** | **RNG/World-Verzeichnis-Konvention:** `src/systems/rng.ts` (S1) vs `src/sim/rng.ts` (S7) — **echter Cross-Stream-Widerspruch.** Headless-`World` unter `src/sim/` (neu) vs `src/systems/` als World. | Einmalig festlegen **vor** S1-P1-Commit (der Port passiert nur einmal). Empfehlung: `src/sim/` für World+RNG, importiert aus `src/systems/`. | Lead-Architekt |
| **D2** | **Tick-Rate:** 30 Hz vs 60 Hz autoritativ. Integration ist /16-normalisiert (60fps-geformt). | 30 Hz + Client-Interpolation; /16-Step-Math bei 33.3ms verifizieren. Gegen Perf-Ziel bestätigen. | Netcode + Foundation |
| **D3** | **IPC-Boundary:** Main-Process-Bridge + contextBridge (sicher, mehr Marshalling) vs Renderer-direct `require` mit `nodeIntegration:true` (steamworks.js-Empfehlung, unsicher). | Bridge (sicher) — prägt S2-P1..P3 + den gesamten `src/net/`-Kontrakt. | Shell-Stream |
| **D4** | **Networking-API:** Legacy `ISteamNetworking` P2P (heute in steamworks.js verfügbar, läuft sofort auf 480) vs `ISteamNetworkingSockets`/Messages (die gelockte API, voll SDR+IP-Protection, evtl. Fork nötig). | Legacy-P2P für den ersten Cut, hinter `transport.ts` isoliert → swappbar. | Shell + Netcode |
| **D5** | **Host-Migration v1:** drin vs raus. | RAUS (Host verlässt = Runde endet; dropped Clients werden Server-AI-Kings). Bestätigen, ob casual BR das toleriert. | User/akhull |
| **D6** | **Branch-Modell:** `mp/main` im selben Repo (mergebare `src/systems/`-Historie) vs separates Repo (Isolation, aber Systems-Fork+Drift). | Selbes Repo, `mp/main`-Integrationsbranch. | akhull (Repo-Owner) |
| **D7** | **Real-Steam-AppID + Partner-Account (~$100 Steam Direct):** Entwicklung braucht nur 480, aber Achievement-Schema, SDR-IP-Protection, Store-Page, Depot-Upload sind darauf geblockt. | Go/No-Go + wer den Partner-Account besitzt. Erst zu M7 nötig. | User/akhull |
| **D8** | **Content-Scope v1:** wie viele Units pro Fraktion; welcher 2. Game-Mode zuerst; Cavalry/Flying; Auto-Roll vs Loadout. | 3 Fraktionen × ~6-8 Units; KotH **oder** Team zuerst (PvP schlägt PvE für MP-first); Cavalry rein / **Flying raus** v1 (braucht Collision-Layer); Auto-Roll v1, Loadouts später. | User/akhull |
| **D9** | **Render-Backend & Sim→Render-Kontrakt:** WebGL vs WebGPU; Renderer liest Live-`Unit`-Instanzen vs serialisierten Snapshot. | WebGL zuerst (Playbook-bewährt), WebGPU im Spike als Upside messen. `WorldRenderer` von Tag 1 gegen ein **Snapshot-Interface** designen (dient SP + MP-Client). | Render + Netcode |
| **D10** | **Hit-Stop-Mapping auf Server-Ticks** (`GameScene` L543) & **Lag-Comp/Hit-Rewind.** | Hit-Stop rein client-kosmetisch (Server tickt durch); **keine** Lag-Comp v1 (server-autoritative Melee-Horde toleriert es). Vor Fixed-Step-Lock bestätigen. | Netcode |

*Koordinations-Touchpoint mit akhull (gatet S7-P0):* schriftliche Vereinbarung über (a) `src/systems/`-Signatur-Änderungs-Announce-Policy (`SafeZone.ts`/`worldgen.ts`/`Unit.ts`), (b) Merge-Richtung `main`→`mp/main` bis das Fundament stabil ist, (c) geteilte Ownership von `.github/workflows/ci.yml` (Change-by-PR).

---

> Verwandt: [ARCHITECTURE.md](./ARCHITECTURE.md) · [ENGINE-LEARNINGS.md](./ENGINE-LEARNINGS.md). Zeilennummern driften (akhulls Loop committet oft) — bei Abweichung gilt der Code.

---

## 9. Fortschritts-Log (mp/main, neueste zuerst)

- **2026-06-26 — Richtung: Maxed-Out (Art/Welt/Perspektive/Combat) entschieden.** `docs/MAXED-DIRECTION.md`.
  4 Festlegungen: **Iso/Dimetric 2.5D** (reine Client-Projektion des Cartesian-Sims) · **Vektor/Skeletal→Offline-Bake→Pixel-Atlanten** (Horde gebacken, Kings Runtime-Skeletal; Kenney-Lock nur für SP-`main`) · **deterministische Heightmap-Worldgen** (autoritative Terrain-Daten) · **datengetriebenes `ABILITY_DEFS`-System** (geteilt + fraktionsspezifisch, nur über Seams). Neuer Strom **S8 Worldgen**; S4/S5/S6 erweitert. Verortung M5/M6 — blockiert das laufende S1-Fundament nicht.
- **2026-06-26 — S1-P2 (Teil 1) ✅ SafeZone deterministisch.** `SafeZone` bekommt einen
  injizierten `Rng` (eigener `fork()` aus dem GameScene-Master-`rng`); die 2 `Math.random`-
  Stellen im Zonenpfad (shrink-target + moving-target) ersetzt. `GameScene` hält jetzt ein
  Master-`rng` (SP seedet zufällig, MP später aus Lobby). Neuer Determinismus-Test: gleicher
  Seed => identischer Zonenpfad über 5000 Ticks. Gates grün: typecheck + 65 vitest + build.
  *Nächste Slice: worldgen — Planner-Refactor (reine Placement-Records) + Golden-Master, dann rng durchfädeln.*
- **2026-06-26 — S1-P1 ✅ Seeded Rng-Primitive.** `src/sim/rng.ts` (`Rng`-Klasse: `next`/`nextInt`/`range`/`fork` auf mulberry32) + 6 Tests; `tools/bench/shared.ts` re-exportiert mulberry32 von dort (eine Implementierung, Benchmark byte-identisch). Kein Spielverhalten geändert. Gates grün: typecheck + 64 vitest + build. *Nächste Slice: S1-P0 Golden-Master-Snapshot + S1-P2 rng durch worldgen/SafeZone fädeln.*
