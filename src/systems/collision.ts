import { Unit } from "../entities/Unit";
import { Building } from "../entities/Building";
import { Obstacle } from "../entities/Obstacle";
import { Forest } from "../entities/Forest";
import type { GameScene } from "../scenes/GameScene";

// Stösst überlappende gegnerische Einheiten auseinander (Broad-Phase via SpatialGrid).
export function resolveUnitUnitCollisions(scene: GameScene): void {
  const grid = scene.grid;
  for (const a of scene.units) {
    for (const b of grid.getPotentialColliders(a)) {
      if (!(b instanceof Unit) || a === b) continue;
      if (a.leader === b.leader) continue; // gleiche Fraktion -> keine Kollision
      if (!a.intersects(b)) continue;

      let dx = b.centerX - a.centerX;
      let dy = b.centerY - a.centerY;
      let dist = Math.hypot(dx, dy);
      if (dist === 0) {
        dx = (Math.random() - 0.5) * 0.1;
        dy = (Math.random() - 0.5) * 0.1;
        dist = Math.hypot(dx, dy);
      }
      const overlap = a.width / 2 + b.width / 2 - dist;
      if (overlap > 0) {
        const px = (dx / dist) * overlap / 2;
        const py = (dy / dist) * overlap / 2;
        a.x -= px;
        a.y -= py;
        b.x += px;
        b.y += py;
        grid.updateEntity(a);
        grid.updateEntity(b);
      }
    }
  }
}

// Drückt Einheiten aus Gebäuden heraus (Bogenschützen ignorieren Gebäude wie im Original).
export function resolveUnitBuildingCollisions(scene: GameScene): void {
  const grid = scene.grid;
  for (const unit of scene.units) {
    if (unit.unitType === "archer") continue;
    for (const b of grid.getPotentialColliders(unit)) {
      if (!(b instanceof Building)) continue;
      if (!unit.intersects(b)) continue;
      let dx = unit.centerX - b.centerX;
      let dy = unit.centerY - b.centerY;
      let dist = Math.hypot(dx, dy);
      if (dist === 0) {
        dx = 1;
        dy = 0;
        dist = 1;
      }
      const overlap = unit.width / 2 + b.width / 2 - dist;
      if (overlap > 0) {
        unit.x += (dx / dist) * overlap;
        unit.y += (dy / dist) * overlap;
        grid.updateEntity(unit);
      }
    }
  }
}

// Drückt Einheiten aus Hindernissen/Wäldern heraus.
export function resolveUnitObstacleCollisions(scene: GameScene): void {
  const grid = scene.grid;
  for (const unit of scene.units) {
    for (const obs of grid.getPotentialColliders(unit)) {
      if (!(obs instanceof Obstacle || obs instanceof Forest)) continue;
      if (!unit.intersects(obs)) continue;
      let dx = unit.centerX - obs.centerX;
      let dy = unit.centerY - obs.centerY;
      let dist = Math.hypot(dx, dy);
      if (dist === 0) {
        dx = 1;
        dy = 0;
        dist = 1;
      }
      const overlap = unit.width / 2 + Math.min(obs.width, obs.height) / 2 - dist;
      if (overlap > 0) {
        unit.x += (dx / dist) * overlap;
        unit.y += (dy / dist) * overlap;
        grid.updateEntity(unit);
      }
    }
  }
}

// Sanfte Separationskraft, damit sich verbündete Einheiten nicht zu sehr stapeln.
export function applySeparationForce(scene: GameScene): void {
  const grid = scene.grid;
  const desired = 30;
  const strength = 0.05;
  for (const a of scene.units) {
    let fx = 0;
    let fy = 0;
    let count = 0;
    for (const b of grid.getPotentialColliders(a)) {
      if (!(b instanceof Unit) || a === b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < desired) {
        fx += (dx / d) * (desired - d);
        fy += (dy / d) * (desired - d);
        count++;
      }
    }
    if (count > 0) {
      a.x += (fx / count) * strength;
      a.y += (fy / count) * strength;
    }
  }
}
