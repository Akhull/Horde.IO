# Eigene Sprites & Animationen einbinden

Das Spiel hat ein eingebautes **Sprite-Sheet-Animationssystem** mit vier
Animationen pro Einheit: **idle**, **walk**, **attack**, **death**.

Standardmäßig ist ein **prozedural erzeugter Demo-Charakter** aktiv (ein kleiner
Krieger, pro Fraktion eingefärbt), damit du Animationen sofort siehst. Sobald du
für eine Einheit ein eigenes Sheet hinterlegst, wird automatisch dieses genutzt.

---

## 1. Was ist ein Sprite-Sheet?

Ein einzelnes PNG, das alle Animations-Einzelbilder (Frames) **gleich groß**
nebeneinander/untereinander enthält. Beispiel mit 64×64-Frames:

```
[idle0][idle1][idle2][idle3][walk0][walk1]...[attack0]...[death0]...
```

Phaser nummeriert die Frames automatisch ab **0** – zeilenweise von links oben.
Du brauchst also nur die **Frame-Größe** und die **Index-Bereiche** je Animation.

Gute Quellen für fertige Sheets: [itch.io](https://itch.io/game-assets/free/tag-sprites),
[OpenGameArt](https://opengameart.org), [Kenney](https://kenney.nl/assets).

## 2. Dateien ablegen

Lege deine PNG-Sheets hier ab:

```
public/sprites/anim/
```

## 3. Im Manifest eintragen

Öffne **`src/config/spriteConfig.ts`** und trage dein Sheet in `REAL_SHEETS` ein.
Der Schlüssel ist der `spriteKey` der Einheit:

| spriteKey | Einheit |
|---|---|
| `human_king`, `elf_king`, `orc_king` | Könige |
| `human_l1`, `human_l2`, `human_l3` | Menschen-Vasallen Stufe 1/2/3 |
| `elf_l1` … `orc_l3` | Elfen-/Ork-Vasallen |

> Bogenschützen nutzen denselben Key wie Vasallen der Stufe 1 (`*_l1`).

```ts
export const REAL_SHEETS: Record<string, SheetDef> = {
  human_king: {
    path: "sprites/anim/human_king.png",
    frameWidth: 64,
    frameHeight: 64,
    anims: {
      idle:   { start: 0,  end: 3,  frameRate: 6,  repeat: -1 }, // -1 = endlos
      walk:   { start: 4,  end: 9,  frameRate: 10, repeat: -1 },
      attack: { start: 10, end: 13, frameRate: 14, repeat: 0  }, //  0 = einmal
      death:  { start: 14, end: 17, frameRate: 10, repeat: 0  },
    },
  },
  // … weitere Einheiten analog
};
```

Das war's – `npm run dev` starten und die Einheit bewegt sich animiert.

## 4. Hinweise

- **Blickrichtung:** Zeichne die Figuren nach **rechts** schauend. Nach links
  spiegelt das Spiel automatisch (kein Extra-Sheet nötig).
- **Nicht alle Animationen nötig:** Fehlt z. B. `death`, wird die Einheit
  einfach ohne Tod-Animation entfernt. Mindestens `idle` wird empfohlen.
- **Größe:** Das Frame wird auf die Einheitengröße skaliert (Vasall ≈ 40 px,
  König ≈ 52 px). Quadratische Frames funktionieren am besten.
- **Demo abschalten:** In `spriteConfig.ts` `USE_DEMO_SPRITES = false` setzen –
  dann nutzen Einheiten ohne eigenes Sheet wieder die alten statischen Sprites.
- **Level-up & Tod** lösen automatisch einen Aufleucht-Pop bzw. die
  Tod-Animation mit Ausblenden aus.

## 5. Wie die Demo-Frames aufgebaut sind (Referenz)

Der Demo-Charakter zeigt das erwartete Layout (12 Frames à 48 px in einer Reihe):

| Frames | Animation |
|---|---|
| 0–1 | idle (Atmen) |
| 2–5 | walk (Beine wechseln) |
| 6–8 | attack (Ausholen → Durchschwingen) |
| 9–11 | death (Umkippen + Ausblenden) |

Den Generator findest du in `src/systems/animations.ts` (`createDemoTexture`) –
nützlich als Vorlage, falls du eigene Frames programmatisch erzeugen willst.
