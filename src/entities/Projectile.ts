import Phaser from "phaser";
import { Entity } from "./Entity";
import { DEPTH } from "../config/gameConfig";
import type { GameScene } from "../scenes/GameScene";

// Ziel eines Pfeils: alles mit Bounding-Box und HP (Einheit oder Gebäude).
// takeDamage (optional) erlaubt Treffer-Feedback (Flash/Rückstoß/Schadenszahl);
// fehlt es, wird HP direkt abgezogen.
export interface ProjectileTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  dead?: boolean;
  takeDamage?(amount: number, srcX: number, srcY: number, scene: GameScene): void;
}

// Ballistischer Pfeil mit Flughöhe (z), Schwerkraft und Einschlag.
// Faithful-Port von public/js/entities/Projectile.js.
export class Projectile extends Entity {
  private target: ProjectileTarget;
  private damage: number;
  team: number;
  expired = false;

  private vx: number;
  private vy: number;
  private vz: number;
  private z = 30;
  private onGround = false;
  private groundHitTime = 0;
  private impactSpawned = false;

  private sprite: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, x: number, y: number, target: ProjectileTarget, damage: number, team: number) {
    super(x, y, 35, 7);
    this.target = target;
    this.damage = damage;
    this.team = team;

    const originX = x + this.width / 2;
    const originY = y + this.height / 2;
    const deviation = 10;
    const ang = Math.random() * 2 * Math.PI;
    const targetCenterX = target.x + target.width / 2 + Math.cos(ang) * deviation;
    const targetCenterY = target.y + target.height / 2 + Math.sin(ang) * deviation;
    const dx = targetCenterX - originX;
    const dy = targetCenterY - originY;
    const d = Math.hypot(dx, dy);
    const T = Math.max(20, d / 9 + 5);
    this.vx = dx / T;
    this.vy = dy / T;
    this.vz = (0.5 * 0.15 * T * T - 30) / T;

    this.sprite = scene.add
      .image(originX, originY - this.z, "arrow")
      .setDisplaySize(this.width, this.height)
      .setOrigin(0.5)
      .setDepth(DEPTH.projectile);
  }

  update(deltaTime: number, scene: GameScene): void {
    if (!this.onGround) {
      this.x += (this.vx * deltaTime) / 16;
      this.y += (this.vy * deltaTime) / 16;
      const gravity = 0.15;
      this.vz -= (gravity * deltaTime) / 16;
      this.z += (this.vz * deltaTime) / 16;

      if (this.z <= 0) {
        this.z = 0;
        if (!this.impactSpawned) {
          scene.spawnVisualEffect(this.centerX, this.centerY, { r: 139, g: 69, b: 19 }, 8, 200, 3, 0.3);
          scene.notifyCombatEvent();
          this.impactSpawned = true;
        }
        this.onGround = true;
        this.vx = 0;
        this.vy = 0;
        this.groundHitTime = 0;
      }

      const targetCenterX = this.target.x + this.target.width / 2;
      const targetCenterY = this.target.y + this.target.height / 2;
      const projCenterX = this.centerX;
      const projCenterY = this.centerY - this.z;
      if (Math.hypot(targetCenterX - projCenterX, targetCenterY - projCenterY) < 15) {
        if (!this.target.dead) {
          if (this.target.takeDamage) this.target.takeDamage(this.damage, projCenterX, projCenterY, scene);
          else this.target.hp -= this.damage;
        }
        this.expired = true;
        if (!this.impactSpawned) {
          scene.spawnVisualEffect(this.centerX, this.centerY - this.z, { r: 255, g: 100, b: 0 }, 5, 150, 2, 0.5);
          scene.notifyCombatEvent();
          this.impactSpawned = true;
        }
      }
    } else {
      this.groundHitTime += deltaTime;
      if (this.groundHitTime >= 2000) this.expired = true;
    }
  }

  sync(): void {
    this.sprite.setPosition(this.centerX, this.centerY - this.z);
    if (!this.onGround) this.sprite.setRotation(Math.atan2(this.vy, this.vx));
    if (this.onGround) {
      // Pfeil bleibt kurz stecken und blendet dann aus
      this.sprite.setAlpha(Math.max(0, 1 - this.groundHitTime / 2000));
    }
  }

  destroyView(): void {
    this.sprite.destroy();
  }
}
