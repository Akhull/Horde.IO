// public/js/entities/Entity.js
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";

export class Entity {
  /**
   * @param {number} x - Horizontale Position (X)
   * @param {number} z - Tiefenposition (Z)
   * @param {number} width - Breite
   * @param {number} depth - Tiefe
   */
  constructor(x, z, width, depth) {
    // Position als THREE.Vector3: x, y (Höhe), z
    this.position = new THREE.Vector3(x, 0, z);
    this.width = width;
    this.depth = depth;
  }
  
  update(deltaTime) {
    // Logik wird in Unterklassen überschrieben.
  }
  
  /**
   * Fallback-Methode für 2D-Darstellungen (z.B. Minimap).
   */
  draw(ctx, cameraX, cameraY) {
    ctx.fillStyle = "white";
    ctx.fillRect(this.position.x - cameraX, this.position.z - cameraY, this.width, this.depth);
  }
  
  /**
   * Kollisionsabfrage in der XZ-Ebene.
   */
  intersects(other) {
    return !(this.position.x + this.width < other.position.x ||
             this.position.x > other.position.x + other.width ||
             this.position.z + this.depth < other.position.z ||
             this.position.z > other.position.z + other.depth);
  }
}
