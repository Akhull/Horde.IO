// public/js/entities/Soul.js
import { Entity } from "./Entity.js";

export class Soul extends Entity {
  constructor(x, y, soulType) {
    super(x, y, 20, 20); // Größe 20x20; ggf. anpassen
    this.soulType = soulType; // "green", "blue" oder "purple"
  }
  
  // draw() erwartet jetzt vier Parameter: ctx, cameraX, cameraY, und assets
  draw(ctx, cameraX, cameraY, assets) {
    // Greife auf das entsprechende Image-Element zu:
    let sprite = assets.souls[this.soulType];
    if (sprite && sprite.complete) {
      ctx.drawImage(sprite, this.x - cameraX, this.y - cameraY, this.width, this.height);
    } else {
      // Fallback: Zeichne einen farbigen Kreis
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
  
  // Optional: Zeichne eine vereinfachte Darstellung in der Minimap
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
