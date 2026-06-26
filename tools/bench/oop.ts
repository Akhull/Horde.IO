// OOP-Modell des Simulations-Hot-Paths: ein Array fetter Klassen-Instanzen, je mit
// einer update(dt)-Methode. Bewusst breit wie src/entities/Unit.ts (Dutzende Felder,
// Methoden-Dispatch pro Einheit pro Frame), damit der Vergleich gegen das schlanke
// ECS-Layout fair ist: gestreute, breite Objekte vs. gepackte Komponenten-Arrays.

import { SpatialGrid } from "../../src/systems/SpatialGrid";
import type { GridEntity } from "../../src/types";
import {
  SpawnRecord,
  UNIT_SIZE,
  UNIT_SPEED,
  SEPARATION_DESIRED,
  SEPARATION_STRENGTH,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  CELL_SIZE,
} from "./shared";

// Geteilter Scratch-Puffer für die allokationsfreie Grid-Query (wie sepScratch im Spiel).
const sepScratch: GridEntity[] = [];

// Bewusst breite Klasse: spiegelt die "wide object shape" von Unit wider. Die meisten
// Felder werden im Hot-Path NICHT gelesen – sie sind da, damit Objektgröße/Speicher-
// layout (versteckte Klassen, Pointer-Chasing) realistisch dem echten Unit ähneln.
export class OopUnit implements GridEntity {
  // --- Grid-Pflichtfelder (von SpatialGrid gelesen/geschrieben) ---
  x: number;
  y: number;
  width = UNIT_SIZE;
  height = UNIT_SIZE;
  _gridCells: Set<Set<GridEntity>> = new Set();
  _visit = 0;
  dead = false;

  // --- Bewegung/Ziel (im Hot-Path gelesen) ---
  vx = 0;
  vy = 0;
  targetX: number;
  targetY: number;
  speed = UNIT_SPEED;
  leader: OopUnit;
  isLeader: boolean;

  // --- "Tote" Felder: präsent, aber im Update ungenutzt (mimik der Unit-Breite) ---
  faction = "human";
  unitType = "vassal";
  level = 1;
  team = 0;
  hp = 100;
  maxHp = 100;
  factionDamageMod = 1;
  dashTimer = 0;
  lastDirectionX = 0;
  lastDirectionY = 0;
  shieldCooldownTimer = 0;
  shieldTimer = 0;
  isShieldActive = false;
  speedBoostTimer = 0;
  dashReadyFlashTimer = 0;
  shieldReadyFlashTimer = 0;
  idleTargetX: number | null = null;
  idleTargetY: number | null = null;
  aiPersonality = "balanced";
  isRetreating = false;
  attackCooldown = 0;
  lastAttackTimer = 0;
  healPulseTimer = 0;
  isAttacking = false;
  attackTimer = 0;
  attackDamageDealt = false;
  currentTarget: unknown = null;
  formationOffsetX: number | null = null;
  formationOffsetY: number | null = null;
  flashTimer = 0;
  flashShown = false;
  knockbackVx = 0;
  knockbackVy = 0;
  deathSoundPlayed = false;
  facingDirection: 1 | -1 = 1;
  isMoving = false;
  bobbingPhase = 0;
  bobbingOffset = 0;
  prevX: number;
  prevY: number;
  footstepTimer = 0;
  spriteKey = "human_l1";
  sheetKey: string | null = null;
  isDemoSheet = false;
  currentAnim: string | null = null;
  wasAttacking = false;

  constructor(x: number, y: number, targetX: number, targetY: number, isLeader: boolean) {
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.isLeader = isLeader;
    this.leader = this; // wird nach dem Spawn auf den echten Anführer gesetzt
  }

  get centerX(): number {
    return this.x + this.width / 2;
  }
  get centerY(): number {
    return this.y + this.height / 2;
  }

  // Ein Frame Simulation für diese Einheit. Spiegelt den echten Hot-Path:
  //   1. Ziel bestimmen (Anführer-Position für Vasallen, Wanderziel für Anführer)
  //   2. Richtung normalisieren, Position um speed*step verschieben
  //   3. Nachbarn aus der SpatialGrid abfragen
  //   4. Separationskräfte akkumulieren (squared-Vorfilter, sqrt nur bei Treffern)
  //   5. Separation integrieren
  // (Grid-Update passiert im Runner nach allen Updates – wie scene.grid.updateEntity.)
  update(_dt: number, grid: SpatialGrid): void {
    // 1.+2. Bewegung zum Ziel (Vasall folgt Anführer, Anführer wandert zum Ziel).
    let gx: number;
    let gy: number;
    if (this.isLeader) {
      gx = this.targetX;
      gy = this.targetY;
      // Anführer: neues Wanderziel, wenn nah dran (wie idleTarget im Spiel).
      const ddx = gx - this.x;
      const ddy = gy - this.y;
      if (ddx * ddx + ddy * ddy < 100) {
        // deterministisch aus aktueller Position abgeleitet (kein Math.random im Hot-Path)
        this.targetX = (this.x * 1.3 + WORLD_WIDTH * 0.37) % WORLD_WIDTH;
        this.targetY = (this.y * 1.7 + WORLD_HEIGHT * 0.53) % WORLD_HEIGHT;
        gx = this.targetX;
        gy = this.targetY;
      }
    } else {
      // Vasall steuert die aktuelle Anführer-Position an (Formation/Sammelbewegung).
      gx = this.leader.centerX;
      gy = this.leader.centerY;
    }

    const dx = gx - this.centerX;
    const dy = gy - this.centerY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 5) {
      const inv = this.speed / d;
      this.x += dx * inv;
      this.y += dy * inv;
      this.facingDirection = dx < 0 ? -1 : 1;
    }

    // 3.+4. Separation: Nachbarn abfragen, Push-Kräfte akkumulieren (1:1 applySeparationForce).
    let fx = 0;
    let fy = 0;
    let count = 0;
    const ax = this.x;
    const ay = this.y;
    const desired = SEPARATION_DESIRED;
    const desiredSq = desired * desired;
    const neighbors = grid.getPotentialCollidersInto(this, sepScratch);
    for (let i = 0; i < neighbors.length; i++) {
      const b = neighbors[i] as OopUnit;
      if (b === this) continue;
      const sdx = ax - b.x;
      const sdy = ay - b.y;
      const dSq = sdx * sdx + sdy * sdy;
      if (dSq > 0 && dSq < desiredSq) {
        const sd = Math.sqrt(dSq);
        fx += (sdx / sd) * (desired - sd);
        fy += (sdy / sd) * (desired - sd);
        count++;
      }
    }

    // 5. Separation integrieren.
    if (count > 0) {
      this.x += (fx / count) * SEPARATION_STRENGTH;
      this.y += (fy / count) * SEPARATION_STRENGTH;
    }
  }
}

// Baut die OOP-Welt deterministisch aus den geteilten Spawn-Datensätzen auf und
// gibt Einheitenliste + befüllte SpatialGrid zurück.
export function buildOopWorld(records: SpawnRecord[]): { units: OopUnit[]; grid: SpatialGrid } {
  const grid = new SpatialGrid(WORLD_WIDTH, WORLD_HEIGHT, CELL_SIZE);
  const units: OopUnit[] = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    units[i] = new OopUnit(r.x, r.y, r.targetX, r.targetY, r.isLeader);
  }
  // Anführer-Referenzen verdrahten (nach dem Erzeugen, damit Indizes gültig sind).
  for (let i = 0; i < records.length; i++) {
    units[i].leader = units[records[i].leaderIndex];
  }
  for (let i = 0; i < units.length; i++) grid.addEntity(units[i]);
  return { units, grid };
}

// Ein kompletter Simulations-Frame über alle OOP-Einheiten.
// Reihenfolge wie GameScene: erst alle u.update(), dann Grid neu indizieren.
export function stepOop(units: OopUnit[], grid: SpatialGrid, dt: number): void {
  for (let i = 0; i < units.length; i++) {
    units[i].update(dt, grid);
  }
  // Positionsänderungen in die Broad-Phase zurückschreiben (wie scene.grid.updateEntity).
  for (let i = 0; i < units.length; i++) {
    grid.updateEntity(units[i]);
  }
}
