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
   * Erstellt ein PIXI TilingSprite, das den Wald als getiled Bild darstellt.
   * Falls das Forest-Asset nicht verfügbar ist, wird ein gefülltes Grafik-Objekt zurückgegeben.
   * @returns {PIXI.Sprite|PIXI.Graphics}
   */
  createSprite() {
    const forestImg = AssetManager.assets.forest;
    if (forestImg.complete && forestImg.naturalWidth && forestImg.naturalHeight) {
      // Gewünschte Tile-Breite (hier ca. 210px, anpassbar)
      const DESIRED_TILE_WIDTH = 210;
      // Berechne den Skalierungsfaktor basierend auf der Originalbreite
      const scale = DESIRED_TILE_WIDTH / forestImg.naturalWidth;
      // Erstelle ein Texture-Objekt anhand des Forest-Assets
      const texture = PIXI.Texture.from(forestImg.src);
      // Erzeuge ein TilingSprite, das den Bereich abdeckt
      const tilingSprite = new PIXI.TilingSprite(texture, this.width, this.height);
      // Setze den Skalierungsfaktor für die Tiles
      tilingSprite.tileScale.set(scale, scale);
      // Positioniere das Sprite an der gewünschten Stelle
      tilingSprite.x = this.x;
      tilingSprite.y = this.y;
      return tilingSprite;
    } else {
      // Fallback: Erzeuge ein Grafik-Objekt mit einem dunkelgrünen Rechteck
      const graphics = new PIXI.Graphics();
      graphics.beginFill(0x0a4f0a);
      graphics.drawRect(this.x, this.y, this.width, this.height);
      graphics.endFill();
      return graphics;
    }
  }
  
  /**
   * Gibt eine vereinfachte Darstellung für die Minimap zurück.
   * Hier kannst du beispielsweise ein gefülltes Grafik-Objekt erzeugen.
   * @returns {PIXI.Graphics}
   */
  createMinimapSprite() {
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0x0a4f0a);
    graphics.drawRect(this.x, this.y, this.width, this.height);
    graphics.endFill();
    return graphics;
  }
}
