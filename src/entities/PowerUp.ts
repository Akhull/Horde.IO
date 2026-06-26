import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH } from "../config/gameConfig";
import type { PowerUpType } from "../types";

// Power-Up: temporäres Tempo oder Schild für den Spielerkönig.
// (Im Original war die Aufsammel-Logik vorhanden, das Spawnen fehlte – hier vervollständigt.)
export class PowerUp extends Entity {
  effectType: PowerUpType;
  duration: number;
  private sprite: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene, x: number, y: number, effectType: PowerUpType, duration = 6000) {
    super(x, y, 28, 28);
    this.effectType = effectType;
    this.duration = duration;
    // speed = gold, shield = himmelblau, damage = rot-orange (aggressive Optik).
    const color = effectType === "speed" ? 0xffd700 : effectType === "shield" ? 0x00bfff : 0xff5722;
    this.sprite = scene.add
      .circle(this.centerX, this.centerY, 14, color, 0.9)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(DEPTH.powerup);
    scene.tweens.add({ targets: this.sprite, scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
  }

  sync(): void {
    /* statisch */
  }

  destroyView(): void {
    this.sprite.destroy();
  }
}
