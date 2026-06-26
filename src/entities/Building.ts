import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH } from "../config/gameConfig";
import type { BuildingType } from "../types";

// Gebäude (Scheune/Haus/Turm). Werden von Einheiten angegriffen und droppen beim
// Zerstören eine Seele.
export class Building extends Entity {
  buildingType: BuildingType;
  hp = 100;
  private sprite: Phaser.GameObjects.Image;
  private barBg: Phaser.GameObjects.Rectangle;
  private barFill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, buildingType: BuildingType) {
    super(x, y, 60, 60);
    this.buildingType = buildingType;

    this.sprite = scene.add
      .image(this.centerX, this.centerY, buildingType)
      .setDisplaySize(this.width, this.height)
      .setDepth(DEPTH.building);

    this.barBg = scene.add
      .rectangle(this.x, this.y - 7, this.width, 5, 0x000000)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.healthbar);
    this.barFill = scene.add
      .rectangle(this.x, this.y - 7, this.width, 5, 0xff0000)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.healthbar);
  }

  sync(): void {
    this.barFill.width = this.width * Phaser.Math.Clamp(this.hp / 100, 0, 1);
  }

  destroyView(): void {
    this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
  }
}
