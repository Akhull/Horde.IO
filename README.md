# Horde.IO — Horde of Kings

Ein browserbasiertes **RTS/Battle-Royale-Hybrid** im Mittelalter-Stil. Du steuerst
einen **König** (Mensch, Elf oder Ork), sammelst **Vasallen** und **Bogenschützen**,
levelst sie über eingesammelte **Seelen** und kämpfst gegen 10 KI-Königreiche —
während ein schrumpfender **Safe-Zone-Kreis** alle ins Zentrum drängt. Der letzte
überlebende König gewinnt.

Dieses Repository enthält **zwei Versionen** desselben Spiels:

| | **Neuauflage (2026)** | **Original (2024)** |
|---|---|---|
| Ort | Projektwurzel (`/`) | [`/legacy`](./legacy) |
| Sprache | **TypeScript** (strict) | Vanilla JavaScript |
| Engine | **Phaser 3** (WebGL) | Rohes `<canvas>` 2D |
| Build | **Vite** | keiner (ES-Module direkt) |
| Architektur | Szenen + Systeme + typisierte Entities | eine grosse `Game`-Klasse |

> Das Original wurde **unverändert** nach `/legacy` verschoben (mit Git-Historie)
> und bleibt voll lauffähig. Die Neuauflage entstand komplett neu daneben —
> ein echter Vorher-Nachher-Vergleich.

---

## 🎮 Die Neuauflage starten

```bash
npm install
npm run dev      # Dev-Server auf http://localhost:5173
```

Produktions-Build:

```bash
npm run build    # Typecheck + Bündelung nach dist/
npm run preview  # gebauten Stand lokal ansehen
```

**Steuerung:** `WASD`/Pfeiltasten = Bewegung · `Leertaste` = Dash · `Q` = Schild.
Auf Touchgeräten erscheinen automatisch ein virtueller Joystick und Aktionsbuttons.

## 🕹️ Das Original starten

```bash
cd legacy
# Singleplayer: legacy/public/index.html direkt im Browser öffnen
# Multiplayer (rudimentär): npm install && node server/server.js   (Port 8080)
```

---

## 🗂️ Projektstruktur (Neuauflage)

```
src/
├── main.ts                 # Phaser-Game-Setup, Szenenliste
├── config/gameConfig.ts    # Spielkonstanten (Welt, Safe-Zone, Einheiten-Werte)
├── types.ts                # gemeinsame Typen
├── scenes/
│   ├── BootScene.ts        # lädt alle Assets, erzeugt Gras-Textur
│   ├── TitleScene / MenuScene / OptionsScene / SelectionScene / GameOverScene
│   ├── GameScene.ts        # Haupt-Loop, Weltzustand, Kamera, Partikel
│   └── HUDScene.ts         # Overlay: Cooldowns, Zähler, Minimap, Mobile-Steuerung
├── entities/               # Unit, Building, Soul, Projectile, Obstacle, Forest, PowerUp
└── systems/
    ├── SpatialGrid.ts      # Broad-Phase-Kollisionen
    ├── SafeZone.ts         # Battle-Royale-Schrumpfkreis (Zustandsautomat)
    ├── AI.ts               # Zielfindung + Formationen
    ├── collision.ts        # Kollisions-/Separationsauflösung
    ├── worldgen.ts         # Welt-Generierung (Könige, Gebäude, Hindernisse, Power-Ups)
    ├── gameplay.ts         # Seelen, Gebäude, Power-Ups, Safe-Zone-Schaden
    └── SoundManager.ts     # Musik + räumliche Soundeffekte + Schlacht-Ambiente
```

### Geteilte Assets
Sprites, Sounds und Musik existieren nur **einmal** unter `legacy/public/assets`.
Die Neuauflage bindet sie über einen Symlink `public/assets → legacy/public/assets`
ein (Vite kopiert sie beim Build automatisch nach `dist/`). So bleibt das Repo
schlank und es gibt nur eine Quelle der Wahrheit.

---

## ✨ Portierte Features

Alle Spielmechaniken des Originals wurden übernommen — und an einigen Stellen
vervollständigt:

- 3 Fraktionen (Mensch/Elf/Ork) mit König + 3 Vasallen-Stufen + Bogenschützen
- KI-Königreiche mit Zielfindung, Formationen, Projektil-Ausweichen
- Seelen-System (neue Vasallen / Level-ups) und zerstörbare Gebäude
- Ballistische Pfeile mit Flughöhe & Schwerkraft
- Schrumpfende, wandernde Safe-Zone mit Schaden ausserhalb
- Dash- & Schild-Fähigkeit mit Cooldowns
- Spatial-Grid-Kollisionen, Separationskräfte
- Räumliches Audio + dynamische Schlacht-Ambience, Tag-/Nacht-Helligkeit
- HUD, Minimap, Partikel, schwebende Texte
- **Neu vervollständigt:** Power-Ups (Tempo/Schild) werden nun tatsächlich
  in der Welt platziert (im Original existierte nur die Aufsammel-Logik).

> **Multiplayer:** Im Original war der Server nur ein Rumpf (synchronisierte
> lediglich Königs-Positionen). Die Neuauflage konzentriert sich auf den
> vollständigen Singleplayer; ein moderner Multiplayer kann später ergänzt werden.
