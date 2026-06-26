import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH } from "../config/gameConfig";

// Nicht begehbares Hindernis (z. B. Wasser). Wälder werden über die Forest-Klasse abgebildet.
export class Obstacle extends Entity {
  readonly type: "water";
  private tile: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
    super(x, y, width, height);
    this.type = "water";
    // Gekacheltes Wasser-Sprite statt einer flachen Fläche. tileScale 0.5 verkleinert
    // die 128px-Kachel auf eine lesbare Wellen-Wiederholung.
    this.tile = scene.add
      .tileSprite(x, y, width, height, "water")
      .setOrigin(0, 0)
      .setTileScale(0.5, 0.5)
      .setDepth(DEPTH.obstacle);
  }

  sync(): void {
    /* statisch */
  }

  destroyView(): void {
    this.tile.destroy();
  }
}
