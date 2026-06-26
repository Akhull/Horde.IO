import Phaser from "phaser";
import { Entity } from "./Entity";
import { CONFIG, UNIT_STATS, DEPTH, FEEDBACK, AI, FACTION_STATS, LEGENDARY, POWERUP, HITBOX_SCALE } from "../config/gameConfig";
import type { AIPersonality } from "../config/gameConfig";
import { AURA_TINT } from "../config/spriteConfig";
import type { Faction, UnitType } from "../types";
import type { Vec2 } from "../systems/AI";
import { determineVassalTarget, chooseAIKingTarget, findKingCollectible, computeKingAvoidance } from "../systems/AI";
import type { ProjectileTarget } from "./Projectile";
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
  // Fraktions-skaliertes Maximum (für Healthbar-Clamping/Ratio). Wird im
  // Konstruktor EINMAL aus dem UNIT_STATS-Grundwert * FACTION_STATS.hp gesetzt;
  // hp startet identisch (Vollleben). Ersetzt den alten Konstanten-Getter, der
  // den Fraktions-Modifikator ignoriert hätte (Orc-König: 330 statt 300).
  maxHp!: number;
  speed!: number;
  // Fraktions-Schadensmodifikator (FACTION_STATS.damage). Wird in meleeDamage()
  // und beim Pfeilschaden multipliziert, damit ein Level-up (Schaden wird pro
  // Stufe neu gelesen) den Modifikator weiterhin korrekt widerspiegelt.
  private factionDamageMod = 1;
  leader!: Unit;

  // König
  dashTimer = 0;
  lastDirection: Vec2 = { x: 0, y: 0 };
  shieldCooldownTimer = 0;
  shieldTimer = 0;
  isShieldActive = false;
  // Tempo-Power-Up: zeitbasiert statt gestapelter delayedCall-Resets. Solange
  // speedBoostTimer > 0 ist, gilt der x1.5-Boost; erneutes Aufsammeln verlängert
  // nur die Dauer (kein erneutes Multiplizieren -> kein Speed-Stacking/Leak).
  speedBoostTimer = 0;
  // Schadens-Power-Up: gleiche Zeitlogik wie der Tempo-Boost. Solange
  // damageBoostTimer > 0 ist, multipliziert damageBoostMult den ausgeteilten
  // Nahkampf- UND Pfeilschaden; erneutes Aufsammeln verlängert nur die Dauer.
  // Anders als beim Tempo (das speed direkt skaliert) wird hier ein Multiplikator
  // im Schadenspfad gelesen – meleeDamage/Pfeilschaden werden pro Treffer neu
  // berechnet, ein laufender Faktor genügt also (kein Stacking-Leak möglich).
  damageBoostTimer = 0;
  private damageBoostMult = 1;
  // Rüstungs-Power-Up (defensives Gegenstück zum Schadens-Boost): gleiche Zeitlogik.
  // Solange armorTimer > 0 ist, skaliert armorMult den EINGEHENDEN Schaden (< 1 =
  // Reduktion) in takeDamage und beim Zonenschaden; Aufsammeln verlängert nur die Dauer.
  armorTimer = 0;
  private armorMult = 1;
  // Lifesteal-Power-Up (offensive Sustain): gleiche Zeitlogik wie die übrigen Boosts.
  // Solange lifestealTimer > 0 ist, heilt sich der Träger um lifestealFactor des
  // AUSGETEILTEN Schadens (Nahkampf + Pfeil); Aufsammeln verlängert nur die Dauer.
  // 0 als Inaktiv-Wert: tickLifesteal setzt den Faktor beim Ablauf sauber zurück.
  lifestealTimer = 0;
  private lifestealFactor = 0;
  // Regen-Power-Up (passive Sustain): gleiche Zeitlogik wie die übrigen Boosts.
  // Solange regenTimer > 0 ist, regeneriert tickRegen pro Frame POWERUP.regenPerSecond
  // HP (zeitbasiert über deltaSeconds), GEKLEMMT auf das fraktions-skalierte maxHp.
  // Anders als der Lifesteal heilt er IMMER (auch beim Fliehen/Wandern), nicht nur
  // beim Zuschlagen; es gibt keinen Faktor zurückzusetzen – der Timer steuert alles.
  regenTimer = 0;
  // Steady-Power-Up (Anti-CC + Momentum): gleiche Zeitlogik wie die übrigen Boosts.
  // Solange steadyTimer > 0 ist, hat steady ZWEI Effekte: (1) der EINGEHENDE Rückstoß-
  // Impuls in takeDamage wird mit POWERUP.knockbackResistFactor (< 1) multipliziert
  // (greift nur bei Einheiten, die Rückstoß nehmen – also NICHT beim Spieler-König);
  // (2) ein Bewegungs-Bonus POWERUP.steadyMoveFactor (> 1) über moveSpeedFactor, der AUCH
  // beim Spieler greift – so ist steady für JEDEN Träger ein echter Vorteil, nie ein
  // verschwendeter Slot. Es gibt – wie beim Regen – keinen Faktor zurückzusetzen: der
  // Timer steuert alles, beide Faktoren werden konstant aus der Config gelesen.
  steadyTimer = 0;
  dashReadyFlashTimer = 0;
  shieldReadyFlashTimer = 0;
  idleTarget: Vec2 | null = null;

  // KI-König-Persönlichkeit (nur für unitType === "king" gesetzt). Steuert
  // Aggro-Reichweite, Rückzugs-Schwelle und Seelen-Gier in updateAIKing.
  // Der Spielerkönig bekommt zwar ein Tier zugewiesen, nutzt es aber nicht.
  aiPersonality: AIPersonality = "balanced";
  // true, solange der König nach einem HP-Einbruch flieht (Hysterese, damit er
  // nicht am Schwellenwert flackert: Rückzug bis regroupHpFactor erreicht ist).
  private isRetreating = false;

  // Bogenschütze
  attackCooldown = 0;
  lastAttackTimer = 0;

  // Paladin-Champion (Mensch): Countdown bis zum nächsten Heil-Puls der Aura.
  private healPulseTimer = 0;

  // Nahkampf
  isAttacking = false;
  attackTimer = 0;
  attackDamageDealt = false;
  currentTarget: ProjectileTarget | null = null;
  formationOffset: Vec2 | null = null;

  // Treffer-Feedback
  private flashTimer = 0;
  private flashShown = false;
  knockbackVx = 0;
  knockbackVy = 0;

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

  // Anzeigegröße des Sprites (setDisplaySize). Bewusst von der Hitbox (width/height)
  // entkoppelt: die Figur rendert groß, die Hitbox bleibt über HITBOX_SCALE moderat.
  private displaySize: number;
  // Optische Bezugsbreite für Healthbar/Ringe (≈ sichtbare Figurbreite, nicht die
  // kleine Hitbox und nicht das ganze gepaddete Chip). In sync() wiederverwendet.
  private barRef = 0;

  // Darstellung (statisches Kenney-Sprite, Faktionsfarbe ist ins PNG gebacken).
  private sprite: Phaser.GameObjects.Sprite;
  private spriteKey: string;
  private barBg: Phaser.GameObjects.Rectangle;
  private barFill: Phaser.GameObjects.Rectangle;
  private shieldRing?: Phaser.GameObjects.Arc;
  private archerOutline?: Phaser.GameObjects.Rectangle;
  private championRing?: Phaser.GameObjects.Arc;
  // Pulsierende ADD-Blend-Aura (weicher Glow-Image) unter Elite-Einheiten. Champion und
  // Level-3-Vasall teilen sich denselben Mechanismus (attachEliteAura), nur der Tint
  // unterscheidet sie. Liegt auf DEPTH.shadow (unter der Figur, über dem Boden), folgt
  // der Einheit in sync() und wird in destroyView() sauber mit-zerstört (kein Leak).
  private eliteAura?: Phaser.GameObjects.Image;

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
      this.displaySize = UNIT_STATS.king.size;
      // Persönlichkeit gleichverteilt würfeln. So verhalten sich die 10 KI-Könige
      // spürbar unterschiedlich (Aggro/Rückzug/Sammeln), statt 10x identisch.
      const pool = AI.personalityPool;
      this.aiPersonality = pool[Math.floor(Math.random() * pool.length)];
    } else if (unitType === "archer") {
      this.team = leader!.team;
      this.hp = UNIT_STATS.archer.hp;
      this.speed = UNIT_STATS.archer.speed;
      this.leader = leader!;
      this.attackCooldown = UNIT_STATS.archer.attackCooldown;
      this.displaySize = UNIT_STATS.archer.size;
    } else if (unitType === "champion") {
      // Legendäre Spezialeinheit (aus Gold-Orb). Deutlich größer/zäher als ein Vasall;
      // die fraktionsspezifische Mechanik (Aura/Reichweite/AoE) steckt in LEGENDARY.
      this.team = leader!.team;
      this.hp = UNIT_STATS.champion.hp;
      this.speed = UNIT_STATS.champion.speed;
      this.leader = leader!;
      this.displaySize = UNIT_STATS.champion.size;
      // Fernkampf-Legendäre (Elf-Erzschütze) brauchen eine Feuerrate (sonst feuert
      // updateArcher mit attackCooldown 0 jeden Frame).
      this.attackCooldown = LEGENDARY[faction].attackCooldown ?? UNIT_STATS.archer.attackCooldown;
    } else {
      this.team = leader!.team;
      this.hp = UNIT_STATS.vassal.hp;
      this.speed = UNIT_STATS.vassal.speed;
      this.leader = leader!;
      this.displaySize = UNIT_STATS.vassal.sizeByLevel[level] ?? UNIT_STATS.vassal.sizeByLevel[1];
    }
    // Hitbox (width/height) aus der Anzeigegröße ableiten – bewusst kleiner (HITBOX_SCALE),
    // damit die großen Figuren den Kollisions-/Formations-Footprint nicht aufblähen.
    this.width = this.displaySize * HITBOX_SCALE;
    this.height = this.displaySize * HITBOX_SCALE;

    // Fraktions-Identität: hp/speed/damage werden EINMAL mit dem fraktionseigenen
    // Modifikator multipliziert (siehe FACTION_STATS). Gilt für JEDEN Typ – König,
    // Vasall (alle Stufen), Archer, Champion –, damit König und Horde dieselbe
    // Fraktion teilen (faction wird vom Anführer geerbt, siehe worldgen.spawnVassal).
    // attackRange/Cooldowns bleiben bewusst unangetastet.
    const fs = FACTION_STATS[faction];
    // HP runden (Healthbar zeigt ganze Zahlen, hp/maxHp werden ganzzahlig verglichen).
    this.hp = Math.round(this.hp * fs.hp);
    this.maxHp = this.hp; // Start mit vollem, bereits skaliertem Leben
    this.speed *= fs.speed;
    this.factionDamageMod = fs.damage;

    this.prevX = x;
    this.prevY = y;
    this.footstepTimer = this.footstepMin + Math.random() * (this.footstepMax - this.footstepMin);

    // Champion nutzt das schwere Legion-Sprite (l3) für eine elitäre Optik.
    // Der Texture-Key IST der spriteKey (BootScene lädt die Kenney-PNGs unter
    // genau diesen Keys); kein Tint, die Faktionsfarbe steckt im Sprite.
    this.spriteKey = unitType === "king" ? `${faction}_king` : unitType === "champion" ? `${faction}_l3` : `${faction}_l${level}`;
    this.sprite = scene.add.sprite(this.centerX, this.centerY, this.spriteKey).setDepth(DEPTH.unit);
    this.sprite.setDisplaySize(this.displaySize, this.displaySize);

    // Healthbar/Ringe orientieren sich an einer optischen Bezugsbreite, NICHT an der
    // (kleinen) Hitbox – sonst wären Bar/Ring unter den großen Figuren viel zu schmal.
    // barRef ≈ tatsächliche Figurbreite im Chip (displaySize * Figur-Anteil), damit die
    // Leiste etwa so breit wie die sichtbare Figur ist statt wie das ganze (gepaddete) Chip.
    this.barRef = this.displaySize * (unitType === "king" ? 0.26 : 0.32);
    const barRef = this.barRef;
    const barH = unitType === "king" ? 8 : 5;
    this.barBg = scene.add.rectangle(this.x, this.y, barRef, barH, 0x000000).setOrigin(0, 0.5).setDepth(DEPTH.healthbar);
    this.barFill = scene.add.rectangle(this.x, this.y, barRef, barH, 0xff0000).setOrigin(0, 0.5).setDepth(DEPTH.healthbar);

    if (unitType === "king") {
      this.shieldRing = scene.add.circle(this.centerX, this.centerY, barRef, 0x00ffff, 0).setStrokeStyle(3, 0x00ffff).setDepth(DEPTH.healthbar).setVisible(false);
    }
    if (unitType === "archer") {
      // Gold-Umriss als Archer-Marker, an der optischen Figur zentriert (barRef), nicht an
      // der kleinen Hitbox – sonst säße der Rahmen winzig mitten in der Figur.
      this.archerOutline = scene.add.rectangle(this.centerX, this.centerY, barRef, barRef).setStrokeStyle(2, 0xffd700).setDepth(DEPTH.unit);
    }
    if (unitType === "champion") {
      // Goldener Aura-Ring kennzeichnet den Champion klar als legendäre Einheit.
      this.championRing = scene.add.circle(this.centerX, this.centerY, barRef * 0.62, 0xffd700, 0).setStrokeStyle(3, 0xffd700, 0.9).setDepth(DEPTH.healthbar);
      // Zusätzlich zum statischen Ring ein "atmender" Gold-Glow UNTER der Figur, plus
      // der einmalige Beschwörungs-Funke – beides macht die Beschwörung spürbar elitär.
      this.attachEliteAura(AURA_TINT.champion);
      this.sparkleBurst(scene, this.centerX, this.centerY, AURA_TINT.champion);
    }
    // Defensiv: ein bereits auf Stufe 3 konstruierter Vasall bekommt seine Lila-Aura sofort
    // (der Regelfall ist der Upgrade-Pfad über setLevel, der die Aura dort selbst anhängt).
    if (unitType === "vassal" && level === 3) {
      this.attachEliteAura(AURA_TINT.elite);
    }
  }

  // Hängt eine pulsierende ADD-Blend-Glow-Aura unter die Einheit (gemeinsamer Mechanismus
  // für Champion-Gold und Level-3-Lila; nur der Tint unterscheidet sie). Idempotent: ein
  // zweiter Aufruf (z. B. erneutes setLevel(3)) wird ignoriert, damit keine Aura doppelt
  // entsteht (Leak). Die "Atem"-Pulsation (Scale + Alpha, Sine-Yoyo, endlos) läuft an der
  // Aura selbst und braucht keine Pro-Frame-Allokation – nur das Folgen passiert in sync().
  private attachEliteAura(tint: number): void {
    if (this.eliteAura) return;
    const scene = this.sprite.scene;
    // Durchmesser ≈ 1.6× der sichtbaren Figur, damit der Glow die Einheit weich umrahmt.
    const d = this.sprite.displayWidth * 1.6;
    const aura = scene.add.image(this.centerX, this.centerY, "powerup");
    aura.setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setDepth(DEPTH.shadow);
    aura.setDisplaySize(d, d).setAlpha(0.7);
    scene.tweens.add({
      targets: aura,
      scale: aura.scale * 1.14,
      alpha: 0.45,
      duration: 900,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
    this.eliteAura = aura;
  }

  // Einmaliger Belohnungs-Funke: ein "sparkle"-Stern (ADD-Blend, passender Tint) auf
  // DEPTH.fx, der von ~8px auf ~64px hochskaliert, leicht rotiert, über ~360ms ausblendet
  // und sich danach selbst zerstört. Nur wenn der Punkt sichtbar ist (isOnScreen), damit
  // er offscreen nichts kostet – ein reiner Feier-Effekt ohne Spiel-Relevanz.
  private sparkleBurst(scene: Phaser.Scene, x: number, y: number, tint: number): void {
    const gs = scene as GameScene;
    if (!gs.isOnScreen(x, y)) return;
    const star = scene.add.image(x, y, "sparkle");
    star.setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setDepth(DEPTH.fx);
    star.setDisplaySize(8, 8).setAlpha(1);
    scene.tweens.add({
      targets: star,
      displayWidth: 64,
      displayHeight: 64,
      angle: 45,
      alpha: 0,
      duration: 360,
      ease: "Cubic.easeOut",
      onComplete: () => star.destroy(),
    });
  }

  // Vasall auf eine höhere Stufe heben: Grösse/Sprite aktualisieren + Aufleucht-Pop.
  setLevel(n: number): void {
    this.level = n;
    this.displaySize = UNIT_STATS.vassal.sizeByLevel[n] ?? UNIT_STATS.vassal.sizeByLevel[1];
    // Hitbox + optische Bar-Bezugsbreite aus der neuen Anzeigegröße ableiten (s. Konstruktor).
    this.width = this.displaySize * HITBOX_SCALE;
    this.height = this.displaySize * HITBOX_SCALE;
    this.barRef = this.displaySize * 0.32;

    // Neuer Texture-Key = neuer Stufen-spriteKey (statisches Kenney-PNG, kein Tint).
    this.spriteKey = `${this.faction}_l${n}`;
    this.sprite.setTexture(this.spriteKey);
    this.sprite.setDisplaySize(this.displaySize, this.displaySize);

    // Level-up: kurzer Skalierungs-Pop. Der Sprung auf Stufe 3 ist die Elite-Belohnung
    // und darf kräftiger "knallen" (1.45 statt 1.3, etwas länger) als ein normaler Level-up.
    const isElite = n === 3;
    this.sprite.scene.tweens.add({
      targets: this.sprite,
      scaleX: this.sprite.scaleX * (isElite ? 1.45 : 1.3),
      scaleY: this.sprite.scaleY * (isElite ? 1.45 : 1.3),
      duration: isElite ? 180 : 150,
      yoyo: true,
    });

    // Stufe 3 = Elite ("Lila-Einheit"): pulsierende Lila-Aura anhängen (Regelfall, der
    // Upgrade-Pfad) + einmaligen Belohnungs-Funke im passenden Lila feuern. attachEliteAura
    // ist idempotent, ein erneutes setLevel(3) erzeugt also keine zweite Aura.
    if (isElite) {
      this.attachEliteAura(AURA_TINT.elite);
      this.sparkleBurst(this.sprite.scene, this.centerX, this.centerY, AURA_TINT.elite);
    }
  }

  // Spielt den passenden Nahkampf-Sound je nach Einheitentyp/Level.
  private meleeSound(): { key: string; vol: number } {
    if (this.unitType === "king" || this.unitType === "champion") return { key: "melee_l3", vol: 1.3 };
    if (this.level === 1) return { key: "melee_l1", vol: 0.7 };
    if (this.level === 2) return { key: "melee_l2", vol: 1.0 };
    return { key: "melee_l3", vol: 1.3 };
  }

  // Nahkampfschaden je nach Einheitentyp/Level (zentral aus UNIT_STATS, statt flat 20).
  // König schlägt am härtesten, Vasallen skalieren mit ihrer Stufe (15/20/25).
  // Der Fraktions-Modifikator wird hier (statt im Konstruktor) angewandt, weil der
  // Schaden pro Level neu gelesen wird – so bleibt er auch nach einem Level-up gültig.
  private meleeDamage(): number {
    const base =
      this.unitType === "king"
        ? UNIT_STATS.king.damage
        : this.unitType === "champion"
          ? UNIT_STATS.champion.damage
          : UNIT_STATS.vassal.damageByLevel[this.level] ?? 20;
    // Schadens-Boost (Power-Up) wirkt OBEN AUF den Fraktions-Modifikator.
    return base * this.factionDamageMod * this.damageBoostMult;
  }

  // Schwierigkeits-Skalierung des AUSGETEILTEN Schadens: nur KI-Einheiten (Team
  // ungleich Spielerkönig) bekommen scene.aiDamageMultiplier; der Spieler und
  // seine Vasallen teilen unverändert aus. Ein einziger, klar benannter Hebel.
  private scaledDamage(base: number, scene: GameScene): number {
    const playerTeam = scene.playerKing ? scene.playerKing.team : null;
    return this.team === playerTeam ? base : base * scene.aiDamageMultiplier;
  }

  // Tempo-Power-Up aufnehmen (Spieler- ODER KI-König). Idempotent gegen Stacking:
  // der x1.5-Faktor wird nur beim ersten Aufnehmen angewandt; weitere Aufnahmen
  // verlängern nur den Timer. tickSpeedBoost setzt den Faktor sauber zurück.
  applySpeedBoost(duration: number): void {
    if (this.speedBoostTimer <= 0) this.speed *= 1.5;
    this.speedBoostTimer = Math.max(this.speedBoostTimer, duration);
  }

  // Schadens-Power-Up aufnehmen (Spieler- ODER KI-König). Idempotent gegen
  // Stacking wie der Tempo-Boost: der Multiplikator wird nur beim ersten Aufnehmen
  // gesetzt, weitere Aufnahmen verlängern nur den Timer. tickDamageBoost setzt
  // den Faktor beim Ablauf sauber auf 1 zurück.
  applyDamageBoost(duration: number): void {
    if (this.damageBoostTimer <= 0) this.damageBoostMult = POWERUP.damageMultiplier;
    this.damageBoostTimer = Math.max(this.damageBoostTimer, duration);
  }

  // Rüstungs-Power-Up aufnehmen (Spieler- ODER KI-König). Idempotent gegen Stacking
  // wie die übrigen Boosts; tickArmorBoost setzt den Faktor beim Ablauf auf 1 zurück.
  applyArmorBoost(duration: number): void {
    if (this.armorTimer <= 0) this.armorMult = POWERUP.armorMultiplier;
    this.armorTimer = Math.max(this.armorTimer, duration);
  }

  // Lifesteal-Power-Up aufnehmen (Spieler- ODER KI-König). Idempotent gegen Stacking
  // wie die übrigen Boosts: der Faktor wird nur beim ersten Aufnehmen gesetzt, weitere
  // Aufnahmen verlängern nur den Timer. tickLifesteal setzt ihn beim Ablauf auf 0 zurück.
  applyLifesteal(duration: number): void {
    if (this.lifestealTimer <= 0) this.lifestealFactor = POWERUP.lifestealFactor;
    this.lifestealTimer = Math.max(this.lifestealTimer, duration);
  }

  // Regen-Power-Up aufnehmen (Spieler- ODER KI-König). Idempotent gegen Stacking wie
  // die übrigen Boosts: es gibt keinen Faktor zu setzen (die Heilrate ist konstant aus
  // POWERUP.regenPerSecond), weitere Aufnahmen verlängern nur den Timer. tickRegen
  // erledigt die eigentliche Heilung pro Frame und das Herunterzählen des Timers.
  applyRegen(duration: number): void {
    this.regenTimer = Math.max(this.regenTimer, duration);
  }

  // Steady-Power-Up aufnehmen (Spieler- ODER KI-König). Idempotent gegen Stacking wie
  // die übrigen Boosts: es gibt keinen Faktor zu setzen (Resist- und Tempo-Bonus sind
  // konstant aus POWERUP), weitere Aufnahmen verlängern nur den Timer. tickSteady zählt
  // den Timer herunter; knockbackResistFactor und moveSpeedFactor lesen ihre Faktoren,
  // solange er läuft. Der Tempo-Bonus macht steady auch für den Spieler-König nützlich.
  applySteady(duration: number): void {
    this.steadyTimer = Math.max(this.steadyTimer, duration);
  }

  // Heilt den Angreifer um lifestealFactor des ausgeteilten Schadens, geklemmt auf
  // das fraktions-skalierte maxHp (kein Überheilen). No-Op, wenn kein Lifesteal aktiv
  // ist oder die Einheit bereits tot/vollgeheilt ist. Wird im Moment des bestätigten
  // AUSTEILENS gerufen (Nahkampf-Haupttreffer + Berserker-Splash + Pfeil-Einschlag).
  private applyLifestealHeal(dealtDmg: number): void {
    if (this.lifestealTimer <= 0 || this.hp <= 0 || dealtDmg <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + dealtDmg * this.lifestealFactor);
  }

  // Öffentlicher Lifesteal-Einlass für den Pfeil: der Projektil ruft dies erst beim
  // bestätigten Einschlag auf ein lebendes Ziel, NICHT schon beim Abschuss. So heilt
  // der Schütze nur für tatsächlich gelandeten Schaden (kein Heilen auf verfehlte
  // Pfeile, wenn das Ziel vorher stirbt oder ausweicht) – analog zum Nahkampf.
  creditLifestealOnHit(dealtDmg: number): void {
    this.applyLifestealHeal(dealtDmg);
  }

  // Eingehender-Schaden-Faktor durch die Rüstung (1 = kein Schutz, < 1 = Reduktion).
  // Öffentlich, damit applySafeZoneDamage den Zonenschaden ebenfalls reduzieren kann –
  // dort multiplikativ mit der Schild-Halbierung kombiniert (zwei Schutzschichten).
  get armorDamageFactor(): number {
    return this.armorMult;
  }

  // Rückstoß-Resist-Faktor durch das Steady-Power-Up (1 = voller Rückstoß, < 1 = reduziert).
  // Wird in takeDamage auf den angewandten Knockback-Impuls multipliziert. Kombiniert sich
  // MULTIPLIKATIV mit dem bestehenden kingKnockbackFactor (Könige sind ohnehin schwerer) –
  // Steady ERSETZT den König-Faktor nicht, sondern reduziert den bereits gewichteten Impuls
  // zusätzlich (z. B. 0.25 König × 0.2 Steady = 0.05 -> nahezu standfest).
  get knockbackResistFactor(): number {
    return this.steadyTimer > 0 ? POWERUP.knockbackResistFactor : 1;
  }

  // Bewegungs-Multiplikator durch das Steady-Power-Up (1 = normal, > 1 = schneller).
  // Read-time im Bewegungs-Schritt gelesen (wie damageBoostMult im Schadenspfad) statt
  // this.speed zu mutieren – so verändert er keinen Basiswert und stapelt sauber
  // MULTIPLIKATIV mit dem Speed-Orb (das this.speed ×1.5 setzt): 1.5 × 1.1. Anders als
  // der Resist-Anteil greift dieser Bonus AUCH beim Spieler-König (der keinen Rückstoß
  // nimmt) und macht steady damit für jeden Träger zu einer echten Aufwertung.
  get moveSpeedFactor(): number {
    return this.steadyTimer > 0 ? POWERUP.steadyMoveFactor : 1;
  }

  // Schild-Power-Up aufnehmen (Spieler- ODER KI-König). Verlängert ein aktives
  // Schild, statt es zu überschreiben – identisch zur bisherigen Spieler-Logik.
  applyShieldPowerUp(duration: number): void {
    if (this.isShieldActive) this.shieldTimer += duration;
    else {
      this.isShieldActive = true;
      this.shieldTimer = duration;
    }
  }

  // Zählt den Tempo-Boost herunter und entfernt den Faktor exakt einmal beim Ablauf.
  private tickSpeedBoost(deltaTime: number): void {
    if (this.speedBoostTimer <= 0) return;
    this.speedBoostTimer -= deltaTime;
    if (this.speedBoostTimer <= 0) {
      this.speedBoostTimer = 0;
      this.speed /= 1.5;
    }
  }

  // Zählt den Schadens-Boost herunter und setzt den Multiplikator beim Ablauf
  // exakt einmal auf 1 zurück (analog zu tickSpeedBoost).
  private tickDamageBoost(deltaTime: number): void {
    if (this.damageBoostTimer <= 0) return;
    this.damageBoostTimer -= deltaTime;
    if (this.damageBoostTimer <= 0) {
      this.damageBoostTimer = 0;
      this.damageBoostMult = 1;
    }
  }

  // Zählt den Rüstungs-Boost herunter und setzt den Faktor beim Ablauf auf 1 zurück.
  private tickArmorBoost(deltaTime: number): void {
    if (this.armorTimer <= 0) return;
    this.armorTimer -= deltaTime;
    if (this.armorTimer <= 0) {
      this.armorTimer = 0;
      this.armorMult = 1;
    }
  }

  // Zählt den Lifesteal-Boost herunter und setzt den Faktor beim Ablauf auf 0 zurück.
  private tickLifesteal(deltaTime: number): void {
    if (this.lifestealTimer <= 0) return;
    this.lifestealTimer -= deltaTime;
    if (this.lifestealTimer <= 0) {
      this.lifestealTimer = 0;
      this.lifestealFactor = 0;
    }
  }

  // Regeneriert pro Frame POWERUP.regenPerSecond HP, geklemmt auf maxHp, solange der
  // Regen-Boost läuft. deltaTime ist hier – wie bei den übrigen tick*-Methoden – in
  // Millisekunden (die Timer zählen gegen Power-Up-Dauern wie 6000), daher wird über
  // deltaTime/1000 in Sekunden umgerechnet. No-Op bei toter Einheit (kein Wiederbeleben).
  private tickRegen(deltaTime: number): void {
    if (this.regenTimer <= 0) return;
    this.regenTimer -= deltaTime;
    if (this.hp > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + POWERUP.regenPerSecond * (deltaTime / 1000));
    }
    if (this.regenTimer <= 0) this.regenTimer = 0;
  }

  // Zählt den Steady-Boost herunter. Wie beim Regen gibt es keinen Faktor zurückzusetzen –
  // knockbackResistFactor liefert von selbst wieder 1, sobald steadyTimer auf 0 fällt.
  private tickSteady(deltaTime: number): void {
    if (this.steadyTimer <= 0) return;
    this.steadyTimer -= deltaTime;
    if (this.steadyTimer <= 0) this.steadyTimer = 0;
  }

  // Zählt ein aktives Schild herunter (Fähigkeit beim Spieler, Power-Up bei allen
  // Königen). Zentral in updateKing, damit es auch für KI-Könige korrekt abläuft.
  private tickShield(deltaTime: number): void {
    if (!this.isShieldActive) return;
    this.shieldTimer -= deltaTime;
    if (this.shieldTimer <= 0) this.isShieldActive = false;
  }

  // Zentraler Treffer-Eingang: HP abziehen + Feedback (Aufleuchten, Rückstoß,
  // Schadenszahl). Quelle (srcX/srcY) bestimmt die Rückstoßrichtung.
  takeDamage(amount: number, srcX: number, srcY: number, scene: GameScene): void {
    if (this.hp <= 0) return;
    // Hardcore: nur der SPIELER-König nimmt mehr Schaden (playerDamageTaken > 1).
    // Für alle anderen bleibt der Multiplikator 1.0 -> kein Effekt.
    // armorMult (Rüstungs-Power-Up, < 1) reduziert den eingehenden Schaden zuletzt –
    // die angezeigte Schadenszahl und onPlayerKingHit sehen denselben reduzierten Wert.
    const dmg = (this === scene.playerKing ? amount * scene.playerDamageTaken : amount) * this.armorMult;
    this.hp -= dmg;
    this.flashTimer = FEEDBACK.flashDuration;

    // Rückstoß weg von der Schadensquelle (Spielerkönig behält volle Kontrolle).
    if (this !== scene.playerKing) {
      const dx = this.centerX - srcX;
      const dy = this.centerY - srcY;
      const d = Math.hypot(dx, dy) || 1;
      const factor = this.unitType === "king" ? FEEDBACK.kingKnockbackFactor : 1;
      // Steady-Power-Up reduziert den Rückstoß-Impuls MULTIPLIKATIV zum kingKnockbackFactor
      // (ersetzt ihn nicht): ein König mit Steady steht nahezu fest (0.25 × 0.2 = 0.05).
      const resist = this.knockbackResistFactor;
      this.knockbackVx += (dx / d) * FEEDBACK.knockback * factor * resist;
      this.knockbackVy += (dy / d) * FEEDBACK.knockback * factor * resist;
    }

    if (FEEDBACK.damageNumbers) scene.spawnDamageNumber(dmg, this.centerX, this.y);
    if (this === scene.playerKing) scene.onPlayerKingHit(dmg);
  }

  // Stellt die Grund-Färbung nach einem Treffer-Flash wieder her. Einheiten haben
  // keinen Basis-Tint (Faktionsfarbe steckt im PNG), daher genügt clearTint.
  private restoreTint(): void {
    this.sprite.clearTint();
  }

  // Wendet im Angriffsfenster den typ-/levelabhängigen Nahkampfschaden an,
  // spielt Sound und zeigt den Slash-Effekt.
  private executeAttack(deltaTime: number, scene: GameScene): void {
    if (!this.isAttacking) return;
    this.attackTimer -= deltaTime;
    if (this.attackTimer < 250 && !this.attackDamageDealt) {
      const dmg = this.scaledDamage(this.meleeDamage(), scene);
      if (this.currentTarget && !this.currentTarget.dead) {
        if (this.currentTarget.takeDamage) this.currentTarget.takeDamage(dmg, this.centerX, this.centerY, scene);
        else this.currentTarget.hp -= dmg;
        // Lifesteal: Angreifer heilt sich um einen Anteil des ausgeteilten Nahkampfschadens
        // (nur bei einem echten Treffer auf ein lebendes Ziel), geklemmt auf maxHp.
        this.applyLifestealHeal(dmg);
      }
      // Berserker (Ork-Champion): jeder Nahkampftreffer trifft umstehende Gegner mit (AoE + Knockback).
      if (this.unitType === "champion" && LEGENDARY[this.faction].aoeRange) this.applyBerserkerAoE(dmg, scene);
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
      // Slash an der optischen Figurbreite (barRef) ausrichten, nicht an der kleinen Hitbox,
      // damit die Sichel zur sichtbaren Figur passt (spawnSlash hält sie bewusst kompakt).
      scene.spawnSlash(this.centerX, this.centerY, angle - 2.35619449, this.barRef);
    }
    if (this.attackTimer <= 0) {
      this.isAttacking = false;
      this.attackTimer = 0;
      this.attackDamageDealt = false;
      this.currentTarget = null;
    }
  }

  // Paladin-Aura (Mensch-Champion): heilt periodisch nahe lebende Verbündete (inkl. sich
  // selbst) bis zu deren Maximum. Broad-Phase über das Grid -> kein O(n²) pro Frame.
  private tickPaladinAura(deltaTime: number, scene: GameScene): void {
    const cfg = LEGENDARY[this.faction];
    if (!cfg.auraRange || !cfg.healPerPulse) return;
    this.healPulseTimer -= deltaTime;
    if (this.healPulseTimer > 0) return;
    this.healPulseTimer = cfg.pulseInterval ?? 1000;

    const r = cfg.auraRange;
    const rSq = r * r;
    const near = scene.grid.getEntitiesInBoundingBox(this.centerX - r, this.centerY - r, r * 2, r * 2);
    let healedAny = false;
    for (const e of near) {
      if (!(e instanceof Unit) || e.dead || e.team !== this.team || e.hp >= e.maxHp) continue;
      const dx = e.centerX - this.centerX;
      const dy = e.centerY - this.centerY;
      if (dx * dx + dy * dy > rSq) continue;
      e.hp = Math.min(e.maxHp, e.hp + cfg.healPerPulse);
      healedAny = true;
    }
    if (healedAny) scene.spawnVisualEffect(this.centerX, this.centerY, { r: 80, g: 255, b: 120 }, 14, r, 2, 1.2);
  }

  // Berserker-AoE (Ork-Champion): teilt anteiligen Splash-Schaden + Knockback an
  // alle Gegner im Umkreis aus (der Haupttreffer auf currentTarget ist bereits erfolgt).
  private applyBerserkerAoE(mainDmg: number, scene: GameScene): void {
    const cfg = LEGENDARY[this.faction];
    if (!cfg.aoeRange || !cfg.aoeDamageFactor) return;
    const r = cfg.aoeRange;
    const rSq = r * r;
    const splash = mainDmg * cfg.aoeDamageFactor;
    const near = scene.grid.getEntitiesInBoundingBox(this.centerX - r, this.centerY - r, r * 2, r * 2);
    for (const e of near) {
      if (!(e instanceof Unit) || e.dead || e.team === this.team || e === this.currentTarget) continue;
      const dx = e.centerX - this.centerX;
      const dy = e.centerY - this.centerY;
      if (dx * dx + dy * dy > rSq) continue;
      e.takeDamage(splash, this.centerX, this.centerY, scene);
      // Lifesteal greift symmetrisch zum Haupttreffer: der Berserker teilt hier echten
      // Splash-Schaden an ein lebendes Ziel aus, also heilt er sich auch pro Splash-Treffer.
      this.applyLifestealHeal(splash);
      // Zusätzlicher Wucht-Impuls (Könige werden schwerer gestoßen -> Faktor).
      const d = Math.hypot(dx, dy) || 1;
      const kb = (cfg.aoeKnockback ?? 0) * (e.unitType === "king" ? FEEDBACK.kingKnockbackFactor : 1);
      e.knockbackVx += (dx / d) * kb;
      e.knockbackVy += (dy / d) * kb;
    }
    scene.spawnVisualEffect(this.centerX, this.centerY, { r: 255, g: 90, b: 30 }, 16, r * 1.5, 3, 1.3);
  }

  private faceByDx(dx: number): void {
    if (Math.abs(dx) > 0.1) this.facingDirection = dx > 0 ? 1 : -1;
  }

  update(deltaTime: number, scene: GameScene): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.isMoving = false;
    // moveSpeedFactor zieht den Steady-Tempo-Bonus read-time ein (1 inaktiv, 1.1 aktiv) –
    // einziger Bewegungs-Schritt-Pfad, gilt für Spieler- UND KI-König.
    const step = (this.speed * this.moveSpeedFactor * deltaTime) / 16;

    // Treffer-Flash & Rückstoß – immer, vor allen Bewegungs-Verzweigungen.
    if (this.flashTimer > 0) this.flashTimer -= deltaTime;
    if (this.knockbackVx !== 0 || this.knockbackVy !== 0) {
      this.x += (this.knockbackVx * deltaTime) / 16;
      this.y += (this.knockbackVy * deltaTime) / 16;
      this.knockbackVx *= FEEDBACK.knockbackDecay;
      this.knockbackVy *= FEEDBACK.knockbackDecay;
      if (Math.abs(this.knockbackVx) < 0.05) this.knockbackVx = 0;
      if (Math.abs(this.knockbackVy) < 0.05) this.knockbackVy = 0;
    }

    // Todessound einmalig
    if (this.hp <= 0 && !this.deathSoundPlayed) {
      scene.notifyCombatEvent();
      const key = this.faction === "elf" ? "death_elf" : this.faction === "orc" ? "death_orc" : "death_human";
      let vol = 1.0;
      if (this.unitType === "vassal") vol = this.level === 1 ? 0.7 : this.level === 3 ? 1.3 : 1.0;
      else if (this.unitType === "king" || this.unitType === "champion") vol = 1.3;
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

    // Routing: Elf-Erzschütze (legendärer Fernkämpfer) läuft über die Archer-Logik,
    // alle übrigen Champions + Vasallen über die Nahkampf-Logik.
    if (this.unitType === "champion" && LEGENDARY[this.faction].ranged) this.updateArcher(deltaTime, step, scene);
    else if (this.unitType === "vassal" || this.unitType === "champion") this.updateVassal(deltaTime, step, scene);
    else if (this.unitType === "archer") this.updateArcher(deltaTime, step, scene);
    else this.updateKing(deltaTime, step, scene);

    // Paladin (Mensch-Champion): periodische Heil-Aura für nahe Verbündete.
    if (this.unitType === "champion" && LEGENDARY[this.faction].auraRange) this.tickPaladinAura(deltaTime, scene);

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
          this.currentTarget = info.target as ProjectileTarget;
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
    // Elf-Erzschütze schießt weiter als ein normaler Bogenschütze (LEGENDARY-Override).
    const range = this.unitType === "champion" ? LEGENDARY[this.faction].attackRange ?? UNIT_STATS.archer.attackRange : UNIT_STATS.archer.attackRange;
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
        // Pfeilschaden ebenfalls mit dem Fraktions-Modifikator (Orc-Pfeile +10%).
        // Erzschütze nutzt seinen eigenen, höheren Pfeilschaden (LEGENDARY-Override).
        const baseDmg = this.unitType === "champion" ? LEGENDARY[this.faction].rangedDamage ?? UNIT_STATS.archer.damage : UNIT_STATS.archer.damage;
        // Schadens-Boost wirkt auch auf Pfeilschaden (OBEN AUF den Fraktions-Modifikator).
        const arrowDmg = this.scaledDamage(baseDmg * this.factionDamageMod * this.damageBoostMult, scene);
        // Lifesteal wird NICHT hier beim Abschuss gutgeschrieben, sondern erst beim
        // bestätigten Einschlag (Projectile -> creditLifestealOnHit). Sonst würde der
        // Schütze auch für Pfeile heilen, die ihr Ziel nie treffen (Ziel stirbt/weicht aus).
        scene.spawnProjectile(this.centerX, this.centerY, target, arrowDmg, this.team, this);
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
    // Tempo-Boost und Schild gelten für Spieler- UND KI-König und werden hier
    // zentral getickt (sonst liefe ein KI-Schild aus dem Power-Up nie ab).
    this.tickSpeedBoost(deltaTime);
    this.tickDamageBoost(deltaTime);
    this.tickArmorBoost(deltaTime);
    this.tickLifesteal(deltaTime);
    this.tickRegen(deltaTime);
    this.tickSteady(deltaTime);
    this.tickShield(deltaTime);
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
      // Staubwolke am Start + Funken am Zielpunkt für spürbaren Dash.
      scene.spawnVisualEffect(this.centerX, this.centerY, { r: 210, g: 205, b: 190 }, 14, 320, 3, 2);
      this.x += this.lastDirection.x * CONFIG.dashDistance;
      this.y += this.lastDirection.y * CONFIG.dashDistance;
      this.dashTimer = 0;
      scene.spawnVisualEffect(this.centerX, this.centerY, { r: 255, g: 255, b: 255 }, 8, 260, 2, 1.5);
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
      // Energie-Ring beim Aktivieren des Schilds.
      scene.spawnVisualEffect(this.centerX, this.centerY, { r: 0, g: 200, b: 255 }, 18, 420, 3, 1.6);
    }
    // Hinweis: Das Herunterzählen des aktiven Schilds passiert zentral in updateKing
    // (tickShield), damit es auch für KI-Könige greift (Power-Up-Schild).

    // Angriff einleiten
    if (!this.isAttacking) {
      const info = determineVassalTarget(this, scene);
      if (info && info.type === "attack") {
        const d = Math.hypot(info.x - this.x, info.y - this.y);
        if (d <= 60) {
          this.isAttacking = true;
          this.attackTimer = 500;
          this.attackDamageDealt = false;
          this.currentTarget = info.target as ProjectileTarget;
        }
      }
    }
  }

  // Smartere KI-König-Steuerung mit Persönlichkeits-Tiers.
  // Entscheidungsreihenfolge pro Frame:
  //   1. Rückzug bei wenig HP (mit Hysterese, bis HP sich erholt)
  //   2. lohnenden Gegner-König / nächste Bedrohung angreifen
  //   3. nahe Seele / Power-Up einsammeln (Horde wachsen lassen)
  //   4. sonst umherwandern
  // Auf jede Zielbewegung wird eine Abstoßung von Pfeilen + neutralen Türmen
  // sowie der Zonenrand-Druck addiert, bevor sie ausgeführt wird.
  private updateAIKing(deltaTime: number, step: number, scene: GameScene): void {
    // Skalierte Laufzeit-Persönlichkeit der Szene (Schwierigkeit) statt der globalen
    // Konstante – retreat/regroup/soulGreed reagieren so auf den gewählten Difficulty.
    const tier = scene.scaledPersonalities[this.aiPersonality];
    const sz = scene.safeZoneCurrent;
    // Fraktions-skaliertes Maximum nutzen, sonst läge ein Orc-König (330 HP) bei
    // vollem Leben fälschlich unter 100% und würde zu früh in den Rückzug gehen.
    const hpRatio = this.hp / this.maxHp;

    // Rückzugs-Zustand mit Hysterese aktualisieren: flieht ab retreatHpFactor,
    // kämpft erst ab regroupHpFactor wieder mit – verhindert Flackern am Rand.
    if (this.isRetreating) {
      if (hpRatio >= tier.regroupHpFactor) this.isRetreating = false;
    } else if (hpRatio < tier.retreatHpFactor) {
      this.isRetreating = true;
    }

    // Wiederverwendbarer Abstoss-Vektor (Pfeile + Türme); wird unten addiert.
    const avoid = computeKingAvoidance(this, scene);
    // Zonenrand-Druck: nach innen, bevor man hinausläuft.
    const dxSafe = sz.centerX - this.centerX;
    const dySafe = sz.centerY - this.centerY;
    const distSafe = Math.hypot(dxSafe, dySafe);
    if (distSafe > sz.radius - AI.zoneEdgePadding && distSafe > 0) {
      const w = (distSafe - (sz.radius - AI.zoneEdgePadding)) / AI.zoneEdgePadding;
      avoid.x += (dxSafe / distSafe) * w;
      avoid.y += (dySafe / distSafe) * w;
    }

    // Bewegt den König in Richtung (gx,gy), kombiniert mit dem Abstoss-Vektor.
    const moveToward = (gx: number, gy: number, desireWeight = 1): void => {
      let dx = gx - this.centerX;
      let dy = gy - this.centerY;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        dx = (dx / d) * desireWeight;
        dy = (dy / d) * desireWeight;
      }
      let vx = dx + avoid.x;
      let vy = dy + avoid.y;
      const m = Math.hypot(vx, vy);
      if (m > 0) {
        vx /= m;
        vy /= m;
        const mx = vx * step;
        this.faceByDx(mx);
        this.x += mx;
        this.y += vy * step;
      }
    };

    // 1. RÜCKZUG: weg vom nächsten Feind, Richtung Zonenzentrum / eigene Vasallen.
    if (this.isRetreating) {
      const threat = chooseAIKingTarget(this, scene, this.aiPersonality);
      let fx = sz.centerX;
      let fy = sz.centerY;
      if (threat) {
        // Fluchtpunkt: vom Feind weg, gespiegelt über die eigene Position.
        fx = this.centerX + (this.centerX - threat.enemy.centerX);
        fy = this.centerY + (this.centerY - threat.enemy.centerY);
      }
      moveToward(fx, fy, 1.4); // entschlossen fliehen, Abstoßung trotzdem beachten
      return;
    }

    // 2. ANGRIFF: lohnendsten Gegner-König / nächste Bedrohung suchen.
    const threat = chooseAIKingTarget(this, scene, this.aiPersonality);
    if (threat) {
      const e = threat.enemy;
      const dx = e.centerX - this.centerX;
      const dy = e.centerY - this.centerY;
      const d = Math.hypot(dx, dy);
      if (d <= 60) {
        if (!this.isAttacking) {
          this.isAttacking = true;
          this.attackTimer = 500;
          this.attackDamageDealt = false;
          this.currentTarget = e as ProjectileTarget;
          this.faceByDx(dx);
        }
      } else if (!this.isAttacking) {
        moveToward(e.centerX, e.centerY);
      }
      return;
    }

    // 3. SAMMELN: nahe grüne Seele / Power-Up ansteuern (Horde wächst).
    // soulGreed entscheidet, ob das Tier sich überhaupt dafür von der Stelle bewegt.
    if (!this.isAttacking && Math.random() < tier.soulGreed) {
      const collectible = findKingCollectible(this, scene, this.aiPersonality);
      if (collectible) {
        moveToward(collectible.x, collectible.y);
        return;
      }
    }

    // 4. WANDERN: Abstoßung dominiert, sonst zufälliges Ziel ansteuern.
    if (Math.hypot(avoid.x, avoid.y) > 0.1) {
      this.idleTarget = null;
      let vx = avoid.x;
      let vy = avoid.y;
      const m = Math.hypot(vx, vy);
      vx /= m;
      vy /= m;
      const mx = vx * step;
      this.faceByDx(mx);
      this.x += mx;
      this.y += vy * step;
      return;
    }
    if (!this.idleTarget || Math.hypot(this.idleTarget.x - this.x, this.idleTarget.y - this.y) < 10) {
      this.idleTarget = { x: Math.random() * CONFIG.worldWidth, y: Math.random() * CONFIG.worldHeight };
    }
    moveToward(this.idleTarget.x, this.idleTarget.y);
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

    // Treffer-Aufleuchten (weiße Silhouette) – nur bei Zustandswechsel umschalten.
    if (this.flashTimer > 0 && !this.flashShown) {
      this.sprite.setTintFill(0xffffff);
      this.flashShown = true;
    } else if (this.flashTimer <= 0 && this.flashShown) {
      this.restoreTint();
      this.flashShown = false;
    }

    const playerTeam = this.scenePlayerTeam;
    // Bar an der optischen Figur ausrichten (barRef), zentriert über der (kleinen) Hitbox.
    const barW = this.unitType === "king" ? this.barRef * 1.1 : this.barRef;
    const barX = this.centerX - barW / 2;
    // Bar oberhalb der sichtbaren Figur platzieren: halbe Figurhöhe (≈ barRef) über der Mitte.
    const barY = this.centerY - this.barRef / 2 - (this.unitType === "king" ? 10 : 6);
    this.barBg.setPosition(barX, barY).width = barW;
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.barFill.setPosition(barX, barY);
    this.barFill.width = barW * ratio;
    this.barFill.setFillStyle(this.team === playerTeam ? 0x00ff00 : 0xff0000);

    if (this.shieldRing) {
      this.shieldRing.setVisible(this.isShieldActive);
      if (this.isShieldActive) this.shieldRing.setPosition(this.centerX, this.centerY);
    }
    if (this.archerOutline) this.archerOutline.setPosition(this.centerX, this.centerY);
    if (this.championRing) this.championRing.setPosition(this.centerX, this.centerY);
    // Elite-Aura folgt der Figur (inkl. Bobbing-Versatz), wie der championRing – die
    // Puls-Tween skaliert/alpha-t sie weiter, hier wird nur die Position nachgezogen.
    if (this.eliteAura) this.eliteAura.setPosition(this.centerX, this.centerY + this.bobbingOffset);
  }

  // Wird von der GameScene pro Frame gesetzt, um Verbündete (grün) von Gegnern (rot) zu unterscheiden.
  scenePlayerTeam: number | null = null;

  destroyView(): void {
    this.barBg.destroy();
    this.barFill.destroy();
    this.shieldRing?.destroy();
    this.archerOutline?.destroy();
    this.championRing?.destroy();
    // Elite-Aura mit-zerstören – destroy() killt auch die endlose Puls-Tween, die auf das
    // Image zielt (Phaser räumt Tweens toter Targets ab), darum kein Tween-Leak.
    this.eliteAura?.destroy();

    // Anmutiger Tod ohne Sheet-Animation: kurz umkippen + ausblenden, dann zerstören.
    const s = this.sprite;
    s.scene.tweens.add({
      targets: s,
      alpha: 0,
      angle: this.facingDirection === -1 ? 80 : -80,
      scaleX: s.scaleX * 0.85,
      scaleY: s.scaleY * 0.85,
      duration: 500,
      onComplete: () => s.destroy(),
    });
  }
}
