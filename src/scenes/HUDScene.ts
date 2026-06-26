import Phaser from "phaser";
import { CONFIG } from "../config/gameConfig";
import type { GameScene } from "./GameScene";

// Overlay-Szene: HUD (Cooldowns, Zähler, Timer, HP), Minimap und Mobile-Steuerung.
// Läuft parallel zur GameScene und liest deren Zustand pro Frame.
export class HUDScene extends Phaser.Scene {
  private gs!: GameScene;
  private g!: Phaser.GameObjects.Graphics;
  private mm!: Phaser.GameObjects.Graphics;
  private txtKings!: Phaser.GameObjects.Text;
  private txtDash!: Phaser.GameObjects.Text;
  private txtShield!: Phaser.GameObjects.Text;
  private txtVassals!: Phaser.GameObjects.Text;
  private txtTimer!: Phaser.GameObjects.Text;
  private txtFps!: Phaser.GameObjects.Text;
  private txtHp!: Phaser.GameObjects.Text;

  constructor() {
    super("HUD");
  }

  create(): void {
    this.gs = this.scene.get("Game") as GameScene;
    this.g = this.add.graphics();
    this.mm = this.add.graphics();

    const font = "Cinzel, serif";
    const white = { fontFamily: font, color: "#ffffff" };
    this.txtKings = this.add.text(20, 16, "", { ...white, fontSize: "22px" });
    this.txtDash = this.add.text(90, 62, "", { ...white, fontSize: "13px" }).setOrigin(0.5);
    this.txtShield = this.add.text(90, 92, "", { ...white, fontSize: "13px" }).setOrigin(0.5);
    this.txtVassals = this.add.text(20, 128, "", { ...white, fontSize: "16px" });
    this.txtTimer = this.add.text(0, 12, "", { ...white, fontSize: "22px" }).setOrigin(0.5, 0);
    this.txtFps = this.add.text(10, 0, "", { fontFamily: "Arial", fontSize: "14px", color: "#ffffff" });
    this.txtHp = this.add.text(0, 0, "", { ...white, fontSize: "18px" }).setOrigin(0.5);

    if (this.sys.game.device.input.touch) this.buildTouchControls();
  }

  update(): void {
    const game = this.gs;
    if (!game || !game.scene.isActive() || !game.playerKing) {
      this.g.clear();
      this.mm.clear();
      return;
    }
    const king = game.playerKing;
    const W = this.scale.width;
    const H = this.scale.height;
    this.g.clear();

    // Könige übrig
    const kingsAlive = game.units.filter((u) => u.unitType === "king").length;
    this.g.fillStyle(0x000000, 0.5).fillRect(10, 10, 160, 36);
    this.txtKings.setText(`Könige: ${kingsAlive}`);

    // Dash-Cooldown
    const dashRatio = Phaser.Math.Clamp(king.dashTimer / CONFIG.dashCooldown, 0, 1);
    this.g.fillStyle(0x000000, 0.5).fillRect(10, 56, 160, 20);
    this.g.fillStyle(dashRatio >= 1 && king.dashReadyFlashTimer > 0 ? 0xffff99 : 0xffff00, 1).fillRect(10, 56, 160 * dashRatio, 20);
    this.g.lineStyle(1, 0xffffff).strokeRect(10, 56, 160, 20);
    this.txtDash.setText(dashRatio < 1 ? `${((CONFIG.dashCooldown - king.dashTimer) / 1000).toFixed(1)}s` : "Dash bereit!");

    // Schild-Cooldown
    const shieldRatio = Phaser.Math.Clamp(king.shieldCooldownTimer / CONFIG.shieldAbilityCooldown, 0, 1);
    this.g.fillStyle(0x000000, 0.5).fillRect(10, 86, 160, 20);
    this.g.fillStyle(shieldRatio >= 1 && king.shieldReadyFlashTimer > 0 ? 0x66ccff : 0x3366ff, 1).fillRect(10, 86, 160 * shieldRatio, 20);
    this.g.lineStyle(1, 0xffffff).strokeRect(10, 86, 160, 20);
    this.txtShield.setText(shieldRatio < 1 ? `${((CONFIG.shieldAbilityCooldown - king.shieldCooldownTimer) / 1000).toFixed(1)}s` : "Schild bereit!");

    // Vasallen-Zähler
    const team = king.team;
    const vassals = game.units.filter((u) => u.unitType === "vassal" && u.team === team);
    const v1 = vassals.filter((u) => u.level === 1).length;
    const v2 = vassals.filter((u) => u.level === 2).length;
    const v3 = vassals.filter((u) => u.level === 3).length;
    const archers = game.units.filter((u) => u.unitType === "archer" && u.team === team).length;
    this.g.fillStyle(0x000000, 0.5).fillRect(10, 120, 220, 120);
    this.txtVassals.setText(`Vasallen\nLevel 1: ${v1}\nLevel 2: ${v2}\nLevel 3: ${v3}\nBogenschützen: ${archers}`);

    // Timer
    const total = Math.floor(game.gameTime / 1000);
    const mm = `0${Math.floor(total / 60)}`.slice(-2);
    const ss = `0${total % 60}`.slice(-2);
    this.txtTimer.setText(`${mm}:${ss}`).setX(W / 2);

    // FPS
    this.txtFps.setText(`FPS: ${Math.round(this.gs.game.loop.actualFps)}`).setY(H - 22);

    // Spieler-HP unten mittig
    const hp = Math.max(0, king.hp);
    const hpBarW = 200;
    const hpX = W / 2 - hpBarW / 2;
    const hpY = H - 50;
    this.g.fillStyle(0x000000, 0.7).fillRect(hpX, hpY, hpBarW, 15);
    this.g.fillStyle(0x00ff00, 1).fillRect(hpX, hpY, hpBarW * (hp / CONFIG_KING_HP), 15);
    this.g.lineStyle(1, 0xffffff).strokeRect(hpX, hpY, hpBarW, 15);
    this.txtHp.setText(`HP: ${hp.toFixed(0)} / ${CONFIG_KING_HP}`).setPosition(W / 2, H - 28);

    this.drawMinimap(W);
  }

  private drawMinimap(W: number): void {
    const game = this.gs;
    const size = 200;
    const x0 = W - size - 10;
    const y0 = 10;
    const scale = size / CONFIG.worldWidth;
    const mm = this.mm;
    mm.clear();
    mm.fillStyle(0x224422, 1).fillRect(x0, y0, size, size);

    const toX = (wx: number) => x0 + wx * scale;
    const toY = (wy: number) => y0 + wy * scale;

    for (const o of game.obstacles) {
      mm.fillStyle(o.type === "water" ? 0x3366ff : 0x0a4f0a, 1);
      mm.fillRect(toX(o.x), toY(o.y), o.width * scale, o.height * scale);
    }
    mm.fillStyle(0x888888, 1);
    for (const b of game.buildings) mm.fillRect(toX(b.x) - 1, toY(b.y) - 1, 3, 3);
    const playerTeam = game.playerKing?.team;
    for (const u of game.units) {
      mm.fillStyle(u.team === playerTeam ? 0x00ff00 : 0xff0000, 1);
      const s = u.unitType === "king" ? 4 : 2;
      mm.fillRect(toX(u.centerX) - s / 2, toY(u.centerY) - s / 2, s, s);
    }
    for (const s of game.souls) {
      mm.fillStyle(s.soulType === "green" ? 0x00ff66 : s.soulType === "blue" ? 0x00ccff : 0xcc00cc, 1);
      mm.fillRect(toX(s.x), toY(s.y), 2, 2);
    }

    // Safe-Zone
    const c = game.safeZoneCurrent;
    mm.lineStyle(1.5, 0xff0000, 1).strokeCircle(toX(c.centerX), toY(c.centerY), c.radius * scale);

    // Kamerabereich
    const cam = game.cameras.main;
    mm.lineStyle(1, 0xffffff, 1).strokeRect(toX(cam.scrollX), toY(cam.scrollY), cam.width * scale, cam.height * scale);
    mm.lineStyle(2, 0xffffff, 1).strokeRect(x0, y0, size, size);
  }

  // Virtueller Joystick (links) + Dash/Schild-Buttons (rechts) für Touchgeräte.
  private buildTouchControls(): void {
    const H = this.scale.height;
    const W = this.scale.width;
    const baseX = 120;
    const baseY = H - 120;
    const radius = 80;

    const base = this.add.circle(baseX, baseY, radius, 0xffffff, 0.15);
    const knob = this.add.circle(baseX, baseY, radius * 0.5, 0xffffff, 0.4);
    base.setScrollFactor(0);
    knob.setScrollFactor(0);

    const zone = this.add.zone(0, 0, W / 2, H).setOrigin(0, 0).setInteractive();
    zone.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      let dx = p.x - baseX;
      let dy = p.y - baseY;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
      }
      knob.setPosition(baseX + dx, baseY + dy);
      this.registry.set("joyX", dx / radius);
      this.registry.set("joyY", dy / radius);
    });
    const reset = () => {
      knob.setPosition(baseX, baseY);
      this.registry.set("joyX", 0);
      this.registry.set("joyY", 0);
    };
    zone.on("pointerup", reset);
    zone.on("pointerout", reset);

    this.makeActionButton(W - 90, H - 180, "Dash", "btnDash");
    this.makeActionButton(W - 90, H - 90, "Schild", "btnShield");
  }

  private makeActionButton(x: number, y: number, label: string, registryKey: string): void {
    const btn = this.add.circle(x, y, 50, 0xffffff, 0.35).setScrollFactor(0).setInteractive();
    this.add.text(x, y, label, { fontFamily: "Cinzel, serif", fontSize: "16px", color: "#000000" }).setOrigin(0.5);
    btn.on("pointerdown", () => this.registry.set(registryKey, true));
    btn.on("pointerup", () => this.registry.set(registryKey, false));
    btn.on("pointerout", () => this.registry.set(registryKey, false));
  }
}

const CONFIG_KING_HP = 300;
