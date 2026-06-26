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
      this.dashReadyFlashTimer = 0; 
      this.shieldReadyFlashTimer = 0;
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
    this.deathSoundPlayed = false;
    this.facingDirection = 1; // 1 for right, -1 for left
    this.isMoving = false;
    this.bobbingOffset = 0;
    this.bobbingPhase = 0;
    this.prevX = x; // Initialize prevX and prevY
    this.prevY = y;
    this.footstepTimer = 0;
    this.footstepIntervalMin = 300; // ms
    this.footstepIntervalMax = 450; // ms
    this.footstepTimer = this.footstepIntervalMin + Math.random() * (this.footstepIntervalMax - this.footstepIntervalMin);
  }
  
  update(deltaTime, game) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.isMoving = false; // Assume not moving this tick

    if (this.hp <= 0 && !this.dead && !this.deathSoundPlayed) {
      if (game.soundManager) {
        let deathSoundName = '';
        if (game.notifyCombatEvent) game.notifyCombatEvent(); // Notify combat event on death
        if (this.faction === 'human') deathSoundName = 'death_human';
        else if (this.faction === 'elf') deathSoundName = 'death_elf';
        else if (this.faction === 'orc') deathSoundName = 'death_orc';
        else deathSoundName = 'death_human'; // Fallback

        let deathVolumeScale = 1.0; // Base for archers/kings
        if (this.unitType === 'vassal') {
            if (this.level === 1) deathVolumeScale = 0.7;
            else if (this.level === 2) deathVolumeScale = 1.0;
            else if (this.level === 3) deathVolumeScale = 1.3;
        } else if (this.unitType === 'king') {
            deathVolumeScale = 1.3; // Kings are loud
        }
        if (deathSoundName) game.soundManager.playSound(deathSoundName, this.x, this.y, deathVolumeScale);
      }
      this.deathSoundPlayed = true;
      // Note: The existing game logic should handle setting 'this.dead = true' or removing the unit.
    }

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
          const moveX = (dxKing / d) * this.speed * (deltaTime / 16);
          if (Math.abs(moveX) > 0.1) {
            this.facingDirection = moveX > 0 ? 1 : -1;
          }
          this.x += moveX;
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
        const horizontalMovement = dx; // dx is targetInfo.x - this.x
        if (d <= meleeThreshold) {
          if (!this.isAttacking) {
            if (Math.abs(horizontalMovement) > 0.1) {
              this.facingDirection = horizontalMovement > 0 ? 1 : -1;
            }
            this.isAttacking = true;
            this.attackTimer = 500;
            this.attackDamageDealt = false;
            this.currentTarget = targetInfo.target;
          }
        } else {
          if (!this.isAttacking) {
            const moveX = (dx / d) * this.speed * (deltaTime / 16);
            if (Math.abs(moveX) > 0.1) {
              this.facingDirection = moveX > 0 ? 1 : -1;
            }
            this.x += moveX;
            this.y += (dy / d) * this.speed * (deltaTime / 16);
          }
        }
      } else {
        if (!this.isAttacking) {
          let targetInfo = Utils.determineVassalTarget(this, game); // Recalculate to get fresh dx
          if (targetInfo) {
            let dxToTarget = targetInfo.x - this.x; // Use a different variable name for clarity
            let dyToTarget = targetInfo.y - this.y;
            let dToTarget = Math.hypot(dxToTarget, dyToTarget);
            if (dToTarget > 5) {
              const moveX = (dxToTarget / dToTarget) * this.speed * (deltaTime / 16);
              if (Math.abs(moveX) > 0.1) {
                this.facingDirection = moveX > 0 ? 1 : -1;
              }
              this.x += moveX;
              this.y += (dyToTarget / dToTarget) * this.speed * (deltaTime / 16);
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
          if (game.soundManager) {
            let attackSoundName = 'attack_melee_l1'; // Default for safety
            let levelVolumeScale = 0.7; // Default for L1

            if (this.unitType === 'king') { // Kings are like L3
                attackSoundName = 'attack_melee_l3';
                levelVolumeScale = 1.3;
            } else if (this.unitType === 'vassal') {
                if (this.level === 1) {
                    attackSoundName = 'attack_melee_l1';
                    levelVolumeScale = 0.7;
                } else if (this.level === 2) {
                    attackSoundName = 'attack_melee_l2';
                    levelVolumeScale = 1.0;
                } else if (this.level === 3) {
                    attackSoundName = 'attack_melee_l3';
                    levelVolumeScale = 1.3;
                }
            }
            game.soundManager.playSound(attackSoundName, this.x, this.y, levelVolumeScale);
            if (game.notifyCombatEvent) game.notifyCombatEvent(); // Notify combat event on attack
          }
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
              timer: 500,
              scale: 0.5
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
          const newProjectile = new Utils.ProjectileWrapper(projX, projY, target, 10);
          game.projectiles.push(newProjectile);
          if (game.grid) game.grid.addEntity(newProjectile); // Add to spatial grid
          if (game.soundManager) {
            game.soundManager.playSound('attack_arrow', this.x, this.y, 1.0);
            if (game.notifyCombatEvent) game.notifyCombatEvent(); // Notify combat event on attack
          }
          this.lastAttackTimer = 0;
        }
      } else {
        let targetInfo = Utils.determineVassalTarget(this, game);
        if (targetInfo) {
          let dxToTarget = targetInfo.x - this.x; // Use a different variable name
          let dyToTarget = targetInfo.y - this.y;
          let dToTarget = Math.hypot(dxToTarget, dyToTarget);
          if (dToTarget > 5) {
            const moveX = (dxToTarget / dToTarget) * this.speed * (deltaTime / 16);
            if (Math.abs(moveX) > 0.1) {
                this.facingDirection = moveX > 0 ? 1 : -1;
            }
            this.x += moveX;
            this.y += (dyToTarget / dToTarget) * this.speed * (deltaTime / 16);
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
          if (Math.abs(moveX) > 0.1) { // Threshold for player king
            this.facingDirection = moveX > 0 ? 1 : -1;
          }
          this.lastDirection = { x: moveX, y: moveY };
          this.x += moveX * this.speed * (deltaTime / 16);
          this.y += moveY * this.speed * (deltaTime / 16);
        }
        const prevDashTimer = this.dashTimer;
        this.dashTimer += deltaTime;
        if (this.dashTimer >= Utils.CONFIG.dashCooldown && prevDashTimer < Utils.CONFIG.dashCooldown) {
            this.dashReadyFlashTimer = 250; //ms
        }
        if (this.dashReadyFlashTimer > 0) this.dashReadyFlashTimer -= deltaTime;

        if (game.inputHandler.keys[" "] && this.dashTimer >= Utils.CONFIG.dashCooldown && (this.lastDirection.x || this.lastDirection.y)) {
          this.x += this.lastDirection.x * Utils.CONFIG.dashDistance;
          this.y += this.lastDirection.y * Utils.CONFIG.dashDistance;
          this.dashTimer = 0;
        }
        
        const prevShieldCooldownTimer = this.shieldCooldownTimer;
        this.shieldCooldownTimer += deltaTime;
        if (this.shieldCooldownTimer >= Utils.CONFIG.shieldAbilityCooldown && prevShieldCooldownTimer < Utils.CONFIG.shieldAbilityCooldown) {
            this.shieldReadyFlashTimer = 250; //ms
        }
        if (this.shieldReadyFlashTimer > 0) this.shieldReadyFlashTimer -= deltaTime;

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
            if (game.soundManager) {
                let attackSoundName = 'attack_melee_l1'; // Default for safety
                let levelVolumeScale = 0.7; // Default for L1

                if (this.unitType === 'king') { // Kings are like L3
                    attackSoundName = 'attack_melee_l3';
                    levelVolumeScale = 1.3;
                } else if (this.unitType === 'vassal') { // Should not happen for player king, but good for AI king
                    if (this.level === 1) { // Player king doesn't have .level, AI kings might if extended
                        attackSoundName = 'attack_melee_l1';
                        levelVolumeScale = 0.7;
                    } else if (this.level === 2) {
                        attackSoundName = 'attack_melee_l2';
                        levelVolumeScale = 1.0;
                    } else if (this.level === 3) {
                        attackSoundName = 'attack_melee_l3';
                        levelVolumeScale = 1.3;
                    }
                }
                 game.soundManager.playSound(attackSoundName, this.x, this.y, levelVolumeScale);
            }
            if (game.soundManager) {
                let attackSoundName = 'attack_melee_l1'; // Default for safety
                let levelVolumeScale = 0.7; // Default for L1

                // AI King is always effectively L3 for sound purposes
                attackSoundName = 'attack_melee_l3';
                levelVolumeScale = 1.3;
                
                game.soundManager.playSound(attackSoundName, this.x, this.y, levelVolumeScale);
                 if (game.notifyCombatEvent) game.notifyCombatEvent(); // Notify combat event on attack
                if (game.notifyCombatEvent) game.notifyCombatEvent(); // Notify combat event on attack
            }
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
                timer: 500,
                scale: 0.5
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
            const moveX = (dx / d) * this.speed * (deltaTime / 16);
            if (Math.abs(moveX) > 0.1) {
              this.facingDirection = moveX > 0 ? 1 : -1;
            }
            this.x += moveX;
              this.y += (dy / d) * this.speed * (deltaTime / 16);
            }
          }
      } else { // AI King Idle/Dodge movement
        let moveX = 0;
        let moveY = 0;
        let determinedMove = false;

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
            moveX = (dodgeVector.x / dodgeMag) * this.speed * (deltaTime / 16);
            moveY = (dodgeVector.y / dodgeMag) * this.speed * (deltaTime / 16);
            this.idleTarget = null;
            determinedMove = true;
          } else {
            if (!this.idleTarget || Math.hypot(this.idleTarget.x - this.x, this.idleTarget.y - this.y) < 10) {
              this.idleTarget = { x: Math.random() * Utils.CONFIG.worldWidth, y: Math.random() * Utils.CONFIG.worldHeight };
            }
            let dxToIdle = this.idleTarget.x - this.x;
            let dyToIdle = this.idleTarget.y - this.y;
            let dToIdle = Math.hypot(dxToIdle, dyToIdle);
            if (dToIdle > 0) {
              moveX = (dxToIdle / dToIdle) * this.speed * (deltaTime / 16);
              moveY = (dyToIdle / dToIdle) * this.speed * (deltaTime / 16);
              determinedMove = true;
            }
          }
          if (determinedMove) {
            if (Math.abs(moveX) > 0.1) {
                this.facingDirection = moveX > 0 ? 1 : -1;
            }
            this.x += moveX;
            this.y += moveY;
          }
        }
        if (this.isAttacking) {
          this.attackTimer -= deltaTime;
          if (this.attackTimer < 250 && !this.attackDamageDealt) {
            if (this.currentTarget && !this.currentTarget.dead) {
              this.currentTarget.hp -= 20;
            }
            this.attackDamageDealt = true;
            if (game.soundManager) game.soundManager.playSound('attack_melee');
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
                timer: 500,
                scale: 0.5
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
        // Calculate progress (0 at start, 1 at end of life)
        let progress = 1 - (this.slashEffect.timer / 500); // 500 is the original lifetime

        // Alpha: Fades out over the whole duration (current behavior)
        this.slashEffect.alpha = 0.5 * (this.slashEffect.timer / 500);

        // Scale:
        // - Quickly expand in the first half of its life (e.g., from 0.5 to 1.2)
        // - Slowly shrink in the second half (e.g., from 1.2 to 0.8)
        if (progress < 0.5) { // First half: expand
            // progress goes 0 to 0.5, so map 2 * progress from 0 to 1
            this.slashEffect.scale = 0.5 + (0.7 * (progress * 2)); // from 0.5 to 1.2
        } else { // Second half: shrink
            // progress goes 0.5 to 1, so map (progress - 0.5) * 2 from 0 to 1
            this.slashEffect.scale = 1.2 - (0.4 * ((progress - 0.5) * 2)); // from 1.2 to 0.8
        }
      }
    }

    // At the end of Unit.update(), before calculating bobbingOffset:
    const movementThreshold = 0.1; // Minimum displacement to be considered movement
    if (Math.abs(this.x - this.prevX) > movementThreshold || Math.abs(this.y - this.prevY) > movementThreshold) {
        this.isMoving = true;
    }

    // Then calculate bobbingOffset based on this.isMoving
    if (this.isMoving) {
        this.bobbingPhase = (this.bobbingPhase || 0) + deltaTime * 0.01; // Adjust speed
        this.bobbingOffset = Math.sin(this.bobbingPhase) * 2; // Adjust amplitude

        this.footstepTimer -= deltaTime;
        if (this.footstepTimer <= 0) {
            this.footstepTimer = this.footstepIntervalMin + Math.random() * (this.footstepIntervalMax - this.footstepIntervalMin);
            
            let footstepBaseVolume = 0.3; 
            if (this.unitType === 'king') {
                footstepBaseVolume = 0.4;
            } else if (this.level === 1) { // Vassals and Archers have levels
                footstepBaseVolume = 0.2;
            }
            // For Archers not L1, or Vassals L2/L3, it remains 0.3 or king's 0.4

            if (game.soundManager) {
                game.soundManager.playSound('footstep', this.x, this.y, footstepBaseVolume, false);
            }
        }
    } else {
        this.bobbingOffset = 0;
        this.bobbingPhase = 0; // Reset phase when not moving
        // Optional: Reset footstep timer if desired, or let it be for next movement
        // For now, timer only counts down when moving.
    }

    if (game.grid && !this.dead) { // Update unit's position in the grid if it's not dead
        game.grid.updateEntity(this);
    }
  }
  
  // draw() erwartet jetzt den Parameter "assets" und zusätzlich "playerTeam" (die Team-ID des Spielers).
  draw(ctx, cameraX, cameraY, slashImage, assets, playerTeam) {
    if (this.slashEffect) {
      ctx.save();
      ctx.globalAlpha = this.slashEffect.alpha;
      ctx.translate(this.slashEffect.x - cameraX, this.slashEffect.y - cameraY);
      ctx.rotate(this.slashEffect.rotation);
      let baseSpriteWidth = this.width * 2; // Original base size
      let baseSpriteHeight = this.height * 2;
      let spriteWidth = baseSpriteWidth * this.slashEffect.scale;
      let spriteHeight = baseSpriteHeight * this.slashEffect.scale;
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
    
    ctx.save();
    if (this.facingDirection === -1) {
        ctx.translate((this.x - cameraX) + this.width, (this.y - cameraY) + this.bobbingOffset);
        ctx.scale(-1, 1);
        if (sprite && sprite.complete) {
            ctx.drawImage(sprite, 0, 0, this.width, this.height);
        } else {
            ctx.fillStyle = "gray"; // Fallback if sprite not loaded
            ctx.fillRect(0, 0, this.width, this.height);
        }
    } else {
        ctx.translate(this.x - cameraX, (this.y - cameraY) + this.bobbingOffset);
        if (sprite && sprite.complete) {
            ctx.drawImage(sprite, 0, 0, this.width, this.height);
        } else {
            ctx.fillStyle = "gray"; // Fallback if sprite not loaded
            ctx.fillRect(0, 0, this.width, this.height);
        }
    }
    ctx.restore();
    
    // Zeichne den Lebensbalken oberhalb der Einheit. (NACH ctx.restore())
    // Health bar does NOT bob for now.
    // Für normale Units: Breite entspricht der Unit, für Könige etwas länger (1.1‑fach) und dicker (8px hoch).
    const baseBarWidth = this.width;
    let barWidth, barHeight;
    if (this.unitType === "king") {
      barWidth = baseBarWidth * 1.1;
      barHeight = 8;
    } else {
      barWidth = baseBarWidth;
      barHeight = 5;
    }
    // Zentriere den Balken über dem Sprite:
    const barX = this.x - cameraX - (barWidth - this.width) / 2;
    const barY = this.y - cameraY - barHeight - 2;
    ctx.fillStyle = "black";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    let maxHP = (this.unitType === "king") ? 300 : 100;
    // Bestimme die Farbe: Verbündete (wenn this.team === playerTeam) erhalten einen "lime" (hellgrünen) Balken, Gegner "red"
    const healthColor = (this.team === playerTeam) ? "lime" : "red";
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * (this.hp / maxHP), barHeight);
    
    if (this.unitType === "archer") {
      ctx.strokeStyle = "gold";
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
    }
    // Archer outline and King shield effect are drawn relative to unit's absolute position,
    // so they should also be outside the sprite's save/restore block or adjusted.
    // Current implementation draws them after the main sprite block, which is fine.
    if (this.unitType === "archer") {
      ctx.strokeStyle = "gold";
      ctx.lineWidth = 2;
      // Draw relative to the unit's top-left corner, not the potentially translated origin
      ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.width, this.height);
    }
    if (this.unitType === "king" && this.isShieldActive) {
      ctx.strokeStyle = "cyan";
      ctx.lineWidth = 3;
      ctx.beginPath();
      // Draw relative to the unit's center, not the potentially translated origin
      ctx.arc(this.x + this.width / 2 - cameraX, this.y + this.height / 2 - cameraY, this.width, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

Unit.nextTeamId = 1;
Unit.dashCooldown = 5000;
Unit.shieldAbilityCooldown = 10000;
