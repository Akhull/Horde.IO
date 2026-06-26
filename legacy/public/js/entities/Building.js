// public/js/entities/Building.js
import { Entity } from "./Entity.js";

export class Building extends Entity {
  constructor(x, y, buildingType) {
    // Setze Standardgrößen, z. B. 60x60 (anpassen falls nötig)
    super(x, y, 60, 60);
    this.buildingType = buildingType; // z. B. "barn", "house", "tower"
    this.hp = 100;
  }
  
  // Die draw()-Methode erwartet nun den assets Parameter
  draw(ctx, cameraX, cameraY, assets) {
    // Wähle den entsprechenden Sprite aus dem zentralen AssetManager
    let sprite = assets.buildings[this.buildingType];
    if (sprite && sprite.complete) {
      ctx.drawImage(sprite, this.x - cameraX, this.y - cameraY, this.width, this.height);
    } else {
      ctx.fillStyle = "gray";
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
    }
    
    // Zeichne einen kleinen Lebensbalken oberhalb des Gebäudes
    const barWidth = this.width;
    const barHeight = 5;
    ctx.fillStyle = "black";
    ctx.fillRect(this.x - cameraX, this.y - cameraY - barHeight - 2, barWidth, barHeight);
    ctx.fillStyle = "red";
    ctx.fillRect(this.x - cameraX, this.y - cameraY - barHeight - 2, barWidth * (this.hp / 100), barHeight);
  }
  
  // Optional: Zeichne das Gebäude in der Minimap
  drawMinimap(ctx) {
    ctx.fillStyle = "gray";
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}
