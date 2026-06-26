import { Unit } from "../entities/Unit";
import { Soul } from "../entities/Soul";
import { Building } from "../entities/Building";
import { AI, TOWER } from "../config/gameConfig";
import type { AIPersonality } from "../config/gameConfig";
import type { GameScene } from "../scenes/GameScene";
import type { Rng } from "../sim/rng";

export interface Vec2 {
  x: number;
  y: number;
}

export interface TargetInfo {
  x: number;
  y: number;
  type: "attack" | "orb" | "follow";
  target: Unit | Building | Soul;
}

// Verteilt Einheiten in einer lockeren Formation um ihren Anführer.
// Port von recalcFormationOffset (utils.js).
export function recalcFormationOffset(unit: Unit, units: Unit[], leader: Unit, rng: Rng): Vec2 {
  // Dichter Schwarm-Feel: Vasallen sollen sich als kompakte Masse um den König
  // ballen, nicht als dünner Halo. Werte bewusst niedrig gehalten, aber der
  // Abstand bleibt klar über dem Separations-Sollwert von 30px (collision.ts),
  // damit die Einheiten sich nicht gegenseitig wegdrücken und zittern.
  const minDistanceFromKing = 50; // König-Hitbox ~26 + Vasall-Hitbox ~13 = ~39 Min., +Luft
  const minDistanceBetween = 40; // > 30 Separations-Floor -> dicht, aber stabil
  const alliedUnits = units.filter((u) => u.leader === leader && u.unitType !== "king");
  const formationRadius = 60 + alliedUnits.length * 3; // sanftes Wachstum -> bleibt ein Klumpen
  const minRadius = Math.max(30, minDistanceFromKing);

  let candidate: Vec2;
  let attempts = 0;
  do {
    const currentAngle = Math.atan2(unit.y - leader.y, unit.x - leader.x);
    const newAngle = currentAngle - Math.PI / 4 + rng.next() * (Math.PI / 2);
    const newRadius = minRadius + rng.next() * (formationRadius - minRadius);
    candidate = { x: newRadius * Math.cos(newAngle), y: newRadius * Math.sin(newAngle) };
    let valid = true;
    for (const u of alliedUnits) {
      if (u !== unit && u.formationOffset) {
        if (Math.hypot(candidate.x - u.formationOffset.x, candidate.y - u.formationOffset.y) < minDistanceBetween) {
          valid = false;
          break;
        }
      }
    }
    if (valid) return candidate;
    attempts++;
  } while (attempts < 10);
  return candidate;
}

// Bestimmt das Ziel einer (Nicht-Spieler-)Einheit: Gegner am König schützen,
// nahe Gegner/Seelen/Gebäude angreifen, sonst dem Anführer in Formation folgen.
// Port von determineVassalTarget (utils.js).
export function determineVassalTarget(unit: Unit, scene: GameScene): TargetInfo | null {
  if (!scene.playerKing || !unit.leader) return null;

  const leaderCenterX = unit.leader.centerX;
  const leaderCenterY = unit.leader.centerY;
  const sz = scene.safeZoneCurrent;
  const leaderDist = Math.hypot(leaderCenterX - sz.centerX, leaderCenterY - sz.centerY);
  const kingInside = leaderDist <= sz.radius;

  const dxKing = unit.leader.centerX - unit.centerX;
  const dyKing = unit.leader.centerY - unit.centerY;
  if (Math.hypot(dxKing, dyKing) > 750) {
    return { x: unit.leader.x, y: unit.leader.y, type: "follow", target: unit.leader };
  }

  const kingCenter = { x: unit.leader.centerX, y: unit.leader.centerY };
  const protectThreshold = 300;
  const detectionRange = 300;

  // Priorität 1: Gegner in der Nähe des eigenen Königs angreifen
  if (unit.leader.unitType === "king") {
    const r = protectThreshold + unit.leader.width;
    const near = scene.grid.getEntitiesInBoundingBox(unit.leader.x - r, unit.leader.y - r, r * 2, r * 2);
    let enemyNearKing: Unit | null = null;
    let enemyDist = Infinity;
    for (const other of near) {
      if (other instanceof Unit && other.team !== unit.leader.team && !other.dead) {
        if (kingInside && Math.hypot(other.centerX - sz.centerX, other.centerY - sz.centerY) > sz.radius) continue;
        const d = Math.hypot(other.centerX - kingCenter.x, other.centerY - kingCenter.y);
        if (d < protectThreshold && d < enemyDist) {
          enemyNearKing = other;
          enemyDist = d;
        }
      }
    }
    if (enemyNearKing) return { x: enemyNearKing.x, y: enemyNearKing.y, type: "attack", target: enemyNearKing };
  }

  // Priorität 2: Eigene Reichweite – nächster Gegner / passende Seele / Gebäude
  const box = scene.grid.getEntitiesInBoundingBox(
    unit.x - detectionRange,
    unit.y - detectionRange,
    detectionRange * 2,
    detectionRange * 2
  );

  let bestEnemy: Unit | null = null;
  let bestEnemyDist = Infinity;
  let bestOrb: Soul | null = null;
  let bestOrbDist = Infinity;
  let bestBuilding: Building | null = null;
  let bestBuildingDist = Infinity;

  for (const e of box) {
    if (e instanceof Unit) {
      if (e.team !== unit.team && !e.dead) {
        if (kingInside && Math.hypot(e.centerX - sz.centerX, e.centerY - sz.centerY) > sz.radius) continue;
        const d = Math.hypot(e.x - unit.x, e.y - unit.y);
        if (d < detectionRange && d < bestEnemyDist) {
          bestEnemy = e;
          bestEnemyDist = d;
        }
      }
    } else if (e instanceof Soul) {
      if (kingInside && Math.hypot(e.x - sz.centerX, e.y - sz.centerY) > sz.radius) continue;
      const d = Math.hypot(e.x - unit.x, e.y - unit.y);
      if (d < detectionRange && d < bestOrbDist) {
        if (e.soulType === "green") {
          bestOrb = e;
          bestOrbDist = d;
        } else if (e.soulType === "blue" && unit.unitType === "vassal" && unit.level === 1) {
          bestOrb = e;
          bestOrbDist = d;
        } else if (e.soulType === "purple" && unit.unitType === "vassal" && unit.level === 2) {
          bestOrb = e;
          bestOrbDist = d;
        }
      }
    } else if (e instanceof Building) {
      if (kingInside && Math.hypot(e.centerX - sz.centerX, e.centerY - sz.centerY) > sz.radius) continue;
      const d = Math.hypot(e.x - unit.x, e.y - unit.y);
      if (d < detectionRange && d < bestBuildingDist) {
        bestBuilding = e;
        bestBuildingDist = d;
      }
    }
  }

  if (bestEnemy) return { x: bestEnemy.x, y: bestEnemy.y, type: "attack", target: bestEnemy };
  if (bestOrb) return { x: bestOrb.x, y: bestOrb.y, type: "orb", target: bestOrb };
  if (bestBuilding) return { x: bestBuilding.x, y: bestBuilding.y, type: "attack", target: bestBuilding };

  // Standard: Formation um den Anführer
  if (!unit.formationOffset) {
    unit.formationOffset = recalcFormationOffset(unit, scene.units, unit.leader, scene.rng);
  }
  return {
    x: unit.leader.x + unit.formationOffset.x,
    y: unit.leader.y + unit.formationOffset.y,
    type: "follow",
    target: unit.leader,
  };
}

// ── KI-KÖNIG-LOGIK ────────────────────────────────────────────────────────────
// Reine Datenfunktionen (Phaser-frei) für updateAIKing in Unit.ts. Sie nutzen
// durchgehend die scene.grid-Broad-Phase, damit kein O(n²)-Scan pro Frame entsteht.

export interface KingThreat {
  enemy: Unit; // bedrohlichster/lohnendster Gegner in Reichweite
  dist: number; // Distanz zum eigenen König
  isKing: boolean; // ist es ein gegnerischer König?
}

// Wählt das Königs-Ziel aus dem Grid: bevorzugt einen LOHNENDEN Gegner-König
// (niedrige HP = Finish, kleine Begleit-Horde = Snowball), sonst die nächste
// Bedrohung. Ersetzt das stumpfe "nächster Gegner" des alten Codes.
export function chooseAIKingTarget(king: Unit, scene: GameScene, p: AIPersonality): KingThreat | null {
  // Skalierte Laufzeit-Kopie der Szene nutzen (Schwierigkeit), NICHT die globale
  // AI.personalities-Konstante – so wirkt die Difficulty, ohne den Const zu mutieren.
  const tier = scene.scaledPersonalities[p];
  const range = tier.aggroRange;
  const sz = scene.safeZoneCurrent;
  const kingInside = Math.hypot(king.centerX - sz.centerX, king.centerY - sz.centerY) <= sz.radius;

  const box = scene.grid.getEntitiesInBoundingBox(king.x - range, king.y - range, range * 2, range * 2);

  let bestEnemy: Unit | null = null;
  let bestScore = -Infinity;
  let bestDist = Infinity;
  let bestIsKing = false;

  for (const e of box) {
    if (!(e instanceof Unit) || e.team === king.team || e.dead) continue;
    // Gegner ausserhalb der Safe-Zone nicht verfolgen, wenn man selbst drin ist.
    if (kingInside && Math.hypot(e.centerX - sz.centerX, e.centerY - sz.centerY) > sz.radius) continue;
    const d = Math.hypot(e.centerX - king.centerX, e.centerY - king.centerY);
    if (d > range) continue;

    // Score: näher = besser; Gegner-Könige bekommen einen kräftigen Bonus,
    // der bei niedriger HP / kleiner Begleit-Horde noch wächst (Finish/Snowball).
    let score = range - d;
    const isKing = e.unitType === "king";
    if (isKing) {
      score += range * 0.5; // Könige sind das eigentliche Win-Ziel
      // Fraktions-skaliertes Maximum des ZIELS nutzen (ein Orc-König hat 330 HP),
      // damit "angeschlagen"/finish korrekt relativ zu seinem echten Maximum zählt.
      const hpRatio = e.hp / e.maxHp;
      if (hpRatio < tier.finishHpRatio) score += range * (1 - hpRatio); // angeschlagen -> finishen
      const escorts = countEscorts(e, scene);
      if (escorts < AI.hordeWeakThreshold) score += range * 0.4; // schwach begleitet -> snowballen
    }
    if (score > bestScore) {
      bestScore = score;
      bestEnemy = e;
      bestDist = d;
      bestIsKing = isKing;
    }
  }

  if (!bestEnemy) return null;
  return { enemy: bestEnemy, dist: bestDist, isKing: bestIsKing };
}

// Zählt die lebenden Begleiter (Vasallen/Archer) eines Königs im Nahbereich.
// Broad-Phase über das Grid, damit es billig bleibt.
function countEscorts(king: Unit, scene: GameScene): number {
  const r = AI.hordeSearchRange;
  const near = scene.grid.getEntitiesInBoundingBox(king.x - r, king.y - r, r * 2, r * 2);
  let n = 0;
  for (const e of near) {
    if (e instanceof Unit && e.team === king.team && e.unitType !== "king" && !e.dead) n++;
  }
  return n;
}

// Sucht die nächste sinnvoll sammelbare Seele oder das nächste Power-Up.
// Könige sammeln grüne Seelen (neue Vasallen) – so wächst ihre Horde wie die
// des Spielers. Power-Ups (Tempo/Schild) sind immer mitnehmenswert.
export function findKingCollectible(king: Unit, scene: GameScene, p: AIPersonality): Vec2 | null {
  // Skalierte Laufzeit-Kopie der Szene nutzen (siehe chooseAIKingTarget).
  const tier = scene.scaledPersonalities[p];
  const range = tier.soulRange;
  const sz = scene.safeZoneCurrent;
  const kingInside = Math.hypot(king.centerX - sz.centerX, king.centerY - sz.centerY) <= sz.radius;

  let best: Vec2 | null = null;
  // Verglichen wird die EFFEKTIVE Distanz (kleiner = attraktiver). Seelen nutzen die
  // echte Distanz; Power-Ups werden mit der persönlichkeitsabhängigen powerUpDesire
  // gewichtet (cautious wertet sie höher, aggressive niedriger).
  let bestEff = Infinity;

  const box = scene.grid.getEntitiesInBoundingBox(king.x - range, king.y - range, range * 2, range * 2);
  for (const e of box) {
    if (e instanceof Soul) {
      // Könige nehmen nur grüne Seelen (erzeugen einen neuen Vasallen).
      if (e.soulType !== "green") continue;
      if (kingInside && Math.hypot(e.x - sz.centerX, e.y - sz.centerY) > sz.radius) continue;
      const d = Math.hypot(e.x - king.x, e.y - king.y);
      if (d < range && d < bestEff) {
        best = { x: e.centerX, y: e.centerY };
        bestEff = d;
      }
    }
  }

  // Power-Ups liegen nicht im Grid – kleine globale Liste, daher direkt scannen.
  // Effektive Distanz = echte Distanz / powerUpDesire: höheres Begehren -> wirkt
  // näher -> wird eher angesteuert. Der range-Cut bleibt auf der echten Distanz.
  for (const pu of scene.powerUps) {
    if (pu.dead) continue;
    if (kingInside && Math.hypot(pu.centerX - sz.centerX, pu.centerY - sz.centerY) > sz.radius) continue;
    const d = Math.hypot(pu.centerX - king.centerX, pu.centerY - king.centerY);
    if (d >= range) continue;
    const eff = d / tier.powerUpDesire;
    if (eff < bestEff) {
      best = { x: pu.centerX, y: pu.centerY };
      bestEff = eff;
    }
  }

  return best;
}

// Liefert einen Abstoss-Vektor weg von feindlichen Projektilen und neutralen
// Türmen in deren Reichweite. Analog zur bestehenden Dodge-Logik, aber als
// wiederverwendbarer Helfer mit Tower-Vermeidung. Ergebnis ist NICHT normiert.
export function computeKingAvoidance(king: Unit, scene: GameScene): Vec2 {
  const avoid: Vec2 = { x: 0, y: 0 };

  // Feindlichen Pfeilen ausweichen.
  for (const proj of scene.projectiles) {
    if (proj.team === king.team) continue;
    const dx = king.centerX - proj.centerX;
    const dy = king.centerY - proj.centerY;
    const dist = Math.hypot(dx, dy);
    if (dist < AI.projectileDodgeRange && dist > 0) {
      const w = (AI.projectileDodgeRange - dist) / AI.projectileDodgeRange;
      avoid.x += (dx / dist) * w;
      avoid.y += (dy / dist) * w;
    }
  }

  // Neutrale Türme meiden, solange man in ihrer Feuerreichweite steht.
  const towerR = TOWER.range + AI.towerAvoidPadding;
  const box = scene.grid.getEntitiesInBoundingBox(king.x - towerR, king.y - towerR, towerR * 2, towerR * 2);
  for (const e of box) {
    if (!(e instanceof Building) || e.buildingType !== "tower" || e.dead) continue;
    const dx = king.centerX - e.centerX;
    const dy = king.centerY - e.centerY;
    const dist = Math.hypot(dx, dy);
    if (dist < towerR && dist > 0) {
      const w = ((towerR - dist) / towerR) * AI.towerAvoidWeight;
      avoid.x += (dx / dist) * w;
      avoid.y += (dy / dist) * w;
    }
  }

  return avoid;
}
