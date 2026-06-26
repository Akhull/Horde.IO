// public/js/entities/Obstacle.js
import { Entity } from "./Entity.js";

export class Obstacle extends Entity {
  constructor(x, y, width, height, type) {
    super(x, y, width, height);
    // Für Hindernisse, die KEINEN Wald darstellen (z. B. Wasser, Gebäude etc.).
    // Wenn ein Wald benötigt wird, instanziere stattdessen die Forest‑Klasse!
    this.type = type;
  }
  
  draw(ctx, cameraX, cameraY) {
    // Zeichnet für Nicht-Wald-Objekte immer den Standardfarbton (Blau)
    ctx.fillStyle = "#3366ff";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
  }
  
  drawMinimap(ctx) {
    ctx.fillStyle = "#3366ff";
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}
