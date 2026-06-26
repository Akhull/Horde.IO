import { Entity } from "./Entity.js";

export class Projectile extends Entity {
  constructor(x, y, target, damage) {
    super(x, y, 35, 7);
    this.target = target;
    this.damage = damage;
    let originX = x + this.width/2;
    let originY = y + this.height/2;
    let targetCenterX = target.x + (target.width ? target.width/2 : 0);
    let targetCenterY = target.y + (target.height ? target.height/2 : 0);
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
    this.trailParticles = [];
    this.trailSpawnTimer = 0;
    this.impactEffectSpawned = false;
  }
  
  update(deltaTime, game) { // Added 'game' parameter
    if (!this.onGround && !this.expired) {
      this.trailSpawnTimer += deltaTime;
      const spawnInterval = 50; // ms
      if (this.trailSpawnTimer >= spawnInterval) {
        const particle = {
          x: this.x + this.width / 2, // Center of the projectile
          y: this.y + this.height / 2,
          z: this.z, // Current height of projectile
          size: Math.random() * 2 + 1, // Random size, e.g., 1-3 pixels
          alpha: 0.8, // Initial alpha
          life: 200,  // Lifetime in ms
          vx: (Math.random() - 0.5) * 0.5, // Slight random velocity X
          vy: (Math.random() - 0.5) * 0.5  // Slight random velocity Y
        };
        this.trailParticles.push(particle);
        this.trailSpawnTimer = 0;
        if (this.trailParticles.length > 10) {
          this.trailParticles.shift();
        }
      }
    }

    for (let i = this.trailParticles.length - 1; i >= 0; i--) {
      const particle = this.trailParticles[i];
      particle.life -= deltaTime;
      particle.x += particle.vx * (deltaTime / 16);
      particle.y += particle.vy * (deltaTime / 16);
      if (particle.life <= 0) {
        this.trailParticles.splice(i, 1);
      } else {
        particle.alpha = 0.8 * (particle.life / 200); // Fade out
      }
    }

    if (!this.onGround) {
      this.x += this.vx * deltaTime / 16;
      this.y += this.vy * deltaTime / 16;
      const gravity = 0.15;
      this.vz -= gravity * deltaTime / 16;
      this.z += this.vz * deltaTime / 16;
      if (this.z <= 0) {
        this.z = 0;
        if (!this.onGround && !this.impactEffectSpawned && game && game.spawnVisualEffect) { // Check !this.onGround to ensure it's the first time
            // Only spawn dirt puff for arrows, not for things that shouldn't stick or puff
            // Assuming 'arrow' is the primary projectile type that does this.
            // If there were other projectile types, one might add a 'type' property to Projectile.
            game.spawnVisualEffect(this.x + this.width/2, this.y + this.height/2 - this.z, {r:139, g:69, b:19}, 8, 200, 3, 0.3);
            if (game.notifyCombatEvent) game.notifyCombatEvent();
            this.impactEffectSpawned = true; 
        }
        this.onGround = true;
        this.vx = 0;
        this.vy = 0;
        this.groundHitTime = 0;
      }
      this.rotation = Math.atan2(this.vy, this.vx);
      let targetCenterX = this.target.x + (this.target.width ? this.target.width/2 : 0);
      let targetCenterY = this.target.y + (this.target.height ? this.target.height/2 : 0);
      let projCenterX = this.x + this.width/2;
      let projCenterY = this.y + this.height/2 - this.z;
      if (Math.hypot(targetCenterX - projCenterX, targetCenterY - projCenterY) < 15) {
        this.target.hp -= this.damage;
        this.expired = true;
        if (!this.impactEffectSpawned && game && game.spawnVisualEffect) {
            game.spawnVisualEffect(this.x + this.width/2, this.y + this.height/2 - this.z, {r:255, g:100, b:0}, 5, 150, 2, 0.5);
            if (game.notifyCombatEvent) game.notifyCombatEvent();
            this.impactEffectSpawned = true;
        }
      }
    } else {
      this.groundHitTime += deltaTime;
      if (this.groundHitTime >= 2000) {
        this.expired = true;
      }
    }

    if (game.grid && !this.onGround && !this.expired) {
        game.grid.updateEntity(this);
    }
  }
  
  draw(ctx, cameraX, cameraY, assetsArrow) {
    // Draw trail particles first
    for (const particle of this.trailParticles) {
      ctx.fillStyle = `rgba(200, 200, 150, ${particle.alpha})`; // Use template literal
      // Adjust y for particle's z height, similar to projectile (positive z means higher)
      let drawY = (particle.y - cameraY - particle.z); 
      ctx.beginPath();
      ctx.arc(particle.x - cameraX, drawY, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    let angle = Math.atan2(this.vy, this.vx);
    let pivotX = this.width;
    let pivotY = 0;
    ctx.translate(this.x - cameraX + this.width/2, this.y - cameraY + this.height/2 - this.z);
    ctx.rotate(angle);
    if (!this.onGround) {
      ctx.drawImage(assetsArrow, -pivotX, -pivotY, this.width, this.height);
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-pivotX, -pivotY, this.width/2, this.height);
      ctx.clip();
      ctx.drawImage(assetsArrow, -pivotX, -pivotY, this.width, this.height);
      ctx.restore();
    }
    ctx.restore();
  }
}
