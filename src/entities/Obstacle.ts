import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH } from "../config/gameConfig";

// Nicht begehbares Hindernis (z. B. Wasser). Wälder werden über die Forest-Klasse abgebildet.
export class Obstacle extends Entity {
  readonly type: "water";
  private rect: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
    super(x, y, width, height);
    this.type = "water";
    this.rect = scene.add
      .rectangle(x, y, width, height, 0x3366ff, 0.85)
      .setOrigin(0, 0)
      .setDepth(DEPTH.obstacle);
  }

  sync(): void {
    /* statisch */
  }

  destroyView(): void {
    this.rect.destroy();
  }
}
