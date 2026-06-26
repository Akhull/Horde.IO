import { Unit } from "../entities/Unit";
import { Soul } from "../entities/Soul";
import { Building } from "../entities/Building";
import type { GameScene } from "../scenes/GameScene";

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
export function recalcFormationOffset(unit: Unit, units: Unit[], leader: Unit): Vec2 {
  const minDistanceFromKing = 100;
  const minDistanceBetween = 60;
  const alliedUnits = units.filter((u) => u.leader === leader && u.unitType !== "king");
  const formationRadius = 100 + alliedUnits.length * 5;
  const minRadius = Math.max(30, minDistanceFromKing);

  let candidate: Vec2;
  let attempts = 0;
  do {
    const currentAngle = Math.atan2(unit.y - leader.y, unit.x - leader.x);
    const newAngle = currentAngle - Math.PI / 4 + Math.random() * (Math.PI / 2);
    const newRadius = minRadius + Math.random() * (formationRadius - minRadius);
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
    unit.formationOffset = recalcFormationOffset(unit, scene.units, unit.leader);
  }
  return {
    x: unit.leader.x + unit.formationOffset.x,
    y: unit.leader.y + unit.formationOffset.y,
    type: "follow",
    target: unit.leader,
  };
}
