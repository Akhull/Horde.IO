// public/js/entities/Forest.js
import { AssetManager } from "../core/AssetManager.js";

export class Forest {
  /**
   * @param {number} x - X-Position der Waldfläche (linke obere Ecke)
   * @param {number} y - Y-Position der Waldfläche (linke obere Ecke)
   * @param {number} width - Breite des Waldbereichs (Kollisionsbox)
   * @param {number} height - Höhe des Waldbereichs (Kollisionsbox)
   */
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
  
  // Forest bleibt stationär; update() wird bei Bedarf erweitert.
  update(deltaTime) {
    // Keine Animation – der Wald ist statisch.
  }
  
  /**
   * Zeichnet den Wald, indem das Forest-Bild getiled wird.
   * @param {CanvasRenderingContext2D} ctx - Zeichenkontext
   * @param {number} [cameraX=0] - X-Verschiebung (z. B. Kameraposition)
   * @param {number} [cameraY=0] - Y-Verschiebung (z. B. Kameraposition)
   */
  draw(ctx, cameraX = 0, cameraY = 0) {
    const forestImg = AssetManager.assets.forest;
    if (forestImg.complete && forestImg.naturalWidth && forestImg.naturalHeight) {
      const DESIRED_TILE_WIDTH = 210; // Ca. 3,5-mal so groß wie ein Building (60px)
      const scale = DESIRED_TILE_WIDTH / forestImg.naturalWidth;
      const tileWidth = DESIRED_TILE_WIDTH;
      const tileHeight = forestImg.naturalHeight * scale;
      const cols = Math.ceil(this.width / tileWidth);
      const rows = Math.ceil(this.height / tileHeight);
      
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const dx = this.x - cameraX + i * tileWidth;
          const dy = this.y - cameraY + j * tileHeight;
          ctx.drawImage(forestImg, dx, dy, tileWidth, tileHeight);
        }
      }
    } else {
      // Fallback: Dunkelgrünes Rechteck
      ctx.fillStyle = "#0a4f0a";
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
    }
  }
  
  /**
   * Zeichnet eine vereinfachte Darstellung (z. B. für die Minimap)
   * @param {CanvasRenderingContext2D} ctx - Zeichenkontext
   */
  drawMinimap(ctx) {
    ctx.fillStyle = "#0a4f0a";
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
}
