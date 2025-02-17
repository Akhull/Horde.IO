// public/js/utils/utils.js
import { Unit } from "../entities/Unit.js";
import { CONFIG } from "../core/config.js";
import { Forest } from "../entities/Forest.js";
import { Building } from "../entities/Building.js";
import { Soul } from "../entities/Soul.js";
import { Projectile } from "../entities/Projectile.js";

export { CONFIG };

/**
 * Vassal spawnen (gibt den neuen Vassal zurück)
 */
export function spawnVassal(leader) {
  let x = leader.position.x + (Math.random() - 0.5) * 50;
  let z = leader.position.z + (Math.random() - 0.5) * 50;
  let unitType = (Math.random() < 0.2) ? "archer" : "vassal";
  const vassal = new Unit(x, z, leader.faction, unitType, 1, leader);
  return vassal;
}

/**
 * Prüft, ob ein rechteckiger Bereich (x, z, width, height) frei von Hindernissen ist.
 * Falls das Hindernis keine "position" hat, werden obs.x und obs.z verwendet.
 */
export function isAreaClear(x, z, width, height, obstacles) {
  for (let obs of obstacles) {
    let ox = obs.position ? obs.position.x : obs.x;
    let oz = obs.position ? obs.position.z : obs.z;
    let obsWidth = obs.width;
    let obsDepth = obs.depth;
    if (!(x + width < ox ||
          x > ox + obsWidth ||
          z + height < oz ||
          z > oz + obsDepth)) {
      return false;
    }
  }
  return true;
}

/**
 * Erzeugt Hindernisse in der Spielwelt.
 * Erzeugt entweder einen Forest (für Wälder) oder ein generisches Hindernis (z.B. Wasser).
 */
export function generateObstacles(game) {
  game.obstacles = [];
  const numObstacles = 20;
  for (let i = 0; i < numObstacles; i++) {
    let rand = Math.random();
    let type = (rand < 0.7) ? "forest" : "water";
    let w = 200 + Math.random() * 600;
    let d = 200 + Math.random() * 600; // depth statt height
    let x = Math.random() * (CONFIG.worldWidth - w);
    let z = Math.random() * (CONFIG.worldHeight - d);
    
    if (type === "forest") {
      game.obstacles.push(new Forest(x, z, w, d));
    } else {
      game.obstacles.push(new Building(x, z, type));
    }
  }
}

/**
 * Erzeugt Cluster von Gebäuden in der Spielwelt.
 */
export function generateBuildingClusters(game) {
  game.buildings = [];
  const numClusters = 80;
  for (let i = 0; i < numClusters; i++) {
    let centerX = Math.random() * (CONFIG.worldWidth - 800) + 400;
    let centerZ = Math.random() * (CONFIG.worldHeight - 800) + 400;
    if (!isAreaClear(centerX - 50, centerZ - 50, 100, 100, game.obstacles)) continue;
    let numBuildings = Math.floor(Math.random() * 11) + 10;
    let clusterBuildings = [];
    for (let j = 0; j < numBuildings; j++) {
      let valid = false, attempt = 0, x, z;
      while (!valid && attempt < 10) {
        let angle = Math.random() * Math.PI * 2;
        let radius = Math.random() * 150;
        x = centerX + Math.cos(angle) * radius;
        z = centerZ + Math.sin(angle) * radius;
        valid = true;
        for (let b of clusterBuildings) {
          if (x < b.position.x + b.width + 20 && x + 60 > b.position.x - 20 &&
              z < b.position.z + b.depth + 20 && z + 60 > b.position.z - 20) {
            valid = false;
            break;
          }
        }
        if (!isAreaClear(x, z, 60, 60, game.obstacles)) valid = false;
        attempt++;
      }
      if (valid) {
        let r = Math.random();
        let type = (r < 0.5) ? "barn" : (r < 0.8 ? "house" : "tower");
        let newBuilding = new Building(x, z, type);
        clusterBuildings.push(newBuilding);
        game.buildings.push(newBuilding);
      }
    }
  }
}

/**
 * Entfernt Einheiten mit 0 oder weniger HP.
 */
export function resolveUnitCollisions(game) {
  let survivors = [];
  for (let unit of game.units) {
    if (unit.hp <= 0) { spawnSoulFromUnit(unit, game); }
    else survivors.push(unit);
  }
  game.units = survivors;
}

/**
 * Kollisionserkennung zwischen Einheiten.
 */
export function resolveUnitUnitCollisions(game) {
  for (let i = 0; i < game.units.length; i++) {
    for (let j = i + 1; j < game.units.length; j++) {
      let a = game.units[i], b = game.units[j];
      if (a.leader === b.leader) continue;
      if (a.intersects(b)) {
        let dx = (b.position.x + b.width/2) - (a.position.x + a.width/2);
        let dz = (b.position.z + b.depth/2) - (a.position.z + a.depth/2);
        let dist = Math.hypot(dx, dz);
        if (dist === 0) { dx = 1; dz = 0; dist = 1; }
        let overlap = (a.width/2 + b.width/2) - dist;
        if (overlap > 0) {
          let pushX = (dx/dist) * overlap/2;
          let pushZ = (dz/dist) * overlap/2;
          a.position.x -= pushX; a.position.z -= pushZ;
          b.position.x += pushX; b.position.z += pushZ;
        }
      }
    }
  }
}

/**
 * Kollisionserkennung zwischen Einheiten und Gebäuden.
 */
export function resolveUnitBuildingCollisions(game) {
  game.units.forEach(unit => {
    if (unit.unitType === "archer") return;
    game.buildings.forEach(building => {
      if (unit.intersects(building)) {
        let dx = (unit.position.x + unit.width/2) - (building.position.x + building.width/2);
        let dz = (unit.position.z + unit.depth/2) - (building.position.z + building.depth/2);
        let dist = Math.hypot(dx, dz);
        if (dist === 0) { dx = 1; dz = 0; dist = 1; }
        let overlap = (unit.width/2 + building.width/2) - dist;
        if (overlap > 0) {
          unit.position.x += (dx/dist) * overlap;
          unit.position.z += (dz/dist) * overlap;
        }
      }
    });
  });
}

/**
 * Kollisionserkennung zwischen Einheiten und Hindernissen.
 * Dabei wird geprüft, ob das Hindernis eine position-Eigenschaft besitzt.
 */
export function resolveUnitObstacleCollisions(game) {
  game.units.forEach(unit => {
    game.obstacles.forEach(obs => {
      let ox = obs.position ? obs.position.x : obs.x;
      let oz = obs.position ? obs.position.z : obs.z;
      if (unit.intersects({ position: { x: ox, z: oz }, width: obs.width, depth: obs.depth })) {
        let dx = (unit.position.x + unit.width/2) - (ox + obs.width/2);
        let dz = (unit.position.z + unit.depth/2) - (oz + obs.depth/2);
        let dist = Math.hypot(dx, dz);
        if (dist === 0) { dx = 1; dz = 0; dist = 1; }
        let overlap = (unit.width/2 + Math.min(obs.width, obs.depth)/2) - dist;
        if (overlap > 0) {
          unit.position.x += (dx/dist) * overlap;
          unit.position.z += (dz/dist) * overlap;
        }
      }
    });
  });
}

/**
 * Wendet eine Separation zwischen Einheiten an.
 */
export function applySeparationForce(game, deltaTime) {
  const desiredSeparation = 30;
  const separationStrength = 0.05;
  for (let i = 0; i < game.units.length; i++) {
    let forceX = 0, forceZ = 0;
    let count = 0;
    for (let j = 0; j < game.units.length; j++) {
      if (i === j) continue;
      let dx = game.units[i].position.x - game.units[j].position.x;
      let dz = game.units[i].position.z - game.units[j].position.z;
      let d = Math.hypot(dx, dz);
      if (d > 0 && d < desiredSeparation) {
        forceX += (dx / d) * (desiredSeparation - d);
        forceZ += (dz / d) * (desiredSeparation - d);
        count++;
      }
    }
    if (count > 0) {
      forceX /= count;
      forceZ /= count;
      game.units[i].position.x += forceX * separationStrength;
      game.units[i].position.z += forceZ * separationStrength;
    }
  }
}

/**
 * Berechnet einen neuen Formationsoffset für eine Einheit relativ zu ihrem Anführer.
 */
export function recalcFormationOffset(unit, units, leader) {
  const minDistanceFromKing = 100;
  const minDistanceBetween = 60;
  let alliedUnits = units.filter(u => u.leader === leader && u.unitType !== "king");
  let formationRadius = 100 + alliedUnits.length * 5;
  let minRadius = Math.max(30, minDistanceFromKing);
  let candidate;
  let attempts = 0;
  do {
    let currentAngle = Math.atan2(unit.position.z - leader.position.z, unit.position.x - leader.position.x);
    let minAngle = currentAngle - Math.PI / 4;
    let maxAngle = currentAngle + Math.PI / 4;
    let newAngle = minAngle + Math.random() * (maxAngle - minAngle);
    let newRadius = minRadius + Math.random() * (formationRadius - minRadius);
    candidate = { x: newRadius * Math.cos(newAngle), z: newRadius * Math.sin(newAngle) };
    let valid = true;
    for (let u of alliedUnits) {
      if (u !== unit && u.formationOffset) {
        let diffX = candidate.x - u.formationOffset.x;
        let diffZ = candidate.z - u.formationOffset.z;
        if (Math.hypot(diffX, diffZ) < minDistanceBetween) {
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

/**
 * Bestimmt das Ziel eines Vasallen.
 */
export function determineVassalTarget(unit, game) {
  if (!game.playerKing || !unit.leader) return null;
  let leaderCenterX = unit.leader.position.x + unit.leader.width / 2;
  let leaderCenterZ = unit.leader.position.z + unit.leader.depth / 2;
  let safeCenterX = game.safeZoneCurrent.centerX;
  let safeCenterZ = game.safeZoneCurrent.centerZ;
  let leaderDist = Math.hypot(leaderCenterX - safeCenterX, leaderCenterZ - safeCenterZ);
  let kingInside = leaderDist <= game.safeZoneCurrent.radius;
  let dxKing = (unit.leader.position.x + unit.leader.width / 2) - (unit.position.x + unit.width / 2);
  let dzKing = (unit.leader.position.z + unit.leader.depth / 2) - (unit.position.z + unit.depth / 2);
  if (Math.hypot(dxKing, dzKing) > 750) {
    return { x: unit.leader.position.x, z: unit.leader.position.z, type: "follow", target: unit.leader };
  }
  let kingCenter = { x: unit.leader.position.x + unit.leader.width / 2, z: unit.leader.position.z + unit.leader.depth / 2 };
  const protectThreshold = 300;
  let enemyNearKing = null, enemyDist = Infinity;
  for (let other of game.units) {
    if (other.team !== unit.leader.team && !other.dead) {
      let otherCenterX = other.position.x + other.width / 2;
      let otherCenterZ = other.position.z + other.depth / 2;
      if (kingInside && Math.hypot(otherCenterX - safeCenterX, otherCenterZ - safeCenterZ) > game.safeZoneCurrent.radius)
        continue;
      let dx = otherCenterX - kingCenter.x;
      let dz = otherCenterZ - kingCenter.z;
      let d = Math.hypot(dx, dz);
      if (d < protectThreshold && d < enemyDist) { enemyNearKing = other; enemyDist = d; }
    }
  }
  if (enemyNearKing) return { x: enemyNearKing.position.x, z: enemyNearKing.position.z, type: "attack", target: enemyNearKing };
  const detectionRange = 300;
  let bestEnemy = null, bestEnemyDist = Infinity;
  for (let other of game.units) {
    if (other.team !== unit.team && !other.dead) {
      let otherCenterX = other.position.x + other.width / 2;
      let otherCenterZ = other.position.z + other.depth / 2;
      if (kingInside && Math.hypot(otherCenterX - safeCenterX, otherCenterZ - safeCenterZ) > game.safeZoneCurrent.radius)
        continue;
      let dx = other.position.x - unit.position.x, dz = other.position.z - unit.position.z;
      let d = Math.hypot(dx, dz);
      if (d < detectionRange && d < bestEnemyDist) { bestEnemy = other; bestEnemyDist = d; }
    }
  }
  if (bestEnemy) return { x: bestEnemy.position.x, z: bestEnemy.position.z, type: "attack", target: bestEnemy };
  let bestOrb = null, bestOrbDist = Infinity;
  for (let soul of game.souls) {
    if (kingInside && Math.hypot(soul.position.x - safeCenterX, soul.position.z - safeCenterZ) > game.safeZoneCurrent.radius)
      continue;
    let dx = soul.position.x - unit.position.x, dz = soul.position.z - unit.position.z;
    let d = Math.hypot(dx, dz);
    if (d < detectionRange && d < bestOrbDist) {
      if (soul.soulType === "green") { bestOrb = soul; bestOrbDist = d; }
      else if (soul.soulType === "blue" && unit.unitType === "vassal" && unit.level === 1) { bestOrb = soul; bestOrbDist = d; }
      else if (soul.soulType === "purple" && unit.unitType === "vassal" && unit.level === 2) { bestOrb = soul; bestOrbDist = d; }
    }
  }
  if (bestOrb) return { x: bestOrb.position.x, z: bestOrb.position.z, type: "orb", target: bestOrb };
  let bestBuilding = null, bestBuildingDist = Infinity;
  for (let b of game.buildings) {
    let bCenterX = b.position.x + b.width / 2;
    let bCenterZ = b.position.z + b.depth / 2;
    if (kingInside && Math.hypot(bCenterX - safeCenterX, bCenterZ - safeCenterZ) > game.safeZoneCurrent.radius)
        continue;
    let dx = b.position.x - unit.position.x, dz = b.position.z - unit.position.z;
    let d = Math.hypot(dx, dz);
    if (d < detectionRange && d < bestBuildingDist) { bestBuilding = b; bestBuildingDist = d; }
  }
  if (bestBuilding) return { x: bestBuilding.position.x, z: bestBuilding.position.z, type: "attack", target: bestBuilding };
  if (!unit.formationOffset) {
    unit.formationOffset = recalcFormationOffset(unit, game.units, unit.leader);
  }
  return {
    x: unit.leader.position.x + unit.formationOffset.x,
    z: unit.leader.position.z + unit.formationOffset.z,
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
    let unitCenterX = unit.position.x + unit.width / 2;
    let unitCenterZ = unit.position.z + unit.depth / 2;
    let dx = unitCenterX - game.safeZoneCurrent.centerX;
    let dz = unitCenterZ - game.safeZoneCurrent.centerZ;
    let dist = Math.hypot(dx, dz);
    if (dist > game.safeZoneCurrent.radius) {
      let damage = 0.05 * deltaTime;
      if (unit.isShieldActive) damage *= 0.5;
      unit.hp -= damage;
    }
  }
  game.units = game.units.filter(u => { 
    if (u.hp <= 0) { 
      spawnSoulFromUnit(u, game); 
      return false; 
    } else return true; 
  });
}

export function spawnSoulFromUnit(unit, game) {
  if (unit.unitType === "vassal") {
    if (Math.random() < 0.5) return;
  }
  let soulType;
  if (unit.unitType === "king") soulType = "purple";
  else if (unit.level === 1) soulType = "green";
  else if (unit.level === 2) soulType = "blue";
  else if (unit.level === 3) soulType = "purple";
  game.souls.push(new Soul(unit.position.x, unit.position.z, soulType));
}

export function handlePowerUps(game, deltaTime) {
  for (let i = game.powerUps.length - 1; i >= 0; i--) {
    let powerUp = game.powerUps[i];
    if (game.playerKing && game.playerKing.intersects(powerUp)) {
      if (powerUp.effectType === "speed") {
        game.playerKing.speed *= 1.5;
        setTimeout(() => { game.playerKing.speed /= 1.5; }, powerUp.duration);
      } else if (powerUp.effectType === "shield") {
        if (game.playerKing.isShieldActive) {
          game.playerKing.shieldTimer += powerUp.duration;
        } else {
          game.playerKing.isShieldActive = true;
          game.playerKing.shieldTimer = powerUp.duration;
        }
      }
      game.powerUps.splice(i, 1);
    }
  }
}

export function handleSouls(game) {
  for (let i = game.souls.length - 1; i >= 0; i--) {
    let soul = game.souls[i], collected = false;
    for (let unit of game.units) {
      let unitCenterX = unit.position.x + unit.width / 2;
      let unitCenterZ = unit.position.z + unit.depth / 2;
      let soulCenterX = soul.position.x + soul.width / 2;
      let soulCenterZ = soul.position.z + soul.depth / 2;
      if (Math.hypot(unitCenterX - soulCenterX, unitCenterZ - soulCenterZ) < 40) {
        if (soul.soulType === "green") {
          game.units.push(spawnVassal(unit.leader));
          collected = true;
          break;
        } else if (soul.soulType === "blue" && unit.unitType === "vassal" && unit.level === 1) {
          unit.level = 2;
          collected = true;
          break;
        } else if (soul.soulType === "purple" && unit.unitType === "vassal" && unit.level === 2) {
          unit.level = 3;
          collected = true;
          break;
        }
      }
    }
    if (collected) game.souls.splice(i, 1);
  }
}

export function handleBuildings(game) {
  for (let i = game.buildings.length - 1; i >= 0; i--) {
    let building = game.buildings[i];
    if (building.hp <= 0) {
      let soulType = (building.buildingType === "barn") ? "green" : (building.buildingType === "house" ? "blue" : "purple");
      game.souls.push(new Soul(building.position.x, building.position.z, soulType));
      game.buildings.splice(i, 1);
    }
  }
}

/**
 * Wrapper-Funktion, um ein neues Projektil zu erzeugen.
 */
export function ProjectileWrapper(x, z, target, damage) {
  return new Projectile(x, z, target, damage);
}
