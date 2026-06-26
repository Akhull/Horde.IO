import { CONFIG } from "../config/gameConfig";
import type { SafeZoneCircle } from "../types";

type SafeZoneState = "delay" | "shrinking" | "pause" | "moving";

// Battle-Royale-Schrumpfkreis als Zustandsautomat.
// Port von Game.updateSafeZone / Game.safeZone* (Game.js).
export class SafeZone {
  current: SafeZoneCircle;
  target: SafeZoneCircle;
  state: SafeZoneState = "delay";
  private timer = 0;

  constructor() {
    const cx = CONFIG.worldWidth / 2;
    const cy = CONFIG.worldHeight / 2;
    this.current = { centerX: cx, centerY: cy, radius: CONFIG.safeZoneStartRadius };
    this.target = { centerX: cx, centerY: cy, radius: CONFIG.safeZoneStartRadius };
  }

  private pickShrinkTarget(): void {
    this.target.centerX = this.current.centerX + (Math.random() - 0.5) * this.current.radius * 0.5;
    this.target.centerY = this.current.centerY + (Math.random() - 0.5) * this.current.radius * 0.5;
    this.target.radius = Math.max(this.current.radius * 0.6, CONFIG.safeZoneMinRadius);
  }

  update(deltaTime: number): void {
    if (this.state === "delay") {
      this.timer += deltaTime;
      if (this.timer >= CONFIG.safeZoneDelay) {
        this.current.radius = CONFIG.safeZoneStartRadius;
        this.pickShrinkTarget();
        this.state = "shrinking";
        this.timer = 0;
      }
    } else if (this.state === "shrinking") {
      const shrink = CONFIG.safeZoneShrinkRate * deltaTime;
      if (this.current.radius - shrink > this.target.radius) {
        const factor = shrink / (this.current.radius - this.target.radius + shrink);
        this.current.radius -= shrink;
        this.current.centerX += (this.target.centerX - this.current.centerX) * factor;
        this.current.centerY += (this.target.centerY - this.current.centerY) * factor;
      } else {
        this.current.radius = this.target.radius;
        this.current.centerX = this.target.centerX;
        this.current.centerY = this.target.centerY;
        this.state = "pause";
        this.timer = 0;
      }
    } else if (this.state === "pause") {
      this.timer += deltaTime;
      const pauseDuration =
        this.current.radius > CONFIG.safeZoneMinRadius ? CONFIG.safeZonePauseDuration : CONFIG.safeZoneMovePauseDuration;
      if (this.timer >= pauseDuration) {
        this.timer = 0;
        if (this.current.radius > CONFIG.safeZoneMinRadius) {
          this.state = "shrinking";
          this.pickShrinkTarget();
        } else {
          this.state = "moving";
          this.target.centerX = this.current.centerX + (Math.random() - 0.5) * this.current.radius * 0.5;
          this.target.centerY = this.current.centerY + (Math.random() - 0.5) * this.current.radius * 0.5;
          this.target.radius = this.current.radius;
        }
      }
    } else if (this.state === "moving") {
      const moveAmount = CONFIG.safeZoneMoveRate * deltaTime;
      const dx = this.target.centerX - this.current.centerX;
      const dy = this.target.centerY - this.current.centerY;
      const dist = Math.hypot(dx, dy);
      if (dist > moveAmount) {
        this.current.centerX += (dx / dist) * moveAmount;
        this.current.centerY += (dy / dist) * moveAmount;
      } else {
        this.current.centerX = this.target.centerX;
        this.current.centerY = this.target.centerY;
        this.state = "pause";
        this.timer = 0;
      }
    }
  }
}
