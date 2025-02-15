// public/js/entities/Soul.js
import { Entity } from "./Entity.js";

export class Soul extends Entity {
  constructor(x, y, soulType) {
    super(x, y, 20, 20); // Größe 20x20; ggf. anpassen
    this.soulType = soulType; // "green", "blue" oder "purple"
  }
  
  /**
   * Erzeugt ein PIXI-Objekt (Sprite oder Graphics) zur Darstellung des Souls.
   * @param {object} assets - Das assets-Objekt aus dem AssetManager.
   * @returns {PIXI.Sprite|PIXI.Graphics}
   */
  createSprite(assets) {
    let spriteAsset = assets.souls[this.soulType];
    if (spriteAsset && spriteAsset.complete && spriteAsset.naturalWidth) {
      const texture = PIXI.Texture.from(spriteAsset.src);
      const sprite = new PIXI.Sprite(texture);
      sprite.x = this.x;
      sprite.y = this.y;
      sprite.width = this.width;
      sprite.height = this.height;
      return sprite;
    } else {
      // Fallback: Erzeuge ein PIXI.Graphics-Objekt, das einen farbigen Kreis zeichnet.
      const graphics = new PIXI.Graphics();
      let fillColor;
      if (this.soulType === "green") fillColor = 0x00ff00;
      else if (this.soulType === "blue") fillColor = 0x00ffff;
      else if (this.soulType === "purple") fillColor = 0xff00ff;
      else fillColor = 0xffffff;
      graphics.beginFill(fillColor);
      graphics.drawCircle(this.x + this.width / 2, this.y + this.height / 2, this.width / 2);
      graphics.endFill();
      return graphics;
    }
  }
  
  /**
   * Fallback-Zeichenmethode für den 2D-Canvas-Kontext (Debugging).
   * Wird in der PixiJS-Architektur in der Regel nicht genutzt.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cameraX
   * @param {number} cameraY
   * @param {object} assets
   */
  draw(ctx, cameraX, cameraY, assets) {
    let sprite = assets.souls[this.soulType];
    if (sprite && sprite.complete) {
      ctx.drawImage(sprite, this.x - cameraX, this.y - cameraY, this.width, this.height);
    } else {
      if (this.soulType === "green") {
        ctx.fillStyle = "lime";
      } else if (this.soulType === "blue") {
        ctx.fillStyle = "cyan";
      } else if (this.soulType === "purple") {
        ctx.fillStyle = "magenta";
      } else {
        ctx.fillStyle = "white";
      }
      ctx.beginPath();
      ctx.arc(this.x - cameraX + this.width / 2, this.y - cameraY + this.height / 2, this.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  /**
   * Zeichnet eine vereinfachte Darstellung für die Minimap im 2D-Kontext.
   * @param {CanvasRenderingContext2D} ctx
   */
  drawMinimap(ctx) {
    if (this.soulType === "green") {
      ctx.fillStyle = "lime";
    } else if (this.soulType === "blue") {
      ctx.fillStyle = "cyan";
    } else if (this.soulType === "purple") {
      ctx.fillStyle = "magenta";
    } else {
      ctx.fillStyle = "white";
    }
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}
