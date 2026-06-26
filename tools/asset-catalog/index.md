# Horde.IO – Kenney Asset-Katalog

> Auto-generiert von `tools/build-asset-catalog.mjs`. Lauf: `node tools/build-asset-catalog.mjs`.

**13 Packs · 3762 PNGs · 873 Atlas-Frames.** Alle CC0.

## Laden in Phaser
```ts
// Einzelnes PNG:
this.load.image("orb", "assets/kenney/particle-pack/PNG (Transparent)/light_03.png");
// Atlas (Spritesheet + Kenney-XML) → einzelne Frames per Name ansprechbar:
this.load.atlasXML("td", ".../Tilesheet/towerDefense_tilesheet.png", ".../towerDefense_tilesheet.xml");
this.add.image(x, y, "td", "towerDefense_tile001.png");
```

## Einfärben (1 Sprite → N Farben)
Weiße/neutrale Sprites lassen sich zur Laufzeit gratis tönen — keine Farb-Varianten als Datei nötig:
```ts
sprite.setTint(0x4ade80); // GPU-Multiply, pro Instanz
```
Tint *multipliziert*, funktioniert also nur auf hellen Quellen sauber. Geeignete Basis-Sprites sind je Pack unter **Tint-Basen** gelistet.

## Packs

| Pack | PNGs | Frames | Tint-Basen | Doc |
| --- | ---: | ---: | ---: | --- |
| emotes-pack | 513 | 480 | 0 | [emotes-pack.md](./emotes-pack.md) |
| medieval-rts | 259 | 252 | 0 | [medieval-rts.md](./medieval-rts.md) |
| minimap-pack | 164 | 0 | 0 | [minimap-pack.md](./minimap-pack.md) |
| particle-pack | 193 | 0 | 92 | [particle-pack.md](./particle-pack.md) |
| roguelike-characters | 4 | 0 | 0 | [roguelike-characters.md](./roguelike-characters.md) |
| roguelike-rpg-pack | 5 | 0 | 0 | [roguelike-rpg-pack.md](./roguelike-rpg-pack.md) |
| tiny-battle | 202 | 0 | 0 | [tiny-battle.md](./tiny-battle.md) |
| tiny-dungeon | 136 | 0 | 0 | [tiny-dungeon.md](./tiny-dungeon.md) |
| tiny-town | 136 | 0 | 0 | [tiny-town.md](./tiny-town.md) |
| top-down-shooter | 587 | 54 | 0 | [top-down-shooter.md](./top-down-shooter.md) |
| tower-defense-top-down | 603 | 0 | 0 | [tower-defense-top-down.md](./tower-defense-top-down.md) |
| ui-pack | 870 | 0 | 30 | [ui-pack.md](./ui-pack.md) |
| ui-pack-rpg-expansion | 90 | 87 | 0 | [ui-pack-rpg-expansion.md](./ui-pack-rpg-expansion.md) |
