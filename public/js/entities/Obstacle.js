// public/js/entities/Obstacle.js
import { Entity } from "./Entity.js";

export class Obstacle extends Entity {
  constructor(x, y, width, height, type) {
    super(x, y, width, height);
    // Für Hindernisse, die KEINEN Wald darstellen (z. B. Wasser, Gebäude etc.).
    // Wenn ein Wald benötigt wird, instanziere stattdessen die Forest‑Klasse!
    this.type = type;
  }
  
  /**
   * Erzeugt ein PIXI.Graphics-Objekt, das das Hindernis als gefülltes Rechteck darstellt.
   * @returns {PIXI.Graphics}
   */
  createSprite() {
    const graphics = new PIXI.Graphics();
    // Zeichne das Hindernis in Blau (#3366ff)
    graphics.beginFill(0x3366ff);
    graphics.drawRect(this.x, this.y, this.width, this.height);
    graphics.endFill();
    return graphics;
  }
  
  /**
   * Fallback-Zeichenmethode für den 2D-Canvas-Kontext.
   * Diese Methode wird in der neuen PixiJS-Architektur normalerweise nicht genutzt.
   */
  draw(ctx, cameraX, cameraY) {
    ctx.fillStyle = "#3366ff";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
  }
  
  /**
   * Zeichnet das Hindernis in der Minimap.
   * Wird weiterhin für die Minimap genutzt.
   */
  drawMinimap(ctx) {
    ctx.fillStyle = "#3366ff";
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}
