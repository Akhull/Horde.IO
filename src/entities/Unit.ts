import Phaser from "phaser";
import { Entity } from "./Entity";
import { CONFIG, UNIT_STATS, DEPTH } from "../config/gameConfig";
import type { Faction, UnitType } from "../types";
import type { Vec2 } from "../systems/AI";
import { determineVassalTarget } from "../systems/AI";
import type { GameScene } from "../scenes/GameScene";

// Eine Einheit: König (Spieler/KI), Vasall (Nahkampf) oder Bogenschütze.
// Faithful-Port von public/js/entities/Unit.js – inkl. KI, Angriff, Dash, Schild.
export class Unit extends Entity {
  static nextTeamId = 1;

  faction: Faction;
  unitType: UnitType;
  level: number;
  team!: number;
  hp!: number;
  speed!: number;
  leader!: Unit;

  // König
  dashTimer = 0;
  lastDirection: Vec2 = { x: 0, y: 0 };
  shieldCooldownTimer = 0;
  shieldTimer = 0;
  isShieldActive = false;
  dashReadyFlashTimer = 0;
  shieldReadyFlashTimer = 0;
  idleTarget: Vec2 | null = null;

  // Bogenschütze
  attackCooldown = 0;
  lastAttackTimer = 0;

  // Nahkampf
  isAttacking = false;
  attackTimer = 0;
  attackDamageDealt = false;
  currentTarget: { x: number; y: number; width: number; height: number; hp: number; dead?: boolean } | null = null;
  formationOffset: Vec2 | null = null;

  deathSoundPlayed = false;
  facingDirection: 1 | -1 = 1;
  isMoving = false;
  private bobbingPhase = 0;
  private bobbingOffset = 0;
  private prevX: number;
  private prevY: number;
  private footstepTimer: number;
  private readonly footstepMin = 300;
  private readonly footstepMax = 450;

  // Darstellung
  private sprite: Phaser.GameObjects.Image;
  private barBg: Phaser.GameObjects.Rectangle;
  private barFill: Phaser.GameObjects.Rectangle;
  private shieldRing?: Phaser.GameObjects.Arc;
  private archerOutline?: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, faction: Faction, unitType: UnitType, level = 1, leader: Unit | null = null) {
    super(x, y, 40, 40);
    this.faction = faction;
    this.unitType = unitType;
    this.level = level;

    if (unitType === "king") {
      this.team = Unit.nextTeamId++;
      this.hp = UNIT_STATS.king.hp;
      this.speed = UNIT_STATS.king.speed;
      this.dashTimer = CONFIG.dashCooldown;
      this.shieldCooldownTimer = CONFIG.shieldAbilityCooldown;
      this.leader = this;
      this.width = UNIT_STATS.king.size;
      this.height = UNIT_STATS.king.size;
    } else if (unitType === "archer") {
      this.team = leader!.team;
      this.hp = UNIT_STATS.archer.hp;
      this.speed = UNIT_STATS.archer.speed;
      this.leader = leader!;
      this.attackCooldown = UNIT_STATS.archer.attackCooldown;
      this.width = UNIT_STATS.archer.size;
      this.height = UNIT_STATS.archer.size;
    } else {
      this.team = leader!.team;
      this.hp = UNIT_STATS.vassal.hp;
      this.speed = UNIT_STATS.vassal.speed;
      this.leader = leader!;
      const s = UNIT_STATS.vassal.sizeByLevel[level] ?? 40;
      this.width = s;
      this.height = s;
    }

    this.prevX = x;
    this.prevY = y;
    this.footstepTimer = this.footstepMin + Math.random() * (this.footstepMax - this.footstepMin);

    const spriteKey = unitType === "king" ? `${faction}_king` : `${faction}_l${level}`;
    this.sprite = scene.add.image(this.centerX, this.centerY, spriteKey).setDepth(DEPTH.unit);
    this.sprite.setDisplaySize(this.width, this.height);

    const barH = unitType === "king" ? 8 : 5;
    this.barBg = scene.add.rectangle(this.x, this.y, this.width, barH, 0x000000).setOrigin(0, 0.5).setDepth(DEPTH.healthbar);
    this.barFill = scene.add.rectangle(this.x, this.y, this.width, barH, 0xff0000).setOrigin(0, 0.5).setDepth(DEPTH.healthbar);

    if (unitType === "king") {
      this.shieldRing = scene.add.circle(this.centerX, this.centerY, this.width, 0x00ffff, 0).setStrokeStyle(3, 0x00ffff).setDepth(DEPTH.healthbar).setVisible(false);
    }
    if (unitType === "archer") {
      this.archerOutline = scene.add.rectangle(this.x, this.y, this.width, this.height).setOrigin(0, 0).setStrokeStyle(2, 0xffd700).setDepth(DEPTH.unit);
    }
  }

  private get maxHP(): number {
    return this.unitType === "king" ? UNIT_STATS.king.hp : 100;
  }

  // Vasall auf eine höhere Stufe heben: Grösse und Sprite aktualisieren.
  setLevel(n: number): void {
    this.level = n;
    const s = UNIT_STATS.vassal.sizeByLevel[n] ?? 40;
    this.width = s;
    this.height = s;
    this.sprite.setTexture(`${this.faction}_l${n}`).setDisplaySize(s, s);
  }

  // Spielt den passenden Nahkampf-Sound je nach Einheitentyp/Level.
  private meleeSound(): { key: string; vol: number } {
    if (this.unitType === "king") return { key: "melee_l3", vol: 1.3 };
    if (this.level === 1) return { key: "melee_l1", vol: 0.7 };
    if (this.level === 2) return { key: "melee_l2", vol: 1.0 };
    return { key: "melee_l3", vol: 1.3 };
  }

  // Wendet im Angriffsfenster 20 Schaden an, spielt Sound und zeigt den Slash-Effekt.
  private executeAttack(deltaTime: number, scene: GameScene): void {
    if (!this.isAttacking) return;
    this.attackTimer -= deltaTime;
    if (this.attackTimer < 250 && !this.attackDamageDealt) {
      if (this.currentTarget && !this.currentTarget.dead) {
        this.currentTarget.hp -= 20;
      }
      this.attackDamageDealt = true;
      const s = this.meleeSound();
      scene.audio.playSpatial(s.key, this.x, this.y, s.vol);
      scene.notifyCombatEvent();

      let angle: number;
      if (this.currentTarget) {
        const tcx = this.currentTarget.x + this.currentTarget.width / 2;
        const tcy = this.currentTarget.y + this.currentTarget.height / 2;
        angle = Math.atan2(tcy - this.centerY, tcx - this.centerX);
      } else if (this.lastDirection.x || this.lastDirection.y) {
        angle = Math.atan2(this.lastDirection.y, this.lastDirection.x);
      } else {
        angle = 0;
      }
      scene.spawnSlash(this.centerX, this.centerY, angle - 2.35619449, this.width);
    }
    if (this.attackTimer <= 0) {
      this.isAttacking = false;
      this.attackTimer = 0;
      this.attackDamageDealt = false;
      this.currentTarget = null;
    }
  }

  private faceByDx(dx: number): void {
    if (Math.abs(dx) > 0.1) this.facingDirection = dx > 0 ? 1 : -1;
  }

  update(deltaTime: number, scene: GameScene): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.isMoving = false;
    const step = (this.speed * deltaTime) / 16;

    // Todessound einmalig
    if (this.hp <= 0 && !this.deathSoundPlayed) {
      scene.notifyCombatEvent();
      const key = this.faction === "elf" ? "death_elf" : this.faction === "orc" ? "death_orc" : "death_human";
      let vol = 1.0;
      if (this.unitType === "vassal") vol = this.level === 1 ? 0.7 : this.level === 3 ? 1.3 : 1.0;
      else if (this.unitType === "king") vol = 1.3;
      scene.audio.playSpatial(key, this.x, this.y, vol);
      this.deathSoundPlayed = true;
    }

    const sz = scene.safeZoneCurrent;
    const distSafe = Math.hypot(this.centerX - sz.centerX, this.centerY - sz.centerY);

    // Ausserhalb der Safe-Zone: Richtung Zentrum drängen
    if (distSafe > sz.radius) {
      const moveToCenter = () => {
        const dx = sz.centerX - this.centerX;
        const dy = sz.centerY - this.centerY;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          this.x += (dx / d) * step;
          this.y += (dy / d) * step;
        }
      };
      if (this.unitType === "king") {
        moveToCenter();
      } else if (this.leader && this.leader.unitType === "king") {
        const leaderDist = Math.hypot(this.leader.centerX - sz.centerX, this.leader.centerY - sz.centerY);
        if (leaderDist <= sz.radius) {
          moveToCenter();
          this.afterMove(deltaTime, scene);
          return;
        }
      } else {
        moveToCenter();
        this.afterMove(deltaTime, scene);
        return;
      }
    }

    if (this.unitType === "vassal") this.updateVassal(deltaTime, step, scene);
    else if (this.unitType === "archer") this.updateArcher(deltaTime, step, scene);
    else this.updateKing(deltaTime, step, scene);

    this.afterMove(deltaTime, scene);
  }

  private updateVassal(deltaTime: number, step: number, scene: GameScene): void {
    // Zu weit weg vom König? Direkt nachlaufen.
    const dxKing = this.leader.centerX - this.centerX;
    const dyKing = this.leader.centerY - this.centerY;
    if (Math.hypot(dxKing, dyKing) > 750) {
      const d = Math.hypot(dxKing, dyKing);
      if (d > 0) {
        const mx = (dxKing / d) * step;
        this.faceByDx(mx);
        this.x += mx;
        this.y += (dyKing / d) * step;
      }
      return;
    }
    if (!this.leader || !scene.units.includes(this.leader)) this.hp = 0;

    const info = determineVassalTarget(this, scene);
    if (info && info.type === "attack") {
      const dx = info.x - this.x;
      const dy = info.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d <= 50) {
        if (!this.isAttacking) {
          this.faceByDx(dx);
          this.isAttacking = true;
          this.attackTimer = 500;
          this.attackDamageDealt = false;
          this.currentTarget = info.target as { x: number; y: number; width: number; height: number; hp: number; dead?: boolean };
        }
      } else if (!this.isAttacking) {
        const mx = (dx / d) * step;
        this.faceByDx(mx);
        this.x += mx;
        this.y += (dy / d) * step;
      }
    } else if (!this.isAttacking && info) {
      const dx = info.x - this.x;
      const dy = info.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 5) {
        const mx = (dx / d) * step;
        this.faceByDx(mx);
        this.x += mx;
        this.y += (dy / d) * step;
      }
    }
    this.executeAttack(deltaTime, scene);
  }

  private updateArcher(deltaTime: number, step: number, scene: GameScene): void {
    this.lastAttackTimer += deltaTime;
    const range = UNIT_STATS.archer.attackRange;
    const sz = scene.safeZoneCurrent;
    let target: { x: number; y: number; width: number; height: number; hp: number; dead?: boolean } | null = null;
    let best = Infinity;

    for (const o of scene.units) {
      if (o.team !== this.team && !o.dead) {
        if (Math.hypot(o.centerX - sz.centerX, o.centerY - sz.centerY) > sz.radius) continue;
        const d = Math.hypot(o.centerX - this.centerX, o.centerY - this.centerY);
        if (d < range && d < best) {
          best = d;
          target = o;
        }
      }
    }
    for (const b of scene.buildings) {
      if (Math.hypot(b.centerX - sz.centerX, b.centerY - sz.centerY) > sz.radius) continue;
      const d = Math.hypot(b.centerX - this.centerX, b.centerY - this.centerY);
      if (d < range && d < best) {
        best = d;
        target = b;
      }
    }

    if (target) {
      if (this.lastAttackTimer >= this.attackCooldown) {
        scene.spawnProjectile(this.centerX, this.centerY, target, 10, this.team);
        scene.audio.playSpatial("arrow_shot", this.x, this.y, 1.0);
        scene.notifyCombatEvent();
        this.lastAttackTimer = 0;
      }
    } else {
      const info = determineVassalTarget(this, scene);
      if (info) {
        const dx = info.x - this.x;
        const dy = info.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d > 5) {
          const mx = (dx / d) * step;
          this.faceByDx(mx);
          this.x += mx;
          this.y += (dy / d) * step;
        }
      }
    }
  }

  private updateKing(deltaTime: number, step: number, scene: GameScene): void {
    if (this === scene.playerKing) {
      this.updatePlayerKing(deltaTime, step, scene);
    } else {
      this.updateAIKing(deltaTime, step, scene);
    }
    this.executeAttack(deltaTime, scene);
  }

  private updatePlayerKing(deltaTime: number, step: number, scene: GameScene): void {
    const mv = scene.moveVector;
    let moveX = mv.x;
    let moveY = mv.y;
    const mag = Math.hypot(moveX, moveY);
    if (mag > 0) {
      moveX /= mag;
      moveY /= mag;
      this.faceByDx(moveX);
      this.lastDirection = { x: moveX, y: moveY };
      this.x += moveX * step;
      this.y += moveY * step;
    }

    // Dash
    const prevDash = this.dashTimer;
    this.dashTimer += deltaTime;
    if (this.dashTimer >= CONFIG.dashCooldown && prevDash < CONFIG.dashCooldown) this.dashReadyFlashTimer = 250;
    if (this.dashReadyFlashTimer > 0) this.dashReadyFlashTimer -= deltaTime;
    if (scene.keyDash && this.dashTimer >= CONFIG.dashCooldown && (this.lastDirection.x || this.lastDirection.y)) {
      this.x += this.lastDirection.x * CONFIG.dashDistance;
      this.y += this.lastDirection.y * CONFIG.dashDistance;
      this.dashTimer = 0;
    }

    // Schild
    const prevShield = this.shieldCooldownTimer;
    this.shieldCooldownTimer += deltaTime;
    if (this.shieldCooldownTimer >= CONFIG.shieldAbilityCooldown && prevShield < CONFIG.shieldAbilityCooldown) this.shieldReadyFlashTimer = 250;
    if (this.shieldReadyFlashTimer > 0) this.shieldReadyFlashTimer -= deltaTime;
    if (scene.keyShield && this.shieldCooldownTimer >= CONFIG.shieldAbilityCooldown && !this.isShieldActive) {
      this.isShieldActive = true;
      this.shieldTimer = CONFIG.shieldAbilityDuration;
      this.shieldCooldownTimer = 0;
    }
    if (this.isShieldActive) {
      this.shieldTimer -= deltaTime;
      if (this.shieldTimer <= 0) this.isShieldActive = false;
    }

    // Angriff einleiten
    if (!this.isAttacking) {
      const info = determineVassalTarget(this, scene);
      if (info && info.type === "attack") {
        const d = Math.hypot(info.x - this.x, info.y - this.y);
        if (d <= 60) {
          this.isAttacking = true;
          this.attackTimer = 500;
          this.attackDamageDealt = false;
          this.currentTarget = info.target as { x: number; y: number; width: number; height: number; hp: number; dead?: boolean };
        }
      }
    }
  }

  private updateAIKing(deltaTime: number, step: number, scene: GameScene): void {
    const info = determineVassalTarget(this, scene);
    if (info && info.type === "attack") {
      const dx = info.x - this.x;
      const dy = info.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d <= 60) {
        if (!this.isAttacking) {
          this.isAttacking = true;
          this.attackTimer = 500;
          this.attackDamageDealt = false;
          this.currentTarget = info.target as { x: number; y: number; width: number; height: number; hp: number; dead?: boolean };
        }
      } else if (!this.isAttacking) {
        const mx = (dx / d) * step;
        this.faceByDx(mx);
        this.x += mx;
        this.y += (dy / d) * step;
      }
      return;
    }

    // Idle/Ausweichen: Projektilen ausweichen + in der Safe-Zone bleiben, sonst umherwandern
    const sz = scene.safeZoneCurrent;
    const dodge: Vec2 = { x: 0, y: 0 };
    for (const proj of scene.projectiles) {
      if (proj.team !== this.team) {
        const dx = this.centerX - proj.centerX;
        const dy = this.centerY - proj.centerY;
        const dist = Math.hypot(dx, dy);
        if (dist < 150 && dist > 0) {
          const w = (150 - dist) / 150;
          dodge.x += (dx / dist) * w;
          dodge.y += (dy / dist) * w;
        }
      }
    }
    const dxSafe = sz.centerX - this.centerX;
    const dySafe = sz.centerY - this.centerY;
    const distSafe = Math.hypot(dxSafe, dySafe);
    if (distSafe > sz.radius - 100 && distSafe > 0) {
      const w = (distSafe - (sz.radius - 100)) / 100;
      dodge.x += (dxSafe / distSafe) * w;
      dodge.y += (dySafe / distSafe) * w;
    }

    const dodgeMag = Math.hypot(dodge.x, dodge.y);
    let moveX = 0;
    let moveY = 0;
    if (dodgeMag > 0.1) {
      moveX = (dodge.x / dodgeMag) * step;
      moveY = (dodge.y / dodgeMag) * step;
      this.idleTarget = null;
    } else {
      if (!this.idleTarget || Math.hypot(this.idleTarget.x - this.x, this.idleTarget.y - this.y) < 10) {
        this.idleTarget = { x: Math.random() * CONFIG.worldWidth, y: Math.random() * CONFIG.worldHeight };
      }
      const dx = this.idleTarget.x - this.x;
      const dy = this.idleTarget.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        moveX = (dx / d) * step;
        moveY = (dy / d) * step;
      }
    }
    this.faceByDx(moveX);
    this.x += moveX;
    this.y += moveY;
  }

  // Bobbing, Schrittsounds, Bewegungserkennung – am Ende jedes Updates.
  private afterMove(deltaTime: number, scene: GameScene): void {
    if (Math.abs(this.x - this.prevX) > 0.1 || Math.abs(this.y - this.prevY) > 0.1) this.isMoving = true;

    if (this.isMoving) {
      this.bobbingPhase += deltaTime * 0.01;
      this.bobbingOffset = Math.sin(this.bobbingPhase) * 2;
      this.footstepTimer -= deltaTime;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = this.footstepMin + Math.random() * (this.footstepMax - this.footstepMin);
        let vol = 0.3;
        if (this.unitType === "king") vol = 0.4;
        else if (this.level === 1) vol = 0.2;
        scene.audio.playSpatial("footstep", this.x, this.y, vol);
      }
    } else {
      this.bobbingOffset = 0;
      this.bobbingPhase = 0;
    }

    if (!this.dead) scene.grid.updateEntity(this);
  }

  sync(): void {
    this.sprite.setPosition(this.centerX, this.centerY + this.bobbingOffset);
    this.sprite.setFlipX(this.facingDirection === -1);

    const playerTeam = this.scenePlayerTeam;
    const barW = this.unitType === "king" ? this.width * 1.1 : this.width;
    const barX = this.x - (barW - this.width) / 2;
    const barY = this.y - (this.unitType === "king" ? 8 : 5) - 2;
    this.barBg.setPosition(barX, barY).width = barW;
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHP, 0, 1);
    this.barFill.setPosition(barX, barY);
    this.barFill.width = barW * ratio;
    this.barFill.setFillStyle(this.team === playerTeam ? 0x00ff00 : 0xff0000);

    if (this.shieldRing) {
      this.shieldRing.setVisible(this.isShieldActive);
      if (this.isShieldActive) this.shieldRing.setPosition(this.centerX, this.centerY);
    }
    if (this.archerOutline) this.archerOutline.setPosition(this.x, this.y);
  }

  // Wird von der GameScene pro Frame gesetzt, um Verbündete (grün) von Gegnern (rot) zu unterscheiden.
  scenePlayerTeam: number | null = null;

  destroyView(): void {
    this.sprite.destroy();
    this.barBg.destroy();
    this.barFill.destroy();
    this.shieldRing?.destroy();
    this.archerOutline?.destroy();
  }
}
