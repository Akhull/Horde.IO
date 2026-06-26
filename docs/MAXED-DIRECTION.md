# Horde.IO — Maxed-Out Direction (Art, Welt, Perspektive, Combat)

*Living-Dokument · Lead-Architektur-Synthese aus 4 Säulen-Designs (Perspektive/Render, Art-Pipeline, Worldgen/Terrain, Combat/Abilities) · Stand 2026-06-26*

> Dieses Dokument setzt auf [MULTIPLAYER-MASTERPLAN.md](./MULTIPLAYER-MASTERPLAN.md) auf und erweitert dessen Ströme S4/S5/S6 plus einen neuen Worldgen-Strom. Es **überschreibt keine** GELOCKTE Fundament-Entscheidung (Pixi v8, Electron+steamworks.js, Steam AppID 480, deterministischer Fixed-Step Cartesian-Sim, megaLoad ≥1000 Batched-Render). Alles hier sitzt auf der **Client-Präsentationsseite** oder ist **deterministische Cartesian-Sim-Daten** — niemals 3D, niemals nicht-deterministisch.

---

## 1. Die getroffenen Entscheidungen

Der Auftrag war: *entscheide autonom, keine Optionen, maxed-out Steam-Qualität.* Hier sind die vier Kern-Entscheidungen, jede fest und mit Ein-Zeilen-Begründung. **Es gibt keine offenen Fragen — das sind Festlegungen.**

| Achse | ENTSCHEIDUNG | Ein-Zeilen-Begründung |
|---|---|---|
| **Perspektive** | **Echtes Isometric/Dimetric 2.5D (2:1, ≈26,57°) als reine Client-seitige Projektion des unveränderten Cartesian-Sims.** Kein echtes 3D. Tiefensortierung per `(wx+wy)`, Höhe nur als Screen-Y-Lift. | Iso ist nur ein affines Mapping derselben Sprite-Quads → kostet im Batch **nichts** extra, zeigt als einzige Sicht die neue Heightmap (Berge/Täler), liefert den geforderten 45°-RTS-Charme und fasst **null** Sim-Code an (Determinismus/Netcode unberührt). |
| **Art-Pipeline** | **Vektor/Skeletal als Quelle → Offline-Bake → knackige Nearest-Neighbor Pixel-Art Iso-Atlanten.** Horde = gebackene Frames im ParticleContainer; Helden (Kings) = optional Runtime-Skeletal (DragonBones). Fraktionsfarbe = Bake-Zeit-Paletten-LUT. | Live-SVG/Live-Pixelate bei 8000 Entities ist langsam **und** sieht billig aus; Bake entscheidet Schärfe+Speed **einmal offline** in Zielauflösung → GPU batcht nur fertige Pixel-Frames. Nutzt die bereits bewährte `sharp`-Bake-Muskulatur (`tools/build-lpc-sprites.cjs`). |
| **Worldgen** | **Deterministische Seed-getriebene Heightmap (fBm Simplex/Value-Noise) → Wasser/Flüsse/Küsten/Täler/Hügel/Berge/Biome + Autotiling.** Terrain ist **autoritative Cartesian-Sim-Daten** (Passierbarkeit, Move-Cost, High-Ground); gerendert als gebackene Iso-RenderTexture-Chunks. | Die heutigen 20 Zufalls-Rechtecke auf flachem Gras sind nicht-deterministisch (bricht Netcode), flach und gameplay-tot. Ein Noise-Heightmap fixt alle drei: Determinismus aus dem geseedeten `Rng`, kohärente Geografie, emergente Strategie (Engstellen, Höhen). |
| **Combat/Abilities** | **Datengetriebenes Ability-System (`ABILITY_DEFS as const`) als einzige Combat-Wahrheit.** Geteilte Abilities (alle Fraktionen) + Fraktions-Signaturen; alle Effekte laufen nur durch die bestehenden Seams (`takeDamage`/`removeDeadUnits`/`spawnProjectile`) und einen geforkten `abilityRng`. | Spiegelt den Haus-Stil (`UNIT_DEFS`/`FACTION_STATS as const`), macht jede Ability als Liste vorhandener Primitive testbar, hält 100 % der Ability-Mutationen deterministisch + netcode-sicher und ersetzt die hartcodierten Dash/Shield-Branches in `Unit.ts`. |

---

## 2. Leitprinzip: Sim vs. Präsentation

**Das ist die tragende Regel, an der alles andere hängt. Sie macht die ambitionierte Art/Perspektive für Multiplayer SICHER.**

Es gibt genau **drei** Datenkategorien, und jedes Feature hier ist sauber genau einer zugeordnet:

### (A) AUTORITATIV — deterministischer 2D-Cartesian-Sim (`src/sim/**` + `src/systems/**`)
Server-repliziert, byte-identisch reproduzierbar aus `Seed + Inputs`:
- Alle Entity-`x/y` (Top-Left-Corner-Px-Konvention bleibt), `centerX/centerY`, Velocities, Movement, Collision, Combat, HP, SafeZone.
- **Die Heightmap/`TerrainGrid`** — das ist der entscheidende Punkt: Terrain ist **geteilte autoritative Cartesian-Daten**, generiert aus dem geseedeten `Rng`. Server schickt **nur die Seed-`u32`**, jeder Client regeneriert identische Geografie. Der Sim **darf** Terrain lesen (Move-Cost, Passierbarkeit, High-Ground) — diese Reads sind dann ebenfalls autoritativ und deterministisch.
- **Alle Ability-Mutationen**: `ABILITY_DEFS`-Auflösung, Cooldown/Mana-Timer, Status-Effekte, Schaden, Knockback, Blink-Position, gespawnte Projektile — alles via `takeDamage`/`spawnProjectile`/`applyStatus` und `world.abilityRng` (Fork des Master-`Rng`), **nie** `Math.random()`.
- **Facing-INTENT** leitet sich aus der Sim-Velocity ab (deterministisch); die 8-Sektor-Quantisierung darf deterministisch bleiben, schreibt aber **nie** in den Sim zurück.

### (B) CLIENT-ONLY PRÄSENTATION (`src/render/**`) — liest Sim, schreibt NIE zurück
- Die **gesamte Iso-Projektion** (`worldToIso`, Kamera, Zoom, Tiefensortierung, Band-Bucketing), **Höhen-Screen-Lift**, Schatten, gebackene Terrain-Chunks, Autotiling, Cliff-Faces, Biome-Tints, Day/Night.
- **Welche** gebackene Facing/Animation/Frame gezeigt wird, alle Atlas/Paletten/Tint-Wahl, das Helden-Skeletal-Rig, Auren/Banner/Dust.
- Alle **VFX/Juice**: Telegraphs, Slash/Stomp/Volley-FX, Hit-Flash, Wound-Darkening, Floating-Text, Healthbars, Water-Shimmer.
- Diese werden von **`SimEvents`** (`AbilityCast`/`AbilityHit`) getrieben, die der autoritative Tick emittiert — der Client **rendert** sie, leitet daraus **keinen** Spielzustand ab.

### (C) BUILD-ZEIT-ARTEFAKTE (`tools/art-bake/` → `public/atlases/`)
- Die Bake-Pipeline ist ein **Offline/CI-Schritt**, komplett außerhalb von Sim **und** Netcode. Atlanten sind statische Client-Assets wie jede Textur.

### Warum das die ambitionierte Vision SICHER macht
Zwei Maschinen mit demselben Seed haben **denselben autoritativen Tick und dieselbe Geografie** — und dürfen **trotzdem** unterschiedliche Facings, Frames, LOD, Zoom und VFX rendern, ohne dass das Sim-Ergebnis um ein Byte abweicht. Die Iso-Sicht ist eine **Linse, keine Welt**. Real-3D würde 3D-Collision/Movement in den autoritativen Tick zwingen und Cross-Machine-Reproduzierbarkeit + die bestehende geseedete-`Rng`/SafeZone-Arbeit brechen — deshalb ist es ausgeschlossen. Die einzige Stelle, an der Präsentation den Sim *berührt*, ist die **inverse Projektion** (`screenToWorld`) für lokales Picking/Klick-Befehle — und die geht durch denselben Input-Injection-Seam wie heute die Tastatur, produziert also ein **cartesisches** Move/Target-Command, identisch zum bestehenden Pfad.

> **Merksatz:** Der Renderer LIEST Sim-State + Heightmap und projiziert. Er SCHREIBT nie Sim-State. `abilityFire[]`/`abilityTarget` und Klick-Move sind die einzigen Spieler→Sim-Kanäle und werden repliziert.

---

## 3. Perspektive & Render

### Die Entscheidung
**True-Isometric 2.5D, 2:1 dimetric ("game iso", ≈26,57°), als reine Client-Projektion.** Der Sim bleibt 100 % top-down cartesian (Top-Left-Corner-Konvention erhalten); **nur** der Renderer wendet die Iso-Transform an. Top-down wird verworfen (verschenkt die Heightmap, verfehlt den Charme-Auftrag), Real-3D wird verworfen (bricht Sprite-Batch-Pfad + 2D-Sim-Grenze).

### Projektions-Mathematik (der Vertrag)
Eine einzige reine Funktion in `src/render/iso.ts`, immer auf **zentrierten** Koordinaten (`centerX/centerY`, **nie** das Top-Left-`x/y`):
```
TILE_W = 64, TILE_H = 32 (2:1)   →   hw = 32, hh = 16
worldToIso(wx, wy, elev):
  isoX = (wx - wy) * 0.5
  isoY = (wx + wy) * 0.25 - elev * H_SCALE      // H_SCALE ≈ 0,5 px Lift/Höhen-Einheit
```
Das ist die Standard-Diamond-Transform in kontinuierlichen Welt-Px (nicht Tile-Indizes), funktioniert also für frei bewegliche Units. Es ist eine lineare 2×2-Matrix `[[0.5,-0.5],[0.25,0.25]]` — **invertierbar** für Picking (`screenToWorld` via Inverse). `elev` wird aus der Heightmap bei `(wx,wy)` gesampelt. Round-Trip wird unit-getestet.

### Szenengraph & Kamera
```
stage
 └─ worldRoot (Container; Kamera = scale[zoom 0.5–2] + position[-projizierterKing*zoom + screenCenter])
     ├─ terrainLayer      // gebackene Iso-RenderTexture-Chunks (statisch), NICHT 8000 Tile-Sprites
     ├─ groundDecalLayer  // Schatten, SafeZone-Sturm (FIXED filterArea!), AoE-Ringe — unter Units
     ├─ entityLayer       // DIE tiefensortierte Schicht: Per-Entity-Pfad ODER Batched-Buckets
     └─ overedgeLayer     // fliegende Projektile (z>0), Floating-Text, Healthbars
```
Kamera folgt der **projizierten** King-Center (Lerp auf das projizierte Ziel, damit Iso-Diagonalbewegung smooth liest), wiederverwendet `CONFIG.CAMERA.followLerp` + `roundToPixel` (gegen Sub-Pixel-Shimmer).

### Tiefensortierung — der Knackpunkt
Sortier-Key = `(wx + wy)` (Screen-Y **vor** Höhen-Lift). Eine Unit hinter einer anderen (kleineres `wx+wy`) zeichnet zuerst und wird verdeckt. **Höhe verschiebt nur Screen-Y, NICHT den Tiefen-Key** → eine Unit, die einen Hügel hochläuft, verdeckt nie fälschlich. Zwei Regime:

- **(A) Per-Entity (<1000):** `entityLayer.sortableChildren=true`; jede `UnitView` setzt `zIndex=(wx+wy)|0` (+ Typ-Bias als Sub-Ordering). **Nicht jeden Frame sortieren** — periodisch alle ~15–30 Frames (0,25–0,5 s, unsichtbar) via Dirty-Flag. Dazwischen sind `zIndex`-Writes billig.
- **(B) Batched megaLoad (≥1000):** ParticleContainer kann nicht billig per-Sprite z-sortieren → **COARSE Y-BUCKETING**. Den `(wx+wy)`-Range in N Iso-Bänder (24–48) slicen, ein ParticleContainer pro `(Band × UnitType)`, in Band-Reihenfolge (hinten→vorne) gehängt. Pro Frame jede Entity per `(wx+wy)` in ihr Band bucketen + projizierte Position schreiben. Innerhalb eines Bandes ist der ~Dutzend-Px-Tiefenfehler in einer Horde unsichtbar. **Rebucket nur bei Band-Wechsel** (Hysterese → Common-Case ist reiner Position-Write). Draw-Calls ≈ `Bänder × sichtbareTypen` — konstant + klein. **Das ist die zentrale neue Idee, die "batched Iso-Sprites die trotzdem tiefensortieren" real macht.**

### Facing (Iso, 4 gebacken + Flip)
Sim leitet Facing aus Velocity ab. Auf Iso generalisiert: Bewegungswinkel in **Welt**-Space, in 8 Sektoren quantisiert, aber nur **4 Quellrichtungen** gebacken (S/N/E + Diagonalen kollabiert) und W/NW/SW via `scale.x = -1` gespiegelt. Facing-Write **nur bei Sektor-Wechsel** (mit Hysterese gegen Popping), nie pro Frame.

### Höhen-Rendering & Projektil-Z
Units erben Terrain-Höhe bei `(wx,wy)`: Renderer liftet Screen-Y um `elev*H_SCALE`; der Schatten bleibt auf der Boden-Projektion (`elev=0`). Der **Spalt zwischen Körper und Schatten** verkauft die Höhe ans Auge — viel billiger als Real-3D. Projektile tragen bereits `z/vz` im Sim (Fake-Height-Hack); der Renderer mappt `elev = z`, sodass Pfeile in Iso korrekt bogen.

### Performance
Iso-Projektion = ~4 Multiply-Adds pro sichtbarer Entity/Frame — vernachlässigbar. Der Horde-Pfad bleibt der ENGINE-LEARNINGS-Zweistufenpfad; Iso kostet im Batching **nichts** (eine projizierte Position ist immer noch nur ein Sprite-`x,y`). Terrain ist der große Gewinn: 9000×9000-Welt = ein paar Dutzend statische RenderTexture-Quads, nicht 8000 Tile-Sprites. **Der S4-P0-Pixi-Spike bekommt eine Iso-projizierte + Band-Bucket-Variante**, um den Draw-Call-Count bei 8000@60 zu bestätigen.

### Kreative Iso-Ideen
- **Höhen-Fog at Bake-Time:** Terrain-Chunks beim Backen nach Höhenband tinten (kühle dunkle Täler, helle Gipfel) → Berge lesen als 3D, **null** Runtime-Shader, umgeht den Wobble-Bug komplett.
- **Diamond-Minimap:** Heightmap in eine rotierte 2:1-Diamond-Minimap rendern, sodass mentales Modell und Minimap übereinstimmen (die meisten RTS verfehlen das mit Quadrat-Minimap über Iso-Welt).
- **Battle-Cam Dolly-Zoom:** `worldRoot.scale` an die `BATTLE_ESCALATION`-Phase koppeln — subtil reinzoomen, wenn das Feld zum finalen Duell kollabiert (iso-nativ, top-down unmöglich).
- **Tiefensortierte Slash/Impact-FX:** Hit-Sparks/Shockwaves durch denselben `(wx+wy)`-Key routen → ein Slash hinter einem Hügel wird verdeckt, volumetrisches 2.5D-Gefühl ohne 3D.
- **Water-Shimmer:** EIN animiertes Tiling-Sprite auf der Wasser-Maske mit **fixed** `filterArea`, nicht per-Tile-Filter → animiertes Meer bei Horde-Scale für einen Draw-Call.

---

## 4. Art-Pipeline & Ästhetik

### Die Pipeline (die einzig wahre)
**Vektor-Quelle → Offline-Bake → Nearest-Neighbor Pixel-Art Iso-Atlanten.**
1. **QUELLE** = Vektor/Skeletal in Inkscape-SVG + freien DragonBones-Rigs (NICHT Live-SVG in-engine). Zwei Klassen: (a) Skeletal-Rigs pro Unit-Archetyp (Body+Head+Legs+Armor+Weapon+Fraktions-Extras), die aus EINEM Rig idle/walk/attack/death × alle Iso-Facings produzieren; (b) statische SVG-Props (Gebäude, Decor, Terrain-Autotiles).
2. **BAKE** = `tools/art-bake/` (Node + TypeScript + `sharp`, via `tsx`): rendert je `{unitType × faction × tier}` jede Animation × jedes Iso-Facing × jeden Frame off-screen, bei **2–3× Zielauflösung**, dann Box-Downscale + indizierte-Paletten-Posterize (so quantisieren Kanten knackig statt zu Anti-Alias-Matsch). 1px dunkel-warmer Outline gebacken (Outline-Farbe = abgedunkelter Skin/Armor-Ton, **nicht** reines Schwarz — liest als Tiefenschatten). Pro Unit-**TYPE** ein Atlas-PNG + Pixi-JSON → eine geteilte Textur → perfektes Batching.
3. **HORDE** (Vassal/Archer/Champion) = gebackene flache Frames im v8-ParticleContainer/Particle-Batch.
4. **HELD** (King) = optional Runtime-DragonBones-Skeletal (wenige Instanzen, ≤11; Cape-Sway, Weapon-Trails, Squash/Stretch). **Fallback**: gebackener Atlas in höherer Auflösung, damit das Shipping nie am Rig-Runtime blockiert.
5. **LIZENZ-PIVOT (nicht verhandelbar für Steam):** LPC-Art ist CC-BY-SA + GPL (Copyleft, kontaminiert das ganze Set in einem geschlossenen Binary). Für den `mp/main`-Build durch **CC0/eigene Vektor-Quelle** ersetzt. Die `sharp`-Composite-Mechanik aus `tools/build-lpc-sprites.cjs` bleibt als Referenz; die LPC-**Quelle** wird retired.

### Was das die GELOCKTE Kenney-Entscheidung ersetzt (nur `mp/main`)
**SUPERSEDES** (nur für den MP/main-Build) den Kenney-medieval-RTS-Art-Lock aus Masterplan §1 (statische vorgefärbte PNGs) und das `spriteConfig.ts`-"statische-Kenney-PNG, keine Animation"-Modell. **akhulls Single-Player-`main` behält Kenney.** Bestätigt (überschreibt **nicht**): Pixi/Electron/Steam/deterministischer-Sim-Lock — die Art sitzt komplett auf der Client-Präsentationsseite. Units werden weiterhin **NIE** runtime-getintet außer für transiente States (Hit-Flash) — die Fraktionsfarbe ist gebacken.

### Visuelle Identität & Fraktions/Era-Palette
Warcraft-1/2-meets-modern-Pixel: chunkige lesbare Silhouetten, fixe Bake-Auflösung (Vassal ~48px, Champion ~64px, King ~80px, skaliert mit Nearest-Filter angezeigt), Rim-Light oben-links für Iso-Volumen. **Jede Unit weapon-inklusive gebacken** (gegen die dokumentierte "barhändige Horde"-Falle). **Fraktionsfarbe via Bake-Zeit-Paletten-LUT:** Rigs werden EINMAL in einer neutralen Index-Palette gemalt (Skin-Ramp 0–3, Primary-Armor 4–7, …); eine Per-Fraktion-LUT remappt zu Steel-Blue/Forest-Green/Iron-Grey. Crisp, **null** Runtime-Kosten, keine Farb-Matsche (anders als `sharp.modulate`-Hue-Rotation). **Era-Varianten** = zusätzliche Paletten-Zeilen in derselben Tabelle. Runtime-Tint bleibt **exklusiv** für transiente States (Hit-Flash, Wound-Darkening per HP-Ratio, Affix/Elite, Enrage) — ein Color-Multiply, den der Batch als Per-Particle-Tint unterstützt.

### Facing-Modell (entschieden)
**4 gebackene Facings (NE/NW/SE/SW) + Horizontal-Flip** → effektiv 6–8 lesbare Richtungen bei halben Atlas-Kosten. Nicht 8 gebacken: Atlas-Speicher und Bake-Zeit bei ~12 Unit-Varianten × 4 Anims × 4 Facings × ~6 Frames sind bereits ~1150 Frames; doppelte Facings lohnen für ein Iso-`.io`-Spiel mit fixer Kamera nicht.

### Bake-Tooling
- `tools/art-bake/bake.ts` (Orchestrator), `rig-loader.ts` (Rig→Frames via Headless-Render), `pixelate.ts` (Render-2× → Box-Down → Index-Posterize + Outline), `palette.ts` + `palettes.ts` (Per-Fraktion/Era-Index-LUT-Tabelle), `iso.ts` (Facing-Liste + Flip-Konvention), `atlas-pack.ts` (Trim + Pack → Pixi-Atlas).
- **Hot-Reload-Dev-Loop:** `art-bake` schreibt einen Manifest-Hash; ein Vite-Plugin swappt Atlanten live in Dev → Artists sehen eine re-baked Unit in Sekunden.
- `package.json`: `"bake": "tsx tools/art-bake/bake.ts"`. Output → `public/atlases/<faction>_units.{png,json}` + `fx.{png,json}`, geladen mit `scaleMode:'nearest'`.

### Kreative Art-Ideen
- **Banner-as-Identity:** ein kleiner Per-King-Fraktions-Wimpel, der über jedem King fliegt und bei Richtungswechsel squasht — über ein 8000-Unit-Chaos die klarste "wessen Horde ist das"-Lesbarkeit.
- **Gebackene Dust/Impact-Framelets:** 4-Frame-Staubwolke + 5-Frame-Slash im **selben** geteilten FX-Atlas, als kurzlebige Particles im Batch → Spektakel im megaLoad-Budget.
- **Paletten-Swap-Eras als Live-Content:** weil Fraktionsfarbe eine Bake-Zeit-LUT ist, ist eine neue Era (Bronze→Eisen→Hochmittelalter) nur eine neue Paletten-Zeile + Re-Bake → DLC/Progression mit **null** neuem Art-Authoring.
- **Wound-Darkening als Gameplay-Read:** HP-Ratio treibt ein subtiles Runtime-Tint-Abdunkeln → eine blutige Horde sieht sichtbar verlierend aus, für einen freien Color-Multiply.
- **Iso "Squash-to-Flat"-Tode:** Death-Anim taumelt und endet auf einem flachen boden-gesquashten Corpse-Frame → 8000 Leichen sehen in Iso richtig aus ohne Per-Corpse-Logik.
- **Elite "Gold-Leaf"-Rim:** ein gebackener Bright-Rim-Paletten-Index, den nur Elites/Champions aufleuchten lassen → Eliteness liest als glänzende Metallkante, Steam-Screenshot-Politur.

### Performance
Bake verschiebt **allen** Per-Entity-Art-Cost offline: Runtime = fertige Pixel-Frames in EINEM geteilten Atlas pro Typ, durch den ParticleContainer-Batch (~8 Draw-Calls bei 8000). Per-Entity-Runtime kollabiert auf: Frame-Index wählen, Particle-`x/y/frame/tint` **nur bei Änderung** schreiben (Dirty-Check), `scale.x`-Flip nur bei Facing-Wechsel. Atlas-Budget: ~ein 2–4k-Atlas pro Fraktion (eine Textur-Page), resident. megaLoad-Gating: über 1000 Units kann die Anim-Framerate gedrosselt werden und teure Cues (Auren, Embers, Dust, Damage-Numbers) fallen raus — der gebackene Base-Frame ist der einzige garantierte Cost.

---

## 5. Worldgen & Terrain

### Die Entscheidung
**Zufalls-Rechtecke raus → deterministische Seed-getriebene Pipeline rein**, die eine autoritative Cartesian-`Heightmap` (fBm Simplex/Value-Noise) + abgeleitete Schichten (Sea-Level, Flüsse via Downhill-Flow, Küsten/Beaches, Täler, Hügel, Berge, Biome) in ein Tile-Grid backt. Welt bleibt 9000×9000. **Terrain wird echte Sim-Daten:** Wasser/Cliffs impassable, Slopes verlangsamen, Ridgelines = High-Ground, Täler = Chokepoints.

### Datenmodell (alles in `src/sim/terrain/`, deterministisch)
`TerrainGrid` ist die Spine. `TILE=75px` → 120×120-Grid (14.400 Zellen). Per-Zelle **Structure-of-Arrays** (typed Arrays, GC-frei):
- `height: Float32Array` (0..1 + kontinuierliches `elevationMeters`-Mapping)
- `biome: Uint8Array` (deep_water, shallow_water, beach, grass, forest, dirt/valley, rock, snow)
- `flags: Uint8Array` (Bitfield: IMPASSABLE, SLOW, HIGH_GROUND, RIVER, COAST)
- `flowDir: Uint8Array` (8-Dir Downhill für Flüsse/Erosion)
- `moveCostMul: Float32Array`

O(1)-Queries: `heightAt(x,y)`, `biomeAt(x,y)`, `isPassable(x,y,w,h)` (AABB-vs-Flag-Scan über die wenigen überlappten Zellen), `moveMul(x,y)`, `edgeNormalAt(x,y)` (Gradient für smoothes Wall-Sliding statt Hard-Stop).

### Generierung (server-seitig, reine Funktion des Seeds, `src/sim/terrain/generate.ts`)
Phasen konsumieren **geforkte Sub-Streams** des Szenen-`Rng` (gleiche Fork-Disziplin wie SafeZone, sodass Hinzufügen/Entfernen einer Phase keine andere verschiebt):
1. **Base-Height** = fBm OpenSimplex/Value-Noise, 5–6 Oktaven, einmal domain-warped; radialer Falloff zur Weltkante → zentrale Landmasse, umringt von Meer (saubere BR-Grenze, niemand läuft off-world).
2. **Sea-Level** = fixe normalisierte Schwelle (~0,38); darunter Wasser, deep/shallow via zweite Schwelle.
3. **Coast/Beach** = Zellen neben Wasser über Sea-Level innerhalb eines schmalen Bandes.
4. **Hydraulik-lite Flüsse** = Downhill-`flowDir` (Steepest-Descent, deterministischer Tie-Break per Zell-Index), Flow-Akkumulation von High-Rainfall-Quellen, Zellen über Threshold → RIVER (leicht tiefer + shallow + SLOW; Furten wo sie Tiefland kreuzen).
5. **Slope** = Central-Difference-Gradient → steile Zellen → rock/cliff; über Slope-Threshold → IMPASSABLE, sanfter → SLOW + HIGH_GROUND bei hoher Elevation.
6. **Biome** per `(Elevation-Band × Slope × Moisture-aus-Noise)`.
7. **Landmark-Stamping (deterministisch):** zentrales Plateau/Mesa (King-of-the-Hill mit Ruinen-Keep), 2–3 garantierte Gebirgspässe (Chokepoints, damit die Map nie voll zugemauert ist), River-Fords.
8. **Flags/Move-Cost** aus Biome+Slope+Wasser backen.

### Autotiling & Iso-Rendering (client-only, `src/render/terrain/`)
Der Sim schert sich nicht um Seams (liest nur Height/Flags). Der Render nutzt Marching-Squares-16-Case-Autotiling auf Biome-Grenzen (Gras→Sand→Wasser smooth), **einmal** in die Chunk-RenderTexture gebacken. Elevation als diskrete Iso-"Steps" (terrassierte Bänder) mit gebackenem Drop-Shadow/Cliff-Face auf der Downhill-Kante — das verkauft 2.5D-Tiefe auf einer reinen 2D-Projektion. Chunks (z.B. 16×16 Tiles) werden **einmal** in eine RenderTexture gebacken (Tiles + Autotile + Cliff-Faces + AO + statisches Decor); nur kamera-residente Chunks bleiben in VRAM (LOD/Cull). Entities tiefensortieren gegen Terrain per projiziertem Screen-Y → eine Unit hinter einem Hügel wird von dessen gebackener Silhouette verdeckt.

### Gameplay-Integration (Terrain als autoritative Daten)
- **Movement** (`Unit.update`) multipliziert den Step mit `terrain.moveMul(x,y)`; bei IMPASSABLE-Treffer **slide** entlang `edgeNormalAt` statt Hard-Stop.
- **`resolveUnitTerrainCollisions`** (spiegelt `resolveUnitObstacleCollisions`) schiebt Units per Gradient-Normale aus impassable Zellen.
- **HIGH_GROUND** gibt einen kleinen Read-Time-Combat-Modifier (+Archer-Range / +Melee-von-oben) — symmetrisch, deterministisch, kein State-Leak (wie `kingProgression`).
- **Forests** werden Biome (soft-cover SLOW + Concealment) statt Hard-AABB-Wall; Wasser/Cliffs bleiben hard-impassable.
- **SafeZone.pickShrinkTarget** rejection-sampled passable Land-Becken → der finale Kreis landet auf fightbarem Boden, nicht im offenen Ozean.
- **Obstacle/Forest-AABBs werden als Worldgen-Primitive retired**; ihre Collision-Rolle wandert in die Per-Zell-Flag-Query (billiger, grid-nativ). Gebäude/Towers/PowerUps werden via deterministische Rejection-Sampling nur auf passable Land platziert (Dörfer bevorzugen Täler, Towers krönen Ridges). Die `SpatialGrid` bleibt für dynamische Entities; Terrain-Passierbarkeit ist ein **paralleles statisches Feld** (keine 14.400 statischen Tiles in den dynamischen Grid stopfen).

### Kreative Worldgen-Ideen
- **Zentrales umkämpftes Plateau/Mesa** mit Ruinen-Keep, auf das die finale SafeZone biased konvergiert → garantierte epische Last-Stand-Geografie pro Match.
- **Gebirgspässe als deterministische Chokepoints** → Hordes trichtern und prallen an vorhersehbaren Engstellen (der "Thermopylae"-Moment) statt auf einem featurelosen Feld.
- **River-Fords** als umkämpfte Map-Objektive, die Hordes zusammenziehen.
- **Dynamische SafeZone über echtem Terrain:** der Sturm ertränkt sichtbar zuerst Küsten und trichtert Überlebende auf Land-Becken/Plateaus.
- **Biome-getriebenes Decor aus demselben Seed:** Forest→Bäume, Gipfel→Schnee, Beach→Schilf; das bestehende Day/Night-Tint spielt darüber.
- **Landmark-Beacons auf der Minimap:** Plateau/Pässe/Fords/Keep als benannte POIs für Callouts.

### Performance
Generierung: einmalig, reine Funktion des Seeds, ~14.400 Zellen über ~8 Phasen = wenige ms; SoA = null Per-Frame-GC. Rendering: **keine** Per-Tile-Sprites zur Laufzeit — jeder Chunk **einmal** in RenderTexture gebacken → ganzes Terrain = eine Handvoll statischer Draw-Calls, egal wie groß die Map. Gameplay-Queries O(1): `heightAt`/`biomeAt`/`moveMul` sind Array-Index-Math; `isPassable` scant nur die 1–4 Zellen, die eine AABB überlappt. **Keine** Live-SVG/Pixelate-Filter auf dem Hot-Path.

---

## 6. Combat & Abilities

### Die Entscheidung
**Datengetriebenes Ability-System als einzige Combat-Wahrheit.** `src/sim/abilities.ts` mit `ABILITY_DEFS as const` (gespiegelt nach `UNIT_DEFS`/`FACTION_STATS`), keyed by `AbilityId`-String-Union. Jede Def trägt `cooldownMs`, `cost`, `castTimeMs`, `targeting` (self|direction|point|enemy|allies-aura), `category` (shared|faction), `effects[]` (diskriminierte Union reiner Effekt-Deskriptoren) und rein kosmetische `vfx`/`sfx`-Ids.

### Architektur
Drei neue Sim-Dateien + minimale Edits an bestehenden Seams:
- **`src/sim/abilities.ts`**: die `ABILITY_DEFS`-Tabelle + Typen. Effekte = diskriminierte Union: `blink`, `shieldBuff`, `damageRadial`, `damageCone`, `projectileFan`, `healAura`, `applyStatus`, `knockbackRadial`, `summon`.
- **`src/sim/abilityEffects.ts`**: ein reines `applyEffect(effect, caster, world)` pro Effekt-Kind — der **einzige** Ort, an dem Abilities mutieren, ausschließlich via `unit.takeDamage(...)`, `unit.applyStatus(...)`, `scene.spawnProjectile(...)` oder Buff-Timer + `world.abilityRng`. **Jede Ability ist damit eine Liste bereits implementierter Primitive — kein bespoke Code-Pfad in `Unit.ts`.**
- **`src/sim/abilitySystem.ts`**: `tickAbilities(unit, intent, dt, world)` (Mana-Regen, CD-Ticks, Cast/Interrupt, Fire→Effects) + `chooseAbilityIntent(aiKing, world, rng)` (deterministische AI-Policy, sodass Player + AI **einen** Pfad gehen).
- **`src/sim/status.ts`**: `StatusKind`-Union + `applyStatus`/`tickStatus` + Read-Time-`moveSpeedFactor`/`damageTakenFactor` (generalisiert die 7 bestehenden Power-Up-Faktor-Paare in **einen** Mechanismus; slow/haste/root/vulnerable/fortified).

### Runtime-State
Jeder King (Player UND AI) bekommt `AbilitySlots`: `slots: {id, cdTimer}[]` + `mana`/`manaMax`/`manaRegen`. Das ersetzt die verstreuten `dashTimer`/`shieldCooldownTimer`/`isShieldActive`-Felder durch ein uniformes Array. `tickAbilities` läuft einmal pro Unit/Tick: Mana regen, alle `cdTimer` dekrementieren, dann für jeden Slot mit `intent.fire[i] && cdTimer<=0 && mana>=cost`: Mana abziehen, CD reset, `def.effects` durch `applyEffect`. `castTimeMs>0` setzt `castingSlot`+`castTimer` → interruptierbares Telegraph-Fenster.

### Trigger & Replikation (der MP-kritische Teil)
Input wird von `{moveVector, keyDash, keyShield}` generalisiert zu **`PlayerInput { moveVector, abilityFire: boolean[], abilityTarget?: Vec2 }`** (`src/sim/inputs.ts`).
- **Single-Player:** `GameScene.readInput` mappt Space/Q/E/R + Cursor → `PlayerInput`, ruft `tickAbilities` im Per-Unit-Update.
- **Multiplayer:** Client sampelt dasselbe `PlayerInput`, schickt es als Per-Tick-Input (S3-Input-Kanal); der autoritative Server füttert jeden King-Input in dasselbe `tickAbilities` auf seinem deterministischen Tick; Effekt mutiert HP **nur** via `takeDamage`; der Server emittiert `SimEvent.AbilityCast{unitId, abilityId, x, y, dir}` + `AbilityHit{targetId, amount}`, die Clients **rein** für VFX/Telegraphs konsumieren. Der Client wendet Ability-Outcomes **nie** lokal an (außer optionaler kosmetischer Prediction des **eigenen** Blinks, reconciled).

### Geteilte vs. Fraktions-spezifische Abilities (konkret)

**GETEILT (alle Fraktionen):**
- **Dash** (Slot 1): `{category:'shared', cooldownMs:5000, cost:0, targeting:'direction', effects:[{kind:'blink', distance:200}]}` — migriert die heutige Dash 1:1 (beweist den Seam, kein Verhaltens-Drift).
- **Bulwark** (Slot 2, evolviert das alte Shield): Forward-Facing Shieldwall-Status — `−X%` Frontal-Schaden + reflektiert einen Bruchteil geblockter Melee via `takeDamage`. Behält Survivability, fügt Positionierungs-Skill hinzu (schau deine Angreifer an).
- **Rally/Warhorn** (Slot 4, geteilter Command): Caster pulst eine deterministische AoE → nahe verbündete Horde bekommt kurzes Haste+Armor-Status, idle Vassals retargeten auf das Caster-Ziel. Macht aus dem Blob einen gerichteten Speerkopf für ~3s — der zentrale taktische Verb für epische Schlachten, billig (ein Status-Pass über eine Grid-Query).

**FRAKTIONS-SIGNATUREN (Slot 3, Mana-gegated):**
- **Human — Shieldwall + Banner:** kurzer Channel, rootet den Caster, projiziert einen Cone der Projektile hart blockt (löscht eingehende Pfeile im Bogen, deterministischer Geometrie-Test) + slowt Gegner die eintreten. Synergie mit Paladin-Heal-Aura → unbewegbarer Amboss.
- **Elf — Volley (+ Blink-Alt):** deterministischer Fächer von N Pfeilen (fixer Spread, kein RNG) auf einen Ziel-**Punkt** (nicht Unit) → Area-Denial, das Horde-Bewegung antizipiert. Paart mit längerem Through-Units-Blink für Hit-and-Run.
- **Orc — War Stomp / Berserker Charge:** radialer Knockback+Schaden (wiederverwendet die Berserker-AoE-Seam-Math) + gewährt dem Caster einen Rage-Status (Lifesteal + Haste, skaliert mit der Zahl getroffener Gegner) — ein riskanter Snowball-Button.

### Synergie & Telegraph (kreativ)
- **Combo-Tags:** Abilities können einen Status-Tag setzen (`oiled`, `shocked`, `rooted`); andere Abilities lesen `target.status` und triggern Bonus (Volley auf `rooted` Targets crittet; Stomp auf einen `rallied` Ball ist verheerend). Emergente Taktik **rein in Daten** — tiefes Cross-Faction-Teamplay in MP ohne neue Code-Pfade.
- **Telegraph-as-Counterplay:** jeder Cast mit `castTimeMs>0` emittiert `AbilityCast` **bevor** der Effekt resolved → Clients zeichnen einen Boden-Telegraph, Gegner können raus-dashen/-bulwarken. Große Abilities werden lesbar + skillvoll statt Instant-Win.
- **King-Ultimate via `KING_PROGRESSION`:** ein 4./5. fraktions-flavored High-Cost-Slot ab King-Level 4+ → das bestehende Soul-Leveling gatet jetzt auch einen Power-Spike (mehr Grund Souls zu umkämpfen), der Cap verhindert Steamroll.

### Rollen-basierte Attack-Schicht
Der S5-Content-Strom führt Rollen melee/ranged/siege/support/cavalry via `UNIT_DEFS[id].role` ein. `executeAttack` wird rollen-dispatched **Daten** statt Type-Branches: `attack: { kind:'melee'|'projectile'|'lobbed'|'beam', windupMs, recoverMs, range, damage, splash?, projectileId? }`. **Kritisch: der duck-typed Building-Seam (`target.hp -= dmg`) wird auf einen uniformen `takeDamage`-Pfad für ALLE Targets gefixt** (behält Armor/Lifesteal/Knockback/Flash-Hooks). Siege = `lobbed` + `splash`; Support = passive `healAura`-Ability (Paladin generalisiert); Cavalry = melee mit `chargeBonus`-Status (Momentum-Check über Speed-Threshold, kein neues RNG).

### Performance
Abilities laufen im ersten Cut nur auf **Kings** (11 Entities), nie auf der 8000-Vassal-Horde. `tickAbilities` ist O(aktive Kings); Effekt-Resolution nutzt die bestehende `SpatialGrid`-Broadphase (`getEntitiesInBoundingBoxInto`, allokations-frei) wie `tickPaladinAura`/`applyBerserkerAoE` — ein AoE berührt nur die Dutzende Units im Radius, kein O(n²). Die Status-Map ist per-Unit, aber lazy allokiert (Horde trägt selten Status); Read-Time-Faktoren = null Per-Frame-Arbeit ohne aktiven Status. Alle Ability-VFX routen durch das geplante `fxBudget.ts`-megaLoad-Gate + `isOnScreen`-Culling → Spektakel skaliert in der 8000-Entity-Schlacht automatisch runter. Volley ist bounded (N≈5–9), reuse Projektil-Pool. **Kein** Ability allokiert pro Tick.

---

## 7. Masterplan-Integration

Dieses Dokument **erweitert** den Masterplan, **bricht** ihn nicht. Konkret pro Strom:

### S4 — Render → Iso 2.5D (Erweiterung, kein Neustart)
- **S4-P0 (Spike):** bekommt eine **Iso-projizierte + Band-Bucket-Variante** der 8000-Sprite-Probe → beweist Draw-Calls ≈ `Bänder × Typen` + 60fps; GO/NO-GO in `docs/PIXI-SPIKE-RESULTS.md`.
- **S4-P2 (Per-Entity-View):** `UnitView` ist von Tag 1 **Iso** (`zIndex=(wx+wy)`, 4-Way-Facing-Flip, Höhen-Lift, Boden-Schatten) statt top-down.
- **S4-P3 (megaLoad-Pfad):** wird der **`HordeBatcher`** mit Band-Bucket-ParticleContainer.
- **S4-P4 (Cutover):** zusätzlich Battle-Cam-Dolly-Zoom + tiefensortierte FX.
- **Neue Datei `src/render/iso.ts`** (geteilte Projektion für Terrain UND Entity-Sort) wird die Linchpin-Abhängigkeit, früh in S4-P0/P1.
- **SUPERSEDES** die top-down Kamera/flat-DEPTH-z-Bänder: globale Tiefe ist jetzt `(wx+wy)`, die alte DEPTH-Tabelle wird zur **Within-Tile-Sub-Ordering** (shadow<unit<healthbar<fx) demoted.

### S5 — Content + Abilities + Worldgen-Gameplay (Erweiterung)
- **S5-D (Mechanics-Tiefe)** wird zum vollen **Ability-System** (`src/sim/abilities.ts`/`abilityEffects.ts`/`abilitySystem.ts`/`status.ts`), Phasen A–E: (A) Ability-Daten + Effekt-Primitive (Dash/Shield als Daten, **null** Drift hinter Golden-Master) → (B) `PlayerInput.abilityFire[]` + SimEvents + HUD → (C) geteilte Rally+Bulwark → (D) Fraktions-Signaturen → (E) rollen-basierte Attack-Schicht + King-Ultimates.
- **S5-A (`UNIT_DEFS`)** bekommt `role`-Diskriminator + `attack`-Block; **`FACTION_STATS`** bekommt `abilities: AbilityId[]`.
- Terrain-**Gameplay**-Integration (Move-Cost, High-Ground, Chokepoints, land-biased SafeZone) ist Sim-Arbeit und gehört konzeptionell zu S5/S1.

### S6 — Art-Bake-Pipeline + VFX (Erweiterung des Long-Poles)
- **S6-P2 (der Long-Pole)** wird konkret die **`tools/art-bake/`-Pipeline** (Vektor-Quelle → Offline-Bake → Iso-Atlanten + Paletten-LUT) plus der Lizenz-Pivot (LPC raus, CC0/eigen rein) für `mp/main`.
- **S6-P3 (VFX)** bekommt die gebackenen Slash/Dust/Impact-Framelets im geteilten FX-Atlas + Telegraph-Rendering aus `AbilityCast`-SimEvents — alle durch `fxBudget.ts`.
- **`spriteConfig.ts`** wird vom statischen-PNG-Modell zum **Atlas+Anim-Manifest** rewritten.
- **Neue Doku** `docs/ART-PIPELINE.md` (Authoring→Bake→Atlas-Vertrag) + aktualisierte CREDITS.

### NEU — Worldgen-Rework-Workstream (S8)
Ein **neuer Strom S8 — Worldgen & Terrain** (`src/sim/terrain/**` + `src/render/terrain/**`), Phasen: (P0) Heightmap-Core headless+deterministisch → (P1) Flüsse/Slopes/Landmarks/Flags → (P2) Sim-Integration (Move-Cost/Collision/High-Ground/SafeZone-Bias) → (P3) Iso-Terrain-Renderer (Chunk-Bake/Autotiling/Cliffs/LOD) → (P4) Minimap-POIs/Storm-Visuals/Balance. Die **deterministische Heightmap (P0–P2)** gehört auf den S1-Kritischer-Pfad-Seitenarm (sie nutzt `src/sim/rng.ts` + Fork-Disziplin); der **Iso-Renderer (P3)** hängt an S4.

### Wo es auf dem Meilenstein-Pfad sitzt
**Das meiste ist M5/M6 — NACH dem Sim-Fundament + MVP.** Der deterministische Kern (S1) und der MVP (M4: zwei Spieler sehen sich kämpfen) kommen **zuerst** und unverändert.
- **M5:** Iso-Per-Entity-View (S4-P2 wird iso), Iso-megaLoad-Pfad (S4-P3), Heightmap-**Daten** + Sim-Integration (S8-P0–P2, da sie den Sim/Determinismus betreffen und früh in CI gegatet werden müssen).
- **M6:** Art-Bake-Pipeline + Iso-Atlanten (S6-P2), Iso-Terrain-Renderer (S8-P3), VFX/Telegraphs (S6-P3), volles Ability-System Phasen C–E (S5-D), Phaser-Cutover (S4-P4).
- **M7:** Worldgen-Polish (S8-P4), Balance, bleibt Release-Prep.

### Was sich vs. dem aktuellen Masterplan ändert
1. S4-Render-Ziel ist explizit **Iso 2.5D**, nicht top-down (Projektion + Band-Bucket-Sort hinzugefügt).
2. S5-D ist jetzt das volle **datengetriebene Ability-System** mit geteilten + Fraktions-Abilities (statt vage "Mechanics als Daten").
3. S6-P2 ist konkret die **Bake-Pipeline + Lizenz-Pivot** (LPC raus für `mp/main`; Kenney-Lock bleibt nur für SP-`main`).
4. **Neuer Strom S8** (Worldgen/Terrain) ersetzt die Zufalls-Rechteck-Worldgen durch eine deterministische Heightmap, die **autoritative Sim-Daten** ist.

### Was NICHTS davon blockiert oder bricht
**Keine** dieser Erweiterungen blockiert oder bricht die laufende Sim-Foundation-Arbeit (S1):
- Alles Präsentations-seitige (Iso, Bake, VFX) sitzt hinter dem bestehenden Sim/Render-Seam und fasst **null** Sim-Code an.
- Das einzige Sim-seitige Neue ist die **Heightmap als deterministische Cartesian-Daten** — sie nutzt exakt dieselbe geseedete `Rng` + Fork-Disziplin, die S1-P1/P2 bereits etabliert haben (`src/sim/rng.ts`, SafeZone-Pattern), und wird durch denselben Golden-Master/CI-Determinismus-Test gegatet.
- Das Ability-System fasst `Unit.ts` an — aber **hinter dem mandatorischen Golden-Master-Snapshot**, eine Ability/Seam pro Commit, mit Dash/Shield byte-identisch in Phase A (kein Drift). Das fällt unter dieselbe "Unit.ts EINMAL gemeinsam schneiden"-Disziplin, die der Masterplan bereits für S1-P5/S4-P2 vorschreibt.
- Der MVP (M4) bleibt unverändert per-entity, top-down-tauglich; Iso ist ein M5+-Upgrade und kein MVP-Blocker.

---

## 8. Top-Risiken (dedupliziert)

1. **`Unit.ts` (1192 LOC, NULL Coverage) als geteilte Konfliktfläche — höchstes Risiko.** Ability-Slots/Status/Attack-Generalisierung **und** der Iso-View-Extraktion **und** S5-A `UNIT_DEFS` editieren denselben File, während akhulls Loop stündlich committet. *Mitigation:* Alles hinter dem mandatorischen Golden-Master-Snapshot; Dash/Shield byte-identisch in Phase A; eine Ability/Seam pro Commit; den View-aus-`Unit.ts`-Schnitt **EINMAL gemeinsam** mit S1-P5/S4-P2 landen, nicht mehrfach; häufig rebasen.

2. **Determinismus-Lecks in Worldgen + Abilities.** Noise + River-Flow-Tie-Breaks + AI-Ability-Policy müssen **ausschließlich** aus geforkten `Rng`-Streams + integer/Float32-stabiler Math ziehen; jedes `Math.random`/`Date.now`/iteration-order-abhängige Verhalten reintroduziert Desync. *Mitigation:* Gleiche Fork-Disziplin wie SafeZone + Cross-Run-Byte-Identitäts-Test in CI (Heightmap-Arrays **und** Ability-HP/Position über N Ticks).

3. **Batched-Iso-Tiefensortierung ist die trickreichste Integration.** Eine Unit korrekt hinter einem gebackenen Hügel verdeckt **während** sie batched bleibt: zu wenige Bänder = sichtbare Occlusion-Fehler auf Slopes, zu viele = Draw-Call-Creep; Band-Crossing-Churn thrasht Container. *Mitigation:* Band-Count im R0/S4-P0-Spike tunen (Richtung 32–48); Hysterese auf den Band-Key (gleiches Slow/Fast-Pattern); ein geteiltes `iso.ts` + screen-Y-only Sort.

4. **Wobble-Bug + megaLoad-Gate-Vergessen (teuerste VFX-Lektionen).** Jeder Live-Filter (Wasser, Sturm) auf der bewegten Iso-Welt ohne **fixed** `filterArea` lässt statisches Terrain zittern; ein neuer Effekt/Telegraph ohne `fxBudget`-Gate = FPS-Kollaps genau in der spektakulärsten Schlacht. *Mitigation:* Gebackene Tints statt Live-Filter bevorzugt; `filterArea` = projiziertes Map-Rect + Margin; jeder Ability-VFX routet ab Tag 1 durch `fxBudget.ts` + `isOnScreen`.

5. **Lizenz-Long-Pole (Art).** LPC ist CC-BY-SA/GPL-Copyleft → muss für `mp/main` durch CC0/eigene Vektor-Quelle ersetzt werden, sonst ist das ganze Shipped-Set kontaminiert. Das ist Authoring-Aufwand und der **größte Schedule-Risiko-Punkt** dieser Richtung. *Mitigation:* 4-gebackene-Facings+Flip (nicht 8) + ein-Atlas-pro-Typ hält die Bake-Kombinatorik (~1150 Frames) im Rahmen; Pipeline parameterisiert + CI-baked halten.

6. **Pathing/AI für offenes Feld + AABB geschrieben.** Impassable Wasser/Cliffs + Chokepoints können naive Seek-AI an Wänden stapeln. *Mitigation:* Gradient-Edge-Slide zuerst; volles Flow-Field/Navmesh ist v2-Scope (geflaggt, nicht v1).

7. **Building-Seam-Fix ist eine echte (gewünschte) Verhaltensänderung.** `executeAttack` auf uniformes `takeDamage` umzustellen ändert Building-Schadenszahlen leicht (Armor/Hooks greifen jetzt) → der Golden-Master flaggt es; braucht expliziten Accept + `Building.takeDamage`-Shim.

8. **Picking auf erhöhten Tiles.** `screenToWorld` nimmt `elev=0` an → Klick auf eine Unit auf einem Hügel kann mis-targeten. *Mitigation:* gegen die unprojizierte Boden-Ebene picken, dann via `SpatialGrid` zur nächsten Entity auflösen (nicht pixel-exakt).

---

> Verwandt: [MULTIPLAYER-MASTERPLAN.md](./MULTIPLAYER-MASTERPLAN.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [ENGINE-LEARNINGS.md](./ENGINE-LEARNINGS.md). Zeilennummern driften (akhulls Loop committet oft) — bei Abweichung gilt der Code. Dieses Dokument ist ein Living-Doc; Entscheidungen sind fest, Phasen-Details verfeinern sich beim Bauen.
