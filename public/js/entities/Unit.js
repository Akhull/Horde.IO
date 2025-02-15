// public/js/entities/Unit.js
import { Entity } from "./Entity.js";
import * as Utils from "../utils/utils.js";

export class Unit extends Entity {
  constructor(x, y, faction, unitType, level = 1, leader = null) {
    super(x, y, 40, 40);
    this.faction = faction;
    this.unitType = unitType;
    this.level = level;
    if (unitType === "king" || unitType === "vassal") {
      this.slashEffect = null;
    }
    if (unitType === "king") {
      this.team = Unit.nextTeamId++;
      this.hp = 300;
      this.speed = 1.35 * 1.88;
      this.dashTimer = Unit.dashCooldown;
      this.lastDirection = { x: 0, y: 0 };
      this.shieldCooldownTimer = Unit.shieldAbilityCooldown;
      this.shieldTimer = 0;
      this.isShieldActive = false;
      this.leader = this;
      this.width = 40 * 1.3;
      this.height = 40 * 1.3;
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
      this.width = 40;
      this.height = 40;
    } else {
      this.team = leader.team;
      this.hp = 100;
      this.speed = 1.35 * 0.95 * 1.88;
      this.leader = leader;
      this.formationOffset = null;
      this.formationTimer = 0;
      if (this.level === 1) {
        this.width = 40;
        this.height = 40;
      } else if (this.level === 2) {
        this.width = 40 * 1.1;
        this.height = 40 * 1.1;
      } else if (this.level === 3) {
        this.width = 40 * 1.2;
        this.height = 40 * 1.2;
      }
      this.isAttacking = false;
      this.attackTimer = 0;
      this.attackDamageDealt = false;
      this.currentTarget = null;
    }
    this.idleTarget = null;
    this.dead = false;
  }
  
  update(deltaTime, game) {
    // Berechne den Mittelpunkt dieser Einheit
    let centerX = this.x + this.width / 2,
        centerY = this.y + this.height / 2;
    let dxSafe = centerX - game.safeZoneCurrent.centerX,
        dySafe = centerY - game.safeZoneCurrent.centerY;
    let distSafe = Math.hypot(dxSafe, dySafe);
    
    if (distSafe > game.safeZoneCurrent.radius) {
      if (this.unitType === "king") {
        let dx = game.safeZoneCurrent.centerX - centerX,
            dy = game.safeZoneCurrent.centerY - centerY,
            d = Math.hypot(dx, dy);
        if (d > 0) {
          this.x += (dx / d) * this.speed * (deltaTime / 16);
          this.y += (dy / d) * this.speed * (deltaTime / 16);
        }
      } else if (this.leader && this.leader.unitType === "king") {
        let leaderCenterX = this.leader.x + this.leader.width / 2,
            leaderCenterY = this.leader.y + this.leader.height / 2,
            leaderDist = Math.hypot(leaderCenterX - game.safeZoneCurrent.centerX, leaderCenterY - game.safeZoneCurrent.centerY);
        if (leaderDist <= game.safeZoneCurrent.radius) {
          let dx = game.safeZoneCurrent.centerX - centerX,
              dy = game.safeZoneCurrent.centerY - centerY,
              d = Math.hypot(dx, dy);
          if (d > 0) {
            this.x += (dx / d) * this.speed * (deltaTime / 16);
            this.y += (dy / d) * this.speed * (deltaTime / 16);
          }
          return;
        }
      } else {
        let dx = game.safeZoneCurrent.centerX - centerX,
            dy = game.safeZoneCurrent.centerY - centerY,
            d = Math.hypot(dx, dy);
        if (d > 0) {
          this.x += (dx / d) * this.speed * (deltaTime / 16);
          this.y += (dy / d) * this.speed * (deltaTime / 16);
        }
        return;
      }
    }
    
    // Update-Logik für Vassals
    if (this.unitType === "vassal") {
      let dxKing = (this.leader.x + this.leader.width / 2) - (this.x + this.width / 2),
          dyKing = (this.leader.y + this.leader.height / 2) - (this.y + this.height / 2);
      if (Math.hypot(dxKing, dyKing) > 750) {
        let d = Math.hypot(dxKing, dyKing);
        if (d > 0) {
          this.x += (dxKing / d) * this.speed * (deltaTime / 16);
          this.y += (dyKing / d) * this.speed * (deltaTime / 16);
        }
        return;
      }
      if (!this.leader || !game.units.includes(this.leader)) { 
        this.hp = 0; 
      }
      let targetInfo = Utils.determineVassalTarget(this, game);
      if (targetInfo && targetInfo.type === "attack") {
        let dx = targetInfo.x - this.x,
            dy = targetInfo.y - this.y,
            d = Math.hypot(dx, dy);
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
            this.x += (dx / d) * this.speed * (deltaTime / 16);
            this.y += (dy / d) * this.speed * (deltaTime / 16);
          }
        }
      } else {
        if (!this.isAttacking) {
          let targetInfo = Utils.determineVassalTarget(this, game);
          if (targetInfo) {
            let dx = targetInfo.x - this.x,
                dy = targetInfo.y - this.y,
                d = Math.hypot(dx, dy);
            if (d > 5) {
              this.x += (dx / d) * this.speed * (deltaTime / 16);
              this.y += (dy / d) * this.speed * (deltaTime / 16);
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
            let unitCenterX = this.x + this.width / 2,
                unitCenterY = this.y + this.height / 2;
            let attackAngle;
            if (this.currentTarget) {
              let targetCenterX = this.currentTarget.x + (this.currentTarget.width ? this.currentTarget.width / 2 : 0);
              let targetCenterY = this.currentTarget.y + (this.currentTarget.height ? this.currentTarget.height / 2 : 0);
              attackAngle = Math.atan2(targetCenterY - unitCenterY, targetCenterX - unitCenterX);
            } else if (this.lastDirection && (this.lastDirection.x || this.lastDirection.y)) {
              attackAngle = Math.atan2(this.lastDirection.y, this.lastDirection.x);
            } else {
              attackAngle = 0;
            }
            let rotation = attackAngle - 2.35619449;
            this.slashEffect = {
              x: unitCenterX,
              y: unitCenterY,
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
    // Update-Logik für Archer
    else if (this.unitType === "archer") {
      this.lastAttackTimer += deltaTime;
      const attackRange = 300;
      let target = null, bestDist = Infinity;
      for (let other of game.units) {
        if (other.team !== this.team && !other.dead) {
          let otherCenterX = other.x + other.width / 2;
          let otherCenterY = other.y + other.height / 2;
          if (Math.hypot(otherCenterX - game.safeZoneCurrent.centerX, otherCenterY - game.safeZoneCurrent.centerY) > game.safeZoneCurrent.radius)
            continue;
          let dx = otherCenterX - (this.x + this.width / 2);
          let dy = otherCenterY - (this.y + this.height / 2);
          let d = Math.hypot(dx, dy);
          if (d < attackRange && d < bestDist) { bestDist = d; target = other; }
        }
      }
      for (let b of game.buildings) {
        let bCenterX = b.x + b.width / 2;
        let bCenterY = b.y + b.height / 2;
        if (Math.hypot(bCenterX - game.safeZoneCurrent.centerX, bCenterY - game.safeZoneCurrent.centerY) > game.safeZoneCurrent.radius)
            continue;
        let dx = bCenterX - (this.x + this.width / 2);
        let dy = bCenterY - (this.y + this.height / 2);
        let d = Math.hypot(dx, dy);
        if (d < attackRange && d < bestDist) { bestDist = d; target = b; }
      }
      if (target) {
        if (this.lastAttackTimer >= this.attackCooldown) {
          let projX = this.x + this.width / 2;
          let projY = this.y + this.height / 2;
          game.projectiles.push(new Utils.ProjectileWrapper(projX, projY, target, 10));
          this.lastAttackTimer = 0;
        }
      } else {
        let targetInfo = Utils.determineVassalTarget(this, game);
        if (targetInfo) {
          let dx = targetInfo.x - this.x;
          let dy = targetInfo.y - this.y;
          let d = Math.hypot(dx, dy);
          if (d > 5) {
            this.x += (dx / d) * this.speed * (deltaTime / 16);
            this.y += (dy / d) * this.speed * (deltaTime / 16);
          }
        }
      }
    }
    // Update-Logik für King (Spieler und KI)
    else if (this.unitType === "king") {
      if (this === game.playerKing) {
        let moveX = 0, moveY = 0;
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
          this.lastDirection = { x: moveX, y: moveY };
          this.x += moveX * this.speed * (deltaTime / 16);
          this.y += moveY * this.speed * (deltaTime / 16);
        }
        this.dashTimer += deltaTime;
        if (game.inputHandler.keys[" "] && this.dashTimer >= Utils.CONFIG.dashCooldown && (this.lastDirection.x || this.lastDirection.y)) {
          this.x += this.lastDirection.x * Utils.CONFIG.dashDistance;
          this.y += this.lastDirection.y * Utils.CONFIG.dashDistance;
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
            let dx = targetInfo.x - this.x;
            let dy = targetInfo.y - this.y;
            let d = Math.hypot(dx, dy);
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
              let unitCenterX = this.x + this.width / 2;
              let unitCenterY = this.y + this.height / 2;
              let attackAngle;
              if (this.currentTarget) {
                let targetCenterX = this.currentTarget.x + (this.currentTarget.width ? this.currentTarget.width / 2 : 0);
                let targetCenterY = this.currentTarget.y + (this.currentTarget.height ? this.currentTarget.height / 2 : 0);
                attackAngle = Math.atan2(targetCenterY - unitCenterY, targetCenterX - unitCenterX);
              } else if (this.lastDirection && (this.lastDirection.x || this.lastDirection.y)) {
                attackAngle = Math.atan2(this.lastDirection.y, this.lastDirection.x);
              } else {
                attackAngle = 0;
              }
              let rotation = attackAngle - 2.35619449;
              this.slashEffect = {
                x: unitCenterX,
                y: unitCenterY,
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
          let dx = targetInfo.x - this.x;
          let dy = targetInfo.y - this.y;
          let d = Math.hypot(dx, dy);
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
              this.x += (dx / d) * this.speed * (deltaTime / 16);
              this.y += (dy / d) * this.speed * (deltaTime / 16);
            }
          }
        } else {
          let dodgeVector = { x: 0, y: 0 };
          let kingCenterX = this.x + this.width / 2;
          let kingCenterY = this.y + this.height / 2;
          for (let proj of game.projectiles) {
            if (proj.team !== this.team) {
              let projCenterX = proj.x + proj.width / 2;
              let projCenterY = proj.y + proj.height / 2;
              let dx = kingCenterX - projCenterX;
              let dy = kingCenterY - projCenterY;
              let dist = Math.hypot(dx, dy);
              if (dist < 150) {
                let weight = (150 - dist) / 150;
                dodgeVector.x += (dx / dist) * weight;
                dodgeVector.y += (dy / dist) * weight;
              }
            }
          }
          let dxSafeKing = game.safeZoneCurrent.centerX - kingCenterX;
          let dySafeKing = game.safeZoneCurrent.centerY - kingCenterY;
          let distSafeKing = Math.hypot(dxSafeKing, dySafeKing);
          if (distSafeKing > game.safeZoneCurrent.radius - 100) {
            let inwardWeight = (distSafeKing - (game.safeZoneCurrent.radius - 100)) / 100;
            dodgeVector.x += (dxSafeKing / distSafeKing) * inwardWeight;
            dodgeVector.y += (dySafeKing / distSafeKing) * inwardWeight;
          }
          let dodgeMag = Math.hypot(dodgeVector.x, dodgeVector.y);
          if (dodgeMag > 0.1) {
            this.x += (dodgeVector.x / dodgeMag) * this.speed * (deltaTime / 16);
            this.y += (dodgeVector.y / dodgeMag) * this.speed * (deltaTime / 16);
            this.idleTarget = null;
          } else {
            if (!this.idleTarget || Math.hypot(this.idleTarget.x - this.x, this.idleTarget.y - this.y) < 10) {
              this.idleTarget = { x: Math.random() * Utils.CONFIG.worldWidth, y: Math.random() * Utils.CONFIG.worldHeight };
            }
            let dx = this.idleTarget.x - this.x,
                dy = this.idleTarget.y - this.y,
                d = Math.hypot(dx, dy);
            if (d > 0) {
              this.x += (dx / d) * this.speed * (deltaTime / 16);
              this.y += (dy / d) * this.speed * (deltaTime / 16);
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
              let unitCenterX = this.x + this.width / 2;
              let unitCenterY = this.y + this.height / 2;
              let attackAngle;
              if (this.currentTarget) {
                let targetCenterX = this.currentTarget.x + (this.currentTarget.width ? this.currentTarget.width / 2 : 0);
                let targetCenterY = this.currentTarget.y + (this.currentTarget.height ? this.currentTarget.height / 2 : 0);
                attackAngle = Math.atan2(targetCenterY - unitCenterY, targetCenterX - unitCenterX);
              } else if (this.lastDirection && (this.lastDirection.x || this.lastDirection.y)) {
                attackAngle = Math.atan2(this.lastDirection.y, this.lastDirection.x);
              } else {
                attackAngle = 0;
              }
              let rotation = attackAngle - 2.35619449;
              this.slashEffect = {
                x: unitCenterX,
                y: unitCenterY,
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
  }
  
  // Hinweis: In der neuen PixiJS-Architektur wird die draw()-Methode nicht aufgerufen.
  // Sie bleibt als Fallback/Debugging erhalten.
  draw(ctx, cameraX, cameraY, slashImage, assets, playerTeam) {
    if (this.slashEffect) {
      ctx.save();
      ctx.globalAlpha = this.slashEffect.alpha;
      ctx.translate(this.slashEffect.x - cameraX, this.slashEffect.y - cameraY);
      ctx.rotate(this.slashEffect.rotation);
      let spriteWidth = this.width * 2;
      let spriteHeight = this.height * 2;
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
      ctx.drawImage(sprite, this.x - cameraX, this.y - cameraY, this.width, this.height);
    } else {
      ctx.fillStyle = "gray";
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
    }
    
    // Zeichne den Lebensbalken oberhalb der Einheit.
    const baseBarWidth = this.width;
    let barWidth, barHeight;
    if (this.unitType === "king") {
      barWidth = baseBarWidth * 1.1;
      barHeight = 8;
    } else {
      barWidth = baseBarWidth;
      barHeight = 5;
    }
    const barX = this.x - cameraX - (barWidth - this.width) / 2;
    const barY = this.y - cameraY - barHeight - 2;
    ctx.fillStyle = "black";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    let maxHP = (this.unitType === "king") ? 300 : 100;
    const healthColor = (this.team === playerTeam) ? "lime" : "red";
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * (this.hp / maxHP), barHeight);
    
    if (this.unitType === "archer") {
      ctx.strokeStyle = "gold";
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
    }
    if (this.unitType === "king" && this.isShieldActive) {
      ctx.strokeStyle = "cyan";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x + this.width / 2 - cameraX, this.y + this.height / 2 - cameraY, this.width, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

Unit.nextTeamId = 1;
Unit.dashCooldown = 5000;
Unit.shieldAbilityCooldown = 10000;
