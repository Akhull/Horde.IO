import { CONFIG, DECOR, DEPTH } from "../config/gameConfig";
import type { GameScene } from "../scenes/GameScene";

// Rein dekorative, NICHT kollidierende Welt-Ausstattung. Die Welt ist 9000x9000 px
// gekacheltes Gras – ohne Dressing wirkt das offene Feld leer und tot. Hier streuen
// wir einmalig (bei der Weltgenerierung) zwei Ebenen:
//   1. Boden-Variations-Flecken: kleine TileSprite-"Lichtungen/Felder" (Erde/Pflaster/
//      Sand/Dunkelgras), die die monotone Gras-Frequenz aufbrechen.
//   2. Einzel-Props: Bäume/Felsen/Büsche/Baumstämme als statische Images.
// Beides ist statisch (kein Per-Frame-Update), liegt unter Gebäuden/Einheiten und
// weicht den Hindernissen (Wald/Wasser) aus. Counts/Tiefen/Alpha stehen in gameConfig.

interface PropDef {
  key: string;
  size: number; // Anzeige-Kantenlänge des (quadratischen) Chips in px
  weight: number; // relative Streuhäufigkeit
  originY: number; // vertikaler Anker (Fuß der Figur sitzt am Streupunkt)
}

// Anzeigegrößen + Anker stammen aus dem visuell verifizierten asset-librarian-Katalog
// (medieval-rts Environment-Props, 128px-Quellen). Bäume seltener, Büsche/Felsen häufiger.
const PROPS: PropDef[] = [
  { key: "decor_tree_big", size: 72, weight: 2, originY: 0.86 },
  { key: "decor_cypress", size: 56, weight: 2, originY: 0.86 },
  { key: "decor_pine", size: 46, weight: 3, originY: 0.82 },
  { key: "decor_bush", size: 36, weight: 5, originY: 0.72 },
  { key: "decor_bush2", size: 40, weight: 5, originY: 0.72 },
  { key: "decor_shrub", size: 36, weight: 4, originY: 0.78 },
  { key: "decor_rock_grey", size: 36, weight: 4, originY: 0.7 },
  { key: "decor_boulder_grey", size: 48, weight: 2, originY: 0.7 },
  { key: "decor_pebble", size: 22, weight: 4, originY: 0.65 },
  { key: "decor_rock_brown", size: 36, weight: 3, originY: 0.7 },
  { key: "decor_boulder_brown", size: 48, weight: 2, originY: 0.7 },
  { key: "decor_log", size: 46, weight: 2, originY: 0.6 },
];

// Boden-Flecken: Dunkelgras blendet praktisch nahtlos (gleicher Farbton), Erde wirkt als
// abgenutzter Boden. Sand selten als Akzent; Pflaster am seltensten (grauer Wash über Gras
// ist am auffälligsten – nur als rarer "Ruinenboden"-Tupfer).
const PATCHES: { key: string; weight: number }[] = [
  { key: "patch_grass_dark", weight: 5 },
  { key: "patch_dirt", weight: 4 },
  { key: "patch_sand", weight: 2 },
  { key: "patch_cobble", weight: 1 },
];

// true, wenn der Punkt (mit Puffer) in einem Hindernis (Wald/Wasser) liegt.
function inObstacle(scene: GameScene, x: number, y: number, pad = 0): boolean {
  for (const o of scene.obstacles) {
    if (x >= o.x - pad && x <= o.x + o.width + pad && y >= o.y - pad && y <= o.y + o.height + pad) return true;
  }
  return false;
}

const sum = (defs: { weight: number }[]): number => defs.reduce((s, d) => s + d.weight, 0);

export function generateDecor(scene: GameScene): void {
  const W = CONFIG.worldWidth;
  const H = CONFIG.worldHeight;

  // WICHTIG (Performance): wir erzeugen je Textur einen ZUSAMMENHÄNGENDEN Block in der
  // Display-Liste (äußere Schleife = Textur, innere = Instanzen). Phaser batcht aufeinander-
  // folgende Objekte gleicher Textur in EINEN Draw-Call -> ~16 Batches statt hunderter
  // Textur-Wechsel. So bleibt selbst dichte Streuung (1000+ Props) billig.

  // ── 1. Boden-Variations-Flecken ───────────────────────────────────────────
  // KEIN setTileScale -> die Kacheln wiederholen sich mit derselben 128px-Frequenz wie der
  // Gras-Boden, sodass besonders die Dunkelgras-Flecken nahtlos einblenden.
  const patchWeight = sum(PATCHES);
  for (const pt of PATCHES) {
    const n = Math.round((DECOR.patches * pt.weight) / patchWeight);
    for (let i = 0; i < n; i++) {
      const w = DECOR.patchMinSize + Math.random() * (DECOR.patchMaxSize - DECOR.patchMinSize);
      const h = DECOR.patchMinSize + Math.random() * (DECOR.patchMaxSize - DECOR.patchMinSize);
      const x = Math.random() * (W - w);
      const y = Math.random() * (H - h);
      // Flecken nicht in/über Hindernissen platzieren (Erde im Wasser sähe falsch aus).
      if (inObstacle(scene, x + w / 2, y + h / 2, 0)) continue;
      scene.add.tileSprite(x, y, w, h, pt.key).setOrigin(0, 0).setDepth(DEPTH.groundPatch).setAlpha(DECOR.patchAlpha);
    }
  }

  // ── 2. Einzel-Props (Bäume/Felsen/Büsche/Stämme) ──────────────────────────
  const propWeight = sum(PROPS);
  for (const def of PROPS) {
    const n = Math.round((DECOR.props * def.weight) / propWeight);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      // Props den Hindernissen ausweichen (kleiner Negativ-Puffer, damit Bäume direkt am
      // Waldrand stehen dürfen, aber nicht mitten im Wald/Wasser).
      if (inObstacle(scene, x, y, -20)) continue;
      const scale = DECOR.minScale + Math.random() * (DECOR.maxScale - DECOR.minScale);
      const size = def.size * scale;
      scene.add
        .image(x, y, def.key)
        .setOrigin(0.5, def.originY)
        .setDisplaySize(size, size)
        .setDepth(DEPTH.decor)
        .setFlipX(Math.random() < 0.5);
    }
  }
}
