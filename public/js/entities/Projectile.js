// public/js/entities/Projectile.js
import { Entity } from "./Entity.js";

export class Projectile extends Entity {
  constructor(x, y, target, damage) {
    super(x, y, 35, 7);
    this.target = target;
    this.damage = damage;
    let originX = x + this.width / 2;
    let originY = y + this.height / 2;
    let targetCenterX = target.x + (target.width ? target.width / 2 : 0);
    let targetCenterY = target.y + (target.height ? target.height / 2 : 0);
    let deviationRadius = 10;
    let angleDeviation = Math.random() * 2 * Math.PI;
    targetCenterX += Math.cos(angleDeviation) * deviationRadius;
    targetCenterY += Math.sin(angleDeviation) * deviationRadius;
    let dx = targetCenterX - originX;
    let dy = targetCenterY - originY;
    let d = Math.hypot(dx, dy);
    let T_min = 20;
    let T_desired = (d / 9) + 5;
    let T = Math.max(T_min, T_desired);
    this.vx = dx / T;
    this.vy = dy / T;
    this.vz = (0.5 * 0.15 * T * T - 30) / T;
    this.z = 30;
    this.onGround = false;
    this.groundHitTime = 0;
    this.rotation = Math.atan2(this.vy, this.vx);
    this.expired = false;
  }
  
  update(deltaTime) {
    if (!this.onGround) {
      this.x += this.vx * (deltaTime / 16);
      this.y += this.vy * (deltaTime / 16);
      const gravity = 0.15;
      this.vz -= gravity * (deltaTime / 16);
      this.z += this.vz * (deltaTime / 16);
      if (this.z <= 0) {
        this.z = 0;
        this.onGround = true;
        this.vx = 0;
        this.vy = 0;
        this.groundHitTime = 0;
      }
      this.rotation = Math.atan2(this.vy, this.vx);
      let targetCenterX = this.target.x + (this.target.width ? this.target.width / 2 : 0);
      let targetCenterY = this.target.y + (this.target.height ? this.target.height / 2 : 0);
      let projCenterX = this.x + this.width / 2;
      let projCenterY = this.y + this.height / 2 - this.z;
      if (Math.hypot(targetCenterX - projCenterX, targetCenterY - projCenterY) < 15) {
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
  
  /**
   * Erzeugt ein PIXI.Sprite für das Projektil.
   * Dabei wird das Arrow-Asset verwendet und die Positionierung
   * berücksichtigt die Z-Koordinate (als Höhenoffset).
   * @param {HTMLImageElement} assetsArrow - Das geladene Arrow-Bild aus dem AssetManager.
   * @returns {PIXI.Sprite}
   */
  createSprite(assetsArrow) {
    const texture = PIXI.Texture.from(assetsArrow.src);
    const sprite = new PIXI.Sprite(texture);
    // Position: X bleibt wie, Y wird um den Z-Wert nach oben verschoben (da z als Höhe interpretiert wird)
    sprite.x = this.x;
    sprite.y = this.y - this.z;
    sprite.width = this.width;
    sprite.height = this.height;
    sprite.rotation = this.rotation;
    return sprite;
  }
  
  /**
   * Fallback-Zeichenmethode für den 2D-Canvas-Kontext (Debugging).
   * Diese Methode bleibt erhalten, wird in der PixiJS-Architektur jedoch nicht genutzt.
   */
  draw(ctx, cameraX, cameraY, assetsArrow) {
    ctx.save();
    let angle = Math.atan2(this.vy, this.vx);
    let pivotX = this.width;
    let pivotY = 0;
    ctx.translate(this.x - cameraX + this.width / 2, this.y - cameraY + this.height / 2 - this.z);
    ctx.rotate(angle);
    if (!this.onGround) {
      ctx.drawImage(assetsArrow, -pivotX, -pivotY, this.width, this.height);
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-pivotX, -pivotY, this.width / 2, this.height);
      ctx.clip();
      ctx.drawImage(assetsArrow, -pivotX, -pivotY, this.width, this.height);
      ctx.restore();
    }
    ctx.restore();
  }
}
