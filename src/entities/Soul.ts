import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH } from "../config/gameConfig";
import type { SoulType } from "../types";

// Sammelbarer Orb: grün = neuer Vasall, blau = Level-up auf 2, lila = Level-up auf 3,
// gold = legendär (König beschwört einen Champion). Gold ist optisch größer (Rarität).
export class Soul extends Entity {
  soulType: SoulType;
  private sprite: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, x: number, y: number, soulType: SoulType) {
    const size = soulType === "gold" ? 30 : 20;
    super(x, y, size, size);
    this.soulType = soulType;
    this.sprite = scene.add
      .image(this.centerX, this.centerY, `soul_${soulType}`)
      .setDisplaySize(this.width, this.height)
      .setDepth(DEPTH.soul);
    // Sanftes Pulsieren als visueller Reiz
    scene.tweens.add({
      targets: this.sprite,
      scaleX: this.sprite.scaleX * 1.15,
      scaleY: this.sprite.scaleY * 1.15,
      duration: 600,
      yoyo: true,
      repeat: -1,
    });
  }

  sync(): void {
    /* statisch – Position ändert sich nicht */
  }

  destroyView(): void {
    this.sprite.destroy();
  }
}
