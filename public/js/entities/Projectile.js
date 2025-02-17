// public/js/entities/Projectile.js
import { Entity } from "./Entity.js";
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";

export class Projectile extends Entity {
  /**
   * @param {number} x - Start-X (linke obere Ecke in der XZ-Ebene)
   * @param {number} z - Start-Z (linke obere Ecke in der XZ-Ebene)
   * @param {Entity} target - Zielentität (erwartet target.position, target.width, target.depth)
   * @param {number} damage - Schaden
   */
  constructor(x, z, target, damage) {
    // Standard: 35 x 7 (Breite x Tiefe)
    super(x, z, 35, 7);
    this.target = target;
    this.damage = damage;
    
    // Verwende this.position (x, z) als Basis; füge separate Höhe hinzu:
    this.elevation = 30; // Start-Höhe
    let originX = x + this.width / 2;
    let originZ = z + this.depth / 2;
    
    let targetCenterX = target.position.x + (target.width ? target.width / 2 : 0);
    let targetCenterZ = target.position.z + (target.depth ? target.depth / 2 : 0);
    
    let deviationRadius = 10;
    let angleDeviation = Math.random() * 2 * Math.PI;
    targetCenterX += Math.cos(angleDeviation) * deviationRadius;
    targetCenterZ += Math.sin(angleDeviation) * deviationRadius;
    
    let dx = targetCenterX - originX;
    let dz = targetCenterZ - originZ;
    let d = Math.hypot(dx, dz);
    let T_min = 20;
    let T_desired = (d / 9) + 5;
    let T = Math.max(T_min, T_desired);
    
    this.vx = dx / T;
    this.vz = dz / T;
    this.vy = (0.5 * 0.15 * T * T - 30) / T;  // vertikale Geschwindigkeit
    this.onGround = false;
    this.groundHitTime = 0;
    this.rotation = Math.atan2(this.vz, this.vx);
    this.expired = false;
    
    this.mesh = null;
  }
  
  /**
   * Erzeugt ein Three.js-Mesh für das Projektil.
   * @param {THREE.Texture} texture - Textur für das Projektil (z. B. Arrow)
   */
  initMesh(texture) {
    const geometry = new THREE.PlaneGeometry(this.width, this.depth);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(this.position.x + this.width / 2, this.elevation + this.depth / 2, this.position.z + this.depth / 2);
    this.mesh.rotation.y = -this.rotation;
    return this.mesh;
  }
  
  update(deltaTime) {
    if (!this.onGround) {
      this.position.x += this.vx * deltaTime / 16;
      this.position.z += this.vz * deltaTime / 16;
      const gravity = 0.15;
      this.vy -= gravity * deltaTime / 16;
      this.elevation += this.vy * deltaTime / 16;
      if (this.elevation <= 0) {
        this.elevation = 0;
        this.onGround = true;
        this.vx = 0;
        this.vz = 0;
        this.groundHitTime = 0;
      }
      this.rotation = Math.atan2(this.vz, this.vx);
      if (this.mesh) {
        this.mesh.position.set(this.position.x + this.width / 2, this.elevation + this.depth / 2, this.position.z + this.depth / 2);
        this.mesh.rotation.y = -this.rotation;
      }
      let targetCenterX = this.target.position.x + (this.target.width ? this.target.width / 2 : 0);
      let targetCenterZ = this.target.position.z + (this.target.depth ? this.target.depth / 2 : 0);
      let projCenterX = this.position.x + this.width / 2;
      let projCenterZ = this.position.z + this.depth / 2;
      if (Math.hypot(targetCenterX - projCenterX, targetCenterZ - projCenterZ) < 15) {
        this.target.hp -= this.damage;
        this.expired = true;
      }
    } else {
      this.groundHitTime += deltaTime;
      if (this.groundHitTime >= 2000) {
        this.expired = true;
      }
    }
  }
}
