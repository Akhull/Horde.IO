// public/js/entities/Forest.js
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";

export class Forest {
  /**
   * @param {number} x - X-Position (linke obere Ecke in der XZ-Ebene)
   * @param {number} z - Z-Position (linke obere Ecke in der XZ-Ebene)
   * @param {number} width - Breite
   * @param {number} depth - Tiefe
   */
  constructor(x, z, width, depth) {
    this.x = x;
    this.z = z;
    this.width = width;
    this.depth = depth;
    this.mesh = null;
  }
  
  update(deltaTime) {
    // Wald bleibt statisch.
  }
  
  /**
   * Erzeugt ein Three.js-Mesh für den Wald.
   */
  initMesh(assets) {
    const texture = assets.forest;
    if (texture) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const DESIRED_TILE_WIDTH = 210;
      const repeatX = this.width / DESIRED_TILE_WIDTH;
      const repeatY = this.depth / DESIRED_TILE_WIDTH;
      texture.repeat.set(repeatX, repeatY);
    }
    
    const geometry = new THREE.PlaneGeometry(this.width, this.depth);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(this.x + this.width / 2, 0, this.z + this.depth / 2);
    return this.mesh;
  }
  
  /**
   * Fallback für die Minimap.
   */
  drawMinimap(ctx) {
    ctx.fillStyle = "#0a4f0a";
    ctx.fillRect(this.x, this.z, this.width, this.depth);
  }
}
