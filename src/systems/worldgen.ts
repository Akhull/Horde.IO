import { CONFIG, SWAMP } from "../config/gameConfig";
import { Unit } from "../entities/Unit";
import { Building } from "../entities/Building";
import { Obstacle } from "../entities/Obstacle";
import { Forest } from "../entities/Forest";
import { Swamp } from "../entities/Swamp";
import { PowerUp } from "../entities/PowerUp";
import type { BuildingType, PowerUpType } from "../types";
import type { GameScene } from "../scenes/GameScene";

// Erzeugt einen Vasallen oder Bogenschützen nahe dem Anführer (20% Bogenschütze).
export function spawnVassal(scene: GameScene, leader: Unit): Unit {
  const x = leader.x + (Math.random() - 0.5) * 50;
  const y = leader.y + (Math.random() - 0.5) * 50;
  const type = Math.random() < 0.2 ? "archer" : "vassal";
  return new Unit(scene, x, y, leader.faction, type, 1, leader);
}

// Beschwört einen Champion (legendäre Spezialeinheit) nahe dem König – aus einem Gold-Orb.
export function spawnChampion(scene: GameScene, king: Unit): Unit {
  const x = king.x + (Math.random() - 0.5) * 60;
  const y = king.y + (Math.random() - 0.5) * 60;
  return new Unit(scene, x, y, king.faction, "champion", 1, king);
}

function isAreaClear(x: number, y: number, w: number, h: number, obstacles: { x: number; y: number; width: number; height: number }[]): boolean {
  for (const o of obstacles) {
    if (!(x + w < o.x || x > o.x + o.width || y + h < o.y || y > o.y + o.height)) return false;
  }
  return true;
}

// 20 Hindernisse: 70% Wald, sonst Wasser.
export function generateObstacles(scene: GameScene): void {
  for (let i = 0; i < 20; i++) {
    const w = 200 + Math.random() * 600;
    const h = 200 + Math.random() * 600;
    const x = Math.random() * (CONFIG.worldWidth - w);
    const y = Math.random() * (CONFIG.worldHeight - h);
    const obs = Math.random() < 0.7 ? new Forest(scene, x, y, w, h) : new Obstacle(scene, x, y, w, h);
    scene.obstacles.push(obs);
    scene.grid.addEntity(obs);
  }
}

// SWAMP.count begehbare Sumpf-Flächen. Stil identisch zu generateObstacles, aber im
// Grid für den allokationsfreien Tempo-Lookup pro Einheit (Unit.terrainSpeedFactor).
export function generateSwamps(scene: GameScene): void {
  for (let i = 0; i < SWAMP.count; i++) {
    const w = SWAMP.minSize + Math.random() * (SWAMP.maxSize - SWAMP.minSize);
    const h = SWAMP.minSize + Math.random() * (SWAMP.maxSize - SWAMP.minSize);
    const x = Math.random() * (CONFIG.worldWidth - w);
    const y = Math.random() * (CONFIG.worldHeight - h);
    const swamp = new Swamp(scene, x, y, w, h);
    scene.swamps.push(swamp);
    scene.grid.addEntity(swamp);
  }
}

// 80 Gebäudecluster mit je 10–20 Gebäuden.
export function generateBuildingClusters(scene: GameScene): void {
  for (let i = 0; i < 80; i++) {
    const centerX = Math.random() * (CONFIG.worldWidth - 800) + 400;
    const centerY = Math.random() * (CONFIG.worldHeight - 800) + 400;
    if (!isAreaClear(centerX - 50, centerY - 50, 100, 100, scene.obstacles)) continue;
    const numBuildings = Math.floor(Math.random() * 11) + 10;
    const cluster: Building[] = [];
    for (let j = 0; j < numBuildings; j++) {
      let valid = false;
      let attempt = 0;
      let x = 0;
      let y = 0;
      while (!valid && attempt < 10) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 150;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
        valid = true;
        for (const b of cluster) {
          if (x < b.x + b.width + 20 && x + 60 > b.x - 20 && y < b.y + b.height + 20 && y + 60 > b.y - 20) {
            valid = false;
            break;
          }
        }
        if (!isAreaClear(x, y, 60, 60, scene.obstacles)) valid = false;
        attempt++;
      }
      if (valid) {
        const r = Math.random();
        // "barracks" ist bewusst SELTEN (~8%): es ist der starke Rekruten-Brunnen-Objektiv,
        // ein Dauer-Magnet für die Horden – häufig wäre er ein Selbstläufer statt Streitpunkt.
        const type: BuildingType = r < 0.45 ? "barn" : r < 0.72 ? "house" : r < 0.92 ? "tower" : "barracks";
        const b = new Building(scene, x, y, type);
        cluster.push(b);
        scene.buildings.push(b);
        scene.grid.addEntity(b);
      }
    }
  }
}

// Verstreut Power-Ups über die Welt (im Original war nur die Aufsammel-Logik vorhanden).
export function generatePowerUps(scene: GameScene): void {
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * CONFIG.worldWidth;
    const y = Math.random() * CONFIG.worldHeight;
    // Sieben gleich wahrscheinliche Power-Up-Typen: Tempo, Schild, Schaden, Rüstung,
    // Lifesteal, Regen, Steady (je ~1/7 -> Schwellen in 1/7-Schritten).
    const r = Math.random();
    const type: PowerUpType =
      r < 1 / 7
        ? "speed"
        : r < 2 / 7
          ? "shield"
          : r < 3 / 7
            ? "damage"
            : r < 4 / 7
              ? "armor"
              : r < 5 / 7
                ? "lifesteal"
                : r < 6 / 7
                  ? "regen"
                  : "steady";
    scene.powerUps.push(new PowerUp(scene, x, y, type));
  }
}
