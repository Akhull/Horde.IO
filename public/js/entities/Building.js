// public/js/entities/Building.js
import { Entity } from "./Entity.js";

export class Building extends Entity {
  constructor(x, y, buildingType) {
    // Standardgröße 60x60 (anpassen falls nötig)
    super(x, y, 60, 60);
    this.buildingType = buildingType; // z. B. "barn", "house", "tower"
    this.hp = 100;
  }
  
  /**
   * Erzeugt ein PIXI.Sprite für dieses Gebäude anhand des übergebenen Assets.
   * Diese Methode wird in der neuen PixiJS-Architektur verwendet.
   */
  createSprite(assets) {
    // assets.buildings enthält die Image-Objekte für die Gebäude
    let asset = assets.buildings[this.buildingType];
    if (asset && asset.src) {
      let texture = PIXI.Texture.from(asset.src);
      let sprite = new PIXI.Sprite(texture);
      sprite.x = this.x;
      sprite.y = this.y;
      sprite.width = this.width;
      sprite.height = this.height;
      return sprite;
    }
    return null;
  }
  
  /**
   * Fallback-Zeichenmethode für den 2D-Canvas-Kontext (z. B. für Debugging).
   */
  draw(ctx, cameraX, cameraY, assets) {
    // Wähle den entsprechenden Sprite aus dem AssetManager
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
  
  /**
   * Zeichnet das Gebäude in der Minimap.
   */
  drawMinimap(ctx) {
    ctx.fillStyle = "gray";
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}
