import Phaser from "phaser";
import { CONFIG, DEPTH, FEEDBACK, CAMERA, BATTLE_ESCALATION, DIFFICULTY, DEFAULT_DIFFICULTY, SAFE_ZONE_VIS } from "../config/gameConfig";
import type { Difficulty } from "../config/gameConfig";
import {
  frameLerpAlpha,
  battlePhaseFactor,
  clashIntensity,
  battleShakeAmplitude,
  warAmbienceTarget,
} from "../systems/cameraFeel";
import type { Faction, RGB, SafeZoneCircle } from "../types";
import type { Vec2 } from "../systems/AI";
import { buildScaledPersonalities, type ScaledPersonalities } from "../systems/difficulty";
import { Unit } from "../entities/Unit";
import { Building } from "../entities/Building";
import { Soul } from "../entities/Soul";
import { Obstacle } from "../entities/Obstacle";
import { Forest } from "../entities/Forest";
import { PowerUp } from "../entities/PowerUp";
import { Projectile, type ProjectileTarget, type ProjectileAttacker } from "../entities/Projectile";
import { SpatialGrid } from "../systems/SpatialGrid";
import { SafeZone } from "../systems/SafeZone";
import { SoundManager } from "../systems/SoundManager";
import { recalcFormationOffset } from "../systems/AI";
import { generateObstacles, generateBuildingClusters, generatePowerUps, spawnVassal } from "../systems/worldgen";
import { generateDecor } from "../systems/decor";
import {
  resolveUnitUnitCollisions,
  resolveUnitBuildingCollisions,
  resolveUnitObstacleCollisions,
  applySeparationForce,
} from "../systems/collision";
import {
  applySafeZoneDamage,
  handlePowerUps,
  handleSouls,
  handleBuildings,
  removeDeadUnits,
  applySoulMagnetism,
} from "../systems/gameplay";
import { updateTowers, updateBarracks } from "../systems/combat";
import { bus, gameRef } from "../ui/bus";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: RGB;
  size: number;
  // Vorberechneter Phaser-Farbwert (einmal beim Spawn statt pro Frame in drawParticles).
  colorInt: number;
  // Reziproke maxLife, um die Division pro Frame in drawParticles zu sparen.
  invMaxLife: number;
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

  // Gewählte Schwierigkeit + daraus abgeleitete Laufzeitwerte. Die Persönlichkeiten
  // sind eine FRISCHE, skalierte Kopie (kein Leak in die globale Konfiguration).
  // Unit/AI lesen diese Werte über die Szene, statt direkt AI.personalities zu nehmen.
  difficulty: Difficulty = DEFAULT_DIFFICULTY;
  scaledPersonalities: ScaledPersonalities = buildScaledPersonalities(DEFAULT_DIFFICULTY);
  // Multiplikator NUR für von KI-Einheiten verursachten Schaden (Spieler bleibt 1.0).
  aiDamageMultiplier = 1;
  // Multiplikator für vom SPIELER-König genommenen Schaden (nur Hardcore > 1.0).
  playerDamageTaken = 1;

  grid!: SpatialGrid;
  safeZone!: SafeZone;
  // Eigener Audio-Manager (NICHT this.sound nennen – das ist Phasers Sound-Manager!)
  audio!: SoundManager;

  gameTime = 0;
  private timeOfDay = 0.5;
  private gameOver = false;
  private recentCombatEvents = 0;
  private combatDecayTimer = 0;
  private lastKingX = 0;
  private lastKingY = 0;
  private kingStationaryTime = 0;
  // Lebende Könige (Spieler + KI), pro Frame in checkGameOver aktualisiert. Treibt die
  // Match-Phase (ruhiger Start -> episches Finale) für Kamera-Shake und Schlacht-Musik.
  private aliveKingCount = 11;
  // Geglätteter Kamera-Scroll (zieht dem König nach, statt hart zu schnappen) + aktuelle,
  // sanft an-/abschwellende Shake-Amplitude in px. Siehe followCamera / updateBattleShake.
  private camScrollX = 0;
  private camScrollY = 0;
  private camShakeIntensity = 0;

  // Eingabe (pro Frame aktualisiert; von Unit gelesen)
  moveVector: Vec2 = { x: 0, y: 0 };
  keyDash = false;
  keyShield = false;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private particles: Particle[] = [];
  // Frei-Pool ausgemusterter Partikel-Objekte – wiederverwendet statt neu zu allokieren,
  // damit Burst-Effekte (Tode, Dash, Level-ups) keinen GC-Müll pro Frame erzeugen.
  private particlePool: Particle[] = [];
  private fxGfx!: Phaser.GameObjects.Graphics;
  private safeGfx!: Phaser.GameObjects.Graphics;
  // Battle-Royale-"Sturm": welt-große getönte Fläche, aus der eine invertierte
  // Geometrie-Maske (safeMaskGfx) das sichere Rund ausstanzt -> alles AUSSERHALB der
  // Zone wird abgedunkelt/rot getönt. Robuster als ein fillPath-Loch (WebGL-Triangulation).
  private dangerOverlay!: Phaser.GameObjects.Rectangle;
  private safeMaskGfx!: Phaser.GameObjects.Graphics;
  private ground!: Phaser.GameObjects.TileSprite;

  // Schaden-Feedback: roter Vignette-Flash (Treffer + Gefahrenzone) und Schadenszahl-Deckel.
  private vignette!: Phaser.GameObjects.Image;
  private hitVignette = 0;
  private activeDamageTexts = 0;

  // Hit-Stop: kurzer Zeit-Freeze für "Wucht" bei einem Königstod. Der Loop returnt
  // früh, solange dieser Timer > 0 ist (Sub-Logik wird kurz angehalten – subtil).
  private hitStopTimer = 0;

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
    this.timeOfDay = 0.5; // bei 0.5 ist die Tageslicht-Kurve am hellsten -> Partie startet hell
    this.gameOver = false;
    this.recentCombatEvents = 0;
    this.combatDecayTimer = 0;
    this.kingStationaryTime = 0;
    this.hitStopTimer = 0;
    this.camShakeIntensity = 0;
    Unit.nextTeamId = 1;
    // Schwierigkeit hart auf Default zurücksetzen, bevor create() die echte Wahl
    // anwendet – so leakt nichts zwischen Runden, falls create() mal früh abbricht.
    this.difficulty = DEFAULT_DIFFICULTY;
    this.scaledPersonalities = buildScaledPersonalities(DEFAULT_DIFFICULTY);
    this.aiDamageMultiplier = 1;
    this.playerDamageTaken = 1;
  }

  create(data: { faction: Faction; difficulty?: Difficulty }): void {
    this.playerFaction = data.faction ?? "human";
    // Schwierigkeit anwenden: skalierte Persönlichkeits-Kopie + Schadens-Multiplikatoren.
    // DIFFICULTY[...] bleibt unangetastet; buildScaledPersonalities liefert eine Kopie.
    this.difficulty = data.difficulty && data.difficulty in DIFFICULTY ? data.difficulty : DEFAULT_DIFFICULTY;
    this.scaledPersonalities = buildScaledPersonalities(this.difficulty);
    this.aiDamageMultiplier = DIFFICULTY[this.difficulty].aiDamage;
    this.playerDamageTaken = DIFFICULTY[this.difficulty].playerDamageTaken;
    this.cameras.main.fadeIn(400, 0, 0, 0);
    this.cameras.main.setBounds(0, 0, CONFIG.worldWidth, CONFIG.worldHeight);

    // Boden (gekachelte Gras-Textur über die ganze Welt)
    this.ground = this.add
      .tileSprite(0, 0, CONFIG.worldWidth, CONFIG.worldHeight, "grass")
      .setOrigin(0, 0)
      .setDepth(DEPTH.ground);

    this.fxGfx = this.add.graphics().setDepth(DEPTH.fx);
    this.safeGfx = this.add.graphics().setDepth(DEPTH.safezone);

    // Sturm-Overlay (Gefahrenzone): welt-große getönte Fläche, knapp unter dem Zonen-Ring.
    // Eine invertierte Geometrie-Maske aus safeMaskGfx (Kreis = sichere Fläche) blendet das
    // Overlay nur AUSSERHALB des Safe-Kreises ein. safeMaskGfx ist unsichtbar (dient nur als
    // Stencil-Quelle) und wird mit der Szene automatisch aufgeräumt. drawSafeZone steuert beides.
    this.dangerOverlay = this.add
      .rectangle(0, 0, CONFIG.worldWidth, CONFIG.worldHeight, SAFE_ZONE_VIS.dangerColor, SAFE_ZONE_VIS.dangerAlpha)
      .setOrigin(0, 0)
      .setDepth(DEPTH.safezone - 1)
      .setVisible(false);
    this.safeMaskGfx = this.add.graphics().setVisible(false);
    const safeMask = this.safeMaskGfx.createGeometryMask();
    safeMask.invertAlpha = true;
    this.dangerOverlay.setMask(safeMask);

    // Bildschirmfester roter Vignette-Flash (Treffer / Gefahrenzone).
    this.vignette = this.add
      .image(0, 0, "vignette")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.floatingText + 10)
      .setAlpha(0);
    const fitVignette = () => this.vignette.setDisplaySize(this.scale.width, this.scale.height);
    fitVignette();
    this.scale.on(Phaser.Scale.Events.RESIZE, fitVignette);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, fitVignette));

    this.grid = new SpatialGrid(CONFIG.worldWidth, CONFIG.worldHeight, 150);
    this.safeZone = new SafeZone();
    this.audio = new SoundManager(this);
    this.audio.startWarAmbience();

    this.setupInput();
    this.spawnWorld();

    // Kamera folgt dem Spielerkönig (geglättet nachgezogen – siehe followCamera/update).
    // Beim Start hart auf den König schnappen (snap), damit das erste Bild zentriert ist.
    this.followCamera(0, true);

    // Aktive Szene fürs DOM-HUD registrieren (liest den Zustand pro Frame).
    gameRef.current = this;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audio.stopAll();
      gameRef.current = null;
    });
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys("W,A,S,D,SPACE,Q") as Record<string, Phaser.Input.Keyboard.Key>;
    // Pause (ESC/P, Touch-Button) wird vom DOM-UI auf Fensterebene behandelt;
    // die Szene wird dabei von aussen via scene.pause("Game") eingefroren.
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
    // Dekorative Welt-Ausstattung NACH den Hindernissen (weicht ihnen aus), VOR den
    // Gebäuden in der Erzeugungsreihenfolge – die Tiefen-Ebenen (DEPTH.decor < building)
    // sorgen ohnehin dafür, dass Gebäude/Einheiten über den Props liegen.
    generateDecor(this);
    generateBuildingClusters(this);
    generatePowerUps(this);
    for (const u of this.units) this.grid.addEntity(u);
  }

  // ---- Hilfsmethoden, die von Entities/Systemen genutzt werden ----

  notifyCombatEvent(): void {
    this.recentCombatEvents++;
  }

  // Wird von gameplay.removeDeadUnits beim Tod eines KÖNIGS gerufen (nicht für Vasallen).
  // Löst den Hit-Stop ("Wucht"-Freeze) aus, gibt das Kill-Feed-Event ans HUD weiter und zündet
  // den cineastischen Königstöter-Finisher am Todesort. Kommunikationsweg HUD <- Game: Phaser-
  // Scene-Event "kingKilled" auf dieser Szene.
  // x/y = Zentrum des gefallenen Königs; nearPlayer = Tod nahe am Spielerkönig (verstärkt den Flash).
  onKingKilled(faction: Faction, kingsLeft: number, x: number, y: number, nearPlayer: boolean): void {
    // Sehr kurzer Zeit-Freeze (60ms) – subtil, schadet der Logik nicht (Loop returnt früh).
    this.hitStopTimer = HIT_STOP_MS;
    bus.emit("kingKilled", { faction, kingsLeft });
    // Hit-Stop + Kill-Feed passieren IMMER (auch offscreen); die schweren FX nur wenn sichtbar.
    this.kingKillCinematic(x, y, nearPlayer);
  }

  // Königstöter-Finisher: rein additive "Wow"-FX am Todesort eines rivalisierenden Königs –
  // der größte Beat der Runde. Geschichtet: Schockwellen-Ring + Gold-Funke + Gold-Explosion +
  // Gold-Screen-Flash + ein einzelner Shake (skaliert mit der Match-Phase). Nur on-screen, sonst
  // billig übersprungen (Offscreen-Tode behalten Hit-Stop + Kill-Feed, brauchen aber keine Optik).
  kingKillCinematic(x: number, y: number, nearPlayer: boolean): void {
    if (!this.isOnScreen(x, y)) return;
    const cfg = FEEDBACK.kingKill;

    // a) Schockwellen-Ring: expandierende Gold-Konkussion (powerup-Textur, ADD-Blend).
    const ring = this.add.image(x, y, "powerup");
    ring.setBlendMode(Phaser.BlendModes.ADD).setTint(cfg.ringColor).setDepth(DEPTH.fx);
    ring.setDisplaySize(40, 40).setAlpha(0.9);
    this.tweens.add({
      targets: ring,
      displayWidth: cfg.ringMaxSize,
      displayHeight: cfg.ringMaxSize,
      alpha: 0,
      duration: cfg.ringDuration,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    // b) Gold-weißer Stern-Flash (sparkle-Textur, ADD-Blend) – heller Kern-Funke (vgl. sparkleBurst).
    const star = this.add.image(x, y, "sparkle");
    star.setBlendMode(Phaser.BlendModes.ADD).setTint(cfg.ringColor).setDepth(DEPTH.fx);
    star.setDisplaySize(10, 10).setAlpha(1);
    this.tweens.add({
      targets: star,
      displayWidth: cfg.starSize,
      displayHeight: cfg.starSize,
      angle: 35,
      alpha: 0,
      duration: cfg.starDuration,
      ease: "Cubic.easeOut",
      onComplete: () => star.destroy(),
    });

    // c) Große Gold-Explosion – heller/größer/schneller als der rote Standard-Kern aus
    // removeDeadUnits, damit der Königstod klar als Explosion liest (rote Kern-Schicht bleibt dort).
    this.spawnVisualEffect(x, y, { r: 255, g: 230, b: 150 }, cfg.particleCount, 520, 4, 2.2);

    // d) Voll-Screen-Gold-Flash (eigenes screen-fixes Rechteck, ADD-Blend) – NICHT die rote
    // Schaden-Vignette kapern. Stärker, wenn der Tod nahe am Spieler war.
    const flash = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, cfg.flashColor)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.floatingText + 5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(cfg.flashAlpha * (nearPlayer ? 1 : 0.45));
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: cfg.flashDuration,
      onComplete: () => flash.destroy(),
    });

    // e) Ein einzelner Shake, dessen Intensität mit der Match-Phase wächst: früh dezent, im
    // finalen Duell episch – respektiert die "früh shake-frei"-Entscheidung (kleine Basis).
    const intensity = cfg.shakeBase + cfg.shakeEpicBonus * this.battlePhase();
    this.screenShake(cfg.shakeDuration, intensity);
  }

  // König-Level-up-Schockwelle: rein additive FX, wenn der König SELBST eine Stufe aufsteigt –
  // ein persönlicher Wachstums-Beat, kein screen-weites Ereignis. Daher KEIN Screen-Flash und
  // KEIN Shake (anders als der Königstöter-Finisher), und bewusst kleiner als dieser, damit ein
  // Kill der größere Moment bleibt. Lokal am König, nur on-screen gefeuert (offscreen billig übersprungen).
  kingLevelUpShockwave(x: number, y: number): void {
    if (!this.isOnScreen(x, y)) return;
    const cfg = FEEDBACK.kingLevelUp;

    // a) Schockwellen-Ring: expandierende Gold-Konkussion (powerup-Textur, ADD-Blend) – kleiner als beim Kill.
    const ring = this.add.image(x, y, "powerup");
    ring.setBlendMode(Phaser.BlendModes.ADD).setTint(cfg.ringColor).setDepth(DEPTH.fx);
    ring.setDisplaySize(30, 30).setAlpha(0.9);
    this.tweens.add({
      targets: ring,
      displayWidth: cfg.ringMaxSize,
      displayHeight: cfg.ringMaxSize,
      alpha: 0,
      duration: cfg.ringDuration,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    // b) Gold-weißer Stern-Flash (sparkle-Textur, ADD-Blend) – heller Kern-Funke am König.
    const star = this.add.image(x, y, "sparkle");
    star.setBlendMode(Phaser.BlendModes.ADD).setTint(cfg.starColor).setDepth(DEPTH.fx);
    star.setDisplaySize(10, 10).setAlpha(1);
    this.tweens.add({
      targets: star,
      displayWidth: cfg.starSize,
      displayHeight: cfg.starSize,
      angle: 35,
      alpha: 0,
      duration: cfg.starDuration,
      ease: "Cubic.easeOut",
      onComplete: () => star.destroy(),
    });
  }

  spawnProjectile(x: number, y: number, target: ProjectileTarget, damage: number, team: number, attacker?: ProjectileAttacker): void {
    this.projectiles.push(new Projectile(this, x, y, target, damage, team, attacker));
  }

  // figureWidth ist die optische Figurbreite (Unit.barRef), nicht die Hitbox. Die Sichel
  // startet kompakt (~0.9× Figurbreite) und wischt auf ~1.8× auf – bewusst kleiner als
  // zuvor (war 1.0×→2.4×), damit sie zur neuen, größeren Unit-Optik passt statt sie zu überdecken.
  spawnSlash(x: number, y: number, rotation: number, figureWidth: number): void {
    const img = this.add
      .image(x, y, "slash")
      .setRotation(rotation)
      .setDepth(DEPTH.slash)
      .setAlpha(0.5);
    img.setDisplaySize(figureWidth * 1.8, figureWidth * 1.8);
    img.setScale(img.scaleX * 0.5, img.scaleY * 0.5);
    this.tweens.add({
      targets: img,
      scaleX: img.scaleX * 2,
      scaleY: img.scaleY * 2,
      alpha: 0,
      duration: 450,
      onComplete: () => img.destroy(),
    });
  }

  spawnVisualEffect(x: number, y: number, color: RGB, count = 10, lifetime = 300, size = 2, speed = 1): void {
    // Farbe einmal pro Burst berechnen (alle Partikel teilen sie) statt pro Frame/Partikel.
    const colorInt = Phaser.Display.Color.GetColor(color.r, color.g, color.b);
    const invMaxLife = lifetime > 0 ? 1 / lifetime : 0;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const sp = Math.random() * speed;
      const vx = Math.cos(angle) * sp;
      const vy = Math.sin(angle) * sp;
      // Aus dem Frei-Pool wiederverwenden, sonst neu anlegen (allokationsarm).
      const p = this.particlePool.pop();
      if (p) {
        p.x = x;
        p.y = y;
        p.vx = vx;
        p.vy = vy;
        p.life = lifetime;
        p.maxLife = lifetime;
        p.color = color;
        p.size = size;
        p.colorInt = colorInt;
        p.invMaxLife = invMaxLife;
        this.particles.push(p);
      } else {
        this.particles.push({ x, y, vx, vy, life: lifetime, maxLife: lifetime, color, size, colorInt, invMaxLife });
      }
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

  // Kurzer Kamera-Shake (komponiert mit dem manuellen centerOn pro Frame).
  screenShake(duration: number = FEEDBACK.shakeDuration, intensity: number = FEEDBACK.shakeOnPlayerHit): void {
    this.cameras.main.shake(duration, intensity);
  }

  // Liegt ein Weltpunkt (grob) im sichtbaren Kamerabereich?
  isOnScreen(x: number, y: number, margin = 100): boolean {
    const v = this.cameras.main.worldView;
    return x >= v.x - margin && x <= v.right + margin && y >= v.y - margin && y <= v.bottom + margin;
  }

  // Wird ausgelöst, wenn der Spielerkönig Schaden nimmt: Shake + roter Vignette-Flash.
  onPlayerKingHit(amount: number): void {
    this.hitVignette = FEEDBACK.vignettePeak;
    this.screenShake(FEEDBACK.shakeDuration, FEEDBACK.shakeOnPlayerHit * Math.min(2, 1 + amount / 20));
  }

  // Schwebende Schadenszahl – nur sichtbare Treffer, mit hartem Mengen-Deckel.
  spawnDamageNumber(amount: number, x: number, y: number): void {
    if (this.activeDamageTexts >= FEEDBACK.maxDamageNumbers) return;
    if (!this.isOnScreen(x, y, 40)) return;
    this.activeDamageTexts++;
    const jitterX = (Math.random() - 0.5) * 14;
    const t = this.add
      .text(x + jitterX, y - 8, `-${Math.round(amount)}`, {
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "14px",
        color: "#ff5b5b",
        stroke: "#2a0000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.floatingText);
    this.tweens.add({
      targets: t,
      y: y - 36,
      alpha: 0,
      duration: 620,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.activeDamageTexts--;
        t.destroy();
      },
    });
  }

  // Treibt das Vignette-Alpha aus zwei Quellen: Treffer-Flash (abklingend) und
  // dauerhafter Gefahren-Puls, solange der Spielerkönig ausserhalb der Safe-Zone ist.
  private updateDamageVignette(dt: number): void {
    if (this.hitVignette > 0) this.hitVignette = Math.max(0, this.hitVignette - dt * 0.0025);

    let danger = 0;
    const king = this.playerKing;
    if (king) {
      const sz = this.safeZoneCurrent;
      const dist = Math.hypot(king.centerX - sz.centerX, king.centerY - sz.centerY);
      if (dist > sz.radius) danger = 0.22 + 0.08 * Math.sin(this.gameTime * 0.008);
    }
    this.vignette.setAlpha(Math.max(this.hitVignette, danger));
  }

  // ---- Haupt-Loop ----

  update(_time: number, delta: number): void {
    if (this.gameOver) return;

    // Hit-Stop: Simulation für wenige ms einfrieren (Wucht bei Königstod). Kamera folgt
    // weiter, Tweens/Partikel laufen über Phaser-Manager normal weiter. Danach normal fort.
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= delta;
      this.followCamera(delta);
      return;
    }

    const dt = Math.min(delta, 100); // gegen Tunneln bei Frame-Spikes

    this.readInput();
    this.updateTime(dt);
    this.gameTime += dt;
    this.updateFormations(dt);

    for (const u of this.units) u.update(dt, this);
    updateTowers(this, dt);
    updateBarracks(this, dt);

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
    applySoulMagnetism(this, dt);
    handleSouls(this);
    handleBuildings(this);
    removeDeadUnits(this);
    applySeparationForce(this);

    this.checkGameOver();
    if (this.gameOver) return;

    this.updateParticles(dt);
    this.updateBattleShake(dt);
    this.updateWarVolume();
    this.updateDamageVignette(dt);

    // Darstellung aktualisieren
    const playerTeam = this.playerKing ? this.playerKing.team : null;
    for (const u of this.units) {
      u.scenePlayerTeam = playerTeam;
      u.sync();
    }
    for (const p of this.projectiles) p.sync();
    for (const b of this.buildings) b.sync();

    this.followCamera(dt);
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
    // Sanftes "Atmen" des Bodens als lebendige Tageslicht-Ambiente. Bewusst SUBTIL
    // (0.85–1.0 statt früher 0.5–1.0): der Tint greift nur am Gras-Boden, nicht an
    // Props/Gebäuden/Einheiten – ein starker Hub würde das Gras sichtbar von der hellen
    // Deko entkoppeln ("dunkles Gras, helle Bäume"). timeOfDay startet bei 0.5, damit
    // jede Partie auf vollem Tageslicht beginnt (heller erster Eindruck).
    const brightness = 0.85 + 0.15 * Math.abs(Math.sin(this.timeOfDay * Math.PI));
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
    // Lebende Könige cachen (Spieler + Gegner) – Eingang der Match-Phase für Shake & Musik.
    this.aliveKingCount = enemyKings.length + 1;
    if (enemyKings.length === 0) this.endGame("Gewonnen");
  }

  private endGame(message: string): void {
    this.gameOver = true;
    this.audio.stopAll();
    if (message === "Verloren") this.cameras.main.shake(260, 0.011);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      bus.emit("gameOver", { result: message === "Gewonnen" ? "win" : "loss", faction: this.playerFaction });
      this.scene.stop();
    });
  }

  private updateParticles(dt: number): void {
    const step = dt / 16;
    const arr = this.particles;
    // Swap-Remove statt splice: tote Partikel werden mit dem letzten getauscht und
    // per pop() entfernt (O(1) je Entfernung statt O(n)). Reihenfolge ist für reine
    // Visuals ohne Belang. Ausgemusterte Objekte wandern in den Frei-Pool zurück.
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        const last = arr.length - 1;
        if (i !== last) arr[i] = arr[last];
        arr.pop();
        this.particlePool.push(p);
      } else {
        p.x += p.vx * step;
        p.y += p.vy * step;
      }
    }
  }

  private drawParticles(): void {
    const g = this.fxGfx;
    g.clear();
    // colorInt/invMaxLife sind beim Spawn vorberechnet -> kein GetColor und keine
    // Division pro Partikel pro Frame mehr.
    for (const p of this.particles) {
      let alpha = p.life * p.invMaxLife;
      if (alpha < 0) alpha = 0;
      g.fillStyle(p.colorInt, alpha);
      g.fillCircle(p.x, p.y, p.size);
    }
  }

  private drawSafeZone(): void {
    this.safeGfx.clear();
    // Vor Aktivierung (Vorlauf) ist die ganze Welt sicher -> kein Ring, kein Sturm.
    if (this.safeZone.state === "delay") {
      this.dangerOverlay.setVisible(false);
      return;
    }
    const c = this.safeZone.current;
    // Maske (sicheres Rund) aktualisieren – das invertiert-maskierte Sturm-Overlay
    // zeigt sich dadurch nur AUSSERHALB des aktuellen Safe-Kreises.
    this.safeMaskGfx.clear();
    this.safeMaskGfx.fillStyle(0xffffff, 1);
    this.safeMaskGfx.fillCircle(c.centerX, c.centerY, c.radius);
    this.dangerOverlay.setVisible(true);
    // Heller roter Zonen-Ring (Kante der sicheren Fläche).
    this.safeGfx.lineStyle(4, SAFE_ZONE_VIS.ringColor, 1);
    this.safeGfx.strokeCircle(c.centerX, c.centerY, c.radius);
    const t = this.safeZone.target;
    if (c.radius !== t.radius || c.centerX !== t.centerX || c.centerY !== t.centerY) {
      // Vorschau-Ring des nächsten Ziel-Kreises (wohin geschrumpft/gewandert wird).
      this.safeGfx.lineStyle(2, SAFE_ZONE_VIS.ringColor, 0.6);
      this.safeGfx.strokeCircle(t.centerX, t.centerY, t.radius);
    }
  }

  // Aktuelle Match-Phase in [0,1]: 0 = frühe, ruhige Phase (viele Könige), 1 = episches Finale
  // (nur noch 2 Könige). Treibt sowohl die Schlacht-Musik als auch das Kamera-Schütteln.
  private battlePhase(): number {
    return battlePhaseFactor(this.aliveKingCount, BATTLE_ESCALATION.earlyKings, BATTLE_ESCALATION.finalKings);
  }

  private updateWarVolume(): void {
    this.combatDecayTimer += this.game.loop.delta;
    if (this.combatDecayTimer >= 1000) {
      if (this.recentCombatEvents > 0) this.recentCombatEvents = Math.max(0, this.recentCombatEvents - 1);
      this.combatDecayTimer = 0;
    }
    // Lautstärke skaliert mit Kampf/Truppen UND der Phase: ruhiger Start, lautes Finale.
    let target = warAmbienceTarget(this.recentCombatEvents, this.units.length, this.battlePhase(), BATTLE_ESCALATION);
    if (this.recentCombatEvents === 0 && this.units.length < 10) target = 0;
    this.audio.setWarAmbienceVolume(target);
  }

  // Sanft an-/abschwellende Ziel-Shake-Amplitude. NUR aktiv, wenn tatsächlich gekämpft wird
  // (Clash-Gate) und stärker, je weiter das Match Richtung Finale schrumpft (Phase). So bleibt
  // der Match-Anfang ruhig und das Bild bebt erst beim epischen Endkampf spürbar.
  private updateBattleShake(dt: number): void {
    const clash = clashIntensity(this.recentCombatEvents, BATTLE_ESCALATION.clashThreshold, BATTLE_ESCALATION.clashRange);
    const target = battleShakeAmplitude(
      this.battlePhase(),
      clash,
      BATTLE_ESCALATION.baselineShakePx,
      BATTLE_ESCALATION.epicShakePx,
    );
    this.camShakeIntensity += (target - this.camShakeIntensity) * frameLerpAlpha(dt, BATTLE_ESCALATION.shakeSmooth);
    if (this.camShakeIntensity < 0.01) this.camShakeIntensity = 0;
  }

  // Kamera zieht dem König geglättet NACH (statt hart pro Frame auf seine zitternde Position
  // zu schnappen) und addiert das gewollte Schlacht-Schütteln als kurzlebigen Zufalls-Offset.
  // Abschließend auf ganze Pixel runden (render.roundPixels ist aus -> sonst Sub-Pixel-Flimmern).
  // snap=true setzt die Kamera hart aufs Ziel (Start/erstes Frame). Mirror von centerOn bei zoom=1.
  private followCamera(dt: number, snap = false): void {
    const king = this.playerKing;
    if (!king) return;
    const cam = this.cameras.main;
    const targetX = king.centerX - cam.width * 0.5;
    const targetY = king.centerY - cam.height * 0.5;
    if (snap) {
      this.camScrollX = targetX;
      this.camScrollY = targetY;
    } else {
      const a = frameLerpAlpha(dt, CAMERA.followLerp);
      this.camScrollX += (targetX - this.camScrollX) * a;
      this.camScrollY += (targetY - this.camScrollY) * a;
    }
    let sx = this.camScrollX;
    let sy = this.camScrollY;
    const amp = this.camShakeIntensity;
    if (amp > 0.01) {
      sx += (Math.random() * 2 - 1) * amp;
      sy += (Math.random() * 2 - 1) * amp;
    }
    cam.setScroll(CAMERA.roundToPixel ? Math.round(sx) : sx, CAMERA.roundToPixel ? Math.round(sy) : sy);
  }
}

interface Vec2Pos {
  x: number;
  y: number;
}

// Dauer des Hit-Stop-Freezes bei einem Königstod (ms) – subtil im Bereich 40–80ms.
const HIT_STOP_MS = 60;
