import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH, SWAMP } from "../config/gameConfig";

// Begehbares Verlangsamungs-Terrain (erstes nicht-binäres Terrain im Spiel).
// Anders als Forest/Obstacle wird der Sumpf NICHT in resolveUnitObstacleCollisions
// behandelt – Einheiten dürfen hindurch, werden aber per read-time Tempo-Faktor
// (Unit.terrainSpeedFactor) auf SWAMP.slowFactor gebremst. Rein olivgrün getöntes
// Boden-TileSprite unter den Einheiten (DEPTH.swamp).
export class Swamp extends Entity {
  readonly type = "swamp" as const;
  private tile: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
    super(x, y, width, height);

    // Olivgrün-brauner Multiply-Tint, damit die generische Boden-Kachel als Morast
    // statt als Wüsten-Dirt liest. tileScale verkleinert die 128px-Kachel.
    this.tile = scene.add
      .tileSprite(x, y, width, height, "swamp")
      .setOrigin(0, 0)
      .setTileScale(SWAMP.tileScale, SWAMP.tileScale)
      .setTint(SWAMP.tint)
      .setDepth(DEPTH.swamp);
  }

  sync(): void {
    /* statisch */
  }

  destroyView(): void {
    this.tile.destroy();
  }
}
