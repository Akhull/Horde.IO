// public/js/entities/Building.js
import { Entity } from "./Entity.js";
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";

export class Building extends Entity {
  /**
   * @param {number} x - X-Position (linke obere Ecke in der XZ-Ebene)
   * @param {number} z - Z-Position (linke obere Ecke in der XZ-Ebene)
   * @param {string} buildingType - z.B. "barn", "house", "tower"
   */
  constructor(x, z, buildingType) {
    // Standardgröße 60x60 (Breite x Tiefe)
    super(x, z, 60, 60);
    this.buildingType = buildingType;
    this.hp = 100;
    this.mesh = null;
  }
  
  /**
   * Erzeugt ein Three.js-Mesh für das Gebäude.
   */
  initMesh(assets) {
    let texture = assets.buildings[this.buildingType];
    let material;
    if (texture) {
      material = new THREE.MeshBasicMaterial({ map: texture });
    } else {
      material = new THREE.MeshBasicMaterial({ color: 0x808080 });
    }
    // BoxGeometry: Breite, Höhe, Tiefe (hier Höhe z.B. 60, anpassbar)
    const height = 60;
    const geometry = new THREE.BoxGeometry(this.width, height, this.depth);
    this.mesh = new THREE.Mesh(geometry, material);
    // Positioniere das Mesh so, dass die Basis auf y=0 liegt.
    this.mesh.position.set(this.position.x + this.width / 2, height / 2, this.position.z + this.depth / 2);
    return this.mesh;
  }
}
