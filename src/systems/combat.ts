import { Unit } from "../entities/Unit";
import { Soul } from "../entities/Soul";
import { TOWER, BARRACKS } from "../config/gameConfig";
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

// Lässt lebende Kasernen periodisch eine grüne Rekruten-Seele in ihrer Nähe ausstoßen.
// Diese Seele fließt durch den bestehenden applySoulMagnetism/handleSouls-Pfad – die Horde
// wird zur Kaserne gezogen, das Gebäude wird so zum umkämpften Karten-Objektiv (Magnet).
// Allokationsfrei, solange nicht emittiert wird (kein Per-Frame-Müll).
export function updateBarracks(scene: GameScene, deltaTime: number): void {
  for (const b of scene.buildings) {
    if (b.buildingType !== "barracks" || b.hp <= 0) continue;
    b.spawnTimer += deltaTime;
    if (b.spawnTimer < BARRACKS.spawnInterval) continue;
    b.spawnTimer = 0;

    // Zufälliger Punkt im Spawn-Radius um das Kaserne-Zentrum (Winkel+Radius wie in worldgen),
    // damit die Seele nicht exakt im Sprite, sondern davor/daneben erscheint.
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * BARRACKS.spawnRadius;
    const sx = b.centerX + Math.cos(angle) * radius;
    const sy = b.centerY + Math.sin(angle) * radius;

    const soul = new Soul(scene, sx, sy, BARRACKS.soulType);
    scene.souls.push(soul);
    scene.grid.addEntity(soul);

    // Dezente grüne Emissions-Juice an der Kaserne, damit der Ausstoß lesbar ist.
    scene.spawnVisualEffect(b.centerX, b.centerY, { r: 46, g: 204, b: 113 }, 8, 320, 2, 1);
  }
}
