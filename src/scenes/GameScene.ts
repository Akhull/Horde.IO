import Phaser from "phaser";
import { CONFIG, DEPTH } from "../config/gameConfig";
import type { Faction, RGB, SafeZoneCircle } from "../types";
import type { Vec2 } from "../systems/AI";
import { Unit } from "../entities/Unit";
import { Building } from "../entities/Building";
import { Soul } from "../entities/Soul";
import { Obstacle } from "../entities/Obstacle";
import { Forest } from "../entities/Forest";
import { PowerUp } from "../entities/PowerUp";
import { Projectile, type ProjectileTarget } from "../entities/Projectile";
import { SpatialGrid } from "../systems/SpatialGrid";
import { SafeZone } from "../systems/SafeZone";
import { SoundManager } from "../systems/SoundManager";
import { recalcFormationOffset } from "../systems/AI";
import { generateObstacles, generateBuildingClusters, generatePowerUps, spawnVassal } from "../systems/worldgen";
import {
  resolveUnitUnitCollisions,
  resolveUnitBuildingCollisions,
  resolveUnitObstacleCollisions,
  applySeparationForce,
} from "../systems/collision";
import { applySafeZoneDamage, handlePowerUps, handleSouls, handleBuildings, removeDeadUnits } from "../systems/gameplay";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: RGB;
  size: number;
}

// Haupt-Gameplay-Szene: hält den Weltzustand und treibt den Spiel-Loop an.
// Entspricht der alten Game-Klasse (Game.js), nutzt aber Phaser für Kamera,
// Eingabe, Audio und Darstellung.
export class GameScene extends Phaser.Scene {
  // Weltzustand
  units: Unit[] = [];
  buildings: Building[] = [];
  souls: Soul[] = [];
  obstacles: (Obstacle | Forest)[] = [];
  powerUps: PowerUp[] = [];
  projectiles: Projectile[] = [];
  playerKing: Unit | null = null;
  playerFaction: Faction = "human";

  grid!: SpatialGrid;
  safeZone!: SafeZone;
  // Eigener Audio-Manager (NICHT this.sound nennen – das ist Phasers Sound-Manager!)
  audio!: SoundManager;

  gameTime = 0;
  private timeOfDay = 0;
  private gameOver = false;
  private recentCombatEvents = 0;
  private combatDecayTimer = 0;
  private lastKingX = 0;
  private lastKingY = 0;
  private kingStationaryTime = 0;

  // Eingabe (pro Frame aktualisiert; von Unit gelesen)
  moveVector: Vec2 = { x: 0, y: 0 };
  keyDash = false;
  keyShield = false;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private particles: Particle[] = [];
  private fxGfx!: Phaser.GameObjects.Graphics;
  private safeGfx!: Phaser.GameObjects.Graphics;
  private ground!: Phaser.GameObjects.TileSprite;

  constructor() {
    super("Game");
  }

  get safeZoneCurrent(): SafeZoneCircle {
    return this.safeZone.current;
  }

  init(): void {
    // Zustand bei (Neu-)Start zurücksetzen
    this.units = [];
    this.buildings = [];
    this.souls = [];
    this.obstacles = [];
    this.powerUps = [];
    this.projectiles = [];
    this.playerKing = null;
    this.particles = [];
    this.gameTime = 0;
    this.timeOfDay = 0;
    this.gameOver = false;
    this.recentCombatEvents = 0;
    this.combatDecayTimer = 0;
    this.kingStationaryTime = 0;
    Unit.nextTeamId = 1;
  }

  create(data: { faction: Faction }): void {
    this.playerFaction = data.faction ?? "human";
    this.cameras.main.fadeIn(400, 0, 0, 0);
    this.cameras.main.setBounds(0, 0, CONFIG.worldWidth, CONFIG.worldHeight);

    // Boden (gekachelte Gras-Textur über die ganze Welt)
    this.ground = this.add
      .tileSprite(0, 0, CONFIG.worldWidth, CONFIG.worldHeight, "grass")
      .setOrigin(0, 0)
      .setDepth(DEPTH.ground);

    this.fxGfx = this.add.graphics().setDepth(DEPTH.fx);
    this.safeGfx = this.add.graphics().setDepth(DEPTH.safezone);

    this.grid = new SpatialGrid(CONFIG.worldWidth, CONFIG.worldHeight, 150);
    this.safeZone = new SafeZone();
    this.audio = new SoundManager(this);
    this.audio.startWarAmbience();

    this.setupInput();
    this.spawnWorld();

    // Kamera folgt dem Spielerkönig (manuell zentriert – siehe update)
    if (this.playerKing) this.cameras.main.centerOn(this.playerKing.centerX, this.playerKing.centerY);

    // HUD-Overlay als parallele Szene
    this.scene.launch("HUD");

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audio.stopAll();
      this.scene.stop("HUD");
    });
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys("W,A,S,D,SPACE,Q") as Record<string, Phaser.Input.Keyboard.Key>;
  }

  // Erzeugt die Welt: 11 Königreiche im Ring, Welt-Objekte, Power-Ups.
  private spawnWorld(): void {
    const totalKings = 11;
    const margin = 200;
    const L1 = CONFIG.worldWidth - 2 * margin;
    const L2 = CONFIG.worldHeight - 2 * margin;
    const perimeter = 2 * (L1 + L2);
    const spacing = perimeter / totalKings;

    const kingPositions: Vec2Pos[] = [];
    for (let i = 0; i < totalKings; i++) {
      const d = i * spacing;
      let pos: Vec2Pos;
      if (d < L1) pos = { x: margin + d, y: margin };
      else if (d < L1 + L2) pos = { x: CONFIG.worldWidth - margin, y: margin + (d - L1) };
      else if (d < L1 + L2 + L1) pos = { x: CONFIG.worldWidth - margin - (d - (L1 + L2)), y: CONFIG.worldHeight - margin };
      else pos = { x: margin, y: CONFIG.worldHeight - margin - (d - (2 * L1 + L2)) };
      kingPositions.push(pos);
    }

    const playerIndex = Math.floor(Math.random() * totalKings);
    this.playerKing = new Unit(this, kingPositions[playerIndex].x, kingPositions[playerIndex].y, this.playerFaction, "king");
    this.units.push(this.playerKing);
    for (let i = 0; i < 10; i++) this.units.push(spawnVassal(this, this.playerKing));

    const factions: Faction[] = ["human", "elf", "orc"];
    for (let i = 0; i < totalKings; i++) {
      if (i === playerIndex) continue;
      const faction = factions[Math.floor(Math.random() * factions.length)];
      const aiKing = new Unit(this, kingPositions[i].x, kingPositions[i].y, faction, "king");
      this.units.push(aiKing);
      for (let j = 0; j < 10; j++) this.units.push(spawnVassal(this, aiKing));
    }

    generateObstacles(this);
    generateBuildingClusters(this);
    generatePowerUps(this);
    for (const u of this.units) this.grid.addEntity(u);
  }

  // ---- Hilfsmethoden, die von Entities/Systemen genutzt werden ----

  notifyCombatEvent(): void {
    this.recentCombatEvents++;
  }

  spawnProjectile(x: number, y: number, target: ProjectileTarget, damage: number, team: number): void {
    this.projectiles.push(new Projectile(this, x, y, target, damage, team));
  }

  spawnSlash(x: number, y: number, rotation: number, unitWidth: number): void {
    const img = this.add
      .image(x, y, "slash")
      .setRotation(rotation)
      .setDepth(DEPTH.slash)
      .setAlpha(0.5);
    img.setDisplaySize(unitWidth * 2, unitWidth * 2);
    img.setScale(img.scaleX * 0.5, img.scaleY * 0.5);
    this.tweens.add({
      targets: img,
      scaleX: img.scaleX * 2.4,
      scaleY: img.scaleY * 2.4,
      alpha: 0,
      duration: 450,
      onComplete: () => img.destroy(),
    });
  }

  spawnVisualEffect(x: number, y: number, color: RGB, count = 10, lifetime = 300, size = 2, speed = 1): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const sp = Math.random() * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * sp,
        vy: Math.sin(angle) * sp,
        life: lifetime,
        maxLife: lifetime,
        color,
        size,
      });
    }
  }

  spawnFloatingText(text: string, x: number, y: number, color: RGB, duration = 1500, size = 16): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: "Cinzel, serif",
        fontSize: `${size}px`,
        color: Phaser.Display.Color.RGBToString(color.r, color.g, color.b),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.floatingText);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration, onComplete: () => t.destroy() });
  }

  // ---- Haupt-Loop ----

  update(_time: number, delta: number): void {
    if (this.gameOver) return;
    const dt = Math.min(delta, 100); // gegen Tunneln bei Frame-Spikes

    this.readInput();
    this.updateTime(dt);
    this.gameTime += dt;
    this.updateFormations(dt);

    for (const u of this.units) u.update(dt, this);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.projectiles[i].update(dt, this);
      if (this.projectiles[i].expired) {
        this.projectiles[i].destroyView();
        this.projectiles.splice(i, 1);
      }
    }

    resolveUnitUnitCollisions(this);
    resolveUnitBuildingCollisions(this);
    resolveUnitObstacleCollisions(this);

    this.safeZone.update(dt);
    applySafeZoneDamage(this, dt);
    handlePowerUps(this);
    handleSouls(this);
    handleBuildings(this);
    removeDeadUnits(this);
    applySeparationForce(this);

    this.checkGameOver();
    if (this.gameOver) return;

    this.updateParticles(dt);
    this.updateWarVolume();

    // Darstellung aktualisieren
    const playerTeam = this.playerKing ? this.playerKing.team : null;
    for (const u of this.units) {
      u.scenePlayerTeam = playerTeam;
      u.sync();
    }
    for (const p of this.projectiles) p.sync();
    for (const b of this.buildings) b.sync();

    if (this.playerKing) this.cameras.main.centerOn(this.playerKing.centerX, this.playerKing.centerY);
    this.drawSafeZone();
    this.drawParticles();
  }

  private readInput(): void {
    let x = 0;
    let y = 0;
    if (this.cursors.up?.isDown || this.wasd.W.isDown) y -= 1;
    if (this.cursors.down?.isDown || this.wasd.S.isDown) y += 1;
    if (this.cursors.left?.isDown || this.wasd.A.isDown) x -= 1;
    if (this.cursors.right?.isDown || this.wasd.D.isDown) x += 1;

    // Mobile-Joystick (vom HUD via Registry gesetzt)
    const jx = (this.registry.get("joyX") as number) ?? 0;
    const jy = (this.registry.get("joyY") as number) ?? 0;
    if (Math.abs(jx) > 0.1 || Math.abs(jy) > 0.1) {
      x = jx;
      y = jy;
    }
    this.moveVector = { x, y };
    this.keyDash = this.wasd.SPACE.isDown || !!this.registry.get("btnDash");
    this.keyShield = this.wasd.Q.isDown || !!this.registry.get("btnShield");
  }

  private updateTime(dt: number): void {
    this.timeOfDay = (this.timeOfDay + dt / 60000) % 1;
    const brightness = 0.5 + 0.5 * Math.abs(Math.sin(this.timeOfDay * Math.PI));
    const v = Math.round(255 * brightness);
    this.ground.setTint(Phaser.Display.Color.GetColor(v, v, v));
  }

  private updateFormations(dt: number): void {
    if (!this.playerKing) return;
    const dist = Math.hypot(this.playerKing.x - this.lastKingX, this.playerKing.y - this.lastKingY);
    if (dist < 5) {
      this.kingStationaryTime += dt;
      if (this.kingStationaryTime >= CONFIG.formationUpdateInterval) {
        for (const u of this.units) {
          if (u.unitType !== "king") u.formationOffset = recalcFormationOffset(u, this.units, u.leader);
        }
        this.kingStationaryTime = 0;
      }
    } else {
      this.kingStationaryTime = 0;
      this.lastKingX = this.playerKing.x;
      this.lastKingY = this.playerKing.y;
    }
  }

  private checkGameOver(): void {
    if (!this.playerKing || this.playerKing.hp <= 0) {
      this.endGame("Verloren");
      return;
    }
    const enemyKings = this.units.filter((u) => u.unitType === "king" && u !== this.playerKing);
    if (enemyKings.length === 0) this.endGame("Gewonnen");
  }

  private endGame(message: string): void {
    this.gameOver = true;
    this.audio.stopAll();
    this.scene.stop("HUD");
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("GameOver", { message, faction: this.playerFaction });
    });
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      } else {
        p.x += p.vx * (dt / 16);
        p.y += p.vy * (dt / 16);
      }
    }
  }

  private drawParticles(): void {
    this.fxGfx.clear();
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      this.fxGfx.fillStyle(Phaser.Display.Color.GetColor(p.color.r, p.color.g, p.color.b), alpha);
      this.fxGfx.fillCircle(p.x, p.y, p.size);
    }
  }

  private drawSafeZone(): void {
    this.safeGfx.clear();
    if (this.safeZone.state === "delay") return;
    const c = this.safeZone.current;
    this.safeGfx.lineStyle(4, 0xff0000, 1);
    this.safeGfx.strokeCircle(c.centerX, c.centerY, c.radius);
    const t = this.safeZone.target;
    if (c.radius !== t.radius || c.centerX !== t.centerX || c.centerY !== t.centerY) {
      this.safeGfx.lineStyle(2, 0xff0000, 0.7);
      this.safeGfx.strokeCircle(t.centerX, t.centerY, t.radius);
    }
  }

  private updateWarVolume(): void {
    this.combatDecayTimer += this.game.loop.delta;
    if (this.combatDecayTimer >= 1000) {
      if (this.recentCombatEvents > 0) this.recentCombatEvents = Math.max(0, this.recentCombatEvents - 1);
      this.combatDecayTimer = 0;
    }
    const eventFactor = Math.min(1, this.recentCombatEvents / 10);
    const unitFactor = Math.min(1, this.units.length / 50);
    let target = Math.min(1, (eventFactor + unitFactor) / 2) * 0.7;
    if (this.recentCombatEvents === 0 && this.units.length < 10) target = 0;
    this.audio.setWarAmbienceVolume(target);
  }
}

interface Vec2Pos {
  x: number;
  y: number;
}
