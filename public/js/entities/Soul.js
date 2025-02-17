// public/js/entities/Soul.js
import { Entity } from "./Entity.js";
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";

export class Soul extends Entity {
  /**
   * @param {number} x - X-Position (linke obere Ecke in der XZ-Ebene)
   * @param {number} z - Z-Position (linke obere Ecke in der XZ-Ebene)
   * @param {string} soulType - "green", "blue" oder "purple"
   */
  constructor(x, z, soulType) {
    super(x, z, 20, 20);
    this.soulType = soulType;
    this.mesh = null;
  }
  
  /**
   * Erzeugt ein Three.js-Sprite für die Soul.
   * @param {Object} assets - Erwartet assets.souls[soulType] als THREE.Texture.
   */
  initMesh(assets) {
    let texture = assets.souls[this.soulType];
    let material;
    if (texture) {
      material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    } else {
      // Fallback: Canvas-Textur
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (this.soulType === "green") ctx.fillStyle = "lime";
      else if (this.soulType === "blue") ctx.fillStyle = "cyan";
      else if (this.soulType === "purple") ctx.fillStyle = "magenta";
      else ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(32, 32, 32, 0, Math.PI * 2);
      ctx.fill();
      texture = new THREE.CanvasTexture(canvas);
      material = new THREE.SpriteMaterial({ map: texture });
    }
    this.mesh = new THREE.Sprite(material);
    this.mesh.scale.set(this.width, this.width, 1);
    // Positioniere etwas über dem Boden (y = Höhe)
    this.mesh.position.set(this.position.x + this.width / 2, 2, this.position.z + this.depth / 2);
    return this.mesh;
  }
  
  /**
   * Fallback für die Minimap.
   */
  drawMinimap(ctx) {
    if (this.soulType === "green") ctx.fillStyle = "lime";
    else if (this.soulType === "blue") ctx.fillStyle = "cyan";
    else if (this.soulType === "purple") ctx.fillStyle = "magenta";
    else ctx.fillStyle = "white";
    ctx.fillRect(this.position.x, this.position.z, this.width, this.depth);
  }
}
