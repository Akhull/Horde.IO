# Engine-Learnings: Performance, Grafik, Pixel-Art & Incremental-Design

> **Herkunft:** Destilliert aus einem TS + **PixiJS-v8** Tower-Defense mit 1000–8000
> Gegnern gleichzeitig. Übertragen als Referenz für **Horde.IO** (TS + **Phaser 3**).
> Markierung: `[agnostisch]` = engine-unabhängig, direkt anwendbar ·
> `[Pixi]` = PixiJS-v8-spezifisch, Prinzip aber übertragbar (Phaser-Äquivalent
> jeweils notiert, wo relevant).
>
> **Relevanz für Horde.IO:** Das Spiel hat viele Einheiten (Vasallen, Bogenschützen,
> 10 KI-Königreiche) und soll **Multiplayer** werden. Die Massen-Performance- und
> besonders die **Architektur-Patterns (Single-Chokepoint-Seams, SoA-Pools,
> Determinismus-Disziplin)** sind hier doppelt wichtig: deterministische,
> seam-zentrierte Logik ist die Basis für sauberes State-Sync / Lockstep.

---

## 1. Performance bei sehr vielen Entities (das Kernproblem)

**Zwei-Stufen-Renderpfad (das Wichtigste).** *(Prinzip [agnostisch], Umsetzung [Pixi])*
- Normalfall (<1000): ein Container + Sprite pro Entity (volle Animation, Kinder, Effekte).
- Massen-Fall (≥1000 = „megaLoad"): ParticleContainer — eine geteilte Textur, ein
  Batch pro Gegnertyp. Kosten fallen von „2000 Container × Transform-Recompute" auf
  ~8 batched Draw-Calls mit reinen Buffer-Updates.
- **Regel:** Der teuerste Posten bei Masse ist nicht das Zeichnen, sondern der
  Per-Container-Transform-Overhead. Ab einem Schwellwert auf einen flachen,
  batchbaren Pfad umschalten.
- *Phaser-Äquivalent:* `Phaser.GameObjects.Blitter` / Rope / ein eigener Sprite-Batch
  bzw. direkt in eine RenderTexture zeichnen statt 1000s Sprite-GameObjects.

**megaLoad-Gate = Spektakel abwerfen.** *[agnostisch]*
- Ab ≥1000 Entities alle „Juice"-Systeme hart abschalten: fliegende Schadenszahlen,
  On-Death-Bursts, AoE-Heil-Scans, Gold-Popups, Combo-Banner.
- Begründung: Diese Systeme „fächern" über hunderte Entities pro Frame. Bei Masse
  sieht man sie eh nicht — sie kosten nur.

**Density-Gating statt Hart-An/Aus (für die heißesten Calls).** *[agnostisch]*
- Schadenszahlen gestuft: ab 250 nur noch Crits + dicke Treffer (≥15 dmg), ab 1000
  ganz aus, Klick-Feedback immer.
- Der Schaden-Helper ist der heißeste Call (AoE ruft ihn pro Frame hunderte Male) —
  dort lohnt jede eingesparte Verzweigung.

**SoA-Pool (Structure of Arrays).** *[agnostisch], sehr wirksam*
- Entity-Felder in typisierten Arrays (`Float64Array` etc.), feste `POOL_CAPACITY`,
  attach/reap statt alloc/free.
- Cache-freundlich, GC-frei. Stress-Spawns immer auf Pool-Headroom clampen — sonst
  crasht „+6000" beim Überlauf.

**Worker-Pipeline.**
- Bewegung/Physik in Part1/Part2 auf einen Worker auslagern; Main-Thread macht nur
  noch Sync + Render.

---

## 2. Performance-Mikro-Patterns (überall anwendbar) *[agnostisch]*

- **Dirty-Checking bei Property-Writes:** `if (p.tint !== t) p.tint = t;` — die meisten
  Engines markieren bei jedem Schreibzugriff Buffer als dirty. Nur bei echter Änderung schreiben.
- **Alloc-frei im Hot-Loop:** Modul-Level-Scratch-Objekte / wiederverwendete Sets statt
  `new` pro Frame. Niemals Closures/Arrays pro Entity pro Frame.
- **Slow/Fast-Path mit Hysterese:** Stehende Entities → auf Integer-Pixel snappen +
  früher `return`. Schwellen mit Hysterese (rein bei `vSq<80`, raus bei `vSq>200`),
  damit es nicht pro Frame flippt.
- **Periodisches statt Per-Frame:** Y-Sort nur alle 30 Frames (0,5s — fürs Auge
  unsichtbar). In-place sortieren + `container.update()`, nicht remove/re-add
  (O(n²) → O(n log n)).
- **dt clampen** (z. B. max 0,25s) → kein „Spiral of Death" nach Tab-Hide.
- **FPS-Anzeige ehrlich + ruhig:** EMA-Glättung für die Headline-Zahl, rolling-window
  Minimum (~2s) für ehrliche Hitches, Anzeige nur alle 250ms refreshen (kein
  Text-Relayout pro Frame), pathologische Frames (>0,2s) ganz überspringen.
- **Audio bei Masse:** globale Rate-Caps (Schritte ~25/s, Roars <1/s) + Per-Typ-
  Wahrscheinlichkeit. Throttle-Check **vor** dem `Math.random()`, damit der Call in der
  Cooldown-Phase zu einem Compare kollabiert.

---

## 3. Grafik / Filter / Shader

- **Der „Wackel-Bug" — die teuerste Lektion:** *[Pixi]*, Prinzip allgemein. Pixi misst
  die Bounds eines gefilterten Containers jeden Frame neu. Bewegen sich Inhalte (1000
  wippende Gegner), springt der quantisierte Filter-Frame um 1px → statische Objekte
  (Türme, Burg) zittern. **Fix:** feste `filterArea` setzen (Map-Rechteck + Margin),
  dann rechnet Pixi die Bounds nicht jeden Frame neu. → Filter auf bewegten Welten
  immer mit fixer `filterArea`. *(Phaser: bei FX-Pipelines/Post-FX analog auf
  bewegte-Bounds-Neuberechnung achten.)*
- **Bloom/Filter sind teuer:** `filterArea` bounded sie; wo möglich Glow in die Textur
  backen statt Live-Filter.
- **Tint als Zustands-Sprache (billig):** Ein Color-Multiply pro Sprite kodiert
  Treffer-Flash, Wound (HP-getrieben), Affix-Identität, Enrage — statt Texturwechsel.
  Tint ist quasi gratis, Texturwechsel nicht.
- **Outline einmal backen, nicht live filtern.** Outline-Farbe = dunkler Hautton
  (grün-braun), nicht Schwarz — liest sich als Tiefenschatten statt Tinten-Linie.

---

## 4. Pixel-Art-Konventionen (Warcraft-1/2-Stil)

- **Baked Textures:** Jeden Gegnertyp einmal als Komposit (Körper + Waffe in Ruhepose)
  in eine Textur rendern → geteilte Textur → perfektes Batching. **Stolperfalle:** Im
  ParticleContainer-Pfad die weaponless Body-Textur zu nehmen → die ganze Horde ist
  „barhändig". Immer die Composite-Textur.
- **Facing ohne Extra-Texturen:** Horizontal-Flip via negativem Scale-X; Rückansicht
  via Back-View-Texturswap (nur bei Facing-Wechsel schreiben, nicht pro Frame).
- **Animations-Vokabular (billig, große Wirkung):** Walking-Bob + Squash/Stretch,
  Side-Squash bei horizontaler Bewegung (Profil-Look), Ragdoll-Tumble + Ground-Squash
  (projiziert auf Body-Achsen → liest sich immer „flach von oben").
- **Affix/Elite-Lesbarkeit = visuelle Priorität:** Animierte Cues gewinnen
  (VOLATILE-Ember > SHIELDED-Shimmer > statische GIANT/FRENZIED/ARMORED-Tints), GIANT
  bekommt Scale-Bump (×1.28), Boss Scale + dunkler Tint. Größe & Farbe kodieren
  Bedrohung auf einen Blick.
- **Era-Paletten:** Jede Epoche hat primary/secondary/bg + Emblem-Keyword → einheitliche,
  distinkte visuelle Sprache pro Zeitalter aus einer Daten-Tabelle.

---

## 5. Incremental-/Idle-Game-Design (was „süchtig" macht)

- **EIN roter-Faden-Zahl.** Eine sichtbare Kennzahl (dort POWER) = Produkt aller
  Systeme: Combo × Turm-Level × Prestige × Idle × Achievements × Era-Scale × Boons.
  Jedes System muss sichtbar in diese eine Zahl einzahlen. Ohne das fühlen sich
  Upgrades folgenlos an („Dopamin-Nervensystem gebaut, aber nie verdrahtet").
- **Snowball-Feedback-Loop:** Kill-Combo-Multiplikator fließt zurück in den Schaden →
  mehr Kills → höhere Combo. Self-reinforcing = das Suchtgefühl.
- **Sofort spürbare Power-Spikes:** „Choose-one"-Boon-Karten nach jeder Welle →
  unmittelbarer, greifbarer Sprung (Roguelite-Loop).
- **Steigende Zahlen lesbar halten:** K/M/B-Formatierung früh einbauen.
- **Ökonomie-Snowball:** Bank-Zinsen auf gehaltenes Gold (mit Cap), eskalierende
  Auszahlungen, unendlicher Gold-Sink (Turm-EVOLVE über Max-Level mit ×1.8-Kosten) —
  gegen das „nichts mehr zum Ausgeben"-Tal.
- **Staged Run-End-Payout (Dopamin am Ende):** Zahlen zählen hoch (roll + per-digit
  Tick-Sound), Reward-Reihen mit Slot-Machine-Punch, „NEUER REKORD!"-Tag, Progress-Bar
  zum nächsten Unlock. Buttons erst nach der Sequenz → der Spieler schaut den Zahlen
  beim Klettern zu.
- **Cross-Run-Retention („komm morgen wieder"):** Prestige (permanenter %-Boost),
  Idle/Offline-Akkumulation, Achievements.

---

## 6. Architektur-Patterns, die das alles wartbar machen *(besonders Multiplayer-relevant)*

- **Single-Chokepoint-Seams.** Genau ein Schaden-Seam (`applyPhysicalDamage`/
  `applyFrostDamage`), ein Kill-Seam (`awardOrkKill`), ein `onKill`-Event-Emitter. →
  Crits, Combos, XP, Achievements lassen sich an **einer** Stelle einhängen, ohne jeden
  Call-Site anzufassen. Grund, warum die ganze Incremental-Schicht in Tagen statt Wochen
  ging. **(Für MP: dieselben Seams sind die natürlichen Punkte für Server-Autorität /
  Event-Replikation.)**
- **Pure Daten-Module getrennt von Verhalten:** Stat-Tabellen (`*_TOWER_STATS`) sind
  reine Daten. Era-Werte werden als Wholesale-Override **nach** dem Era-Balance-Scaling
  angewendet → „die Zahlen in der Tabelle sind die finalen In-Game-Werte, keine
  pre-scaled Inputs". (Diese Verwechslung hat mal einen Balance-Audit gekippt.)
- **SAFE-Slice-Strategie:** Ein großes Feature (neue Ära) spielbar machen mit minimaler
  Daten-Änderung (Stat-Tabelle + 1 Branch + `playable:true`-Flag), bestehende
  Visuals/Map/Waves wiederverwenden, den riskanten 700-Zeilen-Vollbau aufschieben. Mit
  Default-Fallback (`wavesForMap → Default-Waves`) crasht nichts.
- **Test-Seams für RNG:** `setCritRngForTests` / injizierbares `Math.random` → exakte
  Assertions bleiben gültig trotz neuer Zufalls-Mechaniken. **(Für MP kritisch:
  injizierbarer, seedbarer RNG = Voraussetzung für deterministische Simulation /
  Lockstep.)**
- **Disziplin:** `tsc --noEmit` + volle Testsuite grün vor JEDEM Commit; ein logischer
  Change pro Commit; Build immer grün lassen. Erlaubt überhaupt erst autonomes
  Batch-Arbeiten.
- **Warum-Kommentare an Schwellwerten:** Jeder Magic-Threshold (`megaLoad=1000`,
  `dt-cap=0.25`, `HITCH=0.2`) trägt seine Begründung inline. Sonst „optimiert" der
  nächste sie kaputt.

---

## 7. Die teuersten Fehler (damit man sie überspringt)

1. Filter ohne fixe `filterArea` → statische Objekte zittern bei bewegter Szene.
2. Juice-Systeme nicht bei Masse gaten → FPS-Einbruch genau dann, wenn's spektakulär werden soll.
3. Stress-Spawn nicht auf Pool-Cap clampen → Crash beim Überlauf.
4. Pre-scaled vs. final Stat-Werte verwechseln → Balance-Inversion (frühe Ära schlägt späte).
5. Im Particle-Pfad die falsche (weaponless) Textur → Horde ohne Waffen.
6. Upgrades, die nicht in die eine sichtbare Zahl einzahlen → „langweilig, keine spürbaren Upgrades".
