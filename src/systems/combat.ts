import { Unit } from "../entities/Unit";
import { TOWER } from "../config/gameConfig";
import { pickTowerTarget } from "./towerTargeting";
import type { GameScene } from "../scenes/GameScene";

// Lässt Türme auf nahe Einheiten feuern. Neutral (Team -1) -> feindlich zu allen.
// Performance: Broad-Phase über das SpatialGrid; Türme ohne Ziel prüfen seltener.
export function updateTowers(scene: GameScene, deltaTime: number): void {
  const r = TOWER.range;
  for (const b of scene.buildings) {
    if (b.buildingType !== "tower" || b.hp <= 0) continue;
    b.fireTimer += deltaTime;
    if (b.fireTimer < TOWER.fireInterval) continue;

    const near = scene.grid.getEntitiesInBoundingBox(b.centerX - r, b.centerY - r, r * 2, r * 2);
    const units: Unit[] = [];
    for (const e of near) if (e instanceof Unit && !e.dead && e.hp > 0) units.push(e);

    const target = pickTowerTarget(b.centerX, b.centerY, units, r);
    if (target) {
      scene.spawnProjectile(b.centerX, b.centerY, target, TOWER.damage, TOWER.team);
      scene.audio.playSpatial("arrow_shot", b.centerX, b.centerY, 0.8);
      scene.notifyCombatEvent();
      b.fireTimer = 0;
    } else {
      // Kein Ziel: nicht jeden Frame neu scannen, aber reaktionsschnell bleiben.
      b.fireTimer = TOWER.fireInterval - 250;
    }
  }
}
