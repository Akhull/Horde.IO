// public/js/entities/Obstacle.js
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";
import { Entity } from "./Entity.js";

export class Obstacle extends Entity {
  /**
   * @param {number} x - X-Position (linke obere Ecke in der XZ-Ebene)
   * @param {number} z - Z-Position (linke obere Ecke in der XZ-Ebene)
   * @param {number} width - Breite
   * @param {number} depth - Tiefe
   * @param {string} type - z.B. "water"
   */
  constructor(x, z, width, depth, type) {
    super(x, z, width, depth);
    this.type = type;
    this.mesh = null;
  }
  
  /**
   * Erzeugt ein Three.js-Mesh für das Hindernis.
   */
  initMesh() {
    const color = 0x3366ff; // Standardblau
    const material = new THREE.MeshBasicMaterial({ color: color });
    const geometry = new THREE.PlaneGeometry(this.width, this.depth);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(this.position.x + this.width / 2, 0, this.position.z + this.depth / 2);
    return this.mesh;
  }
  
  /**
   * Fallback für die Minimap.
   */
  drawMinimap(ctx) {
    ctx.fillStyle = "#3366ff";
    ctx.fillRect(this.position.x, this.position.z, this.width, this.depth);
  }
}
