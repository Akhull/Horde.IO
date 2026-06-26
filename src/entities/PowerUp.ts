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
    // speed = gold, shield = himmelblau, damage = rot-orange (aggressiv),
    // armor = stahl-blaugrau (defensiv/robust), lifesteal = blutrot (Vampir-Sustain),
    // regen = smaragdgrün (Heilung; bewusst gedämpfter/türkiser als das grelle Soul-Grün
    // 0x00ff00 und klar von der goldenen Speed-Orb getrennt).
    const color =
      effectType === "speed"
        ? 0xffd700
        : effectType === "shield"
          ? 0x00bfff
          : effectType === "damage"
            ? 0xff5722
            : effectType === "armor"
              ? 0x9aa7b4
              : effectType === "lifesteal"
                ? 0xb00020
                : 0x2ecc71;
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
