// public/js/entities/Unit.js
import { Entity } from "./Entity.js";
import * as Utils from "../utils/utils.js";
import { CONFIG } from "../core/config.js";
import * as THREE from "https://unpkg.com/three@0.128.0/build/three.module.js";
import { AssetManager } from "../core/AssetManager.js";

export class Unit extends Entity {
  /**
   * @param {number} x - Start-X (linke obere Ecke in der XZ-Ebene)
   * @param {number} z - Start-Z (linke obere Ecke in der XZ-Ebene)
   * @param {string} faction 
   * @param {string} unitType - "king", "archer" oder "vassal"
   * @param {number} level 
   * @param {Unit|null} leader 
   * @param {THREE.Texture|HTMLImageElement|null} texture - Falls vorhanden, wird diese Textur für den Sprite genutzt.
   */
  constructor(x, z, faction, unitType, level = 1, leader = null, texture = null) {
    super(x, z, 40, 40); // Standard: 40x40 (Breite x Tiefe)
    this.faction = faction;
    this.unitType = unitType;
    this.level = level;
    this.texture = texture; // Optionale Sprite-Textur
    if (unitType === "king" || unitType === "vassal") {
      this.slashEffect = null;
    }
    if (unitType === "king") {
      this.team = Unit.nextTeamId++;
      this.hp = 300;
      this.speed = 1.35 * 1.88;
      this.dashTimer = Unit.dashCooldown;
      this.lastDirection = { x: 0, z: 0 };
      this.shieldCooldownTimer = Unit.shieldAbilityCooldown;
      this.shieldTimer = 0;
      this.isShieldActive = false;
      this.leader = this;
      // Erhöhe die Größe für bessere Sichtbarkeit
      this.width = 100;
      this.depth = 100;
      this.vassalSpawnTimer = 0;
      this.isAttacking = false;
      this.attackTimer = 0;
      this.attackDamageDealt = false;
      this.currentTarget = null;
    } else if (unitType === "archer") {
      this.team = leader.team;
      this.hp = 100;
      this.speed = 1.2 * 1.88;
      this.leader = leader;
      this.attackCooldown = 2000;
      this.lastAttackTimer = 0;
      this.formationOffset = null;
      this.formationTimer = 0;
      // Erhöhe auch die Größe von Archers
      this.width = 60;
      this.depth = 60;
    } else {
      this.team = leader.team;
      this.hp = 100;
      this.speed = 1.35 * 0.95 * 1.88;
      this.leader = leader;
      this.formationOffset = null;
      this.formationTimer = 0;
      if (this.level === 1) {
        this.width = 60;
        this.depth = 60;
      } else if (this.level === 2) {
        this.width = 60 * 1.1;
        this.depth = 60 * 1.1;
      } else if (this.level === 3) {
        this.width = 60 * 1.2;
        this.depth = 60 * 1.2;
      }
      this.isAttacking = false;
      this.attackTimer = 0;
      this.attackDamageDealt = false;
      this.currentTarget = null;
    }
    this.idleTarget = null;
    this.dead = false;
    
    // Erstelle die 3D-Darstellung (Sprite) für diese Einheit
    this.initMesh();
  }
  
  initMesh() {
    // Falls keine Textur übergeben wurde, verwende den Standard-Sprite aus dem AssetManager.
    if (!this.texture) {
      if (this.unitType === "king") {
        this.texture = AssetManager.assets.factions[this.faction].king;
      } else {
        if (this.level === 1) {
          this.texture = AssetManager.assets.factions[this.faction].level1;
        } else if (this.level === 2) {
          this.texture = AssetManager.assets.factions[this.faction].level2;
        } else {
          this.texture = AssetManager.assets.factions[this.faction].level3;
        }
      }
    }
    
    if (this.texture) {
      let spriteTexture;
      if (this.texture instanceof THREE.Texture) {
        spriteTexture = this.texture;
      } else {
        spriteTexture = new THREE.Texture(this.texture);
        spriteTexture.needsUpdate = true;
      }
      const material = new THREE.SpriteMaterial({ 
        map: spriteTexture, 
        transparent: true,
        alphaTest: 0.5  // Verhindert unsaubere Kanten
      });
      // Hier belassen wir den Standard-Center (0.5, 0.5)
      // Wir korrigieren die Positionierung in update() so, dass die untere Kante am Boden liegt.
      this.mesh = new THREE.Sprite(material);
      this.mesh.scale.set(this.width, this.depth, 1);
    } else {
      // Fallback: Erstelle ein farbiges Plane-Mesh
      const geometry = new THREE.PlaneGeometry(this.width, this.depth);
      geometry.translate(this.width / 2, 0, this.depth / 2);
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide
      });
      this.mesh = new THREE.Mesh(geometry, material);
    }
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
  }
  
  update(deltaTime, game) {
    let centerX = this.position.x + this.width / 2;
    let centerZ = this.position.z + this.depth / 2;
    let dxSafe = centerX - game.safeZoneCurrent.centerX;
    let dzSafe = centerZ - game.safeZoneCurrent.centerZ;
    let distSafe = Math.hypot(dxSafe, dzSafe);
    
    if (distSafe > game.safeZoneCurrent.radius) {
      if (this.unitType === "king") {
        let dx = game.safeZoneCurrent.centerX - centerX;
        let dz = game.safeZoneCurrent.centerZ - centerZ;
        let d = Math.hypot(dx, dz);
        if (d > 0) {
          this.position.x += (dx / d) * this.speed * (deltaTime / 16);
          this.position.z += (dz / d) * this.speed * (deltaTime / 16);
        }
      } else if (this.leader && this.leader.unitType === "king") {
        let leaderCenterX = this.leader.position.x + this.leader.width / 2;
        let leaderCenterZ = this.leader.position.z + this.leader.depth / 2;
        let leaderDist = Math.hypot(leaderCenterX - game.safeZoneCurrent.centerX, leaderCenterZ - game.safeZoneCurrent.centerZ);
        if (leaderDist <= game.safeZoneCurrent.radius) {
          let dx = game.safeZoneCurrent.centerX - centerX;
          let dz = game.safeZoneCurrent.centerZ - centerZ;
          let d = Math.hypot(dx, dz);
          if (d > 0) {
            this.position.x += (dx / d) * this.speed * (deltaTime / 16);
            this.position.z += (dz / d) * this.speed * (deltaTime / 16);
          }
          return;
        }
      } else {
        let dx = game.safeZoneCurrent.centerX - centerX;
        let dz = game.safeZoneCurrent.centerZ - centerZ;
        let d = Math.hypot(dx, dz);
        if (d > 0) {
          this.position.x += (dx / d) * this.speed * (deltaTime / 16);
          this.position.z += (dz / d) * this.speed * (deltaTime / 16);
        }
        return;
      }
    }
    
    if (this.unitType === "vassal") {
      let dxKing = (this.leader.position.x + this.leader.width / 2) - (this.position.x + this.width / 2);
      let dzKing = (this.leader.position.z + this.leader.depth / 2) - (this.position.z + this.depth / 2);
      if (Math.hypot(dxKing, dzKing) > 750) {
        let d = Math.hypot(dxKing, dzKing);
        if (d > 0) {
          this.position.x += (dxKing / d) * this.speed * (deltaTime / 16);
          this.position.z += (dzKing / d) * this.speed * (deltaTime / 16);
        }
        return;
      }
      if (!this.leader || !game.units.includes(this.leader)) { 
        this.hp = 0; 
      }
      let targetInfo = Utils.determineVassalTarget(this, game);
      if (targetInfo && targetInfo.type === "attack") {
        let dx = targetInfo.x - this.position.x;
        let dz = targetInfo.y - this.position.z;
        let d = Math.hypot(dx, dz);
        const meleeThreshold = 50;
        if (d <= meleeThreshold) {
          if (!this.isAttacking) {
            this.isAttacking = true;
            this.attackTimer = 500;
            this.attackDamageDealt = false;
            this.currentTarget = targetInfo.target;
          }
        } else {
          if (!this.isAttacking) {
            this.position.x += (dx / d) * this.speed * (deltaTime / 16);
            this.position.z += (dz / d) * this.speed * (deltaTime / 16);
          }
        }
      } else {
        if (!this.isAttacking) {
          let targetInfo = Utils.determineVassalTarget(this, game);
          if (targetInfo) {
            let dx = targetInfo.x - this.position.x;
            let dz = targetInfo.y - this.position.z;
            let d = Math.hypot(dx, dz);
            if (d > 5) {
              this.position.x += (dx / d) * this.speed * (deltaTime / 16);
              this.position.z += (dz / d) * this.speed * (deltaTime / 16);
            }
          }
        }
      }
      if (this.isAttacking) {
        this.attackTimer -= deltaTime;
        if (this.attackTimer < 250 && !this.attackDamageDealt) {
          if (this.currentTarget && !this.currentTarget.dead) {
            this.currentTarget.hp -= 20;
          }
          this.attackDamageDealt = true;
          if (!this.slashEffect) {
            let unitCenterX = this.position.x + this.width / 2;
            let unitCenterZ = this.position.z + this.depth / 2;
            let attackAngle;
            if (this.currentTarget) {
              let targetCenterX = this.currentTarget.position.x + (this.currentTarget.width ? this.currentTarget.width / 2 : 0);
              let targetCenterZ = this.currentTarget.position.z + (this.currentTarget.depth ? this.currentTarget.depth / 2 : 0);
              attackAngle = Math.atan2(targetCenterZ - unitCenterZ, targetCenterX - unitCenterX);
            } else if (this.lastDirection && (this.lastDirection.x || this.lastDirection.z)) {
              attackAngle = Math.atan2(this.lastDirection.z, this.lastDirection.x);
            } else {
              attackAngle = 0;
            }
            let rotation = attackAngle - 2.35619449;
            this.slashEffect = {
              x: unitCenterX,
              y: unitCenterZ,
              rotation: rotation,
              alpha: 0.5,
              timer: 500
            };
          }
        }
        if (this.attackTimer <= 0) {
          this.isAttacking = false;
          this.attackTimer = 0;
          this.attackDamageDealt = false;
          this.currentTarget = null;
        }
      }
    }
    else if (this.unitType === "archer") {
      this.lastAttackTimer += deltaTime;
      const attackRange = 300;
      let target = null, bestDist = Infinity;
      for (let other of game.units) {
        if (other.team !== this.team && !other.dead) {
          let otherCenterX = other.position.x + other.width / 2;
          let otherCenterZ = other.position.z + other.depth / 2;
          if (Math.hypot(otherCenterX - game.safeZoneCurrent.centerX, otherCenterZ - game.safeZoneCurrent.centerZ) > game.safeZoneCurrent.radius)
            continue;
          let dx = otherCenterX - (this.position.x + this.width / 2);
          let dz = otherCenterZ - (this.position.z + this.depth / 2);
          let d = Math.hypot(dx, dz);
          if (d < attackRange && d < bestDist) { bestDist = d; target = other; }
        }
      }
      for (let b of game.buildings) {
        let bCenterX = b.position.x + b.width / 2;
        let bCenterZ = b.position.z + b.depth / 2;
        if (Math.hypot(bCenterX - game.safeZoneCurrent.centerX, bCenterZ - game.safeZoneCurrent.centerZ) > game.safeZoneCurrent.radius)
            continue;
        let dx = bCenterX - (this.position.x + this.width / 2);
        let dz = bCenterZ - (this.position.z + this.depth / 2);
        let d = Math.hypot(dx, dz);
        if (d < attackRange && d < bestDist) { bestDist = d; target = b; }
      }
      if (target) {
        if (this.lastAttackTimer >= this.attackCooldown) {
          let projX = this.position.x + this.width / 2;
          let projZ = this.position.z + this.depth / 2;
          game.projectiles.push(new Utils.ProjectileWrapper(projX, projZ, target, 10));
          this.lastAttackTimer = 0;
        }
      } else {
        let targetInfo = Utils.determineVassalTarget(this, game);
        if (targetInfo) {
          let dx = targetInfo.x - this.position.x;
          let dz = targetInfo.y - this.position.z;
          let d = Math.hypot(dx, dz);
          if (d > 5) {
            this.position.x += (dx / d) * this.speed * (deltaTime / 16);
            this.position.z += (dz / d) * this.speed * (deltaTime / 16);
          }
        }
      }
    }
    else if (this.unitType === "king") {
      if (this === game.playerKing) {
        let moveX = 0, moveY = 0; // moveY entspricht nun der Z-Bewegung
        if (Math.abs(game.joystickVector.x) > 0.1 || Math.abs(game.joystickVector.y) > 0.1) {
          moveX = game.joystickVector.x;
          moveY = game.joystickVector.y;
        } else {
          if (game.inputHandler.keys["w"] || game.inputHandler.keys["W"]) moveY = -1;
          if (game.inputHandler.keys["s"] || game.inputHandler.keys["S"]) moveY = 1;
          if (game.inputHandler.keys["a"] || game.inputHandler.keys["A"]) moveX = -1;
          if (game.inputHandler.keys["d"] || game.inputHandler.keys["D"]) moveX = 1;
        }
        let mag = Math.hypot(moveX, moveY);
        if (mag > 0) {
          moveX /= mag; moveY /= mag;
          this.lastDirection = { x: moveX, z: moveY };
          this.position.x += moveX * this.speed * (deltaTime / 16);
          this.position.z += moveY * this.speed * (deltaTime / 16);
        }
        this.dashTimer += deltaTime;
        if (game.inputHandler.keys[" "] && this.dashTimer >= Utils.CONFIG.dashCooldown && (this.lastDirection.x || this.lastDirection.z)) {
          this.position.x += this.lastDirection.x * Utils.CONFIG.dashDistance;
          this.position.z += this.lastDirection.z * Utils.CONFIG.dashDistance;
          this.dashTimer = 0;
        }
        this.shieldCooldownTimer += deltaTime;
        if (game.inputHandler.keys["q"] && this.shieldCooldownTimer >= Utils.CONFIG.shieldAbilityCooldown && !this.isShieldActive) {
          this.isShieldActive = true;
          this.shieldTimer = Utils.CONFIG.shieldAbilityDuration;
          this.shieldCooldownTimer = 0;
        }
        if (this.isShieldActive) {
          this.shieldTimer -= deltaTime;
          if (this.shieldTimer <= 0) { this.isShieldActive = false; }
        }
        if (!this.isAttacking) {
          let targetInfo = Utils.determineVassalTarget(this, game);
          if (targetInfo && targetInfo.type === "attack") {
            let dx = targetInfo.x - this.position.x;
            let dz = targetInfo.y - this.position.z;
            let d = Math.hypot(dx, dz);
            const meleeThreshold = 60;
            if (d <= meleeThreshold) {
              this.isAttacking = true;
              this.attackTimer = 500;
              this.attackDamageDealt = false;
              this.currentTarget = targetInfo.target;
            }
          }
        }
        if (this.isAttacking) {
          this.attackTimer -= deltaTime;
          if (this.attackTimer < 250 && !this.attackDamageDealt) {
            if (this.currentTarget && !this.currentTarget.dead) {
              this.currentTarget.hp -= 20;
            }
            this.attackDamageDealt = true;
            if (!this.slashEffect) {
              let unitCenterX = this.position.x + this.width / 2;
              let unitCenterZ = this.position.z + this.depth / 2;
              let attackAngle;
              if (this.currentTarget) {
                let targetCenterX = this.currentTarget.position.x + (this.currentTarget.width ? this.currentTarget.width / 2 : 0);
                let targetCenterZ = this.currentTarget.position.z + (this.currentTarget.depth ? this.currentTarget.depth / 2 : 0);
                attackAngle = Math.atan2(targetCenterZ - unitCenterZ, targetCenterX - unitCenterX);
              } else if (this.lastDirection && (this.lastDirection.x || this.lastDirection.z)) {
                attackAngle = Math.atan2(this.lastDirection.z, this.lastDirection.x);
              } else {
                attackAngle = 0;
              }
              let rotation = attackAngle - 2.35619449;
              this.slashEffect = {
                x: unitCenterX,
                y: unitCenterZ,
                rotation: rotation,
                alpha: 0.5,
                timer: 500
              };
            }
          }
          if (this.attackTimer <= 0) {
            this.isAttacking = false;
            this.attackTimer = 0;
            this.attackDamageDealt = false;
            this.currentTarget = null;
          }
        }
      } else {
        let targetInfo = Utils.determineVassalTarget(this, game);
        if (targetInfo && targetInfo.type === "attack") {
          let dx = targetInfo.x - this.position.x;
          let dz = targetInfo.y - this.position.z;
          let d = Math.hypot(dx, dz);
          const meleeThreshold = 60;
          if (d <= meleeThreshold) {
            if (!this.isAttacking) {
              this.isAttacking = true;
              this.attackTimer = 500;
              this.attackDamageDealt = false;
              this.currentTarget = targetInfo.target;
            }
          } else {
            if (!this.isAttacking) {
              this.position.x += (dx / d) * this.speed * (deltaTime / 16);
              this.position.z += (dz / d) * this.speed * (deltaTime / 16);
            }
          }
        } else {
          let dodgeVector = { x: 0, z: 0 };
          let kingCenterX = this.position.x + this.width / 2;
          let kingCenterZ = this.position.z + this.depth / 2;
          for (let proj of game.projectiles) {
            if (proj.team !== this.team) {
              let projCenterX = proj.position.x + proj.width / 2;
              let projCenterZ = proj.position.z + proj.depth / 2;
              let dx = kingCenterX - projCenterX;
              let dz = kingCenterZ - projCenterZ;
              let dist = Math.hypot(dx, dz);
              if (dist < 150) {
                let weight = (150 - dist) / 150;
                dodgeVector.x += (dx / dist) * weight;
                dodgeVector.z += (dz / dist) * weight;
              }
            }
          }
          let dxSafeKing = game.safeZoneCurrent.centerX - kingCenterX;
          let dzSafeKing = game.safeZoneCurrent.centerZ - kingCenterZ;
          let distSafeKing = Math.hypot(dxSafeKing, dzSafeKing);
          if (distSafeKing > game.safeZoneCurrent.radius - 100) {
            let inwardWeight = (distSafeKing - (game.safeZoneCurrent.radius - 100)) / 100;
            dodgeVector.x += (dxSafeKing / distSafeKing) * inwardWeight;
            dodgeVector.z += (dzSafeKing / distSafeKing) * inwardWeight;
          }
          let dodgeMag = Math.hypot(dodgeVector.x, dodgeVector.z);
          if (dodgeMag > 0.1) {
            this.position.x += (dodgeVector.x / dodgeMag) * this.speed * (deltaTime / 16);
            this.position.z += (dodgeVector.z / dodgeMag) * this.speed * (deltaTime / 16);
            this.idleTarget = null;
          } else {
            if (!this.idleTarget || Math.hypot(this.idleTarget.x - this.position.x, this.idleTarget.y - this.position.z) < 10) {
              this.idleTarget = { x: Math.random() * CONFIG.worldWidth, y: Math.random() * CONFIG.worldHeight };
            }
            let dx = this.idleTarget.x - this.position.x,
                dz = this.idleTarget.y - this.position.z,
                d = Math.hypot(dx, dz);
            if (d > 0) {
              this.position.x += (dx / d) * this.speed * (deltaTime / 16);
              this.position.z += (dz / d) * this.speed * (deltaTime / 16);
            }
          }
        }
        if (this.isAttacking) {
          this.attackTimer -= deltaTime;
          if (this.attackTimer < 250 && !this.attackDamageDealt) {
            if (this.currentTarget && !this.currentTarget.dead) {
              this.currentTarget.hp -= 20;
            }
            this.attackDamageDealt = true;
            if (!this.slashEffect) {
              let unitCenterX = this.position.x + this.width / 2;
              let unitCenterZ = this.position.z + this.depth / 2;
              let attackAngle;
              if (this.currentTarget) {
                let targetCenterX = this.currentTarget.position.x + (this.currentTarget.width ? this.currentTarget.width / 2 : 0);
                let targetCenterZ = this.currentTarget.position.z + (this.currentTarget.depth ? this.currentTarget.depth / 2 : 0);
                attackAngle = Math.atan2(targetCenterZ - unitCenterZ, targetCenterX - unitCenterX);
              } else if (this.lastDirection && (this.lastDirection.x || this.lastDirection.z)) {
                attackAngle = Math.atan2(this.lastDirection.z, this.lastDirection.x);
              } else {
                attackAngle = 0;
              }
              let rotation = attackAngle - 2.35619449;
              this.slashEffect = {
                x: unitCenterX,
                y: unitCenterZ,
                rotation: rotation,
                alpha: 0.5,
                timer: 500
              };
            }
          }
          if (this.attackTimer <= 0) {
            this.isAttacking = false;
            this.attackTimer = 0;
            this.attackDamageDealt = false;
            this.currentTarget = null;
          }
        }
      }
    }
    
    if (this.slashEffect) {
      this.slashEffect.timer -= deltaTime;
      if (this.slashEffect.timer <= 0) {
        this.slashEffect = null;
      } else {
        this.slashEffect.alpha = 0.5 * (this.slashEffect.timer / 500);
      }
    }
    
    // Setze die Einheit so, dass ihre untere Kante des zentrierten Sprites am Boden liegt.
    if (game.mapGenerator && typeof game.mapGenerator.getHeightAt === "function") {
      const centerX = this.position.x + this.width / 2;
      const centerZ = this.position.z + this.depth / 2;
      const groundY = game.mapGenerator.getHeightAt(centerX, centerZ);
      // Da das Sprite standardmäßig zentriert ist (0.5, 0.5),
      // wollen wir die Einheit so anpassen, dass die untere Hälfte des Sprites (also 0.5 * this.depth) unter der Einheit liegt.
      this.position.y = groundY + (this.depth * 0.5);
    }
    
    // Synchronisiere die 3D-Darstellung (Mesh) mit der Logikposition.
    if (this.mesh) {
      this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    }
  }
  
  // Fallback: Zeichnet die Einheit in 2D (z.B. für die Minimap)
  draw(ctx, cameraX, cameraY, slashImage, assets, playerTeam) {
    if (this.slashEffect) {
      ctx.save();
      ctx.globalAlpha = this.slashEffect.alpha;
      ctx.translate(this.slashEffect.x - cameraX, this.slashEffect.y - cameraY);
      ctx.rotate(this.slashEffect.rotation);
      let spriteWidth = this.width * 2;
      let spriteHeight = this.depth * 2;
      ctx.drawImage(slashImage, -spriteWidth / 2, -spriteHeight / 2, spriteWidth, spriteHeight);
      ctx.restore();
    }
    
    let sprite;
    if (this.unitType === "king") {
      sprite = assets.factions[this.faction].king;
    } else {
      if (this.level === 1) sprite = assets.factions[this.faction].level1;
      else if (this.level === 2) sprite = assets.factions[this.faction].level2;
      else if (this.level === 3) sprite = assets.factions[this.faction].level3;
    }
    
    if (sprite && sprite.complete) {
      ctx.drawImage(sprite, this.position.x - cameraX, this.position.z - cameraY, this.width, this.depth);
    } else {
      ctx.fillStyle = "gray";
      ctx.fillRect(this.position.x - cameraX, this.position.z - cameraY, this.width, this.depth);
    }
    
    const baseBarWidth = this.width;
    let barWidth, barHeight;
    if (this.unitType === "king") {
      barWidth = baseBarWidth * 1.1;
      barHeight = 8;
    } else {
      barWidth = baseBarWidth;
      barHeight = 5;
    }
    const barX = this.position.x - cameraX - (barWidth - this.width) / 2;
    const barY = this.position.z - cameraY - barHeight - 2;
    ctx.fillStyle = "black";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    let maxHP = (this.unitType === "king") ? 300 : 100;
    const healthColor = (this.team === playerTeam) ? "lime" : "red";
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * (this.hp / maxHP), barHeight);
    
    if (this.unitType === "archer") {
      ctx.strokeStyle = "gold";
      ctx.lineWidth = 2;
      ctx.strokeRect(this.position.x - cameraX, this.position.z - cameraY, this.width, this.depth);
    }
    if (this.unitType === "king" && this.isShieldActive) {
      ctx.strokeStyle = "cyan";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.position.x + this.width / 2 - cameraX, this.position.z + this.depth / 2 - cameraY, this.width, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

Unit.nextTeamId = 1;
Unit.dashCooldown = 5000;
Unit.shieldAbilityCooldown = 10000;
