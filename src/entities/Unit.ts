import Phaser from "phaser";
import { Entity } from "./Entity";
import { CONFIG, UNIT_STATS, DEPTH, FEEDBACK, AI, FACTION_STATS, LEGENDARY, POWERUP } from "../config/gameConfig";
import type { AIPersonality } from "../config/gameConfig";
import type { Faction, UnitType } from "../types";
import type { Vec2 } from "../systems/AI";
import { determineVassalTarget, chooseAIKingTarget, findKingCollectible, computeKingAvoidance } from "../systems/AI";
import { resolveUnitSheet, animKey } from "../systems/animations";
import { FACTION_TINT, type AnimName } from "../config/spriteConfig";
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

  // Darstellung
  private sprite: Phaser.GameObjects.Sprite;
  private spriteKey: string;
  private sheetKey: string | null = null;
  private isDemoSheet = false;
  private currentAnim: string | null = null;
  private wasAttacking = false;
  private barBg: Phaser.GameObjects.Rectangle;
  private barFill: Phaser.GameObjects.Rectangle;
  private shieldRing?: Phaser.GameObjects.Arc;
  private archerOutline?: Phaser.GameObjects.Rectangle;
  private championRing?: Phaser.GameObjects.Arc;

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
      this.width = UNIT_STATS.archer.size;
      this.height = UNIT_STATS.archer.size;
    } else if (unitType === "champion") {
      // Legendäre Spezialeinheit (aus Gold-Orb). Deutlich größer/zäher als ein Vasall;
      // die fraktionsspezifische Mechanik (Aura/Reichweite/AoE) steckt in LEGENDARY.
      this.team = leader!.team;
      this.hp = UNIT_STATS.champion.hp;
      this.speed = UNIT_STATS.champion.speed;
      this.leader = leader!;
      this.width = UNIT_STATS.champion.size;
      this.height = UNIT_STATS.champion.size;
      // Fernkampf-Legendäre (Elf-Erzschütze) brauchen eine Feuerrate (sonst feuert
      // updateArcher mit attackCooldown 0 jeden Frame).
      this.attackCooldown = LEGENDARY[faction].attackCooldown ?? UNIT_STATS.archer.attackCooldown;
    } else {
      this.team = leader!.team;
      this.hp = UNIT_STATS.vassal.hp;
      this.speed = UNIT_STATS.vassal.speed;
      this.leader = leader!;
      const s = UNIT_STATS.vassal.sizeByLevel[level] ?? 40;
      this.width = s;
      this.height = s;
    }

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

    // Champion nutzt das schwere Legion-Sheet (l3) für eine elitäre Optik.
    this.spriteKey = unitType === "king" ? `${faction}_king` : unitType === "champion" ? `${faction}_l3` : `${faction}_l${level}`;
    const sheet = resolveUnitSheet(this.spriteKey);
    const texKey = sheet ? sheet.textureKey : this.spriteKey;
    this.sheetKey = sheet ? sheet.sheetKey : null;
    this.isDemoSheet = sheet?.isDemo ?? false;
    this.sprite = scene.add.sprite(this.centerX, this.centerY, texKey).setDepth(DEPTH.unit);
    this.sprite.setDisplaySize(this.width, this.height);
    if (this.isDemoSheet) this.sprite.setTint(FACTION_TINT[faction]);
    this.playAnim("idle");

    const barH = unitType === "king" ? 8 : 5;
    this.barBg = scene.add.rectangle(this.x, this.y, this.width, barH, 0x000000).setOrigin(0, 0.5).setDepth(DEPTH.healthbar);
    this.barFill = scene.add.rectangle(this.x, this.y, this.width, barH, 0xff0000).setOrigin(0, 0.5).setDepth(DEPTH.healthbar);

    if (unitType === "king") {
      this.shieldRing = scene.add.circle(this.centerX, this.centerY, this.width, 0x00ffff, 0).setStrokeStyle(3, 0x00ffff).setDepth(DEPTH.healthbar).setVisible(false);
    }
    if (unitType === "archer") {
      this.archerOutline = scene.add.rectangle(this.x, this.y, this.width, this.height).setOrigin(0, 0).setStrokeStyle(2, 0xffd700).setDepth(DEPTH.unit);
    }
    if (unitType === "champion") {
      // Goldener Aura-Ring kennzeichnet den Champion klar als legendäre Einheit.
      this.championRing = scene.add.circle(this.centerX, this.centerY, this.width * 0.62, 0xffd700, 0).setStrokeStyle(3, 0xffd700, 0.9).setDepth(DEPTH.healthbar);
    }
  }

  // Spielt eine Animation (idle/walk/attack/death), falls für das Sheet vorhanden.
  private playAnim(name: AnimName, restart = false): void {
    if (!this.sheetKey) return;
    const key = animKey(this.sheetKey, name);
    if (!this.sprite.scene.anims.exists(key)) return;
    if (this.currentAnim === key && !restart) return;
    this.currentAnim = key;
    this.sprite.play(key, true);
  }

  // Wählt die Animation passend zum Zustand: Angriff > Laufen > Idle.
  private updateAnimationState(): void {
    if (!this.sheetKey) return;
    if (this.isAttacking) {
      this.playAnim("attack", !this.wasAttacking); // bei neuem Angriff neu starten
    } else if (this.isMoving) {
      this.playAnim("walk");
    } else {
      this.playAnim("idle");
    }
    this.wasAttacking = this.isAttacking;
  }

  // Vasall auf eine höhere Stufe heben: Grösse/Sprite/Animation aktualisieren + Aufleucht-Pop.
  setLevel(n: number): void {
    this.level = n;
    const s = UNIT_STATS.vassal.sizeByLevel[n] ?? 40;
    this.width = s;
    this.height = s;

    this.spriteKey = `${this.faction}_l${n}`;
    const sheet = resolveUnitSheet(this.spriteKey);
    const texKey = sheet ? sheet.textureKey : this.spriteKey;
    this.sheetKey = sheet ? sheet.sheetKey : null;
    this.isDemoSheet = sheet?.isDemo ?? false;

    this.sprite.setTexture(texKey);
    this.sprite.setDisplaySize(s, s);
    if (this.isDemoSheet) this.sprite.setTint(FACTION_TINT[this.faction]);
    else this.sprite.clearTint();

    this.currentAnim = null;
    this.playAnim(this.isMoving ? "walk" : "idle");

    // Level-up: kurzer Skalierungs-Pop
    this.sprite.scene.tweens.add({
      targets: this.sprite,
      scaleX: this.sprite.scaleX * 1.3,
      scaleY: this.sprite.scaleY * 1.3,
      duration: 150,
      yoyo: true,
    });
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
    const dmg = this === scene.playerKing ? amount * scene.playerDamageTaken : amount;
    this.hp -= dmg;
    this.flashTimer = FEEDBACK.flashDuration;

    // Rückstoß weg von der Schadensquelle (Spielerkönig behält volle Kontrolle).
    if (this !== scene.playerKing) {
      const dx = this.centerX - srcX;
      const dy = this.centerY - srcY;
      const d = Math.hypot(dx, dy) || 1;
      const factor = this.unitType === "king" ? FEEDBACK.kingKnockbackFactor : 1;
      this.knockbackVx += (dx / d) * FEEDBACK.knockback * factor;
      this.knockbackVy += (dy / d) * FEEDBACK.knockback * factor;
    }

    if (FEEDBACK.damageNumbers) scene.spawnDamageNumber(dmg, this.centerX, this.y);
    if (this === scene.playerKing) scene.onPlayerKingHit(dmg);
  }

  // Stellt die Grund-Färbung nach einem Treffer-Flash wieder her.
  private restoreTint(): void {
    if (this.isDemoSheet) this.sprite.setTint(FACTION_TINT[this.faction]);
    else this.sprite.clearTint();
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
      scene.spawnSlash(this.centerX, this.centerY, angle - 2.35619449, this.width);
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
    const step = (this.speed * deltaTime) / 16;

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
        scene.spawnProjectile(this.centerX, this.centerY, target, this.scaledDamage(baseDmg * this.factionDamageMod * this.damageBoostMult, scene), this.team);
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

    this.updateAnimationState();
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
    const barW = this.unitType === "king" ? this.width * 1.1 : this.width;
    const barX = this.x - (barW - this.width) / 2;
    const barY = this.y - (this.unitType === "king" ? 8 : 5) - 2;
    this.barBg.setPosition(barX, barY).width = barW;
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.barFill.setPosition(barX, barY);
    this.barFill.width = barW * ratio;
    this.barFill.setFillStyle(this.team === playerTeam ? 0x00ff00 : 0xff0000);

    if (this.shieldRing) {
      this.shieldRing.setVisible(this.isShieldActive);
      if (this.isShieldActive) this.shieldRing.setPosition(this.centerX, this.centerY);
    }
    if (this.archerOutline) this.archerOutline.setPosition(this.x, this.y);
    if (this.championRing) this.championRing.setPosition(this.centerX, this.centerY);
  }

  // Wird von der GameScene pro Frame gesetzt, um Verbündete (grün) von Gegnern (rot) zu unterscheiden.
  scenePlayerTeam: number | null = null;

  destroyView(): void {
    this.barBg.destroy();
    this.barFill.destroy();
    this.shieldRing?.destroy();
    this.archerOutline?.destroy();
    this.championRing?.destroy();

    const s = this.sprite;
    if (this.sheetKey && s.scene.anims.exists(animKey(this.sheetKey, "death"))) {
      // Tod-Animation abspielen und dann sanft ausblenden
      s.play(animKey(this.sheetKey, "death"), true);
      s.scene.tweens.add({ targets: s, alpha: 0, duration: 600, delay: 150, onComplete: () => s.destroy() });
    } else {
      s.destroy();
    }
  }
}
