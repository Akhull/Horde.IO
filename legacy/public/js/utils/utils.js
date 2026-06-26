// public/js/utils/utils.js
import { Building } from "../entities/Building.js";
import { Obstacle } from "../entities/Obstacle.js";
import { Soul } from "../entities/Soul.js";
import { Unit } from "../entities/Unit.js";
import { Projectile } from "../entities/Projectile.js";
import { CONFIG } from "../core/config.js";
import { Forest } from "../entities/Forest.js"; // Neuer Import

export { CONFIG };

// Vassal spawnen (gibt den neuen Vassal zurück)
export function spawnVassal(leader) {
  let x = leader.x + (Math.random() - 0.5) * 50;
  let y = leader.y + (Math.random() - 0.5) * 50;
  let unitType = (Math.random() < 0.2) ? "archer" : "vassal";
  const vassal = new Unit(x, y, leader.faction, unitType, 1, leader);
  return vassal;
}

// Angepasste Hindernis-Erzeugung: Bei "forest" wird eine Forest-Instanz erstellt.
export function generateObstacles(game) {
  game.obstacles = [];
  const numObstacles = 20;
  for (let i = 0; i < numObstacles; i++) {
    let rand = Math.random();
    let type = (rand < 0.7) ? "forest" : "water";
    let w = 200 + Math.random() * 600;
    let h = 200 + Math.random() * 600;
    let x = Math.random() * (CONFIG.worldWidth - w);
    let y = Math.random() * (CONFIG.worldHeight - h);
    
    if (type === "forest") {
      // Nutze die neue Forest-Klasse für Wälder
      game.obstacles.push(new Forest(x, y, w, h));
    } else {
      // Andernfalls wird ein normales Obstacle erstellt.
      game.obstacles.push(new Obstacle(x, y, w, h, type));
    }
  }
}

export function isAreaClear(x, y, width, height, obstacles) {
  for (let obs of obstacles) {
    if (!(x + width < obs.x || x > obs.x + obs.width || y + height < obs.y || y > obs.y + obs.height)) {
      return false;
    }
  }
  return true;
}

export function generateBuildingClusters(game) {
  game.buildings = [];
  const numClusters = 80;
  for (let i = 0; i < numClusters; i++) {
    let centerX = Math.random() * (CONFIG.worldWidth - 800) + 400;
    let centerY = Math.random() * (CONFIG.worldHeight - 800) + 400;
    if (!isAreaClear(centerX - 50, centerY - 50, 100, 100, game.obstacles)) continue;
    let numBuildings = Math.floor(Math.random() * 11) + 10;
    let clusterBuildings = [];
    for (let j = 0; j < numBuildings; j++) {
      let valid = false, attempt = 0, x, y;
      while (!valid && attempt < 10) {
        let angle = Math.random() * Math.PI * 2;
        let radius = Math.random() * 150;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
        valid = true;
        for (let b of clusterBuildings) {
          if (x < b.x + b.width + 20 && x + 60 > b.x - 20 &&
              y < b.y + b.height + 20 && y + 60 > b.y - 20) {
            valid = false;
            break;
          }
        }
        if (!isAreaClear(x, y, 60, 60, game.obstacles)) valid = false;
        attempt++;
      }
      if (valid) {
        let r = Math.random();
        let type = (r < 0.5) ? "barn" : (r < 0.8 ? "house" : "tower");
        let newBuilding = new Building(x, y, type);
        clusterBuildings.push(newBuilding);
        game.buildings.push(newBuilding);
      }
    }
  }
}

export function resolveUnitCollisions(game) { // Handles unit death processing
    for (let i = game.units.length - 1; i >= 0; i--) {
        const unit = game.units[i];
        if (unit.hp <= 0) {
            spawnSoulFromUnit(unit, game); // This might add a soul to the grid if souls are gridded
            if (game.grid) game.grid.removeEntity(unit);
            game.units.splice(i, 1);
        }
    }
}

export function resolveUnitUnitCollisions(game) {
  if (!game.grid) return; // Guard clause if grid is not initialized

  const checkedPairs = new Set(); // To ensure each pair (a,b) is checked only once

  for (const unitA of game.units) {
    const potentialColliders = game.grid.getPotentialColliders(unitA);
    for (const unitB of potentialColliders) {
      if (!(unitB instanceof Unit) || unitA === unitB) { // Ensure it's a unit and not the same unit
        continue;
      }

      // Create a unique key for the pair, order independent
      const pairKey = unitA.team < unitB.team ? `${unitA.team}-${unitB.team}` : `${unitB.team}-${unitA.team}`;
      if (checkedPairs.has(pairKey)) {
        continue;
      }
      checkedPairs.add(pairKey);

      if (unitA.leader === unitB.leader) continue; // Same faction, no collision

      if (unitA.intersects(unitB)) {
        let dx = (unitB.x + unitB.width / 2) - (unitA.x + unitA.width / 2);
        let dy = (unitB.y + unitB.height / 2) - (unitA.y + unitA.height / 2);
        let dist = Math.hypot(dx, dy);

        if (dist === 0) { // Prevent division by zero if units are perfectly overlapped
          dx = (Math.random() - 0.5) * 0.1; // Minimal random push
          dy = (Math.random() - 0.5) * 0.1;
          dist = Math.hypot(dx, dy);
        }

        let overlap = (unitA.width / 2 + unitB.width / 2) - dist;
        if (overlap > 0) {
          const pushX = (dx / dist) * overlap / 2;
          const pushY = (dy / dist) * overlap / 2;
          unitA.x -= pushX;
          unitA.y -= pushY;
          unitB.x += pushX;
          unitB.y += pushY;
          // After pushing, update their positions in the grid
          game.grid.updateEntity(unitA);
          game.grid.updateEntity(unitB);
        }
      }
    }
  }
}

export function resolveUnitBuildingCollisions(game) {
  if (!game.grid) return;

  for (const unit of game.units) {
    if (unit.unitType === "archer") continue;

    const potentialBuildings = game.grid.getPotentialColliders(unit)
                                      .filter(e => e instanceof Building);
    for (const building of potentialBuildings) {
      if (unit.intersects(building)) {
        let dx = (unit.x + unit.width / 2) - (building.x + building.width / 2);
        let dy = (unit.y + unit.height / 2) - (building.y + building.height / 2);
        let dist = Math.hypot(dx, dy);
        if (dist === 0) { dx = 1; dy = 0; dist = 1; } 
        let overlap = (unit.width / 2 + building.width / 2) - dist;
        if (overlap > 0) {
          unit.x += (dx / dist) * overlap;
          unit.y += (dy / dist) * overlap;
          game.grid.updateEntity(unit); // Unit moved, update its grid position
        }
      }
    }
  }
}

export function resolveUnitObstacleCollisions(game) {
  if (!game.grid) return;

  for (const unit of game.units) {
    const potentialObstacles = game.grid.getPotentialColliders(unit)
                                       .filter(e => e instanceof Obstacle || e instanceof Forest);
    for (const obs of potentialObstacles) {
      if (unit.intersects(obs)) {
        let dx = (unit.x + unit.width/2) - (obs.x + obs.width/2);
        let dy = (unit.y + unit.height/2) - (obs.y + obs.height/2);
        let dist = Math.hypot(dx, dy);
        if (dist === 0) { dx = 1; dy = 0; dist = 1; }
        // Obstacles might have irregular shapes if Forest is complex, but grid helps narrow phase.
        // Using Math.min for overlap calculation assumes rectangular overlap logic is sufficient after filtering.
        let overlap = (unit.width/2 + Math.min(obs.width, obs.height)/2) - dist; 
        if (overlap > 0) {
          unit.x += (dx/dist) * overlap;
          unit.y += (dy/dist) * overlap;
          game.grid.updateEntity(unit); // Unit moved, update its grid position
        }
      }
    }
  }
}

export function applySeparationForce(game, deltaTime) {
  if (!game.grid) return; // Guard clause if grid is not initialized

  const desiredSeparation = 30;
  const separationStrength = 0.05;

  for (const unitA of game.units) {
    let forceX = 0, forceY = 0;
    let count = 0;
    
    // Get nearby units from the spatial grid
    const potentialSeparators = game.grid.getPotentialColliders(unitA);

    for (const unitB of potentialSeparators) {
      if (!(unitB instanceof Unit) || unitA === unitB) { // Ensure it's a unit and not the same unit
        continue;
      }

      let dx = unitA.x - unitB.x;
      let dy = unitA.y - unitB.y;
      let d = Math.hypot(dx, dy);

      if (d > 0 && d < desiredSeparation) {
        forceX += dx / d * (desiredSeparation - d);
        forceY += dy / d * (desiredSeparation - d);
        count++;
      }
    }

    if (count > 0) {
      forceX /= count;
      forceY /= count;
      unitA.x += forceX * separationStrength;
      unitA.y += forceY * separationStrength;
      // It's important to update the grid if units move significantly due to separation.
      // However, since separation is a small nudge, and units are updated at the end of their main update,
      // we might defer this grid update to avoid redundant updates if many units are nudged.
      // For now, let unit.update() handle the grid update.
      // If this causes issues (e.g. units pushed out of their cells before their main update),
      // then add: game.grid.updateEntity(unitA);
    }
  }
}

export function recalcFormationOffset(unit, units, leader) {
  const minDistanceFromKing = 100;
  const minDistanceBetween = 60;
  let alliedUnits = units.filter(u => u.leader === leader && u.unitType !== "king");
  let formationRadius = 100 + alliedUnits.length * 5;
  let minRadius = Math.max(30, minDistanceFromKing);
  let candidate;
  let attempts = 0;
  do {
    let currentAngle = Math.atan2(unit.y - leader.y, unit.x - leader.x);
    let minAngle = currentAngle - Math.PI / 4;
    let maxAngle = currentAngle + Math.PI / 4;
    let newAngle = minAngle + Math.random() * (maxAngle - minAngle);
    let newRadius = minRadius + Math.random() * (formationRadius - minRadius);
    candidate = { x: newRadius * Math.cos(newAngle), y: newRadius * Math.sin(newAngle) };
    let valid = true;
    for (let u of alliedUnits) {
      if (u !== unit && u.formationOffset) {
        let diffX = candidate.x - u.formationOffset.x;
        let diffY = candidate.y - u.formationOffset.y;
        if (Math.hypot(diffX, diffY) < minDistanceBetween) {
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

export function determineVassalTarget(unit, game) {
  if (!game.playerKing || !unit.leader) return null;
  let leaderCenterX = unit.leader.x + unit.leader.width / 2;
  let leaderCenterY = unit.leader.y + unit.leader.height / 2;
  let leaderDist = Math.hypot(leaderCenterX - game.safeZoneCurrent.centerX, leaderCenterY - game.safeZoneCurrent.centerY);
  let kingInside = leaderDist <= game.safeZoneCurrent.radius;
  let dxKing = (unit.leader.x + unit.leader.width/2) - (unit.x + unit.width/2);
  let dyKing = (unit.leader.y + unit.leader.height/2) - (unit.y + unit.height/2);
  if (Math.hypot(dxKing, dyKing) > 750) {
    return { x: unit.leader.x, y: unit.leader.y, type: "follow", target: unit.leader };
  }
  let kingCenter = { x: unit.leader.x + unit.leader.width/2, y: unit.leader.y + unit.leader.height/2 };
  const protectThreshold = 300; // For enemies near the king
  const detectionRange = 300;   // For general targeting by the unit

  let enemyNearKing = null, enemyDistToKing = Infinity;
  let bestEnemyForUnit = null, bestEnemyDistToUnit = Infinity;
  let bestOrbForUnit = null, bestOrbDistToUnit = Infinity;
  let bestBuildingForUnit = null, bestBuildingDistToUnit = Infinity;

  // Define a search area around the unit for general targeting
  const searchBoxX = unit.x - detectionRange;
  const searchBoxY = unit.y - detectionRange;
  const searchBoxWidth = detectionRange * 2;
  const searchBoxHeight = detectionRange * 2;
  
  let nearbyEntities = [];
  if (game.grid) {
    nearbyEntities = game.grid.getEntitiesInBoundingBox(searchBoxX, searchBoxY, searchBoxWidth, searchBoxHeight);
  } else { // Fallback to all entities if grid is not available (should not happen in normal flow)
    nearbyEntities = [...game.units, ...game.souls, ...game.buildings];
  }

  // First priority: Attack enemies near the King (for all units, not just vassals)
  // This loop might need to iterate all game.units if protectThreshold > detectionRange
  // or if king is far from the current unit. For simplicity, we'll use a wider search for this.
  // A more optimal way for "enemies near king" would be a query centered on the king.
  // For now, let's iterate all units for this specific "protect king" check if king is the leader
  if (unit.leader === game.playerKing || unit.leader.unitType === 'king') { // Check if this unit belongs to a king
      const kingProtectSearchRadius = protectThreshold + unit.leader.width; // Search around the king
      const kingSearchBox = { 
          x: unit.leader.x - kingProtectSearchRadius, 
          y: unit.leader.y - kingProtectSearchRadius, 
          width: kingProtectSearchRadius * 2, 
          height: kingProtectSearchRadius * 2
      };
      const entitiesNearKing = game.grid ? game.grid.getEntitiesInBoundingBox(kingSearchBox.x, kingSearchBox.y, kingSearchBox.width, kingSearchBox.height) : game.units;

      for (const other of entitiesNearKing) {
        if (other instanceof Unit && other.team !== unit.leader.team && !other.dead) {
          let otherCenterX = other.x + other.width/2;
          let otherCenterY = other.y + other.height/2;
          if (kingInside && Math.hypot(otherCenterX - game.safeZoneCurrent.centerX, otherCenterY - game.safeZoneCurrent.centerY) > game.safeZoneCurrent.radius)
            continue;
          let dx = otherCenterX - kingCenter.x;
          let dy = otherCenterY - kingCenter.y;
          let d = Math.hypot(dx, dy);
          if (d < protectThreshold && d < enemyDistToKing) { enemyNearKing = other; enemyDistToKing = d; }
        }
      }
      if (enemyNearKing) return { x: enemyNearKing.x, y: enemyNearKing.y, type: "attack", target: enemyNearKing };
  }


  // Second priority: Unit's own targeting based on nearbyEntities from its own detectionRange
  for (const entity of nearbyEntities) {
    if (entity instanceof Unit) {
      if (entity.team !== unit.team && !entity.dead) {
        let otherCenterX = entity.x + entity.width/2;
        let otherCenterY = entity.y + entity.height/2;
        if (kingInside && Math.hypot(otherCenterX - game.safeZoneCurrent.centerX, otherCenterY - game.safeZoneCurrent.centerY) > game.safeZoneCurrent.radius)
          continue;
        let dx = entity.x - unit.x, dy = entity.y - unit.y;
        let d = Math.hypot(dx, dy);
        if (d < detectionRange && d < bestEnemyDistToUnit) { bestEnemyForUnit = entity; bestEnemyDistToUnit = d; }
      }
    } else if (entity instanceof Soul) {
      if (kingInside && Math.hypot(entity.x - game.safeZoneCurrent.centerX, entity.y - game.safeZoneCurrent.centerY) > game.safeZoneCurrent.radius)
        continue;
      let dx = entity.x - unit.x, dy = entity.y - unit.y;
      let d = Math.hypot(dx, dy);
      if (d < detectionRange && d < bestOrbDistToUnit) {
        if (entity.soulType === "green") { bestOrbForUnit = entity; bestOrbDistToUnit = d; }
        else if (entity.soulType === "blue" && unit.unitType === "vassal" && unit.level === 1) { bestOrbForUnit = entity; bestOrbDistToUnit = d; }
        else if (entity.soulType === "purple" && unit.unitType === "vassal" && unit.level === 2) { bestOrbForUnit = entity; bestOrbDistToUnit = d; }
      }
    } else if (entity instanceof Building) {
      if (kingInside && Math.hypot(entity.x + entity.width/2 - game.safeZoneCurrent.centerX, entity.y + entity.height/2 - game.safeZoneCurrent.centerY) > game.safeZoneCurrent.radius)
          continue;
      let dx = entity.x - unit.x, dy = entity.y - unit.y;
      let d = Math.hypot(dx, dy);
      if (d < detectionRange && d < bestBuildingDistToUnit) { bestBuildingForUnit = entity; bestBuildingDistToUnit = d; }
    }
  }

  if (bestEnemyForUnit) return { x: bestEnemyForUnit.x, y: bestEnemyForUnit.y, type: "attack", target: bestEnemyForUnit };
  if (bestOrbForUnit) return { x: bestOrbForUnit.x, y: bestOrbForUnit.y, type: "orb", target: bestOrbForUnit };
  if (bestBuildingForUnit) return { x: bestBuildingForUnit.x, y: bestBuildingForUnit.y, type: "attack", target: bestBuildingForUnit };

  // Default: Follow leader or formation point
  if (!unit.formationOffset) {
    unit.formationOffset = recalcFormationOffset(unit, game.units, unit.leader);
  }
  return {
    x: unit.leader.x + unit.formationOffset.x,
    y: unit.leader.y + unit.formationOffset.y,
    type: "follow",
    target: unit.leader
  };
}

export function showGameOverMenu(message) {
  const menu = document.getElementById("gameOverMenu");
  const msgElem = document.getElementById("gameOverMessage");
  msgElem.innerText = message;
  menu.style.display = "flex";
}

export function applySafeZoneDamage(game, deltaTime) {
  for (let unit of game.units) {
    let dx = (unit.x + unit.width / 2) - game.safeZoneCurrent.centerX;
    let dy = (unit.y + unit.height / 2) - game.safeZoneCurrent.centerY;
    let dist = Math.hypot(dx, dy);
    if (dist > game.safeZoneCurrent.radius) {
      let damage = 0.05 * deltaTime;
      if (unit.isShieldActive) damage *= 0.5;
      unit.hp -= damage;
    }
  }
  for (let i = game.units.length - 1; i >= 0; i--) {
    const unit = game.units[i];
    if (unit.hp <= 0) { // Already damaged by safe zone in loop above this filter
        spawnSoulFromUnit(unit, game); // ensure this adds to grid
        if (game.grid) game.grid.removeEntity(unit);
        game.units.splice(i, 1);
    }
  }
}

export function spawnSoulFromUnit(unit, game) {
  if (unit.unitType === "vassal") {
    if (Math.random() < 0.5) return; // Only 50% chance to spawn soul from vassal
  }
  let soulType;
  if (unit.unitType === "king") soulType = "purple";
  else if (unit.level === 1) soulType = "green";
  else if (unit.level === 2) soulType = "blue";
  else if (unit.level === 3) soulType = "purple";
  
  const newSoul = new Soul(unit.x, unit.y, soulType);
  game.souls.push(newSoul);
  if (game.grid) { // Add the new soul to the grid
    game.grid.addEntity(newSoul);
  }
}

export function handlePowerUps(game, deltaTime) {
  for (let i = game.powerUps.length - 1; i >= 0; i--) {
    let powerUp = game.powerUps[i];
    if (game.playerKing && game.playerKing.intersects(powerUp)) {
      let color;
      if (powerUp.effectType === "speed") {
        color = {r:255, g:215, b:0}; // Gold-ish yellow
        game.playerKing.speed *= 1.5;
        setTimeout(() => { game.playerKing.speed /= 1.5; }, powerUp.duration);
      } else if (powerUp.effectType === "shield") {
        color = {r:0, g:191, b:255}; // Deep sky blue
        if (game.playerKing.isShieldActive) {
          game.playerKing.shieldTimer += powerUp.duration;
        } else {
          game.playerKing.isShieldActive = true;
          game.playerKing.shieldTimer = powerUp.duration;
        }
      }
      if (color) { // Spawn effect if a color was determined (i.e., known power-up type)
        game.spawnVisualEffect(powerUp.x + powerUp.width/2, powerUp.y + powerUp.height/2, color, 15, 400, 3, 1.2);
      }
      // PowerUps are not currently added to the grid, so removal is not strictly necessary here yet.
      // If they were added (e.g., if they move or need proximity checks), this would be:
      // if (game.grid) game.grid.removeEntity(powerUp);
      game.powerUps.splice(i, 1);
    }
  }
}

export function handleSouls(game) {
  for (let i = game.souls.length - 1; i >= 0; i--) {
    let soul = game.souls[i];
    let collected = false;
    let collectingUnit = null; 

    for (let unit of game.units) {
      let unitCenterX = unit.x + unit.width / 2;
      let unitCenterY = unit.y + unit.height / 2;
      let soulCenterX = soul.x + soul.width / 2;
      let soulCenterY = soul.y + soul.height / 2;
      if (Math.hypot(unitCenterX - soulCenterX, unitCenterY - soulCenterY) < 40) {
        collectingUnit = unit; 
        if (soul.soulType === "green") {
          const newVassal = spawnVassal(unit.leader); // spawnVassal just creates a unit
          game.units.push(newVassal);
          if (game.grid) game.grid.addEntity(newVassal); // Add the new vassal to the grid
          if (game.spawnFloatingText && collectingUnit.team === game.playerKing?.team) { 
            game.spawnFloatingText("+1 Vassal", collectingUnit.x + collectingUnit.width/2, collectingUnit.y, {r:0, g:255, b:0}, 1500, 16, 0.5);
          }
          collected = true;
          break;
        } else if (soul.soulType === "blue" && unit.unitType === "vassal" && unit.level === 1) {
          unit.level = 2;
           if (game.spawnFloatingText && collectingUnit.team === game.playerKing?.team) {
            game.spawnFloatingText("Level Up!", collectingUnit.x + collectingUnit.width/2, collectingUnit.y, {r:255, g:215, b:0}, 1500, 18, 0.7);
          }
          collected = true;
          break;
        } else if (soul.soulType === "purple" && unit.unitType === "vassal" && unit.level === 2) {
          unit.level = 3;
          if (game.spawnFloatingText && collectingUnit.team === game.playerKing?.team) {
            game.spawnFloatingText("Level Up!", collectingUnit.x + collectingUnit.width/2, collectingUnit.y, {r:255, g:215, b:0}, 1500, 18, 0.7);
          }
          collected = true;
          break;
        }
      }
    }
    if (collected) {
      let effectColor; 
      if (soul.soulType === "green") {
        effectColor = {r:0, g:200, b:0};
      } else if (soul.soulType === "blue") {
        effectColor = {r:0, g:100, b:255};
      } else if (soul.soulType === "purple") {
        effectColor = {r:150, g:0, b:150};
      }
      if (effectColor && game.spawnVisualEffect) { 
          game.spawnVisualEffect(soul.x + soul.width/2, soul.y + soul.height/2, effectColor, 10, 300, 2, 1);
      }
      if (game.grid) game.grid.removeEntity(soul); // Remove collected soul from grid
      game.souls.splice(i, 1);
    }
  }
}

export function handleBuildings(game) {
  for (let i = game.buildings.length - 1; i >= 0; i--) {
    let building = game.buildings[i];
    if (building.hp <= 0) {
      let soulType = (building.buildingType === "barn") ? "green" : (building.buildingType === "house" ? "blue" : "purple");
      const newSoul = new Soul(building.x, building.y, soulType);
      game.souls.push(newSoul);
      if (game.grid) game.grid.addEntity(newSoul); // Add new soul to grid
      if (game.grid) game.grid.removeEntity(building); // Remove destroyed building from grid
      game.buildings.splice(i, 1);
    }
  }
}

// Eine kleine Wrapper-Funktion, um ein neues Projektil zu erzeugen.
export function ProjectileWrapper(x, y, target, damage) {
  return new Projectile(x, y, target, damage);
}
